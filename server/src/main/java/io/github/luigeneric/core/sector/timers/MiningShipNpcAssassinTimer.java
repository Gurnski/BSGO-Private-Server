package io.github.luigeneric.core.sector.timers;

import io.github.luigeneric.core.sector.SpaceObjectFactory;
import io.github.luigeneric.core.sector.Tick;
import io.github.luigeneric.core.sector.creation.SectorContext;
import io.github.luigeneric.core.sector.management.SectorJoinQueue;
import io.github.luigeneric.core.sector.management.SectorSpaceObjects;
import io.github.luigeneric.core.spaceentities.MiningShip;
import io.github.luigeneric.core.spaceentities.SpaceObject;
import io.github.luigeneric.enums.SpaceEntityType;
import io.github.luigeneric.linearalgebra.base.Euler3;
import io.github.luigeneric.linearalgebra.base.Quaternion;
import io.github.luigeneric.linearalgebra.base.Transform;
import io.github.luigeneric.linearalgebra.base.Vector3;
import io.github.luigeneric.templates.npcbehaviour.NpcBehaviourTemplate;
import io.github.luigeneric.templates.sectortemplates.MiningShipConfig;
import io.github.luigeneric.templates.sectortemplates.NpcGuidLootId;
import io.github.luigeneric.utils.BgoRandom;

import java.time.Duration;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.List;

public class MiningShipNpcAssassinTimer extends DelayedTimer
{
    private final MiningShipConfig miningShipConfig;
    private final SpaceObjectFactory spaceObjectFactory;
    private final SectorJoinQueue joinQueue;
    private final BgoRandom bgoRandom;
    public MiningShipNpcAssassinTimer(final SectorContext ctx, final long delayedTicks,
                                      final MiningShipConfig miningShipConfig, final SpaceObjectFactory spaceObjectFactory,
                                      final SectorJoinQueue joinQueue)
    {
        super(ctx.tick(), ctx.spaceObjects(), delayedTicks);
        this.miningShipConfig = miningShipConfig;
        this.spaceObjectFactory = spaceObjectFactory;
        this.joinQueue = joinQueue;
        this.bgoRandom = ctx.bgoRandom();
    }

    @Override
    protected void delayedUpdate()
    {
        final List<MiningShip> miningShips = this.sectorSpaceObjects.getSpaceObjectsOfEntityType(SpaceEntityType.MiningShip);
        final long tickTimeStamp = tick.getTimeStamp();
        final long npcSpawnDelayMillis = miningShipConfig.secondsUntilNpcSpawns() * 1000L;
        final long initialSpawnDelayMillis = miningShipConfig.npcInitialSpawnDelaySeconds() * 1000L;
        for (final MiningShip miningShip : miningShips)
        {
            final long lastTimeAssassin = miningShip.getLastTimeAssassin();
            //there was no npc spawn ever
            if (lastTimeAssassin == 0)
            {
                miningShip.setLastTimeAssassin(tickTimeStamp + initialSpawnDelayMillis - npcSpawnDelayMillis);
                continue;
            }

            final long timeStampWhenNpcShouldSpawn = npcSpawnDelayMillis + lastTimeAssassin;
            final long diff = tickTimeStamp - timeStampWhenNpcShouldSpawn;
            if (diff < 0)
                continue;

            //get mining ship position
            final Transform miningTransform = miningShip.getMovementController().getTransform();

            //final SpaceObject newObj = this.spaceObjectFactory.createComet(23);
            //newObj.getMovementController().setNextManeuver(new RestManeuver(assassinTransform));
            final List<NpcGuidLootId> res =
                    Arrays.stream(miningShipConfig.npcGuidLootIds())
                            .filter(npcGuidLootId -> npcGuidLootId.faction() != miningShip.getFaction())
                            .toList();
            final NpcGuidLootId npcGuidLootId = this.bgoRandom.getRandomListMember(res);
            for (int i = 0; i < npcGuidLootId.count(); i++)
            {
                /* Offset must stay inside the 400 m auto-aggro radius: the old axis-stacked
                 * offsets reached 1000+ m out, where the bots never engaged and idled out their
                 * lifetime. Horizontal 150-330 m plus vertical <=100 m caps the total at ~345 m. */
                final Vector3 offset = Quaternion.euler(0f, bgoRandom.getRndBetween(0f, 360f), 0f)
                        .direction()
                        .mult(bgoRandom.getRndBetween(150f, 330f));
                final Vector3 assassinPos = Vector3.add(miningTransform.getPosition(), offset);
                assassinPos.addY(bgoRandom.getRndBetween(-100f, 100f));

                /* Face the mining ship (yaw only, level) instead of inheriting the mining spot's
                 * rotation - that one carries the planetoid surface tilt, which left assassins
                 * frozen at a visibly wrong pitch/roll. */
                final float yawToMiningShip = Euler3.direction(
                        Vector3.sub(miningTransform.getPosition(), assassinPos)).yaw();
                final Transform assassinTransform =
                        new Transform(assassinPos, Quaternion.euler(0f, yawToMiningShip, 0f));

                final SpaceObject newAssassin = this.spaceObjectFactory.createBotFighter(
                        npcGuidLootId.npcGUID(),
                        List.of(miningShip),
                        List.of(),
                        List.of(),
                        assassinTransform,
                        new NpcBehaviourTemplate(
                                1,
                                400,
                                2500,
                                15,
                                false,
                                400
                        ),
                        npcGuidLootId.lootID());
                this.joinQueue.addSpaceObject(newAssassin);
            }


            miningShip.setLastTimeAssassin(tickTimeStamp);
        }
    }
}
