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
    /** Object types a static defence (outpost/platform) may ever damage. Deliberately NOT
     *  SpaceEntityType.getShipTypes(): that array includes JumpBeacon and AsteroidBot. */
    private static final SpaceEntityType[] STATION_TARGETABLE_TYPES = {
            SpaceEntityType.Player,
            SpaceEntityType.BotFighter,
            SpaceEntityType.Cruiser,
            SpaceEntityType.MiningShip,
            SpaceEntityType.Outpost,
            SpaceEntityType.WeaponPlatform,
            SpaceEntityType.Missile,
            SpaceEntityType.Mine
    };
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
            //if no change in target, dont update all weapons all over again!
            //lastTarget may be null, closest aswell!
            if ((lastTarget == null && closest == null) || closest != null && closest.equals(lastTarget))
            {
                continue;
            }
            lastTargets.put(npcShip.getObjectID(), closest);
            //update weapons, does nothing if closest is null
            updateWeapons(npcShip, closest);
        }
    }


    @Override
    protected void updateWeapons(final Ship ship, final SpaceObject closest)
    {
        final Optional<ShipSlots> optSlots = ship.getSpaceSubscribeInfo().getShipSlots();
        if (optSlots.isEmpty())
            return;
        final ShipSlots slots = optSlots.get();
        for (final ShipSlot slot : slots.values())
        {
            if (closest == null)
            {
                this.abilityCastRequestQueue.removeAutoCastAbility(slot.getShipSystem().getServerID(), ship.getObjectID());
            }
            else
            {
                if (slot.getShipSystem().getCardGuid() != 0 &&
                        slot.getShipAbility().getShipAbilityCard().getShipAbilityAffect() == ShipAbilityAffect.Area)
                {
                    final Set<Long> allObjectIDs = getAllEnemyObjectIds(ship, spaceObject -> true);

                    final AbilityCastRequest abilityCastRequest = new AbilityCastRequest(
                            ship,
                            slot.getShipSystem().getServerID(),
                            true,
                            allObjectIDs);
                    this.abilityCastRequestQueue.addAutoCastAbility(abilityCastRequest);
                }
                else
                {
                    final AbilityCastRequest abilityCastRequest = new AbilityCastRequest(
                            ship,
                            slot.getShipSystem().getServerID(),
                            true,
                            closest.getObjectID());
                    this.abilityCastRequestQueue.addAutoCastAbility(abilityCastRequest);
                }
            }
        }
    }

    private Set<Long> getAllEnemyObjectIds(final Ship me, final Predicate<SpaceObject> predicate)
    {
        return this.sectorSpaceObjects.values().stream()
                .filter(obj -> obj.getSpaceEntityType().isOfType(STATION_TARGETABLE_TYPES))
                .filter(obj -> RelationUtil.getRelation(obj, me,
                        sectorCards.regulationCard().getTargetBracketMode()) == Relation.Enemy)
                .filter(predicate)
                .map(SpaceObject::getObjectID)
                .collect(Collectors.toSet());
    }
}
