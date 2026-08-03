package io.github.luigeneric.core.protocols.player;

import io.github.luigeneric.core.galaxy.Galaxy;
import io.github.luigeneric.enums.Faction;

/**
 * The Pegasus and Basestar are rented, never owned: 20,000 tokens buys one hour, cheaper the
 * less of the map your faction holds, cheapest when the enemy holds most of it and you don't.
 * The underdog flying a battlestar is the fun case, so the discount points that way.
 *
 * Expiry rides in the player's counters keyed by the ship card guid - no schema change, and it
 * persists like any other counter. It is enforced when the hangar loads at login, because the
 * protocol has no server-to-client remove-ship message: a rented capital survives until relog,
 * and that is a documented limit rather than a bug.
 */
public final class CapitalRental
{
    public static final long PEGASUS = 5017L;
    public static final long BASESTAR = 5117L;
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

    private CapitalRental()
    {
    }

    public static boolean isRental(final long shipGuid)
    {
        return shipGuid == PEGASUS || shipGuid == BASESTAR;
    }

    public static boolean isPass(final long itemGuid)
    {
        return itemGuid == PASS_PEGASUS || itemGuid == PASS_BASESTAR;
    }

    public static long capitalForPass(final long passGuid)
    {
        return passGuid == PASS_PEGASUS ? PEGASUS : BASESTAR;
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
