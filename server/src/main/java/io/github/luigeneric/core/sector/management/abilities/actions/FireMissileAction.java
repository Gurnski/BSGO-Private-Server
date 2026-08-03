package io.github.luigeneric.core.sector.management.abilities.actions;

import io.github.luigeneric.core.movement.maneuver.TargetLaunchManeuver;
import io.github.luigeneric.core.player.container.ShipSlot;
import io.github.luigeneric.core.sector.creation.SectorContext;
import io.github.luigeneric.core.sector.management.SectorAlgorithms;
import io.github.luigeneric.core.sector.management.SectorJoinQueue;
import io.github.luigeneric.core.sector.management.damage.DamageMediator;
import io.github.luigeneric.core.spaceentities.Ship;
import io.github.luigeneric.core.spaceentities.SpaceObject;
import io.github.luigeneric.enums.Gear;
import io.github.luigeneric.enums.StaticCardGUID;
import io.github.luigeneric.enums.WeaponFxType;
import io.github.luigeneric.templates.cards.ShipConsumableCard;
import io.github.luigeneric.templates.shipitems.ShipConsumable;
import io.github.luigeneric.templates.utils.ConsumableEffectType;
import io.github.luigeneric.templates.utils.ObjectStat;
import io.github.luigeneric.templates.utils.ObjectStats;
import io.github.luigeneric.templates.utils.ShipConsumableOption;
import lombok.extern.slf4j.Slf4j;

import java.util.List;
import java.util.Objects;

@Slf4j
public class FireMissileAction extends WeaponAction
{
    private final SectorJoinQueue sectorJoinQueue;
    public FireMissileAction(final Ship castingShip, ShipSlot castingSlot, List<SpaceObject> targetSpaceObjects,
                             boolean isAutoCastAbility, SectorContext ctx, SectorAlgorithms sectorAlgorithms,
                             DamageMediator damageMediator, final SectorJoinQueue joinQueue)
    {
        super(castingShip, castingSlot, targetSpaceObjects, isAutoCastAbility, ctx,
                WeaponFxType.MissileLauncher, sectorAlgorithms, damageMediator);
        this.sectorJoinQueue = joinQueue;
    }

    @Override
    protected boolean internalProcess()
    {
        final boolean isTargetSizeOkay = this.targetSizeSatisfied(1);
        if (!isTargetSizeOkay)
            return false;

        final SpaceObject target = targetSpaceObjects.getFirst();
        if (target.isRemoved())
        {
            return false;
        }
        final boolean isShipWeaponInRange = this.isShipWeaponInRange(target);
        if (!isShipWeaponInRange)
        {
            return false;
        }

        final boolean useConsumable = ability.getShipAbilityCard().getShipConsumableOption() == ShipConsumableOption.Using;
        final long missileGUID = getMissileGUID(useConsumable);
        if (missileGUID == -1)
            return false;

        final SpaceObject missile = this.ctx.spaceObjectFactory()
                .createMissile(castingShip, target, spotDesc, missileGUID, startTimeStamp);

        final ObjectStats missileStats = missile.getSpaceSubscribeInfo().getStats();
        missileStats.put(ability.getItemBuffAdd());
        /* A warhead may bring its own hull points (nukes are tougher than standard rounds, and
         * the launcher's MaxHullPoints describes its standard round). Card field, not
         * ItemBuffAdd: a consumable's ItemBuffAdd is a fractional multiplier and would scale
         * the launcher's value instead of replacing it. */
        if (useConsumable)
        {
            final ShipConsumableCard warhead = castingSlot.getCurrentConsumable().getShipConsumableCard();
            if (warhead != null && warhead.getMissileHullPoints() > 0f)
                missileStats.setStat(ObjectStat.MaxHullPoints, warhead.getMissileHullPoints());
        }
        missile.getMovementController().getMovementOptions().setGear(Gear.Regular);
        missile.getMovementController().getMovementOptions().setThrottleSpeed(missileStats.getStat(ObjectStat.Speed));
        /* setMaxHpPp reads MaxHullPoints/MaxPowerPoints with getStatOrDefault, so nothing else is
         * needed here. The old explicit setHp unboxed a nullable Float, and the old
         * MaxPowerPoints=0 made the stat PRESENT, which a client that selects the missile renders
         * as a NaN power bar (BlueLevel = 0/0). Absent reads as no power, cleanly. */
        missile.getSpaceSubscribeInfo().setMaxHpPp();

        final boolean gearIsSlide = castingShip.getMovementController().getMovementOptions().getGear() == Gear.RCS;
        final float relativeSpeed = gearIsSlide ? castingShip.getMovementController().getFrame().getLinearSpeed().magnitude() * 0.5f : 0;
        final TargetLaunchManeuver targetLaunchManeuver =
                new TargetLaunchManeuver(castingShip, spotDesc, relativeSpeed, target);
        missile.getMovementController().setNextManeuver(targetLaunchManeuver);

        this.sectorJoinQueue.addSpaceObject(missile);
        sendWeaponShot(this.getSpotHash(), target);

        return true;
    }

    private long getMissileGUID(final boolean useConsumable)
    {
        final ShipConsumable currentConsumable = castingSlot.getCurrentConsumable();
        final ShipConsumableCard shipConsumableCard = currentConsumable.getShipConsumableCard();
        if (shipConsumableCard == null && useConsumable)
        {
            log.error("FireMissileAction: ShipConsumableCard for missile was null");
            return -1;
        }


        //This must be the biggest shitcode I've ever wrote because I cant find first fucking property into these cards that tells me if its mini
        // or normal nuke
        long missileGUID = 0;
        if (!useConsumable)
        {
            missileGUID = StaticCardGUID.MissileCard.getValue();
        }
        else
        {
            if (Objects.requireNonNull(shipConsumableCard.getEffectType()) == ConsumableEffectType.DamageNuclear)
            {
                if (shipConsumableCard.getItemBuffAdd().containsStat(ObjectStat.DamageHigh))
                {
                    final float dmgHigh = shipConsumableCard.getItemBuffAdd().getStat(ObjectStat.DamageHigh);
                    if (dmgHigh == 4.0)
                    {
                        missileGUID = StaticCardGUID.MissileMiniNuke.getValue();
                    }
                    if (dmgHigh == 19.0)
                    {
                        missileGUID = StaticCardGUID.MissileNuke.getValue();
                    }
                }
                else
                {
                    missileGUID = StaticCardGUID.MissileTorpedo.getValue();
                }
            } else
            {
                missileGUID = StaticCardGUID.MissileCard.getValue();
            }
        }

        if (missileGUID == 0)
        {
            /* The DamageNuclear branch only recognises DamageHigh 4.0 and 19.0, so any other
             * nuclear countable falls out of it with the guid still 0 - the three mines that carry
             * DamageHigh 0.3 do exactly that. SpaceObjectFactory.createMissile throws on a card guid
             * it cannot resolve, and that throw escapes into Sector.run's per-tick catch and
             * abandons the rest of the tick for everyone in the sector. It is reachable on purpose,
             * too: PlayerProtocol's SelectConsumable validates neither ConsumableType nor Tier, so a
             * crafted packet can seat a mine in a missile slot and then hold the fire button.
             * Fire an ordinary missile rather than take the sector down with us. */
            log.warn("FireMissileAction: no missile card matched consumable {}, firing the default missile",
                    shipConsumableCard != null ? shipConsumableCard.getCardGuid() : 0);
            missileGUID = StaticCardGUID.MissileCard.getValue();
        }

        return missileGUID;
    }
}


