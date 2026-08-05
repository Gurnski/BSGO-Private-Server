package io.github.luigeneric.core.sector.timers;

import io.github.luigeneric.core.sector.SpaceObjectFactory;
import io.github.luigeneric.core.sector.Tick;
import io.github.luigeneric.core.sector.management.ISpaceObjectRemover;
import io.github.luigeneric.core.sector.management.OutPostStates;
import io.github.luigeneric.core.sector.management.SectorJoinQueue;
import io.github.luigeneric.core.sector.management.SectorSpaceObjects;
import io.github.luigeneric.core.spaceentities.Outpost;
import io.github.luigeneric.core.spaceentities.SpaceObject;
import io.github.luigeneric.enums.CreatingCause;
import io.github.luigeneric.enums.Faction;
import io.github.luigeneric.enums.RemovingCause;
import io.github.luigeneric.enums.SpaceEntityType;
import io.github.luigeneric.linearalgebra.base.Vector3;
import io.github.luigeneric.templates.cards.GalaxyMapCard;
import io.github.luigeneric.templates.sectortemplates.SectorDesc;
import io.github.luigeneric.templates.sectortemplates.spaceobjectttemplates.StaticNpcTemplate;
import io.github.luigeneric.templates.sectortemplates.spaceobjectttemplates.WeaponPlatformTemplate;

import lombok.extern.slf4j.Slf4j;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Slf4j
public class OutpostSpawnTimer extends DelayedTimer
{
    /** Factions whose spawn failure has already been reported here; see spawnOp. */
    private final Set<Faction> loggedSpawnFailure = EnumSet.noneOf(Faction.class);
    private final OutPostStates outPostStates;
    private final ISpaceObjectRemover remover;
    private final SpaceObjectFactory factory;
    private final SectorJoinQueue joinQueue;
    private final SectorDesc sectorDesc;

    public OutpostSpawnTimer(final Tick tick, SectorSpaceObjects sectorSpaceObjects, long delayedTicks,
                             final OutPostStates outPostStates, final ISpaceObjectRemover remover, final SpaceObjectFactory factory,
                             final SectorJoinQueue joinQueue, final SectorDesc sectorDesc)
    {
        super(tick, sectorSpaceObjects, delayedTicks);
        this.outPostStates = outPostStates;
        this.remover = remover;
        this.factory = factory;
        this.joinQueue = joinQueue;
        this.sectorDesc = sectorDesc;
    }

    @Override
    protected void delayedUpdate()
    {
        final List<SpaceObject> currentOutposts = sectorSpaceObjects.getSpaceObjectsOfEntityType(SpaceEntityType.Outpost);
        if (GalaxyMapCard.isBaseSector(Faction.Colonial, sectorDesc.getSectorID()))
        {
            if (currentOutposts.isEmpty())
            {
                spawnOp(Faction.Colonial);
            }
        }
        else if (GalaxyMapCard.isBaseSector(Faction.Cylon, sectorDesc.getSectorID()))
        {
            if (currentOutposts.isEmpty())
            {
                spawnOp(Faction.Cylon);
            }
        }

        if (this.outPostStates.colonialOutpostState().isOutPost())
        {
            if (currentOutposts.stream().noneMatch(obj -> obj.getFaction() == Faction.Colonial))
            {
                spawnOp(Faction.Colonial);
            }
        }
        else
        {
            despawnOp(Faction.Colonial);
        }
        if (this.outPostStates.cylonOutpostState().isOutPost())
        {
            if (currentOutposts.stream().noneMatch(obj -> obj.getFaction() == Faction.Cylon))
            {
                spawnOp(Faction.Cylon);
            }
        }
        else
        {
            despawnOp(Faction.Cylon);
        }

        manageRing(Faction.Colonial);
        manageRing(Faction.Cylon);
    }

    /* ---- The outpost ring: platforms that arrive, upgrade and leave with the outpost. ----
     *
     * The original's ladder (wiki, Outposts.txt): level 3 = 2 light sentries, 4 = 4 light,
     * 5 = 2 medium + 2 light, 6 = 4 medium, 7 = 2 heavy + 2 medium, 8+ = 4 heavy. Levels map
     * onto control points (points are the map's percent x10). Ring POSITIONS come from the
     * sector template's own ring platform entries - scheduleSpawnSpaceObjects skips those for
     * exactly this reason - and the GUIDs swap with the tier. Base-sector rings are pinned to
     * heavy, matching the original's fortified end state.
     *
     * Reconciliation happens on a level change and on a full wipe, never on a partial kill:
     * a half-dead ring stays half-dead until the level moves, so shooting a platform means
     * something, while a ring that was destroyed outright returns with its outpost. */
    public static final float RING_NEAR = 1200f;
    /** light/medium/heavy card guids per faction - must match PLATFORM_GUID in
     *  tools/cardgen/emit-sector-templates.js, which authors the cards. */
    private static final long[] COLONIAL_TIER_GUIDS = { 1783473190L, 1783473191L, 1783473192L };
    private static final long[] CYLON_TIER_GUIDS    = { 1783473196L, 1783473197L, 1783473198L };
    private static final int[][] RING_BY_LEVEL = {
            {}, {}, {},           // levels 0-2: the outpost stands alone
            { 0, 0 },             // 3: 2 light
            { 0, 0, 0, 0 },       // 4: 4 light
            { 1, 1, 0, 0 },       // 5: 2 medium + 2 light
            { 1, 1, 1, 1 },       // 6: 4 medium
            { 2, 2, 1, 1 },       // 7: 2 heavy + 2 medium
            { 2, 2, 2, 2 } };     // 8+: 4 heavy
    private final Map<Faction, List<SpaceObject>> ring = new EnumMap<>(Faction.class);
    private final Map<Faction, Integer> ringLevel = new EnumMap<>(Faction.class);

    /* Ring repair. A ring standing short of its full complement rebuilds after this long; the
     * timestamp of the loss lives in ringIncompleteSince, cleared as soon as the ring is whole.
     *
     * The original rule was "reconcile on a level change or a full wipe, never on a partial kill",
     * so that shooting a platform meant something. It does mean something - for fifteen minutes.
     * What it also meant was that every platform ever lost was lost for the rest of the server's
     * uptime, and losses only ever accumulate: the ring had no way back short of the control level
     * moving, which on a quiet system it never does.
     *
     * A FULL wipe waits the same fifteen minutes as a partial one. It used to rebuild inside the
     * 5-second tick - the `current.isEmpty()` clause below was an unconditional rebuild - so the
     * harder you hit a ring the faster it came back, and clearing one outright bought you no time
     * at all. Levelling the two is what makes clearing the ring a real opening rather than a
     * formality. Fresh outposts are unaffected: they arrive on a control-level CHANGE, which
     * rebuilds immediately and does not consult this clock. */
    private static final long RING_REPAIR_MILLIS = 15 * 60 * 1000L;
    private final Map<Faction, Long> ringIncompleteSince = new EnumMap<>(Faction.class);

    /** A platform template is a ring member if a same-faction Outpost template sits within
     *  RING_NEAR of it. SectorFactory uses this to keep ring members out of the static spawn. */
    public static boolean isRingMember(final StaticNpcTemplate platform, final SectorDesc sectorDesc)
    {
        return sectorDesc.getSpaceObjectTemplates().stream()
                .filter(t -> t.getSpaceEntityType() == SpaceEntityType.Outpost)
                .map(t -> (StaticNpcTemplate) t)
                .anyMatch(op -> op.getFaction() == platform.getFaction()
                        && Vector3.distance(op.getTransform().getPosition(),
                                            platform.getTransform().getPosition()) < RING_NEAR);
    }

    private int controlLevel(final Faction faction)
    {
        if (GalaxyMapCard.isBaseSector(faction, sectorDesc.getSectorID())) return 8;
        final int pts = (faction == Faction.Colonial ?
                outPostStates.colonialOutpostState() : outPostStates.cylonOutpostState()).getOpPoints();
        if (pts >= 2750) return 8;
        if (pts >= 2500) return 7;
        if (pts >= 2250) return 6;
        if (pts >= 2000) return 5;
        if (pts >= 1750) return 4;
        if (pts >= 1250) return 3;
        return 2;
    }

    private List<StaticNpcTemplate> ringSlots(final Faction faction)
    {
        return sectorDesc.getSpaceObjectTemplates().stream()
                .filter(t -> t.getSpaceEntityType() == SpaceEntityType.WeaponPlatform)
                .map(t -> (StaticNpcTemplate) t)
                .filter(t -> t.getFaction() == faction)
                .filter(t -> isRingMember(t, sectorDesc))
                .toList();
    }

    private void manageRing(final Faction faction)
    {
        final List<StaticNpcTemplate> slots = ringSlots(faction);
        if (slots.isEmpty()) return;

        final boolean opPresent = this.sectorSpaceObjects
                .getSpaceObjectsOfEntityType(SpaceEntityType.Outpost)
                .stream().anyMatch(op -> op.getFaction() == faction);
        final int level = opPresent ? controlLevel(faction) : 0;

        final List<SpaceObject> current = ring.computeIfAbsent(faction, f -> new ArrayList<>());
        final List<SpaceObject> livePlatforms = this.sectorSpaceObjects
                .getSpaceObjectsOfEntityType(SpaceEntityType.WeaponPlatform);
        current.removeIf(p -> !livePlatforms.contains(p));

        final int applied = ringLevel.getOrDefault(faction, -1);
        final int[] tiers = RING_BY_LEVEL[Math.min(level, RING_BY_LEVEL.length - 1)];

        /* Has this ring been standing short of its full complement long enough to repair?
         * Tracked per faction and reset the moment it is whole again, so the clock measures how
         * long the gap has EXISTED rather than how long since the last rebuild - a platform killed
         * one minute after a repair still waits its own full interval. */
        final int wanted = Math.min(tiers.length, slots.size());
        final boolean understrength = current.size() < wanted;
        final long now = tick.getTimeStamp();
        boolean repairDue = false;
        if (understrength)
        {
            final Long since = ringIncompleteSince.putIfAbsent(faction, now);
            repairDue = since != null && now - since >= RING_REPAIR_MILLIS;
        }
        else
        {
            ringIncompleteSince.remove(faction);
        }

        if (applied == level && !repairDue) return;
        if (repairDue)
        {
            log.info("{} outpost ring in sector {} repairing: {} of {} platforms standing",
                    faction, sectorDesc.getSectorID(), current.size(), wanted);
            ringIncompleteSince.remove(faction);
        }

        for (final SpaceObject p : current)
        {
            remover.notifyRemovingCauseAdded(p, RemovingCause.JumpOut);
        }
        current.clear();

        final long[] guids = faction == Faction.Colonial ? COLONIAL_TIER_GUIDS : CYLON_TIER_GUIDS;
        for (int i = 0; i < tiers.length && i < slots.size(); i++)
        {
            final StaticNpcTemplate src = slots.get(i);
            final WeaponPlatformTemplate t = new WeaponPlatformTemplate(guids[tiers[i]],
                    SpaceEntityType.WeaponPlatform, CreatingCause.AlreadyExists, 0, true,
                    src.getTransform().getPosition(), src.getTransform().getRotationEuler3(),
                    src.getAutoAggroDistance(), src.getMaximumAggroDistance(), faction,
                    src.getLootTemplateIds());
            try
            {
                final SpaceObject platform = factory.createWeaponPlatform(t);
                joinQueue.addSpaceObject(platform);
                current.add(platform);
            }
            catch (final RuntimeException ex)
            {
                log.warn("ring platform spawn failed in sector {}: {}",
                        sectorDesc.getSectorID(), ex.getMessage());
            }
        }
        ringLevel.put(faction, level);
        if (!current.isEmpty())
        {
            log.info("{} outpost ring in sector {} now control level {} ({} platforms)",
                    faction, sectorDesc.getSectorID(), level, current.size());
        }
    }

    public void despawnOp(final Faction faction)
    {
        if (GalaxyMapCard.isBaseSector(Faction.Colonial, this.sectorDesc.getSectorID()) ||
                GalaxyMapCard.isBaseSector(Faction.Cylon, this.sectorDesc.getSectorID()))
        {
            return;
        }
        final List<Outpost> outposts = this.sectorSpaceObjects.getSpaceObjectsOfEntityType(SpaceEntityType.Outpost);
        for (final Outpost outpost : outposts)
        {
            if (outpost.getFaction() == faction)
            {
                remover.notifyRemovingCauseAdded(outpost, RemovingCause.JumpOut);
            }
        }
    }
    public void spawnOp(final Faction faction)
    {
        try
        {
            final SpaceObject op = factory.createOutpost(faction);
            joinQueue.addSpaceObject(op);
            log.info("Spawned {} outpost in sector {}", faction, sectorDesc.getSectorID());
        }
        catch (IllegalStateException illegalStateException)
        {
            /* This catch was empty. createOutpost throws IllegalStateException for exactly one
             * reason - the sector has no Outpost template of this faction - and delayedUpdate
             * retries every 5s forever, so an outpost that can never spawn produced no error, no
             * log line and no symptom other than its absence. Both base sectors were in that state
             * from the start.
             *
             * Logged ONCE per faction, not per tick: the retry is by design (the timer is also how
             * a captured sector's outpost appears), so the interesting event is the first failure,
             * and at a 5s cadence anything else would bury the log. */
            if (loggedSpawnFailure.add(faction))
            {
                log.warn("Cannot spawn {} outpost in sector {}: {} - the sector template has no " +
                                "Outpost entry for that faction, so this will never succeed",
                        faction, sectorDesc.getSectorID(), illegalStateException.getMessage());
            }
        }
    }
}
