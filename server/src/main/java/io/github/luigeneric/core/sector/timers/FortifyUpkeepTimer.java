package io.github.luigeneric.core.sector.timers;

import io.github.luigeneric.core.sector.Tick;
import io.github.luigeneric.core.sector.management.SectorSpaceObjects;
import io.github.luigeneric.core.sector.management.abilities.actions.FortifyAction;
import io.github.luigeneric.core.spaceentities.PlayerShip;
import io.github.luigeneric.core.spaceentities.SpaceObject;
import io.github.luigeneric.enums.SpaceEntityType;
import io.github.luigeneric.templates.utils.AbilityActionType;
import io.github.luigeneric.templates.utils.ObjectStat;
import lombok.extern.slf4j.Slf4j;

/**
 * Outpost Mode's running cost. The ability charges 550 power to engage and then PpCostPerSec every
 * second it stays engaged, which is the whole reason a carrier cannot simply live as a fortress:
 * a ship that runs its reserves dry drops out of the mode on its own.
 *
 * Runs once a second like the other cost timers. Reading the rate off the live modifier rather
 * than the card means an upgraded system charges its own upgraded rate with no table here.
 */
@Slf4j
public class FortifyUpkeepTimer extends DelayedTimer
{
    public FortifyUpkeepTimer(final Tick tick, final SectorSpaceObjects sectorSpaceObjects, final long delayedTicks)
    {
        super(tick, sectorSpaceObjects, delayedTicks);
    }

    @Override
    protected void delayedUpdate()
    {
        for (final SpaceObject spaceObject : sectorSpaceObjects.getSpaceObjectsOfEntityType(SpaceEntityType.Player))
        {
            if (spaceObject.isRemoved() || !spaceObject.getSpaceObjectState().getIsFortified())
                continue;
            if (!(spaceObject instanceof PlayerShip playerShip))
                continue;

            final var stats = playerShip.getSpaceSubscribeInfo();
            final float costPerSecond = stats.getModifiers()
                    .flatMap(mods -> mods.getOfTypeStream(AbilityActionType.Fortify).findFirst())
                    .map(mod -> mod.getItemBuffAdd().getStatOrDefault(ObjectStat.PpCostPerSec))
                    .orElse(0f);

            /* No modifier, or a free one: the state bit and the modifier have come apart, which
             * should not happen - release rather than leave a fortress nothing is paying for. */
            if (costPerSecond <= 0f)
            {
                log.warn("fortified ship {} has no upkeep-bearing Fortify modifier - releasing",
                        playerShip.getObjectID());
                FortifyAction.unfortify(playerShip);
                continue;
            }

            if (stats.getPp() < costPerSecond)
            {
                FortifyAction.unfortify(playerShip);
                continue;
            }
            stats.setPp(stats.getPp() - costPerSecond);
        }
    }
}
