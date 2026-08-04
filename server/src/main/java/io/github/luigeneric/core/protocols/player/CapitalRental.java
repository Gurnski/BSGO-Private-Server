package io.github.luigeneric.core.protocols.player;

import io.github.luigeneric.core.galaxy.Galaxy;
import io.github.luigeneric.core.player.HangarShip;
import io.github.luigeneric.core.player.container.ShipSlot;
import io.github.luigeneric.core.player.container.ShipSlots;
import io.github.luigeneric.enums.Faction;
import io.github.luigeneric.templates.cards.ShipSlotCard;
import io.github.luigeneric.templates.shipitems.ShipSystem;
import io.github.luigeneric.templates.utils.ShipSlotType;

/**
 * The Pegasus and Basestar are rented, never owned: 20,000 tokens buys one hour, cheaper the
 * less of the map your faction holds, cheapest when the enemy holds most of it and you don't.
 * The underdog flying a battlestar is the fun case, so the discount points that way.
 *
 * Expiry rides in the player's counters keyed by the ship card guid - no schema change, and it
 * persists like any other counter. Enforcement is live: CapitalRentalExpiry sweeps connected
 * players, docks whoever is still flying one back to their home CIC and hands the hull back with
 * ServerMessage.RemoveShip. The hangar load in SqLiteProvider stays as the offline backstop for
 * rentals that ran out while the player was away.
 *
 * Counters.injectOldCounters drops a counter whose guid has no Counter card, so the expiry only
 * survives a relog because CounterCardType carries capital_rental_* entries at these same guids
 * and cards.js emits a Counter card per entry. CapitalRentalRegistry remains the live in-memory
 * authority; the counter is what makes the clock outlive a restart.
 */
public final class CapitalRental
{
    public static final long PEGASUS = 5017L;
    public static final long BASESTAR = 5117L;
    /* The fleet flagships - a step above the Pegasus/Basestar pair and, unlike them, never
     * flyable in the original. They rent exactly the same way; isRental below is what keeps them
     * off the purchase path, since a rental hull ships with an empty BuyPrice. */
    public static final long GALACTICA = 5019L;
    public static final long GUARDIAN = 5119L;

    /** The hourly capital for a faction: index 0 is the Pegasus tier, index 1 the flagship. */
    public static long forFaction(final Faction faction, final boolean flagship)
    {
        if (faction == Faction.Colonial)
            return flagship ? GALACTICA : PEGASUS;
        return flagship ? GUARDIAN : BASESTAR;
    }
    /** Shop items-tab passes; buying one starts the rental instead of delivering an item. */
    public static final long PASS_PEGASUS = 5020L;
    public static final long PASS_BASESTAR = 5120L;
    /* A rented hull MUST sit at serverID == its card's HangarID. That is not a convention, it is
     * how the client finds it: ShipCard.GetHangarShip scans the hangar for
     * "HangarID == ship.ServerID", and the hangar window lights a flagship's variant button only
     * when Game.Me.Hangar[variantHangarID] resolves. An offset slot is a ship the client can
     * never see or command - which is what a paid-for Pegasus was, parked at slot 47 while every
     * lookup asked for 18. The collision this offset existed to dodge is gone now that the
     * capitals hold a HangarID of their own instead of sharing 17 with the stealth hulls. */
    public static final int SERVER_ID_OFFSET = 0;
    public static final long BASE_PRICE = 20_000L;
    public static final long FLOOR_PRICE = 2_000L;
    public static final long DURATION_SECONDS = 3600L;
    /* The hangar slot the pilot flew before the rental, so expiry can put them back in it.
     * CounterCardType.capital_rental_return_slot carries the same 234; change either only
     * together with the other. Kept literal because javac inlines static final primitives and
     * this file is meant to be the only use site. */
    public static final long RETURN_SLOT_COUNTER = 234L;

    private CapitalRental()
    {
    }

    public static boolean isRental(final long shipGuid)
    {
        return shipGuid == PEGASUS || shipGuid == BASESTAR
                || shipGuid == GALACTICA || shipGuid == GUARDIAN;
    }

    public static boolean isPass(final long itemGuid)
    {
        return itemGuid == PASS_PEGASUS || itemGuid == PASS_BASESTAR;
    }

    public static long capitalForPass(final long passGuid)
    {
        return passGuid == PASS_PEGASUS ? PEGASUS : BASESTAR;
    }

    /* The stock loadout. A rental is an hour of a battlestar, not an hour of a hull the pilot then
     * has to find 720k tylium of tier-4 hardware for, so it arrives armed. These four are the only
     * tier-4 systems whose SlotType matches a capital bay; all are Neutral, so the same three arm
     * both factions and the Colonial/Cylon pair stays identical without a second table.
     * Private on purpose: javac inlines static final primitives at the use site, and keeping the
     * only use sites in this file means changing a guid can never need a clean build. */
    private static final long CAPSHIP_CANNON = 6031L;
    private static final long CAPSHIP_POINT_DEFENCE = 6032L;
    private static final long CAPSHIP_LAUNCHER = 6034L;

    /** 0 for a bay that gets nothing - the flagships' paint slot, and anything added later. */
    private static long systemForSlot(final ShipSlotType slotType)
    {
        return switch (slotType)
        {
            case gun -> CAPSHIP_CANNON;
            case launcher -> CAPSHIP_LAUNCHER;
            /* Flak (6033) is deliberately left on the shelf: it is the paid alternative to point
             * defence and is the only reason the two defensive bays are a choice at all. */
            case defensive_weapon -> CAPSHIP_POINT_DEFENCE;
            default -> 0L;
        };
    }

    /**
     * Fills a rented capital's empty weapon bays. The HangarShip constructor has already built one
     * empty ShipSlot per ShipSlotCard, so the slots are fetched and filled rather than added - that
     * keeps the ShipSlots map keyed by slotId, which is what the client and ShipBindings both index
     * by. ShipSlot.addShipItem preserves the slot's serverID and builds the ShipAbility from the
     * system's first ability card; without that ability the bay fires nothing and gets no turret.
     *
     * No consumable is seeded. All four capital ability cards (71002031-34) carry
     * ConsumableOption NotUsing, so AbilityAction.checkConsumablesSatisfied short-circuits before
     * it ever reads the Hold and FireMissileAction falls back to the built-in round. Seeding one
     * would only make the client draw an ammo counter for rounds nothing spends.
     *
     * Arming the HangarShip arms the ship in space too: SpaceObjectFactory.createPlayerShip hands
     * the active HangarShip's SpaceSubscribeInfo straight to the PlayerShip, and that instance
     * holds this same ShipSlots object.
     *
     * Idempotent - an already-fitted bay is left alone, so this is safe to re-run on a hull whose
     * loadout came back from the database.
     */
    public static void arm(final HangarShip hangarShip)
    {
        if (!isRental(hangarShip.getCardGuid()))
            return;

        final ShipSlots slots = hangarShip.getShipSlots();
        for (final ShipSlotCard slotCard : hangarShip.getShipCard().getShipSlotCards())
        {
            final long systemGuid = systemForSlot(slotCard.getShipSlotType());
            if (systemGuid == 0)
                continue;

            // null when the hull's level is below the slot card's - not the case for the capitals,
            // but HangarShip drops such slots and getSlot is the only honest way to find out.
            final ShipSlot slot = slots.getSlot(slotCard.getSlotId());
            if (slot == null)
                continue;

            final ShipSystem fitted = slot.getShipSystem();
            if (fitted != null && fitted.getShipSystemCard() != null)
                continue;

            slot.addShipItem(ShipSystem.fromGUID(systemGuid));
        }
        // Slot systems can carry StaticBuffs/MultiplyBuffs; re-run before max HP/PP are read.
        hangarShip.getShipStats().applyStats();
    }

    public static long priceFor(final Faction faction, final Galaxy galaxy)
    {
        final int[] counts = galaxy.countOutposts();
        final float own = faction == Faction.Colonial ? counts[0] : counts[1];
        final float enemy = faction == Faction.Colonial ? counts[1] : counts[0];
        final float capable = counts[2];
        float price = BASE_PRICE * (0.2f + 0.8f * (own / capable));
        if (enemy / capable > 0.5f && own < enemy)
        {
            price *= 0.5f;
        }
        return Math.max(FLOOR_PRICE, Math.round(price));
    }
}
