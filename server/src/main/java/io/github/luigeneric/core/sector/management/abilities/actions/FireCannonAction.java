package io.github.luigeneric.core.sector.management.abilities.actions;

import io.github.luigeneric.core.player.container.ShipSlot;
import io.github.luigeneric.core.sector.creation.SectorContext;
import io.github.luigeneric.core.sector.management.SectorAlgorithms;
import io.github.luigeneric.core.sector.management.damage.DamageMediator;
import io.github.luigeneric.core.spaceentities.Ship;
import io.github.luigeneric.core.spaceentities.SpaceObject;
import io.github.luigeneric.enums.ShipRoleDeprecated;
import io.github.luigeneric.enums.WeaponFxType;
import io.github.luigeneric.templates.utils.AbilityActionType;
import io.github.luigeneric.templates.utils.ShipSlotType;

import java.util.List;

public class FireCannonAction extends WeaponAction
{

    public FireCannonAction(Ship castingShip, ShipSlot castingSlot, List<SpaceObject> targetSpaceObjects,
                               boolean isAutoCastAbility, SectorContext ctx, SectorAlgorithms sectorAlgorithms,
                               DamageMediator damageMediator)
    {
        this(castingShip, castingSlot, targetSpaceObjects, isAutoCastAbility, ctx, sectorAlgorithms, damageMediator,
                defaultFxFor(castingShip, castingSlot));
    }

    /* Plain cannons in a gun bay are the capital tracer cannons - the carriers' long-range CC,
     * the capship cannon and the stealth 20mm autocannon are the only FireCannon systems that
     * live in one - and in the live game they fired KKC-style tracer rounds, not the single
     * bolt the Gun fx draws. Which tracer depends on the hull, because the client sizes fx by
     * ship, not by weapon:
     *   - Mothership (Pegasus/Basestar): standard big bolts like any liner, just harder and
     *     further. Gun fx, whatever is bolted into their gun bays.
     *   - Carrier: "bigger KKC rounds". The client's MachineGun fx exists only as
     *     Fx/Guns/{Faction}SmallMachineGun and reads as a pea-shooter at capital scale
     *     (confirmed in a live test), so carriers take Railgun, whose tier-4 arm is the one
     *     capital-scale tracer round the client has (Fx/Guns/{Faction}XLargeRailgun).
     *   - Everything else with a gun bay (the stealth strikes): MachineGun.
     * Weapon-bay cannons keep the standard bolt, and upstream's OverwriteActionType ==
     * FireCannon hack still forces the railgun beam for hand-made cards that ask for it. */
    private static WeaponFxType defaultFxFor(final Ship castingShip, final ShipSlot castingSlot)
    {
        if (castingSlot.getShipAbility().getShipAbilityCard().getOverwriteActionType() == AbilityActionType.FireCannon)
            return WeaponFxType.Railgun;
        final boolean isGunBay = castingSlot.getShipSystem() != null
                && castingSlot.getShipSystem().getShipSystemCard() != null
                && castingSlot.getShipSystem().getShipSystemCard().getShipSlotType() == ShipSlotType.gun;
        if (!isGunBay)
            return WeaponFxType.Gun;
        final ShipRoleDeprecated role = castingShip.getShipCard() != null
                ? castingShip.getShipCard().getShipRoleDeprecated() : null;
        if (role == ShipRoleDeprecated.Mothership)
            return WeaponFxType.Gun;
        if (role == ShipRoleDeprecated.Carrier)
            return WeaponFxType.Railgun;
        return WeaponFxType.MachineGun;
    }

    /* The fx byte in the shot message is the only thing that picks the client's tracer prefab
     * (Weaponry.CreateWeapon), so the machine-gun and flechette hitscan types need to name their
     * own fx here rather than take the Gun default above. */
    public FireCannonAction(Ship castingShip, ShipSlot castingSlot, List<SpaceObject> targetSpaceObjects,
                               boolean isAutoCastAbility, SectorContext ctx, SectorAlgorithms sectorAlgorithms,
                               DamageMediator damageMediator, WeaponFxType weaponFxType)
    {
        super(castingShip, castingSlot, targetSpaceObjects, isAutoCastAbility, ctx,
                weaponFxType, sectorAlgorithms, damageMediator);
    }

    @Override
    protected boolean internalProcess()
    {
        final boolean isTargetSizeOkay = this.targetSizeSatisfied(1);
        if (!isTargetSizeOkay)
            return false;

        final SpaceObject target = targetSpaceObjects.get(0);
        if (target.isRemoved())
        {
            //Log.errorIn("Error! tried to shoot on dead Object: " + target.getObjectID());
            return false;
        }
        final boolean isShipWeaponInRange = this.isShipWeaponInRange(target);
        if (!isShipWeaponInRange)
        {
            return false;
        }

        final boolean isHit = this.isHitByWeapon(target);
        if (isHit)
        {
            this.damageMediator.dealDamageFromAbility(castingShip, target, ability);
        }
        sendWeaponShot(this.getSpotHash(), target);
        return true;
    }
}
