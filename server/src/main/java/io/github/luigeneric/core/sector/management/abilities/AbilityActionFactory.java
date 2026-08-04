package io.github.luigeneric.core.sector.management.abilities;


import io.github.luigeneric.core.player.container.ShipSlot;
import io.github.luigeneric.core.sector.creation.SectorContext;
import io.github.luigeneric.core.sector.management.SectorAlgorithms;
import io.github.luigeneric.core.sector.management.SectorJoinQueue;
import io.github.luigeneric.core.sector.management.abilities.actions.*;
import io.github.luigeneric.core.sector.management.damage.DamageMediator;
import io.github.luigeneric.core.sector.management.lootsystem.loot.LootAssociations;
import io.github.luigeneric.core.spaceentities.Ship;
import io.github.luigeneric.core.spaceentities.SpaceObject;
import io.github.luigeneric.enums.WeaponFxType;
import io.github.luigeneric.templates.utils.AbilityActionType;

import java.util.List;

public class AbilityActionFactory
{
    private final SectorContext ctx;
    private final SectorAlgorithms sectorAlgorithms;
    private final DamageMediator damageMediator;
    private final SectorJoinQueue joinQueue;
    private final LootAssociations lootAssociations;

    public AbilityActionFactory(final SectorContext ctx,
                                final SectorAlgorithms sectorAlgorithms, final DamageMediator damageMediator,
                                final SectorJoinQueue joinQueue,
                                final LootAssociations lootAssociations)
    {
        this.ctx = ctx;
        this.sectorAlgorithms = sectorAlgorithms;
        this.damageMediator = damageMediator;
        this.joinQueue = joinQueue;
        this.lootAssociations = lootAssociations;
    }
    public AbilityAction create(final Ship castingShip, final ShipSlot castingSlot,
                                final List<SpaceObject> targetSpaceObjects, final boolean isAutocastAbility)
    {
        final AbilityActionType type  = castingSlot.getShipAbility().getShipAbilityCard().getAbilityActionType();
        switch (type)
        {
            case Slide ->
            {
                return new SlideAction(castingShip, castingSlot, targetSpaceObjects, isAutocastAbility, ctx);
            }
            case Buff ->
            {
                return new BuffAction(castingShip, castingSlot, targetSpaceObjects, isAutocastAbility, ctx);
            }
            case Debuff ->
            {
                return new DeBuffAction(castingShip, castingSlot, targetSpaceObjects, isAutocastAbility, ctx, sectorAlgorithms.getEwDurationAlgorithm());
            }
            case ActivatePaintTheTarget ->
            {
                return new ActivatePaintTheTargetAction(castingShip, castingSlot, targetSpaceObjects, isAutocastAbility, ctx, sectorAlgorithms.getEwDurationAlgorithm());
            }
            case DropFlare ->
            {
                return new DropFlareAction(castingShip, castingSlot, targetSpaceObjects, isAutocastAbility, ctx, sectorAlgorithms);
            }
            case DeflectMissile ->
            {
                return new DeflectMissileAction(castingShip, castingSlot, targetSpaceObjects, isAutocastAbility, ctx);
            }
            case ResourceScan ->
            {
                return new ResourceScanAction(castingShip, castingSlot, targetSpaceObjects, isAutocastAbility, ctx, lootAssociations);
            }
            case RestoreBuff ->
            {
                return new RestoreBuffAction(castingShip, castingSlot, targetSpaceObjects, isAutocastAbility, ctx);
            }
            /* FireHeavyMissile and FireLightMissile are the live game's own names for a launcher's
             * guided projectile and need nothing FireMissle does not already do: their ability cards
             * carry Speed, MaxHullPoints, LifeTime and the six rotation stats, which is exactly the
             * projectile stat set FireMissileAction reads back out when it spawns the missile.
             * FireLightMissile has no user today - its only family in the card dump is the Rocket
             * Pack, which is dropped for having all six rotation stats at 0 - and is wired up here
             * anyway so that fixing the pack is a card change with no server change behind it.
             * Leaving a type out is not a no-op: create's default arm throws, the throw escapes
             * AbilityCastRequestQueue.run into Sector.run's per-tick catch, and the rest of that
             * tick is abandoned for every player in the sector. On a Launch: Auto weapon that
             * repeats every frame. */
            case FireMissle, FireTorpedo, FireHeavyMissile, FireLightMissile ->
            {
                return new FireMissileAction(castingShip, castingSlot, targetSpaceObjects, isAutocastAbility,
                        ctx, sectorAlgorithms, damageMediator, joinQueue);
            }
            /* Three more hitscan guns. Their abilities carry only Accuracy, Angle, DamageLow/High,
             * Min/Optimal/MaxRange, Cooldown and PowerPointCost - no projectile stats at all - so
             * they resolve through FireCannonAction's roll-to-hit-then-deal-damage path unchanged.
             * The weapon FX is a different story: the fx byte in the shot message is the ONLY
             * thing that selects the client's tracer prefab (Weaponry.CreateWeapon), and the
             * client keeps a dedicated one per type - Fx/Guns/{Faction}SmallMachineGun with its
             * own sound player for the machine-gun family, Fx/Guns/{Faction}SmallFlechetteCannon
             * for the flechette cannon. Dispatched as plain Gun they all render as a standard
             * cannon bolt, which is how the stealth machine gun and the assault KKC shipped
             * looking like long single pulses. The KKC takes MachineGun: it is the assault
             * ships' rapid kinetic gun and no KillCannon prefab exists in the client. */
            case FireCannon ->
            {
                return new FireCannonAction(castingShip, castingSlot, targetSpaceObjects, isAutocastAbility,
                        ctx, sectorAlgorithms, damageMediator);
            }
            case FireMachineGun, FireKillCannon ->
            {
                return new FireCannonAction(castingShip, castingSlot, targetSpaceObjects, isAutocastAbility,
                        ctx, sectorAlgorithms, damageMediator, WeaponFxType.MachineGun);
            }
            case FireShotgun ->
            {
                return new FireCannonAction(castingShip, castingSlot, targetSpaceObjects, isAutocastAbility,
                        ctx, sectorAlgorithms, damageMediator, WeaponFxType.Flechete);
            }
            case FireMining ->
            {
                return new FireMiningAction(castingShip, castingSlot, targetSpaceObjects, isAutocastAbility,
                        ctx, sectorAlgorithms, damageMediator);
            }
            case Flak ->
            {
                return new FlakAction(castingShip, castingSlot, targetSpaceObjects, isAutocastAbility, ctx, sectorAlgorithms, damageMediator);
            }
            case PointDefence ->
            {
                return new PointDefenseAction(castingShip, castingSlot, targetSpaceObjects, isAutocastAbility, ctx, sectorAlgorithms, damageMediator);
            }
            // Outpost Mode. Also what un-drops the card family: gen-systems-real.js reads the
            // case arms in this file to decide which dump systems are safe to emit.
            case Fortify ->
            {
                return new FortifyAction(castingShip, castingSlot, targetSpaceObjects, isAutocastAbility, ctx);
            }
            default -> throw new IllegalArgumentException("AbilityActionType " + type + " not implemented!");
        }
    }
}
