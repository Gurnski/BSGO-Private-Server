package io.github.luigeneric.core.sector.management.abilities.actions;

import io.github.luigeneric.core.player.container.ShipSlot;
import io.github.luigeneric.core.sector.ShipModifier;
import io.github.luigeneric.core.sector.creation.SectorContext;
import io.github.luigeneric.core.spaceentities.PlayerShip;
import io.github.luigeneric.core.spaceentities.Ship;
import io.github.luigeneric.core.spaceentities.SpaceObject;
import io.github.luigeneric.enums.Gear;
import io.github.luigeneric.templates.cards.ShipAbilityCard;
import io.github.luigeneric.templates.utils.ObjectStat;
import io.github.luigeneric.templates.utils.ObjectStats;
import lombok.extern.slf4j.Slf4j;

import java.util.List;

/**
 * Outpost Mode - the carrier classes' role ability, ActionType Fortify.
 *
 * A toggle, not a cast: press once to become a fortress, press again to release. The card's
 * ToggleSystem stats are the whole design and this class only has to route them -
 * ToggleSystemMultiply {MetaPropulsion 0, FtlRange 0, MetaManeuverability 0.5} and
 * ToggleSystemAdd {ArmorValue, HullRecovery}. They travel as an ordinary ShipModifier, which is
 * what makes them show up in the client's buff list and, more importantly, what makes
 * applyStats() fold them into the live stat block the movement sim and the damage calculator
 * already read every tick. Nothing else needs teaching.
 *
 * MetaPropulsion and MetaManeuverability are the CARD's names for "engines" and "steering"; the
 * server's movement stats are Speed/BoostSpeed and the three rotation speeds, so they are mapped
 * here rather than plumbed as new stats nothing else reads.
 *
 * The upkeep drain lives in FortifyUpkeepTimer, and the cleanup that must survive death, docking
 * and disconnection lives in SpaceObjectRemover - a modifier on a HangarShip's stats outlives the
 * PlayerShip that carried it, so releasing it in exactly one place beats releasing it in five.
 */
@Slf4j
public class FortifyAction extends AbilityAction
{
    public FortifyAction(final Ship castingShip,
                         final ShipSlot castingSlot,
                         final List<SpaceObject> targetSpaceObjects,
                         final boolean isAutoCastAbility,
                         final SectorContext ctx)
    {
        super(castingShip, castingSlot, targetSpaceObjects, isAutoCastAbility, ctx);
    }

    /* Toggle-off deliberately bypasses preFun. Releasing must never be blocked by the 300-second
     * cooldown or by the power the ability costs to ENGAGE - a carrier that cannot un-fortify
     * because it is broke or on cooldown is a carrier the player has lost for five minutes. */
    @Override
    public void process()
    {
        if (!(castingShip instanceof PlayerShip))
        {
            log.warn("Fortify cast by a non-player ship {} - only players carry role slots",
                    castingShip.getObjectID());
            return;
        }

        if (castingShip.getSpaceObjectState().getIsFortified())
        {
            unfortify(castingShip);
            return;
        }
        super.process();
    }

    @Override
    protected boolean internalProcess()
    {
        final ShipAbilityCard card = ability.getShipAbilityCard();
        final ShipModifier modifier = ShipModifier.create(ability, system, startTimeStamp, castingShip.getPlayerId());

        /* ShipModifiers.checkTimeout unboxes Duration on EVERY modifier every tick, so a modifier
         * without one NPEs the timeout timer. A toggle has no duration by nature; a year stands in
         * for "until released", and the release paths are what actually end it. */
        modifier.getItemBuffAdd().setStat(ObjectStat.Duration, 31_536_000f);

        final ObjectStats toggleMultiply = card.getGetToggleSystemMultiply();
        final ObjectStats toggleAdd = card.getToggleSystemAdd();
        final ObjectStats modifierMultiply = modifier.getRemoteBuffMultiply();

        if (toggleMultiply.containsStat(ObjectStat.MetaPropulsion))
        {
            final float propulsion = toggleMultiply.getStat(ObjectStat.MetaPropulsion);
            modifierMultiply.setStat(ObjectStat.Speed, propulsion);
            modifierMultiply.setStat(ObjectStat.BoostSpeed, propulsion);
        }
        if (toggleMultiply.containsStat(ObjectStat.MetaManeuverability))
        {
            final float maneuverability = toggleMultiply.getStat(ObjectStat.MetaManeuverability);
            modifierMultiply.setStat(ObjectStat.TurnSpeed, maneuverability);
            modifierMultiply.setStat(ObjectStat.RollMaxSpeed, maneuverability);
        }
        /* FtlRange 0 is what refuses the jump: GameProtocol's jump path measures the hop against
         * this stat, so zero fails every distance without a fortify-specific branch anywhere. */
        if (toggleMultiply.containsStat(ObjectStat.FtlRange))
        {
            modifierMultiply.setStat(ObjectStat.FtlRange, toggleMultiply.getStat(ObjectStat.FtlRange));
        }
        modifier.getRemoteBuffAdd().setStats(toggleAdd);

        casterStats.addModifier(modifier);

        /* Zero the throttle as well as the stat. The multiplier caps what the hull MAY do; the
         * throttle is what it is currently asking for, and an unzeroed throttle leaves the sim
         * trying to accelerate against a zero ceiling. The hull still coasts down at its own
         * deceleration, which is the settling-into-position the fortress animation wants. */
        final var movementOptions = castingShip.getMovementController().getMovementOptions();
        movementOptions.setGear(Gear.Regular);
        movementOptions.setSpeedAndThrottle(0f);
        castingShip.getMovementController().setMovementOptionsNeedUpdate();

        castingShip.getSpaceObjectState().setFortified(true);
        casterStats.sendToggleBuff(system.getServerID(), card.getCardGuid(), true);

        log.info("Fortify ON for player {} ({})", castingShip.getPlayerId(), castingShip.getObjectID());
        return true;
    }

    /**
     * Release a fortified ship. Static and public because every path that takes a ship away from
     * its pilot - death, docking, jumping out, disconnecting - has to run it, and they all live
     * in SpaceObjectRemover rather than here.
     */
    public static void unfortify(final Ship ship)
    {
        final var stats = ship.getSpaceSubscribeInfo();
        stats.getModifiers().ifPresent(modifiers ->
        {
            final var fortifyModifiers = modifiers.getOfType(io.github.luigeneric.templates.utils.AbilityActionType.Fortify);
            if (fortifyModifiers.isEmpty())
                return;

            final var ids = new java.util.HashSet<Long>();
            fortifyModifiers.forEach(mod -> ids.add(mod.getServerID()));
            /* removeModifiers re-runs applyStats, which restores Speed, FtlRange and the armour
             * bonus in one step, and tells every subscriber to drop the buff icon. */
            stats.removeModifiers(ids);

            // Unlight the toolbar button on whichever slot carries the ability.
            fortifyModifiers.forEach(mod ->
                    stats.sendToggleBuff(mod.getShipSystem().getServerID(),
                            mod.getShipAbility().getShipAbilityCard().getCardGuid(), false));
        });

        if (ship.getSpaceObjectState().getIsFortified())
        {
            ship.getSpaceObjectState().setFortified(false);
            log.info("Fortify OFF for player {} ({})", ship.getPlayerId(), ship.getObjectID());
        }
        /* Throttle stays where it is - at zero. The pilot throttles back up themselves, which the
         * sim now allows because the Speed ceiling came back with the modifier removal. */
    }
}
