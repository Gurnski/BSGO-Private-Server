package io.github.luigeneric.core.sector.timers;

import io.github.luigeneric.core.player.container.ShipSlot;
import io.github.luigeneric.core.player.container.ShipSlots;
import io.github.luigeneric.core.sector.SectorCards;
import io.github.luigeneric.core.sector.Tick;
import io.github.luigeneric.core.sector.management.SectorSpaceObjects;
import io.github.luigeneric.core.sector.management.abilities.AbilityCastRequest;
import io.github.luigeneric.core.sector.management.abilities.AbilityCastRequestQueue;
import io.github.luigeneric.core.sector.management.damage.AccumulatedDamage;
import io.github.luigeneric.core.sector.management.damage.ObjectDamageHistory;
import io.github.luigeneric.core.sector.management.damage.SectorDamageHistory;
import io.github.luigeneric.core.sector.management.relation.Relation;
import io.github.luigeneric.core.sector.management.relation.RelationUtil;
import io.github.luigeneric.core.sector.npcbehaviour.KillObjective;
import io.github.luigeneric.core.sector.npcbehaviour.NpcObjective;
import io.github.luigeneric.core.sector.npcbehaviour.NpcObjectiveType;
import io.github.luigeneric.core.spaceentities.NpcShip;
import io.github.luigeneric.core.spaceentities.PlayerShip;
import io.github.luigeneric.core.spaceentities.Ship;
import io.github.luigeneric.core.spaceentities.SpaceObject;
import io.github.luigeneric.enums.SpaceEntityType;
import lombok.extern.slf4j.Slf4j;

import java.util.List;
import java.util.Optional;

@Slf4j
public abstract class NpcTimer extends DelayedTimer
{
    protected final AbilityCastRequestQueue abilityCastRequestQueue;
    protected final SectorDamageHistory sectorDamageHistory;
    protected final SectorCards sectorCards;

    public NpcTimer(final Tick tick, final SectorSpaceObjects sectorSpaceObjects, final long delayedTicks,
                    final AbilityCastRequestQueue abilityCastRequestQueue,
                    final SectorDamageHistory sectorDamageHistory,
                    final SectorCards sectorCards
    )
    {
        super(tick, sectorSpaceObjects, delayedTicks);
        this.abilityCastRequestQueue = abilityCastRequestQueue;
        this.sectorDamageHistory = sectorDamageHistory;
        this.sectorCards = sectorCards;
    }


    /** One unarmed-bot warning per sector per run; see updateWeapons. */
    private boolean reportedUnarmed = false;

    protected void updateWeapons(final Ship ship, final SpaceObject closest)
    {
        if (closest == null)
            return;
        final Optional<ShipSlots> optSlots = ship.getSpaceSubscribeInfo().getShipSlots();
        if (optSlots.isEmpty())
            return;
        final ShipSlots slots = optSlots.get();
        /* Unarmed bots are worth one warning per sector per server run, not one per bot per
         * acquisition: object ids repeat across sectors and bots respawn, which turned the
         * first version of this into a flood. It stays because "acquired but cannot shoot" is
         * exactly the silent failure that hid the config-level bug for so long. */
        if (!reportedUnarmed && slots.values().stream()
                .noneMatch(s -> s.getShipSystem().getShipSystemCard() != null))
        {
            reportedUnarmed = true;
            log.warn("npc {} acquired target {} but has ZERO armed slots - check its ShipConfigTemplate",
                    ship.getObjectID(), closest.getObjectID());
        }
        for (final ShipSlot slot : slots.values())
        {
            this.abilityCastRequestQueue.addAutoCastAbility(new AbilityCastRequest(
                    ship,
                    slot.getShipSystem().getServerID(),
                    true,
                    closest.getObjectID()));
        }
    }

    protected SpaceObject getTargetFromDamageHistory(final NpcShip botFighter)
    {
        SpaceObject target = null;
        final ObjectDamageHistory objectHistory = this.sectorDamageHistory.getDamageHistory(botFighter);
        final float maxAgroDistance = botFighter.getNpcBehaviourTemplate().maximumAggroDistance();
        final float maxAgroDistanceSq = maxAgroDistance * maxAgroDistance;
        //stage 1, get the one with the highest damage done

        Optional<AccumulatedDamage> highestDamageDone;
        boolean foundTarget = false;
        while (objectHistory != null &&
                (highestDamageDone = objectHistory.getHighestDamageDealer()).isPresent() &&
                highestDamageDone.get().getAccumulatedDamage() > 0 &&
                !foundTarget
        )
        {
            final SpaceObject dealer = highestDamageDone.get().getDealer();
            //the object is dead or jumped out -> remove target
            if (dealer.getRemovingCause().isPresent())
            {
                objectHistory.removeDamageDealer(highestDamageDone.get());
                continue;
            }

            final float distanceSq = botFighter.getMovementController().getPosition().distanceSq(dealer.getMovementController().getPosition());
            //target is out of range, invalidate target
            if (distanceSq > maxAgroDistanceSq)
            {
                objectHistory.removeDamageDealer(highestDamageDone.get());
                continue;
            }

            //the target is inside the sector and is inside the range
            foundTarget = true;
            target = dealer;
        }

        return target;
    }

    /**
     * Order:
     *  get highest damage dealer. if the highest damage dealer is out of range, remove it from damage-history and get the next best damage dealer
     *  get the objects and kill/defend/patrol
     *  get the next best enemy in range
     * @param npcShip
     * @return
     */
    protected SpaceObject getNextTarget(final NpcShip npcShip)
    {
        return getNextTarget(npcShip, null);
    }

    /**
     * Order:
     *  get highest damage dealer. if the highest damage dealer is out of range, remove it from damage-history and get the next best damage dealer
     *  keep the current target while it is still engageable (hysteresis up to maximumAggroDistance)
     *  get the next best enemy in auto aggro range
     *  get the objects and kill/defend/patrol
     * @param npcShip
     * @param currentTarget the target currently engaged by this npc, null if none
     * @return
     */
    protected SpaceObject getNextTarget(final NpcShip npcShip, final SpaceObject currentTarget)
    {
        SpaceObject target = getTargetFromDamageHistory(npcShip);
        if (target != null)
            return target;
        //retain the current target out to maximumAggroDistance even beyond autoAggroDistance
        if (isStillEngageable(npcShip, currentTarget))
            return currentTarget;
        //get the enemy in auto aggro distance
        target = getEnemyInAutoAgroDistance(npcShip);
        if (target != null)
            return target;

        if (npcShip.hasKillObjectives())
        {
            final Optional<NpcObjective> optObjective = npcShip.getNpcObjectives()
                    .stream().filter(objective -> objective.getType() == NpcObjectiveType.Kill).findAny();
            if (optObjective.isPresent())
            {
                /* Removed targets stay in the objective list (nothing prunes it), so without the
                 * filter an assassin whose mining ship just died re-acquires the corpse every pass
                 * for the rest of its lifetime - flying at nothing and enqueueing casts the queue
                 * then discards. Same retention rule isStillEngageable applies to live targets. */
                return ((KillObjective)optObjective.get()).getObjectivesToKill()
                        .stream().filter(o -> !o.isRemoved()).findFirst().orElse(null);
            }
        }
        return null;
    }

    private boolean isStillEngageable(final NpcShip npcShip, final SpaceObject currentTarget)
    {
        if (currentTarget == null || currentTarget.isRemoved())
            return false;
        if (currentTarget instanceof PlayerShip playerShip && !playerShip.isVisible())
            return false;
        final float maxAgroDistance = npcShip.getNpcBehaviourTemplate().maximumAggroDistance();
        final float distanceSq = npcShip.getMovementController().getPosition().distanceSq(currentTarget.getMovementController().getPosition());
        return distanceSq <= maxAgroDistance * maxAgroDistance;
    }

    protected SpaceObject getEnemyInAutoAgroDistance(final NpcShip botFighter)
    {
        SpaceObject target = null;
        final List<SpaceObject> potentialEnemyObjects = getPotentialEnemyObjects(botFighter);
        final float autoAgroDistance = botFighter.getNpcBehaviourTemplate().autoAggroDistance();
        final float autoAgroDistanceSq = autoAgroDistance * autoAgroDistance;
        float closest = Float.MAX_VALUE;
        for (final SpaceObject potentialEnemyObject : potentialEnemyObjects)
        {
            final float distanceSq =
                    botFighter.getMovementController().getPosition().distanceSq(potentialEnemyObject.getMovementController().getPosition());
            if (distanceSq < closest && distanceSq < autoAgroDistanceSq)
            {
                closest = distanceSq;
                target = potentialEnemyObject;
            }
        }
        return target;
    }

    protected List<SpaceObject> getPotentialEnemyObjects(final SpaceObject against)
    {
        return sectorSpaceObjects
                .getSpaceObjectsNotOfEntityType(
                        SpaceEntityType.Missile, SpaceEntityType.Planetoid, SpaceEntityType.Asteroid, SpaceEntityType.Planet)
                .stream()
                /* removed-but-still-mapped objects (death and map removal are in different tick
                 * phases) must not be acquired - matches isStillEngageable's retention rule */
                .filter(spaceObject -> !spaceObject.isRemoved())
                .filter(spaceObject ->
                {
                    if (spaceObject instanceof PlayerShip playerShip)
                    {
                        return playerShip.isVisible();
                    }
                    return true;
                })
                .filter(spaceObject ->
                {
                    final Relation relation =
                            RelationUtil.getRelation(spaceObject, against, sectorCards.regulationCard().getTargetBracketMode());
                    return relation == Relation.Enemy;
                })
                .toList();
    }
}
