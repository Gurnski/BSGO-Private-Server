package io.github.luigeneric.core.sector.timers;


import io.github.luigeneric.core.player.container.ShipSlot;
import io.github.luigeneric.core.player.container.ShipSlots;
import io.github.luigeneric.core.sector.SectorCards;
import io.github.luigeneric.core.sector.Tick;
import io.github.luigeneric.core.sector.management.SectorSpaceObjects;
import io.github.luigeneric.core.sector.management.abilities.AbilityCastRequest;
import io.github.luigeneric.core.sector.management.abilities.AbilityCastRequestQueue;
import io.github.luigeneric.core.sector.management.damage.SectorDamageHistory;
import io.github.luigeneric.core.sector.management.relation.Relation;
import io.github.luigeneric.core.sector.management.relation.RelationUtil;
import io.github.luigeneric.core.spaceentities.NpcShip;
import io.github.luigeneric.core.spaceentities.Ship;
import io.github.luigeneric.core.spaceentities.SpaceObject;
import io.github.luigeneric.enums.SpaceEntityType;
import io.github.luigeneric.templates.utils.ShipAbilityAffect;

import java.util.*;
import java.util.function.Predicate;
import java.util.stream.Collectors;

public class NpcStaticTimer extends NpcTimer
{
    private final Map<Long, SpaceObject> lastTargets;
    public NpcStaticTimer(final Tick tick, final SectorSpaceObjects sectorSpaceObjects, final long delay,
                          final AbilityCastRequestQueue abilityCastRequestQueue,
                          final SectorDamageHistory sectorDamageHistory,
                          final SectorCards sectorCards
    )
    {
        super(tick, sectorSpaceObjects, delay, abilityCastRequestQueue, sectorDamageHistory, sectorCards);
        this.lastTargets = new HashMap<>();
    }

    @Override
    protected void delayedUpdate()
    {
        final List<NpcShip> npcShips = sectorSpaceObjects.getSpaceObjectsOfEntityTypes(
                SpaceEntityType.WeaponPlatform,
                SpaceEntityType.Outpost
        );
        //prune cache entries for stations no longer in the sector, else destroyed-station
        //entries pin their last target for the sector's lifetime
        final Set<Long> liveStationIds = npcShips.stream().map(SpaceObject::getObjectID).collect(Collectors.toSet());
        lastTargets.keySet().retainAll(liveStationIds);
        for (final NpcShip npcShip : npcShips)
        {
            //a removed ship must not keep or re-register autocasts
            if (npcShip.isRemoved())
            {
                lastTargets.remove(npcShip.getObjectID());
                updateWeapons(npcShip, null);
                continue;
            }
            final SpaceObject lastTarget = lastTargets.get(npcShip.getObjectID());
            //update target, retaining the current one out to maximumAggroDistance
            final SpaceObject closest = getNextTarget(npcShip, lastTarget);
            /* The old "no change in target, dont update all weapons" skip starved the Area
             * sweeps: a station locked on the same capital for minutes kept the enemy-id list
             * from acquisition time, so every missile launched DURING the fight was invisible
             * to its flak - which read as "outpost flak never damages missiles". Skip only the
             * truly idle case; while a target exists, re-register every pass so the sweep list
             * stays current (keyed put, cooldowns untouched - see NpcTimer.updateWeapons). */
            if (lastTarget == null && closest == null)
            {
                continue;
            }
            lastTargets.put(npcShip.getObjectID(), closest);
            //update weapons, does nothing if closest is null
            updateWeapons(npcShip, closest);
        }
    }


    /* Arming and Area-sweep target lists live in NpcTimer.updateWeapons now, shared with the
     * moving bots - the sweep logic was born here and got hoisted when the bots turned out to
     * need it just as much. The one station-only behaviour left is deregistration: a station
     * whose target walked away must drop its auto-casts, where a moving bot keeps chasing. */
    @Override
    protected void updateWeapons(final Ship ship, final SpaceObject closest)
    {
        if (closest == null)
        {
            final Optional<ShipSlots> optSlots = ship.getSpaceSubscribeInfo().getShipSlots();
            if (optSlots.isEmpty())
                return;
            for (final ShipSlot slot : optSlots.get().values())
            {
                this.abilityCastRequestQueue.removeAutoCastAbility(slot.getShipSystem().getServerID(), ship.getObjectID());
            }
            return;
        }
        super.updateWeapons(ship, closest);
    }
}
