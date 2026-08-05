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
import io.github.luigeneric.templates.utils.ShipAbilityAffect;
import lombok.extern.slf4j.Slf4j;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.function.Predicate;
import java.util.stream.Collectors;

@Slf4j
public abstract class NpcTimer extends DelayedTimer
{
    /** Object types an NPC's weapons may ever be handed. Deliberately NOT
     *  SpaceEntityType.getShipTypes(): that array includes JumpBeacon and AsteroidBot.
     *  Missile and Mine are the entire point of the Area sweep in updateWeapons. */
    protected static final SpaceEntityType[] NPC_TARGETABLE_TYPES = {
            SpaceEntityType.Player,
            SpaceEntityType.BotFighter,
            SpaceEntityType.Cruiser,
            SpaceEntityType.MiningShip,
            SpaceEntityType.Outpost,
            SpaceEntityType.WeaponPlatform,
            SpaceEntityType.Missile,
            SpaceEntityType.Mine
    };

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
            if (slot.getShipSystem().getCardGuid() == 0)
                continue;
            /* Flak and point defence are SWEEPS, not aimed weapons. A player's client hands
             * them every object in range (ShipAbility.GetObjectsWithinAOE); the server-side
             * action re-checks range, arc and hit chance per id it was given and touches
             * nothing else. Handing an NPC's sweep only the one closest SHIP is why NPC flak
             * never damaged a missile: the missile ids simply were not in the request. Area
             * casts get the full enemy set instead - and they get it on EVERY weapons pass,
             * because a missile launched mid-fight has to enter the list while the fight is
             * still on (addAutoCastAbility is a keyed put, so re-registering is free, and
             * cooldowns live on the ShipSystem, untouched). */
            if (slot.getShipAbility().getShipAbilityCard().getShipAbilityAffect() == ShipAbilityAffect.Area)
            {
                this.abilityCastRequestQueue.addAutoCastAbility(new AbilityCastRequest(
                        ship,
                        slot.getShipSystem().getServerID(),
                        true,
                        getAllEnemyObjectIds(ship, obj -> true)));
            }
            else
            {
                this.abilityCastRequestQueue.addAutoCastAbility(new AbilityCastRequest(
                        ship,
                        slot.getShipSystem().getServerID(),
                        true,
                        closest.getObjectID()));
            }
        }
    }

    protected Set<Long> getAllEnemyObjectIds(final Ship me, final Predicate<SpaceObject> predicate)
    {
        return this.sectorSpaceObjects.values().stream()
                .filter(obj -> obj.getSpaceEntityType().isOfType(NPC_TARGETABLE_TYPES))
                .filter(obj -> RelationUtil.getRelation(obj, me,
                        sectorCards.regulationCard().getTargetBracketMode()) == Relation.Enemy)
                .filter(predicate)
                .map(SpaceObject::getObjectID)
                .collect(Collectors.toSet());
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
                .filter(spaceObject -> !isNpcVersusStation(against, spaceObject))
                .filter(spaceObject ->
                {
                    final Relation relation =
                            RelationUtil.getRelation(spaceObject, against, sectorCards.regulationCard().getTargetBracketMode());
                    return relation == Relation.Enemy;
                })
                .toList();
    }

    /**
     * Whether this pairing is an NPC and an enemy station, in either order.
     * <p>
     * Neither may START a fight with the other. This is an ACQUISITION rule only: it is applied
     * where auto-aggro picks a target out of the sector, and nowhere else. Retaliation is untouched
     * - getTargetFromDamageHistory reads the damage history, so anything that shoots a station is
     * still shot back at, and a player who opens fire on an outpost gets the full battery. Weapons
     * are untouched too: NPC_TARGETABLE_TYPES still lists both station types, so once a station IS
     * the target the guns fire normally.
     * <p>
     * The reason is attrition with nobody watching. A station acquires anything hostile that drifts
     * into 3,500 m and holds the target out to 4,000; a roaming bot returns fire; and the ring
     * platforms are the part that dies, because they have a fraction of the outpost's hull. Every
     * wave of NPC spawns in a contested system was therefore grinding the ring down on a timer that
     * runs whether or not a single player is online - and the ring only rebuilds on a control-level
     * change, so the losses accumulated across a whole night and the operator logged in to outposts
     * standing bare. Two NPC factions shelling each other's furniture is not the conquest mechanic
     * doing its job; it is a background process deleting content.
     * <p>
     * Players are deliberately not covered. Taking an outpost apart is supposed to be something a
     * PERSON does, and it still costs the ring exactly what it always did.
     */
    private static boolean isNpcVersusStation(final SpaceObject a, final SpaceObject b)
    {
        return (isStationType(a) && isMobileNpcType(b)) || (isMobileNpcType(a) && isStationType(b));
    }

    private static boolean isStationType(final SpaceObject obj)
    {
        return obj.getSpaceEntityType() == SpaceEntityType.Outpost
                || obj.getSpaceEntityType() == SpaceEntityType.WeaponPlatform;
    }

    private static boolean isMobileNpcType(final SpaceObject obj)
    {
        return obj.getSpaceEntityType() == SpaceEntityType.BotFighter
                || obj.getSpaceEntityType() == SpaceEntityType.Cruiser;
    }
}
