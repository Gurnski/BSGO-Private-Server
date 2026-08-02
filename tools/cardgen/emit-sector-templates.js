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
 * with no Ship card is a bot that silently never spawns. Upstream's own sector 10 references
 * thirteen NPC guids we have never authored (41, 60, 63, 66, 68, 70, 72, 84, 87, 90, 92, 94, 96);
 * this emitter uses only the six that resolve, so a generated sector is never quietly emptier
 * than it looks. Re-check with tools/cardgen: every id below must appear in JsonCards. */
const ASTEROIDS = [57969842, 57969843, 57969844, 57969586, 57969587, 57969588,
                   57968050, 57968051, 57968052];
const PLANETOIDS = [47343042, 47344578, 47344835, 47344836];
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
const NPC_LOOT = 111, ESCORT_LOOT = 114, LINE_LOOT = 116, BOSS_LOOT = 121;

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

/* CLEARANCES ARE SIZED FOR THE BIGGEST THING THAT FLIES, NOT THE SMALLEST.
 *
 * The first cut of this emitter spaced fields for strike craft: 120 m between asteroids and a 900 m
 * keep-out around each planetoid. A Viper has a World-card radius of 5, so that is enormous. A
 * Pegasus has a radius of 1,174 - it is wider than the gaps it was being asked to fly through, so a
 * capital simply cannot cross a generated field without grinding along something the whole way.
 *
 * The server is NOT what stops it, which is worth knowing before anyone goes looking in the wrong
 * place: SpaceObjectFactory.wrapCollider:603-611 does optCollider.ifPresent(...), so an object whose
 * prefab has no ColliderTemplate gets NO collider at all - and ColliderTemplates holds hull shapes
 * plus comet.json, nothing for planetoids or asteroids. The collision a player feels out there is
 * the client's own geometry against the ship model.
 *
 * CAPITAL_RADIUS is the Pegasus/Basestar figure from HULLS. Everything below is expressed as a
 * multiple of it so the fields stay navigable if that number ever changes. */
const CAPITAL_RADIUS = 1174.0;
/* 1,174 is the World-card radius, i.e. the BOUNDING SPHERE - it is not the width that has to fit
 * through a gap. The Pegasus's own hardpoints span x = -350.9 .. +352.6, so the hull is 703 m
 * across, and the client collides against the mesh in ColliderTemplates/Colonial/pegasus.json
 * rather than against the sphere. Sizing gaps to the sphere would need 2,348 m between every pair
 * of rocks and would strip the fields bare; sizing them to the hull plus a rock's own bulk lands
 * just under a kilometre, which a battlestar can thread and a Viper still finds dense. */
const AST_CLEARANCE = CAPITAL_RADIUS * 0.85;   // ~998 m between neighbouring rocks
const PLANET_CLEARANCE = CAPITAL_RADIUS * 1.6; // ~1,880 m around a planetoid

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
/* Sectors 0 and 6 carry exactly these two fields and no npcGuidLootIds. Sector 10's escort list
 * names twelve NPC guids we have no cards for, so copying it would author a mining escort that
 * can never appear. The minimal form is the honest one. */
const MINING = { extractPerSecond: 10, extractDelay: 60 };

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
function asteroid(guid, x, y, z) {
  return {
    position: vec(x, y, z), rotation: rot(0), radius: 10, rotationSpeed: 0,
    objectGUID: guid, spaceEntityType: 'Asteroid',
    // "AlreadyExists", not upstream sector 0's "0". CreatingCause has two names and no numeric
    // form; Gson's lenient reader turns an unmatched name into null rather than erroring.
    creatingCause: 'AlreadyExists', respawnTime: 60, isInstantInSector: true,
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

// ---------------------------------------------------------------- one sector
function buildSector(s) {
  const half = s.extent / 2;                   // Width is the FULL span - SpaceLevel.cs:134 halves it
  const R = rng(s.id);
  const objects = [];
  const keepOut = [];                          // {x,z,r} - nothing else may be placed inside

  /* Outposts sit on their faction's side of the sector, mirroring upstream's Tannhauser
   * (Colonial -5105, Cylon +5055) at roughly half the half-extent. A single-owner system puts its
   * one outpost on its owner's side just the same, so the geography reads consistently. */
  const opX = half * 0.51;
  s.outpostFactions.forEach(f => {
    const sign = f === 'Colonial' ? -1 : 1;
    const x = sign * opX;
    const z = R.range(-half * 0.2, half * 0.2);
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

  const clear = (x, z, pad) => keepOut.every(k => Math.hypot(k.x - x, k.z - z) > k.r + pad);

  /* Planetoids first - they are the biggest things in the field and everything else works around
   * them. Two to four, out toward the rim, in the sector's own vertical slab. */
  const nPlanet = R.int(2, 4);
  const planetSpots = [];
  for (let i = 0; i < nPlanet; i++) {
    for (let tries = 0; tries < 60; tries++) {
      const th = R.range(0, Math.PI * 2);
      const rad = R.range(half * 0.35, half * 0.72);
      const x = Math.cos(th) * rad, z = Math.sin(th) * rad;
      if (!clear(x, z, PLANET_CLEARANCE)) continue;
      if (planetSpots.some(p => Math.hypot(p.x - x, p.z - z) < half * 0.35)) continue;
      const y = R.range(-half * 0.09, half * 0.09);
      objects.push(planetoid(PLANETOIDS[i % PLANETOIDS.length], x, y, z));
      planetSpots.push({ x, z });
      keepOut.push({ x, z, r: PLANET_CLEARANCE });
      break;
    }
  }

  /* Asteroids. Roughly two thirds in belts, the rest scattered, so the field has somewhere worth
   * mining rather than being uniform noise.
   *
   * COUNT IS DELIBERATELY WELL BELOW SECTOR 10's 1,360. That field is the one place we have
   * measured a per-frame cost that scales with asteroid count - DradisManager walks every object
   * in range ten times a second - and 1,360 is also upstream's densest sector by a factor of five
   * over sectors 0 and 6 (256 each). 280 sits just above those two. The three 40,000 m systems get
   * more, but nothing like area-proportional: 16x the area at the same density would be 4,480
   * rocks in one sector, which is the lag bug on purpose. */
  const nAst = s.extent > 20000 ? 640 : 280;
  const nBelts = R.int(3, 5);
  const belts = [];
  for (let i = 0; i < nBelts; i++) {
    for (let tries = 0; tries < 60; tries++) {
      const th = R.range(0, Math.PI * 2);
      const rad = R.range(half * 0.18, half * 0.66);
      const x = Math.cos(th) * rad, z = Math.sin(th) * rad;
      if (!clear(x, z, 700)) continue;
      belts.push({ x, z, spread: R.range(half * 0.10, half * 0.20) });
      break;
    }
  }
  let placed = 0, guard = 0;
  const spots = [];   // rocks placed so far, for the rock-to-rock spacing test below
  while (placed < nAst && guard < nAst * 40) {
    guard++;
    let x, z;
    if (belts.length && R.f() < 0.68) {
      const b = R.pick(belts);
      // Gaussian-ish via the sum of two uniforms: cheap, and it clusters without a hard edge.
      x = b.x + (R.f() + R.f() - 1) * b.spread;
      z = b.z + (R.f() + R.f() - 1) * b.spread;
    } else {
      x = R.range(-half * 0.92, half * 0.92);
      z = R.range(-half * 0.92, half * 0.92);
    }
    if (Math.abs(x) > half * 0.94 || Math.abs(z) > half * 0.94) continue;
    if (!clear(x, z, AST_CLEARANCE)) continue;
    /* ROCK-TO-ROCK SPACING, which clear() does NOT cover: it only tests the keep-out zones around
     * outposts, spawns and planetoids, so raising its padding did nothing to how tightly the field
     * itself packs. Without this, 103 Heleb's 288 objects had a tightest pair 28 m apart - a gap a
     * Pegasus (radius 1,174) is forty times too wide to fit through, which is why a capital could
     * not cross a field it could see straight through.
     * Tested against the rocks placed so far, so the guarantee is over the whole field rather than
     * per belt. O(n^2) on a few hundred objects per sector, which costs nothing at build time. */
    if (spots.some(p => Math.hypot(p[0] - x, p[1] - z) < AST_CLEARANCE)) continue;
    const y = R.range(-half * 0.045, half * 0.045);
    objects.push(asteroid(R.pick(ASTEROIDS), x, y, z));
    spots.push([x, z]);
    placed++;
  }

  /* NPC patrol boxes, one per faction, on the far side from that faction's own spawn so a pilot
   * meets the enemy rather than their own escort. Count rises with the system's threat level;
   * the 255 sentinel means "the enemy may not come here" and is not a level, so it is clamped. */
  const lvl = Math.min(20, Math.max(s.colThreat, s.cylThreat) === 255
    ? Math.min(s.colThreat, s.cylThreat) : Math.max(s.colThreat, s.cylThreat));
  const perEntry = Math.max(1, Math.min(4, 1 + Math.floor(lvl / 6)));
  const box = (sign) => ({
    min: vec(sign * half * 0.18, -100.0, -half * 0.62),
    max: vec(sign * half * 0.70, 100.0, half * 0.16),
  });
  const wing = (f) => {
    const t = NPCS[f];
    const e = t.strike.map(g => ({ guid: g, lootId: NPC_LOOT, count: perEntry }));
    if (lvl >= 8) e.push(...t.escort.map(g => ({ guid: g, lootId: ESCORT_LOOT, count: Math.max(1, perEntry - 1) })));
    if (lvl >= 14) e.push(...t.line.map(g => ({ guid: g, lootId: LINE_LOOT, count: 1 })));
    return e;
  };
  const botSpawnTemplates = ['Colonial', 'Cylon'].map(f => ({
    spawnArea: box(f === 'Colonial' ? 1 : -1),          // opposite the faction's own spawn side
    lifeTimeSeconds: 3600, respawnTimeSeconds: 30, respawnTimeDeath: 600,
    faction: f,
    npcSpawnEntries: wing(f),
  }));
  /* The bosses. One per faction, only where that faction's OWN threat is 18+ (so the Kraken
   * haunts deep Cylon space and the Poseidon deep Colonial space, matching where the events put
   * them), two-hour respawn after a kill, and they keep the faction's spawn side - a boss is an
   * anchor, not an ambush. 255 is the "may not enter" sentinel, not a threat level. */
  for (const f of ['Colonial', 'Cylon']) {
    const own = f === 'Colonial' ? s.colThreat : s.cylThreat;
    if (own >= 18 && own !== 255) botSpawnTemplates.push({
      spawnArea: box(f === 'Colonial' ? -1 : 1),
      lifeTimeSeconds: 3600, respawnTimeSeconds: 300, respawnTimeDeath: 7200,
      faction: f,
      npcSpawnEntries: [{ guid: NPCS[f].boss, lootId: BOSS_LOOT, count: 1 }],
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

  /* ---- sectors 0 and 6: the base sectors, which had NO Outpost template at all.
   * OutpostSpawnTimer.java:43-56 spawns one unconditionally in a base sector and never consults
   * OutpostState - but the timer is only registered when BOTH progress templates are non-null
   * (SectorFactory.java:333), and neither file had them; and createOutpost then needs an Outpost
   * entry of that faction or it throws IllegalStateException into spawnOp's catch. Two faults
   * stacked, both silent, so the branch had never once run. */
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

    if (tpl.some(t => t.spaceEntityType === 'Outpost' || t.spaceEntityType === 'WeaponPlatform')) {
      if (dirty) fs.writeFileSync(p, JSON.stringify(doc, null, 2) + '\n');
      notes.push(`sector ${id}: already has an outpost, unchanged`);
      continue;
    }
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
  let written = 0;

  for (const s of generated) {
    if (UPSTREAM_TEMPLATES.has(s.id)) throw new Error('refusing to overwrite upstream sector ' + s.id);
    const safe = s.name.replace(/[^A-Za-z0-9]+/g, '');
    const file = `sectorTemplate${s.id}_${safe}.json_v3.json`;
    keep.add(file);
    const body = JSON.stringify(buildSector(s), null, 2) + '\n';
    const p = path.join(OUT, file);
    // Only write when the bytes differ, so an unchanged sector keeps its mtime and a re-run of
    // the emitter after a STAGE bump shows exactly which files are new.
    if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== body) {
      fs.writeFileSync(p, body);
      written++;
    }
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
  const totalObjects = generated.reduce((n, s) => n + buildSector(s).spaceObjectTemplates.length, 0);
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
