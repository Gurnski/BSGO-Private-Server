/* ================================================ SECTOR TEMPLATE EMITTER
 *
 *   node tools/cardgen/emit-sector-templates.js
 *
 * Writes one SectorTemplate per star in galaxy.js that upstream did not author. Every star on the
 * GalaxyMap card needs one: SectorRegistry.java:52-68 walks the whole star map inside the bean
 * constructor and calls createSector, and SectorFactory.java:102-108 throws
 * IllegalArgumentException("SectorTemplate is null inside sector creation!") for any id with no
 * template - out of an @ApplicationScoped constructor, so the process never boots and the message
 * does not name the sector. That is why this runs from the same table cards.js reads.
 *
 * ---------------------------------------------------------------- WHAT IS REAL AND WHAT IS NOT
 * Be clear about this, because it is the largest fabrication in the project.
 *
 * REAL, transcribed from the client: every sector's id, name, guid, galaxy position, threat pair,
 * GUI index, size, and which faction may enter or hold it. All of that lives in galaxy.js.
 *
 * INVENTED HERE: the CONTENTS. No source we have - not the wikis, not victti's decompile, not the
 * live-server dump - records where a single asteroid sat in any sector other than 0, 6 and 10.
 * The asteroid fields, planetoid placements, spawn corridors, NPC patrol boxes and outpost sites
 * below are generated, not recovered. They are shaped to be plausible and playable, and the ONE
 * property they hold to strictly is that the mechanics around them are honest: real resource
 * tables copied from upstream's own sectors, only NPC and object guids that actually resolve to
 * cards, and nothing outside the sector's own bounds.
 *
 * The three upstream files are never touched. sector 10's hand-placed 1,360-asteroid field is the
 * only genuine sector content in existence and a generator cannot improve on it.
 *
 * ---------------------------------------------------------------- DETERMINISM
 * Seeded per sector id with a plain LCG - no Math.random anywhere. Re-running must be
 * byte-identical or the diff is unreviewable and the staging discipline in galaxy.js is worthless.
 * Change a constant here and EVERY generated sector changes; that is intended, and it is why the
 * emitter is separate from cards.js rather than running as part of the build.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { SECTORS, UPSTREAM_TEMPLATES, BASE_SECTOR } = require('./galaxy');

const CORE_ROOT = process.env.BSGOCORE_PATH
  ? path.resolve(process.env.BSGOCORE_PATH)
  : path.resolve(__dirname, '../../server');
const OUT = path.join(CORE_ROOT, 'ServerConfigurationUtils/global/SectorTemplates');

/* ---------------------------------------------------------------- CONTENT GUIDS
 * Every guid here resolves to cards our own generator emits. That is not a formality: an
 * objectGUID with no World/Owner card is an exception out of SpaceObjectFactory, and an NPC guid
 * with no Ship card is a bot that silently never spawns. The escort/line/boss guids (60-65,
 * 84-91) are the NPC_HEAVIES block cards.js authors; upstream guids we still have no cards for
 * (41, 66, 68, 70, 72, 92, 94, 96) are used NOWHERE below. Re-check with tools/cardgen: every id
 * in this file must appear in JsonCards. */
const ASTEROIDS = [57969842, 57969843, 57969844, 57969586, 57969587, 57969588,
                   57968050, 57968051, 57968052];
const PLANETOIDS = [47343042, 47344578, 47344835, 47344836];

/* ---------------------------------------------------------------- CONTENT-PASS SCENERY
 * Allocated in SECTOR-PASS-SPEC.md and emitted by cards.js in the same pass. The RANGES are the
 * contract between the two generators: cards.js assigns prefabs to consecutive guids in the
 * spec's listing order, and this file references nothing outside an allocated range. A guid the
 * card side never fills is an IllegalArgumentException out of SpaceObjectFactory at sector
 * creation (Debris demands World+Owner like everything else), so the integration step MUST run
 * cards.js's guid validation against these templates before a boot is attempted. */
const seq = (from, n) => Array.from({ length: n }, (_, i) => from + i);
const AST_VARIANTS = seq(57970001, 11);      // asteroid1_2 .. 4_5 - same family as the existing 9
const DECO_ASTEROIDS = seq(57970021, 15);    // decoasteroid_{black,bluesteel,bright,dark,precious}_{1..3}
const DECO_ROCKS = seq(57970041, 9);         // deco_rock_{1,2,3}_{a,b,c} - cluster/lair dressing ONLY
const GOLD_ASTEROIDS = seq(57970051, 12);    // asteroid{gold,silver,spookygreen,spookyorange}_{1..3}
const PLANETOID_VARIANTS = seq(47345001, 6); // planetoid1_2, 1_3, 2_1, 2_3, 3_1, 3_2
const DEBRIS_PILES = seq(61000001, 14);      // debrispile1-5, 6_nt-9_nt, _cylon1-5
const DEBRIS_RINGS = [61000015, 61000016];   // debrisring, debrisring_1
const DEBRIS_WALL = 61000017;                // massive_debris_wall - at most one per graveyard
const WRECKS_COLONIAL = seq(61000021, 16);   // humant1{fighter..stealth},t2..t4carrier + scout wrecks
const WRECKS_CYLON = [...seq(61000037, 16), 61000087];  // cylon mirrors (37-52) + raider_wreck1
/* Broken-capital chunk sets, grouped by the spec's listing order: each inner list is the pieces
 * of ONE capital, kept within ~400 m of a shared anchor so the wreck reads as a single hull. */
const CHUNK_SETS = [
  seq(61000061, 7),   // helwreck01 + helwreck02_chunk1-6
  seq(61000069, 6),   // humandefendert3_jotuun_debris_{b,engine,front,middle_*}
  seq(61000075, 5),   // humant2defender_destroyed_a set + _b
  seq(61000080, 3),   // cylont2command_destroyed_a + _fin + _wing
  seq(61000083, 4),   // humanfightert2_scythe_debris back/back_fin/front + _b
];
const CAPITAL_HULKS = [61000061, 61000068];  // helwreck01 / jormungwreck01 - single-piece capitals
const SCAV_PARTS = seq(61000091, 15);        // decoration_scavenger_station_* (assetmap holds 15)
const CONTAINERS = seq(61000111, 5);         // item_container1-5
const CORRIDOR_BEACON = { Colonial: 61000121, Cylon: 61000123 }; // ftl_jump_beacon_{blue,red}
const SCAV_BEACON = 61000122;                // ftl_jump_beacon_green - the scavengers' own marker
const NAV_BEACONS = seq(61000124, 3);        // jump_beacon_{standard,improved,advanced}
const CRACKED_PLANET = seq(61000131, 4);     // planet_debrisring/rockbig/rocksmall/rocks_and_water
const OUTPOST_GUID = { Colonial: 1450701610, Cylon: 1450701611 };
/* Ring guards come in three tiers, humanstationary1..3 / cylonstationary1..3. The real game
 * upgraded an outpost's sentries light -> medium -> heavy as its progress level rose
 * (Outposts.txt:27-34: levels 3-4 spawn light, 5-6 medium, 7-8+ heavy); we have one flat outpost
 * and no progress ladder, so the owning faction's sector threat is the proxy - see platformTier.
 * AGGRO 3500/4000, RING 900 and loot template 101 are deliberately tier-invariant for now; a
 * 0.75x light / 1.5x heavy payout split (LootTemplates 102/103 cloned from
 * 101_weapon_platform.json) is a future refinement. */
const PLATFORM_GUID = {
  light:  { Colonial: 1783473190, Cylon: 1783473196 },
  medium: { Colonial: 1783473191, Cylon: 1783473197 },
  heavy:  { Colonial: 1783473192, Cylon: 1783473198 },
};
/* NPC wings by ship class. Strikes fly everywhere; escorts join at threat 8, lines at 14, and
 * the two event capitals (C5-07 Poseidon / Kraken) prowl only systems where their faction's
 * threat is 18+. Guids: strikes are the original three per faction, escorts/lines/bosses are the
 * NPC_HEAVIES block in cards.js. Loot ladders with class - 111/114/116 exist in LootTemplates,
 * 121 is the boss jackpot authored alongside this. */
const NPCS = {
  Colonial: { strike: [51, 54, 57], escort: [60, 61, 62], line: [63, 64, 65], boss: 90 },
  Cylon:    { strike: [75, 78, 81], escort: [84, 85, 86], line: [87, 88, 89], boss: 91 },
};
const NPC_LOOT = 111, ESCORT_LOOT = 114, LINE_LOOT = 116;

/* ---------------------------------------------------------------- PER-LAIR BOSS LOOT
 * 46 bosses all paying template 121 made every lair the same errand. These six are the same total
 * value redistributed - all at experience 15000 / chance 1.0 - so no lair is strictly better than
 * another and the choice is flavour, not a farming target:
 *     121 the original: tylium+titanium+water, a 60% cubit roll
 *     122 tylium vein:  130k tylium, thin on everything else
 *     123 cubit hoard:  4000 cubits and 1200 merits (merits past the daily cap convert to
 *                       Uranium in lootToUser, so nothing is lost)
 *     124 ammo cache:   ordnance, level-banded heavy [26,255] / medium [0,25]
 *     125 ancient:      plutonium, FTL fragments, tuning kits, tech analyses
 *     126 wrecker:      titanium-heavy plus mines, flak and nukes
 *
 * The assignment is a pure function of the sector id and takes NO draw from R. That is deliberate:
 * a single R.f() here would advance the LCG and reshuffle every rock, wreck and patrol box in the
 * 23 lair sectors for a reason that has nothing to do with layout. The +3 offset on Cylon (half of
 * six) guarantees the two lairs in one sector never share a template, so a contested system always
 * has two different prizes in it. Adding a seventh template changes every assignment; that is the
 * usual "change a constant, rewrite the galaxy" trade this file already makes.
 *
 * NOT ATTEMPTED, and worth knowing before someone tries: the gold/silver rocks in the lair hollow
 * CANNOT pay more than an ordinary rock. SpawnController builds one ItemPicker per sector from
 * sectorDesc.getAsteroidDesc(), AsteroidSpawn hands that same sector-wide desc and hp interval to
 * every rock regardless of template, and AsteroidTemplate.lootTemplateIds is dead because
 * SpaceObjectFactory.createAsteroid never calls lootNpcTemplateSetup. The vein is scenery. Its
 * value is folded into the boss drop instead - the rocks are the sign, the boss is the payout.
 * Making them genuinely richer needs a per-template resourceMultiplier threaded through
 * AsteroidTemplate -> AsteroidSpawn -> AsteroidResourceSpawn (including its copy constructor, or
 * the rock reverts to 1x on first respawn); ~20 lines of Java, not a config change. */
const BOSS_LOOTS = [121, 122, 123, 124, 125, 126];
const bossLoot = (s, f) => BOSS_LOOTS[(s.id + 3 * (f === 'Cylon' ? 1 : 0)) % BOSS_LOOTS.length];

/* Loot ids upstream puts on its own outposts and platforms. BOTH TEMPLATES NOW EXIST - they were
 * authored alongside arming the stations, in LootTemplates/5_outpost.json and
 * 101_weapon_platform.json, and shipping them together was deliberate: an armed outpost that pays
 * nothing on death is a NET NEGATIVE change, because it makes the marquee PvP objective far harder
 * to kill for exactly zero reward. Until they existed, SpaceObjectFactory.getTemplateLst filtered
 * both ids out on Optional::isPresent - silently, as ever - so all 88 outposts and 352 platforms
 * paid nothing, AND CounterCardDistributor.outpostKilled could never fire, because it sits INSIDE
 * the per-template loop: with no template there is no iteration, so outposts_killed was structurally
 * incapable of incrementing regardless of how many you killed.
 *
 * THE PAYOUT NUMBERS ARE INFERRED. No source in the corpus states what a station drops - the wiki
 * covers outpost mechanics at length but never a kill reward - so they are calibrated against the
 * shipped NPC ladder rather than invented:
 *     111 npc_fighter  exp  250   tyl  350   tit 120   water  40   cubits 15
 *     114 npc_tier2    exp  650   tyl  900   tit 320   water 110   cubits 35
 *     116 npc_tier3    exp 1300   tyl 1800   tit 650   water 220   cubits 60
 * PLATFORM (101) sits at roughly the tier-3 NPC step: exp 1500 / tyl 2000 / tit 700 / 240 / 65.
 * Deliberately NOT scaled up by its 10,000 hull points, because platforms are static, come four to
 * eight per outpost and respawn - paying them above a live tier-3 NPC would make the whole NPC
 * population pointless to shoot.
 * OUTPOST (5) pays exp 6000 / tyl 9000 / tit 3200 / 1100 / 300, i.e. 4.5x the platform against a 5x
 * hull ratio (50,000 vs 10,000), held slightly under proportional because taking an outpost also
 * hands over the sector - the kill is not the only reward.
 * rewardCount is how many of the four entries get ROLLED (LootDamageTemplate's javadoc), not how
 * many players are paid: 2 for a platform matching every NPC template, 3 for an outpost. */
const OUTPOST_LOOT = [5];
const PLATFORM_LOOT = [101];

const RING = 900.0;      // platform ring radius around an outpost; see the note in cards.js

/* PLATFORM AGGRO: 3500 acquire / 4000 leash, matching the outpost they guard.
 *
 * These were both 1200 - the wiki's stated platform range - and that is why the sentry platforms sat
 * idle through a fight at the outpost they are supposed to be defending. The outpost acquires at
 * 3500, and its own guns reach 2000, so essentially every engagement happens OUTSIDE the ring
 * guards' old 1200 m bubble: the platforms could see nothing worth shooting while the station beside
 * them was under attack. Their guns reach 2000 m, so 1200 was under-serving even their own weapons.
 * createPlatFormTemplate (NpcBehaviourTemplates) returns early on any positive maximumAggroDistance
 * and feeds both numbers straight through, so these two fields are the whole control surface - the
 * tier switch below them is dead code for our platforms.
 * The two figures differ on purpose: autoAggro is unprovoked acquisition, maxAggro is how far a
 * target that has already damaged them is pursued through the damage history. */
const AGGRO_AUTO = 3500.0;
const AGGRO_MAX = 4000.0;

/* ROCK SPACING IS UPSTREAM'S, NOT A NAVIGATION RULE.
 *
 * An earlier cut of this emitter enforced ~1 km between rocks so a Pegasus could thread the field.
 * That was measured against the wrong constraint TWICE. First: asteroids have no server collider
 * at all - SpaceObjectFactory.wrapCollider:605-613 does optCollider.ifPresent(...), and
 * ColliderTemplates holds hull shapes plus comet.json, nothing for rocks - so the only collision
 * out there is the client's own mesh test. Second and decisive: upstream's own gold standard
 * ignores the rule. Sector 10's 1,360-rock field runs a nearest-neighbour p50 of 108 m with pairs
 * down to 7 m; belts were obstacles a capital routed AROUND, not through, and at ~1 km spacing the
 * generated fields were 38x sparser than the game they were imitating (14 rocks in a 10 km sector
 * against sector 10's 1,360). The 40 m floor below is cosmetic - it stops two meshes z-fighting -
 * and NN_TARGET is the sector-10 median the belt sigmas are solved against.
 *
 * PLANET_CLEARANCE is different in kind, not just size: a planetoid is the one field object with a
 * real server collider, hardcoded to a 900 m sphere (SpaceObjectFactory.java:261) regardless of
 * template radius, so its keep-out is sized off CAPITAL_RADIUS to keep a battlestar from spawning
 * into an invisible wall. */
const CAPITAL_RADIUS = 1174.0;                 // Pegasus/Basestar World-card radius, from HULLS
const ROCK_MIN_SEP = 40.0;                     // 3D floor between any two rocks; sector 10 goes lower
/* Belt-CORE 2D nearest-neighbour target, CALIBRATED, not derived. Three effects sit between this
 * number and the measured field p50: the median rock lives near 1.2 sigma where density has
 * halved (~1.4x), the +-300 m y-slab pushes 3D distances past their 2D footprint (sector 10's own
 * belts: 2D core NN ~67 m, measured 3D p50 107.8), and keep-out rejection thins the tails. Solving
 * the core for 70 m lands the measured field p50 at ~135-150; 85 shipped 163-215, 120 shipped
 * 165-240. Change it only against verify-sectors.js numbers, never against the formula. */
const NN_TARGET = 70.0;
const PLANET_CLEARANCE = CAPITAL_RADIUS * 1.6; // ~1,880 m around a planetoid's 900 m collider

/* Resource tables copied VERBATIM from upstream's own sectors rather than invented: the asteroid
 * block is sectorTemplate10's (the richer of the two shapes, matching a contested system) and the
 * planetoid block is sectorTemplate10's as well. minRedPercentage 0.3 is our own mining fix and is
 * already in all three upstream files. */
const ASTEROID_DESC = {
  respawnTime: 300,
  respawnResourceTime: 1200,
  hpIntervall: [600, 1600],
  maxResourceDesc: {
    minRedPercentage: 0.3, maxTyliumPercentage: 0.45,
    maxTitaniumPercentage: 0.3, maxWaterPercentage: 0.25,
  },
  resourceEntries: [
    { resourceType: 'None', chance: 100, hpToResourceFactor: 0.5 },
    { resourceType: 'Tylium', chance: 10, hpToResourceFactor: 1.35, variation: 0.1 },
    { resourceType: 'Titanium', chance: 10, hpToResourceFactor: 0.81, variation: 0.1 },
    { resourceType: 'Water', chance: 10, hpToResourceFactor: 0.5, variation: 0.1 },
  ],
};
const PLANETOID_DESC = {
  respawnTime: 300, respawnResourceTime: 900,
  resourceEntries: [
    { resourceType: 'None', chance: 25, hpToResourceFactor: 0.0 },
    { resourceType: 'Tylium', chance: 10, hpToResourceFactor: 0.0 },
    { resourceType: 'Titanium', chance: 10, hpToResourceFactor: 0.0 },
    { resourceType: 'Water', chance: 5, hpToResourceFactor: 0.0 },
  ],
  minResources: 60000, maxResources: 130000,
};
/* Both must be non-null or SectorFactory.java:333 never registers ANY of the three outpost timers
 * - OutpostSpawnTimer included - and every outpost template in the sector is dead weight. Rates
 * are sector 10's, the only attested set. */
const PROGRESS = {
  ptsDrainPerSecond: 10, ptsAsteroidKilledWithRessources: 4,
  ptsNpcKilled: 8, ptsPlayerKilled: 14, ptsMiningShipIncome: 5,
};
/* The FULL miningShipConfig, sector-10 shape. The generated files used to carry only
 * extractPerSecond/extractDelay on the theory that the minimal form was the honest one - but a
 * null npcGuidLootIds NPEs in MiningShipNpcAssassinTimer:69 two ticks after any player summons a
 * mining ship, in every generated sector at once. The assassin table is Tannhauser's own 18-entry
 * list MINUS what does not survive verification against our emitted catalogue:
 *   - 66/68/70/72/92/94/96: zero cards at those guids (upstream heavies we never authored).
 *     createBotFighter throws on a missing Ship card, ON A TIMER, so an unresolvable entry here
 *     is a crash lottery on every assassin roll, not a silent no-op like a bot spawn entry.
 *   - 90: resolves, but to OUR Colonial boss carrier - upstream's 90 was a Cylon wraith. The
 *     Cylon faction column would pass the enemy-of-the-miner filter and then spawn a Colonial
 *     hull, at boss stats, against a Colonial mining ship. Excluded rather than re-factioned.
 * What survives is 5v5 symmetric: three strikes at loot 111 and two heavies at 114 per side.
 * count is omitted exactly as upstream omits it (NpcGuidLootId overrides 0 -> 1);
 * npcLifeTimeSeconds is parsed-but-dead (assassin behaviour is hardcoded) and kept because
 * sector 10 carries it. */
const MINING = {
  extractPerSecond: 10, extractDelay: 60,
  npcGuidLootIds: [
    { npcGUID: 51, lootID: 111, faction: 'Colonial' },
    { npcGUID: 54, lootID: 111, faction: 'Colonial' },
    { npcGUID: 57, lootID: 111, faction: 'Colonial' },
    { npcGUID: 60, lootID: 114, faction: 'Colonial' },
    { npcGUID: 63, lootID: 114, faction: 'Colonial' },
    { npcGUID: 75, lootID: 111, faction: 'Cylon' },
    { npcGUID: 78, lootID: 111, faction: 'Cylon' },
    { npcGUID: 81, lootID: 111, faction: 'Cylon' },
    { npcGUID: 84, lootID: 114, faction: 'Cylon' },
    { npcGUID: 87, lootID: 114, faction: 'Cylon' },
  ],
  secondsUntilNpcSpawns: 300,
  npcInitialSpawnDelaySeconds: 10,
  npcLifeTimeSeconds: 900,
};

// ---------------------------------------------------------------- deterministic RNG
/* Numerical Recipes LCG. Seeded from the sector id so every sector's layout is a pure function of
 * its id: regenerating after a STAGE bump rewrites nothing that already existed. */
function rng(seed) {
  let s = (seed * 1103515245 + 12345) >>> 0;
  const next = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  next(); next(); next();                      // discard - low seeds correlate on the first draws
  return {
    f: next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: arr => arr[Math.floor(next() * arr.length)],
  };
}

const r3 = (v) => Math.round(v * 1000) / 1000;
const vec = (x, y, z) => ({ x: r3(x), y: r3(y), z: r3(z) });
const rot = (yaw) => ({ pitch: 0.0, yaw: r3(((yaw + 180) % 360 + 360) % 360 - 180), roll: 0.0 });

// ---------------------------------------------------------------- object builders
/* Radius is the WIRE value: the client renders an asteroid at radius x 0.05 of the model
 * (Asteroid.cs:100-110), so sector 10's 6-42 spread is 0.3x-2.1x natural size. rotationSpeed 3
 * matches sector 10's whole field. respawnTime 60 is dead data (the reader overwrites it from
 * asteroidDesc, SectorTemplateReader.java:94-97) - kept only so the diff against the old files
 * stays about layout, not about a field the server never reads. */
function asteroid(guid, x, y, z, radius, rotation) {
  return {
    position: vec(x, y, z), rotation, radius: r3(radius), rotationSpeed: 3,
    objectGUID: guid, spaceEntityType: 'Asteroid',
    // "AlreadyExists", not upstream sector 0's "0". CreatingCause has two names and no numeric
    // form; Gson's lenient reader turns an unmatched name into null rather than erroring.
    creatingCause: 'AlreadyExists', respawnTime: 60, isInstantInSector: true,
  };
}
/* Debris is the clean scenery type: no collider (no ColliderTemplate exists for any of these
 * prefabs), no HP, HideStats client-side, and a GUI key that falls back to "Debris Field". Scale
 * is a straight model multiplier (Vector3.one * scale, DebrisPile.java:28-36) - everything here
 * ships at natural size. lootTemplateIds is dead on Debris (createDebrisPile never wires loot)
 * and is deliberately not written. */
function debris(guid, x, y, z, rotation) {
  return {
    position: vec(x, y, z), rotation, scale: 1.0, rotationSpeed: 0.0,
    objectGUID: guid, spaceEntityType: 'Debris',
    creatingCause: 'AlreadyExists', respawnTime: 0, isInstantInSector: true,
  };
}
function planetoid(guid, x, y, z) {
  return {
    position: vec(x, y, z), rotation: rot(0), radius: 1.0, rotationSpeed: 0.0,
    objectGUID: guid, spaceEntityType: 'Planetoid',
    creatingCause: 'AlreadyExists', respawnTime: 0, isInstantInSector: true,
  };
}
function outpost(faction, x, y, z) {
  return {
    position: vec(x, y, z), rotation: rot(0), faction,
    objectGUID: OUTPOST_GUID[faction], spaceEntityType: 'Outpost',
    creatingCause: 'AlreadyExists', respawnTime: 0, isInstantInSector: true,
    lootTemplateIds: OUTPOST_LOOT.slice(),
  };
}
/* Four platforms on the diagonals 900 m out, each yawed to face away from the outpost.
 * Diagonals rather than axes so the four cardinal approach lanes stay clear; 900 m because the
 * outpost's World radius is 250 and its dock range 400, so the ring sits outside the docking
 * envelope and inside the 1,200 m aggro bubble - a ship attacking the outpost is inside all four.
 * maximumAggroDistance is load-bearing as well as content: createPlatFormTemplate
 * (NpcBehaviourTemplates.java:36-58) returns at :38-42 on any positive value and never reaches the
 * switch that throws "Tier not implemented" outside 1/2/3. */
// Four guards per outpost, as the real game had it. Named because the sector-10 augment uses it as
// its "have I already built the rings?" sentinel - see the note there.
const PLATFORMS_PER_RING = 4;

/* Which sentry tier a faction's ring gets, from that faction's OWN threat column - the wiki's
 * ladder (Outposts.txt:27-34) upgraded platforms light -> medium -> heavy as outpost control rose,
 * and sector threat is the proxy we have for how far up that ladder a system sits. Thresholds
 * follow the wiki's platform levels (light 15 / medium 25 / heavy 50) mapped onto the 0-20 threat
 * scale. BASE_SECTOR homes are heavy outright: the original's fortified end state was an outpost
 * "bordered with 4 heavy sentry platforms" (Outposts.txt:34). The 255 "enemy may not enter"
 * sentinel can never reach here - every control group that bars a faction also drops it from
 * outpostFactions, so the owning faction's threat is always a real level. */
function platformTier(s, faction) {
  if (BASE_SECTOR[s.id]) return 'heavy';
  const thr = faction === 'Colonial' ? s.colThreat : s.cylThreat;
  return thr <= 6 ? 'light' : thr <= 14 ? 'medium' : 'heavy';
}

function platformRing(faction, tier, cx, cy, cz) {
  return [0, 1, 2, 3].map(i => {
    const deg = 45 + 90 * i;
    const th = deg * Math.PI / 180;
    return {
      position: vec(cx + RING * Math.cos(th), cy, cz + RING * Math.sin(th)),
      rotation: rot(90 - deg),
      autoAggroDistance: AGGRO_AUTO, maximumAggroDistance: AGGRO_MAX,
      faction, objectGUID: PLATFORM_GUID[tier][faction], spaceEntityType: 'WeaponPlatform',
      creatingCause: 'AlreadyExists', respawnTime: 300, isInstantInSector: true,
      lootTemplateIds: PLATFORM_LOOT.slice(),
    };
  });
}

/* Per-sector census, for the emit log only - keyed by sector id, filled by buildSector. Kept out
 * of the returned document so it can never leak into the JSON. */
const META = new Map();

// ---------------------------------------------------------------- one sector
function buildSector(s) {
  const half = s.extent / 2;                   // Width is the FULL span - SpaceLevel.cs:134 halves it
  /* Content is CONCENTRATED, not area-proportional. The three 40 km systems keep belts, clusters
   * and junk inside a sector-10-sized core: 16x the area at sector-10 density would be ~4,500
   * rocks (the DradisManager lag bug on purpose), and the same count smeared over the full span
   * would be fog. Corridors, planetoids and the bounds assert still use the true half. */
  const effHalf = Math.min(half, 8000);
  const R = rng(s.id);
  const objects = [];
  const keepOut = [];                          // {x,z,r} - nothing else may be placed inside

  /* Threat level, needed up front now: the guid palette, junk generators and boss lairs key off
   * it, not just the NPC wings. 255 is "the enemy may not enter", not a level, so it is dropped
   * in favour of the real column. */
  const lvl = Math.min(20, Math.max(s.colThreat, s.cylThreat) === 255
    ? Math.min(s.colThreat, s.cylThreat) : Math.max(s.colThreat, s.cylThreat));

  // Seeded helpers. Box-Muller consumes two draws per sample; everything stays on the one LCG
  // stream, so any change here reshuffles every sector - expected, the full-diff is by design.
  const gauss = () => Math.sqrt(-2 * Math.log(1 - R.f())) * Math.cos(2 * Math.PI * R.f());
  const rotYaw = () => rot(R.range(-180, 180));
  // Drifting hulks tumble: full euler for rocks and wreck pieces, yaw-only for everything else.
  const eulerFull = () => ({
    pitch: r3(R.range(-180, 180)), yaw: r3(R.range(-180, 180)), roll: r3(R.range(-180, 180)),
  });
  const shuffled = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(R.f() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const inBounds = (x, z) => Math.abs(x) <= half * 0.94 && Math.abs(z) <= half * 0.94;
  /* Radius distribution matched to sector 10's measured field: min 5.2, p25 13.7, median 19.3,
   * p75 25, max 42.9. u^1.35 over 6..42 reproduces the median (20.1) and the low skew. */
  const rockRadius = () => 6 + 36 * Math.pow(R.f(), 1.35);

  /* Outposts take OPPOSITE CORNERS of the sector, each on its own faction's side.
   *
   * They used to sit on the x axis at +-0.51*half with z jittered inside +-0.2*half, which on a
   * regular 10 km system put them 5.1-5.4 km apart - cramped, and the reason is that all the
   * separation was being bought along the ONE axis that has no room to spare. The spawn corridors
   * are boxes at 0.78..0.92*half, so an outpost's 900 m ring already came within 450 m of where the
   * enemy undocks; pushing further out along x buys ~400 m and then the ring is inside the corridor.
   *
   * The z axis was the space nobody was using. Sending Colonial to (-x,-z) and Cylon to (+x,+z)
   * takes the separation diagonally across the sector instead of across its narrow waist:
   * ~8.1-8.7 km on a regular system, up ~60%, with the ring still 500-700 m clear of both the rim
   * and the corridors. Nothing else has to move for it - outposts are placed FIRST, so the belts,
   * planetoids, lairs and junk fields all route around the new keep-out on their own.
   *
   * The ceiling is the rim, not the corridors: ring outer edge at 0.72*half + 900 lands at 0.88 of
   * the way out on a 10 km system. Past that the client starts calling the position empty space
   * (SpaceLevel.cs:134) and pins the map icon to the edge.
   *
   * The cost, stated plainly: your own outpost is now ~3.5-4 km from your undock instead of ~1.7,
   * because it is in the corner rather than straight ahead. The enemy's is ~8 km away instead of
   * ~6.5. Both sides pay it symmetrically.
   *
   * A single-owner system puts its one outpost in its owner's corner just the same, so the
   * geography reads consistently whether or not the system is contested. */
  s.outpostFactions.forEach(f => {
    const sign = f === 'Colonial' ? -1 : 1;
    const x = sign * half * R.range(0.44, 0.48);
    const z = sign * half * R.range(0.68, 0.72);
    objects.push(outpost(f, x, 0, z));
    objects.push(...platformRing(f, platformTier(s, f), x, 0, z));
    keepOut.push({ x, z, r: RING + 500 });     // ring plus clearance for the guns
  });

  /* Player spawn corridors: Colonial on -x, Cylon on +x, both facing the middle. Two corners
   * define an axis-aligned box (SpawnAreaTemplate a/b) and `direction` is the heading a ship
   * undocks on - yaw 90 points a Colonial ship toward +x, i.e. inward. */
  const sx = half * 0.78, sz = half * 0.34;
  const spawns = [
    { id: 0, a: vec(-sx, 0, sz), b: vec(-sx - half * 0.14, 0, -sz),
      direction: rot(90), faction: 'Colonial', isForPlayer: true },
    { id: 1, a: vec(sx, 0, sz), b: vec(sx + half * 0.14, 0, -sz),
      direction: rot(-90), faction: 'Cylon', isForPlayer: true },
  ];
  spawns.forEach(sp => keepOut.push({
    x: (sp.a.x + sp.b.x) / 2, z: 0, r: Math.abs(sp.a.x - sp.b.x) / 2 + sz + 400,
  }));

  /* A jump beacon at each corridor's inner edge - the landmark a fresh arrival flies past on the
   * way into the sector. Colonial approach lit blue, Cylon red. Pure Debris prop: the real
   * JumpBeacon entity type has no server factory arm and cannot be placed. */
  spawns.forEach(sp => {
    const sign = sp.faction === 'Colonial' ? -1 : 1;
    objects.push(debris(CORRIDOR_BEACON[sp.faction],
      sign * half * 0.755, 0, R.range(-half * 0.2, half * 0.2), rotYaw()));
  });

  const clear = (x, z, pad) => keepOut.every(k => Math.hypot(k.x - x, k.z - z) > k.r + pad);
  /* Rocks use a keep-out entry's rockR where present, else its r. A planetoid claims a full
   * PLANET_CLEARANCE circle against STRUCTURE centres (capital-navigation space around its 900 m
   * collider) but only ~1 km against individual rocks - rocks have no collider, and a belt
   * hugging a planetoid is scenery, not a hazard. Corridor/outpost/junk claims stay hard for
   * rocks too. */
  const clearRock = (x, z) => keepOut.every(k => Math.hypot(k.x - x, k.z - z) > (k.rockR || k.r));
  /* Structure centres place by BEST-OF-N SCORING, not hard rejection. A 10 km sector's core is
   * nearly covered by outpost, corridor and planetoid claims, and hard rejection starved whole
   * sectors of belts (the first cut of this pass shipped skies with three rocks in them).
   * Scoring keeps the deepest-clearance candidate of K draws, so a crowded sector gets a belt
   * with a bite taken out of it - per-rock clearRock() still protects the claims themselves -
   * instead of no belt at all. Draw count is fixed at K, so determinism is unaffected. */
  const bestSpot = (K, sample, extra) => {
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < K; i++) {
      const c = sample();
      let score = Infinity;
      for (const k of keepOut) score = Math.min(score, Math.hypot(k.x - c[0], k.z - c[1]) - k.r);
      if (extra) for (const k of extra) score = Math.min(score, Math.hypot(k.x - c[0], k.z - c[1]) - k.r);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  };

  /* ------------------------------------------------------------ the shared rock discipline
   * Every Asteroid-typed rock in the sector - belt, cluster, lair shell, junk - goes through
   * addRock, which enforces one 3D 40 m minimum separation over the whole field via a spatial
   * hash (cell 48 > 40, so a 3x3 neighbourhood provably covers every candidate violator). No
   * O(n^2) scan: ~1,100 rocks cost ~1,100 grid lookups. */
  const CELL = 48;
  const rockGrid = new Map();
  let rockCount = 0;
  const rockFits = (x, y, z) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cz - 1; j <= cz + 1; j++) {
        const cell = rockGrid.get(i + ',' + j);
        if (!cell) continue;
        for (const p of cell) {
          const dx = p[0] - x, dy = p[1] - y, dz = p[2] - z;
          if (dx * dx + dy * dy + dz * dz < ROCK_MIN_SEP * ROCK_MIN_SEP) return false;
        }
      }
    }
    return true;
  };
  const addRock = (guid, x, y, z, radius) => {
    const k = Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
    if (!rockGrid.has(k)) rockGrid.set(k, []);
    rockGrid.get(k).push([x, y, z]);
    rockCount++;
    objects.push(asteroid(guid, x, y, z, radius, eulerFull()));
  };

  /* Guid palette: three dominant variants carry ~95% of the field (sector 10's top three are
   * 98.2%), a seeded handful of traces give each system its own seasoning. The coloured deco
   * asteroids only appear from threat 10 up, so deep space looks stranger than the home lanes.
   * Deco rocks are NOT in the palette - they are cluster/lair dressing only. */
  const deck = shuffled(ASTEROIDS.concat(AST_VARIANTS));
  const dominant = deck.slice(0, 3);
  const trace = shuffled(deck.slice(3).concat(lvl >= 10 ? shuffled(DECO_ASTEROIDS).slice(0, 3) : []))
    .slice(0, R.int(2, 4));
  const rockGuid = () => R.f() < 0.95 ? R.pick(dominant) : R.pick(trace);

  /* Planetoids first - the one field object with a real (900 m, hardcoded) server collider, so
   * everything else works around them. Three to six, out toward the rim, sector-10-style vertical
   * spread (its planetoids sit at |y| up to 1,050 on a 8,000 half). 2,200 m mutual spacing keeps
   * two 900 m colliders from ever reading as one wall. */
  const nPlanet = R.int(3, 6);
  const planetSpots = [];
  const pDeck = shuffled(PLANETOIDS.concat(PLANETOID_VARIANTS));
  /* Hard rejection here, NOT best-of-N: a planetoid is a real 900 m invisible wall, and scoring
   * would happily bury one in a spawn corridor when the sector is crowded. 120 tries and a rim
   * that reaches 0.8-half instead, so the poles beyond the corridors stay reachable. */
  for (let i = 0; i < nPlanet; i++) {
    for (let tries = 0; tries < 120; tries++) {
      const th = R.range(0, Math.PI * 2);
      const rad = R.range(half * 0.35, half * 0.8);
      const x = Math.cos(th) * rad, z = Math.sin(th) * rad;
      // Pad is the planetoid's own collider (~950 m), not PLANET_CLEARANCE: every keep-out
      // circle already carries its own margin, and double-padding left most sectors at two.
      if (!clear(x, z, 1000)) continue;
      if (planetSpots.some(p => Math.hypot(p.x - x, p.z - z) < 2200)) continue;
      const y = R.range(-half * 0.15, half * 0.15);
      objects.push(planetoid(pDeck[i % pDeck.length], x, y, z));
      planetSpots.push({ x, z });
      keepOut.push({ x, z, r: PLANET_CLEARANCE, rockR: 1000 });
      break;
    }
  }

  /* ------------------------------------------------------------ boss lairs
   * Claimed BEFORE clusters and belts, because a lair is the biggest single structure in the
   * sector: a hollow rock shell (inner ~900 m clear so the boss has room to patrol, outer
   * ~2,200 m), a vein of gold/event asteroids in the hollow as the reason to come, and one or two
   * broken capitals at the rim as the reason the last visitors did not leave. The boss's spawn
   * box is pinned to the lair centre further down. Lair rocks pass clear() individually, so a
   * shell near a corridor loses a bite rather than blocking placement outright. */
  const lairs = [];
  for (const f of ['Colonial', 'Cylon']) {
    const own = f === 'Colonial' ? s.colThreat : s.cylThreat;
    if (own < 18 || own === 255) continue;
    const sign = f === 'Colonial' ? -1 : 1;    // a boss anchors its own faction's side
    /* Lair siting is a three-body problem the verification pass measured the first cut losing:
     * 33 of 46 lairs sat inside the enemy wing's patrol box (perpetual NPC war at the lair,
     * guards chronically dead, claim pollution voiding the jackpot) and in 7 sectors the two
     * bosses spawned within aggro of each other and ground each other down. So: +z band only
     * (the wing boxes are biased -z and stop at z = 0.12*effHalf), outer-x band (wings stop at
     * x = 0.40*effHalf), the two wing boxes join the scoring as avoid-circles, and the other
     * faction's lair joins as a 5,000 m circle - boss auto-aggro is 2,500 m cast from a +-700 m
     * patrol box, so 4,800 m of centre separation means the two bosses never meet. bestSpot
     * scores rather than rejects, so a cramped sector degrades to "as far as possible" instead
     * of failing. Corner shells may lose an out-of-bounds bite; that is the documented trade. */
    const otherLair = lairs.length ? lairs[lairs.length - 1] : null;
    const lairAvoid = [
      { x: -effHalf * 0.28, z: -effHalf * 0.165, r: effHalf * 0.31 + 2500 },
      { x:  effHalf * 0.28, z: -effHalf * 0.165, r: effHalf * 0.31 + 2500 },
    ];
    if (otherLair) lairAvoid.push({ x: otherLair.x, z: otherLair.z, r: 5000 });
    const [cx, cz] = bestSpot(40, () => [
      sign * R.range(effHalf * 0.48, effHalf * 0.66),
      R.range(effHalf * 0.22, effHalf * 0.58),
    ], lairAvoid);
    const nShell = R.int(80, 140);
    let made = 0, g = 0;
    while (made < nShell && g < nShell * 30) {
      g++;
      const th = R.range(0, Math.PI * 2);
      const rr = R.range(950, 2150);
      const x = cx + Math.cos(th) * rr, z = cz + Math.sin(th) * rr;
      const y = gauss() * 250;
      if (!inBounds(x, z) || !clearRock(x, z) || !rockFits(x, y, z)) continue;
      addRock(rockGuid(), x, y, z, rockRadius());
      made++;
    }
    // The vein: 6-12 event rocks in the hollow, oversized so they read from the shell.
    for (let i = 0, n = R.int(6, 12); i < n; i++) {
      const th = R.range(0, Math.PI * 2);
      const rr = R.range(120, 650);
      const x = cx + Math.cos(th) * rr, z = cz + Math.sin(th) * rr;
      const y = gauss() * 150;
      if (!inBounds(x, z) || !clearRock(x, z) || !rockFits(x, y, z)) continue;
      addRock(R.pick(GOLD_ASTEROIDS), x, y, z, R.range(15, 30));
    }
    // Rim wreckage: single-piece capital hulks (unambiguous guids), tumbling, plus piles.
    for (let i = 0, n = R.int(1, 2); i < n; i++) {
      const th = R.range(0, Math.PI * 2), rr = R.range(2000, 2400);
      const x = cx + Math.cos(th) * rr, z = cz + Math.sin(th) * rr;
      if (!inBounds(x, z) || !clearRock(x, z)) continue;
      objects.push(debris(R.pick(CAPITAL_HULKS), x, gauss() * 200, z, eulerFull()));
    }
    for (let i = 0, n = R.int(2, 4); i < n; i++) {
      const th = R.range(0, Math.PI * 2), rr = R.range(1900, 2400);
      const x = cx + Math.cos(th) * rr, z = cz + Math.sin(th) * rr;
      if (!inBounds(x, z) || !clearRock(x, z)) continue;
      objects.push(debris(R.pick(DEBRIS_PILES), x, gauss() * 200, z, rotYaw()));
    }
    keepOut.push({ x: cx, z: cz, r: 2500 });
    lairs.push({ faction: f, x: cx, z: cz });
  }
  const lairRocks = rockCount;                 // shell + vein rocks, deducted from the belt budget

  /* ------------------------------------------------------------ dense clusters
   * One to three tight rock knots - the somewhere-worth-mining structure the old lattice never
   * had. Each claims its ground so the belts flow around it, and carries deco-rock and debris
   * dressing so it reads as a place rather than a blob. */
  let clustersMade = 0;
  for (let i = 0, n = R.int(1, 3); i < n; i++) {
    const [cx, cz] = bestSpot(30, () => {
      const th = R.range(0, Math.PI * 2);
      const rad = R.range(effHalf * 0.15, effHalf * 0.7);
      return [Math.cos(th) * rad, Math.sin(th) * rad];
    });
    const sigma = R.range(350, 550);
    const nRocks = R.int(40, 90);
    let made = 0, g = 0;
    while (made < nRocks && g < nRocks * 30) {
      g++;
      const x = cx + gauss() * sigma, z = cz + gauss() * sigma;
      const y = gauss() * Math.min(300, sigma * 0.6);
      if (!inBounds(x, z) || !clearRock(x, z) || !rockFits(x, y, z)) continue;
      addRock(rockGuid(), x, y, z, rockRadius());
      made++;
    }
    for (let d = 0, m = R.int(2, 5); d < m; d++) {  // deco rocks in the core
      const x = cx + gauss() * sigma * 0.5, z = cz + gauss() * sigma * 0.5;
      const y = gauss() * 150;
      if (!inBounds(x, z) || !clearRock(x, z) || !rockFits(x, y, z)) continue;
      addRock(R.pick(DECO_ROCKS), x, y, z, R.range(8, 18));
    }
    for (let d = 0, m = R.int(0, 2); d < m; d++) {  // a pile or two drifting through
      const x = cx + gauss() * sigma, z = cz + gauss() * sigma;
      if (!inBounds(x, z) || !clearRock(x, z)) continue;
      objects.push(debris(R.pick(DEBRIS_PILES), x, gauss() * 150, z, rotYaw()));
    }
    keepOut.push({ x: cx, z: cz, r: sigma * 2 + 150 });
    clustersMade++;
  }

  /* ------------------------------------------------------------ junk fields
   * Skirmish scatter, every sector: a handful of wrecks from both sides, piles, and a few rocks
   * near the midline - the residue of the last patrol clash. */
  {
    const [cx, cz] = bestSpot(20, () => [
      R.range(-effHalf * 0.18, effHalf * 0.18),
      R.range(-effHalf * 0.6, effHalf * 0.6),
    ]);
    const n = R.int(4, 10);
    const nRocks = R.int(1, 3);
    for (let i = 0; i < n; i++) {
      const th = R.range(0, Math.PI * 2), rr = R.range(40, 400);
      const x = cx + Math.cos(th) * rr, z = cz + Math.sin(th) * rr;
      const y = R.range(-150, 150);
      if (!inBounds(x, z)) continue;
      if (i < nRocks) {
        // clearRock too: the scatter centre is scored, not claimed, and without this a rock
        // could legally land inside an outpost's gun-clearance ring (latent, per the verifiers).
        if (clearRock(x, z) && rockFits(x, y, z)) addRock(rockGuid(), x, y, z, rockRadius());
      } else if (R.f() < 0.55) {
        objects.push(debris(R.f() < 0.5 ? R.pick(WRECKS_COLONIAL) : R.pick(WRECKS_CYLON),
          x, y, z, eulerFull()));
      } else {
        objects.push(debris(R.pick(DEBRIS_PILES), x, y, z, rotYaw()));
      }
    }
    keepOut.push({ x: cx, z: cz, r: 600 });
  }

  /* Graveyard, threat 10+ or the 40 km systems: a broken capital with its chunk set grouped
   * within ~400 m of one anchor, ship wrecks of both factions, piles, debris rings, at most one
   * massive_debris_wall, and loot-container props scattered through - all inside ~2.5 km. The
   * client names all of it "Debris Field" for free. */
  let graveyard = false;
  if (lvl >= 10 || s.extent > 20000) {
    const [cx, cz] = bestSpot(40, () => {
      const th = R.range(0, Math.PI * 2);
      const rad = R.range(effHalf * 0.2, effHalf * 0.65);
      return [Math.cos(th) * rad, Math.sin(th) * rad];
    });
    const chunkSet = R.pick(CHUNK_SETS);
    const ax = cx + R.range(-800, 800), az = cz + R.range(-800, 800);
    for (const guid of chunkSet) {
      const th2 = R.range(0, Math.PI * 2), rr = R.range(0, 400);
      const x = ax + Math.cos(th2) * rr, z = az + Math.sin(th2) * rr;
      if (!inBounds(x, z)) continue;
      objects.push(debris(guid, x, R.range(-200, 200), z, eulerFull()));
    }
    let wall = 0;
    for (let i = 0, n = Math.max(8, R.int(15, 30) - chunkSet.length); i < n; i++) {
      const th2 = R.range(0, Math.PI * 2), rr = R.range(150, 2500);
      const x = cx + Math.cos(th2) * rr, z = cz + Math.sin(th2) * rr;
      const y = R.range(-250, 250);
      if (!inBounds(x, z) || !clearRock(x, z)) continue;
      const roll = R.f();
      if (roll < 0.4) {
        objects.push(debris(R.f() < 0.5 ? R.pick(WRECKS_COLONIAL) : R.pick(WRECKS_CYLON),
          x, y, z, eulerFull()));
      } else if (roll < 0.75) {
        objects.push(debris(R.pick(DEBRIS_PILES), x, y, z, rotYaw()));
      } else if (roll < 0.85 && wall < 1) {
        wall++;
        objects.push(debris(DEBRIS_WALL, x, y, z, rotYaw()));
      } else {
        objects.push(debris(R.pick(DEBRIS_RINGS), x, y, z, rotYaw()));
      }
    }
    for (let i = 0, n = R.int(3, 8); i < n; i++) {   // loot-container props
      const th2 = R.range(0, Math.PI * 2), rr = R.range(100, 1800);
      const x = cx + Math.cos(th2) * rr, z = cz + Math.sin(th2) * rr;
      if (!inBounds(x, z) || !clearRock(x, z)) continue;
      objects.push(debris(R.pick(CONTAINERS), x, R.range(-200, 200), z, rotYaw()));
    }
    for (let i = 0, n = R.int(1, 2); i < n; i++) {   // beacons mark the field for passers-by
      const th2 = R.range(0, Math.PI * 2), rr = R.range(2600, 3000);
      const x = cx + Math.cos(th2) * rr, z = cz + Math.sin(th2) * rr;
      if (!inBounds(x, z)) continue;
      objects.push(debris(R.pick(NAV_BEACONS), x, 0, z, rotYaw()));
    }
    for (let i = 0, n = R.int(1, 2); i < n; i++) {   // cracked-planet fragments - the big bones
      const th2 = R.range(0, Math.PI * 2), rr = R.range(400, 2200);
      const x = cx + Math.cos(th2) * rr, z = cz + Math.sin(th2) * rr;
      if (!inBounds(x, z) || !clearRock(x, z)) continue;
      objects.push(debris(R.pick(CRACKED_PLANET), x, R.range(-250, 250), z, eulerFull()));
    }
    keepOut.push({ x: cx, z: cz, r: 2700 });
    graveyard = true;
  }

  /* Scavenger yard, ~25% of sectors (seeded): station parts composed into one structure - a core
   * piece at the centre, the rest stacked and offset within ~800 m - plus containers and piles.
   * Yaw-only rotations: a station, even a scavenged one, is built level. */
  let scavYard = false;
  if (R.f() < 0.25) {
    {
      const [cx, cz] = bestSpot(30, () => {
        const th = R.range(0, Math.PI * 2);
        const rad = R.range(effHalf * 0.2, effHalf * 0.65);
        return [Math.cos(th) * rad, Math.sin(th) * rad];
      });
      // The scavengers mark their claim: one green beacon at the yard's edge.
      objects.push(debris(SCAV_BEACON, cx + R.range(900, 1100), 0, cz + R.range(-300, 300), rotYaw()));
      const parts = shuffled(SCAV_PARTS).slice(0, R.int(6, 12));
      parts.forEach((guid, i) => {
        if (i === 0) { objects.push(debris(guid, cx, 0, cz, rotYaw())); return; }
        const th2 = R.range(0, Math.PI * 2), rr = R.range(100, 800);
        const x = cx + Math.cos(th2) * rr, z = cz + Math.sin(th2) * rr;
        if (!inBounds(x, z)) return;
        objects.push(debris(guid, x, R.range(-150, 150), z, rotYaw()));
      });
      for (let i = 0, n = R.int(2, 4); i < n; i++) {
        const th2 = R.range(0, Math.PI * 2), rr = R.range(150, 700);
        const x = cx + Math.cos(th2) * rr, z = cz + Math.sin(th2) * rr;
        if (!inBounds(x, z)) continue;
        objects.push(debris(R.pick(CONTAINERS), x, R.range(-100, 100), z, rotYaw()));
      }
      for (let i = 0, n = R.int(2, 4); i < n; i++) {
        const th2 = R.range(0, Math.PI * 2), rr = R.range(200, 900);
        const x = cx + Math.cos(th2) * rr, z = cz + Math.sin(th2) * rr;
        if (!inBounds(x, z)) continue;
        objects.push(debris(R.pick(DEBRIS_PILES), x, R.range(-150, 150), z, rotYaw()));
      }
      keepOut.push({ x: cx, z: cz, r: 1100 });
      scavYard = true;
    }
  }

  /* ------------------------------------------------------------ the belts
   * Two to three Gaussian belts carry whatever the field target has left after the structures
   * above took their rocks. Targets are absolute, not per-km2 (the client's 10 Hz all-objects
   * walk is why): 550-750 for a 10 km sector, 900-1,100 for the 40 km three - sector 10 runs
   * 1,360 and is fine, and the hard assert below sits at 1,400.
   *
   * sigma_h is SOLVED, not drawn: for a 2D Gaussian of n rocks the core nearest-neighbour
   * distance is ~0.5/sqrt(n / (2*pi*sigma^2)), so sigma = sqrt(n / (2*pi*lambda)) with lambda
   * chosen for NN_TARGET puts the belt core at sector 10's measured p50 (~108 m) regardless of
   * how the budget split between belts - then clamped to the 1,200-1,600 band so a thin belt
   * cannot collapse into a dot nor a fat one smear away. sigma_y 260-320 is sector 10's own
   * in-belt vertical sigma (260-305). */
  /* The 550-750 / 900-1,100 target funds the BELTS for 10 km sectors - clusters ride on top, or
   * every cluster rock would thin the belts below the NN signature. Only lair rocks are deducted
   * (a two-lair boss sector adds ~300 rocks of its own), which keeps the worst-case total near
   * 1,100 against the 1,400 assert. The 40 km sectors deduct everything: their target is already
   * the ceiling of the budget. */
  const fieldTarget = s.extent > 20000 ? R.int(900, 1100) : R.int(550, 750);
  const beltBudget = s.extent > 20000
    ? Math.max(220, fieldTarget - rockCount)
    : Math.max(300, fieldTarget - lairRocks);
  const belts = [];
  /* Two belts is sector 10's own shape, and it is also load-bearing: the NN signature needs
   * ~300+ rocks per belt, so a third belt only exists where the budget can feed it (a 40 km
   * sector whose lairs and clusters left it at least 700). */
  for (let i = 0, n = (s.extent > 20000 && beltBudget >= 700) ? R.int(2, 3) : 2; i < n; i++) {
    // Mutual belt separation rides in the scoring as a phantom 3 km claim per placed belt, so
    // two belts prefer opposite reaches of the sector (sector 10: opposite corners) but a
    // crowded sky still gets its second belt somewhere rather than not at all.
    const c = bestSpot(40, () => {
      const th = R.range(0, Math.PI * 2);
      const rad = R.range(effHalf * 0.25, effHalf * 0.7);
      return [Math.cos(th) * rad, Math.sin(th) * rad];
    }, belts.map(b => ({ x: b.x, z: b.z, r: 4500 })));
    belts.push({ x: c[0], z: c[1] });
  }
  const NN_LAMBDA = Math.pow(0.5 / NN_TARGET, 2);
  belts.forEach((b, i) => {
    b.n = i === belts.length - 1
      ? beltBudget - Math.floor(beltBudget / belts.length) * (belts.length - 1)
      : Math.floor(beltBudget / belts.length);
    /* Sigma floor is 1,000, DELIBERATELY under the spec's 1,200: sector 10 packs 680 rocks per
     * belt, and at a 550-750 budget the only way to its NN signature is a slightly tighter belt.
     * At >=460 rocks per belt the solver clears 1,200 on its own and the deviation vanishes. */
    b.sigmaH = Math.min(1600, Math.max(1000, Math.sqrt(b.n / (2 * Math.PI * NN_LAMBDA))));
    b.sigmaY = R.range(260, 320);
  });
  for (const b of belts) {
    let made = 0, g = 0;
    while (made < b.n && g < b.n * 40) {
      g++;
      const x = b.x + gauss() * b.sigmaH;
      const z = b.z + gauss() * b.sigmaH;
      const y = gauss() * b.sigmaY;
      if (!inBounds(x, z) || !clearRock(x, z) || !rockFits(x, y, z)) continue;
      addRock(rockGuid(), x, y, z, rockRadius());
      made++;
    }
  }

  /* NPC patrol boxes, one per faction, on the far side from that faction's own spawn so a pilot
   * meets the enemy rather than their own escort. Count rises with the system's threat level.
   * perEntry floors at 2 so even the lowest-threat lanes field 2x3 strikes instead of a lone
   * trio; escorts join at threat 6 (was 8), lines at 12 (was 14) - space got livelier on purpose
   * in the same pass that made the fields 40x denser. */
  const perEntry = Math.max(2, Math.min(4, 1 + Math.floor(lvl / 6)));
  /* Wing boxes are effHalf-scaled and deliberately smaller than the first cut's half-scaled
   * [0.18, 0.70] x [-0.62, 0.16]: at 40 km the old box patrolled 6 km of empty space beyond the
   * content core, and at every size its x-edge sat within escort/line aggro (1,500/2,000 m) of
   * the enemy spawn corridor, so fresh spawns were acquired before they finished orienting. The
   * 0.40*effHalf x-edge leaves ~1,900 m to the corridor at 10 km - beyond escort aggro, a hair
   * inside line aggro at the extreme corner - and the -z bias keeps the whole box out of the
   * lair band in +z. */
  const box = (sign) => ({
    min: vec(sign * effHalf * 0.16, -100.0, -effHalf * 0.45),
    max: vec(sign * effHalf * 0.40, 100.0, effHalf * 0.12),
  });
  const wing = (f) => {
    const t = NPCS[f];
    const e = t.strike.map(g => ({ guid: g, lootId: NPC_LOOT, count: perEntry }));
    if (lvl >= 6) e.push(...t.escort.map(g => ({ guid: g, lootId: ESCORT_LOOT, count: Math.max(1, perEntry - 1) })));
    if (lvl >= 12) e.push(...t.line.map(g => ({ guid: g, lootId: LINE_LOOT, count: 1 })));
    return e;
  };
  const botSpawnTemplates = ['Colonial', 'Cylon'].map(f => ({
    spawnArea: box(f === 'Colonial' ? 1 : -1),          // opposite the faction's own spawn side
    lifeTimeSeconds: 3600, respawnTimeSeconds: 30, respawnTimeDeath: 600,
    faction: f,
    npcSpawnEntries: wing(f),
  }));
  /* Ancient drone wing: VERIFIED OUT. The content pass wanted guid 41 (Tannhauser's own drone) at
   * maxThreat 12+, but guid 41 has ZERO cards in the emitted catalogue (grep '"cardGUID": 41,'
   * across JsonCards; guid 40 is known-broken too) and a bot guid with no Ship card silently
   * never spawns - a wing of nothing. Restore it the day the drone cards exist, not before. */
  /* The bosses. One per faction, only where that faction's OWN threat is 18+ (so the Kraken
   * haunts deep Cylon space and the Poseidon deep Colonial space, matching where the events put
   * them). The spawn box is a +-700 m cube pinned to the lair built above, so the patrol
   * objective keeps the boss circling its own hollow instead of wandering the sector; the old
   * quadrant box is only a fallback for the (unseen) case where no lair found room. lifeTime
   * 360000 is permanent-ish - a boss should not jump out from boredom - and the two-hour
   * respawnTimeDeath stands. The guard wing shares the boss's exact box: two escorts and a line
   * ship at the tier-3 loot step, on a much faster clock, so the lair is defended even between
   * boss kills. */
  for (const f of ['Colonial', 'Cylon']) {
    const own = f === 'Colonial' ? s.colThreat : s.cylThreat;
    if (own < 18 || own === 255) continue;
    const lair = lairs.find(l => l.faction === f);
    const bossBox = lair
      ? { min: vec(lair.x - 700, -100.0, lair.z - 700), max: vec(lair.x + 700, 100.0, lair.z + 700) }
      : box(f === 'Colonial' ? -1 : 1);
    botSpawnTemplates.push({
      spawnArea: bossBox,
      lifeTimeSeconds: 360000, respawnTimeSeconds: 300, respawnTimeDeath: 7200,
      faction: f,
      npcSpawnEntries: [{ guid: NPCS[f].boss, lootId: bossLoot(s, f), count: 1 }],
    });
    botSpawnTemplates.push({
      spawnArea: bossBox,
      lifeTimeSeconds: 3600, respawnTimeSeconds: 120, respawnTimeDeath: 1800,
      faction: f,
      npcSpawnEntries: [
        { guid: R.pick(NPCS[f].escort), lootId: LINE_LOOT, count: 2 },
        { guid: R.pick(NPCS[f].line), lootId: LINE_LOOT, count: 1 },
      ],
    });
  }

  const out = {
    sectorID: s.id,
    spawnAreaTemplates: spawns,
    spaceObjectTemplates: objects,
    asteroidDesc: ASTEROID_DESC,
    planetoidDesc: PLANETOID_DESC,
    miningShipConfig: MINING,
    botSpawnTemplates,
    colonialProgressTemplate: PROGRESS,
    cylonProgressTemplate: PROGRESS,
    /* cometSectorDesc is deliberately ABSENT. Sector 10 carries one, but a comet is a real
     * SpaceObject and we have never verified that its guid resolves to a full card set in our
     * catalogue - and an unresolvable object is an exception on a timer, in every sector at once.
     * Turn it on for all 55 the day a comet is confirmed working in Tannhauser, not before. */
  };

  // Nothing may sit outside the sector card's own bounds: past half-extent the client calls the
  // position empty space (SpaceLevel.cs:134) and pins its map icon to the rim, so the object is
  // real, loot-bearing and permanently unreachable. This is the defect we removed from 0 and 6.
  const oob = objects.filter(o => Math.abs(o.position.x) > half || Math.abs(o.position.z) > half);
  if (oob.length) throw new Error(`sector ${s.id}: ${oob.length} objects outside +/-${half}`);
  for (const sp of spawns) {
    for (const c of [sp.a, sp.b]) {
      if (Math.abs(c.x) > half || Math.abs(c.z) > half)
        throw new Error(`sector ${s.id}: spawn corner (${c.x},${c.z}) outside +/-${half}`);
    }
  }

  /* No station's guns may reach the box a player materialises in. The outpost sites are the only
   * thing in here placed by ratio rather than by rejection sampling, so they are the only thing
   * that can drift into a corridor when someone retunes them - and the failure is invisible from
   * the JSON: undocking players simply start dying to an outpost they cannot yet see. Asserted
   * rather than commented for exactly that reason.
   *
   * SPAWN_SAFE is measured from the ring, not the outpost, because the ring is the part that
   * shoots: platforms sit RING out from the centre and acquire at the same 3,500 m the outpost
   * does. 1,200 m of daylight past the ring is arbitrary but generous - it is longer than the
   * 900 m ring radius itself. */
  const SPAWN_SAFE = 1200;
  for (const st of objects.filter(o => o.spaceEntityType === 'Outpost')) {
    for (const sp of spawns) {
      const lo = { x: Math.min(sp.a.x, sp.b.x), z: Math.min(sp.a.z, sp.b.z) };
      const hi = { x: Math.max(sp.a.x, sp.b.x), z: Math.max(sp.a.z, sp.b.z) };
      // Distance from the outpost centre to the spawn box (0 if it is inside it).
      const dx = Math.max(lo.x - st.position.x, 0, st.position.x - hi.x);
      const dz = Math.max(lo.z - st.position.z, 0, st.position.z - hi.z);
      const gap = Math.hypot(dx, dz) - RING;
      if (gap < SPAWN_SAFE) {
        throw new Error(`sector ${s.id}: ${st.faction} outpost ring is ${Math.round(gap)} m from the ` +
                        `${sp.faction} spawn box (need ${SPAWN_SAFE}) - move the outposts in or the corridors out`);
      }
    }
  }

  /* Budget asserts. 1,400 static field objects is the demonstrated-safe ceiling (sector 10 runs
   * 1,374 and the per-tick server paths exclude rocks outright); the genuinely quadratic cost is
   * collider-bearing station objects in CollisionUpdater's pair prep, held far below the ~100
   * where it would begin to matter. Throwing rather than trimming: a sector over budget is a
   * generator bug, and silently thinning it would hide which change caused it. */
  const byType = {};
  for (const o of objects) byType[o.spaceEntityType] = (byType[o.spaceEntityType] || 0) + 1;
  if (objects.length > 1400)
    throw new Error(`sector ${s.id}: ${objects.length} space objects exceeds the 1400 budget`);
  const colliderBearing = (byType.Outpost || 0) + (byType.WeaponPlatform || 0) + (byType.Cruiser || 0);
  if (colliderBearing > 30)
    throw new Error(`sector ${s.id}: ${colliderBearing} collider-bearing objects exceeds 30`);
  META.set(s.id, {
    byType, belts: belts.length, clusters: clustersMade, lairs: lairs.length,
    graveyard, scavYard,
  });
  return out;
}

/* ================================================ AUGMENTING THE THREE UPSTREAM SECTORS
 *
 * Sectors 0, 6 and 10 are Bigpoint's own files and are never regenerated - but they do need the
 * same outposts and platform rings as everywhere else, and BSGOCore gitignores
 * /ServerConfigurationUtils/** entirely, so those edits cannot ship as a git patch the way the
 * Java changes do. They ship as this function instead: idempotent, in-place, and reproducible
 * from a clean BSGOCore checkout by running this script.
 *
 * Every write here is surgical. Sector 10 in particular is NOT strict JSON - it carries 31 `//`
 * comments and 18 unquoted `"faction": Colonial`, which Gson's lenient reader accepts and
 * JSON.parse does not - so re-emitting it would silently drop upstream's own annotations and
 * reformat all 1,370 objects into an unreviewable diff. Its platforms are edited in the raw text.
 */
function lenientParse(raw) {
  // Strip // comments, but only outside string literals - a prefab name may contain a slash.
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && raw[i + 1] === '/') { while (i < raw.length && raw[i] !== '\n') i++; out += '\n'; continue; }
    out += c;
  }
  // `"faction": Colonial` - bare enum names in value position, which Gson also accepts.
  out = out.replace(/(:\s*)(?!true\b|false\b|null\b)([A-Za-z_]\w*)(\s*[,}\]\n])`?/g, '$1"$2"$3');
  const j = JSON.parse(out);
  return Array.isArray(j) ? j[0] : j;
}

/** Byte spans of each `{...}` element containing `needle`, found by brace-walking. */
function elementSpans(raw, needle) {
  const spans = [];
  let from = 0, at;
  while ((at = raw.indexOf(needle, from)) >= 0) {
    from = at + needle.length;
    let depth = 0, i = at;
    for (; i >= 0; i--) {
      if (raw[i] === '}') depth++;
      else if (raw[i] === '{') { if (depth === 0) break; depth--; }
    }
    if (i < 0) throw new Error('unbalanced braces before ' + needle);
    const start = i;
    let d = 0, j = start, inStr = false, esc = false;
    for (; j < raw.length; j++) {
      const c = raw[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') d++;
      else if (c === '}') { d--; if (d === 0) break; }
    }
    spans.push([start, j + 1]);
  }
  return spans;
}

/* Bring EXISTING platform entries in the three upstream templates up to the current aggro tuning.
 *
 * The generated 55 get the right numbers for free, but sectors 0, 6 and 10 are augmented in place
 * and never regenerated, so their 16 platforms kept whatever they were first written with. Sectors
 * 0 and 6 are the faction home sectors - the two every player sees most - so leaving ring guards
 * there that ignore a fight happening 1,500 m away is the most visible possible version of the bug.
 *
 * RAW TEXT, NOT A JSON ROUND-TRIP, and that is deliberate. All 58 templates are CRLF; the sector
 * 0/6 branch below rewrites via JSON.stringify, which emits LF, so routing this through it would
 * silently reflow every line of both files and bury the real change in a 5,000-line diff. Editing
 * the bytes in place touches only the numbers. Scoped to WeaponPlatform element spans rather than
 * replacing the strings globally, so it cannot reach an outpost or an NPC spawn that happens to
 * share a value. Idempotent: once the numbers are current there is nothing left to match. */
function normaliseUpstreamPlatformAggro() {
  const notes = [];
  for (const f of fs.readdirSync(OUT)) {
    if (!/^sectorTemplate(0|6|10)[._]/.test(f)) continue;
    const p = path.join(OUT, f);
    let raw = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
    const spans = elementSpans(raw, '"spaceEntityType": "WeaponPlatform"');
    let changed = 0;
    // Back to front, so earlier spans keep their offsets as later ones are rewritten.
    for (const [a, b] of spans.slice().sort((x, y) => y[0] - x[0])) {
      const before = raw.slice(a, b);
      const after = before
        .replace(/("autoAggroDistance"\s*:\s*)[\d.]+/, `$1${AGGRO_AUTO}`)
        .replace(/("maximumAggroDistance"\s*:\s*)[\d.]+/, `$1${AGGRO_MAX}`);
      if (after !== before) { raw = raw.slice(0, a) + after + raw.slice(b); changed++; }
    }
    if (changed) {
      fs.writeFileSync(p, raw);
      notes.push(`${f}: ${changed} platform(s) retuned to ${AGGRO_AUTO}/${AGGRO_MAX}`);
    }
  }
  return notes;
}

/* Sector 6's two gate cruisers shipped 2000 m apart on z, placed for the old undersized basestar
 * capsule. The collider is true-size now (measured mesh AABB, z half-extent 1042.167), so two
 * identical axis-aligned copies need |dz| > 2*1042.167 = 2084.334 m or the server logs "Static
 * objects overlap and cannot be resolved" on every boot. Moving the southern one to z = -1100
 * gives dz = 2100. RAW TEXT for the same reason as the platform retune above: the JSON.stringify
 * path would reflow the whole file. The \r? is defensive only - this function runs AFTER
 * augmentUpstream, whose JSON.stringify reflow (2-space, LF) is what produces the layout the
 * anchor matches; the raw _public formatting (CRLF, deeper indent) is unreachable in that flow
 * and deliberately does not match. The closing-brace anchor excludes the sector's "z": -1000.854
 * asteroid, and the trailing objectGUID check pins the match to the cruiser element itself so a
 * future object landing at exactly z = -1000 (the placement lattice can produce it) is never
 * silently moved instead. Idempotent: once the z is -1100 nothing matches. */
function separateSector6Cruisers() {
  const f = fs.readdirSync(OUT).find(x => /^sectorTemplate6[._]/.test(x));
  if (!f) return [];
  const p = path.join(OUT, f);
  const raw = fs.readFileSync(p, 'utf8');
  const out = raw.replace(/("z": )-1000(?=\r?\n {6}\},)/g, (match, pre, offset) =>
    /"objectGUID": 28\b/.test(raw.slice(offset, offset + 400)) ? pre + '-1100' : match);
  if (out === raw) return [];
  fs.writeFileSync(p, out);
  return [`${f}: cruiser at (1500, 0, -1000) moved to z=-1100 (basestar pair needs |dz| > 2084.334)`];
}

function augmentUpstream() {
  const notes = [];

  /* ---- sectors 0 and 6: the fleet bases. NO OUTPOST BELONGS HERE, and an earlier pass of this
   * script put one in each.
   *
   * The reasoning then was mechanical - OutpostSpawnTimer spawns unconditionally in a base sector
   * and createOutpost throws without a template of that faction - and it missed the obvious: the
   * home sector already HAS its station. Alpha Ceti is the Galactica, Appolid is the Basestar;
   * that is where the CIC is, where the hangar is, and where the flagships live. A conquerable
   * outpost parked alongside is both fiction and a contradiction, since the base sectors are the
   * one place neither faction can attack.
   *
   * Removing the entries is only half of it: the outpost timers are registered ONLY when both
   * progress templates are non-null (SectorFactory.java:356-361), so the progress templates go
   * too. With them gone OutpostSpawnTimer never runs here, which is what the untouched upstream
   * files did in the first place - the base sectors ship without either. */
  for (const id of [0, 6]) {
    const s = SECTORS.find(x => x.id === id);
    if (!s) continue;
    const file = fs.readdirSync(OUT).find(f => new RegExp(`^sectorTemplate${id}_`).test(f));
    if (!file) { notes.push(`sector ${id}: no upstream template found, skipped`); continue; }
    const p = path.join(OUT, file);
    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    const o = Array.isArray(doc) ? doc[0] : doc;
    let tpl = o.spaceObjectTemplates;
    const faction = BASE_SECTOR[id];
    const half = s.extent / 2;
    let dirty = false;

    /* OUT-OF-BOUNDS SWEEP. Sectors 0 and 6 each shipped one asteroid at z = 35,980.51 - 3.6x
     * their own half-extent, and past even the largest sector size any source describes. The
     * server spawns it verbatim (SpaceObjectFactory.createAsteroid takes the transform as given),
     * the client calls that position empty space (SpaceLevel.cs:134) and GUISystemMap pins its
     * icon to the map rim, so the rock is real, targetable, loot-bearing and permanently
     * unreachable. Deleted rather than repaired: the obvious repair - a dropped decimal, 3598.051
     * - has nothing corroborating it, and inventing plausible values is the failure mode that has
     * cost this project the most. ServerConfigurationUtils_public stays as the witness that the
     * defect is inherited rather than ours. */
    const oob = tpl.filter(t => t.position &&
      (Math.abs(t.position.x) > half || Math.abs(t.position.y) > half || Math.abs(t.position.z) > half));
    if (oob.length) {
      tpl = o.spaceObjectTemplates = tpl.filter(t => !oob.includes(t));
      dirty = true;
      notes.push(`sector ${id}: removed ${oob.length} object(s) outside +/-${half} ` +
                 `(${oob.map(t => `${t.spaceEntityType} ${t.objectGUID} at z=${t.position.z}`).join(', ')})`);
    }

    /* Assassin config. Upstream's home sectors ship extract rates only, and a null
     * npcGuidLootIds is an Arrays.stream(null) NPE every timer tick while a mining ship exists
     * (MiningShipNpcAssassinTimer:69) - the same latent crash the 55 generated sectors were
     * healed of this pass, fixed here with the same verified table. */
    if (o.miningShipConfig && !o.miningShipConfig.npcGuidLootIds) {
      o.miningShipConfig = {
        ...o.miningShipConfig,
        npcGuidLootIds: MINING.npcGuidLootIds,
        secondsUntilNpcSpawns: MINING.secondsUntilNpcSpawns,
        npcInitialSpawnDelaySeconds: MINING.npcInitialSpawnDelaySeconds,
        npcLifeTimeSeconds: MINING.npcLifeTimeSeconds,
      };
      dirty = true;
      notes.push(`sector ${id}: assassin config added to miningShipConfig (null table was a live NPE)`);
    }

    /* Written as a removal rather than "never add" so a tree that already carries the mistake is
     * repaired in place. Once clean this reports unchanged and rewrites nothing. */
    const stations = tpl.filter(t => t.spaceEntityType === 'Outpost' || t.spaceEntityType === 'WeaponPlatform');
    if (stations.length) {
      o.spaceObjectTemplates = tpl = tpl.filter(t => !stations.includes(t));
      dirty = true;
      notes.push(`sector ${id}: removed ${stations.length} station(s) - the fleet base IS the station`);
    }
    if (o.colonialProgressTemplate || o.cylonProgressTemplate) {
      delete o.colonialProgressTemplate;
      delete o.cylonProgressTemplate;
      dirty = true;
      notes.push(`sector ${id}: progress templates removed, so the outpost timers never register`);
    }
    if (dirty) fs.writeFileSync(p, JSON.stringify(doc, null, 2) + '\n');
    else notes.push(`sector ${id}: no station present, unchanged`);
    continue;
    /* Placed by the same deterministic search the generated sectors use, so re-running cannot
     * move it: a fixed 250 m lattice, scored on distance to the nearest existing object, kept on
     * the owner's own side of the sector and far enough out to be a destination. */
    let best = null, bestScore = -1;
    const sign = faction === 'Colonial' ? -1 : 1;
    for (let xi = -24; xi <= 24; xi++) {
      const x = xi * 250;
      if (sign * x <= 0) continue;
      for (let zi = -24; zi <= 24; zi++) {
        const z = zi * 250;
        const rr = Math.hypot(x, z);
        if (rr < 3000 || rr > 6000) continue;
        if (Math.abs(x) + RING > half || Math.abs(z) + RING > half) continue;
        let d = Infinity;
        for (const t of tpl) d = Math.min(d, Math.hypot(t.position.x - x, t.position.z - z));
        if (d > bestScore) { bestScore = d; best = [x, z]; }
      }
    }
    const [ox, oz] = best;
    // Upstream rebuilds stay 'medium' - the shipped in-place state. Upgrading the 16 upstream
    // platforms to the threat ladder would be a separate raw-text augment, not this branch.
    tpl.push(outpost(faction, ox, 0, oz), ...platformRing(faction, 'medium', ox, 0, oz));
    o.colonialProgressTemplate = { ...PROGRESS };
    o.cylonProgressTemplate = { ...PROGRESS };
    fs.writeFileSync(p, JSON.stringify(doc, null, 2) + '\n');
    notes.push(`sector ${id}: ${faction} outpost at (${ox}, 0, ${oz}) + 4 platforms, ` +
               `${Math.round(bestScore)} m clear; progress templates armed`);
  }

  /* ---- sector 10: it HAS two outposts, but its four platforms were scattered across the sector
   * with no relation to either - and all four were faction Ancient, which makes an outpost's own
   * guns neutral toward the fleet attacking it. Replaced by two rings of four, faction- and
   * model-matched to the outpost each guards. */
  {
    const file = fs.readdirSync(OUT).find(f => /^sectorTemplate10[._]/.test(f));
    if (!file) {
      notes.push('sector 10: no upstream template found, skipped');
    } else {
      const p = path.join(OUT, file);
      let raw = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
      const o = lenientParse(raw);
      const ops = (o.spaceObjectTemplates || []).filter(t => t.spaceEntityType === 'Outpost');
      const spans = elementSpans(raw, '"spaceEntityType": "WeaponPlatform"');
      /* THE IDEMPOTENCY SENTINEL IS GEOMETRIC, NOT A MAGIC NUMBER. It used to be
       * raw.includes('"maximumAggroDistance": 1200') - i.e. "have I run before?" was answered by
       * looking for the aggro value the ring happened to carry. That made the guard silently
       * self-destructing: the moment the platform aggro was retuned (1200 -> 3500/4000 to stop the
       * ring guards idling through fights at the outpost they defend), the sentinel stopped
       * matching and a second run would have torn out and rebuilt the rings. Counting the platforms
       * against the rings we would emit is a property of the LAYOUT, which is what this block
       * actually owns, so retuning any stat can never confuse it again. */
      if (!spans.length) {
        notes.push('sector 10: no platform entries found, unchanged');
      } else if (spans.length === ops.length * PLATFORMS_PER_RING) {
        notes.push('sector 10: platform rings already in place, unchanged');
      } else {
        const ring = [];
        for (const f of ['Colonial', 'Cylon']) {
          const op = ops.find(t => String(t.faction) === f);
          if (!op) continue;
          // 'medium' pinned, same as the sector-0/6 branch: sector 10's shipped rings are medium.
          ring.push(...platformRing(f, 'medium', op.position.x, op.position.y, op.position.z));
        }
        // Match the file's own layout: elements open with `}, {`, keys at 12, nested at 16.
        const block = ring.map(t => {
          const L = JSON.stringify(t, null, 4).split('\n');
          return L[0] + '\n' + L.slice(1).map(x => ' '.repeat(8) + x).join('\n');
        }).join(', ');
        // Remove spans 1..n back to front, each with the comma separating it from the previous.
        for (const [a, b] of spans.slice(1).sort((x, y) => y[0] - x[0])) {
          let k = a - 1;
          while (k >= 0 && /\s/.test(raw[k])) k--;
          if (raw[k] !== ',') throw new Error('sector 10: expected a comma before a platform element');
          raw = raw.slice(0, k) + raw.slice(b);
        }
        const [a, b] = spans[0];
        raw = raw.slice(0, a) + block + raw.slice(b);
        // The file is CRLF and every other line is untouched; writing LF would rewrite all 25,014.
        fs.writeFileSync(p, raw);
        notes.push(`sector 10: ${spans.length} scattered platforms replaced by ${ring.length} ` +
                   `in ${ops.length} rings of four, faction-matched`);
      }
    }
  }

  /* ---- sector 10's assassin table: seven of its eighteen entries name guids with zero cards
   * (66/68/70/72/92/94/96 - createBotFighter throws ON A TIMER, and setLastTimeAssassin only
   * arms after a successful spawn, so a live mining session re-rolls the crash every cycle),
   * and the "npcGUID": 90 row is upstream's Cylon wraith - a guid that now resolves to OUR
   * level-120, 50k-HP Colonial boss carrier, which the enemy-of-the-miner filter would happily
   * spawn 345 m from a Colonial mining ship. Replaced with the same verified 10-entry table
   * every generated sector carries. Raw-text surgery, same discipline as the platform block:
   * only the array's bytes move, and the sentinel is a property of the CONTENT (a broken guid
   * still present), not a have-I-run flag. */
  {
    const file = fs.readdirSync(OUT).find(f => /^sectorTemplate10[._]/.test(f));
    if (file) {
      const p = path.join(OUT, file);
      let raw = fs.readFileSync(p, 'utf8');
      const start = raw.indexOf('"npcGuidLootIds": [');
      if (start === -1) {
        notes.push('sector 10: no npcGuidLootIds block found, unchanged');
      } else {
        let depth = 0, end = -1;
        for (let i = raw.indexOf('[', start); i < raw.length; i++) {
          if (raw[i] === '[') depth++;
          else if (raw[i] === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
        }
        const span = raw.slice(start, end);
        if (!/"npcGUID":\s*(66|68|70|72|90|92|94|96)\b/.test(span)) {
          notes.push('sector 10: assassin table already clean, unchanged');
        } else {
          const rows = MINING.npcGuidLootIds.map(e =>
            '            {\n' +
            `                "npcGUID": ${e.npcGUID},\n` +
            `                "lootID": ${e.lootID},\n` +
            `                "faction": "${e.faction}"\n` +
            '            }').join(',\n');
          const block = '"npcGuidLootIds": [\n' + rows + '\n        ]';
          raw = raw.slice(0, start) + block + raw.slice(end);
          fs.writeFileSync(p, raw);
          notes.push('sector 10: assassin table 18 -> 10 entries ' +
                     '(7 card-less crash guids and the boss-guid 90 row removed)');
        }
      }
    }
  }
  return notes;
}

// ---------------------------------------------------------------- main
function main() {
  if (!fs.existsSync(OUT)) {
    console.error('no SectorTemplates directory at ' + OUT);
    process.exit(1);
  }
  const generated = SECTORS.filter(s => !s.isUpstreamTemplate);
  const keep = new Set();
  let written = 0, totalObjects = 0;

  for (const s of generated) {
    if (UPSTREAM_TEMPLATES.has(s.id)) throw new Error('refusing to overwrite upstream sector ' + s.id);
    const safe = s.name.replace(/[^A-Za-z0-9]+/g, '');
    const file = `sectorTemplate${s.id}_${safe}.json_v3.json`;
    keep.add(file);
    const doc = buildSector(s);
    totalObjects += doc.spaceObjectTemplates.length;
    const body = JSON.stringify(doc, null, 2) + '\n';
    const p = path.join(OUT, file);
    // Only write when the bytes differ, so an unchanged sector keeps its mtime and a re-run of
    // the emitter after a STAGE bump shows exactly which files are new.
    if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== body) {
      fs.writeFileSync(p, body);
      written++;
    }
    // Per-sector census: the emit log is where a budget regression shows first, not the diff.
    const m = META.get(s.id), t = m.byType;
    console.log(`  sector ${String(s.id).padStart(3)} ${s.name}: ` +
      `${doc.spaceObjectTemplates.length} objects (ast ${t.Asteroid || 0}, ` +
      `ptd ${t.Planetoid || 0}, debris ${t.Debris || 0}, op ${t.Outpost || 0}, ` +
      `wp ${t.WeaponPlatform || 0}) belts ${m.belts} clusters ${m.clusters}` +
      (m.lairs ? ` lairs ${m.lairs}` : '') +
      (m.graveyard ? ' graveyard' : '') + (m.scavYard ? ' scavyard' : ''));
  }

  /* Sweep generated files whose star has left the stage. A template with no star is harmless -
   * SectorFactory looks templates up BY star, never the reverse - but leaving it means the next
   * STAGE bump silently reuses a stale layout, and the file count stops matching the galaxy.
   * Only ever removes files this emitter's own naming produced, and never an upstream one. */
  let removed = 0;
  for (const f of fs.readdirSync(OUT)) {
    const m = /^sectorTemplate(\d+)_.*\.json_v3\.json$/.exec(f);
    if (!m) continue;
    const id = Number(m[1]);
    if (UPSTREAM_TEMPLATES.has(id) || keep.has(f)) continue;
    fs.unlinkSync(path.join(OUT, f));
    removed++;
  }

  /* The three upstream sectors are augmented in place rather than generated. Runs AFTER the
   * generated ones so a failure here cannot leave the galaxy half-written. */
  const notes = augmentUpstream();
  // Retune the platforms the augment path does not rebuild. AFTER augmentUpstream, so any ring it
  // has just written is normalised in the same pass rather than a run later.
  notes.push(...normaliseUpstreamPlatformAggro());
  notes.push(...separateSector6Cruisers());

  const onDisk = fs.readdirSync(OUT).filter(f => f.endsWith('.json')).length;
  console.log(`sector templates: ${generated.length} generated (${written} rewritten, ${removed} swept)`);
  console.log(`  ${onDisk} template files on disk for ${SECTORS.length} stars`);
  console.log(`  ${totalObjects} space objects across the generated sectors`);
  const withOp = generated.filter(s => s.outpostFactions.length);
  console.log(`  ${withOp.length} sectors carry outpost templates ` +
              `(${withOp.filter(s => s.outpostFactions.length === 2).length} contested, both factions)`);
  console.log('upstream sectors (augmented in place, never regenerated):');
  notes.forEach(n => console.log('  ' + n));
}

if (require.main === module) main();
module.exports = { buildSector };
