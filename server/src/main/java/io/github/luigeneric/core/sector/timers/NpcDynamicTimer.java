package io.github.luigeneric.core.sector.timers;

import io.github.luigeneric.core.movement.Maneuver;
import io.github.luigeneric.core.movement.MovementOptions;
import io.github.luigeneric.core.movement.maneuver.DirectionalManeuver;
import io.github.luigeneric.core.movement.maneuver.DirectionalWithoutRollManeuver;
import io.github.luigeneric.core.player.ShipAbility;
import io.github.luigeneric.core.player.container.ShipSlot;
import io.github.luigeneric.core.player.container.ShipSlots;
import io.github.luigeneric.core.sector.SectorCards;
import io.github.luigeneric.core.sector.Tick;
import io.github.luigeneric.core.sector.management.ISpaceObjectRemover;
import io.github.luigeneric.core.sector.management.SectorSpaceObjects;
import io.github.luigeneric.core.sector.management.abilities.AbilityCastRequestQueue;
import io.github.luigeneric.core.sector.management.damage.SectorDamageHistory;
import io.github.luigeneric.core.sector.npcbehaviour.KillObjective;
import io.github.luigeneric.core.sector.npcbehaviour.PatrolObjective;
import io.github.luigeneric.core.spaceentities.NpcShip;
import io.github.luigeneric.core.spaceentities.PlayerShip;
import io.github.luigeneric.core.spaceentities.SpaceObject;
import io.github.luigeneric.enums.ManeuverType;
import io.github.luigeneric.enums.RemovingCause;
import io.github.luigeneric.enums.SpaceEntityType;
import io.github.luigeneric.linearalgebra.base.Euler3;
import io.github.luigeneric.linearalgebra.base.Quaternion;
import io.github.luigeneric.linearalgebra.base.StaticVectors;
import io.github.luigeneric.linearalgebra.base.Vector3;
import io.github.luigeneric.templates.utils.ObjectStat;
import io.github.luigeneric.templates.utils.ShipAbilityAffect;
import io.github.luigeneric.templates.utils.SpotDesc;
import io.github.luigeneric.utils.BgoRandom;
import lombok.extern.slf4j.Slf4j;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
@Slf4j
public class NpcDynamicTimer extends NpcTimer
{
    private final ISpaceObjectRemover remover;
    private final BgoRandom bgoRandom;
    public NpcDynamicTimer(final Tick tick, final SectorSpaceObjects sectorSpaceObjects, final long delayedTicks,
                           final AbilityCastRequestQueue abilityCastRequestQueue,
                           final SectorDamageHistory sectorDamageHistory,
                           final ISpaceObjectRemover remover,
                           final SectorCards sectorCards,
                           final BgoRandom bgoRandom

    )
    {
        super(tick, sectorSpaceObjects, delayedTicks, abilityCastRequestQueue, sectorDamageHistory, sectorCards);
        this.remover = remover;
        this.bgoRandom = bgoRandom;
    }

    @Override
    protected void delayedUpdate()
    {
        final Collection<NpcShip> movingBotFighterMovings = this.sectorSpaceObjects.getSpaceObjectsCollectionOfEntityType(SpaceEntityType.BotFighter);
        for (final NpcShip botFighterMoving : movingBotFighterMovings)
        {
            final boolean jumpedOut = jumpOutNpcIfNoMoreTargets(botFighterMoving);
            if (jumpedOut)
                continue;

            //update target
            final SpaceObject closest = getNextTarget(botFighterMoving);
            if (closest == null && botFighterMoving.getPatrolObjectives().isEmpty())
                continue;

            //update weapons, does nothing if closest is null
            updateWeapons(botFighterMoving, closest);

            //update current maneuver based on closest possible target or environment checkup(is inside box)
            if (closest == null)
            {
                updateBotManeuver(botFighterMoving);
            } else
            {
                updateBotManeuver(botFighterMoving, closest);
            }
        }
    }

    /**
     * Updates the movement based on the patrol information if one is present
     * If one patrol-objective is present, takes the first and checks if the fighter is inside the given environment.
     * If so, do nothing, if the bot left the box, it should direct back to the center!
     * @param npcShip the BotFighter object to move
     */
    public void updateBotManeuver(final NpcShip npcShip)
    {
        /* LEVELLING RUNS BEFORE THE PATROL CHECK, and that ordering is the fix.
         *
         * It used to sit below the `patrolObjectives.isEmpty()` return, so the one thing every
         * out-of-combat ship needs was reachable only by ships that happen to carry a patrol box.
         * Anything else - and, now that capitals bank hard through their broadside turns, anything
         * that has just finished a fight - kept whatever attitude its last attack vector left it
         * in, forever. A capital parked at 40 degrees of bank is what "spawned in sideways" looks
         * like from another ship. */
        levelOut(npcShip);

        final List<PatrolObjective> patrolObjectives = npcShip.getPatrolObjectives();
        if (patrolObjectives.isEmpty())
            return;
        final PatrolObjective patrolObjective = patrolObjectives.get(0);
        if (patrolObjective == null)
        {
            log.error("inside NpcDynamicTimer: PatrolObjective was null, therefore returned out of update movement");
            return;
        }

        final MovementOptions movementOptions = npcShip.getMovementController().getMovementOptions();
        if (movementOptions.getSpeed() == 0)
        {
            final float speed = npcShip.getSpaceSubscribeInfo().getStatOrDefault(ObjectStat.Speed);
            movementOptions.setSpeed(speed);
            movementOptions.setThrottleSpeed(speed);
        }

        final boolean isInsideBox = patrolObjective.isInsideBox(npcShip.getMovementController().getPosition());
        if (isInsideBox)
            return;
        //final Euler3 directionToCenter = patrolObjective.getDirectionToCenter(botFighter.getMovementController().getPosition());
        //botFighter.getMovementController().setNextManeuver(new DirectionalManeuver(directionToCenter));
        //different approach -> random position inside the box!
        final Vector3 targetVector3 =
                new Vector3(
                        bgoRandom.getInsideVectors(patrolObjective.getBoxToPatrolIn().min().toArray(),
                                patrolObjective.getBoxToPatrolIn().max().toArray()
                        )
                );
        final Euler3 directionToRandomPosition = Euler3.direction(targetVector3.sub(npcShip.getMovementController().getPosition()));
        npcShip.getMovementController().setNextManeuver(new DirectionalManeuver(directionToRandomPosition));
    }
    public void updateBotManeuver(final NpcShip botFighterMoving, final SpaceObject closest)
    {
        final Vector3 botPosition = botFighterMoving.getMovementController().getPosition();

        final float closestDistance = closest.getMovementController().getPosition().distance(botPosition);
        final Euler3 bearing = Euler3.direction(Vector3.sub(closest.getMovementController().getPosition(), botPosition));
        final Euler3 direction = broadsideSteering(botFighterMoving, bearing);
        final boolean isDirectionWithRoll = tick.getValue() % 5 == 0;
        final Maneuver newManeuver = isDirectionWithRoll ? new DirectionalManeuver(direction) : new DirectionalWithoutRollManeuver(direction);
        botFighterMoving.getMovementController().setNextManeuver(newManeuver);

        /* Speed to 0 when close enough - but the "target almost standing" clause only applies to
         * PLAYER targets. Against a player it exists so a bot never parks next to someone who is
         * merely throttled down for a moment; between two NPCs it could never be true while both
         * chased, so a pair of hostile bots (two spawned capitals, most visibly) drove into each
         * other by construction, forever - pure pursuit has no other brake and ship-x-ship contact
         * deals no damage, just the reactive collision pulse. An NPC target holds at
         * speedZeroDistance unconditionally; the pair squares up and shells each other instead. */
        final boolean targetHoldsStill = !(closest instanceof PlayerShip)
                || closest.getMovementController().getFrame().getLinearSpeed().magnitude() < 5f;
        final float speed = closestDistance < botFighterMoving.getNpcBehaviourTemplate().speedZeroDistance()
                && targetHoldsStill ?
                0 :
                botFighterMoving.getSpaceSubscribeInfo().getStatOrDefault(ObjectStat.Speed);

        botFighterMoving.getMovementController().getMovementOptions().setSpeed(speed);
        botFighterMoving.getMovementController().getMovementOptions().setThrottleSpeed(speed);
    }

    /**
     * Bring an out-of-combat ship back to level flight, keeping its heading.
     * <p>
     * Two ways a tilt used to linger: a bot resuming from Rest re-applied its FULL current facing
     * (pitch and bank included), and a bot whose target died keeps flying its last attack vector
     * until something else moves it - with a +-700 m lair box and boss Speed 12, effectively
     * forever. Capitals now add a third, because a broadside turn banks them a long way over and
     * the turn stops the instant the target does.
     * <p>
     * Heading is deliberately preserved: yawing a ship back to some canonical bearing would look
     * like it flinched. Pitch and bank go to zero and nothing else changes, and once level the
     * condition goes false so nothing re-broadcasts.
     */
    private void levelOut(final NpcShip npcShip)
    {
        final boolean resting = npcShip.getMovementController().getCurrentManeuver() == null ||
                npcShip.getMovementController().getCurrentManeuver().getManeuverType() == ManeuverType.Rest;
        final Euler3 facing = Euler3.fromQuaternion(npcShip.getMovementController().getRotation());
        final float pitchDeg = normaliseDegrees(facing.pitch());
        final float rollDeg = normaliseDegrees(facing.getRoll());
        if (resting || Math.abs(pitchDeg) > 10f || Math.abs(rollDeg) > 10f)
        {
            npcShip.getMovementController().setNextManeuver(
                    new DirectionalManeuver(new Euler3(0f, facing.yaw(), 0f)));
        }
    }

    /* ---------------------------------------------------------------- broadside steering
     *
     * A capital's guns are welded to its flanks. All six capital cannons sit abeam - three at +90
     * degrees yaw, three at -90 - and now that they carry a real firing arc (65 degrees deviation,
     * see CAPITAL_WEAPONS in cards.js) a hull pointed at its target has its entire main battery
     * blind. Pure pursuit, which is what every NPC did, is therefore the one heading from which a
     * capital cannot shoot; before the arc existed it was merely nonsense to watch, because at 180
     * degrees the guns fired through the hull and it hit like a wall of bricks regardless.
     *
     * So capitals turn beam-on and circle instead. Fighters and everything else are untouched -
     * their guns are on the nose, and pursuit is exactly right for them. */

    /** Yaw offset that puts the target on the beam. */
    private static final float BROADSIDE_YAW = 90f;
    /** Decided per hull, not per ship: it is a property of the hull's guns and their mounts. */
    private static final Map<Long, Boolean> BROADSIDE_HULLS = new ConcurrentHashMap<>();

    /**
     * Heading for this pass: the bearing to the target for a nose-armed hull, or the beam for a
     * broadside one.
     * <p>
     * Which side is whichever is the shorter turn from the current heading, so a capital settles
     * onto the nearer beam and stays there rather than flip-flopping across the target every time
     * the geometry crosses over. The result is a slow circle at whatever range the pursuit logic
     * below already holds, with the battery bearing throughout.
     */
    private Euler3 broadsideSteering(final NpcShip npcShip, final Euler3 bearing)
    {
        if (!isBroadsideHull(npcShip))
            return bearing;

        final float currentYaw = Euler3.fromQuaternion(npcShip.getMovementController().getRotation()).yaw();
        final float left = normaliseDegrees(bearing.yaw() - BROADSIDE_YAW - currentYaw);
        final float right = normaliseDegrees(bearing.yaw() + BROADSIDE_YAW - currentYaw);
        final float chosenYaw = Math.abs(left) <= Math.abs(right)
                ? bearing.yaw() - BROADSIDE_YAW
                : bearing.yaw() + BROADSIDE_YAW;

        /* Pitch is dropped on purpose. Rolling a capital onto its side to bring guns up at a
         * fighter above it would be correct and looks absurd on a hull this size; the beam is a
         * horizontal manoeuvre, and the vertical component is left to the arc's own generosity. */
        return new Euler3(0f, normaliseDegrees(chosenYaw), 0f);
    }

    /**
     * Whether most of this hull's main guns are BLIND straight ahead.
     * <p>
     * This asks the firing check's own question, and that is the whole point. The first version of
     * this asked a different one - "are most gun mounts more than 45 degrees off the nose" - which
     * sounds equivalent and is not, because a mount's rotation is a RENDER transform: it orients
     * the muzzle flash, and almost every hull in the game stores its guns at 90 degrees regardless
     * of where they actually shoot. Fighters, escorts and capitals alike came back "broadside", so
     * every NPC in the sector began circling its target instead of chasing it, and banked
     * permanently because it never stopped turning.
     * <p>
     * What actually decides whether a hull must turn to fight is the mount angle MEASURED AGAINST
     * THAT WEAPON'S OWN ARC - exactly the comparison Algorithm3D.isInsideAngle performs when the
     * shot is taken. A fighter's guns sit at 90 degrees with a 90 degree arc and so bear dead
     * ahead, on the boundary; a capital's sit at 90 with a 65 degree arc and cannot. Asking the
     * question this way, the answer cannot disagree with what the guns will actually do.
     * <p>
     * Area weapons are excluded: flak and point defence are hemispherical sweeps that hold no
     * opinion about which way the hull points, and counting them would drown out the main battery.
     */
    private boolean isBroadsideHull(final NpcShip npcShip)
    {
        return BROADSIDE_HULLS.computeIfAbsent(npcShip.getShipCard().getCardGuid(), guid ->
        {
            final Optional<ShipSlots> optSlots = npcShip.getSpaceSubscribeInfo().getShipSlots();
            if (optSlots.isEmpty())
                return false;

            int bearsAhead = 0;
            int blindAhead = 0;
            for (final ShipSlot slot : optSlots.get().values())
            {
                if (slot.getShipSystem() == null || slot.getShipSystem().getCardGuid() == 0)
                    continue;
                final ShipAbility ability = slot.getShipAbility();
                if (ability == null || ability.getShipAbilityCard() == null)
                    continue;
                if (ability.getShipAbilityCard().getShipAbilityAffect() == ShipAbilityAffect.Area)
                    continue;
                final Optional<SpotDesc> optSpot =
                        npcShip.getWorldCard().getSpot(slot.getShipSlotCard().getObjectPointServerHash());
                if (optSpot.isEmpty())
                    continue;

                final Vector3 mountForward =
                        Quaternion.mult(optSpot.get().getLocalTransform().getRotation(), StaticVectors.FORWARD);
                final float mountOffNose = Vector3.angle(StaticVectors.FORWARD, mountForward);
                final float arc = ability.getItemBuffAdd().getStatOrDefault(ObjectStat.Angle);
                // arc 0 is "no limit" to isInsideAngle, so such a gun always bears
                if (arc == 0f || mountOffNose <= arc)
                    bearsAhead++;
                else
                    blindAhead++;
            }
            return blindAhead > bearsAhead;
        });
    }

    /** Fold an angle into -180..180 so "shorter turn" comparisons mean what they say. */
    private static float normaliseDegrees(final float degrees)
    {
        return ((degrees % 360f) + 540f) % 360f - 180f;
    }

    private boolean jumpOutNpcIfNoMoreTargets(final NpcShip botFighterMoving)
    {
        //if the kill objective is gone, jump this npc out
        final List<KillObjective> killObjectives = botFighterMoving.getKillObjectives();
        final boolean allKillObjectivesGone = killObjectives
                .stream()
                .allMatch(
                        obj -> obj.getObjectivesToKill()
                                .stream()
                                .allMatch(spaceObject -> spaceObject.getRemovingCause().isPresent()));


        final long lifeTimeEndTimeStamp =
                (long) (botFighterMoving.getNpcBehaviourTemplate().lifeTimeSeconds() * 1000L + botFighterMoving.getCreatingTimeStamp());
        final boolean lifeTimeIsOver = (lifeTimeEndTimeStamp - tick.getTimeStamp()) < 0;
        final boolean botFighterIsInCombat = botFighterMoving.getSpaceSubscribeInfo().isInCombat();

        //all targets have to be gone AND
        //  lifetime over AND
        //      not in combat OR
        //      bot is allowed to jump out
        if (allKillObjectivesGone &&
                lifeTimeIsOver && (!botFighterIsInCombat || botFighterMoving.getNpcBehaviourTemplate().jumpOutIfInCombat()))
        {
            remover.notifyRemovingCauseAdded(botFighterMoving, RemovingCause.JumpOut);
            return true;
        }

        return false;
    }
}
