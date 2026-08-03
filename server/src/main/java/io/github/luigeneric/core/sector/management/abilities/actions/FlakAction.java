package io.github.luigeneric.core.sector.management.abilities.actions;



import io.github.luigeneric.core.player.container.ShipSlot;
import io.github.luigeneric.core.sector.creation.SectorContext;
import io.github.luigeneric.core.sector.management.SectorAlgorithms;
import io.github.luigeneric.core.sector.management.damage.DamageMediator;
import io.github.luigeneric.core.spaceentities.Ship;
import io.github.luigeneric.core.spaceentities.SpaceObject;
import io.github.luigeneric.enums.WeaponFxType;
import io.github.luigeneric.templates.utils.ShipSlotType;

import java.util.List;

public class FlakAction extends AoEAction
{
    public FlakAction(Ship castingShip, ShipSlot castingSlot, List<SpaceObject> targetSpaceObjects,
                      boolean isAutoCastAbility, SectorContext ctx,
                      SectorAlgorithms sectorAlgorithms, DamageMediator damageMediator)
    {
        super(castingShip, castingSlot, targetSpaceObjects, isAutoCastAbility, ctx, flakFxFor(castingSlot), sectorAlgorithms, damageMediator);
    }

    /* The client renders flak-type weapons with different prefabs and the fx byte in the shot
     * message is the only thing that picks between them (Weaponry.CreateWeapon):
     * Fx/Guns/ShrapnelGun fires a shotgun-style pellet burst, Fx/Flak/{Faction}Flak is the
     * escort screen puff. The carriers' shrapnel burst is the one Flak-type ability that lives
     * in a gun bay - every flak screen sits in a weapon or defensive_weapon bay - so the slot
     * type is the discriminator. Sent as plain Flak, the shrapnel burst renders as a flak puff. */
    private static WeaponFxType flakFxFor(final ShipSlot castingSlot)
    {
        final boolean isGunBay = castingSlot.getShipSystem() != null
                && castingSlot.getShipSystem().getShipSystemCard() != null
                && castingSlot.getShipSystem().getShipSystemCard().getShipSlotType() == ShipSlotType.gun;
        return isGunBay ? WeaponFxType.Shrapnel : WeaponFxType.Flak;
    }

    @Override
    protected boolean internalProcess()
    {
        return this.dealAoEDmg();
    }
}
