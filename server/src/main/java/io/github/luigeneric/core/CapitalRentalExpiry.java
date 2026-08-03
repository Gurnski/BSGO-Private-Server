package io.github.luigeneric.core;

import io.github.luigeneric.core.player.Hangar;
import io.github.luigeneric.core.player.HangarShip;
import io.github.luigeneric.core.player.Player;
import io.github.luigeneric.core.player.counters.CounterDesc;
import io.github.luigeneric.core.player.location.CICLocation;
import io.github.luigeneric.core.player.location.Location;
import io.github.luigeneric.core.player.location.OutpostLocation;
import io.github.luigeneric.core.protocols.ProtocolID;
import io.github.luigeneric.core.protocols.ProtocolRegistryWriteOnly;
import io.github.luigeneric.core.protocols.game.GameProtocolWriteOnly;
import io.github.luigeneric.core.protocols.player.CapitalRental;
import io.github.luigeneric.core.protocols.player.PlayerProtocol;
import io.github.luigeneric.core.protocols.scene.SceneProtocol;
import io.github.luigeneric.core.sector.Sector;
import io.github.luigeneric.core.sector.management.SectorRegistry;
import io.github.luigeneric.core.spaceentities.PlayerShip;
import io.github.luigeneric.enums.GameLocation;
import io.github.luigeneric.enums.RemovingCause;
import io.github.luigeneric.utils.Utils;
import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import lombok.extern.slf4j.Slf4j;

import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Takes a rented capital back when the hour is up: the pilot is docked where they are, put back in
 * the hull they came from, and the rental leaves the hangar.
 *
 * A sector timer would be the wrong hook - a rental has to run out while the pilot is standing in
 * the CIC too, and sector timers only see ships in space. The tick is coarse because the rental
 * lasts an hour and every tick walks every connected player.
 *
 * The sweep runs on the Quarkus scheduler thread, not a sector thread, and that is what shapes the
 * whole of expireIfDue:
 *
 *  - A pilot who parked the capital and is flying something else is never touched in space. Their
 *    rental is an idle HangarShip with no live SpaceSubscribeInfo, so it is simply dropped.
 *  - A pilot who IS flying it is docked in one sweep and swapped out of the hull in a later one.
 *    The two halves cannot be run together: an in-space PlayerShip shares the active HangarShip's
 *    SpaceSubscribeInfo instance (SpaceObjectFactory.createPlayerShip), and selectShip clears that
 *    object's subscriber map - which the sector thread is still reading until the dock drains.
 *    readyForSwap gates the second half on the drain itself, not on the location flag, and on two
 *    sweeps agreeing that it happened.
 *  - The pilot's sectorID is never rewritten. Docking in place is what GameProtocol.dockProcedure
 *    does; moving them to the home CIC first would make GameProtocol.getSector() resolve a sector
 *    their PlayerShip is not in for as long as the drain takes, and the unguarded
 *    getSectorAndPlayerShip() callers NPE into a disconnect.
 *
 * The hangar load in SqLiteProvider stays as the offline backstop for rentals that ran out while
 * the player was away.
 */
@Slf4j
@ApplicationScoped
public class CapitalRentalExpiry
{
    private final UsersContainer usersContainer;
    private final SectorRegistry sectorRegistry;
    private final CapitalRentalRegistry rentalRegistry;
    private final GameProtocolWriteOnly gameWriter;
    /* Users whose sector has already been seen to hold no PlayerShip for them once. SectorUsers
     * keeps that lookup in a plain HashMap that only the sector thread mutates, so a single read
     * from this thread can miss an entry that is genuinely there - and a miss in the wrong
     * direction is exactly the unsafe swap this class exists to avoid. Two sweeps have to agree,
     * which puts fifteen seconds and thousands of sector ticks between the reading and the
     * selectShip. */
    private final Set<Long> drainObserved = ConcurrentHashMap.newKeySet();

    @Inject
    public CapitalRentalExpiry(final UsersContainer usersContainer,
                               final SectorRegistry sectorRegistry,
                               final CapitalRentalRegistry rentalRegistry)
    {
        this.usersContainer = usersContainer;
        this.sectorRegistry = sectorRegistry;
        this.rentalRegistry = rentalRegistry;
        this.gameWriter = ProtocolRegistryWriteOnly.game();
    }

    /* 15s against an hour-long rental. The interval is also the spacing of the phased hand-back:
     * a dock drains on the next sector tick, tens of milliseconds later, so waiting whole sweeps
     * costs a pilot at most 30 seconds of overdue flagship and buys a very wide margin. */
    @Scheduled(every = "15s")
    public void run()
    {
        final long nowSeconds = System.currentTimeMillis() / 1000L;
        final List<User> users = this.usersContainer.userList(User::isConnected);
        final Set<Long> connectedIds = new HashSet<>(users.size());

        for (final User user : users)
        {
            connectedIds.add(user.getPlayer().getUserID());
            try
            {
                expireIfDue(user, nowSeconds);
            }
            catch (final Exception exception)
            {
                // One broken hangar must not stop the sweep for everybody else.
                log.error("Capital rental sweep failed for {}: {}",
                        user.getUserLogSimple(), Utils.getExceptionStackTrace(exception));
            }
        }

        this.rentalRegistry.pruneExpiredOffline(connectedIds, nowSeconds);
        this.drainObserved.retainAll(connectedIds);
    }

    private void expireIfDue(final User user, final long nowSeconds)
    {
        final Player player = user.getPlayer();
        final long userId = player.getUserID();
        final Hangar hangar = player.getHangar();
        final HangarShip rental = findRentalHull(hangar);
        final CapitalRentalRegistry.Rental tracked = this.rentalRegistry.get(userId);

        if (rental == null)
        {
            if (tracked != null && tracked.expirySeconds() <= nowSeconds)
                this.rentalRegistry.clear(userId);
            return;
        }

        /* No record at all means the hull outlived the record - a restart, or a counter that was
         * dropped for want of a Counter card. Treat that as expired, which is what the hangar
         * load in SqLiteProvider does with the same hull. */
        final long expiry = tracked != null
                ? tracked.expirySeconds()
                : counterValue(player, rental.getCardGuid());
        if (expiry > nowSeconds)
            return;

        final int rentalSlot = rental.getServerId();
        final PlayerProtocol playerProtocol = user.getProtocol(ProtocolID.Player);

        /* The pilot is not in it. Nothing to dock, nothing to swap, no return slot to pick - just
         * take the hull. An idle HangarShip is reachable from no sector job, so this is safe from
         * this thread even while the pilot is mid-fight in something else. */
        if (!hangar.hasActiveShip() || hangar.getActiveShip().getServerId() != rentalSlot)
        {
            if (!playerProtocol.dropRentalHull(rentalSlot))
                return;     // vanished between findRentalHull and here; a later sweep tidies up

            clearRentalRecord(player, rental.getCardGuid());
            log.info("Capital rental expired for {}: {} taken back, pilot was not flying it",
                    user.getUserLogSimple(), rental.getCardGuid());
            return;
        }

        final int returnSlot = pickReturnSlot(player, hangar, tracked, rentalSlot);
        if (returnSlot <= 0)
        {
            // Nothing else to fly. Stranding the pilot is worse than an overdue flagship.
            log.warn("Capital rental expired for {} but no other hull to return to, keeping it",
                    user.getUserLogSimple());
            return;
        }

        if (!readyForSwap(user, player))
            return;     // docking was enqueued, or is still draining; a later sweep finishes it

        if (!playerProtocol.returnRentalHull(rentalSlot, returnSlot))
            return;

        clearRentalRecord(player, rental.getCardGuid());
        log.info("Capital rental expired for {}: {} returned, pilot back in slot {}",
                user.getUserLogSimple(), rental.getCardGuid(), returnSlot);
    }

    /**
     * Whether the ship swap can be made from this thread right now, and the place the pilot gets
     * docked if it cannot yet.
     *
     * The barrier is the drain, not the location. A pilot is put in a room the instant the dock is
     * enqueued - dockProcedure does the same - but their PlayerShip stays in the sector until
     * SpaceObjectRemover.run() takes it out, and until then the sector thread is still reading the
     * SpaceSubscribeInfo that selectShip is about to reassign. SpaceObjectRemover drops the user
     * from the sector's user list as part of that same drain, so "no PlayerShip for this user"
     * is exactly the signal that nothing on the sector thread can still reach it.
     *
     * @return true only when the pilot is in a room and two sweeps running have found no ship of
     *         theirs left in their sector.
     */
    private boolean readyForSwap(final User user, final Player player)
    {
        final long userId = player.getUserID();
        final GameLocation gameLocation = player.getLocation().getGameLocation();
        if (gameLocation != GameLocation.Space && gameLocation != GameLocation.Room)
        {
            // Avatar, zone, starter, mid-jump: no safe place to drop them. Try again next sweep.
            this.drainObserved.remove(userId);
            return false;
        }

        /* getSectorId() is untouched by anything below, so this resolves the sector the pilot's
         * ship is actually in - during a dock that is still the sector they were flying in. */
        final Optional<Sector> optSector = this.sectorRegistry.getSectorById(player.getSectorId());
        final Optional<PlayerShip> optPlayerShip = optSector.flatMap(sector ->
                sector.getCtx().users().getPlayerShipByUserID(userId));

        if (optPlayerShip.isPresent())
        {
            final PlayerShip playerShip = optPlayerShip.get();
            this.drainObserved.remove(userId);

            if (playerShip.isRemoved())
                return false;   // marked this tick, off the list on the next; the sweep comes back

            /* Already in a room with a ship still listed: something else is docking them, or the
             * drain has not run yet. Either way it is not ours to push - re-docking a docked pilot
             * would only throw a scene reload at them. */
            if (gameLocation != GameLocation.Space)
                return false;

            /* A dock the pilot started themselves is already sitting in GameProtocol's own future,
             * which we cannot cancel from here. Enqueueing a second removal would only log a
             * warning and its runnable would set the location again after ours. Let it land. */
            if (playerShip.getSpaceObjectState().getIsDocking())
                return false;

            dockInPlace(user, player, optSector.get(), playerShip);
            return false;
        }

        /* Drained, or never in space at all. In Space it is a pilot whose sector join has not
         * produced a ship yet - not a drain, so the count starts over. */
        if (gameLocation != GameLocation.Room)
        {
            this.drainObserved.remove(userId);
            return false;
        }

        // add() is false only on the second and later sweeps that agree.
        return !this.drainObserved.add(userId);
    }

    /**
     * Docks the pilot where they are - same sector, CIC or outpost, exactly what
     * GameProtocol.dockProcedure's runnable does. Two things are deliberately not done here: the
     * sectorID is not rewritten (see the class comment), and no hull swap is attempted, because
     * the ship this enqueues for removal is still live on the sector thread.
     */
    private void dockInPlace(final User user, final Player player, final Sector sector,
                             final PlayerShip playerShip)
    {
        playerShip.getSpaceObjectState().setDocking(true);
        user.send(this.gameWriter.writeDockingDelay(0f));
        // Enqueue only; the sector thread drains it on its next tick. Safe from this thread.
        sector.getSpaceObjectRemover().notifyRemovingCauseAdded(playerShip, RemovingCause.Dock);

        final Location location = player.getLocation();
        final long sectorId = location.getSectorID();
        // Alpha Ceti and Tartalon are the two CICs; everything else docks to an outpost.
        location.changeState(sectorId == 0 || sectorId == 6
                ? new CICLocation(location)
                : new OutpostLocation(location));
        final SceneProtocol sceneProtocol = user.getProtocol(ProtocolID.Scene);
        sceneProtocol.sendLoadNextScene();

        log.info("Capital rental expired for {}, docking in sector {} before the hull goes back",
                user.getUserLogSimple(), sectorId);
    }

    private void clearRentalRecord(final Player player, final long rentalGuid)
    {
        player.getCounterFacade().setCounter(rentalGuid, 0);
        player.getCounterFacade().setCounter(CapitalRental.RETURN_SLOT_COUNTER, 0);
        this.rentalRegistry.clear(player.getUserID());
        this.drainObserved.remove(player.getUserID());
    }

    private HangarShip findRentalHull(final Hangar hangar)
    {
        for (final HangarShip hangarShip : hangar.getAllHangarShips())
        {
            if (CapitalRental.isRental(hangarShip.getCardGuid()))
                return hangarShip;
        }
        return null;
    }

    /** The recorded hull if it is still there, otherwise the best one left - never the rental. */
    private int pickReturnSlot(final Player player, final Hangar hangar,
                               final CapitalRentalRegistry.Rental tracked, final int rentalSlot)
    {
        final int recorded = tracked != null
                ? tracked.returnSlot()
                : (int) counterValue(player, CapitalRental.RETURN_SLOT_COUNTER);
        if (recorded > 0 && recorded != rentalSlot && hangar.getByServerId(recorded) != null)
            return recorded;

        HangarShip best = null;
        for (final HangarShip hangarShip : hangar.getAllHangarShips())
        {
            if (hangarShip.getServerId() == rentalSlot || CapitalRental.isRental(hangarShip.getCardGuid()))
                continue;
            if (best == null || hangarShip.getShipCard().getTier() > best.getShipCard().getTier())
                best = hangarShip;
        }
        return best == null ? -1 : best.getServerId();
    }

    private long counterValue(final Player player, final long counterGuid)
    {
        final CounterDesc desc = player.getCounterFacade().counters()
                .getInternalReadOnly().get(counterGuid);
        return desc == null ? 0L : desc.getLongValue();
    }
}
