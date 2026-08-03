package io.github.luigeneric.core;

import io.quarkus.arc.Unremovable;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Live bookkeeping for capital rentals: when the hour runs out, and which hangar slot the pilot
 * flew before they took the flagship.
 *
 * The same two values are written to the player's counters so they can outlive a restart, but
 * Counters.injectOldCounters silently drops any counter whose guid has no Counter card and guids
 * 5017/5117 have none, so that write is a no-op today. Until those cards exist this map is the
 * only place a rental's expiry is actually recorded, which is why CapitalRentalExpiry reads here
 * first and only falls back to the counters.
 *
 * Keyed by userID rather than User, so a reconnect within the hour keeps its rental.
 */
/* @Unremovable is load-bearing, not decoration. Quarkus prunes beans it cannot see used at BUILD
 * time, and this one is only ever obtained through a runtime CDI.current().select() in
 * PlayerProtocol. CapitalRentalExpiry's @Scheduled happens to keep the chain alive today, but that
 * is coincidence: the last time the sweep was disabled the registry became build-time-unreferenced,
 * was pruned, and every rental attempt died with UnsatisfiedResolutionException - taking the
 * player's connection down with it. The annotation stays whatever the sweep does. */
@Unremovable
@ApplicationScoped
public class CapitalRentalRegistry
{
    /** @param returnSlot 0 when unknown - hangar ids start at 1. */
    public record Rental(long expirySeconds, int returnSlot)
    {
    }

    private final Map<Long, Rental> rentals = new ConcurrentHashMap<>();

    public void start(final long userId, final long expirySeconds, final int returnSlot)
    {
        this.rentals.put(userId, new Rental(expirySeconds, returnSlot));
    }

    /** Re-renting while the hull is still in the hangar only moves the clock; the slot recorded
     *  on the first rent has to survive, or expiry would try to hand the pilot back the capital. */
    public void extend(final long userId, final long expirySeconds)
    {
        this.rentals.compute(userId, (id, old) ->
                new Rental(expirySeconds, old == null ? 0 : old.returnSlot()));
    }

    public Rental get(final long userId)
    {
        return this.rentals.get(userId);
    }

    public void clear(final long userId)
    {
        this.rentals.remove(userId);
    }

    /** An entry for a pilot who has logged off is dead weight once its clock has run out - the
     *  hangar load in SqLiteProvider removes an expired hull before they can fly it again. Only
     *  expired entries are dropped, so an entry written a moment before its hull reaches the
     *  hangar is never mistaken for garbage. */
    public void pruneExpiredOffline(final Set<Long> connectedUserIds, final long nowSeconds)
    {
        this.rentals.entrySet().removeIf(entry ->
                entry.getValue().expirySeconds() <= nowSeconds && !connectedUserIds.contains(entry.getKey()));
    }
}
