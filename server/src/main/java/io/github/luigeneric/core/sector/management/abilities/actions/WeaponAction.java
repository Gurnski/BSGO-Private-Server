package io.github.luigeneric.core.sector.management.abilities.actions;



import io.github.luigeneric.binaryreaderwriter.BgoProtocolWriter;
import io.github.luigeneric.core.movement.MovementOptions;
import io.github.luigeneric.core.player.container.ShipSlot;
import io.github.luigeneric.core.protocols.ProtocolRegistryWriteOnly;
import io.github.luigeneric.core.protocols.game.GameProtocolWriteOnly;
import io.github.luigeneric.core.sector.creation.SectorContext;
import io.github.luigeneric.core.sector.management.SectorAlgorithms;
import io.github.luigeneric.core.sector.management.damage.DamageMediator;
import io.github.luigeneric.core.spaceentities.Ship;
import io.github.luigeneric.core.spaceentities.SpaceObject;
import io.github.luigeneric.enums.Faction;
import io.github.luigeneric.enums.Gear;
import io.github.luigeneric.enums.SpaceEntityType;
import io.github.luigeneric.enums.WeaponFxType;
import io.github.luigeneric.linearalgebra.base.Transform;
import io.github.luigeneric.linearalgebra.base.Vector3;
import io.github.luigeneric.linearalgebra.utility.Algorithm3D;
import io.github.luigeneric.templates.utils.ObjectStat;
import io.github.luigeneric.templates.utils.SpotDesc;
import io.github.luigeneric.utils.BgoRandom;

import java.util.List;
import java.util.Optional;

public abstract class WeaponAction extends AbilityAction
{
    protected SpotDesc spotDesc;
    protected WeaponFxType weaponFxType;
    protected final BgoRandom bgoRandom;
    protected final SectorAlgorithms sectorAlgorithms;
    protected final DamageMediator damageMediator;

    protected WeaponAction(Ship castingShip, ShipSlot castingSlot, List<SpaceObject> targetSpaceObjects, boolean isAutoCastAbility,
                           SectorContext ctx,
                           WeaponFxType weaponFxType, final SectorAlgorithms sectorAlgorithms,
                           final DamageMediator damageMediator)
    {
        super(castingShip, castingSlot, targetSpaceObjects, isAutoCastAbility, ctx);
        this.weaponFxType = weaponFxType;
        this.bgoRandom = ctx.bgoRandom();
        this.sectorAlgorithms = sectorAlgorithms;
        this.damageMediator = damageMediator;
    }


    @Override
    protected boolean preFun()
    {
        final boolean rv = super.preFun();
        if (!rv)
            return false;
        final Optional<SpotDesc> optSpotDesc = this.castingShip.getWorldCard().getSpot(this.getSpotHash());
        if (optSpotDesc.isEmpty())
            return false;
        this.spotDesc = optSpotDesc.get();
        return true;
    }

    protected int getSpotHash()
    {
        return this.castingSlot.getShipSlotCard().getObjectPointServerHash();
    }

    protected boolean targetSizeSatisfied(final int targetSize)
    {
        return this.targetSpaceObjects.size() == targetSize;
    }

    /** Angle 0 means "no arc limit" to Algorithm3D.isInsideAngle - the station override below. */
    private static final float ANGLE_UNRESTRICTED = 0f;

    protected boolean isShipWeaponInRange(final SpaceObject target)
    {
        final Transform casterTransform = castingShip.getMovementController().getTransform();
        final Transform spotTransform = spotDesc.getLocalTransform();
        final Vector3 targetPos = target.getMovementController().getPosition();

        final float minRange = this.ability.getItemBuffAdd().getStatOrDefault(ObjectStat.MinRange);
        final float maxRange = this.ability.getItemBuffAdd().getStatOrDefault(ObjectStat.MaxRange);
        final float angle = isStation(castingShip)
                ? ANGLE_UNRESTRICTED
                : this.ability.getItemBuffAdd().getStatOrDefault(ObjectStat.Angle);

        return Algorithm3D.isWeaponPositionInRange(casterTransform, spotTransform, targetPos, minRange, maxRange, angle);
    }

    /**
     * Outposts and weapon platforms shoot in every direction; everything else obeys its firing arc.
     * <p>
     * An arc is a statement about a hull that can TURN. A ship whose gun will not bear swings the
     * gun onto the target, and the arc is what makes that manoeuvre matter. A station cannot: it is
     * pinned to one heading for its whole life, so its arcs stop being a tactical constraint and
     * become a permanent blind spot at a fixed compass bearing - approach an outpost from the right
     * quarter and part of its battery can never answer, no matter what either of you does.
     * <p>
     * The outpost battery makes that concrete. Its cannons carry Angle 180 and its point defence
     * 360, so both already cover everything; the four missile launchers carry 90, and their
     * hardpoints sit three to starboard and one to port. Every launcher can therefore engage a
     * hemisphere, but only ever ONE hemisphere - a target to port drew a single launcher while
     * three sat idle facing the wrong way, which is why an outpost never seemed to fire all four.
     * The stations they are modelled on have traversing turrets; the mounts are where the muzzle
     * flash renders, not the direction the gun is welded.
     * <p>
     * Range still applies, hit chance still applies, and nothing here touches ships - a capital's
     * broadside is still a broadside, because a capital can turn to bring it to bear.
     */
    private static boolean isStation(final SpaceObject caster)
    {
        return caster.getSpaceEntityType() == SpaceEntityType.Outpost
                || caster.getSpaceEntityType() == SpaceEntityType.WeaponPlatform;
    }

    protected boolean isHitByWeapon(final SpaceObject target)
    {
        final var targetStats = target.getSpaceSubscribeInfo();
        final MovementOptions targetMovementOptions = target.getMovementController().getCurrentManeuver().getMovementOptions();


        final float accuracy = ability.getItemBuffAdd().getStatOrDefault(ObjectStat.Accuracy);
        final float optRange = ability.getItemBuffAdd().getStatOrDefault(ObjectStat.OptimalRange);
        final float maxRange = ability.getItemBuffAdd().getStatOrDefault(ObjectStat.MaxRange);

        final float targetAvoidance = targetStats.getStatOrDefault(ObjectStat.Avoidance);
        final float targetThrottle = targetMovementOptions.getThrottleSpeed();
        final float targetMaxSpeedWithoutBoost = targetStats.getStatOrDefault(ObjectStat.Speed);
        final Gear targetGear = targetMovementOptions.getGear();
        final float avoidanceFading = targetStats.getStatOrDefault(ObjectStat.AvoidanceFading);


        final float cleanedAvoidance = this.sectorAlgorithms.getHitchanceCalculator().getAvoidanceBasedOnSpeed(
                targetAvoidance,
                targetThrottle,
                targetMaxSpeedWithoutBoost,
                targetGear,
                avoidanceFading
        );


        final Vector3 weaponPosition = Algorithm3D.getPointPositionRelativeTo(spotDesc.getLocalPosition(),
                castingShip.getMovementController().getPosition(), castingShip.getMovementController().getRotation());
        final float distance = Vector3.distance(weaponPosition, target.getMovementController().getPosition());

        final float hitChance = this.sectorAlgorithms
                .getHitchanceCalculator().getChanceToHit(cleanedAvoidance, accuracy, maxRange, optRange, distance);
        return this.bgoRandom.rollChance(hitChance);
    }

    protected void sendWeaponShot(final int weaponHash, final SpaceObject target)
    {
        if (target != null)
        {
            if (target.getFaction() != Faction.Neutral)
            {
                castingShip.getSpaceSubscribeInfo().setLastCombatTime(this.startTimeStamp);
            }
            target.getSpaceSubscribeInfo().setLastCombatTime(this.startTimeStamp);
        }

        if (weaponFxType == WeaponFxType.MissileLauncher)
            return;

        final GameProtocolWriteOnly gameProtocolWriteOnly = ProtocolRegistryWriteOnly.game();


        final long targetID = target != null ? target.getObjectID() : 0;
        final BgoProtocolWriter weaponShopBw =
                gameProtocolWriteOnly.writeWeaponShot(castingShip.getObjectID(), weaponHash, targetID, weaponFxType);


        ctx.sender().sendToAllClients(weaponShopBw);
    }
}
