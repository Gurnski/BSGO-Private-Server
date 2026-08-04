'use strict';
/*
 * BSGO card generator.
 *
 * Emits ServerConfigurationUtils/global/JsonCards/*.json for BSGOCore.
 *
 * Why a generator instead of hand-written JSON: a single logical thing (a ship) is 6-7 cards
 * sharing one GUID across different CardViews, and every reference-typed field must be present
 * or the server NPEs while serialising. Declaring a ship once and expanding it here keeps the
 * card graph consistent and makes tuning a one-line edit.
 *
 * Hard-won rules encoded below (all verified against the compiled server + the real client):
 *  - EVERY card needs THREE keys: cardGUID, cardView (int, dispatch only), cardView2 (string,
 *    the actual bound field). cardView2 as an int silently becomes null -> NPE in Catalogue.
 *  - Gson allocates cards via UnsafeAllocator, so Java field initialisers DO NOT run. Any
 *    reference-typed field the writer touches must be present in the JSON.
 *  - Strings must be ASCII: writeString prefixes with String.length() but emits getBytes(),
 *    so a multi-byte char desynchronises the client's stream.
 *  - PrefabName carries NO extension - the client appends .prefab / _lowres.prefab itself.
 *  - One GUID carries Ship + World + GUI (+ Owner/Movement/Camera/ShipLight). ShipCard.Read
 *    fetches the World and GUI cards by its OWN guid, and blocks forever if they never arrive.
 *  - An unknown cardView int aborts the ENTIRE catalogue load, so validate before writing.
 */

const fs = require('fs');
const path = require('path');

// BSGOCore checkout: override with BSGOCORE_PATH if it is not a sibling of this repo.
const CORE_ROOT = process.env.BSGOCORE_PATH ? path.resolve(process.env.BSGOCORE_PATH) : path.resolve(__dirname, '../../server');
const CORE_SRC = path.join(CORE_ROOT, 'src/main/java/io/github/luigeneric');

// ---------------------------------------------------------------- CardView table
const VIEW = {
  GUI: 1, ShipSystem: 2, ShipConsumable: 3, World: 4, Global: 5, ShipAbility: 6,
  Counter: 7, Skill: 8, Ship: 10, Sector: 11, Starter: 13, Room: 14, Mission: 16,
  Reward: 18, Title: 19, Duty: 20, AvatarCatalogue: 21, Module: 22, Price: 23,
  Missile: 24, ShipList: 25, StickerList: 26, Movement: 28, Owner: 29, GalaxyMap: 30,
  Camera: 31, MailTemplate: 32, StarterKit: 34, ShipPaint: 35, Regulation: 36,
  ShipSale: 37, SectorEvent: 38, Tournament: 39, ShipLight: 42, EventShop: 43,
  GlobalBonusEvent: 44, Banner: 45, ConversionCampaign: 46, Zone: 47, NonShipStats: 48,
};

// GUIDs the client hardcodes - these are NOT ours to choose.
const STATIC = {
  shipListColonial: 73551268,
  shipListCylon: 188756164,
  stickerList: 166885587,
  avatarCatalogue: 109873795,
  galaxyMap: 150576033,
  global: 49842157,
};

const card = (guid, view, body) => Object.assign(
  { cardGUID: guid, cardView: VIEW[view], cardView2: view }, body);

const V3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const V2 = (x = 0, y = 0) => ({ x, y });
const QUAT = (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w });
const RGBA = (r, g, b, a = 1.0) => ({ r, g, b, a });
const stats = o => ({ stats: o || {} });
const price = o => ({ items: o || {} });
const bg = (prefabName, color) => ({
  prefabName, color: color || RGBA(1, 1, 1), position: V3(), rotation: QUAT(),
});

/* Avatar asset lists, verified present in the client's assetmap.json.
 * Heads/hair/suits are sub-meshes inside a single avatar_human_<sex>.prefab, so those item names
 * cannot be checked against the asset map - but faces, hands and hair materials are real files.
 *
 * The client does NOT read index 0 for the default. AvatarSelector.Create's human block
 * hard-indexes hair[2], head[6], faces_tex[3], hands_tex[3] and hair_[<hair[2]>][4]. NATURAL
 * ORDER IS THEREFORE REQUIRED, not cosmetic - it is the only ordering under which those five
 * land on the values AvatarSelector.GetDefault documents. An earlier version of this file hoisted
 * the default to index 0 and produced a subtly wrong avatar with blank hair colour. */
const faceList = sex =>             // bundle avatar_<sex>_faces
  Array.from({ length: 10 }, (_, i) => `${sex}_face_${i + 1}.tga`);
const handList = sex =>             // bundle avatar_<sex>_hands
  Array.from({ length: 10 }, (_, i) => `${sex}_hands${i + 1}.png`);
const hairMats = stem =>            // bundle avatar_<sex>_hair_mateials: <stem>.mat + _2.._7.mat
  [`${stem}.mat`, ...Array.from({ length: 6 }, (_, i) => `${stem}_${i + 2}.mat`)];
// bundle avatar_male_beard_materials: each mesh has .mat + _2.._5.mat
const BEARD_MESHES = ['volume_beard_01_01', 'volume_beard_01_02', 'volume_beard_02_01',
                      'volume_beard_02_02', 'volume_beard_02_03', 'volume_beard_03_01',
                      'volume_beard_03_03'];
const beardMats = stem =>
  [`${stem}.mat`, ...Array.from({ length: 4 }, (_, i) => `${stem}_${i + 2}.mat`)];
const seq = (stem, n, pad) => Array.from({ length: n },
  (_, i) => stem + (pad ? String(i + 1).padStart(2, '0') : i + 1));

/* Item slot options.
 * hair and beard names are REAL - derived from the material assets that reference them.
 * Centurion parts likewise have verified v1/v2 variants.
 * head / suit / glasses / helmet have no corresponding material bundle, so those names follow
 * the same observed convention but are UNVERIFIED - a wrong sub-mesh name fails to enable a
 * mesh rather than throwing, whereas a short list throws, so erring long is the safe direction. */
const humanItems = sex => ({
  // index 6 must land on <sex>_head_08. Omitting _07 is the only ordering that achieves that
  // with real-looking names. HEAD NAMES ARE UNVERIFIED - no material bundle references them.
  head: ['01', '02', '03', '04', '05', '06', '08', '09', '10'].map(n => `${sex}_head_${n}`),
  hair: seq(`${sex}_hair_`, 10, true),   // index 2 -> <sex>_hair_03
  suit: seq(`${sex}_suit_`, 5, true),    // index 0 -> <sex>_suit_01
  // These three resolve via GetIndexOfItemEmpty, which scans for the first name containing
  // "_empty" - only its PRESENCE matters, not its position.
  beard: ['volume_beard_empty', ...BEARD_MESHES],
  glasses: ['glasses_empty', ...seq('glasses_', 3, true)],
  helmet: ['helmet_empty', ...seq('helmet_', 3, true)],
});
/* FLIGHT STATS - mandatory on every ship card.
 * MovementController reads all of these with getStatOrDefault, which returns 0 when the stat is
 * absent. Zero rotation speeds are not merely "a slow ship": the turn math divides by maxRoll and
 * scales by YawMaxSpeed, so a missing block produces NaN and the sector's movement updater throws
 * "roll is NaN" every single tick - which manifests as an invisible ship that cannot move, with
 * no client-side error at all. A ship card without these is broken, not just unbalanced. */
const flightStats = ({ speed, boost, accel, pitch, yaw, roll, strafe }) => ({
  Speed: speed, BoostSpeed: boost, Acceleration: accel,
  PitchMaxSpeed: pitch, PitchAcceleration: pitch * 2,
  YawMaxSpeed: yaw, YawAcceleration: yaw * 2,
  RollMaxSpeed: roll, RollAcceleration: roll * 2,
  StrafeMaxSpeed: strafe, StrafeAcceleration: strafe * 2,
  // Unboxed into a primitive on EVERY gear change to Boost. Absent => NullPointerException =>
  // the server closes the socket. Pressing boost would disconnect you instantly.
  // 1.0 is neutral; 1.5 is a balance choice.
  AccelerationMultiplierOnBoost: 1.5,
  /* Unboxed on a jump request, same crash class. FtlRange must be >= 80: the two galaxy-map
   * stars sit at x=-40 and x=+40 and the gate is jumpDistance <= FtlRange. A range failure is
   * reported to the player as "sector closed", which is thoroughly misleading.
   * FtlCharge is a charge time in seconds.
   *
   * FtlCost is PER UNIT OF DISTANCE, not per jump: JumpTimer.java:104-106 charges
   * ceil(FtlCost * distance) in tylium. At the 100 I originally set, the 80-unit hop between the
   * two home sectors cost 8,000 tylium - three jumps on the whole starting grant - and the client
   * silently greys out every star you cannot afford, because it gates on
   * min(FTLRange, Hold.Tylium / FTLCost) (Me.cs:160). No error, just an unusable galaxy map.
   *
   * 1 is the canonical value, corroborated twice over: victti's dump stores FtlCost 1, and the
   * wiki displays 20 Tyl/LY, which reconciles exactly through the client's own x20 transform
   * (SystemsStatsGenerator.cs:663) at 20 units per light-year. So a home-to-home hop is 80 tylium.
   * The same two sources agree FtlCooldown is 35, not the 30 I guessed. */
  FtlRange: 200, FtlCharge: 10, FtlCooldown: 35, FtlCost: 1,
  // Read safely with a default, so quality-of-life rather than crash fixes.
  InertiaCompensation: 10, BoostCost: 1, HullRecovery: 5,
  /* SENSOR RADII. Client-only, but a missing one is not "short-sighted" - it is BLIND.
   * The client squares the distance and compares against these, and falls through to
   * `return false` when the radius is 0, so IsInMapRange is false FOREVER for every ship.
   * That kills, in order: the HUD bracket (the Image is DISABLED, and a disabled Image is not a
   * UI raycast target - hence "I can see it but there's nothing to click"), the name tag, the
   * range read-out, crosshair targeting, the DRADIS scope and the system map.
   * Asteroids, comets and planets are exempt from that check; ships are NOT - which is exactly
   * why rocks were clickable and NPCs were not.
   *   Inner  = the round DRADIS scope radius.
   *   Outer  = bracket / scanner / system-map radius. Both the name tag and the full bracket sit
   *            at Outer * a user slider defaulting to 0.5, so this wants to be generous.
   *   Visual = the see-through-cloak bubble; nothing cloaks yet, so keep it small.
   * CEILING: the server logs a "Dradis-Cheat!" warning at Outer >= 10000, on the client's own
   * timer - not fatal, but it would spam the one log we diagnose from. Stay below it.
   * NOTE: ObjectStat.DradisRange is NOT this stat - the server never reads it and the client
   * lists it among its hidden stats. It was inert all along.
   *
   * THESE ARE PLACEHOLDERS and are overridden per hull by DETECTION below. They are kept here
   * only so anything calling flightStats() without a hull (platforms, missiles) still gets a
   * non-zero radius rather than going blind. Every real hull uses the dumped table.
   *
   * WHY THIS MATTERED: I had 1500/8000/9000 flat on every ship. The real range is 200/1000/2000
   * on a Viper. DradisManager.Update() runs every 0.1s and walks
   * SpaceLevel.GetObjectRegistry().GetAllLoaded() - EVERY loaded object - keeping those whose
   * IsInMapRange passes, and IsInMapRange is computed from exactly these radii. In restored
   * Tannhauser that is 1,360 asteroids: at an 8,000 inner radius essentially all of them qualify,
   * ten times a second, and GUISystemMap:760 draws asteroid markers on top. At the real 1,000 it
   * is a small fraction. This is the first mechanism found that scales with asteroid count, which
   * is the shape of the lag reported since the sector was restored. */
  DetectionVisualRadius: 250, DetectionInnerRadius: 1000, DetectionOuterRadius: 2500,

  /* CriticalDefense. Live: DamageCalculator.java:125 feeds it to CritchanceAlgorithmV1 as
   * crit% = (5 + 0.15*(attackerCritOffense - this)) / 100.
   * It is here at 0 for a reason. ObjectStats.applyStatsAddTo (ObjectStats.java:148) only ever
   * writes a key the target map ALREADY has, and the target is seeded solely from this block -
   * so WITHOUT the key no skill, module or buff could ever move crit defence. WITH it at 0,
   * today's crit rates are unchanged (tier-1 cannon CriticalOffense 20 -> 8%, exactly as now).
   * TRAP: a 0 base is immune to MultiplyBuff, because getStatsMultiplyBonus computes
   * base*m - base == 0. Any crit-defence skill MUST therefore use StaticBuff. skill_armor_penalty
   * does. If you ever switch it to a multiplier, raise this above 0 in the same commit. */
  CriticalDefense: 0,
});

/* Deliberately NOT added, so nobody spends a skill line on them:
 *   ArmorValue / ArmorPiercing - SectorAlgorithms.defaultAlgorithms() installs ArmorAlgorithmV0,
 *     whose getMultiplicator() returns a constant 1. Armour is entirely ignored today.
 *   FirewallRating       - only DeBuffAction.java:40 reads it, and no EW ability card exists yet.
 *   Avoidance / AvoidanceFading - live in WeaponAction.isHitByWeapon, but adding them CHANGES
 *     BASE HIT RATES for every ship in the game. Deliberate balance decision only.
 *   DradisRange / MapRange - in the client's hiddenStats list and read by NOTHING, server or
 *     client. The real sensor stats are the three Detection radii above. */

const centurionParts = p => [`centurion_${p}_v1`, `centurion_${p}_v2`];
// bundle avatar_centurion_materials: centurion_<part>_v<n>_<colour>_<1..4>.mat
const centurionMats = stem => ['black', 'brown', 'green', 'grey', 'white']
  .flatMap(c => [1, 2, 3, 4].map(i => `${stem}_${c}_${i}.mat`));

/* ================================================================ SHIP DEFINITIONS
 * shipGuid values are dictated by ServerConfigurationUtils/global/ShipConfigTemplates/*.json
 * (`shipGUID` there IS ShipCard.cardGuid - SpaceObjectFactory looks up loadouts by it).
 * prefab / locaKey / paperdoll values were all verified present in the client's assetmap.json,
 * Resources index and decompressed locale bundle.
 */
/* roleDep drives the hangar's role COLUMN (the grid iterates roles 1..4 only, so never use
 * Mothership/Carrier/Stealth here).
 *
 * HangarID is load-bearing THREE times over and the constraints interact:
 *  1. Ownership: the client matches ShipCard.HangarID against the ship's serverID, and the
 *     starter is always serverID 1 - so 1 is reserved.
 *  2. Icon art: only ids {1..9, 11, 13..17} have textures; anything else renders blank.
 *  3. THE SHIP-SHOP QUEUE. It allocates an array sized by the SHOP-LISTED ship count, then
 *     indexes it by each ship's position in this hard-coded order:
 *         1, 4, 7, 11, 2, 5, 8, 13, 3, 6, 9, 14, 15    (16 and 17 are spliced in only if a
 *                                                       shop-listed ship carries them)
 *     So the shop-listed HangarIDs must be exactly a PREFIX of that order. Scatter them and it
 *     throws IndexOutOfRange on a periodic update - every frame, from the moment you enter the
 *     hangar - which reads as catastrophic lag rather than an error.
 *
 * Hence: the four ShipList entries per faction take order positions 0-3 (ids 1, 4, 7, 11) - an
 * exact prefix - and every NPC-only hull is parked on 12, which has no icon art and no queue
 * position, so it can never shadow a real hangar slot. Validated in validate().
 *
 * WHY ONE HULL PER HANGAR SLOT, not three tiers of the same model: HangarID picks the ICON, and
 * the icons at 4/7/11 are a Raptor, a Rhino and a Viper Mk VII. Listing three Vipers across those
 * slots is what made the shop show the wrong ship under the wrong name with most of the roster
 * apparently missing.
 *
 * TWO ROLE COLUMNS, NOT ONE. ShipRole (Fighter, Bomber, Command, ElectronicWarfare, Engineer,
 * Interceptor, Gunship, Picket, Destroyer, Artillery, Assault, Stealth, Carrier, Mothership) has
 * NO 'Defender' and NO 'Multi'. Those exist only in ShipRoleDeprecated (None, Fighter, Defender,
 * Command, Multi, Mothership, Carrier, Stealth). role:'Defender' would be a Gson null element and
 * an NPE on write. roleDep is what the hangar grid iterates (HangarWindow.cs:96, roles 1..4), so
 * it must vary. The Interceptor/Assault/Command values just match the locale prose.
 *
 * slotTex is its OWN column, not 'GUI/Slots/' + prefab: gui/slots/ contains no humant1merit and
 * no cylont1merit. The Viper Mk VII uses GUI/Slots/vipermk7, the War Raider GUI/Slots/warraider.
 *
 * The prefab<->loca pairs are pinned by assetmap.json texture dependencies
 * (cylont1command_heavyraider_tex, cylont1defender_marauder_tex, humant1defender_rhino_tex,
 * humant1meritt_vipermkvii_tex, cylont1merritt_warraider_tex). Do NOT swap the Cylon T1
 * assignment - ship_heavy_raider_paperdoll_layouts declaring BlueprintTexture "CylonT1Defender"
 * is a shipped-art bug inside resources.assets, cosmetic and unfixable server-side. */
/* ================================================================ THE ROSTER
 * Thirteen hulls per faction on HangarIDs 1..15, plus the command-token flagship on 17.
 *
 * HangarID is load-bearing three times over and the constraints interact:
 *  1. Ownership: the client matches ShipCard.HangarID against the ship's serverID, and the
 *     starter is always serverID 1 - so 1 is reserved for the starter hull.
 *  2. Icon art: ShipQueue loads GUI/InfoJournal/Ships/<Faction><HangarID>{_notbought|_upgraded}
 *     and then does image.Texture.width with NO null guard, so a HangarID with no texture is an
 *     NRE every frame. Verified present: 1-9, 11, 13-17. NOT present: 10, 12.
 *  3. THE SHIP-SHOP QUEUE. ShipQueue.InitIcons builds its order as
 *         1, 4, [16], 7, 11, [17], 2, 5, 8, 13, 3, 6, 9, 14, 15
 *     where 16 and 17 are spliced in ONLY if a shop-listed ship carries them. It then allocates
 *     ships[shipCards.Count] and pairs ships[i] with shipOrder[i], while PeriodicUpdate places
 *     each card at shipOrder.FindIndex(HangarID) - which returns -1, and indexes ships[-1], for
 *     any listed HangarID not in that list. So every listed HangarID must be IN the order, and
 *     the count must not exceed it. Fourteen per faction against a 14-long order: an exact fit.
 *
 * WHY ONE HULL PER HANGAR SLOT: HangarID picks the icon, so listing three Vipers across slots
 * 1/4/7 drew a Raptor and a Rhino under the Viper's name with most of the roster apparently
 * missing. Each slot now holds the ship whose art it actually is.
 *
 * TWO ROLE COLUMNS, NOT ONE. ShipRole (Fighter, Bomber, Command, ElectronicWarfare, Engineer,
 * Interceptor, Gunship, Picket, Destroyer, Artillery, Assault, Stealth, Carrier, Mothership) has
 * NO 'Defender' and NO 'Multi'. Those exist only in ShipRoleDeprecated (None, Fighter, Defender,
 * Command, Multi, Mothership, Carrier, Stealth). role:'Defender' would be a Gson null element and
 * an NPE on write. roleDep is what the hangar grid iterates (HangarWindow.cs:96, roles 1..4).
 *
 * PREFAB IDENTITY comes from each prefab's own child mesh names (CylonT1Defender_Marauder_Lod1
 * and friends), NOT from the paperdoll's BlueprintTexture - that field is swapped for the two
 * Cylon tier-1 hulls, which is what made the Heavy Raider and the Marauder trade models.
 *
 * Guids 53/56/57/77/80/81 and the two starters are PINNED - ShipConfigTemplates reference them by
 * shipGUID and Player.setupBasicHangar hardcodes the starters. New hulls take 5000+. */
/* The Pegasus / Basestar flight block. Transcribed from the Pegasus infobox
 * (research/bsgo_wiki/Battlestar Pegasus.txt:13-31); see the note on the Pegasus row below for why
 * the FTL figures are left out. Applied LAST over flightStats(), so it beats the role formula. */
const CAPITAL_FLIGHT = {
  Speed: 25, BoostSpeed: 35, Acceleration: 3, BoostCost: 30,
  PitchMaxSpeed: 6, YawMaxSpeed: 6, RollMaxSpeed: 6,
  PitchAcceleration: 3, YawAcceleration: 3, RollAcceleration: 3,
  StrafeMaxSpeed: 0, StrafeAcceleration: 0,
  InertiaCompensation: 40,
  /* Hull and energy, same infobox. These are the numbers that make a battlestar a battlestar:
   * 80,000 hull against the 15,400 we shipped, and 2,000 power against 660. The dump has no
   * Pegasus to cross-check against, but for all 22 hulls it DOES cover the wiki matches it to the
   * digit, so the infobox has earned the benefit of the doubt on these two.
   * Recovery figures are per second, as written ("Hull Recovery = 110/Sec"). */
  MaxHullPoints: 80000, MaxPowerPoints: 2000,
  HullRecovery: 110, PowerRecovery: 60,
  /* Not flight, but from the same block and equally wrong today: 60 armour, 200 critical defence.
   * CriticalDefense in particular shipped as 0 on every hull. */
  ArmorValue: 60, CriticalDefense: 200,
};

/* The Galactica / Guardian Basestar block - the flagship step above CAPITAL_FLIGHT.
 *
 * ONE OBJECT, TWO HULLS, ON PURPOSE. Both rows below carry `realStats: FLAGSHIP_FLIGHT`, i.e. the
 * SAME object reference, exactly as the Pegasus and Basestar share CAPITAL_FLIGHT. That is what
 * guarantees the Colonial and Cylon flagships can never drift apart: there is no second copy of
 * these numbers to edit, so a change to one hull's performance is a change to both or it is not
 * possible at all. Do not "specialise" one of them by spreading this into a per-hull literal - the
 * moment there are two objects, the next tuning pass silently makes one faction's flagship better.
 *
 * DERIVED FROM CAPITAL_FLIGHT, not typed out fresh, so the relationship stays visible and the
 * handling family stays recognisably capital-ship. Two groups change:
 *   HANDLING, +12% speed and +1 deg/s of turn. Justified by measurement, not by feel: the Galactica
 *     mesh is 1441 units long and the Guardian 1216 wide, against the Pegasus's 1815 and the
 *     Basestar's 2084 (root-local mesh AABB over every MeshFilter, extracted 2026-08-03). These two
 *     are the SMALLER capitals, so being marginally less ponderous is the honest reading.
 *   ENDURANCE, the flagship step. 100,000 hull and 2,500 power against 80,000 and 2,000, with
 *     recovery, armour and critical defence moved by the same quarter. Nothing here is attested -
 *     there is no wiki infobox for either hull as a player ship - so it is one deliberate ratio
 *     applied to a block that IS attested, rather than a set of invented figures.
 * The armament does NOT step up with the stats: both fly 8 mounts against the Pegasus's 12 (see
 * HULL_SLOTS). A flagship here is tougher and longer-winded, not better armed. */
const FLAGSHIP_FLIGHT = Object.assign({}, CAPITAL_FLIGHT, {
  Speed: 28, BoostSpeed: 39, Acceleration: 3.5,
  PitchMaxSpeed: 7, YawMaxSpeed: 7, RollMaxSpeed: 7,
  PitchAcceleration: 3.5, YawAcceleration: 3.5, RollAcceleration: 3.5,
  InertiaCompensation: 45,
  MaxHullPoints: 100000, MaxPowerPoints: 2500,
  HullRecovery: 137, PowerRecovery: 75,
  ArmorValue: 75, CriticalDefense: 250,
});

const HULLS = [
  /* Hangar 16 and 17 restored to their original occupants: the second merit line and the
   * stealth ships. Identities, prices and paperdolls are the dump's own - Mk III line 23,000
   * cubits, stealth pair 35,000 of the merits currency (ResourceType.Token internally).
   * Hardpoints extracted from the client bundles 2026-08-02; slots and flight stats ride in
   * from hulls-real.js like every other hull. */
  { g: 5016, name: 'Viper Mk III', faction: 'Colonial', hangar: 16, tier: 1,
    prefab: 'humant1multi2', objKey: 163729268, loca: 'ship_viper_mk3', paperdoll: 'ship_viper_mk3_paperdoll_layouts',
    role: 'Fighter', roleDep: 'Multi', lvl: 1, tyl: 23000, cubits: 23000,
    hp: 1050, pwr: 105, speed: 112, agility: 1.1, extent: 6 },
  { g: 5018, name: 'Raven Mk VI-R', faction: 'Colonial', hangar: 17, tier: 1,
    prefab: 'humant1stealth', objKey: 59555849, loca: 'ship_colonial_strike_stealth', paperdoll: 'ship_colonial_strike_stealth_paperdoll_layouts',
    role: 'Stealth', roleDep: 'Stealth', lvl: 1, tyl: 35000, tokens: 35000,
    hp: 900, pwr: 95, speed: 118, agility: 1.2, extent: 6 },
  { g: 5116, name: 'Cylon War Raider Mk II', faction: 'Cylon', hangar: 16, tier: 1,
    prefab: 'cylont1multi2', objKey: 189973171, loca: 'ship_war_raider_mk2', paperdoll: 'ship_war_raider_mk2_paperdoll_layouts',
    role: 'Fighter', roleDep: 'Multi', lvl: 1, tyl: 23000, cubits: 23000,
    hp: 1050, pwr: 105, speed: 112, agility: 1.1, extent: 6 },
  { g: 5118, name: 'Malefactor Type-1', faction: 'Cylon', hangar: 17, tier: 1,
    prefab: 'cylont1stealth', objKey: 113318329, loca: 'ship_cylon_strike_stealth', paperdoll: 'ship_cylon_strike_stealth_paperdoll_layouts',
    role: 'Stealth', roleDep: 'Stealth', lvl: 1, tyl: 35000, tokens: 35000,
    hp: 900, pwr: 95, speed: 118, agility: 1.2, extent: 6 },
  // ---- Colonial
  { g: 2366349390, name: 'Viper Mk II', faction: 'Colonial', hangar: 1, tier: 1,
    prefab: 'humant1fighter', objKey: 107780547, loca: 'ship_viper', paperdoll: 'ship_viper_paperdoll_layouts',
    role: 'Interceptor', roleDep: 'Fighter', lvl: 1, tyl: 12000,
    hp: 850, pwr: 90, speed: 115, agility: 1.15, extent: 5, starter: true },
  { g: 5002, name: 'Scythe', faction: 'Colonial', hangar: 2, tier: 2,
    prefab: 'humant2fighter', objKey: 110816915, loca: 'ship_berserker', paperdoll: 'ship_berserker_paperdoll_layouts',
    role: 'Fighter', roleDep: 'Fighter', lvl: 7, tyl: 60000,
    hp: 1700, pwr: 140, speed: 110, agility: 1.15, extent: 77 },
  { g: 5003, name: 'Aesir', faction: 'Colonial', hangar: 3, tier: 3,
    prefab: 'humant3fighter', objKey: 154840275, loca: 'ship_gunstar', paperdoll: 'ship_gunstar_paperdoll_layouts',
    role: 'Fighter', roleDep: 'Fighter', lvl: 15, tyl: 150000,
    hp: 3050, pwr: 220, speed: 106, agility: 1.15, extent: 210 },
  { g: 53, name: 'Raptor', faction: 'Colonial', hangar: 4, tier: 1,
    prefab: 'humant1command', objKey: 116493059, loca: 'ship_raptor', paperdoll: 'ship_raptor_paperdoll_layouts',
    role: 'Command', roleDep: 'Command', lvl: 2, tyl: 15000,
    hp: 1150, pwr: 110, speed: 95, agility: 0.95, extent: 5 },
  { g: 5005, name: 'Glaive', faction: 'Colonial', hangar: 5, tier: 2,
    prefab: 'humant2command', objKey: 257248147, loca: 'ship_avenger', paperdoll: 'ship_avenger_paperdoll_layouts',
    role: 'Command', roleDep: 'Command', lvl: 9, tyl: 60000,
    hp: 2300, pwr: 200, speed: 91, agility: 0.95, extent: 63.5 },
  { g: 5006, name: 'Vanir', faction: 'Colonial', hangar: 6, tier: 3,
    prefab: 'humant3command', objKey: 218435475, loca: 'ship_cruiser', paperdoll: 'ship_cruiser_paperdoll_layouts',
    role: 'Command', roleDep: 'Command', lvl: 17, tyl: 150000,
    hp: 4150, pwr: 300, speed: 87, agility: 0.95, extent: 190 },
  { g: 56, name: 'Rhino', faction: 'Colonial', hangar: 7, tier: 1,
    prefab: 'humant1defender', objKey: 107966800, loca: 'ship_rhino', paperdoll: 'ship_rhino_paperdoll_layouts',
    role: 'Assault', roleDep: 'Defender', lvl: 3, tyl: 18000,
    hp: 1350, pwr: 140, speed: 85, agility: 0.85, extent: 9 },
  { g: 5008, name: 'Maul', faction: 'Colonial', hangar: 8, tier: 2,
    prefab: 'humant2defender', objKey: 218289587, loca: 'ship_dominator', paperdoll: 'ship_dominator_paperdoll_layouts',
    role: 'Assault', roleDep: 'Defender', lvl: 11, tyl: 60000,
    hp: 2700, pwr: 230, speed: 82, agility: 0.85, extent: 88.5 },
  { g: 5009, name: 'Jotunn', faction: 'Colonial', hangar: 9, tier: 3,
    prefab: 'humant3defender', objKey: 220899717, loca: 'ship_dreadnought', paperdoll: 'ship_dreadnought_paperdoll_layouts',
    role: 'Assault', roleDep: 'Defender', lvl: 19, tyl: 150000,
    hp: 4850, pwr: 350, speed: 78, agility: 0.85, extent: 220 },
  { g: 57, name: 'Viper Mk VII', faction: 'Colonial', hangar: 11, tier: 1,
    prefab: 'humant1merit', objKey: 163729272, loca: 'ship_viper_mk7', paperdoll: 'ship_viper_mk7_paperdoll_layouts',
    role: 'Fighter', roleDep: 'Multi', lvl: 5, tyl: 25000,
    hp: 1000, pwr: 100, speed: 110, agility: 1.1, extent: 6 },
  { g: 5013, name: 'Halberd', faction: 'Colonial', hangar: 13, tier: 2,
    prefab: 'humant2merit', objKey: 167611093, loca: 'ship_halberd', paperdoll: 'ship_halberd_paperdoll_layouts',
    role: 'Gunship', roleDep: 'Multi', lvl: 13, tyl: 60000,
    hp: 2000, pwr: 170, speed: 106, agility: 1.1, extent: 75 },
  { g: 5014, name: 'Gungnir', faction: 'Colonial', hangar: 14, tier: 3,
    prefab: 'humant3merit', objKey: 154919763, loca: 'ship_gungnir', paperdoll: 'ship_gungnir_paperdoll_layouts',
    role: 'Gunship', roleDep: 'Multi', lvl: 21, tyl: 150000,
    hp: 3600, pwr: 260, speed: 101, agility: 1.1, extent: 245 },
  { g: 5015, name: 'Brimir', faction: 'Colonial', hangar: 15, tier: 4,
    prefab: 'humant4carrier', objKey: 98636899, loca: 'ship_brimir', paperdoll: 'ship_brimir_paperdoll_layouts',
    /* Two variant buttons, not one. ShipIcon.variantIcons is `new GuiButton[3]` (ShipIcon.cs:27)
     * and ShipQueue allocates [count, 3] as well, so THREE is the hard ceiling on this cell and
     * the pair below fits. A fourth variant would be silently unreachable: HangarWindow
     * .AddShipIconAndVariant iterates variantIcons, not VariantHangarIDs, so the extra id is never
     * drawn and the hull becomes uncommandable rather than throwing. */
    role: 'Carrier', roleDep: 'Carrier', lvl: 24, tyl: 420000, variants: [18, 19],
    hp: 14000, pwr: 600, speed: 52, agility: 0.55, extent: 379 },
  /* CAPITALS DO NOT FLY LIKE FIGHTERS, and until now this one did: speed 52 and agility 0.55 are
   * the same figures as a tier-4 strike hull, on a ship 1,174 units long. The dump has no Pegasus
   * (that server never had one), so the flight numbers come from the wiki infobox instead -
   * research/bsgo_wiki/Battlestar Pegasus.txt:13-31, which gives the lot:
   *   Speed 25 m/s   Boost 35   Acceleration 3 m/s2   Turning 6 deg/s   Turning accel 3 deg/s2
   *   Inertial Compensation 40   Boost Cost 30 Tyl/s
   * Twenty-five metres per second against the 52 we were flying, and six degrees per second against
   * a fighter's fifty-two. A battlestar is supposed to be ponderous.
   * Inertial Compensation 40 is what stops the drift: it is the rate the sideways component of
   * velocity decays (MovementSimulation.advanceLinearSpeed:164), so a low value leaves the ship
   * sliding through its own turns.
   * Roll is the one figure the infobox omits - set to the turning pair, because a hull this size
   * has no reason to roll faster than it yaws, and RollMaxSpeed may never be zero (the roll term
   * divides by it).
   * FTL is deliberately NOT taken from the infobox. It lists 1,000 Tyl/LY, which at 20 units per
   * light year is 50 tylium per unit - the affordability validator exists precisely to stop a
   * pilot being stranded, and one hop would cost a third of the starting grant. The Pegasus is a
   * one-hour rental, so its economics are a separate question from its handling. */
  /* PREFAB IS 'humant4pegasus', NOT 'pegasus'. The client ships two Pegasus prefabs on the same
   * meshes (Pegasus_LOD1-4, identical root AABBs, both depending on humant4pegasus_tex); they
   * differ only in the mount container. 'pegasus' is the decorative/mission copy and
   * 'humant4pegasus' is the flyable one. Three independent tells, all checked against the bundles:
   *   - low_res_ship_prefabs carries a lowres for every FLYABLE hull, humant4pegasus_lowres
   *     included. There is no pegasus_lowres. The LOD swap needs one; a set-dressing prop does not.
   *   - humant4pegasus's ten broadside mounts mirror about x to 1.5e-4 units and their rotations to
   *     under 0.01 deg. 'pegasus' skews up to 1.695 units and its mirror plane wanders off centre
   *     by as much as 0.85 on a hull whose mesh is symmetric to 0.000.
   *   - 'pegasus' puts BOTH point-defence mounts at x=0, y=0, z=-19/+26 - inside the hull volume,
   *     both facing aft. humant4pegasus puts them at z=+528 facing forward and z=-508 facing aft,
   *     which is bow and stern. Turret models parent to the prefab transform (Modules.cs:46-71), so
   *     the shipped pair rendered buried in the ship.
   * DURABILITY, HARDPOINTS and HULL_SLOTS are all keyed by this string and were renamed with it.
   * The ColliderTemplate is keyed by it too and lives OUTSIDE this file - see the note in
   * HARDPOINTS.humant4pegasus. */
  { g: 5017, name: 'Pegasus', faction: 'Colonial', hangar: 18, parentHangar: 15, tier: 4,
    prefab: 'humant4pegasus', loca: 'ship_commandtoken_pegasus', paperdoll: 'ship_commandtoken_pegasus_paperdoll_layouts',
    role: 'Mothership', roleDep: 'Mothership', lvl: 1, tyl: 25000, tokens: 20000, rentalOnly: true,
    hp: 15400, pwr: 660, speed: 52, agility: 0.55, extent: 1174,
    realStats: CAPITAL_FLIGHT },
  /* GALACTICA. Second Colonial flagship, and the Guardian Basestar's opposite number - the two
   * share FLAGSHIP_FLIGHT by reference, which is the whole of the parity guarantee.
   *
   * HangarID 19 is FREE in both factions: 1-9, 11 and 13-17 are the strike roster, 12 is where the
   * NPC clones park, 15 is the tier-4 carrier, 18 is the Pegasus/Basestar. It has no
   * GUI/InfoJournal/Ships art, and needs none - a ParentHangarID moves this card out of
   * ShipListCard.ShipCards into VariantShipCards before either the hangar grid or the shop queue
   * iterates it, and the variant button is a fixed texture with a text label.
   *
   * hp/pwr/speed/agility below are the FORMULA INPUTS, not the emitted stats: flightStats() runs on
   * them first and FLAGSHIP_FLIGHT then overwrites every field it names (see the Stats assign in
   * shipCards). They are the Pegasus's, so the two capital pairs differ only where the shared block
   * says they do.
   *
   * LOCA. There is no ship_galactica key anywhere in the 14,055-key set - she was never a player
   * hull - so this borrows cruiser_galactica, which is the one candidate whose .Description reads
   * like ship copy ("The mothership of the Colonial fleet") rather than an icon label. Reuse is
   * safe: loca keys are not unique per card and CRUISERS guid 29 already points here.
   * PAPERDOLL is the Pegasus's. No layout was ever authored for this hull; the Pegasus layout
   * defines big-layout slot ids 0-13 at level 1, which covers everything HULL_SLOTS assigns. */
  { g: 5019, name: 'Galactica', faction: 'Colonial', hangar: 19, parentHangar: 15, tier: 4,
    prefab: 'galactica', loca: 'cruiser_galactica', paperdoll: 'ship_commandtoken_pegasus_paperdoll_layouts',
    role: 'Mothership', roleDep: 'Mothership', lvl: 1, tyl: 25000, tokens: 20000, rentalOnly: true,
    hp: 15400, pwr: 660, speed: 52, agility: 0.55, extent: 725,
    realStats: FLAGSHIP_FLIGHT },
  // ---- Cylon
  { g: 1427261742, name: 'Raider', faction: 'Cylon', hangar: 1, tier: 1,
    prefab: 'cylont1fighter', objKey: 117312163, loca: 'ship_raider', paperdoll: 'ship_raider_paperdoll_layouts',
    role: 'Interceptor', roleDep: 'Fighter', lvl: 1, tyl: 12000,
    hp: 850, pwr: 90, speed: 115, agility: 1.15, extent: 8, starter: true },
  { g: 5102, name: 'Banshee', faction: 'Cylon', hangar: 2, tier: 2,
    prefab: 'cylont2fighter', objKey: 107550633, loca: 'ship_wrath', paperdoll: 'ship_wrath_paperdoll_layouts',
    role: 'Fighter', roleDep: 'Fighter', lvl: 7, tyl: 60000,
    hp: 1700, pwr: 140, speed: 110, agility: 1.15, extent: 88 },
  { g: 5103, name: 'Fenrir', faction: 'Cylon', hangar: 3, tier: 3,
    prefab: 'cylont3fighter', objKey: 6704946, loca: 'ship_nova', paperdoll: 'ship_nova_paperdoll_layouts',
    role: 'Fighter', roleDep: 'Fighter', lvl: 15, tyl: 150000,
    hp: 3050, pwr: 220, speed: 106, agility: 1.15, extent: 238 },
  { g: 77, name: 'Heavy Raider', faction: 'Cylon', hangar: 4, tier: 1,
    prefab: 'cylont1command', objKey: 51742547, loca: 'ship_heavy_raider', paperdoll: 'ship_heavy_raider_paperdoll_layouts',
    role: 'Command', roleDep: 'Command', lvl: 2, tyl: 15000,
    hp: 1150, pwr: 110, speed: 95, agility: 0.95, extent: 7.5 },
  { g: 5105, name: 'Spectre', faction: 'Cylon', hangar: 5, tier: 2,
    prefab: 'cylont2command', objKey: 234139110, loca: 'ship_spectre', paperdoll: 'ship_spectre_paperdoll_layouts',
    role: 'Command', roleDep: 'Command', lvl: 9, tyl: 60000,
    hp: 2300, pwr: 200, speed: 91, agility: 0.95, extent: 70 },
  { g: 5106, name: 'Hel', faction: 'Cylon', hangar: 6, tier: 3,
    prefab: 'cylont3command', objKey: 24730942, loca: 'ship_phantom', paperdoll: 'ship_phantom_paperdoll_layouts',
    role: 'Command', roleDep: 'Command', lvl: 17, tyl: 150000,
    hp: 4150, pwr: 300, speed: 87, agility: 0.95, extent: 220 },
  { g: 80, name: 'Marauder', faction: 'Cylon', hangar: 7, tier: 1,
    prefab: 'cylont1defender', objKey: 107878853, loca: 'ship_scout', paperdoll: 'ship_scout_paperdoll_layouts',
    role: 'Assault', roleDep: 'Defender', lvl: 3, tyl: 18000,
    hp: 1350, pwr: 140, speed: 85, agility: 0.85, extent: 8 },
  { g: 5108, name: 'Wraith', faction: 'Cylon', hangar: 8, tier: 2,
    prefab: 'cylont2defender', objKey: 268081382, loca: 'ship_banshee', paperdoll: 'ship_banshee_paperdoll_layouts',
    role: 'Assault', roleDep: 'Defender', lvl: 11, tyl: 60000,
    hp: 2700, pwr: 230, speed: 82, agility: 0.85, extent: 84 },
  { g: 5109, name: 'Jormung', faction: 'Cylon', hangar: 9, tier: 3,
    prefab: 'cylont3defender', objKey: 61514333, loca: 'ship_sentinel', paperdoll: 'ship_sentinel_paperdoll_layouts',
    role: 'Assault', roleDep: 'Defender', lvl: 19, tyl: 150000,
    hp: 4850, pwr: 350, speed: 78, agility: 0.85, extent: 200 },
  { g: 81, name: 'Cylon War Raider', faction: 'Cylon', hangar: 11, tier: 1,
    prefab: 'cylont1merit', objKey: 11152787, loca: 'ship_raider_1b', paperdoll: 'ship_raider_1b_paperdoll_layouts',
    role: 'Fighter', roleDep: 'Multi', lvl: 5, tyl: 25000,
    hp: 1000, pwr: 100, speed: 110, agility: 1.1, extent: 4 },
  { g: 5113, name: 'Liche', faction: 'Cylon', hangar: 13, tier: 2,
    prefab: 'cylont2merit', objKey: 107308774, loca: 'ship_liche', paperdoll: 'ship_liche_paperdoll_layouts',
    role: 'Gunship', roleDep: 'Multi', lvl: 13, tyl: 60000,
    hp: 2000, pwr: 170, speed: 106, agility: 1.1, extent: 63 },
  { g: 5114, name: 'Nidhogg', faction: 'Cylon', hangar: 14, tier: 3,
    prefab: 'cylont3merit', objKey: 57013176, loca: 'ship_nidhogg', paperdoll: 'ship_nidhogg_paperdoll_layouts',
    role: 'Gunship', roleDep: 'Multi', lvl: 21, tyl: 150000,
    hp: 3600, pwr: 260, speed: 101, agility: 1.1, extent: 175 },
  { g: 5115, name: 'Surtur', faction: 'Cylon', hangar: 15, tier: 4,
    prefab: 'cylont4carrier', objKey: 114650019, loca: 'ship_surtur', paperdoll: 'ship_surtur_paperdoll_layouts',
    // Second variant button - see the Brimir row for why three is the ceiling.
    role: 'Carrier', roleDep: 'Carrier', lvl: 24, tyl: 420000, variants: [18, 20],
    hp: 14000, pwr: 600, speed: 52, agility: 0.55, extent: 375 },
  /* The Basestar is the Pegasus's stated counterpart (the infobox says so on both pages) and the
   * two are deliberately matched in every other figure we ship, so it takes the same flight block.
   * Its own wiki page has no infobox numbers to check this against. */
  { g: 5117, name: 'Basestar', faction: 'Cylon', hangar: 18, parentHangar: 15, tier: 4,
    prefab: 'basestar', loca: 'ship_commandtoken_basestar', paperdoll: 'ship_commandtoken_basestar_paperdoll_layouts',
    role: 'Mothership', roleDep: 'Mothership', lvl: 1, tyl: 25000, tokens: 20000, rentalOnly: true,
    hp: 15400, pwr: 660, speed: 52, agility: 0.55, extent: 863,
    realStats: CAPITAL_FLIGHT },
  /* GUARDIAN BASESTAR. The Galactica's opposite number; same shared FLAGSHIP_FLIGHT object, same
   * shape of row, HangarID 20 (free in both factions - see the Galactica note on 19).
   *
   * LOCA ship_basestar_guardian resolves .Name "Guardian Basestar" and carries a .Description,
   * which is an EMPTY STRING rather than absent - that resolves, so the description widgets get ""
   * instead of the null they would NRE on. enemy_basestar_guardian_winter2016 at locaLevel 1 is the
   * alternative if a non-empty blurb is ever wanted ("Captured Guardian Basestar"); it is not used
   * here because a captured-ship description on a rented flagship reads as a different item.
   * PAPERDOLL is the Basestar's, for the same reason the Galactica takes the Pegasus's: none was
   * authored for this hull, and 0-13 at level 1 covers every slot assigned below. */
  { g: 5119, name: 'Guardian Basestar', faction: 'Cylon', hangar: 20, parentHangar: 15, tier: 4,
    prefab: 'cylont4wing_guardian', loca: 'ship_basestar_guardian', paperdoll: 'ship_commandtoken_basestar_paperdoll_layouts',
    role: 'Mothership', roleDep: 'Mothership', lvl: 1, tyl: 25000, tokens: 20000, rentalOnly: true,
    hp: 15400, pwr: 660, speed: 52, agility: 0.55, extent: 610,
    realStats: FLAGSHIP_FLIGHT },
];

/* NPC-only hulls. Authored because SectorTemplate 10 spawns 51/52/54/75/76/78 by guid and the
 * ShipConfigTemplates pin all of them (shipGUID there IS ShipCard.cardGuid), but deliberately OUT
 * of every ShipList and parked on HangarID 12 - no icon, no queue position. Their stats scale with
 * tier because these are the bots you actually fight. */
const ADVANCED_OFFSET = 300000;   // level-2 hull guid = level-1 guid + this
const NPC_HULLS = [50, 51, 52, 54, 55, 74, 75, 76, 78, 79].map(g => {
  const base = { 50: 'humant1fighter', 51: 'humant1fighter', 52: 'humant1fighter',
                 54: 'humant1command', 55: 'humant1command',
                 74: 'cylont1fighter', 75: 'cylont1fighter', 76: 'cylont1fighter',
                 78: 'cylont1command', 79: 'cylont1command' }[g];
  // Toughness grade, NOT the card's Tier - see below.
  const grade = { 50: 1, 51: 2, 52: 3, 54: 2, 55: 3, 74: 1, 75: 2, 76: 3, 78: 2, 79: 3 }[g];
  /* The live game's own NPC names. The client titles a ship from its GUI card -
   * bgo.<key>.Name_<level> before bgo.<key>.Name (GUICard.cs:38-82) - so inheriting the player
   * hull's key here made every bot render as the PLAYER ship it clones ("Viper Mk II"). These
   * enemy_* families are the per-rank NPC name ladders the original shipped for exactly these
   * hulls (dump: research/data/loca_values.json; e.g. enemy_colonial_viper Name_1..Name_13 =
   * "Novice Viper".."Ace Viper"), and the level picks the rung. Strikes sit mid-ladder, riding
   * the toughness grade, so a harder bot reads as a higher rank. All ten key+level pairs resolve
   * in loca-keys.txt, and every family carries a bare .Description, which keeps the GUI
   * validator's description warn quiet. */
  const npcName = {
    50: ['enemy_colonial_viper', 3],      // "Learned Viper"
    51: ['enemy_colonial_viper', 4],      // "Competent Viper"
    52: ['enemy_colonial_viper', 5],      // "Talented Viper"
    54: ['enemy_colonial_raptor', 4],     // "Competent Raptor"
    55: ['enemy_colonial_raptor', 5],     // "Talented Raptor"
    74: ['enemy_cylon_raider', 3],        // "Improved Raider"
    75: ['enemy_cylon_raider', 4],        // "Developed Raider"
    76: ['enemy_cylon_raider', 5],        // "Intermediate Raider"
    78: ['enemy_cylon_heavy_raider', 4],  // "Developed Heavy Raider"
    79: ['enemy_cylon_heavy_raider', 5],  // "Intermediate Heavy Raider"
  }[g];
  const src = HULLS.find(h => h.prefab === base);
  return Object.assign({}, src, {
    g, hangar: 12, starter: false, npcOnly: true,
    loca: npcName[0], locaLevel: npcName[1],
    // Tier stays 1 no matter how hard the bot hits. Tier is a HULL-CLASS LOCK on what can be
    // equipped, and every shipped ShipConfigTemplate arms these guids with tier-1 weapons - a
    // tier-3 NPC hull would be asking for weapons that do not exist at that tier.
    tier: 1,
    lvl: 1, tyl: 10000 * grade,
    hp: 700 + grade * 400, pwr: 80 + grade * 30,
    speed: 90 + grade * 8, agility: 0.9 + grade * 0.05,
    name: src.name + ' T' + grade,
  });
});

/* Escort- and line-class NPCs, plus the two event capitals. Same parking rules as the strikes
 * above (HangarID 12, out of every ShipList). Tier is REAL here, unlike the strikes' forced 1:
 * weapons now exist at every tier, and NpcBehaviourTemplates.createTemplateForTier scales the
 * brain by the ship card's tier. Stats ride along from the roster entry for the same prefab, so
 * an NPC Scythe flies like the player's Scythe.
 *
 * The two capitals are the original event bosses: the Colonial CS-07 Poseidon and its "fearsome
 * cylon counterpart" the Kraken. Three per-boss overrides, each through a channel that survives
 * the pipeline:
 *   BOSS_STATS rides the realStats channel because a plain hp: override here is DEAD - the Stats
 *     assign order puts HULLS_REAL last (shipCards below), hulls-real.js carries both carriers at
 *     8,000 HP, and the 20,000 this table used to ask for silently shipped as 8,000. realStats is
 *     applied AFTER that merge (the CAPITAL_FLIGHT precedent), so these are the emitted numbers.
 *     50,000 HP is the Hestia figure, the wiki's model for a boss that expects a player squadron
 *     (Twilight of the Gods: 50k HP, point defence, nuclear missiles, escorted); the wiki Kraken's
 *     own 10,290 was sized against 2013 strike DPS. HullRecovery 100 is the disengage-reset
 *     mechanic - NPCs regenerate out of combat via HullPointsTimer. Speed 12 anchors the patrol;
 *     2000/100 power feeds the full 6031-6034 battery without a slot ever starving.
 *   ownerLevel 120 is the wiki's boss level, and it is ALSO the ShipConfigTemplate lookup key:
 *     setupWeaponConfig prefers config.level == ownerCard.getLevel() (SpaceObjectFactory.java:
 *     654-670), so 120 turns the boss config from a fallback hit into an exact match. Every other
 *     hull keeps Owner Level 1.
 *   the GUI key column names the bosses "CS-07 Poseidon"/"Kraken" - no poseidon/kraken string
 *     exists in the client outside these two winter-event NPC keys, and both are single-rung
 *     ladders, so their GUI level is 1. Both verified in the locale bundle:
 *     bgo.enemy_colonial_winter_event_aesir.Name_1 = "CS-07 Poseidon",
 *     bgo.enemy_cylon_winter_event_fenrir.Name_1 = "Kraken".
 * Their ShipConfigTemplates arm the launcher slots, which only carriers and the stealth hulls
 * actually have (emit-npc-configs.js puts the capship launcher 6034 there).
 *
 * The GUI key + level columns name every row the way the strikes above are named: the client
 * resolves bgo.<key>.Name_<level> from the GUI card (GUICard.cs:38-82), and the enemy_* families
 * are the live game's own NPC rank ladders for these very hulls (dump:
 * research/data/loca_values.json). Level places the hull on its ladder - escorts read as ranks
 * 6-8, lines as 9-11 up to the family's top rung - so a line ship outranks an escort the way the
 * original's spawns did. Every key+level pair resolves in loca-keys.txt, and each family carries
 * a bare .Description, which satisfies the GUI validator's description check. */
const BOSS_STATS = {
  MaxHullPoints: 50000, MaxPowerPoints: 2000, ArmorValue: 60, CriticalDefense: 150,
  Avoidance: 20, HullRecovery: 100, PowerRecovery: 100, Speed: 12,
};
const NPC_HEAVIES = [
  // [guid, prefab, GUI key, GUI level, boss name override]
  [60, 'humant2fighter',  'enemy_colonial_berserker',    6],  // "Experienced Scythe"
  [61, 'humant2command',  'enemy_colonial_avenger',      7],  // "Seasoned Glaive"
  [62, 'humant2defender', 'enemy_colonial_dominator',    8],  // "Accomplished Maul"
  [63, 'humant3fighter',  'enemy_colonial_gunstar',      9],  // "Expert Aesir"
  [64, 'humant3command',  'enemy_colonial_cruiser',     10],  // "Elite Vanir"
  [65, 'humant3defender', 'enemy_colonial_dreadnought', 11],  // "Ace Jotunn"
  [84, 'cylont2fighter',  'enemy_cylon_banshee',         6],  // "Advanced Banshee"
  [85, 'cylont2command',  'enemy_cylon_spectre',         7],  // "Enhanced Spectre"
  [86, 'cylont2defender', 'enemy_cylon_wrath',           8],  // "Evolved Wraith"
  [87, 'cylont3fighter',  'enemy_cylon_nova',            9],  // "Elevated Fenrir"
  [88, 'cylont3command',  'enemy_cylon_phantom',        10],  // "Exalted Hel"
  [89, 'cylont3defender', 'enemy_cylon_sentinel',       11],  // "Apotheon Jormung"
  [90, 'humant4carrier',  'enemy_colonial_winter_event_aesir', 1, 'CS-07 Poseidon'],
  [91, 'cylont4carrier',  'enemy_cylon_winter_event_fenrir',   1, 'Kraken'],
].map(([g, prefab, locaKey, locaLevel, bossName]) => {
  const src = HULLS.find(h => h.prefab === prefab);
  return Object.assign({}, src, {
    g, hangar: 12, starter: false, npcOnly: true, lvl: 1,
    name: bossName || src.name,
    loca: locaKey, locaLevel,
  }, bossName ? { realStats: BOSS_STATS, ownerLevel: 120 } : {});
});

// Slot ids come straight from the shipped configs: 0,1 always; 2 = missile launcher;
// 12 = Colonial/Raider third weapon; 9 = Heavy Raider third weapon.
/* ================================================================ HARDPOINTS
 * ObjectPointName is NOT free text. The client matches it by transform name against the
 * instantiated model's children and silently DROPS any that matches nothing - no log, no
 * exception. Consequences of a wrong name, all invisible:
 *   - the weapon cache is built empty, so there is no muzzle flash, tracer or weapon sound
 *   - the firing arc draws nothing
 *   - client-side missiles spawn at the ship origin instead of the pod
 * Damage still resolves, because the SERVER only needs the hash to exist in the World card -
 * which is exactly why this reads as "shooting works but nothing renders".
 *
 * EVERYTHING BELOW THIS LINE IS EXTRACTED, NOT AUTHORED. Names, positions and rotations are read
 * straight out of the shipped prefabs by tools/cardgen/extract-hardpoints.py, expressed in the
 * ROOT's local space - which is where the client applies them, since Spot parents to the
 * instantiated root. The root's own transform is deliberately NOT composed in: every Colonial
 * root carries a 180-degree Y rotation, and folding it in negates x and z, i.e. the ship fires
 * backwards. Regenerate with:
 *     py tools/cardgen/extract-hardpoints.py <bundle>      (one bundle per process)
 * KEEP the positions: the server measures the firing arc from them and spawns missiles there.
 *
 * Naming is not uniform and none of it is guessable:
 *   - strike hulls use bullet01..NN plus elitebulletNN for the missile hardpoint
 *   - the two carriers suffix theirs with the class the mount is built for
 *     (bullet01_cannon, bullet11_launcher, bullet07_defensive) - the suffix is part of the name
 *   - the Raider's decal point is named `sticker`, NOT `sticker1`
 *   - the War Raider's sticker container is NOT at the origin, unlike every other hull
 * Hashes are the number already in the name; stickers are offset into the 90s so that
 * bullet11_launcher cannot collide with sticker2 on the carriers. */

/* Real per-hull flight stats, slot layouts and paperdoll layouts, dumped from a running server.
 * See hulls-real.js for what each one replaced and why. Generated - regenerate with
 * `py tools/cardgen/gen-hulls-real.py` against a fresh card dump. */
const { HULLS_REAL, LAYOUTS_REAL } = require('./hulls-real');

/* The original's whole fittable catalogue - 219 ship systems with their real stats, prices, GUI
 * keys and ability cards, read out of the same dump, ten upgrade levels each. Generated -
 * regenerate with `node tools/cardgen/gen-systems-real.js`.
 *
 * LADDER is {levels, maxLevel, userUpgradeable} - the three constants every rung of every chain
 * shares. They come from the module rather than being restated here so that shortening or
 * lengthening the ladder is one edit in the generator.
 *
 * FLAGS records the staging state the module was generated under, and the two switches live in the
 * GENERATOR, not in the generated file, so regenerating cannot silently revert them. The
 * assertions further down check the emitted cards against what FLAGS says, which is the thing that
 * notices if the module and this file ever disagree.
 *
 * SYSTEMS_DROPPED is the fifteen candidates the generator refused: items whose ability ActionType
 * AbilityActionFactory cannot build, plus one projectile with no rotation stats. That is
 * player-visible content - four complete tiered families - so it is printed on every run rather
 * than buried in a data file nobody opens. */
const { SYSTEMS_REAL, FLAGS: SYSTEMS_FLAGS, LADDER } = require('./systems-real.js');
const SYSTEMS_DROPPED = require('./systems-dropped.json');

/* The 97 ship paints - 93 read out of the same dump plus 4 hand-authored `advanced` skins that
 * close the last four per-hull gaps. Generated - regenerate with `node tools/cardgen/gen-paints-real.js`,
 * which reads THIS file's output, so run cards.js first if hull guids or slot layouts have moved.
 * PAINTS_DROPPED is the single paint we refuse (a Raptor FR skin, and we do not fly that hull). */
const { PAINTS_REAL, PAINTS_DROPPED } = require('./paints-real.js');

/* The two families the dump has no cards for at all, hand-authored from the client's own loca
 * strings, the wiki and the server code that consumes them. The dump is empty of avionics because
 * ShopProtocol de-stocks an avionics module the player already owns and the dumping pilot owned
 * theirs; it is empty of a tier-2 role module because the only role card the original shipped in
 * that dump is the tier-4 Spawn Mode one. See avionics.js for the evidence and the arithmetic. */
const { AVIONICS_CAMS, C31_LEVELS } = require('./avionics.js');

/* The original's whole countable catalogue - 165 ShipConsumable cards with the real
 * ConsumableType/Tier pairing key, buff multipliers, consumableAttributes, click size and prices,
 * plus the corrections for the ten guids that are ours and the three nuclear projectile object
 * card sets. Generated - regenerate with `node tools/cardgen/gen-consumables-real.js`.
 *
 * CONSUMABLES_DROPPED is the one card the import refuses: consumable_mega_rounds, a dev item with
 * no price at either end and buyCount 0. Printed on every run for the same reason the dropped
 * systems and paints are. */
const { CONSUMABLES_REAL, LEGACY_CONSUMABLES, CONSUMABLES_DROPPED,
        NUKE_PROJECTILES } = require('./consumables-real.js');

const HARDPOINTS = {
  humant1fighter: {    // Viper Mk II
    bullet01:                { hash:  49813, pos: V3(-1.029611, -0.203091, 2.184256), rot: QUAT(0, 0, -1, 0) },
    bullet02:                { hash:  50321, pos: V3(0, -0.431652, 3.357222), rot: QUAT(0, 0, -1, 0) },
    bullet03:                { hash:  19778, pos: V3(1.029971, -0.203091, 2.184257), rot: QUAT(0, 0, -1, 0) },
    elitebullet04:           { hash:  27288, pos: V3(0, -0.713463, 0.305092), rot: QUAT(0, 0, -1, 0) },
    sticker1:                { hash: 45294, pos: V3(0, 0, 0), rot: QUAT(0, 1, 0, 0), type: 'Sticker' },
  },
  humant2fighter: {    // Scythe
    bullet01:                { hash:  49813, pos: V3(-16.000001, 0, 15.999999), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet02:                { hash:  50321, pos: V3(9.999996, 0, 44.000001), rot: QUAT(0, 0, 1, 0) },
    bullet03:                { hash:  19778, pos: V3(-10.000004, 0, 43.999999), rot: QUAT(0, 0, 1, 0) },
    bullet04:                { hash:  50370, pos: V3(15.999999, 0, 16.000001), rot: QUAT(0, 0.707107, 0, 0.707107) },
    elitebullet05:           { hash:  2575, pos: V3(-15.999998, 0, -22.000001), rot: QUAT(0, -0.707107, 0, 0.707107) },
    elitebullet06:           { hash:  34993, pos: V3(16.000002, 0, -21.999999), rot: QUAT(0, 0.707107, 0, 0.707107) },
    sticker1:                { hash: 45294, pos: V3(0, 0, -24.100677), rot: QUAT(0, 1, 0, 0), type: 'Sticker' },
  },
  humant3fighter: {    // Aesir
    bullet01:                { hash:  49813, pos: V3(-62.852623, -11.031255, -51.058693), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet02:                { hash:  50321, pos: V3(-59.574837, -16.944536, 101.92321), rot: QUAT(-0.379928, 0.379928, 0.596368, -0.596368) },
    bullet03:                { hash:  19778, pos: V3(0.137225, 20.541349, 155.062408), rot: QUAT() },
    bullet04:                { hash:  50370, pos: V3(0.102976, -8.486253, 190.844803), rot: QUAT(0, 0, 1, 0) },
    bullet05:                { hash:  21514, pos: V3(59.505455, -16.75629, 101.648811), rot: QUAT(0.379928, 0.379928, 0.596368, 0.596368) },
    bullet06:                { hash:  64121, pos: V3(63.294701, -11.04957, -50.905003), rot: QUAT(0, -0.707107, 0, -0.707107) },
    elitebullet07:           { hash:  7123, pos: V3(-11.195604, 25.181864, 68.516968), rot: QUAT(-0.5, -0.5, 0.5, 0.5) },
    elitebullet08:           { hash:  40453, pos: V3(10.898588, 25.189516, 68.345299), rot: QUAT(0.5, -0.5, 0.5, -0.5) },
    sticker1:                { hash: 45294, pos: V3(0.134672, 22.944302, 132.006622), rot: QUAT(0.104822, 0, 0, 0.994491), type: 'Sticker' },
    sticker2:                { hash: 36077, pos: V3(10.90302, 27.940929, -8.721443), rot: QUAT(0.0015, -0.001029, 0.000002, 0.999998), type: 'Sticker' },
    sticker3:                { hash: 13625, pos: V3(-11.017175, 27.914198, -8.78207), rot: QUAT(), type: 'Sticker' },
  },
  humant1command: {    // Raptor
    bullet01:                { hash:  49813, pos: V3(-1.511584, -1.343623, 1.924034), rot: QUAT(0, 0, 1, 0) },
    bullet02:                { hash:  50321, pos: V3(-0.411882, -1.473099, 1.695256), rot: QUAT(0, 0, 1, 0) },
    bullet03:                { hash:  19778, pos: V3(1.529278, -1.343623, 1.917449), rot: QUAT(0, 0, 1, 0) },
    elitebullet04:           { hash:  27288, pos: V3(0.401727, -1.473099, 1.695786), rot: QUAT(0, 0, 1, 0) },
    sticker1:                { hash: 45294, pos: V3(0, 0, 0), rot: QUAT(0, -1, 0, 0), type: 'Sticker' },
  },
  humant2command: {    // Glaive
    bullet01:                { hash:  49813, pos: V3(-15.999994, 0, 16.000006), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet02:                { hash:  50321, pos: V3(10.000017, 0, 43.999996), rot: QUAT(0, 0, 1, 0) },
    bullet03:                { hash:  19778, pos: V3(-9.999983, 0, 44.000004), rot: QUAT(0, 0, 1, 0) },
    bullet04:                { hash:  50370, pos: V3(16.000006, 0, 15.999994), rot: QUAT(0, 0.707107, 0, 0.707107) },
    elitebullet05:           { hash:  2575, pos: V3(-16.000009, 0, -21.999994), rot: QUAT(0, -0.707107, 0, 0.707107) },
    elitebullet06:           { hash:  34993, pos: V3(15.999991, 0, -22.000006), rot: QUAT(0, 0.707107, 0, 0.707107) },
    sticker1:                { hash: 45294, pos: V3(-19.386023, 11.442301, -40.517277), rot: QUAT(0, -1, 0, 0), type: 'Sticker' },
    sticker2:                { hash: 36077, pos: V3(19.342557, 11.442301, -40.517292), rot: QUAT(0, -1, 0, 0), type: 'Sticker' },
    sticker3:                { hash: 13625, pos: V3(-6.497958, 7.267636, 59.805243), rot: QUAT(0, -1, 0, 0), type: 'Sticker' },
    sticker4:                { hash: 42933, pos: V3(6.584041, 7.267636, 59.805246), rot: QUAT(0, -1, 0, 0), type: 'Sticker' },
  },
  humant3command: {    // Vanir
    bullet01:                { hash:  49813, pos: V3(-51.899521, 7.156886, -60.25689), rot: QUAT(0, 0.707107, 0, -0.707107) },
    bullet02:                { hash:  50321, pos: V3(-56.017841, 32.254299, 58.674757), rot: QUAT(0, 0.608762, 0, -0.793353) },
    bullet03:                { hash:  19778, pos: V3(0.000011, 0.000024, 122.750366), rot: QUAT(0, 0, 0, -1) },
    bullet04:                { hash:  50370, pos: V3(-0.000008, 0.000024, 122.60981), rot: QUAT(0, 0, 0, -1) },
    bullet05:                { hash:  21514, pos: V3(56.291714, 32.359356, 58.517545), rot: QUAT(0, -0.608761, 0, -0.793353) },
    bullet06:                { hash:  64121, pos: V3(52.132645, 18.955141, -60.307705), rot: QUAT(0, -0.707107, 0, -0.707107) },
    elitebullet07:           { hash:  7123, pos: V3(-49.494304, 22.690709, -4.103975), rot: QUAT(0, 0.707107, 0, -0.707107) },
    elitebullet08:           { hash:  40453, pos: V3(49.573929, 22.493732, -1.851574), rot: QUAT(0, -0.707107, 0, -0.707107) },
    sticker1:                { hash: 45294, pos: V3(-29.668381, 31.114151, -108.280922), rot: QUAT(0, 1, 0, 0), type: 'Sticker' },
    sticker2:                { hash: 36077, pos: V3(-60.722229, 12.925651, 133.162323), rot: QUAT(0, 0.707107, 0.707107, 0), type: 'Sticker' },
    sticker3:                { hash: 13625, pos: V3(60.710209, 12.925651, 133.400513), rot: QUAT(0, 0.707107, 0.707107, 0), type: 'Sticker' },
    sticker4:                { hash: 42933, pos: V3(29.654692, 31.114151, -108.28093), rot: QUAT(0, 1, 0, 0), type: 'Sticker' },
  },
  humant1defender: {   // Rhino
    bullet01:                { hash:  49813, pos: V3(-4.997622, 0.519668, 1.994872), rot: QUAT(0, 0, 1, 0) },
    bullet02:                { hash:  50321, pos: V3(-2.003811, 1.296431, 1.715896), rot: QUAT() },
    bullet03:                { hash:  19778, pos: V3(5.029078, 0.549518, 2.026031), rot: QUAT(0, 0, 1, 0) },
    elitebullet04:           { hash:  27288, pos: V3(1.987214, 1.309609, 1.699098), rot: QUAT(0, 0, 1, 0) },
    elitebullet05:           { hash:  2575, pos: V3(-0.000002, 1.100879, -4.389983), rot: QUAT(1, 0, 0, 0) },
    sticker1:                { hash: 45294, pos: V3(-4.716999, -0.093, 1.259002), rot: QUAT(), type: 'Sticker' },
    sticker2:                { hash: 36077, pos: V3(4.717001, -0.093, 1.259001), rot: QUAT(), type: 'Sticker' },
    sticker3:                { hash: 13625, pos: V3(-2.500101, 2.118865, -2.959337), rot: QUAT(0.5, -0.5, 0.5, 0.5), type: 'Sticker' },
    sticker4:                { hash: 42933, pos: V3(2.501976, 2.118865, -2.959338), rot: QUAT(0.5, 0.5, -0.5, 0.5), type: 'Sticker' },
  },
  humant2defender: {   // Maul
    bullet01:                { hash:  49813, pos: V3(-15.999994, 0, 16.000006), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet02:                { hash:  50321, pos: V3(10.000017, 0, 43.999996), rot: QUAT(0, 0, 1, 0) },
    bullet03:                { hash:  19778, pos: V3(-9.999983, 0, 44.000004), rot: QUAT(0, 0, 1, 0) },
    bullet04:                { hash:  50370, pos: V3(16.000006, 0, 15.999994), rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet07:                { hash:  64555, pos: V3(0.000006, -5.1, 16), rot: QUAT() },
    elitebullet05:           { hash:  2575, pos: V3(-16.000009, 0, -21.999994), rot: QUAT(0, -0.707107, 0, 0.707107) },
    elitebullet06:           { hash:  34993, pos: V3(15.999991, 0, -22.000006), rot: QUAT(0, 0.707107, 0, 0.707107) },
    sticker1:                { hash: 45294, pos: V3(0, 0, -9.971619), rot: QUAT(0, 1, 0, 0), type: 'Sticker' },
  },
  humant3defender: {   // Jotunn
    bullet01:                { hash:  49813, pos: V3(-39.433259, 0, -45.00001), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet02:                { hash:  50321, pos: V3(-39.433299, 0, 124.99999), rot: QUAT(0, -0.608762, 0, 0.793353) },
    bullet03:                { hash:  19778, pos: V3(0.566692, 0, 160), rot: QUAT() },
    bullet04:                { hash:  50370, pos: V3(0.566692, 0, 160), rot: QUAT() },
    bullet05:                { hash:  21514, pos: V3(40.566701, 0, 125.00001), rot: QUAT(0, 0.608761, 0, 0.793353) },
    bullet06:                { hash:  64121, pos: V3(40.566741, 0, -44.99999), rot: QUAT(0, 0.707107, 0, 0.707107) },
    elitebullet07:           { hash:  7123, pos: V3(-39.433279, 0, 39.99999), rot: QUAT(0, -0.707107, 0, 0.707107) },
    elitebullet08:           { hash:  40453, pos: V3(40.566721, 0, 40.00001), rot: QUAT(0, 0.707107, 0, 0.707107) },
    sticker1:                { hash: 45294, pos: V3(0.376207, 0.000002, 6.192658), rot: QUAT(0, -1, 0, 0), type: 'Sticker' },
    sticker2:                { hash: 36077, pos: V3(0.376207, 0.000002, 6.192658), rot: QUAT(0, -1, 0, 0), type: 'Sticker' },
    sticker3:                { hash: 13625, pos: V3(0.376207, 0.000002, 6.192658), rot: QUAT(0, -1, 0, 0), type: 'Sticker' },
    sticker4:                { hash: 42933, pos: V3(0.376207, 0.000002, 6.192658), rot: QUAT(0, -1, 0, 0), type: 'Sticker' },
    sticker5:                { hash: 56779, pos: V3(0.376207, 0.000002, 6.192658), rot: QUAT(0, -1, 0, 0), type: 'Sticker' },
  },
  humant1merit: {      // Viper Mk VII
    bullet01:                { hash:  49813, pos: V3(-2.272594, -0.588516, 0.138085), rot: QUAT() },
    bullet02:                { hash:  50321, pos: V3(0, 1.663368, -1.407977), rot: QUAT() },
    bullet03:                { hash:  19778, pos: V3(2.273, -0.588516, 0.138086), rot: QUAT() },
    bullet04:                { hash:  50370, pos: V3(-1.054121, -0.190172, 0.50441), rot: QUAT() },
    bullet05:                { hash:  21514, pos: V3(1.054, -0.190172, 0.504411), rot: QUAT() },
    sticker1:                { hash: 45294, pos: V3(0, 0, 0), rot: QUAT(0, -1, 0, 0), type: 'Sticker' },
  },
  humant2merit: {      // Halberd
    bullet01:                { hash:  49813, pos: V3(-16.000001, 0, 15.999999), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet02:                { hash:  50321, pos: V3(-15.999998, 0, -22.000001), rot: QUAT(0.707107, 0, -0.707107, 0) },
    bullet03:                { hash:  19778, pos: V3(-12.000003, 0, 36.999999), rot: QUAT(-0.270598, -0.270598, 0.653281, 0.653281) },
    bullet04:                { hash:  50370, pos: V3(11.999997, 0, 37.000001), rot: QUAT(0.382683, 0, 0.92388, 0) },
    bullet05:                { hash:  21514, pos: V3(15.999999, 0, 16.000001), rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet06:                { hash:  64121, pos: V3(16.000002, 0, -21.999999), rot: QUAT(0.707107, 0, 0.707107, 0) },
    bullet07:                { hash:  64555, pos: V3(-0.000005, 0, 55), rot: QUAT(0, 0, -0.707107, 0.707107) },
    sticker1:                { hash: 45294, pos: V3(16.581684, 7.784892, -1.44926), rot: QUAT(0.172776, 0.685674, -0.172776, 0.685674), type: 'Sticker' },
    sticker2:                { hash: 36077, pos: V3(-17.028805, 7.784892, -1.450305), rot: QUAT(0.685647, 0.17288, 0.685648, -0.17288), type: 'Sticker' },
    sticker3:                { hash: 13625, pos: V3(-16.609419, -2.894993, 47.127138), rot: QUAT(0, 1, 0, 0), type: 'Sticker' },
    sticker4:                { hash: 42933, pos: V3(16.36408, -2.894547, 47.128145), rot: QUAT(0, 1, 0, 0), type: 'Sticker' },
  },
  humant3merit: {      // Gungnir
    bullet01:                { hash:  49813, pos: V3(-39.999996, 0, -45.000003), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet02:                { hash:  50321, pos: V3(-40.000003, 0, 39.999997), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet03:                { hash:  19778, pos: V3(-39.999999, 0, 124.999997), rot: QUAT(0, -0.608761, 0, 0.793353) },
    bullet04:                { hash:  50370, pos: V3(-24.999999, 0, 144.999998), rot: QUAT() },
    bullet05:                { hash:  21514, pos: V3(0, 0, 160), rot: QUAT() },
    bullet06:                { hash:  64121, pos: V3(25.000001, 0, 145.000002), rot: QUAT() },
    bullet07:                { hash:  64555, pos: V3(40.000001, 0, 125.000003), rot: QUAT(0, 0.608762, 0, 0.793353) },
    bullet08:                { hash:  18078, pos: V3(39.999997, 0, 40.000003), rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet09:                { hash:  21539, pos: V3(40.000004, 0, -44.999997), rot: QUAT(0, 0.707107, 0, 0.707107) },
    sticker1:                { hash: 45294, pos: V3(-71.825401, 7.693253, 81.93877), rot: QUAT(-0.126209, 0.695752, 0.695752, -0.126209), type: 'Sticker' },
    sticker2:                { hash: 36077, pos: V3(-71.825386, 7.693248, 30.058541), rot: QUAT(-0.126209, 0.695752, 0.695752, -0.126209), type: 'Sticker' },
    sticker3:                { hash: 13625, pos: V3(-71.825363, 7.693249, -40.745682), rot: QUAT(-0.126209, 0.695752, 0.695752, -0.126209), type: 'Sticker' },
    sticker4:                { hash: 42933, pos: V3(71.963013, 7.723901, -41.014877), rot: QUAT(0.129331, 0.695179, 0.695179, 0.129331), type: 'Sticker' },
    sticker5:                { hash: 56779, pos: V3(71.962982, 7.723907, 29.921759), rot: QUAT(0.129331, 0.695179, 0.695179, 0.129331), type: 'Sticker' },
    sticker6:                { hash: 35348, pos: V3(71.962959, 7.723906, 82.109169), rot: QUAT(0.129331, 0.695179, 0.695179, 0.129331), type: 'Sticker' },
    sticker7:                { hash: 64378, pos: V3(28.855062, 17.990438, 64.815571), rot: QUAT(-0.153046, 0.690346, 0.153046, 0.690346), type: 'Sticker' },
  },
  humant4carrier: {    // Brimir
    bullet01_cannon:         { hash:  28205, pos: V3(65.966362, 19.785851, 170.628799), rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet02_cannon:         { hash:  64547, pos: V3(65.966339, 19.785851, -5.592278), rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet03_cannon:         { hash:  33935, pos: V3(65.966316, 19.785851, -210.91716), rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet04_cannon:         { hash:  51107, pos: V3(-65.056694, 19.785851, -210.917175), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet05_cannon:         { hash:  50525, pos: V3(-65.056671, 19.785851, -5.592293), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet06_cannon:         { hash:  28932, pos: V3(-65.056648, 19.785851, 170.628784), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet07_defensive:      { hash:  19020, pos: V3(-52.658684, 30.283691, 277.500153), rot: QUAT(0, -0.258819, 0, 0.965926) },
    bullet09_defensive:      { hash:  55041, pos: V3(50.358261, 30.283691, 277.500153), rot: QUAT(0, 0.258819, 0, 0.965926) },
    bullet11_launcher:       { hash: 18846, pos: V3(-0.404771, 30.283691, -190.4048), rot: QUAT(0, 1, 0, 0) },
    bullet12_launcher:       { hash: 9558, pos: V3(-0.404771, 30.283691, 54.82122), rot: QUAT() },
    bullet13_defensive:      { hash: 41896, pos: V3(-72.072998, 23.752218, -307.778107), rot: QUAT(0, -0.965926, 0, 0.258819) },
    bullet14_defensive:      { hash: 60692, pos: V3(72.070297, 23.752218, -307.778107), rot: QUAT(0, 0.965926, 0, 0.258819) },
    sticker1:                { hash: 45294, pos: V3(0, 0, 0), rot: QUAT(), type: 'Sticker' },
  },
  /* Pegasus - REAL transforms from bundle 'human_t4_pegasus' (humant4pegasus.prefab), extracted
   * 2026-08-03. This replaces a transcription of 'pegasus.prefab', which was the wrong asset - see
   * the prefab note on hull 5017 for why, and for the two edits that go with this one.
   * The mounts here are machine-mirrored, not hand-placed: bullet01 x = -350.949493 against
   * bullet10 x = +350.949507, and the same to 4-5 decimals on all five pairs. Worst d|x| across
   * the five is 1.5e-4 units. They also fan correctly - 01/03/08/10 broadside, 02/09 and 04/07 at
   * 45 degrees forward-outboard, 05/06 dead ahead, point defence on the centreline fore and aft.
   *
   * COMPANION EDIT OUTSIDE THIS FILE: the ColliderTemplate is keyed by prefab name and is still
   * keyed 'pegasus' in both config/ColliderTemplates/Colonial/pegasus.json and
   * server/ServerConfigurationUtils/global/ColliderTemplates/Colonial/pegasus.json. Rekey both to
   * humant4pegasus; radius 1174 is unchanged because it is the same mesh. Missing it is silent -
   * SpaceObjectFactory.wrapCollider uses Optional.ifPresent, so the hull simply flies with NO
   * collider and nothing can hit it. */
  humant4pegasus: {
    bullet01:                { hash:  49813, pos: V3(-350.94948, -100, -156.722077), rot: QUAT(0.707107, 0, -0.707107, 0) },
    bullet02:                { hash:  50321, pos: V3(-325.97942, -100, 226.48752), rot: QUAT(0.382684, 0, -0.923879, 0) },
    bullet03:                { hash:  19778, pos: V3(-197.113817, -21.459248, 365.523878), rot: QUAT(0.707107, 0, -0.707107, 0) },
    bullet04:                { hash:  50370, pos: V3(-167.882962, -21.867718, 665.421128), rot: QUAT(-0.382684, 0, 0.92388, 0) },
    bullet05:                { hash:  21514, pos: V3(-70.773704, -21.290451, 866.223444), rot: QUAT(0, 0, 1, 0) },
    bullet06:                { hash:  64121, pos: V3(70.773553, -21.290451, 866.223456), rot: QUAT(0, 0, 1, 0) },
    bullet07:                { hash:  64555, pos: V3(167.882846, -21.867718, 665.421157), rot: QUAT(-0.382683, 0, -0.92388, 0) },
    bullet08:                { hash:  18078, pos: V3(197.113768, -21.459248, 365.523912), rot: QUAT(0.707107, 0, 0.707107, 0) },
    bullet09:                { hash:  21539, pos: V3(325.979381, -100, 226.487577), rot: QUAT(0.382683, 0, 0.92388, 0) },
    bullet10:                { hash:     10, pos: V3(350.949507, -100, -156.722015), rot: QUAT(0.707107, 0, 0.707107, 0) },
    bullet11:                { hash:     11, pos: V3(-0.000046, 0, 528), rot: QUAT(0, 0, 0, 1) },
    bullet12:                { hash:     12, pos: V3(0.000044, 0, -508), rot: QUAT(1, 0, 0, 0) },
  },
  /* Galactica - REAL transforms, extracted from bundle 'galactica' 2026-08-03. The
   * Pegasus-layout fallback was NOT needed: this hull carries its own bulletNN locators.
   * Eight mounts, all broadside, in four port/starboard pairs; +Z is the bow (the engine
   * glowball sits at z = -703.5), so they run bow to stern:
   *     z = +499.4  bullet01 port / bullet02 stbd      z = +358.6  bullet04 port / bullet03 stbd
   *     z = -424.6  bullet06 port / bullet05 stbd      z = -567.2  bullet08 port / bullet07 stbd
   * There is no centre-line pair, so unlike the Pegasus there is nowhere obvious to hang point
   * defence - see HULL_SLOTS.
   * ONE ODDITY, recorded rather than corrected: the port row faces +X and the starboard row -X,
   * i.e. each row points ACROSS the hull, where the Pegasus's port turrets face outward. The
   * rotations are the prefab's own, verbatim, so whatever the original did with the muzzle VFX
   * we do too; "fixing" them here would be inventing data. */
  galactica: {
    bullet01:                { hash:  49813, pos: V3(-55.444576, -0.210876, 499.360382), rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet02:                { hash:  50321, pos: V3(53.008648, -0.210876, 499.360382), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet03:                { hash:  19778, pos: V3(53.008625, -0.210846, 358.558105), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet04:                { hash:  50370, pos: V3(-55.444599, -0.210846, 358.558105), rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet05:                { hash:  21514, pos: V3(53.008503, -0.210785, -424.557434), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet06:                { hash:  64121, pos: V3(-55.444721, -0.210785, -424.557434), rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet07:                { hash:  64555, pos: V3(53.008488, -0.210754, -567.233887), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet08:                { hash:  18078, pos: V3(-55.444736, -0.210754, -567.233887), rot: QUAT(0, 0.707107, 0, 0.707107) },
    /* Eight mounts is the whole table ON PURPOSE. A previous pass synthesised bullet09-12 to
     * bring her to the Pegasus's twelve, but no transform of those names exists in
     * galactica.prefab, Spot.FindSpots matches on name, and a spot that never binds renders no
     * turret and no muzzle flash - four visibly dead bays amidships. Re-checked 2026-08-04 by
     * dumping every Transform in the galactica bundle: besides bullet01-08 it contains only
     * body meshes, LOD containers and the engine glowball, all at the origin. There is nothing
     * to bind a ninth bay to, so the hull carries eight and the Guardian drops to eight with it
     * - see the flagship block in HULL_SLOTS. */
  },
  cylont1fighter: {    // Raider
    bullet01:                { hash:  49813, pos: V3(-1.161417, -0.310141, 2.245296), rot: QUAT() },
    bullet02:                { hash:  50321, pos: V3(0, -0.284514, -0.577745), rot: QUAT() },
    bullet03:                { hash:  19778, pos: V3(1.161211, -0.310141, 2.245296), rot: QUAT() },
    elitebullet04:           { hash:  27288, pos: V3(0, -0.197869, 0.486459), rot: QUAT() },
    sticker:                 { hash: 21857, pos: V3(0, 0, 0), rot: QUAT(), type: 'Sticker' },
  },
  cylont2fighter: {    // Banshee
    bullet01:                { hash:  49813, pos: V3(-16.000007, 0, 15.999993), rot: QUAT(0, 0.707107, 0, -0.707107) },
    bullet02:                { hash:  50321, pos: V3(9.999982, 0, 44.000004), rot: QUAT(0, 0, 0, -1) },
    bullet03:                { hash:  19778, pos: V3(-10.000018, 0, 43.999996), rot: QUAT(0, 0, 0, -1) },
    bullet04:                { hash:  50370, pos: V3(15.999993, 0, 16.000007), rot: QUAT(0, -0.707107, 0, -0.707107) },
    elitebullet05:           { hash:  2575, pos: V3(-15.999991, 0, -22.000007), rot: QUAT(0, 0.707107, 0, -0.707107) },
    elitebullet06:           { hash:  34993, pos: V3(16.000009, 0, -21.999993), rot: QUAT(0, -0.707107, 0, -0.707107) },
    sticker1:                { hash: 45294, pos: V3(0, 0.391019, -10.78775), rot: QUAT(), type: 'Sticker' },
    sticker2:                { hash: 36077, pos: V3(0, 0.13928, -10.78775), rot: QUAT(), type: 'Sticker' },
    sticker3:                { hash: 13625, pos: V3(0.014233, 0.13928, -10.78775), rot: QUAT(1, 0, 0, 0), type: 'Sticker' },
  },
  cylont3fighter: {    // Fenrir
    bullet01:                { hash:  49813, pos: V3(-45, -7, -52.573864), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet02:                { hash:  50321, pos: V3(-45, 0, 110.426136), rot: QUAT(-0.379928, 0.379928, 0.596368, -0.596368) },
    bullet03:                { hash:  19778, pos: V3(0, 3, 145.426136), rot: QUAT() },
    bullet04:                { hash:  50370, pos: V3(0, 3, 145.426136), rot: QUAT() },
    bullet05:                { hash:  21514, pos: V3(45, 0, 110.426136), rot: QUAT(-0.379928, -0.379928, -0.596368, -0.596368) },
    bullet06:                { hash:  64121, pos: V3(45, -7, -52.573864), rot: QUAT(0, 0.707107, 0, 0.707107) },
    elitebullet07:           { hash:  7123, pos: V3(-50, 0, 30.426136), rot: QUAT(0, -0.707107, 0, 0.707107) },
    elitebullet08:           { hash:  40453, pos: V3(50, 0, 30.426136), rot: QUAT(0, 0.707107, 0, 0.707107) },
    sticker2:                { hash: 36077, pos: V3(0, 0, 60.426136), rot: QUAT(), type: 'Sticker' },
    sticker3:                { hash: 13625, pos: V3(0, 0, 60.426136), rot: QUAT(), type: 'Sticker' },
    sticker4:                { hash: 42933, pos: V3(0, 0, 60.426136), rot: QUAT(), type: 'Sticker' },
    sticker5:                { hash: 56779, pos: V3(0, 0, 60.426136), rot: QUAT(), type: 'Sticker' },
  },
  cylont1command: {    // Heavy Raider
    bullet01:                { hash:  49813, pos: V3(-0.400002, 0, 7.4), rot: QUAT() },
    bullet02:                { hash:  50321, pos: V3(-0.001418, 0, 4.894905), rot: QUAT() },
    bullet03:                { hash:  19778, pos: V3(0.384098, 0, 7.4), rot: QUAT() },
    elitebullet04:           { hash:  27288, pos: V3(-0.001418, -0.448232, 4.894905), rot: QUAT() },
    sticker1:                { hash: 45294, pos: V3(0.000023, 0, 0), rot: QUAT(0, 1, 0, 0), type: 'Sticker' },
  },
  cylont2command: {    // Spectre
    bullet01:                { hash:  49813, pos: V3(-16, 0, 16), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet02:                { hash:  50321, pos: V3(10, 0, 44), rot: QUAT() },
    bullet03:                { hash:  19778, pos: V3(-10, 0, 44), rot: QUAT() },
    bullet04:                { hash:  50370, pos: V3(16, 0, 16), rot: QUAT(0, 0.707107, 0, 0.707107) },
    elitebullet05:           { hash:  2575, pos: V3(-16, 0, -22), rot: QUAT(0, -0.707107, 0, 0.707107) },
    elitebullet06:           { hash:  34993, pos: V3(16, 0, -22), rot: QUAT(0, 0.707107, 0, 0.707107) },
  },
  cylont3command: {    // Hel
    bullet01:                { hash:  49813, pos: V3(-39.999989, 0, -45.00001), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet02:                { hash:  50321, pos: V3(-40.00003, 0, 124.99999), rot: QUAT(0, -0.608762, 0, 0.793353) },
    bullet03:                { hash:  19778, pos: V3(-0.000038, 0, 160), rot: QUAT() },
    bullet04:                { hash:  50370, pos: V3(-0.000038, 0, 160), rot: QUAT() },
    bullet05:                { hash:  21514, pos: V3(39.99997, 0, 125.00001), rot: QUAT(0, 0.608761, 0, 0.793353) },
    bullet06:                { hash:  64121, pos: V3(40.000011, 0, -44.99999), rot: QUAT(0, 0.707107, 0, 0.707107) },
    elitebullet07:           { hash:  7123, pos: V3(-40.00001, 0, 39.99999), rot: QUAT(0, -0.707107, 0, 0.707107) },
    elitebullet08:           { hash:  40453, pos: V3(39.99999, 0, 40.00001), rot: QUAT(0, 0.707107, 0, 0.707107) },
    sticker1:                { hash: 45294, pos: V3(-0.053789, 21.456669, 49.71843), rot: QUAT(-0.043619, 0, 0, 0.999048), type: 'Sticker' },
    sticker2:                { hash: 36077, pos: V3(-30.497878, 1.751621, 112.900297), rot: QUAT(-0.10576, 0.994361, 0.007739, 0.00096), type: 'Sticker' },
    sticker3:                { hash: 13625, pos: V3(30.546296, 1.775792, 112.893518), rot: QUAT(0.107507, 0.994203, 0.001587, -0.000172), type: 'Sticker' },
  },
  cylont1defender: {   // Marauder
    bullet01:                { hash:  49813, pos: V3(-2.873153, 0.231885, 2.693846), rot: QUAT(0, 0, 1, 0) },
    bullet02:                { hash:  50321, pos: V3(2.883201, -0.333531, 0.806848), rot: QUAT(0, 0, 1, 0) },
    bullet03:                { hash:  19778, pos: V3(2.870808, 0.219334, 2.693846), rot: QUAT(0, 0, 1, 0) },
    elitebullet04:           { hash:  27288, pos: V3(-2.883201, -0.333531, 0.806848), rot: QUAT() },
    elitebullet05:           { hash:  2575, pos: V3(0, -0.34789, -4.82522), rot: QUAT(0, 1, 0, 0) },
    sticker1:                { hash: 45294, pos: V3(0.000031, 1.23, 1.209), rot: QUAT(), type: 'Sticker' },
    sticker2:                { hash: 36077, pos: V3(4.02403, 0.085065, -0.522), rot: QUAT(), type: 'Sticker' },
    sticker3:                { hash: 13625, pos: V3(-4.02397, 0.085065, -0.522), rot: QUAT(), type: 'Sticker' },
  },
  cylont2defender: {   // Wraith
    bullet01:                { hash:  49813, pos: V3(-15.999999, 0, 16.000001), rot: QUAT(0, 0.707107, 0, -0.707107) },
    bullet02:                { hash:  50321, pos: V3(10.000003, 0, 43.999999), rot: QUAT(0, 0, 0, -1) },
    bullet03:                { hash:  19778, pos: V3(-9.999997, 0, 44.000001), rot: QUAT(0, 0, 0, -1) },
    bullet04:                { hash:  50370, pos: V3(16.000001, 0, 15.999999), rot: QUAT(0, -0.707107, 0, -0.707107) },
    bullet07:                { hash:  64555, pos: V3(0, -5.5, 0), rot: QUAT(0, 0, 0, -1) },
    elitebullet05:           { hash:  2575, pos: V3(-16.000001, 0, -21.999999), rot: QUAT(0, 0.707107, 0, -0.707107) },
    elitebullet06:           { hash:  34993, pos: V3(15.999999, 0, -22.000001), rot: QUAT(0, -0.707107, 0, -0.707107) },
    sticker1:                { hash: 45294, pos: V3(-28.991185, 1.125217, 4.275694), rot: QUAT(0.431775, -0.564192, 0.450736, 0.540459), type: 'Sticker' },
    sticker2:                { hash: 36077, pos: V3(28.93946, 1.227791, 4.280955), rot: QUAT(0.538694, -0.453761, -0.559498, -0.436889), type: 'Sticker' },
    sticker3:                { hash: 13625, pos: V3(0.028312, 0.35588, 21.409634), rot: QUAT(0, 0.978905, 0.204315, 0), type: 'Sticker' },
  },
  cylont3defender: {   // Jormung
    bullet01:                { hash:  49813, pos: V3(-39.999989, 0, -45.00001), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet02:                { hash:  50321, pos: V3(-40.00003, 0, 124.99999), rot: QUAT(0, -0.608762, 0, 0.793353) },
    bullet03:                { hash:  19778, pos: V3(-0.000038, 0, 160), rot: QUAT() },
    bullet04:                { hash:  50370, pos: V3(-0.000038, 0, 160), rot: QUAT() },
    bullet05:                { hash:  21514, pos: V3(39.99997, 0, 125.00001), rot: QUAT(0, 0.608761, 0, 0.793353) },
    bullet06:                { hash:  64121, pos: V3(40.000011, 0, -44.99999), rot: QUAT(0, 0.707107, 0, 0.707107) },
    elitebullet07:           { hash:  7123, pos: V3(-40.00001, 0, 39.99999), rot: QUAT(0, -0.707107, 0, 0.707107) },
    elitebullet08:           { hash:  40453, pos: V3(39.99999, 0, 40.00001), rot: QUAT(0, 0.707107, 0, 0.707107) },
    sticker1:                { hash: 45294, pos: V3(0, 0, 0), rot: QUAT(0, 1, 0, 0), type: 'Sticker' },
  },
  cylont1merit: {      // Cylon War Raider
    bullet01:                { hash:  49813, pos: V3(-2.70329, -0.148667, 3.27538), rot: QUAT() },
    bullet02:                { hash:  50321, pos: V3(-0.000001, -0.283107, 3.0353), rot: QUAT() },
    bullet03:                { hash:  19778, pos: V3(2.702999, -0.148667, 3.275382), rot: QUAT() },
    bullet04:                { hash:  50370, pos: V3(-2.70329, -0.385428, 1.778451), rot: QUAT() },
    bullet05:                { hash:  21514, pos: V3(2.702999, -0.385428, 1.778453), rot: QUAT() },
    sticker1:                { hash: 45294, pos: V3(0, 0.23, 0), rot: QUAT(0, 1, 0, 0), type: 'Sticker' },
  },
  cylont2merit: {      // Liche
    bullet01:                { hash:  49813, pos: V3(-16.000001, 0, 15.999999), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet02:                { hash:  50321, pos: V3(-15.999998, 0, -22.000001), rot: QUAT(-0.707107, 0, 0.707107, 0) },
    bullet03:                { hash:  19778, pos: V3(-12.000003, 0, 36.999999), rot: QUAT(-0.382684, 0, 0.92388, 0) },
    bullet04:                { hash:  50370, pos: V3(11.999997, 0, 37.000001), rot: QUAT(0.382683, 0, 0.92388, 0) },
    bullet05:                { hash:  21514, pos: V3(15.999999, 0, 16.000001), rot: QUAT(0.707107, 0, 0.707107, 0) },
    bullet06:                { hash:  64121, pos: V3(16.000002, 0, -21.999999), rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet07:                { hash:  64555, pos: V3(-0.000005, 0, 55), rot: QUAT() },
    sticker1:                { hash: 45294, pos: V3(-11.804052, -17.807526, 21.693772), rot: QUAT(0, 0.707107, 0, 0.707107), type: 'Sticker' },
    sticker2:                { hash: 36077, pos: V3(11.729173, -17.807522, 21.693786), rot: QUAT(0.707107, 0, 0.707107, 0), type: 'Sticker' },
    sticker3:                { hash: 13625, pos: V3(0.003742, 19.503265, 15.80273), rot: QUAT(), type: 'Sticker' },
  },
  cylont3merit: {      // Nidhogg
    bullet01:                { hash:  49813, pos: V3(-39.999996, 0, -45.000003), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet02:                { hash:  50321, pos: V3(-40.000003, 0, 39.999997), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet03:                { hash:  19778, pos: V3(-40.000006, 0, 63.526608), rot: QUAT(0, -0.608762, 0, 0.793353) },
    bullet04:                { hash:  50370, pos: V3(-25.000007, 0, 83.526609), rot: QUAT() },
    bullet05:                { hash:  21514, pos: V3(-0.000009, 0, 98.526611), rot: QUAT() },
    bullet06:                { hash:  64121, pos: V3(24.999993, 0, 83.526614), rot: QUAT() },
    bullet07:                { hash:  64555, pos: V3(39.999994, 0, 63.526615), rot: QUAT(0, 0.608761, 0, 0.793353) },
    bullet08:                { hash:  18078, pos: V3(39.999997, 0, 40.000003), rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet09:                { hash:  21539, pos: V3(40.000004, 0, -44.999997), rot: QUAT(0, 0.707107, 0, 0.707107) },
    sticker1:                { hash: 45294, pos: V3(-24.398796, 39.090797, -17.622797), rot: QUAT(0, -0.707107, -0.707107, 0), type: 'Sticker' },
    sticker2:                { hash: 36077, pos: V3(24.398796, 39.090805, -17.622801), rot: QUAT(0, -0.707107, -0.707107, 0), type: 'Sticker' },
    sticker3:                { hash: 13625, pos: V3(56.071203, -25.316422, -12.60885), rot: QUAT(0, -0.707107, -0.707107, 0), type: 'Sticker' },
    sticker4:                { hash: 42933, pos: V3(-56.071222, -25.316425, -12.608843), rot: QUAT(0, -0.707107, -0.707107, 0), type: 'Sticker' },
  },
  cylont4carrier: {    // Surtur
    bullet01_cannon:         { hash:  28205, pos: V3(65.966362, 19.785851, 170.628799), rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet02_cannon:         { hash:  64547, pos: V3(65.966339, 19.785851, -5.592278), rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet03_cannon:         { hash:  33935, pos: V3(65.966316, 19.785851, -210.91716), rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet04_cannon:         { hash:  51107, pos: V3(-65.056694, 19.785851, -210.917175), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet05_cannon:         { hash:  50525, pos: V3(-65.056671, 19.785851, -5.592293), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet06_cannon:         { hash:  28932, pos: V3(-65.056648, 19.785851, 170.628784), rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet07_defensive:      { hash:  19020, pos: V3(-52.658684, 30.283691, 277.500153), rot: QUAT(0, -0.258819, 0, 0.965926) },
    bullet09_defensive:      { hash:  55041, pos: V3(50.358261, 30.283691, 277.500153), rot: QUAT(0, 0.258819, 0, 0.965926) },
    bullet11_launcher:       { hash: 18846, pos: V3(-0.404771, 30.283691, -190.4048), rot: QUAT(0, 1, 0, 0) },
    bullet12_launcher:       { hash: 9558, pos: V3(-0.404771, 30.283691, 54.82122), rot: QUAT() },
    bullet13_defensive:      { hash: 41896, pos: V3(-72.072998, 23.752218, -307.778107), rot: QUAT(0, -0.965926, 0, 0.258819) },
    bullet14_defensive:      { hash: 60692, pos: V3(72.070297, 23.752218, -307.778107), rot: QUAT(0, 0.965926, 0, 0.258819) },
    sticker1:                { hash: 45294, pos: V3(0, 0, 0), rot: QUAT(), type: 'Sticker' },
  },
  basestar: {           // Basestar - REAL transforms, re-extracted from the client bundle 2026-08-02
    bullet01:                { hash:  49813, pos: V3(-296.495204, -95.217968, -471.633298), rot: QUAT(0.707107, 0, -0.707107, 0) },
    bullet02:                { hash:  50321, pos: V3(-205.681217, -95.183278, -303.448308), rot: QUAT(0.707107, 0, -0.707107, 0) },
    bullet03:                { hash:  19778, pos: V3(-114.924426, -95.183279, -137.685513), rot: QUAT(0.707107, 0, -0.707107, 0) },
    bullet04:                { hash:  50370, pos: V3(-52.10653, -78.137864, 169.300527), rot: QUAT(0.707107, 0, -0.707107, 0) },
    bullet05:                { hash:  21514, pos: V3(-16.278015, -96.090873, 631.334367), rot: QUAT(0, 0, 1, 0) },
    bullet06:                { hash:  64121, pos: V3(19.986557, -96.085159, 631.638038), rot: QUAT(0, 0, 1, 0) },
    bullet07:                { hash:  64555, pos: V3(65.895148, -78.127984, 169.294326), rot: QUAT(0.707107, 0, 0.707107, 0) },
    bullet08:                { hash:  18078, pos: V3(110.882001, -95.209135, -137.70636), rot: QUAT(0.707107, 0, 0.707107, 0) },
    bullet09:                { hash:  21539, pos: V3(207.363873, -95.209141, -303.46909), rot: QUAT(0.707107, 0, 0.707107, 0) },
    bullet10:                { hash:     10, pos: V3(301.058446, -95.207386, -471.554667), rot: QUAT(0.707107, 0, 0.707107, 0) },
    bullet11:                { hash:     11, pos: V3(0.000008, -0.000009, -19.171537), rot: QUAT(1, 0, 0, 0) },
    bullet12:                { hash:     12, pos: V3(-0.000011, -0.000006, 25.570395), rot: QUAT(1, 0, 0, 0) },
  },
  /* Guardian Basestar - REAL transforms, extracted from bundle 'cylon_t4_wing' 2026-08-03.
   * Twelve locators, of which HULL_SLOTS uses eight (see there for why).
   *
   * THE SLOT TYPES ARE ATTESTED, not inferred. The prefab carries a second container, 'Missiles
   * Backup', holding eleven turret MODELS parked at exactly these root-local positions and
   * rotations, and their names declare the class:
   *     Missile Launcher 01-05    -> bullet01, 04, 05, 06, 07     (bullet10 mirrors bullet07)
   *     Gun 01/02 u, Gun 01/02 o  -> bullet02, 03, 08, 09
   *     Point Defense 01 u / 02 o -> bullet11, 12
   * So the Guardian's authored armament is 6 launcher / 4 gun / 2 point defence - the Pegasus's
   * 6/4/2 with gun and launcher swapped.
   * cylont4wing_guardian_rusty has BYTE-IDENTICAL hardpoint transforms, so the paint below can swap
   * the whole model without invalidating a single spot on this World card. */
  cylont4wing_guardian: {
    bullet01:                { hash:  49813, pos: V3(384.299988, 60.5, 33.599998), rot: QUAT(0, 0.671768, 0, 0.740762) },
    bullet02:                { hash:  50321, pos: V3(-242.299988, -88.800003, -176.699997), rot: QUAT(0.893039, -0.008772, -0.448788, -0.031526) },
    bullet03:                { hash:  19778, pos: V3(-243.309998, -87.620003, 177.809998), rot: QUAT(0.441369, -0.045254, -0.895703, -0.029349) },
    bullet04:                { hash:  50370, pos: V3(384.599976, 60.5, -33.699997), rot: QUAT(0, 0.732832, 0, 0.68041) },
    bullet05:                { hash:  21514, pos: V3(86.699997, 60.5, 375.800018), rot: QUAT(0, 0.103707, 0, 0.994608) },
    bullet06:                { hash:  64121, pos: V3(152.5, 60.5, 358.699982), rot: QUAT(0, 0.179107, 0, 0.98383) },
    bullet07:                { hash:  64555, pos: V3(87.370003, 60.549999, -377.75), rot: QUAT(0, -0.992811, 0, -0.119696) },
    bullet08:                { hash:  18078, pos: V3(-281, 75.100006, -87.299995), rot: QUAT(-0.036406, 0.78885, -0.040178, -0.61219) },
    bullet09:                { hash:  21539, pos: V3(-283.299988, 75.5, 86.800003), rot: QUAT(-0.053954, 0.620611, -0.028641, -0.781735) },
    bullet10:                { hash:     10, pos: V3(150.399994, 60.549999, -354.399994), rot: QUAT(0, -0.978046, 0, -0.208388) },
    bullet11:                { hash:     11, pos: V3(92.399994, -116.5, -1.1), rot: QUAT(0.499726, 0.501808, -0.503297, 0.495131) },
    bullet12:                { hash:     12, pos: V3(-82.399994, 122.600014, -0.6), rot: QUAT(-0.001076, -0.708555, -0.003241, 0.705648) },
  },

  /* STATIONS. Extracted with tools/cardgen/extract-hardpoints.py against human_outpost /
   * cylon_outpost and the SIX stationary-platform prefabs ({human,cylon}_stationary_platform_
   * {small,medium,large}; small/large extracted 2026-07-31, two independent runs byte-identical,
   * both mediums re-extracted as controls and reproduced every mount below exactly), root-local
   * space, root transform excluded - the same tool and the same method that produced every hull
   * above. Root names match prefabName on the World cards exactly, so Spot.FindSpots binds all of
   * them.
   * HASHES: bullet01..bullet09 are the nine real hashes recovered from the live dump and used by
   * every hull in this file. bullet10 and up have NO attested hash (they do not occur in the
   * dump) and carry their own index, the same convention the Pegasus and Basestar already use. The
   * hash is only a join key - the client reads it off the wire (SpotDesc.cs:17) and never derives it
   * from the name - so any value distinct within the card works, and these are distinct.
   * PLACEHOLDERS: every platform prefab's trailing two transforms sit at the model origin with
   * identity rotation on BOTH factions (medium bullet14/15, small bullet11/12, large bullet17/18):
   * placeholders, not mounts. They are emitted as spots (they are real transforms) but no slot
   * points at them, which leaves exactly 13 (medium) / 10 (small) / 16 (large) usable mounts.
   * Medium's 13 matches the wiki's attested 8 cannon + 5 launcher exactly, and small's 10 matches
   * the Light Sentry's 8 + 2 (Outposts.txt:37-38) - two independent sources agreeing is why those
   * loadouts are not guesses. Large's 16 is ONE SHORT of the Heavy Sentry's attested 17 weapons
   * (8 cannon + 5 missile + 2 flak + 2 PD, Outposts.txt:39): the 5th launcher takes a hand-written
   * 17th slot sharing a missile mount's spot - see the PLATFORMS emit. */
  humanoutpost: {
    bullet01:                { hash: 49813, pos: V3(-33.999977, 44, 60.000013),     rot: QUAT(0, 0.707107, 0, -0.707107) },
    bullet02:                { hash: 50321, pos: V3(34.000023, 44, 59.999987),      rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet03:                { hash: 19778, pos: V3(-34.000027, 44, -69.999987),    rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet04:                { hash: 50370, pos: V3(33.999973, 44, -70.000013),     rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet05:                { hash: 21514, pos: V3(-68.000062, 23, -159.999974),   rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet06:                { hash: 64121, pos: V3(67.999938, 23, -160.000026),    rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet07:                { hash: 64555, pos: V3(-87.999891, -15, 279.000034),   rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet08:                { hash: 18078, pos: V3(88.000109, -15, 278.999966),    rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet09:                { hash: 21539, pos: V3(0.000041, 73, 105),             rot: QUAT(-0.5, 0.5, 0.5, 0.5) },
    bullet10:                { hash: 10,    pos: V3(42.000102, 20, 262.999984),     rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet11:                { hash: 11,    pos: V3(-43.999898, 20, 262.999956),    rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet12:                { hash: 12,    pos: V3(0.999983, 72, -42.999997),      rot: QUAT(0, 0.707107, 0, 0.707107) },
  },
  cylonoutpost: {
    bullet01:                { hash: 49813, pos: V3(-63.999961, -16, 100.000025),   rot: QUAT(0, 0.707107, 0, -0.707107) },
    bullet02:                { hash: 50321, pos: V3(64.000039, -16, 99.999975),     rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet03:                { hash: 19778, pos: V3(-87.000049, -11, -126.999966),  rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet04:                { hash: 50370, pos: V3(86.999951, -11, -127.000034),   rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet05:                { hash: 21514, pos: V3(-15.999942, 24, 150.000006),    rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet06:                { hash: 64121, pos: V3(16.000058, 24, 149.999994),     rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet07:                { hash: 64555, pos: V3(-17.999914, 12, 222.000007),    rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet08:                { hash: 18078, pos: V3(18.000086, 12, 221.999993),     rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet09:                { hash: 21539, pos: V3(0.000045, 26, 115),             rot: QUAT(0, -0.707107, -0.707107, 0) },
    bullet10:                { hash: 10,    pos: V3(17.000028, 20, 72.999993),      rot: QUAT(0, -0.707107, -0.707107, 0) },
    bullet11:                { hash: 11,    pos: V3(-33.999972, 20, 72.999998),     rot: QUAT(0, -0.707107, -0.707107, 0) },
    bullet12:                { hash: 12,    pos: V3(-0.000061, 61, -156),           rot: QUAT(-0.707107, 0, 0, 0.707107) },
  },
  human_stationary_platform_medium: {
    bullet01:                { hash: 49813, pos: V3(117.916801, 31.003754, -97.114285),  rot: QUAT(0, -0.92388, 0, -0.382683) },
    bullet02:                { hash: 50321, pos: V3(80.626129, 76.109222, 0.000737),     rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet03:                { hash: 19778, pos: V3(119.525909, 32.272653, 98.308704),   rot: QUAT(0, 0.382683, 0, 0.92388) },
    bullet04:                { hash: 50370, pos: V3(9.627334, -116.559143, 1.144647),    rot: QUAT(0, 0.707107, -0.707107, 0) },
    bullet05:                { hash: 21514, pos: V3(-69.902313, -51.39315, -0.454976),   rot: QUAT(0.000001, -0.707107, 0, 0.707107) },
    bullet06:                { hash: 64121, pos: V3(-70.901001, 48.715301, -1.400302),   rot: QUAT(0.000001, -0.707105, 0, 0.707109) },
    bullet07:                { hash: 64555, pos: V3(-126.589981, 31.888662, -0.15147),   rot: QUAT(0.000001, -0.707107, 0, 0.707107) },
    bullet08:                { hash: 18078, pos: V3(19.739944, 30.635903, -78.214047),   rot: QUAT(0, 1, 0, 0) },
    bullet09:                { hash: 21539, pos: V3(20.574476, 30.279648, 74.628612),    rot: QUAT(0, 0, 1, 0.000001) },
    bullet10:                { hash: 10,    pos: V3(30.913639, -116.559143, 1.144647),   rot: QUAT(0.707107, 0, 0, 0.707107) },
    bullet11:                { hash: 11,    pos: V3(19.856293, -30.535092, -74.792759),  rot: QUAT(0.965926, 0, 0, 0.258819) },
    bullet12:                { hash: 12,    pos: V3(92.505486, -0.777341, 1.29406),      rot: QUAT(0.407486, -0.571888, 0.594225, -0.392169) },
    bullet13:                { hash: 13,    pos: V3(16.731445, -30.653921, 75.005673),   rot: QUAT(-0.075195, -0.07582, 0.700926, -0.705195) },
    bullet14:                { hash: 14,    pos: V3(0, 0, 0),                            rot: QUAT(0, 0, 0, 1) },
    bullet15:                { hash: 15,    pos: V3(0, 0, 0),                            rot: QUAT(0, 0, 0, 1) },
  },
  cylon_stationary_platform_medium: {
    bullet01:                { hash: 49813, pos: V3(115.882324, 107.463478, -58.472899),  rot: QUAT(0, -1, 0, 0) },
    bullet02:                { hash: 50321, pos: V3(122.410278, 107.699087, -15.303223),  rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet03:                { hash: 19778, pos: V3(121.282593, 107.237402, 46.401116),   rot: QUAT(0, 0.444881, 0, 0.89559) },
    bullet04:                { hash: 50370, pos: V3(-14.191986, -151.526886, 1.488037),   rot: QUAT(-0.186256, -0.695117, 0.67069, -0.179711) },
    bullet05:                { hash: 21514, pos: V3(-116.158661, 107.511423, 67.803712),  rot: QUAT(0.000001, 0.000003, 0, 1) },
    bullet06:                { hash: 64121, pos: V3(-121.217377, 107.511483, 4.903076),   rot: QUAT(0.000001, -0.707105, 0, 0.707109) },
    bullet07:                { hash: 64555, pos: V3(-121.217651, 107.511531, -38.041503), rot: QUAT(0.000001, -0.866024, 0, 0.500003) },
    bullet08:                { hash: 18078, pos: V3(0.146973, 23.614074, -119.809085),    rot: QUAT(0.994695, 0, 0, 0.102869) },
    bullet09:                { hash: 21539, pos: V3(-0.245972, 85.013517, 152.369389),    rot: QUAT(0, -0.187918, 0.982185, 0) },
    bullet10:                { hash: 10,    pos: V3(14.229004, -151.526886, 1.488037),    rot: QUAT(-0.719638, 0, 0, -0.694349) },
    bullet11:                { hash: 11,    pos: V3(0.168488, -9.027115, -70.708739),     rot: QUAT(0.965926, 0, 0, 0.258819) },
    bullet12:                { hash: 12,    pos: V3(72.746094, -9.027115, 1.989494),      rot: QUAT(0.407486, -0.571888, 0.594225, -0.392169) },
    bullet13:                { hash: 13,    pos: V3(0.07251, 5.396919, 78.778816),        rot: QUAT(-0.075195, -0.07582, 0.700926, -0.705195) },
    bullet14:                { hash: 14,    pos: V3(0, 0, 0),                             rot: QUAT(0, 0, 0, 1) },
    bullet15:                { hash: 15,    pos: V3(0, 0, 0),                             rot: QUAT(0, 0, 0, 1) },
  },
  human_stationary_platform_small: {
    bullet01:                { hash: 49813, pos: V3(-0.975564, -24.249673, -34.897622),  rot: QUAT(-1, 0, 0, 0) },
    bullet02:                { hash: 50321, pos: V3(-0.975453, -25.087298, 36.360309),   rot: QUAT(0, 0, -1, 0) },
    bullet03:                { hash: 19778, pos: V3(-25.618008, 20.559246, 0.102767),    rot: QUAT(0, -0.707107, 0, 0.707107) },
    bullet04:                { hash: 50370, pos: V3(25.306063, 20.844299, 0.098217),     rot: QUAT(0, 0.707107, 0, 0.707107) },
    bullet05:                { hash: 21514, pos: V3(-21.668188, -47.746196, -22.01276),  rot: QUAT(-0.653281, 0.653282, 0.270599, -0.270597) },
    bullet06:                { hash: 64121, pos: V3(20.628445, -47.574407, 20.283887),   rot: QUAT(-0.270598, 0.270598, -0.653281, 0.653281) },
    bullet07:                { hash: 64555, pos: V3(-9.20761, -78.101799, -0.10589),     rot: QUAT(-0.707107, 0, 0, -0.707107) },
    bullet08:                { hash: 18078, pos: V3(9.64624, -77.685967, -0.479032),     rot: QUAT(0.707107, 0, 0, 0.707107) },
    bullet09:                { hash: 21539, pos: V3(0.319896, -77.681411, 9.042824),     rot: QUAT(0, 0.707107, -0.707107, 0) },
    bullet10:                { hash: 10,    pos: V3(0.345667, -76.922662, -10.11031),    rot: QUAT(0.706289, -0.033991, 0.033991, 0.706289) },
    bullet11:                { hash: 11,    pos: V3(0, 0, 0),                            rot: QUAT(0, 0, 0, 1) },
    bullet12:                { hash: 12,    pos: V3(0, 0, 0),                            rot: QUAT(0, 0, 0, 1) },
  },
  cylon_stationary_platform_small: {
    bullet01:                { hash: 49813, pos: V3(32.785934, 41.80371, -66.556372),    rot: QUAT(-0.010034, -0.923562, 0.024224, -0.382552) },
    bullet02:                { hash: 50321, pos: V3(-32.941433, 41.998227, 66.46271),    rot: QUAT(-0.011753, -0.382652, -0.004868, 0.923805) },
    bullet03:                { hash: 19778, pos: V3(-66.540657, 41.61452, -32.938383),   rot: QUAT(0.005667, -0.923778, 0.013681, 0.382641) },
    bullet04:                { hash: 50370, pos: V3(66.366219, 41.757824, 32.792097),    rot: QUAT(0.008175, 0.382668, -0.003386, 0.923844) },
    bullet05:                { hash: 21514, pos: V3(0.101318, 0.156658, -56.551758),     rot: QUAT(0, -1, -0.000001, 0.000003) },
    bullet06:                { hash: 64121, pos: V3(0.101318, 0.156647, 57.704594),      rot: QUAT(0, 0, 0, 1) },
    bullet07:                { hash: 64555, pos: V3(-11.969893, -76.653985, -3.49823),   rot: QUAT(-0.707107, 0, 0, -0.707107) },
    bullet08:                { hash: 18078, pos: V3(12.540112, -75.686423, 6.494178),    rot: QUAT(0.707107, 0, 0, 0.707107) },
    bullet09:                { hash: 21539, pos: V3(5.670044, -76.063666, 13.162598),    rot: QUAT(0, 0.707107, -0.707107, 0) },
    bullet10:                { hash: 10,    pos: V3(-4.650154, -77.091958, -10.558838),  rot: QUAT(0.706289, -0.033991, 0.033991, 0.706289) },
    bullet11:                { hash: 11,    pos: V3(0, 0, 0),                            rot: QUAT(0, 0, 0, 1) },
    bullet12:                { hash: 12,    pos: V3(0, 0, 0),                            rot: QUAT(0, 0, 0, 1) },
  },
  human_stationary_platform_large: {
    bullet01:                { hash: 49813, pos: V3(118.12323, 103.423279, -116.891151),     rot: QUAT(0, 0.92388, 0, 0.382683) },
    bullet02:                { hash: 50321, pos: V3(-115.93499, 103.423279, 117.1679),       rot: QUAT(0, -0.382683, 0, 0.92388) },
    bullet03:                { hash: 19778, pos: V3(-116.41449, 104.387817, -116.850105),    rot: QUAT(0, -0.92388, 0, 0.382683) },
    bullet04:                { hash: 50370, pos: V3(118.2948, 104.387817, 117.017944),       rot: QUAT(0, 0.382683, 0, 0.92388) },
    bullet05:                { hash: 21514, pos: V3(-116.329956, -136.003632, -116.891197),  rot: QUAT(-0.000002, 0.92388, -0.000001, -0.382683) },
    bullet06:                { hash: 64121, pos: V3(117.728027, -136.826019, 117.1679),      rot: QUAT(0.000001, -0.382683, -0.000002, -0.92388) },
    bullet07:                { hash: 64555, pos: V3(118.122986, -136.117737, -116.934814),   rot: QUAT(-0.000002, 0.923879, 0.000001, 0.382684) },
    bullet08:                { hash: 18078, pos: V3(-116.166382, -135.897552, 117.353233),   rot: QUAT(0.000001, -0.382685, 0.000002, 0.923879) },
    bullet09:                { hash: 21539, pos: V3(134.138306, -78.926582, -0.056122),      rot: QUAT(-0.000001, 0.707105, 0.000002, 0.707108) },
    bullet10:                { hash: 10,    pos: V3(134.900818, 23.163277, -0.055939),       rot: QUAT(-0.000001, 0.707105, 0.000002, 0.707108) },
    bullet11:                { hash: 11,    pos: V3(-134.902313, -78.927742, -0.057312),     rot: QUAT(0.000002, -0.707108, 0.000001, 0.707106) },
    bullet12:                { hash: 12,    pos: V3(-136.845032, 23.162153, -0.057098),      rot: QUAT(-0.000002, 0.707108, -0.000001, -0.707105) },
    bullet13:                { hash: 13,    pos: V3(115.712952, 104.176376, -115.748047),    rot: QUAT(0, -0.92388, 0, -0.382683) },
    bullet14:                { hash: 14,    pos: V3(-114.991364, 104.176376, 115.691376),    rot: QUAT(0, -0.382683, 0, 0.92388) },
    bullet15:                { hash: 15,    pos: V3(-115.04303, 105.140907, -115.663406),    rot: QUAT(0, -0.92388, 0, 0.382683) },
    bullet16:                { hash: 16,    pos: V3(115.932129, 105.140907, 115.440063),     rot: QUAT(0, 0.382683, 0, 0.92388) },
    bullet17:                { hash: 17,    pos: V3(0, 0, 0),                                rot: QUAT(0, 0, 0, 1) },
    bullet18:                { hash: 18,    pos: V3(0, 0, 0),                                rot: QUAT(0, 0, 0, 1) },
  },
  cylon_stationary_platform_large: {
    bullet01:                { hash: 49813, pos: V3(179.42453, 95.615448, -2.090332),      rot: QUAT(0.183013, -0.683013, -0.183013, -0.683012) },
    bullet02:                { hash: 50321, pos: V3(179.42453, -64.551163, -2.090332),     rot: QUAT(-0.683014, 0.183012, -0.683012, -0.183013) },
    bullet03:                { hash: 19778, pos: V3(179.42453, 26.502655, -2.090332),      rot: QUAT(0, -0.707108, 0, -0.707106) },
    bullet04:                { hash: 50370, pos: V3(-172.485107, 95.615448, 1.702637),     rot: QUAT(0.183013, 0.683011, 0.183013, -0.683015) },
    bullet05:                { hash: 21514, pos: V3(-172.485107, -64.551163, 2.036377),    rot: QUAT(-0.183013, 0.683012, -0.183013, -0.683014) },
    bullet06:                { hash: 64121, pos: V3(-172.485107, 25.360825, 0.253418),     rot: QUAT(0, 0.707106, 0, -0.707108) },
    bullet07:                { hash: 64555, pos: V3(2.194824, 95.615448, 172.032227),      rot: QUAT(0.25882, -0.000002, 0, -0.965926) },
    bullet08:                { hash: 18078, pos: V3(2.194824, -64.551163, 172.032227),     rot: QUAT(-0.000002, 0.258819, -0.965926, -0.000001) },
    bullet09:                { hash: 21539, pos: V3(2.194824, 26.502655, 172.032227),      rot: QUAT(0, -0.000002, 0, -1) },
    bullet10:                { hash: 10,    pos: V3(-0.931152, 95.615448, -176.026123),    rot: QUAT(0.000001, 0.965926, 0.25882, -0.000004) },
    bullet11:                { hash: 11,    pos: V3(-0.931152, -64.551163, -176.026123),   rot: QUAT(0.965926, 0.000002, -0.000004, 0.258819) },
    bullet12:                { hash: 12,    pos: V3(-0.931152, 26.502655, -176.026123),    rot: QUAT(0, 1, 0, -0.000004) },
    bullet13:                { hash: 13,    pos: V3(104.554199, 105.507324, -102.128906),  rot: QUAT(0, -0.92388, 0, -0.382682) },
    bullet14:                { hash: 14,    pos: V3(-99.551514, 106.130859, 101.978027),   rot: QUAT(0, 0.382682, 0, -0.92388) },
    bullet15:                { hash: 15,    pos: V3(104.554199, -74.424911, -102.128906),  rot: QUAT(0.92388, 0, 0.382682, 0) },
    bullet16:                { hash: 16,    pos: V3(-103.525864, -77.219147, 105.952393),  rot: QUAT(0.382682, 0, -0.92388, 0) },
    bullet17:                { hash: 17,    pos: V3(0, 0, 0),                              rot: QUAT(0, 0, 0, 1) },
    bullet18:                { hash: 18,    pos: V3(0, 0, 0),                              rot: QUAT(0, 0, 0, 1) },
  },
  humant1stealth: {    // Raven Mk VI-R
    bullet01:                { hash:  49813, pos: V3(-1.100179, 0.030954, 3.466641), rot: QUAT(0, 0, -1, 0) },
    bullet02:                { hash:  50321, pos: V3(0, 0, 2.53), rot: QUAT(0, 0, -1, 0) },
    bullet03:                { hash:  19778, pos: V3(1.098442, 0.036733, 3.469342), rot: QUAT(0, 0, -1, 0) },
    bullet04:                { hash:  50370, pos: V3(1.537918, -0.676627, -0.956552), rot: QUAT(0, 0, -1, 0) },
    sticker1:                { hash:  45294, pos: V3(0, 0, 0), rot: QUAT(0, -1, 0, 0), type: 'Sticker' },
  },
  cylont1stealth: {    // Malefactor Type-1
    bullet01:                { hash:  49813, pos: V3(-2.02463, 0.208, 2.340462), rot: QUAT(0, 0, -0.000504, -1) },
    bullet02:                { hash:  50321, pos: V3(2.025008, 0.208, 2.340462), rot: QUAT(0, 0, 0.000504, -1) },
    bullet03:                { hash:  19778, pos: V3(-0.01355, 0.016299, 1.517462), rot: QUAT(0, 0, -1, 0.000504) },
    bullet04:                { hash:  50370, pos: V3(1.5, -0.806, 0.315582), rot: QUAT(0, 0, -1, -0.000504) },
    // sticker01: no known hash for this transform name - spot skipped
    // sticker02: no known hash for this transform name - spot skipped
    // sticker03: no known hash for this transform name - spot skipped
  },
  humant1multi2: {    // Viper Mk III
    bullet01:                { hash:  49813, pos: V3(-1.03109, -0.146515, 2.341967), rot: QUAT(0, 0, -1, 0) },
    bullet02:                { hash:  50321, pos: V3(0, -0.306091, 4.179352), rot: QUAT(0, 0, -1, 0) },
    bullet03:                { hash:  19778, pos: V3(1.032542, -0.142746, 2.340218), rot: QUAT(0, 0, -1, 0) },
    elitebullet04:           { hash:  27288, pos: V3(0, -0.687683, -0.119947), rot: QUAT(0, 0, -1, 0) },
    sticker1:                { hash:  45294, pos: V3(0, 0, 0), rot: QUAT(0, 1, 0, 0), type: 'Sticker' },
  },
  cylont1multi2: {    // 'Cylon War' Raider Mk II
    bullet01:                { hash:  49813, pos: V3(2.666121, 0, 3.5), rot: QUAT(0, 0, 0, 1) },
    bullet02:                { hash:  50321, pos: V3(0, -0.113292, 1.4), rot: QUAT(0, 0, 0, 1) },
    bullet03:                { hash:  19778, pos: V3(-2.660084, 0, 3.5), rot: QUAT(0, 0, 0, 1) },
    elitebullet04:           { hash:  27288, pos: V3(0, -0.360802, 0), rot: QUAT(0, 0, 0, 1) },
    sticker1:                { hash:  45294, pos: V3(0, 0.032953, -1), rot: QUAT(0, -1, 0, 0), type: 'Sticker' },
    sticker2:                { hash:  36077, pos: V3(0, 0.032953, -1), rot: QUAT(0, -1, 0, 0), type: 'Sticker' },
    sticker3:                { hash:  13625, pos: V3(0, -0.016013, -1), rot: QUAT(0, -1, 0, 0), type: 'Sticker' },
    sticker4:                { hash:  42933, pos: V3(0, -0.016013, -1), rot: QUAT(0, -1, 0, 0), type: 'Sticker' },
  },
};

/* Slot ids are RECOVERED DATA, not a choice: each hull's set is exactly the SlotLayouts of its own
 * shipped paperdoll layout file, and the level is which UpgradeLevel first lists it.
 *
 * Only slots with Level <= ShipCard.Level are instantiated (HangarShip.java:99-105), and
 * ShipCard.Level is pinned at 1 - so the level-2 entries here are declarative. Do NOT "unlock"
 * them by raising ShipCard.Level to 2: the buy handler refuses any card with Level > 1 and
 * returns SILENTLY, giving a hull that cannot be bought with no error on either side.
 *
 * WHICH physical mount serves WHICH slot is the one free choice, made by rule, not by eye:
 * slot 2 is where every shipped ShipConfigTemplate mounts the missile, and the remaining slots
 * take mounts outermost-first so the symmetric wing pair gets the first gun slots rather than a
 * nose mount. Slot 2 is an ORDINARY 'weapon' slot on every sub-T4 row: the dump gives T1-T3 hulls
 * zero 'launcher' slots (launcher exists on exactly four prefabs - the two stealth hulls and the
 * two T4 capitals) and types their missiles 'weapon', competing with cannons for hardpoints. The
 * rows below said 'launcher' until the missile retype and would have re-created a slot no system
 * can fill if this fallback ever fired.
 * Format: [SlotId, SystemType, ObjectPoint, unlock Level]. */
const HULL_SLOTS = {
  humant1fighter:     [[0, 'weapon', 'bullet03', 1], [1, 'weapon', 'bullet01', 1], [2, 'weapon', 'elitebullet04', 1], [12, 'weapon', 'bullet02', 2]],
  humant2fighter:     [[0, 'weapon', 'bullet01', 1], [1, 'weapon', 'bullet04', 1], [2, 'weapon', 'elitebullet06', 1], [3, 'weapon', 'bullet03', 1], [12, 'weapon', 'bullet02', 2], [13, 'weapon', 'elitebullet05', 2]],
  humant3fighter:     [[12, 'weapon', 'bullet06', 1], [1, 'weapon', 'bullet01', 1], [2, 'weapon', 'elitebullet07', 1], [3, 'weapon', 'bullet02', 1], [4, 'weapon', 'bullet05', 1], [13, 'weapon', 'bullet03', 1], [0, 'weapon', 'bullet04', 1], [5, 'weapon', 'elitebullet08', 1]],
  humant1command:     [[0, 'weapon', 'bullet03', 1], [1, 'weapon', 'bullet01', 1], [2, 'weapon', 'elitebullet04', 1], [12, 'weapon', 'bullet02', 2]],
  humant2command:     [[0, 'weapon', 'bullet04', 1], [1, 'weapon', 'bullet01', 1], [2, 'weapon', 'elitebullet05', 1], [5, 'weapon', 'bullet02', 1], [12, 'weapon', 'bullet03', 1], [13, 'weapon', 'elitebullet06', 1]],
  humant3command:     [[0, 'weapon', 'bullet05', 1], [1, 'weapon', 'bullet02', 1], [2, 'weapon', 'elitebullet08', 1], [3, 'weapon', 'bullet06', 1], [4, 'weapon', 'bullet01', 1], [5, 'weapon', 'bullet03', 1], [14, 'weapon', 'bullet04', 2], [15, 'weapon', 'elitebullet07', 2]],
  humant1defender:    [[0, 'weapon', 'bullet03', 1], [1, 'weapon', 'bullet01', 1], [2, 'weapon', 'elitebullet04', 1], [12, 'weapon', 'bullet02', 1], [13, 'weapon', 'elitebullet05', 2]],
  humant2defender:    [[0, 'weapon', 'bullet04', 1], [1, 'weapon', 'bullet01', 1], [2, 'weapon', 'elitebullet05', 1], [3, 'weapon', 'bullet02', 1], [16, 'weapon', 'bullet03', 1], [12, 'weapon', 'bullet07', 2], [13, 'weapon', 'elitebullet06', 2]],
  humant3defender:    [[4, 'weapon', 'bullet06', 1], [0, 'weapon', 'bullet05', 1], [1, 'weapon', 'bullet02', 1], [2, 'weapon', 'elitebullet08', 1], [3, 'weapon', 'bullet01', 1], [5, 'weapon', 'bullet03', 1], [12, 'weapon', 'bullet04', 2], [13, 'weapon', 'elitebullet07', 2]],
  humant1merit:       [[3, 'weapon', 'bullet03', 1], [4, 'weapon', 'bullet01', 1], [2, 'weapon', 'bullet04', 1], [0, 'weapon', 'bullet05', 1], [1, 'weapon', 'bullet02', 2]],
  humant2merit:       [[0, 'weapon', 'bullet06', 1], [2, 'weapon', 'bullet01', 1], [4, 'weapon', 'bullet05', 1], [1, 'weapon', 'bullet02', 1], [5, 'weapon', 'bullet03', 1], [6, 'weapon', 'bullet04', 1], [3, 'weapon', 'bullet07', 2]],
  humant3merit:       [[4, 'weapon', 'bullet09', 1], [0, 'weapon', 'bullet02', 1], [1, 'weapon', 'bullet07', 1], [2, 'weapon', 'bullet03', 1], [3, 'weapon', 'bullet08', 1], [5, 'weapon', 'bullet01', 1], [12, 'weapon', 'bullet06', 1], [13, 'weapon', 'bullet04', 1], [15, 'weapon', 'bullet05', 2]],
  humant4carrier:     [[0, 'weapon', 'bullet13_defensive', 1], [1, 'weapon', 'bullet14_defensive', 1], [2, 'launcher', 'bullet12_launcher', 1], [3, 'weapon', 'bullet01_cannon', 1], [4, 'weapon', 'bullet02_cannon', 1], [5, 'weapon', 'bullet03_cannon', 1], [6, 'weapon', 'bullet04_cannon', 1], [7, 'weapon', 'bullet05_cannon', 1], [8, 'weapon', 'bullet06_cannon', 1], [9, 'weapon', 'bullet07_defensive', 1], [20, 'weapon', 'bullet09_defensive', 2], [21, 'weapon', 'bullet11_launcher', 2]],
  /* THE TWO COMMAND-TOKEN CAPITALS. Neither exists in the live-server dump - that server has only
   * the t4 carriers - so these are the one place the slot map still has to be reasoned out rather
   * than read off.
   *
   * The map below is UNCHANGED by the move from 'pegasus' to 'humant4pegasus' (see hull 5017). The
   * two prefabs number their mounts the same way, so the id->point assignment survived the repoint
   * intact; only the coordinates it reasons over got better. On the real prefab:
   *   bullet01,02,03  port, aft to bow        bullet08,09,10  starboard, bow to aft
   *   bullet04,05     port bow, forward-firing   bullet06,07   starboard bow, forward-firing
   *   bullet11 z=+528 bow, facing forward     bullet12 z=-508 stern, facing aft
   * Ten broadside/bow turrets and a centre-line point-defence pair covering both approaches.
   *
   * WHAT GOES WHERE IS SETTLED BY THE WIKI, AND THE GEOMETRY AGREES WITH IT EXACTLY.
   * research/bsgo_wiki/Battlestar Pegasus.txt:50-52 lists the ship as pre-installed with twelve
   * level-15 systems - 6 Cannon Battery, 4 Missile Battery, 2 Point Defence Battery - and twelve is
   * our hardpoint count. The mounts fall into precisely those three groups by FACING:
   *   broadside, forward = +-(1,0,0)   bullet01,02,03 + bullet08,09,10   SIX  -> gun (cannon)
   *   bow arc, forward-outboard/ahead  bullet04,05    + bullet06,07      FOUR -> launcher (missile)
   *   centre line, fore and aft        bullet11,12                       TWO  -> defensive_weapon
   * Six, four and two, matching the wiki's counts without being told them.
   *
   * The centre pair is point defence, NOT launchers. The dumped t4 carriers name their launcher
   * points bullet11_launcher/bullet12_launcher, and that index coincidence is what put launchers
   * here in an earlier pass; but the Pegasus is a different ship, its own page says point defence,
   * and on the real prefab this pair is a bow/stern axial pair rather than the carriers' pair of
   * amidships bays. defensive_weapon is the slot type both point defence and flak use.
   *
   * All twelve ids stay inside the 0-13 set the paperdoll defines
   * (ship_commandtoken_{pegasus,basestar}_paperdoll_layouts), leaving 12 and 13 free rather than
   * filled with invented module slots. */
  humant4pegasus:     [[0, 'gun', 'bullet01', 1], [1, 'gun', 'bullet02', 1], [2, 'gun', 'bullet03', 1], [3, 'launcher', 'bullet04', 1], [4, 'launcher', 'bullet05', 1], [5, 'launcher', 'bullet06', 1], [6, 'launcher', 'bullet07', 1], [7, 'gun', 'bullet08', 1], [8, 'gun', 'bullet09', 1], [9, 'gun', 'bullet10', 1], [10, 'defensive_weapon', 'bullet11', 1], [11, 'defensive_weapon', 'bullet12', 1]],
  /* THE TWO FLAGSHIPS - EIGHT batteries each, 4 gun / 2 launcher / 2 defensive, identical on
   * both because they share FLAGSHIP_FLIGHT by reference and armament parity is the whole point
   * of that stat block.
   *
   * Eight, not the Pegasus's twelve, because galactica.prefab HAS eight mounts. A previous pass
   * synthesised bullet09-12 to reach twelve, but Spot.FindSpots matches ObjectPointName against
   * transform names by exact equality and drops misses without a log line, so those four descs
   * produced no Spot -> GetObjectPoint returned null -> Modules.BuildModules hit `continue` ->
   * no turret model, no muzzle flash, no tracer on four of the twelve bays. Re-checked 2026-08-04
   * by dumping every Transform in the galactica bundle: there is nothing else to bind to (see
   * HARDPOINTS.galactica), and no value in HARDPOINTS can move a turret on screen - only the NAME
   * matters client-side. So the choice was four permanently bald bays or eight real ones, and the
   * Guardian drops with her because a Cylon flagship out-gunning its Colonial counterpart by four
   * batteries would undo the parity. The flagships now carry fewer tubes than the twelve-bay
   * Pegasus pair and out-hit them per bay on the FLAGSHIP stat block instead; whether that trade
   * is balanced is a play question, flagged in TODO.md under Balance.
   *
   * Type split on the Galactica is by geometry, bow to stern: the bow pair throws missiles, the
   * middle pairs are the cannon battery. Point defence goes FORE AND AFT, never as a pair -
   * bullet07/08 are both at z = -567, and putting the two defensive bays there left every flak
   * burst coming out of the stern with the bow undefended, which is exactly how it looked in
   * flight. bullet01 (z = +499) and bullet07 (z = -567) are the hull's own extremes, matching the
   * Pegasus, whose real prefab puts its pair at +528 and -508.
   *
   * MaxCountPerShip ON THE CAPITAL WEAPONS: the caps stay at the Pegasus pair's 6 gun / 4
   * launcher / 2 defensive, which the twelve-bay hulls still need; a cap above a hull's bay count
   * is harmless, a cap below it makes bays unfillable. 4 <= 6, 2 <= 4, 2 <= 2, all fine.
   *
   * SLOT 12 IS THE PAINT BAY on both. The two command-token paperdolls define big-layout ids 0-13
   * at level 1 and 0-12 at level 2, so 12 is the only id that is safe at BOTH levels; 13 would be a
   * NullReferenceException on any level-2 card. These hulls can never reach level 2 (rentalOnly
   * forces nextShipCardGuid 0), but a bay that is only safe by accident is not worth the saving. */
  galactica:          [[0, 'launcher', 'bullet02', 1], [1, 'launcher', 'bullet03', 1], [2, 'gun', 'bullet04', 1], [3, 'gun', 'bullet05', 1], [4, 'gun', 'bullet06', 1], [5, 'gun', 'bullet08', 1], [6, 'defensive_weapon', 'bullet01', 1], [7, 'defensive_weapon', 'bullet07', 1], [12, 'ship_paint', 'undefined', 1]],
  cylont1fighter:     [[0, 'weapon', 'bullet01', 1], [1, 'weapon', 'bullet03', 1], [2, 'weapon', 'elitebullet04', 1], [12, 'weapon', 'bullet02', 2]],
  cylont2fighter:     [[0, 'weapon', 'bullet01', 1], [1, 'weapon', 'bullet04', 1], [2, 'weapon', 'elitebullet06', 1], [3, 'weapon', 'bullet03', 1], [12, 'weapon', 'bullet02', 2], [13, 'weapon', 'elitebullet05', 2]],
  cylont3fighter:     [[12, 'weapon', 'bullet02', 1], [13, 'weapon', 'bullet05', 1], [0, 'weapon', 'bullet01', 1], [1, 'weapon', 'bullet06', 1], [2, 'weapon', 'elitebullet07', 1], [3, 'weapon', 'bullet03', 1], [4, 'weapon', 'bullet04', 1], [5, 'weapon', 'elitebullet08', 1]],
  cylont1command:     [[0, 'weapon', 'bullet01', 1], [1, 'weapon', 'bullet03', 1], [2, 'weapon', 'elitebullet04', 1], [9, 'weapon', 'bullet02', 2]],
  cylont2command:     [[0, 'weapon', 'bullet01', 1], [1, 'weapon', 'bullet04', 1], [2, 'weapon', 'elitebullet05', 1], [3, 'weapon', 'bullet02', 1], [12, 'weapon', 'bullet03', 1], [13, 'weapon', 'elitebullet06', 1]],
  cylont3command:     [[2, 'weapon', 'elitebullet07', 1], [3, 'weapon', 'bullet02', 1], [0, 'weapon', 'bullet06', 1], [1, 'weapon', 'bullet01', 1], [4, 'weapon', 'bullet05', 1], [5, 'weapon', 'bullet03', 1], [12, 'weapon', 'bullet04', 2], [13, 'weapon', 'elitebullet08', 2]],
  cylont1defender:    [[12, 'weapon', 'bullet02', 1], [0, 'weapon', 'bullet01', 1], [1, 'weapon', 'bullet03', 1], [2, 'weapon', 'elitebullet04', 1], [13, 'weapon', 'elitebullet05', 2]],
  cylont2defender:    [[0, 'weapon', 'bullet04', 1], [1, 'weapon', 'bullet01', 1], [2, 'weapon', 'elitebullet05', 1], [3, 'weapon', 'bullet02', 1], [16, 'weapon', 'bullet03', 1], [12, 'weapon', 'bullet07', 2], [13, 'weapon', 'elitebullet06', 2]],
  cylont3defender:    [[0, 'weapon', 'bullet02', 1], [1, 'weapon', 'bullet06', 1], [2, 'weapon', 'elitebullet07', 1], [3, 'weapon', 'bullet01', 1], [4, 'weapon', 'bullet05', 1], [5, 'weapon', 'bullet03', 1], [12, 'weapon', 'bullet04', 2], [13, 'weapon', 'elitebullet08', 2]],
  cylont1merit:       [[3, 'weapon', 'bullet01', 1], [4, 'weapon', 'bullet04', 1], [2, 'weapon', 'bullet03', 1], [0, 'weapon', 'bullet05', 1], [1, 'weapon', 'bullet02', 2]],
  cylont2merit:       [[0, 'weapon', 'bullet06', 1], [2, 'weapon', 'bullet01', 1], [6, 'weapon', 'bullet05', 1], [1, 'weapon', 'bullet02', 1], [5, 'weapon', 'bullet03', 1], [4, 'weapon', 'bullet04', 1], [3, 'weapon', 'bullet07', 2]],
  cylont3merit:       [[11, 'weapon', 'bullet03', 1], [1, 'weapon', 'bullet09', 1], [0, 'weapon', 'bullet02', 1], [2, 'weapon', 'bullet08', 1], [3, 'weapon', 'bullet01', 1], [12, 'weapon', 'bullet07', 1], [4, 'weapon', 'bullet04', 1], [5, 'weapon', 'bullet06', 1], [15, 'weapon', 'bullet05', 2]],
  cylont4carrier:     [[0, 'weapon', 'bullet13_defensive', 1], [1, 'weapon', 'bullet14_defensive', 1], [2, 'launcher', 'bullet12_launcher', 1], [3, 'weapon', 'bullet01_cannon', 1], [4, 'weapon', 'bullet02_cannon', 1], [5, 'weapon', 'bullet03_cannon', 1], [6, 'weapon', 'bullet04_cannon', 1], [7, 'weapon', 'bullet05_cannon', 1], [8, 'weapon', 'bullet06_cannon', 1], [9, 'weapon', 'bullet07_defensive', 1], [20, 'weapon', 'bullet09_defensive', 2], [21, 'weapon', 'bullet11_launcher', 2]],
  /* The Basestar mirrors the Pegasus mount for mount - same twelve points, same two height bands,
   * same centre pair - so it takes the same 6/4/2 split. This one IS inferred: the wiki's Basestar
   * armament section is a stub ("==Basestar== (tbc)", Weapons.txt:2078), so unlike the Pegasus
   * there is no attested loadout to check it against. The geometry is identical though, and a
   * Cylon capital with a different weapon count to its Colonial counterpart would be the surprise. */
  basestar:           [[0, 'gun', 'bullet01', 1], [1, 'gun', 'bullet02', 1], [2, 'gun', 'bullet03', 1], [3, 'launcher', 'bullet04', 1], [4, 'launcher', 'bullet05', 1], [5, 'launcher', 'bullet06', 1], [6, 'launcher', 'bullet07', 1], [7, 'gun', 'bullet08', 1], [8, 'gun', 'bullet09', 1], [9, 'gun', 'bullet10', 1], [10, 'defensive_weapon', 'bullet11', 1], [11, 'defensive_weapon', 'bullet12', 1]],
  // Guardian Basestar - the Galactica's matched pair. See the flagship block above her row.
  /* Eight of the twelve real mounts, matching the Galactica's 4/2/2 for parity. The keepers are
   * classed by the turret models parked on them in the prefab's own 'Missiles Backup' container:
   * guns on 02/03/08/09, point defence on 11/12, and 01/04 carry the launcher pair. The cuts are
   * 05/06 (the other two launcher mounts) and 07/10 - the pair the artists left unmodelled, which
   * makes them the natural first cut. */
  cylont4wing_guardian: [[0, 'launcher', 'bullet01', 1], [1, 'launcher', 'bullet04', 1], [2, 'gun', 'bullet02', 1], [3, 'gun', 'bullet03', 1], [4, 'gun', 'bullet08', 1], [5, 'gun', 'bullet09', 1], [6, 'defensive_weapon', 'bullet11', 1], [7, 'defensive_weapon', 'bullet12', 1], [12, 'ship_paint', 'undefined', 1]],
};
/* LevelRequirement. The Requisition button is not rendered AT ALL when the player's level is
 * below this, so 5/10 made four of six hulls unbuyable for a fresh character. The curve is
 * floor(sqrt(exp/1000)+1), so level 5 is 16000 XP and level 10 is 81000 - far beyond a new
 * player. Keep the progression shallow until XP actually flows. */
const TIER_LEVEL = [1, 2, 3];

/* Loca keys for the two EventShop ship paints (guids 226/227). Both verified present in the
 * decompressed locale.lang_en with .Name, .Description and .ShortDescription. */
const PAINT_LOCA = {
  226: 'item_slot_strike_system_paint_human_viper_mk3_bday2016',   // "Artemis's Twilight"
  227: 'item_slot_strike_system_paint_cylon_war_raider_mk2_bday2016', // "Eileithyia's Twilight"
};

/* SLOTS COME FROM THE LIVE-SERVER DUMP, not from HULL_SLOTS.
 *
 * The hand-built HULL_SLOTS table was wrong in four ways at once, and the visible symptom of the
 * first was weapons pointing the wrong way:
 *   - the slot id -> hardpoint mapping was invented. Our Viper put slot 0 on bullet03; the real one
 *     puts it on bullet01. Every hardpoint carries its own rotation quaternion (see HARDPOINTS), so
 *     a weapon in the wrong slot renders at the wrong position AND the wrong angle.
 *   - the 'launcher' slot type was on all 30 hulls. It exists on exactly FOUR prefabs in the whole
 *     dump - the two stealth hulls and the two carriers - and on none of ours.
 *   - hull / computer / engine / ship_paint / avionics slots were missing entirely, so no module
 *     could be fitted to any ship in the game.
 *   - level-2 slot ids were guessed.
 * HULL_SLOTS is kept below only as the fallback for hulls the dump does not cover; the dump has 32
 * prefabs against our 28, so in practice it is unused. */
function slotCards(prefab) {
  const real = HULLS_REAL[prefab];
  if (real) {
    return real.slots.map(([id, type, point, hash, lvl]) => ({
      SlotId: id,
      ObjectPoint: point,                     // dead at runtime; the client joins by the hash
      ObjectPointServerHash: hash,
      SystemType: type,
      Level: lvl,
    }));
  }
  /* A module bay (hull/computer/engine/avionics/ship_paint/role) does not render on the ship, so it
   * has no transform to attach to and no spot on the World card - the validator's slot->spot rule
   * exempts those types for exactly that reason. Every such bay in the dump carries the sentinel
   * point "undefined" with hash 44673, the hash of that literal string, and hulls-real.js reproduces
   * it on all 26 flyable hulls. It is folded into the lookup rather than special-cased at the call
   * site so that a module bay and a turret still read the same way here, and so that HARDPOINTS
   * stays purely the set of REAL transforms - spots() emits every entry it holds, and a sentinel in
   * there would become a phantom spot on the World card. */
  const hp = Object.assign({ undefined: { hash: 44673 } }, HARDPOINTS[prefab]);
  return HULL_SLOTS[prefab].map(([id, type, point, lvl]) => ({
    SlotId: id,
    ObjectPoint: point,                       // dead at runtime; the client joins by the hash
    ObjectPointServerHash: hp[point].hash,
    SystemType: type,
    Level: lvl,
  }));
}
/* Station slot table. A station has no paperdoll layout, so unlike a hull there is no recovered
 * ordering to honour: SlotId N simply takes the Nth mount in HARDPOINTS insertion order, i.e.
 * bulletNN+1. SystemType is 'weapon' on every one - that is what every NPC weapon in the live dump
 * is. SlotId is load-bearing three ways: it becomes the ShipSystem serverID (ShipSlot.java:57-60),
 * the ShipSlots map key (ShipSlots.java:21-24) and the abilityID in the AbilityCastRequest
 * (NpcStaticTimer.java:90) - and it must match slotID in the ShipConfigTemplate or
 * SpaceObjectFactory.java:670-677 silently skips the mount. */
function stationSlots(prefab, count) {
  return Object.keys(HARDPOINTS[prefab]).slice(0, count).map((name, i) => ({
    SlotId: i,
    ObjectPoint: name,
    ObjectPointServerHash: HARDPOINTS[prefab][name].hash,
    SystemType: 'weapon',
    Level: 1,
  }));
}
function spots(prefab) {
  return Object.entries(HARDPOINTS[prefab]).map(([name, h]) => ({
    objectPointServerHash: h.hash,
    objectPointName: name,
    type: h.type || 'Weapon',
    localPosition: h.pos,
    localRotation: h.rot,
  }));
}

/* One flat entry -> the full card set for one hull. Every buyable hull and every NPC-only hull
 * goes through here; the only differences are HangarID, LevelRequirement, price and stats, all of
 * which live in the table.
 *
 * The seven views are not optional. Player.setupBasicHangar() constructs a HangarShip from the
 * starter guid and throws IllegalArgumentException (-> disconnect) if the Price, Ship, World or
 * Owner card is missing; the client's own HangarShip ctor dependency list additionally requires
 * GUI + Camera; and the hangar/shop resolve a Price card for EVERY ship guid, logging
 * "Card should not be send because it's null! <guid> 23" without one.
 */
/* System-map atlas frames, read off the 32 ship World cards in the live dump. Keyed by faction
 * and tier; both FrameIndex and SecondaryFrameIndex carry the same value on every one.
 * NOTE: 0 is a LEGITIMATE frame here (Colonial tier 1), not a "nobody chose" marker - an earlier
 * research pass claimed the opposite and would have had us hide every Colonial fighter. */
const MAP_FRAME = {
  Colonial: { 1: 0, 2: 3, 3: 6, 4: 31 },
  Cylon:    { 1: 1, 2: 4, 3: 7, 4: 32 },
};

/* Repair pool, per PREFAB, read off the 26 matched Level-1 Ship cards in the live dump. One
 * titanium per point (HangarShip.java:210 / DurabilityCostCalculator).
 *
 * It is NOT a function of tier, which is what my old { 1: 400, ... } table assumed: within tier 1
 * alone the real range is 4500 for a fighter to 11000 for a defender. Mine was also 4-11x too
 * small throughout, so repairs were nearly free.
 *
 * Keyed by PREFAB deliberately. A table keyed [roleDep][tier] cannot work: HULLS contains the
 * Pegasus and Basestar with roleDep 'Mothership', for which no such row exists, and the lookup
 * would return undefined and emit a card with no durability. */
const DURABILITY = {
  humant1fighter: 4500,   humant2fighter: 14000,  humant3fighter: 66000,
  humant1command: 5000,   humant2command: 30000,  humant3command: 35000,
  humant1defender: 11000, humant2defender: 16000, humant3defender: 37000,
  humant1merit: 9000,     humant2merit: 30000,    humant3merit: 70000,
  humant4carrier: 100000,
  cylont1fighter: 4500,   cylont2fighter: 14000,  cylont3fighter: 66000,
  cylont1command: 5000,   cylont2command: 30000,  cylont3command: 35000,
  cylont1defender: 11000, cylont2defender: 16000, cylont3defender: 37000,
  cylont1merit: 9000,     cylont2merit: 30000,    cylont3merit: 70000,
  cylont4carrier: 100000,
  /* Absent from the dump, but the Pegasus infobox gives Durability = 500,000 outright, and the
   * dumped tier-4 carrier figure above (100,000) matches its own page exactly - so the infobox is
   * a checked source for this field, not a guess. 12,000 was the old placeholder: a repair pool
   * eight times SMALLER than the Brimir it outclasses. */
  humant4pegasus: 500000, basestar: 500000,
  /* The two flagships, scaled off that same infobox figure by the one ratio that separates them
   * from the Pegasus: 100,000 hull against 80,000, so 625,000 against 500,000. IDENTICAL on both
   * prefabs, and it has to stay that way - this table is keyed by prefab, which is the one place
   * the Galactica and the Guardian can drift apart without touching FLAGSHIP_FLIGHT. Falling
   * through to the 12,000 default would be worse than wrong: a repair pool eight times smaller
   * than the Brimir these outclass. */
  galactica: 625000, cylont4wing_guardian: 625000,
};

/* SENSOR RADII, LIFTED FROM THE LIVE-SERVER DUMP. Not derived, not guessed - read off 26 of our
 * 28 prefabs in research/dumps/dump_ships.json and found to be a clean tier x role table that is
 * IDENTICAL for both factions (which is itself corroboration: Colonial and Cylon hulls are
 * documented mirrors).
 *   Inner  depends on TIER only:  1000 / 1250 / 1500 / 2000
 *   Visual and Outer depend on ROLE and tier - Command hulls see furthest, which is what makes
 *          them the scout/support class.
 * The two prefabs absent from the dump are the Pegasus and the Basestar; they take the tier-4
 * carrier row, being the only other tier-4 capitals we ship.
 * See the flightStats comment for why the old flat 1500/8000/9000 was a performance problem. */
const DETECTION = {
  //            [visual, inner, outer]
  Fighter:  { 1: [200, 1000, 2000], 2: [250, 1250, 2500], 3: [300, 1500, 3000], 4: [1750, 2000, 4500] },
  Command:  { 1: [500, 1000, 3000], 2: [750, 1250, 3500], 3: [1000, 1500, 4000], 4: [1750, 2000, 4500] },
  Defender: { 1: [250, 1000, 2500], 2: [300, 1250, 3000], 3: [350, 1500, 3500], 4: [1750, 2000, 4500] },
  Multi:    { 1: [200, 1000, 2000], 2: [300, 1250, 3000], 3: [350, 1500, 3500], 4: [1750, 2000, 4500] },
  Carrier:    { 4: [1750, 2000, 4500] },
  Mothership: { 4: [1750, 2000, 5000] },   // the dump's two carrier rows differ only in Outer
};

/** Sensor radii for a hull, falling back to its tier's Fighter row for anything unmapped. */
function detection(roleDep, tier) {
  const row = (DETECTION[roleDep] && DETECTION[roleDep][tier])
           || (DETECTION.Fighter[tier])
           || DETECTION.Fighter[1];
  return { DetectionVisualRadius: row[0], DetectionInnerRadius: row[1], DetectionOuterRadius: row[2] };
}

/* An Advanced hull flies the same real stat block, scaled. Derived, not recovered: the dump's
 * own Advanced cards carry obfuscated stats and the wiki covers only part of the roster, so the
 * honest thing is one visible rule - +18% hull, +15% power, +5% speed - applied in one place. */
function advScale(st, adv) {
  if (!adv) return st;
  const out = Object.assign({}, st);
  if (out.MaxHullPoints) out.MaxHullPoints = Math.round(out.MaxHullPoints * 1.18);
  if (out.MaxPowerPoints) out.MaxPowerPoints = Math.round(out.MaxPowerPoints * 1.15);
  if (out.Speed) out.Speed = +(out.Speed * 1.05).toFixed(2);
  if (out.BoostSpeed) out.BoostSpeed = +(out.BoostSpeed * 1.05).toFixed(2);
  return out;
}

function shipCards(hull) {
  const guid = hull.g;
  /* SHIP ADVANCEMENT. Every buyable hull has an Advanced form, exactly as the original did:
   * a second Ship card at guid+ADVANCED_OFFSET with Level 2, which is what unlocks the hull's
   * level-2 slots (HangarShip instantiates a slot only when shipCard.Level >= slot.Level, and
   * the real layouts carry a full level-2 slot set that was unreachable while every hull was
   * pinned at MaxLevel 1). PlayerProtocol.UpgradeShip does the rest - it charges UpgradePrice,
   * carries the fitted systems across and swaps the hangar entry - and needed only the cards.
   *
   * Stat gain is +18% hull, +15% power, +5% speed, applied here rather than dumped: the dump
   * holds the Advanced cards but with obfuscated stats, and the wiki's Advanced pages cover
   * only part of the roster. Slots are the real prize and those ARE real.
   * The Advanced card is deliberately NOT in any ShipList: addShip refuses Level > 1 silently,
   * and the validator enforces it. */
  const adv = hull.advanced;
  const a = hull.agility;
  /* The per-ship portrait. GUI/Slots/<prefab> - what this used to be - does not exist: that
   * folder holds exactly 11 chrome textures (bar_blue, dockbutton_*, player_slot_ver2, ...) and
   * no ship art at all, so Resources.Load returned null silently and every ship fell through to
   * the items_atlas fallback at GUICard.cs:147.
   * GUI/InfoJournal/Ships/<Faction><HangarID> is the real thing - it is the same family ShipQueue
   * loads for the shop rail (ShipQueue.cs:131-148), and all eight of ours are verified present in
   * resources.assets. NPC-only hulls sit on HangarID 12, which has no art in any faction, so they
   * borrow the faction's tier-1 portrait rather than resolving to null. */
  const portrait = 'GUI/InfoJournal/Ships/' + (hull.faction === 'Colonial' ? 'Human' : 'Cylon')
                 + (hull.npcOnly ? 1 : hull.hangar);
  return [
    card(guid, 'Ship', {
      // MaxLevel 1, not 5, because ship upgrading is not wired up server-side. Note the effect:
      // IsUpgraded is `Level == MaxLevel` (ShipCard.cs:76), so at 1/1 it is permanently TRUE -
      // owned hulls hide the upgrade cost panel and button, and render their _upgraded icon from
      // the moment of purchase. That is the intended outcome here, not a bug.
      // Level MUST stay 1: PlayerProtocol.addShip refuses any card with Level > 1 and returns
      // SILENTLY, which is a hull that can never be bought with no error on either side.
      // nextShipCardGuid is 0 because NextCard means "level 2 of this hull", not "next tier".
      // Durability is the REPAIR POOL, distinct from the MaxHullPoints stat - one titanium per
      // point, kept at ~3% of the hull's price for a repair from zero.
      // Tier is a HULL-CLASS LOCK, not a quality grade: the equip check demands the system's tier
      // equal the ACTIVE SHIP's tier exactly, so this is what decides which weapons are even
      // visible to a player flying this hull.
      // ShipObjectKey is the hull's IDENTITY, not its card guid. CounterCardDistributor.java:93-115
      // hardcodes five of these (107780547 -> vipers_killed, 116493059 -> raptors_killed,
      // 107966800 -> rhinos_killed, 163729272 -> viper_mk7_killed, 163729268 -> viper_mk3s_killed),
      // so setting it to the card guid made those five counters permanently unreachable. NPC_HULLS
      // inherits objKey through Object.assign, which is what makes them actually increment.
      ShipObjectKey: hull.objKey || guid, Level: adv ? 2 : 1, MaxLevel: 2, LevelRequirement: hull.lvl,
      HangarID: hull.hangar, Durability: DURABILITY[hull.prefab] || 12000, Tier: hull.tier,
      // DUMPED: [] on all 24 strike hulls, ['Carrier'] on the two carriers. Our
      // Interceptor/Assault/Gunship/Fighter values were invented. ShipRoles is read only by
      // MeetsShipRestrictions (against ShipRoleRestrictions, always [] in our emit) and by
      // ZonesBrowserZoneInfoUi RolesBlackList - so emitting the wrong thing was inert, but
      // emitting the right thing costs nothing. ShipRoleDeprecated still drives the hangar grid.
      ShipRoles: hull.roleDep === 'Carrier' ? ['Carrier'] : [], ShipRoleDeprecated: hull.roleDep,
      PaperdollUiLayoutfile: hull.paperdoll,
      Slots: slotCards(hull.prefab), CubitOnlyRepair: false,
      /* The VARIANT mechanism, and the only way a rented flagship is reachable in the UI.
       * The hangar grid is a fixed 3x5 of (tier 1-3) x (roleDep 1-5) plus two hardcoded cells
       * (HangarWindow.cs:96-110 substitutes HangarID 16 and 15), so a tier-4 Mothership has no
       * cell of its own and can never be drawn as a top-level icon. A card carrying a
       * ParentHangarID is instead MOVED OUT of ShipListCard.ShipCards into VariantShipCards
       * (ShipListCard.MoveVariants) and rendered as a small button on its parent's icon - which
       * also keeps it out of the ship shop's queue, where an unknown HangarID would index
       * ships[-1]. Variant buttons and the variant picker are text-and-fixed-texture only, so a
       * variant needs no GUI/InfoJournal/Ships/<Faction><HangarID> art of its own.
       * Anything with neither stays empty: HangarWindow.GetShipIcon walks all 15 cells
       * unguarded, and AnyVariantsOwned(icon.Card) is what gates the deref. */
      VariantHangarIDs: hull.variants || [], ParentHangarID: hull.parentHangar ?? -1,
      /* FLIGHT STATS COME FROM THE DUMP WHERE WE HAVE THEM.
       * The flightStats() call below is a formula keyed on role and tier, so every tier-1 fighter
       * flew identically - and it was wrong in both directions at once. A Viper Mk II really tops
       * out at 55 m/s and accelerates at 13.5; we shipped 115 and 69. It also rolls at 182 with 748
       * acceleration where we shipped 126 and 253. Fast forward and slow roll is the opposite of
       * how the real thing handles, and a ship that reaches top speed in a fifth of a second is
       * what made the physics feel wrong.
       * Strafe is 0 on every strike hull in the dump, against the 35*a we invented. Safe: the sim
       * only ever MULTIPLIES by the strafe stats (MovementSimulation.java:203-208), never divides,
       * and Strafe is not in FLIGHT_REQUIRED.
       * Order matters - real stats go LAST so they beat both the formula and the dumped radii,
       * which they also supersede where they overlap. */
      Stats: stats(Object.assign({
        MaxHullPoints: hull.hp, MaxPowerPoints: hull.pwr,
        PowerRecovery: 5,
      }, flightStats({ speed: hull.speed, boost: hull.speed * 1.5, accel: 60 * a,
                       pitch: 55 * a, yaw: 55 * a, roll: 110 * a, strafe: 35 * a }),
        // Dumped radii before the flight block, so a real flight stat still wins on any overlap.
        detection(hull.roleDep, hull.tier),
        advScale((HULLS_REAL[hull.prefab] || {}).stats || {}, adv),
        // Per-hull override for the two capitals, which the dump does not cover - see CAPITAL_FLIGHT.
        advScale(hull.realStats || {}, adv))),
      Faction: hull.faction, ImmutableSlots: [],
      nextShipCardGuid: adv || hull.npcOnly || hull.rentalOnly ? 0 : guid + ADVANCED_OFFSET,
    }),

    card(guid, 'World', {
      // radius feeds PlayerShip.shipBounds and the loot-scatter spread. A flat 20 was right for
      // nothing once the roster stopped being tier-1 only: these models are NOT a common scale
      // and the client never rescales them, so a Viper really is ~10 units and a Pegasus ~1170.
      prefabName: hull.prefab, lodCount: 0, radius: hull.extent,
      spots: spots(hull.prefab),
      /* DUMPED. All 96 World cards in the live dump carry this atlas path. Ours was '', and
       * GUISystemMap.cs:696 / DradisHud.cs:163 both do
       * atlasCache.GetCachedEntryBy(WorldCard.SystemMapTexture, frame) - an empty name is a
       * missing icon for every ship on the system map AND the DRADIS. Silent, of course. */
      systemMapTexutres: 'GUI/Map/map_objects',
      /* DUMPED, faction x tier: Colonial 0/3/6/31, Cylon 1/4/7/32. Both frame fields carry the
       * same value on all 32 dumped ship World cards. FrameIndex is an sbyte client-side
       * (WorldCard.cs:13), so 31 and 32 fit. */
      frameIndex: MAP_FRAME[hull.faction][hull.tier],
      secondaryFrameIndex: MAP_FRAME[hull.faction][hull.tier],
      targetable: true, showBracketWhenInRange: true, forceShowOnMap: false,
    }),

    // level drives the loca suffix: bgo.<key>.Name_<level> then bgo.<key>.Name. Player hulls
    // stay at 1 - their ship_* keys only ship the _1/_2 forms. NPC hulls carry locaLevel to pick
    // the rung of their enemy_* rank ladder (see NPC_HULLS / NPC_HEAVIES).
    card(guid, 'GUI', {
      key: hull.loca, level: hull.locaLevel || 1,
      guiAtlasTexturePath: 'GUI/Inventory/items_atlas', frameIndex: 0,
      // Without guiAvatarSlotTexturePath the target bracket falls back to the ATLAS and crams the
      // whole 400x946 sheet into a 40x36 box; GUISlotPartyMember.cs:173 reads this field directly
      // and renders blank without it.
      guiIcon: '', guiAvatarSlotTexturePath: portrait,
      guiTexturePath: '', args: [],
    }),

    card(guid, 'Price', {
      Category: 'Ship', ItemType: 'Ship', Tier: hull.tier, Faction: hull.faction,
      SortingNames: [], SortingWeight: hull.hangar,
      // NOT empty. An empty BuyPrice makes the shop SKIP this ship, which shrinks the ship-shop
      // queue array by one while the other hulls still index by their fixed order position - so
      // the last one lands past the end and throws every frame. It also has to be non-empty
      // because the real ship-purchase path reads this same price, and empty means free.
      BuyPrice: price(hull.rentalOnly ? {} : hull.tokens ? { [TOKEN]: hull.tokens } : hull.cubits ? { [CUB]: hull.cubits } : { [TYLIUM]: hull.tyl }),
      // Empty: MaxLevel 1 + nextShipCardGuid 0 means the upgrade path does not exist and the
      // button is hidden anyway.
      UpgradePrice: price(adv || hull.npcOnly || hull.rentalOnly ? {} : { [TYLIUM]: Math.round((hull.tyl || 25000) * 0.75) }),
      SellPrice: price({}),
      // Hulls are NOT sellable. ScrapShip is a logged no-op (PlayerProtocol.java:539-543) and
      // RemoveShip has no case in parseMessage at all, so a sale can only ever fire by accident -
      // and ContainerVisitor.sellItem pays out on CanBeSold alone, with no second gate.
      CanBeSold: false,
    }),

    // ownerLevel is the boss override (NPC_HEAVIES): the client renders OwnerCard.Level as the
    // ship's level (Ship.cs:37) and setupWeaponConfig uses it as the ShipConfigTemplate lookup
    // key, so the two bosses carry 120 and every other hull stays at 1.
    card(guid, 'Owner', { IsDockable: false, DockRange: 0.0, Level: hull.ownerLevel || 1 }),

    card(guid, 'Movement', {
      minYawSpeed: 0.1, maxPitch: 360.0, maxRoll: 80.0,
      pitchFading: 2.0, yawFading: 2.0, rollFading: 400.0,
    }),

    // NOTE: wire order is default, MAX, MIN, soft, hard - not min/max as the names suggest.
    card(guid, 'Camera', {
      // MinZoom/MaxZoom OVERWRITE the camera's whole zoom range (the client defaults to 5..100).
      // 10..20 confined the camera to 10-20 units from a hull of radius 20, i.e. parked inside the
      // model looking down - the ship was barely visible. DefaultZoom is NOT read when the card is
      // applied; only Min and Max matter.
      // These MUST scale with the hull. The ratios are the ones already confirmed good on the
      // Viper (extent 10 -> 15/30/120), applied to every hull's own extent; a fixed 120 max would
      // put the camera 850 units INSIDE a Pegasus. Max is capped at 4000 so the far plane still
      // has something to draw.
      DefaultZoom: hull.extent * 3.0,
      MinZoom: hull.extent * 1.5,
      MaxZoom: Math.min(4000, hull.extent * 12),
      SoftTrembleSpeed: 1.0, HardTrembleSpeed: 1.0,
    }),

    card(guid, 'ShipLight', {
      ShipObjectKey: guid, Tier: hull.tier,
      // DUMPED: [] on all 24 strike hulls, ['Carrier'] on the two carriers. Our
      // Interceptor/Assault/Gunship/Fighter values were invented. ShipRoles is read only by
      // MeetsShipRestrictions (against ShipRoleRestrictions, always [] in our emit) and by
      // ZonesBrowserZoneInfoUi RolesBlackList - so emitting the wrong thing was inert, but
      // emitting the right thing costs nothing. ShipRoleDeprecated still drives the hangar grid.
      ShipRoles: hull.roleDep === 'Carrier' ? ['Carrier'] : [], ShipRoleDeprecated: hull.roleDep,
    }),
  ];
}

/* ================================================================ HULL IDENTITY CARDS
 *
 * A card set at guid == ShipObjectKey, one per hull family. Nothing owns one, nothing spawns one,
 * nothing buys one. They exist so that ShipObjectKeyRestrictions can be non-empty.
 *
 * The two ends of a restriction entry read the same number differently. The SERVER compares it
 * against the active hull's ShipObjectKey (ShipSystemCard.isObjectKeyRestrictionsBlocked, called
 * from ContainerVisitor.java:134-135). The CLIENT treats it as a card guid: ShipSystemCard.cs:100
 * does FetchCard(entry, CardView.Ship) and :102 IsLoaded.Depend()s on the result, so the parent
 * system card is not loaded until that Ship card arrives. There is no timeout anywhere and
 * Catalogue.cs:17-31 has already cached an empty placeholder, so an entry with no card behind it
 * is a permanent loading screen, not an error. This file has shipped that once already - the
 * recorded `Card should not be send because it's null! 268081382 10`, which is guid 268081382
 * (the Banshee's objKey) and view 10 (Ship).
 *
 * Twelve of our 42 object keys already satisfy both readings, because platforms, outposts and the
 * two capitals set ShipObjectKey = their own card guid - that is why the six SENTRY-restricted
 * platform weapons have worked all along. The other 30 are the hulls a player flies, where the
 * objKey is a separate identity number shared by the base card, its Advanced twin and any NPC
 * clones of the same prefab. Those 30 get a card set here.
 *
 * SOURCE: the family's single ShipList member, i.e. the base, player-flyable, level-1 hull. That
 * choice is asserted, not assumed - the function refuses to run if a family has anything other
 * than exactly one - because up to five of our Ship cards share one objKey (107780547 and
 * 117312163 have five each) and they do NOT all describe the same thing. The NPC clones sit on
 * HangarID 12, and HangarID is what GuiAdvancedRequirementsPanel.cs:98 compares against the active
 * ship to decide whether "Required ship:" renders white or red. Copy the wrong member and the
 * requirement reads as unmet while you are sitting in the very hull it names.
 *
 * DIVERGENCES FROM THE DUMP'S OWN IDENTITY CARDS (all 33 of them are Level 0 with objKey == guid,
 * so the shape is theirs; these three fields are not):
 *   - PaperdollUiLayoutfile is BLANK. Mandatory. The paperdoll rule below runs for every Ship card
 *     with a layout and errors when the card's Level has no matching UpgradeLevel, and every
 *     shipped layout file defines only 1 and 2 - so a Level-0 card carrying its hull's layout
 *     fails the build on all 30. Blanking it is safe: ShipCard.cs:146 skips the load, and
 *     PaperdollLayoutBig is dereferenced only through Game.Me.ActiveShip, which this can never be.
 *     The dump embeds its layouts in the card and ours are loaded by filename, which is why they
 *     could afford to keep it and we cannot.
 *   - nextShipCardGuid is 0. The base card chains to its Advanced twin; following that from here
 *     would drag a second Ship card and its whole view set into every restricted item's load.
 *   - The Price card's Faction is Neutral. Everything else about the price is the dump's shape
 *     (Category Ship, empty BuyPrice), and an empty BuyPrice is enough to keep the card out of the
 *     shop (ShopProtocol.java:214 skips it). It is NOT enough to keep it out of the hangar:
 *     PlayerProtocol.addShip:1099 calls isEnoughInContainer directly, and that loops over
 *     zero price entries and returns true - the guard checkItemToBuy:698 has for exactly this
 *     ("An empty BuyPrice means NOT FOR SALE") is missing on the ship path. A crafted ShipAddShip
 *     naming one of these guids would then put a free hull in the hangar at the REAL hull's
 *     HangarID, and Hangar.addHangarShip:63 is a map put, so it would displace the ship already
 *     there. Faction Neutral closes that: PlayerProtocol.java:1080-1086 refuses any purchase whose
 *     ShopItemCard.Faction is not the player's. Nothing reads a Price card's Faction for a card
 *     that never reaches the shop, and the tooltip reads the SHIP card's Faction
 *     (GuiAdvancedRequirementsPanel.cs:93), which stays Colonial/Cylon.
 *
 * Level 0 is the dump's own value and it is load-bearing here for a second reason:
 * HangarShip.java:100 instantiates a slot only when shipCard.getLevel() >= slot.getLevel(), and
 * every slot is level 1 or 2, so even a hangar ship built from one of these has no slots at all.
 *
 * Derived from the cards already built rather than from a list, so a hull added to HULLS gets its
 * identity card with no edit here, and a hull removed takes its identity card with it. */
function hullIdentityCards(built) {
  const clone = c => JSON.parse(JSON.stringify(c));
  const at = (guid, view) => built.find(c => c.cardGUID === guid && c.cardView2 === view);
  const taken = new Set(built.map(c => c.cardGUID));
  const listed = new Set(built.filter(c => c.cardView2 === 'ShipList')
                              .flatMap(c => c.shipCardGuids || []));
  const byKey = new Map();
  built.filter(c => c.cardView2 === 'Ship').forEach(s => {
    if (!byKey.has(s.ShipObjectKey)) byKey.set(s.ShipObjectKey, []);
    byKey.get(s.ShipObjectKey).push(s);
  });

  const out = [];
  [...byKey.keys()].sort((a, b) => a - b).forEach(key => {
    const family = byKey.get(key);
    const ids = family.map(s => s.cardGUID).join('/');
    // The family already carries its own identity - platforms, outposts, cruisers, the two
    // capitals. Nothing to add.
    if (at(key, 'Ship')) return;
    // Non-Ship cards at the objKey guid mean the number is doing two jobs. Emitting on top of them
    // would collide, and skipping would leave the restriction dangling, so stop.
    if (taken.has(key))
      throw new Error(`ShipObjectKey ${key} (Ship cards ${ids}) already carries non-Ship cards at ` +
        `that guid - an identity card cannot be emitted there and a restriction naming it would ` +
        `dereference to whatever is`);

    const base = family.filter(s => listed.has(s.cardGUID));
    if (base.length !== 1)
      throw new Error(`ShipObjectKey ${key}: ${base.length} of its Ship cards (${ids}) are in a ` +
        `ShipList. The identity card copies the one player-flyable member and there is no rule ` +
        `for picking between ${base.length}`);
    const src = base[0];
    /* Tier is checked family-wide because the SERVER unlocks a restricted item for every hull
     * carrying this objKey while the store filters by the ACTIVE hull's tier - two members at
     * different tiers means the item is visible on one and invisible on the other with nothing
     * saying why. HangarID deliberately is NOT checked family-wide: the NPC clones legitimately
     * park on 12, and which card the client renders is not ambiguous anyway - FetchCard resolves
     * by guid, so it is the card built here and nothing else. G16 checks that one against src. */
    const tiers = [...new Set(family.map(s => s.Tier))];
    if (tiers.length > 1)
      throw new Error(`ShipObjectKey ${key}: Ship cards ${ids} disagree on Tier (${tiers.join(', ')}) - ` +
        `a restriction naming this key would unlock the item for all of them but the store's ` +
        `equipable filter would only show it at one tier`);

    const world = at(src.cardGUID, 'World');
    const gui = at(src.cardGUID, 'GUI');
    if (!world || !gui)
      throw new Error(`ShipObjectKey ${key}: source hull ${src.cardGUID} has no ${world ? 'GUI' : 'World'} card to copy`);

    out.push(
      /* ShipCard.Read Depends on the World card at its own guid and, through GameItemCard.Read, on
       * the GUI and Price cards there too - all four have to exist or the restricted item never
       * finishes loading. The World card is copied whole: ApplicationBootstrap.java:120-127 folds
       * World prefab names into a Set, so a duplicate prefab is inert. */
      Object.assign(clone(src), {
        cardGUID: key, Level: 0, nextShipCardGuid: 0, PaperdollUiLayoutfile: '',
      }),
      Object.assign(clone(world), { cardGUID: key }),
      // The GUI card is what names the hull in the tooltip: BsgoLocalization.GetShipName reads
      // ItemGUICard.Key and resolves bgo.<key>.Name_1, which is the form our hull keys ship.
      Object.assign(clone(gui), { cardGUID: key }),
      card(key, 'Price', {
        Category: 'Ship', ItemType: 'Ship', Tier: src.Tier, Faction: 'Neutral',
        SortingNames: [], SortingWeight: 0,
        BuyPrice: price({}), UpgradePrice: price({}), SellPrice: price({}), CanBeSold: false,
      }),
      // Not a client card dependency - Ship.cs:65-69 needs it only for a spawned object, which this
      // never is - but the Ship/ShipLight rule below holds for every Ship card and it costs nothing.
      card(key, 'ShipLight', {
        ShipObjectKey: key, Tier: src.Tier,
        ShipRoles: (src.ShipRoles || []).slice(), ShipRoleDeprecated: src.ShipRoleDeprecated,
      }),
    );
  });
  return out;
}

const shipSystem = (guid, slotType, extra) => card(guid, 'ShipSystem', Object.assign({
  Level: 1, MaxLevel: 1, nextShipSystemCardGuid: 0,
  SlotType: slotType, Tier: 1,
  ShipObjectKeyRestrictions: [], ShipRoleRestrictions: [],
  SkillHashes: [], shipAbilityCards: [],
  StaticBuffs: stats({}), MultiplyBuffs: stats({}),
  Durability: 1.0, Class: 'Standart', Views: [],
  Unique: false, ReplaceableOnly: false, UserUpgradeable: false,
  Trashable: false, Indestructible: true, MaxCountPerShip: 1,
}, extra || {}));

/* ================================================================ ROOMS + SECTORS */
// Client-only magic id: RoomDoor.IsUndock => roomGUID == 115200940. Without a door carrying
// this guid the player cannot launch to space from the hangar.
const UNDOCK_DOOR = 115200940;

/* Rooms. The two CIC guids are StaticCardGUID.CiCColonial / CiCCylon.
 *
 * The two OUTPOST rooms are not optional and are not about the outpost feature: docking OR DYING
 * in any sector other than 0 or 6 routes the player to OutpostLocation (GameProtocol.java:1204-1215),
 * and a saved Room location in such a sector does the same on login (Location.java:98-106).
 * OutpostLocation.getRoomGUID then returns StaticCardGUID.RoomOutpostColonial(151517344) or
 * RoomOutpostCylon(151517343). Without these cards the client requests a Room card that never
 * arrives and hangs on the loading screen forever - it has no timeout on card loads.
 *
 * This was latent from the start and only became reachable when the real Tannhauser was restored,
 * because sector 10 is the first non-home sector a player can actually dock or die in.
 *
 * Interior prefab: the client ships exactly four room prefabs (cic_human, cic_cylon, hangar_human,
 * hangar_cylon). An outpost is a docking station, so the hangar is the right interior.
 *
 * The npcs lists are read out of the decompressed scene bundles - see NPC_GUI for the method and
 * the full cast. The outpost rooms are NOT NPC-less as this comment used to claim: both ship a
 * character (Officer / Sharon) that we simply never listed, which is why an outpost dock left you
 * alone in a room with nothing to click and no way to reach the flagship dialog away from home. */
const ROOMS = [
  { guid: 3608851,   prefab: 'cic_human',    loca: 'room_outpost_cic',    npcs: ['Apollo', 'Adama', 'Tyrol', 'Starbuck'] },
  { guid: 259498852, prefab: 'cic_cylon',    loca: 'room_basestar_cic',   npcs: ['Leoben', 'No1', 'No6', 'Sharon'] },
  { guid: 151517344, prefab: 'hangar_human', loca: 'room_outpost_human',  npcs: ['Officer'] },
  { guid: 151517343, prefab: 'hangar_cylon', loca: 'room_outpost_cylon',  npcs: ['Sharon'] },
];

function roomCards() {
  return ROOMS.flatMap(r => [
    card(r.guid, 'Room', {
      doors: [{ Door: 'door_undock', roomGUID: UNDOCK_DOOR }],
      // The ONLY entry point to MissionDistributor. RoomLevel.SetupAreaNpcs does
      // GameObject.Find("NPCs").transform.FindChild(NPC), so each string must match a child
      // transform of the room prefab, not a loca key. A wrong name is NOT fatal - the client
      // logs "Could not create NPC: X because npcObject is null" and skips it - so that log
      // line is the runtime check. RoomProtocol's talk handler gates on the same names.
      NPCs: r.npcs.map(n => ({ NPC: n, NPCGUID: NPC_GUI[n] })),
      music: '',                       // no music *prefabs* exist in the bundles; empty is safe
    }),
    card(r.guid, 'World', {
      prefabName: r.prefab, lodCount: 1, radius: 100.0,
      spots: [], systemMapTexutres: '',
      frameIndex: 0, secondaryFrameIndex: 0,
      targetable: false, showBracketWhenInRange: false, forceShowOnMap: false,
    }),
    card(r.guid, 'GUI', {
      key: r.loca, level: 1,
      guiAtlasTexturePath: 'GUI/Inventory/items_atlas', frameIndex: 0,
      guiIcon: '', guiAvatarSlotTexturePath: '', guiTexturePath: '', args: [],
    }),
  ]);
}

// SectorTemplates ship for sector ids 0, 6 and 10. Ids 0 (Colonial) and 6 (Cylon) are the
// hardcoded start sectors. The sector card guid is ours to choose, but it MUST equal the
// GalaxyMap star's SectorGUID, and its GUI card must reuse the same guid with key "sector<N>".
/* The galaxy is defined in galaxy.js, which emit-sector-templates.js reads from the same export.
 * Neither owns the table: a star with no SectorTemplate on disk is not "a system you cannot visit"
 * but a dead server (SectorRegistry.java:52-68 builds every star inside the bean constructor), so
 * the cards and the templates have to be generated from one list. STAGE in galaxy.js is the single
 * number that grows the map; re-run emit-sector-templates.js in the same commit that changes it. */
const { SECTORS, SHARED_REGULATION } = require('./galaxy');

function sectorCards() {
  return [
    /* ONE Regulation card for the whole galaxy, rather than one per sector. SectorFactory.java:91
     * resolves it per sector from sectorCard.getRegulationCardGuid(), and any number of Sector
     * cards may name the same guid. Every field on RegulationCard is read-only on both sides of the
     * wire and no call site mutates it, so sharing is behaviourally identical to minting 58 copies.
     * If one sector ever needs a different sectorMapEnabled, give THAT sector its own guid - do not
     * re-expand the whole table. */
    card(SHARED_REGULATION, 'Regulation', {
      /* BOTH MAPS ARE FILLED IN BY applyRegulationTargeting() AFTER EVERY CARD EXISTS, and are
       * deliberately left empty here. Their keyset is the set of AbilityGroupIds actually emitted,
       * which is not knowable at this point in the file - the abilities are built later, by
       * weaponCards() and moduleCards(). Hand-listing the keys is how this card goes wrong: the
       * client indexes abilityTargetRelations with the RAW dictionary indexer
       * (ShipAbstractAbility.cs:35 and :61), so one group id that never made it into the list is a
       * KeyNotFoundException on the per-frame target check, and the server indexes
       * abilityTargetTypes by the RELATIONS keyset with no guard, so the two must agree exactly.
       * Deriving it makes both impossible by construction. Edit the policy, not the keys. */
      abilityTargetRelations: {},
      abilityTargetTypes: {},
      targetBracketMode: 'Default', sectorMapEnabled: true,
      // The client sizes this array from the RELATION count, so it must stay <= 3 long.
      effectTypeBlacklist: [],
    }),
  ].concat(SECTORS.flatMap(s => [
    card(s.sectorGuid, 'Sector', {
      // Width/Length are the FULL span, not a half-extent: SpaceLevel.cs:134 flags the player out
      // of bounds past GetSectorSize().x / 2f. Three server witnesses halve it the same way.
      width: s.extent, height: s.extent, length: s.extent,
      regulationCardGuid: s.regGuid,          // MUST be non-zero: client does Depend(null) -> NRE
      /* Per-sector look, seeded from the sector id so it is stable across rebuilds. The client
       * ships nine nebula backgrounds (bg_nebula1..9 bundles); every sector previously got
       * nebula1 in white, which is why the whole galaxy looked like one system. The tint stays
       * near-white so no nebula renders murky, and home sectors keep their faction cast. */
      ambientColor: (() => { const r = ((s.id * 2654435761) >>> 8) % 100 / 1000;
        return RGBA(0.18 + r, 0.18 + ((s.id * 40503) >>> 4) % 80 / 1000, 0.22 + ((s.id * 69069) >>> 6) % 90 / 1000); })(),
      fogColor: RGBA(0.10, 0.10, 0.15), fogDensity: 0,
      dustColor: RGBA(0.50, 0.50, 0.50), dustDensity: 0,
      // Real prefabs from assetmap.json. Invented names resolve to null, which does not hang
      // anything but renders the sector pitch black.
      nebulaDesc: {
        ...bg('nebula' + (1 + ((s.id * 2654435761) >>> 3) % 9)),
        color: RGBA(0.85 + ((s.id * 40503) >>> 5) % 15 / 100,
                    0.85 + ((s.id * 69069) >>> 7) % 15 / 100,
                    0.85 + ((s.id * 2654435761) >>> 9) % 15 / 100),
      },
      starsDesc: bg('stars'),
      starsMultDesc: bg('starsmultiply_mid'), StarsVarianceDesc: bg('starsvariances'),
      movingNebulaDescs: [],
      lightDescs: [{ name: 'sunlight', color: RGBA(1.0, 0.95, 0.9), intensity: 1.0, rotation: QUAT() }],
      sunDescs: [], globalFogDesc: { enabled: false, color: RGBA(0.1, 0.1, 0.15), density: 0.0, startDistance: 0.0 },
      cameraFxDesc: { forceDisableBloom: false },
      requiredAssets: [],
    }),
    // Catalogue.getSectorCardByID(id) finds the GUI card whose key == "sector"+id, then
    // fetches the Sector card at THAT SAME guid. The key is load-bearing, not cosmetic.
    card(s.sectorGuid, 'GUI', {
      key: 'sector' + s.id, level: 1,
      guiAtlasTexturePath: 'GUI/Inventory/items_atlas', frameIndex: 0,
      guiIcon: '', guiAvatarSlotTexturePath: '', guiTexturePath: '', args: [],
    }),
  ]));
}

/* ---------------------------------------------------------------- REGULATION TARGETING
 * Fills every Regulation card's two maps from the abilities that actually shipped.
 *
 * Values are raw bitmask ints, not enum names:
 *   relation:  Self=1  Any=2  Neutral=4  Friend=8  Enemy=16
 *   target:    Asteroid=1  Ship=2  Any=4  Missile=8  Planetoid=16  Mine=32  JTT=64  Comet=128
 * Asteroids are Faction.Neutral, so Enemy alone would NOT let you shoot rocks - a group that needs
 * to mine needs Neutral(4) in its relation AND Asteroid(1) in its target types.
 *
 * The policy is keyed on the ability's ActionType, NOT on its AbilityGroupId. Group ids are opaque
 * 32-bit hashes in the original data (3162894, 26082229, ...), so a table keyed on them is a list
 * of magic numbers that silently stops covering anything the moment a new family is imported - and
 * the failure mode of a miss is the client's per-frame KeyNotFoundException. Keyed on the action
 * type, a newly imported family is classified the day it arrives.
 *
 * A group takes the UNION of every action type in it, which is the safe direction: an over-broad
 * relation lets you aim at something harmless, while an over-narrow one silently disarms the
 * weapon. Missiles are the one restrictive arm - Ship only, Enemy only.
 */
const REGULATION_POLICY = [
  /* MISSILES MAY NOT BE AIMED AT ROCKS. A missile that CLIPS an asteroid in flight still resolves
   * (CollisionResolution.resolveMissileOther destroys both); this only stops you selecting a rock
   * and launching at it, which wastes ammunition and, on a torpedo, an entire cooldown. Missiles
   * also may not lock other missiles - guns and screens are the anti-missile weapons. */
  { types: ['FireMissle', 'FireTorpedo', 'FireHeavyMissile', 'FireLightMissile'],
    relations: [16], targets: [2] },
  /* Guns of every description. Shooting rocks is how mining works, so these keep Neutral+Asteroid.
   * Missile(8) is what lets a strike gun down an incoming warhead: the client's TargetTypeCheck
   * consults exactly this mask per ability group, and without the flag a selected missile is
   * nulled out as an ability target the moment the weapon validates (ShipAbstractAbility.cs:78-81).
   * The server accepts the cast either way - this mask is what the CLIENT enforces. */
  { types: ['FireCannon', 'FireMachineGun', 'FireShotgun', 'FireKillCannon'],
    relations: [4, 16], targets: [1, 2, 8] },
  // Mining lasers keep rocks-and-ships only; a mining beam has no business aiming at a warhead.
  { types: ['FireMining'],
    relations: [4, 16], targets: [1, 2] },
  /* Flak and point defence are not aimed - they sweep. Enemy-only and deliberately NOT Neutral: a
   * flak screen that chewed through every asteroid the ship drifted past would strip the field and
   * spam loot. Missile(8) is the entire point of these systems: the client's auto-cast AOE sweep
   * (ShipAbility.GetObjectsWithinAOE) filters through this mask, so without the flag point defence
   * NEVER sends a missile id to the server and shoots down nothing - which is exactly the state
   * the original data shipped in here. */
  { types: ['Flak', 'PointDefence'],
    relations: [16], targets: [1, 2, 8] },
  /* The missile jammer targets ONLY missiles - DeflectMissileAction rejects everything else
   * server-side (DeflectMissileAction.java:44-48), so the dump's Asteroid|Ship mask here meant
   * the jammer jammed nothing: the client never offered it a missile and the server refused
   * everything the client did offer. */
  { types: ['DeflectMissile'],
    relations: [16], targets: [8] },
  { types: ['DropFlare', 'Slide'],
    relations: [16], targets: [1, 2] },
];
// Buffs, debuffs, scans and anything not classified above. Permissive, because a utility ability
// that cannot be pointed at its own target is simply broken.
const REGULATION_DEFAULT = { relations: [4, 16], targets: [1, 2] };
/* 0..3 are seeded unconditionally. 0 is the safety net for any ability that ships with
 * AbilityGroupId 0; 1/2/3 are GROUP_CANNON / GROUP_MISSILE / GROUP_DEFENSIVE, which the
 * hand-authored capital, platform and station items use and which must survive even if every
 * ability using one of them is ever removed. */
const REGULATION_BASE_GROUPS = [0, 1, 2, 3];

function applyRegulationTargeting(cards) {
  const byGroup = new Map(REGULATION_BASE_GROUPS.map(g => [String(g), new Set()]));
  cards.filter(c => c.cardView2 === 'ShipAbility').forEach(a => {
    const k = String(a.AbilityGroupId);
    if (!byGroup.has(k)) byGroup.set(k, new Set());
    byGroup.get(k).add(a.ActionType);
  });
  const relations = {}, targets = {};
  for (const [g, actions] of byGroup) {
    const rel = new Set(), tgt = new Set();
    let matched = false;
    for (const a of actions) {
      const p = REGULATION_POLICY.find(x => x.types.includes(a));
      if (!p) continue;
      matched = true;
      p.relations.forEach(v => rel.add(v));
      p.targets.forEach(v => tgt.add(v));
    }
    // An unclassified action type, or a base group with no abilities at all, takes the default.
    if (!matched) { REGULATION_DEFAULT.relations.forEach(v => rel.add(v)); REGULATION_DEFAULT.targets.forEach(v => tgt.add(v)); }
    relations[g] = [...rel].sort((a, b) => a - b);
    targets[g] = [...tgt].sort((a, b) => a - b);
  }
  cards.filter(c => c.cardView2 === 'Regulation').forEach(c => {
    c.abilityTargetRelations = Object.assign({}, relations);
    c.abilityTargetTypes = Object.assign({}, targets);
  });
  return Object.keys(relations).length;
}

/* ================================================================ WEAPONS AND FITTABLE EQUIPMENT
 *
 * Nearly everything a player can fit comes from systems-real.js now: the original's own 219 ship
 * systems, read out of the live-server dump with their real stats, prices, durability, GUI keys and
 * ability cards. This file used to emit 117 ShipSystem cards and now emits 231. Of the old 117,
 * 105 are gone: 83 superseded at the SAME GUID by their real dump card (the 75 equipment-real.js
 * modules, the five station guns, the two starter weapons and the T2 nuke), and 22 deleted outright
 * - the eighteen 6001-6026 weapons, whose tier-2/3/4 stats were produced by multiplying a tier-1
 * template, and four "tier-1 weapons" that turned out to be mid-ladder cards of other chains
 * (4171922670 and 1798343138 are level 5; 3694197064 and 1320617532 are level 15 and cannot exist
 * under a ten-level ladder at all).
 *
 * What is still authored in this file is the set the dump has no counterpart for: the
 * Pegasus/Basestar battery (CAPITAL_WEAPONS, guids 6031-6034) and the six tiered sentry-platform
 * weapons (6041/6042 light, 6051-6054 heavy). Both blocks explain themselves below.
 *
 * Card views per active system, across TWO guids:
 *   sysGuid: ShipSystem + GUI + Price
 *   abGuid : ShipAbility + GUI
 * The system card depends on a Price card at its OWN guid, and the ability card's constructor
 * depends on a GUI card at the ABILITY guid. Miss either and the item never finishes loading, with
 * no timeout on the client. 86 of the 219 are passive modules and have no ability guid at all.
 *
 * TIER IS A HULL-CLASS LOCK, not a quality grade: the equip check demands the system's Tier equal
 * the ACTIVE SHIP's Tier exactly, the Store tab force-enables the equipable-only filter and never
 * clears it for Hold or Locker, and a ShipSystem gets no tier-0 escape (only countables do). Every
 * hull tier therefore needs its own complete item set. Faking that by scaling one tier-1 template
 * is what the deleted TIER_WEAPONS table did; the dump's own slot/tier census supplies it properly.
 *
 * Guids: an imported item keeps its dump guid. Hand-authored items use 6000+ for systems and
 * 71002000+ for abilities. Guids named by a shipped ShipConfigTemplate are PINNED - G13 fails the
 * build if a config points at a card we have stopped emitting, which is the only warning you get
 * before ShipSystem.fromGUID throws on an NPC spawn deep in a sector nobody is watching.
 */
const GROUP_CANNON = 1;    // must match a key in EVERY Regulation card
const GROUP_MISSILE = 2;
/* Defensive weapons are their OWN group, because they are not aimed. Every defensive_weapon family
 * in the live dump shares one AbilityGroupId and carries Affect: Area rather than Affect: Selected
 * - flak and point defence do not shoot at what you have targeted, they put up a bubble around the
 * ship that anything entering takes damage from. Sharing GROUP_CANNON would put them under the
 * cannon's target relations, i.e. make them need a target. The id must exist as a key in EVERY
 * Regulation card: the client indexes abilityTargetRelations RAW, so a group with no entry there is
 * a KeyNotFoundException the first time the ability validates - on the per-frame path. */
const GROUP_DEFENSIVE = 3;
const TYLIUM = 215278030;
const TOKEN = 130920111;   // command tokens - the capital-rental currency

/* ============================================ CAPITAL-SHIP WEAPONS (the Pegasus / Basestar set)
 *
 * A battlestar does not carry strike-craft weapons. It carries four families the strike hulls have
 * no slot for, and until now we had none of them - so the Pegasus's twelve mounts were filled with
 * fighter autocannons or left as a fabricated 'launcher', which is what made it look wrong.
 *
 * WHAT THE PEGASUS ACTUALLY MOUNTS - research/bsgo_wiki/Battlestar Pegasus.txt:50-52, which lists
 * the ship as pre-installed with exactly twelve level-15 systems:
 *     6 x Pegasus Cannon Battery      2 x Pegasus Point Defence Battery      4 x Pegasus Missile Battery
 * Twelve is exactly our hardpoint count, and the geometry splits 6/4/2 on its own - see HULL_SLOTS.
 *
 * STATS ARE TRANSCRIBED, NOT DERIVED. Weapons.txt:1995-2075 gives a full block for all three, so
 * none of them is scaled off a lower-tier template. Note how far they are from anything a tier
 * ladder would have produced: the cannon reloads in 4.25s for 325-410 damage at 4,100 m, and the point
 * defence in 0.5s for 8-12 at 1,600 m. A tier-4-scaled fighter autocannon is neither.
 *
 * FLAK IS THE ONE WITHOUT A WIKI BLOCK. The client carries the loca for it (bgo.system_capship_flak
 * and bgo.ability_capship_flak both resolve), and the live-server dump has three tier-4
 * defensive_weapon families - two Flak and one PointDefence - so the numbers below come from the
 * dump rather than from invention. It is not on the Pegasus's own loadout, but it shares the
 * defensive_weapon slot type with point defence, so it fits the same two centre mounts and is
 * therefore a real choice rather than dead stock.
 *
 * Firing arcs are the wiki's: 180 degrees for the cannon and missile batteries, 360 for point
 * defence. The dump's carrier equivalents are much narrower (17.5-90), but those are a different
 * ship and the Pegasus page is specific.
 *
 * FRAMES ARE THE DUMP'S OWN, PER FAMILY, and were four separate wrong tiles before. GUI/Inventory/
 * items_atlas is not an NGUI atlas with named sprites - it is a 400x946 grid read arithmetically at
 * 40x35 per cell (GuiAtlasImageBase.smallSize, AtlasCache.CalcFrameRectInTexture), so 10 columns by
 * 27 rows, frames 0-269, and an index only means whatever tile happens to sit in that cell. The
 * dump ships a whole item_slot_capital_* family, which is direct ground truth for all four:
 *     6031 cannon   43   item_slot_capital_system_gun_long_range_cc     (was 16, a MISSILE RACK -
 *                        16 is system_light_missile_launcher, shared by 64 dump cards)
 *     6032 pd       26   item_slot_capital_system_dw_point_defence      (was 17, the CAPITAL
 *                        COMPUTER tile, item_slot_capital_system_computer_repair_recharge)
 *     6033 flak     89   item_slot_capital_system_dw_aoe_flak           (was 43, i.e. the CANNON
 *                        tile above - and 6033's stats were themselves transcribed from this family)
 *     6034 launcher 209  item_slot_capital_system_launcher_long_range   (was 227, used by no dump
 *                        card at all; the tile is two loose shells and reads as ammunition)
 *
 * abFrame TRACKS frame on all four, because the dump's own ability halves do:
 * item_slot_capital_ability_{gun_long_range_cc,dw_point_defence,dw_aoe_flak,launcher_long_range}
 * are 43/26/89/209, the same values as their system cards. abFrame is NOT redundant in general -
 * 6 of the dump's 122 system/ability key pairs really do differ (the nuclear launchers, the EMP
 * mine, the anti-radiation hulls) - so the field stays rather than being folded into frame.
 * The four old abFrame values were guesses: 93, 101 and 104 are used by no dump card, and 98
 * belongs to system_medium_missile_launcher_2_mt.
 *
 * These four share their tiles with the real capital families SYSTEMS_REAL emits unrestricted at
 * tier 4 (guids 2705915343 / 90500721 / 1163767831 / 1862157617), so a tier-4 hull sees ours and
 * theirs in one shop list with one icon. That is the original's own convention - frame 92 is shared
 * by 65 dump cards - and they are the same weapon family restatted. Accepted deliberately.
 */
const CAPITAL_WEAPONS = [
  { sys: 6031, ab: 71002031, slot: 'gun', key: 'capship_cannon', action: 'FireCannon',
    launch: 'Auto', max: 6, frame: 43, abFrame: 43, tyl: 250000, dur: 50000,
    views: ['Target', 'DMGHigh', 'MaxRange', 'OptimalRange', 'Accuracy', 'CriticalOffense',
            'ArmorPiercing', 'Angle', 'Cooldown', 'BuffCost'],
    st: { Accuracy: 130, DamageLow: 325, DamageHigh: 410, CriticalOffense: 100, ArmorPiercing: 40,
          MinRange: 0, OptimalRange: 2500, MaxRange: 4100, Angle: 180,
          Cooldown: 4.25, PowerPointCost: 25 } },

  { sys: 6032, ab: 71002032, slot: 'defensive_weapon', key: 'capship_pd', action: 'PointDefence',
    launch: 'Auto', max: 2, frame: 26, abFrame: 26, tyl: 90000, dur: 50000,
    views: ['Target', 'DMGHigh', 'MaxRange', 'OptimalRange', 'Accuracy', 'CriticalOffense',
            'ArmorPiercing', 'Angle', 'Cooldown', 'BuffCost'],
    st: { Accuracy: 600, DamageLow: 8, DamageHigh: 12, CriticalOffense: 100, ArmorPiercing: 5,
          MinRange: 0, OptimalRange: 1000, MaxRange: 1600, Angle: 360,
          Cooldown: 0.5, PowerPointCost: 4 } },

  /* DUMPED, not from the wiki - the closer of the dump's two tier-4 Flak families (the 90-degree
   * one; the other is a 22.5-degree 20-30 damage variant). Flak trades point defence's twitch
   * reload for reach and punch: 1.0s for 10-28 at 1,500 m against 0.5s for 8-12 at 1,600 m. */
  { sys: 6033, ab: 71002033, slot: 'defensive_weapon', key: 'capship_flak', action: 'Flak',
    launch: 'Auto', max: 2, frame: 89, abFrame: 89, tyl: 120000, dur: 50000,
    views: ['Target', 'DMGHigh', 'MaxRange', 'OptimalRange', 'Accuracy', 'CriticalOffense',
            'ArmorPiercing', 'Angle', 'Cooldown', 'BuffCost'],
    st: { Accuracy: 400, DamageLow: 10, DamageHigh: 28, CriticalOffense: 100, ArmorPiercing: 15,
          MinRange: 0, OptimalRange: 1200, MaxRange: 1500, Angle: 90,
          Cooldown: 1.0, PowerPointCost: 7 } },

  /* The missile action copies ItemBuffAdd wholesale onto the projectile and then reads Speed,
   * MaxHullPoints and LifeTime with auto-unboxing getters - any one absent is an NPE on the first
   * shot, and the LifeTime timer re-throws every tick. Speed 100 m/s and a 30 deg/s turn rate are
   * the wiki's; LifeTime and MaxHullPoints are NOT attested anywhere and are ours:
   *   LifeTime 45 s - the shortest value that still lets a round cross its own 3,900 m range at
   *                   100 m/s (39 s) with margin, so the cap never truncates a legitimate shot.
   *   MaxHullPoints 400 - a capital round that point defence can plausibly shoot down. Invented.
   * Never add DrainLow: it branches into the torpedo AoE path, which then filters by an unset
   * radius and the missile does nothing at all. */
  { sys: 6034, ab: 71002034, slot: 'launcher', key: 'capship_launcher', action: 'FireMissle',
    launch: 'Auto', max: 4, frame: 209, abFrame: 209, tyl: 300000, dur: 50000,
    views: ['Target', 'DMGHigh', 'MaxRange', 'Angle', 'Cooldown', 'BuffCost', 'Speed'],
    st: { DamageLow: 600, DamageHigh: 600, CriticalOffense: 100, ArmorPiercing: 50,
          MinRange: 0, MaxRange: 3900, Angle: 180, Cooldown: 5.0, PowerPointCost: 40,
          Speed: 100, MaxHullPoints: 400, LifeTime: 45,
          /* ALL SIX ROTATION STATS ARE MANDATORY, and omitting the roll pair is a hard crash, not a
           * cosmetic loss. MovementSimulation.moveToDirection:60 computes
           *   rollAcceleration = RollAcceleration * (rollAngleError / maxRoll
           *                        - rollSpeed * RollFading / RollMaxSpeed)
           * which DIVIDES by RollMaxSpeed. Absent means 0, that division is Infinity/NaN, and the
           * Euler3 constructor throws "pitch is NaN" - inside SectorMovementUpdater, so it takes
           * out the whole sector's tick EVERY FRAME for as long as the missile lives. I shipped
           * this without them and it crashed sector 5 on the first shot.
           * Yaw/Pitch 30 is the wiki's "Turn Speed: 30 degrees per second". Roll is 30 to match;
           * a missile has no meaningful roll, it just may not be zero.
           * InertiaCompensation stops the round sliding sideways out of its own turn - without it
           * a missile crabs rather than tracks. */
          Acceleration: 100,
          YawAcceleration: 30, YawMaxSpeed: 30,
          PitchAcceleration: 30, PitchMaxSpeed: 30,
          RollAcceleration: 30, RollMaxSpeed: 30,
          InertiaCompensation: 60 } },
];

/* Name resolves as bgo.<Key>.NameCylon -> .Name_<Level> -> .Name, and the final lookup returns
 * its ARGUMENT on a miss - so a dead key prints "%$bgo.<key>.Name%" on screen. Description uses
 * a try-get, so a miss yields NULL, which NREs the two widgets that call .Replace() on it.
 * system_<stem> and ability_<stem> are a PAIR - both guids need a GUI card with the same stem.
 * Default frame 159 is the red "?" tile: an obvious "nobody chose a frame" marker. */
/* `extra` overrides individual fields without disturbing any of the ~90 existing call sites. Two
 * families need it: the paints, which live on their own atlas with a standalone icon texture rather
 * than on items_atlas, and any ladder, whose GUI card must carry the card's own Level - GUICard.cs
 * :38-82 looks up bgo.<key>.Name_<Level> before falling back to .Name, so a level-6 card claiming
 * level 1 would read the level-1 name if the key ever grows per-level variants. */
const gui = (guid, key, frameIndex = 159, avatar = '', extra) => card(guid, 'GUI', Object.assign({
  key, level: 1,
  guiAtlasTexturePath: 'GUI/Inventory/items_atlas', frameIndex,
  guiIcon: '', guiAvatarSlotTexturePath: avatar, guiTexturePath: '', args: [],
}, extra || {}));

/* itemType defaults to 'Weapon' so every existing call site is unchanged. The client's shop tabs
 * filter on ItemType, and the dump files equipment under its own types - Hull(17) / Engine(18) /
 * Computer(16), exact enum names as the dump price cards spell them - so the passive families
 * below pass theirs explicitly. */
const sysPrice = (guid, tier, tyl, sortName, itemType = 'Weapon') => card(guid, 'Price', {
  Category: 'System', ItemType: itemType, Tier: tier, Faction: 'Neutral',
  SortingNames: [sortName], SortingWeight: 10,
  BuyPrice: price({ [TYLIUM]: tyl }), UpgradePrice: price({}),
  SellPrice: price({ [TYLIUM]: Math.round(tyl / 4) }), CanBeSold: true,
});

// Every reference-typed field here is dereferenced when the card is written, and Gson bypasses
// the constructor, so all of them must be present even when empty.
/* affect: 'Selected' aims at your current target; 'Area' does not aim at all and applies in a
 * radius around the caster. Every defensive_weapon family in the dump uses Area - see
 * GROUP_DEFENSIVE. Defaults to Selected so every existing call site is unchanged. */
/* `extra` overrides individual fields (e.g. TargetTiers) without touching any existing caller. */
const abilityCard = (guid, group, action, launch, st, affect, extra) => card(guid, 'ShipAbility', Object.assign({
  Level: 1, Launch: launch, Affect: affect || 'Selected', AbilityGroupId: group,
  TargetTiers: ['Any'],
  ConsumableType: 0, ConsumableTier: 0,
  // NotUsing keeps the non-nuclear projectile branch and makes the ammo check a no-op.
  // Only switch to Using once ammo is buyable AND loaded in the slot.
  ConsumableOption: 'NotUsing',
  ActionType: action,
  // Must stay None - a non-zero value here reroutes the muzzle effect.
  OverwriteActionType: 'None',
  GUIBuffAtlas: '', GUIBuffIndex: 0,
  ItemBuffAdd: stats(st), ItemBuffMultiply: stats({}),
  RemoteBuffAdd: stats({}), RemoteBuffMultiply: stats({}),
  ToggleSystemAdd: stats({}), ToggleSystemMultiply: stats({}),
  OnByDefault: false, effectTypeBlacklist: [], AffectedAbilityTypes: [],
}, extra || {}));

/* The dump's Price shape, which sysPrice above cannot express: several currencies at once, the real
 * SortingNames/SortingWeight pair the store sorts rows by, a per-item Faction, and real Upgrade and
 * Sell prices. sysPrice stays exactly as it is for the hand-authored items - re-pricing those is not
 * part of importing somebody else's catalogue, and negtest case 2 anchors on its body.
 *
 * UpgradePrice is copied verbatim and is NEVER synthesised. 136 of the dump's level cards carry a
 * Cubits entry at amount 0, and ContainerVisitor.upgradeSystemByPack computes
 * min(1, packCount / (cubits / 1000)) - so an invented zero is a division by zero that hands out a
 * guaranteed free level for one tuning kit. An absent key is not the same thing and is what the
 * dump means. */
const dumpPrice = (guid, tier, p, buy, up, sell) => card(guid, 'Price', {
  Category: p.category, ItemType: p.itemType, Tier: tier, Faction: p.faction,
  SortingNames: p.sortingNames, SortingWeight: p.sortingWeight,
  BuyPrice: price(buy || {}), UpgradePrice: price(up || {}), SellPrice: price(sell || {}),
  CanBeSold: p.canBeSold,
});

/* THE THREE STATION-WEAPON ENVELOPE FIXES - carried forward from the STATION_WEAPONS block that
 * used to emit these five guids by hand. SYSTEMS_REAL now owns their card identity (all five are
 * ordinary dump level-1 weapon/T3 systems, and emitting them twice is a duplicate-(guid,view) build
 * failure), so the deliberate divergences survive as this map instead.
 *
 *   A 1957961850 Angle 90 -> 180 and C 1277437130 Angle 90 -> 360: per-mount firing cones are
 *     enforced from each hardpoint's own transform (WeaponAction.java:72-83), so at 90 degrees the
 *     batteries on a station's far flank never bear and most of its guns sit silent - the field
 *     report that prompted the fix. C is worse than A: it is a point-defence bubble, and a bubble
 *     with a cone was the one absurdity the dump shipped. The Pegasus wiki arcs (180 cannon /
 *     360 point defence) are the precedent.
 *   B 3756543070 MaxRange 2000 -> 4000, LifeTime 50 -> 55: station aggro is already 3500/4000
 *     (NpcBehaviourTemplates.java:42-45), so a sniper sitting at 2.1 km could never be answered.
 *     The dump sized the round for 4 km (LifeTime 50 x Speed 80) but ignored the acceleration ramp:
 *     from rest at 15 m/s^2 the ramp costs 80^2/(2*15) ~= 213 m, so a 50 s round dies ~3,787 m out.
 *     55 covers a full 4,000 m shot with margin. B is shared with the outpost, so this doubles the
 *     outpost's missile envelope too - intended.
 *   D 4001980506 and E 2936089294 are dump-verbatim and get nothing.
 *
 * APPLIED AS A FLOOR, not an assignment. gen-systems-real.js applies the same map the same way down
 * the whole ladder, and there it matters: assigning LifeTime 55 at every level would SHORTEN B's
 * level-10 round from the dump's 62.5 s, i.e. make the upgrade worse. Math.max lands exactly on the
 * three values at level 1 and gets out of the way from level 3 up. It is applied here as well so
 * that the fixes hold even if a future regeneration of the module drops them; G14 asserts all four
 * numbers on the emitted ability cards. */
const STATION_OVERRIDES = {
  1957961850: { Angle: 180 },
  3756543070: { MaxRange: 4000, LifeTime: 55 },
  1277437130: { Angle: 360 },
};

/* Emit the 219 imported systems, all ten levels of each: ShipSystem + GUI + Price at every level's
 * own guid, and for the 133 with an ability, ShipAbility + GUI at that level's ability guid. 2,190
 * system rungs and 1,330 ability rungs, every guid the dump's own.
 *
 * TEN LEVELS, NOT FIFTEEN. The original laddered to 15 and the dump carries all fifteen rungs, but
 * PlayerProtocol.java:797 rejects an upgrade request with `newLevel > 10` as a cheat, so levels
 * 11-15 are unreachable on this server no matter what the cards say. Stopping at 10 makes MaxLevel
 * agree with what the server will actually grant; shipping 15 would draw fifteen squares in the
 * upgrade counter and refuse the last five, with nothing but a server log line to say why. G5 reads
 * that cap out of PlayerProtocol rather than trusting this comment.
 *
 * The chain is what makes it a ladder: each rung's nextShipSystemCardGuid names the rung above,
 * level 10 terminates at 0, and MaxLevel is 10 on every card in the chain. Catalogue.java:119 walks
 * the whole chain at boot and RefundProcessor:55 walks it again on a sell, so a gap or a cycle is a
 * boot hang or an NPE rather than a cosmetic fault - G5 checks all of it.
 *
 * BUYPRICE ON LEVEL 1 ONLY, and the dump's own UpgradePrice and SellPrice at every rung.
 * ShopProtocol.setupShop:258 stocks Level 1 and avionics, so levels 2-9 are never listed and a
 * price on them is money quoted for something the store does not sell (G4 rejects it outright).
 * Level 10 IS listed, but only under starterParams().testingMode() - the %dev profile - and that
 * is where dropping its BuyPrice earns its keep: 75 of the 219 level-10 cards carry a dump tylium
 * price BELOW their own SellPrice, worst case 1,704,000 tylium a round trip, so stocking them at
 * the dump's price is a tylium printer on any dev server. With no BuyPrice at all the row still
 * appears but ContainerVisitor.checkItemToBuy:695-698 refuses the sale outright ("An empty BuyPrice
 * means NOT FOR SALE"), so the duplicate level-10 rows a dev sees are inert. The upgrade path is
 * unaffected: it charges UpgradePrice, not BuyPrice.
 *
 * UPGRADEPRICE IS THE DUMP'S, VERBATIM, INCLUDING ON LEVEL 10. Level 10's is dead weight - the
 * original used it to buy level 11 and PlayerProtocol:787 refuses any upgrade from a card whose
 * getNextCardGuid() is 0 - but zeroing it would be inventing data, and G5 wants a non-empty
 * UpgradePrice on every upgradeable card anyway. Nothing here synthesises a currency entry: 136 of
 * the 2,190 rungs price Cubits at exactly 0 and B1's upgradeSystemByPack guard is what makes that
 * safe (ContainerVisitor:401-409). Adding a zero the dump does not have re-arms the exploit; the
 * guard turns it into a silently dead button rather than a free level, which is worse to diagnose.
 *
 * Fields taken from the dump rather than from our house conventions, and what that changes:
 *   Indestructible  false on most of the 219, where every hand-authored item here says true. The
 *     old comment justified true with "this build ships no repair loop", which is not accurate:
 *     DamageDurabilityModifier spreads incoming damage across every fitted system, ShipSlot
 *     .isInoperable stops a system below 10% quality from working, and PlayerProtocol's RepairAll
 *     arm repairs the hull and every slot for titanium or cubits. Nothing is ever destroyed. (The
 *     per-item RepairSystem arm IS stubbed - PlayerProtocol.java:408 returns "Not implemented" -
 *     so Repair All is the only working button.) The ladder is what makes wear comfortable:
 *     Durability roughly doubles from rung 1 to rung 10, so an upgraded module survives twice the
 *     punishment. Revert by forcing Indestructible: true on the line below.
 *   MaxCountPerShip 0 on 195 of the 219, and 0 means UNLIMITED (ShopWindow.cs:1043 applies the cap
 *     only when it is > 0). The deleted MAX_PER_SHIP table capped guns per tier to stop a cap from
 *     stranding a bay; unlimited cannot strand one.
 *   AbilityGroupId is the dump's own 32-bit hash on all 133. That used to be impossible - a group
 *     with no key in the Regulation card is a KeyNotFoundException on the client's per-frame target
 *     check - but applyRegulationTargeting() now derives the keyset from the abilities that
 *     actually shipped, so the ids are safe and the ability's real targeting policy survives.
 *
 * SkillHashes stays []: the dump's are SkillCard.Hash values on a hashing scheme our Skill cards do
 * not share, so porting them would dangle 222 references. */
function realSystemCards() {
  const out = [];
  for (const r of SYSTEMS_REAL) {
    /* H1. Both staging switches live in gen-systems-real.js and are stamped into the generated
     * module as data. Check the module against its own stamp before emitting anything: if a
     * regeneration flips one and this file does not notice, the symptom is silent - either a whole
     * family of weapons that refuses to fire with nothing in the log, or a client that waits
     * forever on a Ship card behind a restriction entry. */
    if (!SYSTEMS_FLAGS.using && r.ability && r.ability.consumableOption !== 'NotUsing')
      throw new Error(`systems-real.js: FLAGS.using is false but ${r.sys}'s ability is ${r.ability.consumableOption} - regenerate the module or fix the flag`);
    if (SYSTEMS_FLAGS.using && r.ability && r.ability.consumableOption !== r.ability.dumpConsumableOption)
      throw new Error(`systems-real.js: FLAGS.using is true but ${r.sys}'s ability is ${r.ability.consumableOption} where the dump says ${r.ability.dumpConsumableOption}`);
    if (!SYSTEMS_FLAGS.restrictions && r.restrictions.length)
      throw new Error(`systems-real.js: FLAGS.restrictions is false but ${r.sys} carries ${r.restrictions.length} restriction(s) - the client fetches a Ship card at each entry and hangs on one that never arrives`);
    if (SYSTEMS_FLAGS.restrictions && String(r.restrictions) !== String(r.ourRestrictions))
      throw new Error(`systems-real.js: FLAGS.restrictions is true but ${r.sys}'s emitted list differs from ourRestrictions`);
    /* A short chain would terminate below MaxLevel, which G5 reads as a chain that dead-ends early;
     * a long one would run past the server's own newLevel > 10 cheat check. Neither is recoverable
     * downstream, so refuse the module rather than emit half a ladder. */
    if (r.levels.length !== LADDER.levels)
      throw new Error(`systems-real.js: ${r.sys} has ${r.levels.length} level(s) where LADDER.levels says ${LADDER.levels}`);

    r.levels.forEach((lv, i) => {
      const level = i + 1;
      out.push(
        shipSystem(lv.guid, r.slot, {
          Tier: r.tier,
          Level: level, MaxLevel: LADDER.maxLevel,
          // 0 on the top rung. G5 checks this against Level === MaxLevel in both directions,
          // because a chain that runs past its own MaxLevel and one that stops short are both
          // walked to death by Catalogue.java:119.
          nextShipSystemCardGuid: i + 1 < r.levels.length ? r.levels[i + 1].guid : 0,
          UserUpgradeable: LADDER.userUpgradeable,
          // THIS level's ability, not level 1's - the whole point of the ladder is that the
          // damage, range and cooldown numbers move, and they live on the ability card.
          shipAbilityCards: lv.ab ? [lv.ab.guid] : [],
          ShipObjectKeyRestrictions: r.restrictions,
          StaticBuffs: stats(lv.st || {}), MultiplyBuffs: stats(lv.mu || {}),
          Durability: lv.dur, Class: r.cls, Views: r.views,
          Unique: r.unique, ReplaceableOnly: r.replaceableOnly,
          Trashable: r.trashable, Indestructible: r.indestructible,
          MaxCountPerShip: r.maxPerShip,
        }),
        /* Every one of the 219 dump GUI cards uses items_atlas with an empty icon, avatar, texture
         * and args, so the plain helper is right and no atlas parameter is needed. The only
         * per-rung field is `level`: GUICard.cs:38-82 resolves bgo.<key>.NameCylon, then
         * .Name_<Level>, then .Name, so a rung claiming level 1 would read the level-1 name if the
         * key ever grows per-level variants. None of the 219 keys has one today, which is why the
         * ladder costs zero new loca keys. */
        gui(lv.guid, r.key, r.frame, '', { level }),
        dumpPrice(lv.guid, r.tier, r.price, level === 1 ? lv.buy : {}, lv.up, lv.sell),
      );
      if (!lv.ab) return;

      const ovr = STATION_OVERRIDES[r.sys];
      const add = ovr
        ? Object.assign({}, lv.ab.add, ...Object.entries(ovr).map(([k, v]) => ({ [k]: Math.max(Number(lv.ab.add[k]) || 0, v) })))
        : lv.ab.add;
      const a = r.ability;
      out.push(
        abilityCard(lv.ab.guid, a.abilityGroupId, a.actionType, a.launch, add, a.affect, {
          /* The ability's Level tracks its system's. Checked against the dump: of its 2,223
           * system-to-ability pairs, 2,214 agree and the nine that do not are all rungs of the
           * role/t4 Spawn Mode family, which puts its ability at the SAME guid as the system and
           * stamps Level 10 on every rung - a family we drop anyway (no Fortify arm in the
           * factory). Nothing dispatches on this byte; the client reads it and only prints it. But
           * a wrong one is a lie in every diagnostic that dumps the card. */
          Level: level,
          TargetTiers: a.targetTiers,
          ConsumableType: a.consumableType, ConsumableTier: a.consumableTier,
          /* Constant down the chain, and it has to be: the ammunition pairing key is
           * (ConsumableType, ConsumableTier), so a rung that changed either would demand a
           * different countable halfway up the ladder and go silently unable to fire. */
          ConsumableOption: a.consumableOption,
          /* One chain in the whole import carries a non-None OverwriteActionType: 2392349058, a
           * computer/t2 weapon-speed debuff whose Buff is filed as Debuff on all fifteen of the
           * dump's rungs and so on all ten of ours. Server-side the field is read once, by
           * FireCannonAction, and only compared against FireCannon, so it cannot reroute anything
           * for a Buff; on the client it picks the cast FX. Kept because it is what the card said. */
          OverwriteActionType: a.overwriteActionType,
          GUIBuffAtlas: a.guiBuffAtlas, GUIBuffIndex: a.guiBuffIndex,
          OnByDefault: a.onByDefault, effectTypeBlacklist: a.effectTypeBlacklist,
          // 45 of the 133 buff the TARGET rather than the caster. Dropping these would leave the
          // debuff and support families visibly firing and doing nothing. They vary down 43 of the
          // chains, so they are read per rung.
          RemoteBuffAdd: stats(lv.ab.radd || {}), RemoteBuffMultiply: stats(lv.ab.rmul || {}),
        }),
        gui(lv.ab.guid, a.key, a.frame, '', { level }),
      );
    });
  }
  return out;
}

/* ============================================================================ SHIP PAINTS
 *
 * Four views at one guid, which is the dump's own shape on all 94 of its paints - there is no
 * separate paint entity, a paint IS a ship_paint ShipSystem that happens to carry a ShipPaint card.
 * ShipSystem.cs:109-112 fetches it at the system's own guid and IsLoaded.Depend()s on it, so the four
 * always ship together.
 *
 * THE PER-HULL LOCK IS shipCardGuid, NOT ShipObjectKeyRestrictions. All 94 dump paints carry a
 * restriction list and we emit none, because ShipSystemCard.cs:96-102 fetches a SHIP card at every
 * restriction entry and blocks the parent card's IsLoaded on it - and our hull objKeys have no card
 * at that guid. That is the historical "Card should not be send because it's null! 268081382 10",
 * which with no client-side timeout is an infinite loading screen rather than an error. Nothing is
 * lost: ItemList.cs:129 admits a paint when the active ship's guid equals paint.shipCard.CardGUID or
 * paint.shipCard.NextCard.CardGUID, which is how one paint covers a family's base and Advanced hull
 * off a single level-1 guid, and GuiAdvancedRequirementsPanel.cs:77 skips the restriction block for
 * paints entirely.
 *
 * The GUI card is the one place the plain gui() helper is not enough: every dump paint sits on
 * GUI/AbilityToolbar/abilities_atlas at frame 129 with a real standalone GUIIcon texture, not on
 * items_atlas with an empty icon.
 *
 * Price is CanBeSold false with an empty SellPrice on all 97 - the dump's own setting, and the
 * pairing matters: an empty SellPrice with CanBeSold true destroys the item for nothing. */
/* ---- THE TWO FLAGSHIP PAINTS, hand-authored here rather than in paints-real.js.
 *
 * paints-real.js is GENERATED from the dump and the dump has no paint for any capital, so there is
 * nothing to port; these are the same shape as the four hand-authored records that file already
 * carries, and they are emitted through the same paintCards() loop.
 *
 * THE GUARDIAN'S IS A REAL SKIN, and it is the *_classic pattern exactly. A non-'default' `model`
 * replaces the whole instantiated prefab - ShipSystemPaintCard.PrefabName returns model.ToLower()
 * and Ship.cs:21 uses it in place of the World card's - and cylont4wing_guardian_rusty is a
 * complete second prefab in the same bundle with byte-identical hardpoint transforms, so nothing
 * about the ship's mounts or spots changes when it is worn.
 * paintTexture MUST be 'advanced' and not a texture name: it is ShipSkinSubstance.DEFAULT_SKIN_KEY,
 * and neither capital prefab carries a ShipSkin or ShipSkinSubstance component at all, so a real
 * texture name would log "ShipSkin - couldn't find skin" and fall back. That is why all four
 * shipped *_classic records pair 'advanced' with a real model, and this follows them.
 *
 * THE GALACTICA'S CHANGES NOTHING, deliberately. Her bundle holds no alternate model, so model is
 * 'default' - the same do-nothing filler the four generated AUTHORED paints are. It exists because
 * both flagships carry a ship_paint bay and cards.js fails the build on a paint bay no paint points
 * at; the alternative was giving one faction's flagship a bay and the other none. Priced at 6,000
 * cubits, which is gen-paints-real's own authored price for tier 3+, against 25,000 for the
 * Guardian's, which is what all four model-swapping *_classic skins cost. Different content,
 * different price - neither touches a stat.
 *
 * NOTHING VALIDATES model AGAINST THE ASSETMAP. The World-prefab rule only covers World cards, and
 * ShipSystemPaintCard.java writes the string through untouched, so a typo here is a silent
 * placeholder ship rather than a build failure. 'cylont4wing_guardian_rusty' was checked against
 * BSGOCore/client/live/assetbundles/assetmap.json by hand.
 *
 * FOR WHOEVER NEXT RUNS gen-paints-real.js: it will need two adjustments before it can regenerate,
 * because it measures its own coverage from the emitted JsonCards and knows nothing about this
 * table. (1) Its gaps assertion will list galactica and cylont4wing_guardian as uncovered families
 * - exclude the prefabs named here. (2) Its "does not chain to its Advanced twin" check fails on
 * any rentalOnly hull, whose nextShipCardGuid is 0 by design; that check exists to keep a paint
 * visible while the Advanced twin is active, and a hull with no twin has nothing to lose.
 * Neither is a build problem today - cards.js does not invoke that generator - but it fails loudly
 * rather than silently when it does run, which is the safe direction. */
const CAPITAL_PAINTS = [
  { sys: 6074, tier: 4, faction: 'Cylon', prefab: 'cylont4wing_guardian', ourShipCardGuid: 5119,
    key: 'system_paint_advanced_ship_commandtoken_basestar', paintTexture: 'advanced',
    model: 'cylont4wing_guardian_rusty',
    guiAtlas: 'GUI/AbilityToolbar/abilities_atlas', frameIndex: 129,
    guiIcon: 'GUI/EquipBuyPanel/ShipSkins/ShipskinIcon',
    sortingNames: ['standard'], price: { 264733124: 25000 } },   // cubits - the currency 67 of the dump's paints use
  { sys: 6075, tier: 4, faction: 'Colonial', prefab: 'galactica', ourShipCardGuid: 5019,
    key: 'system_paint_advanced_ship_commandtoken_pegasus', paintTexture: 'advanced',
    model: 'default',
    guiAtlas: 'GUI/AbilityToolbar/abilities_atlas', frameIndex: 129,
    guiIcon: 'GUI/EquipBuyPanel/ShipSkins/ShipskinIcon',
    sortingNames: ['standard'], price: { 264733124: 6000 } },
];

function paintCards() {
  const out = [];
  for (const p of PAINTS_REAL.concat(CAPITAL_PAINTS)) {
    out.push(
      shipSystem(p.sys, 'ship_paint', {
        Tier: p.tier,
        // Paints do not ladder - MaxLevel 1 on all 94 in the dump - so the shipSystem() defaults
        // for Level/MaxLevel/next are already right and only the divergences are spelled out.
        Durability: 1, Class: 'Standart',
        Views: ['Cooldown', 'BuffCost', 'Durability'],
        // Unique because a second copy of a skin is meaningless, and MaxCountPerShip 0 rather than
        // 1 because 0 means unlimited (ShopWindow.cs:1043 applies the cap only when it is > 0) and
        // Unique already carries the real constraint. Both are the dump's values.
        Unique: true, MaxCountPerShip: 0,
      }),
      gui(p.sys, p.key, p.frameIndex, '', { guiAtlasTexturePath: p.guiAtlas, guiIcon: p.guiIcon }),
      /* SortingWeight 9000 sinks paints below every functional module in the store list, which is
       * where the dump puts them. Faction is OUR hull's, not the dump Price card's: the two
       * disagree on 2426179296 (an Advanced Halberd skin filed under Cylon on a Colonial hull), and
       * a paint whose Price faction and hull faction disagree is hidden from Colonials by
       * ShopWindow.cs:1010-1013 and from Cylons by ItemList.cs:144 - visible to nobody. */
      dumpPrice(p.sys, p.tier, {
        category: 'System', itemType: 'ShipPaint', faction: p.faction,
        sortingNames: p.sortingNames, sortingWeight: 9000, canBeSold: false,
      }, p.price, {}, {}),
      card(p.sys, 'ShipPaint', {
        model: p.model, paintTexture: p.paintTexture, shipCardGuid: p.ourShipCardGuid,
      }),
    );
  }
  return out;
}

/* ================================================== AVIONICS AND THE C-31 ROLE MODULE
 *
 * The two hand-authored families from avionics.js. Both arrays carry identical field names, so one
 * mapper emits either; every value and the reason for it lives in that file, not here.
 *
 * BUYPRICE ON LEVEL 1 ONLY. avionics.js gives the C-31 the same merit price at every rung, which
 * is what the dump's own role ladder does - but ShopProtocol.setupShop (:258) stocks Level 1 and
 * avionics and nothing else, so a price on levels 2-9 is money quoted for an item the store never
 * lists, and G4 rejects it. Level 10 is stocked as well under starterParams().testingMode(), i.e.
 * on a %dev profile; an empty BuyPrice there means it is stocked for free, which is the same
 * dev-only hole the 219 imported ladders will have when W5 lands and is not worth inventing a
 * price to paper over. The UpgradePrice is what the player actually pays, on every rung.
 *
 * The Price card is built with dumpPrice rather than sysPrice because sysPrice hardcodes a single
 * tylium BuyPrice, an empty UpgradePrice and a tyl/4 sell, none of which the C-31's merit-and-cubit
 * ladder can express. For the six avionics modules the two produce byte-identical cards. */
function handAuthoredSystemCards() {
  const out = [];
  for (const r of [...AVIONICS_CAMS, ...C31_LEVELS]) {
    out.push(
      shipSystem(r.sys, r.slot, {
        Tier: r.tier,
        Level: r.level, MaxLevel: r.maxLevel, nextShipSystemCardGuid: r.next,
        UserUpgradeable: r.userUpgradeable,
        /* Gated on the SAME constant as the 219 imported systems - gen-systems-real.js stamps its
         * RESTRICTIONS_ENABLED into the module as FLAGS.restrictions - so the whole catalogue's
         * restrictions turn on and off together and there is one thing to revert, not two. The
         * lists themselves live in avionics.js: two object keys each, which is four hull cards,
         * because a hull and its Advanced twin share one key. */
        ShipObjectKeyRestrictions: SYSTEMS_FLAGS.restrictions ? r.ourRestrictions : [],
        StaticBuffs: stats(r.st), MultiplyBuffs: stats(r.mul),
        Durability: r.dur, Class: r.class, Views: r.views,
        Unique: r.unique, ReplaceableOnly: r.replaceableOnly,
        Trashable: r.trashable, Indestructible: r.indestructible,
        MaxCountPerShip: r.max,
      }),
      gui(r.sys, r.key, r.frame, '', { level: r.level }),
      dumpPrice(r.sys, r.tier, {
        category: 'System', itemType: r.itemType, faction: 'Neutral',
        sortingNames: [r.sort], sortingWeight: 10, canBeSold: true,
      }, r.level === 1 ? r.buy : {}, r.upgrade, r.sell),
    );
  }
  return out;
}

function weaponCards() {
  const out = [];

  /* Capital weapons first. These are authored per-weapon rather than imported: nothing about a
   * 4.25-second 325-410 damage battery comes from anywhere in the dump, and the wiki gives the
   * Pegasus's own stat block. All four are Tier 4 - ShopWindow.CheckSystemForSlot requires
   * system.Card.Tier == ActiveShip.Card.Tier exactly, so a tier-3 capital gun would be unfittable
   * on a tier-4 hull no matter what its slot type said. */
  CAPITAL_WEAPONS.forEach(w => out.push(
    shipSystem(w.sys, w.slot, {
      Tier: 4, shipAbilityCards: [w.ab],
      Durability: w.dur, Indestructible: true, Trashable: true, MaxCountPerShip: w.max,
      Views: w.views,
    }),
    gui(w.sys, 'system_' + w.key, w.frame),
    sysPrice(w.sys, 4, w.tyl, w.slot === 'launcher' ? 'missile' : 'cannon'),
    /* Group and Affect are BOTH decided by the slot type, and defensive weapons differ on both.
     * Flak and point defence carry Affect: Area - they are not aimed. They do not fire at your
     * selected target; they put a damaging bubble around the ship for as long as they are on, which
     * is what a flak screen is. Aiming them would need a target and they would go silent without
     * one. Taken from the dump, where all three defensive_weapon families agree on Area and on a
     * single shared AbilityGroupId. */
    abilityCard(w.ab,
                w.slot === 'launcher' ? GROUP_MISSILE
                  : w.slot === 'defensive_weapon' ? GROUP_DEFENSIVE : GROUP_CANNON,
                w.action, w.launch, w.st,
                w.slot === 'defensive_weapon' ? 'Area' : 'Selected'),
    gui(w.ab, 'ability_' + w.key, w.abFrame),
  ));

  /* SENTRY-PLATFORM WEAPONS - the tiered light/heavy batteries.
   *
   * This block used to open with five entries transcribed verbatim from the dump (guids
   * 1957961850, 3756543070, 1277437130, 4001980506, 2936089294 with their dump ability guids).
   * Those are dump level-1 weapon/T3 systems, so importing the catalogue meant emitting them twice
   * - a duplicate (guid,view) build failure. They now arrive from SYSTEMS_REAL like everything else
   * imported, and the three deliberate envelope fixes on them live in STATION_OVERRIDES above.
   * Nothing was lost: the outpost and medium-platform configs still name the same guids, and they
   * carry the same stats, the same GUI keys and the same 20,000 tylium price they always did.
   * They are also, correctly, five of the nineteen tier-3 player line weapons in the original.
   *
   * The six below stay hand-authored because the dump has no counterpart: the wiki's Light and
   * Heavy Sentry loadouts (Outposts.txt:37/:39) map name-for-name onto dump FAMILIES, but the
   * stats needed adjusting for an immobile station, so they take new guids from the free 6000+ /
   * 71002000+ ranges rather than dump guids, which stay reserved for verbatim transcriptions.
   * AbilityGroupId stays 1/2/3 here - these are our cards, not the original's, and the three
   * hand-authored groups are seeded in the Regulation card unconditionally.
   * GUI keys are the dump family's FULL keys, emitted with no system_/ability_ stem prefixing, and
   * the ability key is the system key with '_system_' -> '_ability_' - one rule covers all six, and
   * all 12 keys resolve .name in loca-keys.txt. System and ability share the atlas frame (dump
   * convention).
   * ShipObjectKeyRestrictions = SENTRY_HULLS on all six: for a ShipSystem the Price card merely
   * existing puts it in the shop, and an empty BuyPrice means FREE, not hidden - a 4 km capital gun
   * on a player tier-3 hull would be broken, and tier 3 is now a tier players actually reach. The
   * gate is safe on both sides: the client fetches a Ship card per entry and every entry is an
   * emitted platform Ship card whose ShipObjectKey equals its guid, and setupWeaponConfig never
   * consults restrictions when fitting NPC ships (isObjectKeyRestrictionsBlocked's only caller is
   * the player-equip path, ContainerVisitor.java:133) - so the platforms themselves still arm. */
  const STATION_VIEWS_GUN = ['DMGLow', 'DMGHigh', 'DrainHigh', 'DrainLow', 'ArmorPiercing',
    'MinRange', 'MaxRange', 'OptimalRange', 'Accuracy', 'CriticalOffense', 'Cooldown', 'BuffCost',
    'Angle', 'Durability'];
  const STATION_VIEWS_MSL = ['DMGLow', 'DMGHigh', 'ArmorPiercing', 'MinRange', 'MaxRange',
    'TurnSpeed', 'Speed', 'CriticalOffense', 'Cooldown', 'BuffCost', 'Angle', 'Durability'];
  /* The four tiered-platform hulls (PLATFORMS light/heavy below) - the shop gate for the six
   * tiered weapons. Every entry is an emitted Ship card whose ShipObjectKey EQUALS its guid
   * (platform Ship cards set ShipObjectKey = guid), which is the rule G16 enforces. */
  const SENTRY_HULLS = [1783473190, 1783473192, 1783473196, 1783473198];
  const PLATFORM_WEAPONS = [
    // LIGHT - the Light Sentry's "8 x 20 mm autocannon turrets" (Outposts.txt:37), from dump family
    // item_slot_strike_stealth_weapon_system_20mm_autocannon (gun/T1: 9-18 @ 0.4 s, 0/400/650).
    // Damage x2.2 at station cadence (0.4 -> 3.5 s); Accuracy 400 KEPT - the anti-strike identity;
    // Angle 360 (turret); MaxRange 1600 is Platforms.txt:1's attested light-platform gun range.
    { sys: 6041, ab: 71002041, key: 'item_slot_strike_stealth_weapon_system_20mm_autocannon',
      restrict: SENTRY_HULLS, frame: 173,
      action: 'FireCannon', affect: 'MultiWeaponTarget', group: GROUP_CANNON,
      sort: 'cannon', tyl: 20000, dur: 17500, views: STATION_VIEWS_GUN,
      st: { Accuracy: 400, Angle: 360, ArmorPiercing: 10, Cooldown: 3.5, CriticalOffense: 100,
            DamageLow: 20, DamageHigh: 40, MinRange: 0, OptimalRange: 800, MaxRange: 1600,
            PowerPointCost: 3 } },

    // LIGHT - the Light Sentry's "2 x Interceptor Missile Launchers" (Outposts.txt:37), from dump
    // family item_slot_strike_stealth_weapon_system_interceptor_missile (launcher/T1: 300 @ 30 s,
    // 300-1000). Damage x2; MaxRange 3500 attested (Platforms.txt:1); MinRange 200 (station floor,
    // not the dump's 300). LifeTime 30, NOT the naive 3500/150 ~= 23.3 s: the 15 m/s^2 ramp to
    // 150 m/s costs 150^2/(2*15) = 750 m, so a full 3,500 m shot needs ~28.3 s - the same physics
    // as the B override above. 30 covers it with margin.
    { sys: 6042, ab: 71002042, key: 'item_slot_strike_stealth_weapon_system_interceptor_missile',
      restrict: SENTRY_HULLS, frame: 177,
      action: 'FireMissle', affect: 'MultiWeaponTarget', group: GROUP_MISSILE,
      sort: 'missile', tyl: 20000, dur: 17500, views: STATION_VIEWS_MSL,
      st: { Angle: 180, ArmorPiercing: 15, Cooldown: 45, CriticalOffense: 100,
            DamageLow: 600, DamageHigh: 600, MinRange: 200, MaxRange: 3500, PowerPointCost: 15,
            Speed: 150, Acceleration: 15, LifeTime: 30, MaxHullPoints: 30, Avoidance: 650,
            InertiaCompensation: 100,
            YawAcceleration: 30, YawMaxSpeed: 30, PitchAcceleration: 30, PitchMaxSpeed: 30,
            RollAcceleration: 30, RollMaxSpeed: 30 } },

    // HEAVY - the Heavy Sentry's "8 x 40.6 cm cannon turrets" (Outposts.txt:39), from dump family
    // item_slot_capital_system_gun_long_range_cc (gun/T4: 75-135 @ 8 s, MinRange 2300/2750/4000).
    // Damage x1.5 (~ the family's own L12 values); MinRange 2300 -> 0 NEUTRALIZED: the hard floor
    // (WeaponAction.java:78-82) would leave a campable dead zone on an immobile station, and
    // 6031/6033 in CAPITAL_WEAPONS are the in-file precedent. Capital feel survives via
    // Accuracy 125 + OptimalRange 2750 (a close, fast strike craft is still mostly missed); the
    // close-in deterrent is the flak/PD pair's design role.
    { sys: 6051, ab: 71002051, key: 'item_slot_capital_system_gun_long_range_cc',
      restrict: SENTRY_HULLS, frame: 43,
      action: 'FireCannon', affect: 'MultiWeaponTarget', group: GROUP_CANNON,
      sort: 'cannon', tyl: 20000, dur: 17500, views: STATION_VIEWS_GUN,
      st: { Accuracy: 125, Angle: 180, ArmorPiercing: 35, Cooldown: 8.0, CriticalOffense: 100,
            DamageLow: 115, DamageHigh: 205, MinRange: 0, OptimalRange: 2750, MaxRange: 4000,
            PowerPointCost: 25 } },

    // HEAVY - the Heavy Sentry's "5 x Heavy Missile Launchers" (Outposts.txt:39), from dump family
    // item_slot_capital_system_launcher_long_range (launcher/T4: 450 @ 30 s, MinRange 2250).
    // Damage x1.5; MinRange 2250 -> 200 (same neutralization, missile floor); LifeTime 50 covers
    // 4,000 m at Speed 110 including the ~403 m acceleration ramp (needs ~40 s).
    { sys: 6052, ab: 71002052, key: 'item_slot_capital_system_launcher_long_range',
      restrict: SENTRY_HULLS, frame: 209,
      action: 'FireMissle', affect: 'MultiWeaponTarget', group: GROUP_MISSILE,
      sort: 'missile', tyl: 20000, dur: 17500, views: STATION_VIEWS_MSL,
      st: { Angle: 180, ArmorPiercing: 35, Cooldown: 30, CriticalOffense: 100,
            DamageLow: 675, DamageHigh: 675, MinRange: 200, MaxRange: 4000, PowerPointCost: 100,
            Speed: 110, Acceleration: 15, LifeTime: 50, MaxHullPoints: 200, Avoidance: 650,
            InertiaCompensation: 100,
            YawAcceleration: 30, YawMaxSpeed: 30, PitchAcceleration: 30, PitchMaxSpeed: 30,
            RollAcceleration: 30, RollMaxSpeed: 30 } },

    // HEAVY - the Heavy Sentry's "2 x 63 mm Flak Cannons" (Outposts.txt:39), from dump family
    // item_slot_capital_system_dw_aoe_flak (dw/T4: 10-28 @ 1 s, MinRange 900) - the same family
    // 6033 above already transcribes at MinRange 0. Damage x2 (the defensive pair's buff).
    // Flak + Affect Area: AbilityActionFactory implements Flak (-> FlakAction), and
    // NpcStaticTimer's Area branch (NpcStaticTimer.java:96-107) feeds it every enemy in the
    // station's list rather than one target - the kill-box that punishes divers.
    { sys: 6053, ab: 71002053, key: 'item_slot_capital_system_dw_aoe_flak',
      restrict: SENTRY_HULLS, frame: 89,
      action: 'Flak', affect: 'Area', group: GROUP_DEFENSIVE,
      sort: 'pd', tyl: 20000, dur: 17500, views: STATION_VIEWS_GUN,
      st: { Accuracy: 300, Angle: 360, ArmorPiercing: 15, Cooldown: 1.0, CriticalOffense: 100,
            DamageLow: 20, DamageHigh: 56, MinRange: 0, OptimalRange: 1200, MaxRange: 1500,
            PowerPointCost: 7 } },

    // HEAVY - the Heavy Sentry's "2 x 15 mm Point Defence turrets" (Outposts.txt:39), from dump
    // family item_slot_capital_system_dw_point_defence (dw/T4: 3-7 @ 0.5 s). Damage x2; same Area
    // path as the flak above.
    { sys: 6054, ab: 71002054, key: 'item_slot_capital_system_dw_point_defence',
      restrict: SENTRY_HULLS, frame: 26,
      action: 'PointDefence', affect: 'Area', group: GROUP_DEFENSIVE,
      sort: 'pd', tyl: 20000, dur: 17500, views: STATION_VIEWS_GUN,
      st: { Accuracy: 500, Angle: 360, ArmorPiercing: 5, Cooldown: 0.5, CriticalOffense: 100,
            DamageLow: 6, DamageHigh: 14, MinRange: 0, OptimalRange: 500, MaxRange: 1200,
            PowerPointCost: 3.5 } },
  ];
  /* Tier 3 and SlotType 'weapon', matching the five imported station guns these were modelled on.
   * ShipBindings.setSlots only emits a turret ShipModuleBinding for weapon-bearing slot types, and
   * every NPC and station weapon in the dump is SlotType 'weapon', so this sidesteps the question
   * the capital 'gun'/'defensive_weapon' types raise. Indestructible true here, unlike the imported
   * systems: these are fitted only on stations, which have no repair path of any kind. */
  PLATFORM_WEAPONS.forEach(w => out.push(
    shipSystem(w.sys, 'weapon', {
      Tier: 3, shipAbilityCards: [w.ab],
      Durability: w.dur, Class: 'Elite',
      Indestructible: true, Trashable: false, MaxCountPerShip: 0,
      ShipObjectKeyRestrictions: w.restrict,
      Views: w.views,
    }),
    gui(w.sys, w.key, w.frame),
    sysPrice(w.sys, 3, w.tyl, w.sort),
    abilityCard(w.ab, w.group, w.action, 'Auto', w.st, w.affect),
    // The system card and its ability card share an atlas frame, which is the dump's convention.
    gui(w.ab, w.key.replace('_system_', '_ability_'), w.frame),
  ));

  return out;
}

/* COMETS. A sector timer spawns these at guid 23 on its own schedule, independent of any sector
 * template. The factory demands FOUR views at once (World, Owner, Movement, NonShipStats) via a
 * wrapper that throws "Requested view is not available" if any is missing - and that propagates
 * out and DISCONNECTS whoever is in the sector when the timer fires. A player can be flying
 * happily and then get dropped for no visible reason. NonShipStats supplies the comet's HP/PP.
 * The 'comet' prefab is real and even ships with its own ColliderTemplate. */
const COMET_OBJECT = 23;

function cometCards() {
  return [
    card(COMET_OBJECT, 'World', {
      prefabName: 'comet', lodCount: 1, radius: 250.0,
      spots: [], systemMapTexutres: '', frameIndex: 0, secondaryFrameIndex: 0,
      targetable: true, showBracketWhenInRange: true, forceShowOnMap: false,
    }),
    card(COMET_OBJECT, 'Owner', { IsDockable: false, DockRange: 0.0, Level: 1 }),
    card(COMET_OBJECT, 'Movement', {
      minYawSpeed: 0.05, maxPitch: 360.0, maxRoll: 80.0,
      pitchFading: 2.0, yawFading: 2.0, rollFading: 400.0,
    }),
    // The factory reads MaxHullPoints and MaxPowerPoints off this to seed the comet's state.
    card(COMET_OBJECT, 'NonShipStats', {
      Stats: stats({ MaxHullPoints: 20000, MaxPowerPoints: 100, Speed: 30 }),
    }),
    /* avatar_comet, verified present in the client's resources.assets with the same Texture2D
     * header as avatar_asteroid_temp. A comet is targetable, so without a portrait its bracket
     * showed the whole inventory atlas crushed into the 40x36 box - the same defect the outposts
     * had. Found by the targetable-World-object validator, not by looking. */
    card(COMET_OBJECT, 'GUI', {
      key: 'comet', level: 1,
      guiAtlasTexturePath: 'GUI/Inventory/items_atlas', frameIndex: 0,
      guiIcon: '', guiAvatarSlotTexturePath: 'GUI/Slots/avatar_comet',
      guiTexturePath: '', args: [],
    }),
  ];
}

/* The missile PROJECTILES. SpaceObjectFactory.createMissile:481-492 fetches Owner, World and
 * Movement at the guid and THROWS when any of the three is missing, and that throw escapes into
 * Sector.run's per-tick catch - so one launcher firing at an unauthored projectile abandons the
 * timers, the object remover and the zone management for everyone in the sector, every shot.
 *
 * FOUR guids, not one, and which of them a shot uses is decided in FireMissileAction.getMissileGUID
 * :84-140 from the loaded ammunition, not from the weapon:
 *   MissileCard        117216909  every shot with no ammunition loaded, and every shot whose
 *                                 ammunition is not effectType DamageNuclear
 *   MissileTorpedo      29963472  DamageNuclear ammunition carrying NO DamageHigh - the three
 *                                 torpedo tokens and the escort anti-capital nuke
 *   MissileMiniNuke    244685066  DamageNuclear with DamageHigh exactly 4.0 - the x5 nukes
 *   MissileNuke        253392099  DamageNuclear with DamageHigh exactly 19.0 - the x20 nukes
 * The last three were unreachable while every ability was ConsumableOption NotUsing, because
 * getMissileGUID takes the useConsumable == false branch straight to MissileCard. They become
 * reachable in this same package, which is why they are authored here.
 *
 * The dump has no cards at any of the four guids - projectiles are server-side objects and the
 * dumping client never asked for them - so all four are ours, modelled on the one that already
 * worked. */
const MISSILE_OBJECT = 117216909;

/* The enum is the server's own source of truth for which guid each branch picks. If somebody
 * renumbers a constant, the cards stay where they are and every nuclear shot starts throwing
 * inside the sector tick - so check it here, where the failure is a build error instead. */
const MISSILE_GUID_NAMES = {
  117216909: 'MissileCard', 29963472: 'MissileTorpedo',
  244685066: 'MissileMiniNuke', 253392099: 'MissileNuke',
};

function checkMissileGuids(byName) {
  const src = fs.readFileSync(path.join(CORE_SRC, 'enums/StaticCardGUID.java'), 'utf8');
  Object.entries(byName).forEach(([name, guid]) => {
    const m = src.match(new RegExp(`^\\s*${name}\\s*\\(\\s*(\\d+)L?\\s*\\)`, 'm'));
    if (!m) throw new Error(`StaticCardGUID has no constant ${name} - FireMissileAction names it`);
    if (Number(m[1]) !== guid) throw new Error(
      `StaticCardGUID.${name} is ${m[1]} but the projectile cards are emitted at ${guid} - `
      + `createMissile would throw inside the sector tick on every shot that routes here`);
  });
}

function projectileCards(guid, key, prefabName, radius, frame, avatar, explosionView, missileType) {
  return [
    /* The client overrides this prefab from faction+tier+type, and the server builds an explicit
     * collider rather than looking one up - so prefabName only has to be a real, non-null ASCII
     * string. showBracketWhenInRange is the gate HudIndicatorInfo.HasStaticIndicator tests before
     * any of its per-type rules: false means the client never creates a HUD indicator for the
     * object, and on a 3-unit projectile that indicator is the only thing a mouse click can
     * practically land on (TargetSelector's other path is a physics ray against the model). False
     * here is what made missiles unclickable on every hull. True hands control back to the
     * client's own missile rules, which are already enemy-only - HasStaticIndicator checks
     * PlayerRelation and WasSpawnedByMe for SpaceEntityType.Missile - so your own volleys stay
     * bracket-free, and enemy warheads get the dedicated missile bracket plus a health bar. */
    card(guid, 'World', {
      prefabName, lodCount: 1, radius,
      spots: [], systemMapTexutres: '', frameIndex: 0, secondaryFrameIndex: 0,
      targetable: true, showBracketWhenInRange: true, forceShowOnMap: false,
    }),
    // These objects are targetable, so a dead key would print on the HUD bracket. All four keys
    // resolve .name in the client's locale bundle.
    gui(guid, key, frame, avatar),
    card(guid, 'Owner', { IsDockable: false, DockRange: 0.0, Level: 1 }),
    // maxRoll must not be 0 - it is a divisor in the movement sim and 0/0 puts NaN into position.
    card(guid, 'Movement', {
      minYawSpeed: 1.0, maxPitch: 360.0, maxRoll: 80.0,
      pitchFading: 2.0, yawFading: 2.0, rollFading: 400.0,
    }),
    /* The Missile card is the client's alone: the server writes it and never reads it, and it is
     * what picks the explosion effect and the in-flight model class. Both names are real constants
     * of MissileExplosionView and MissileType - a name that is not makes Gson leave the field null
     * and the writer NPEs on .value, dropping the socket of whoever is watching. */
    card(guid, 'Missile', { explosionView, missileType }),
  ];
}

function missileObjectCards() {
  const emitted = [MISSILE_OBJECT, ...NUKE_PROJECTILES.map(p => p.guid)];
  emitted.forEach(g => {
    if (!MISSILE_GUID_NAMES[g]) throw new Error(
      `projectile guid ${g} is not one of the four StaticCardGUID missile constants - `
      + `FireMissileAction can never select it, so the cards would be dead weight`);
  });
  checkMissileGuids(Object.fromEntries(emitted.map(g => [MISSILE_GUID_NAMES[g], g])));
  return [
    ...projectileCards(MISSILE_OBJECT, 'missile_normal', 'colonialsmallmissile', 3.0,
                       177, 'GUI/Slots/missile', 'Standard', 'Normal'),
    /* The three nuclear projectiles. Their flight envelope is the plain missile's on purpose: the
     * ability's own ItemBuffAdd is copied onto the spawned object (FireMissileAction:65-70), so
     * Speed, MaxHullPoints and LifeTime all come from the launcher that fired, and what the
     * projectile card contributes is the hull, the collider radius and the explosion. */
    ...NUKE_PROJECTILES.flatMap(p => projectileCards(p.guid, p.key, p.prefabName, p.radius,
                                                     p.frame, p.avatar, p.explosionView,
                                                     p.missileType)),
  ];
}

/* Turret modules. The server emits a module binding for every weapon-slot system, and the client
 * depends on each binding's Module card - so a missing one hangs the ship forever, including the
 * player's own. Guids are consecutive from the server's binding enum. */
function moduleCards() {
  const out = [];
  for (let t = 1; t <= 4; t++) {
    out.push(card(210609777 + t, 'Module', {
      ColonialPrefab: 'colonial_turret_tier' + t, CylonPrefab: 'cylon_turret_tier' + t }));
    out.push(card(249318993 + t, 'Module', {
      ColonialPrefab: 'colonial_missile_tier' + t, CylonPrefab: 'cylon_missile_tier' + t }));
  }
  return out;
}

/* ================================================================ COUNTABLES
 * Resources, ammunition, repair and power cells, flares, mines, metal plates and the booster tab -
 * everything that stacks in the Hold rather than bolting into a slot. Every one of them needs
 * THREE views at the same guid:
 *   GUI(1)            - icon + loca key
 *   ShipConsumable(3) - what ItemCountable.Read fetches; its Read chains the GUI card
 *   Price(23)         - ShopItemCard, needed by the shop and the hangar panels
 *
 * 175 of them: the 165 the original's own catalogue carries, read out of the dump into
 * consumables-real.js, plus the ten guids that are ours and appear on no dump card at any guid.
 *
 * WHAT THIS REPLACED, AND WHY IT MATTERED. The file used to emit 42, and 40 of those carried
 * ConsumableType 0, Tier 0 and effectType None - "a general consumable that fits any hull". That
 * is not a cosmetic defect. The client pairs ammunition to a weapon by matching the countable's
 * ConsumableType against the ability's (ItemList.cs:135), so with every countable at type 0 no
 * weapon could ever be loaded with anything at all. Nobody had noticed because every ability was
 * also ConsumableOption NotUsing, which makes the ammo check a no-op - the two halves hid each
 * other. Both are fixed together in this package.
 *
 * consumableAttributes is the other field that was silently wrong: it was [] on all 42, and
 * GuiConsumablePanel.cs:47-62 buckets the in-flight ammo menu into one collapsible header PER
 * ATTRIBUTE. An item with no attribute is in no bucket, i.e. invisible in the panel you load ammo
 * from. Every dump record carries at least 'standard', and all nine attribute strings resolve as
 * bgo.consumable_attribute.<attr> in the client's locale bundle.
 */
const TIT = 207047790, CUB = 264733124;

/* THE SIX CURRENCIES ARE PRICED HERE AND NOWHERE ELSE.
 * A currency's price is an exchange rate the rest of the economy is tuned against, not an item
 * price, and the original's is not ours: it sold tylium at 0.1 cubits where we sell it at 0.03125.
 * 0.1 is not a negative power of two, so the client's buy arrow - round(1/value), in
 * GUIShopConfirmWindow.GetPurchaseUnit:618-628 - would step in tens while the server charged
 * ceil(0.1*count), and the two would disagree on every click.
 *
 * buyCount belongs with the rate for the same reason: the dump ships buyCount 1 on all six, which
 * at 0.03125 cubits a unit means one click buys ONE tylium and the server charges ceil(0.03125) =
 * a whole cubit for it. A currency's click size and its price are one decision.
 *
 * consumables-real.js marks exactly these six by leaving price.buy null, and the emitter below
 * fails the build if that set and this table ever stop naming the same guids - which is what would
 * happen if a re-import decided a seventh guid was a currency, or dropped one of these six.
 *   guid: [BuyPrice, SellPrice, CanBeSold, buyCount]
 */
const CURRENCY_RATES = {
  215278030: [{ [CUB]: 0.03125 }, {}, false, 1000],          // Tylium, 32 to the cubit
  207047790: [{ [CUB]: 0.0625 }, {}, false, 1000],           // Titanium, 16 to the cubit
  130762195: [{ [TYLIUM]: 2 }, { [TYLIUM]: 1 }, true, 100],  // Water
  254909109: [{ [CUB]: 25 }, {}, false, 1],                  // Tuning kit - one per click, not 100
  /* Cubits and merits never buy themselves. An empty BuyPrice keeps them out of the shop's first
   * pass entirely, and CanBeSold false keeps the Hold from offering a Salvage button on a balance:
   * selling a countable sells the WHOLE stack, and there is no confirmation. */
  264733124: [{}, {}, false, 1],
  130920111: [{}, {}, false, 1],
};

/* THE TEN COUNTABLES THAT ARE OURS. Each of these appears on no dump card at any guid, so
 * consumables-real.js carries only their corrections (LEGACY_CONSUMABLES) and this table carries
 * their identity: loca key, atlas frame, sell economics and click size.
 *
 * 3, 5 and 9 are the three green-rounds SKUs, and they were among the untyped: Tier 0 and
 * effectType None on all three, ConsumableType 1 on guid 3 and 0 on the other two, so none of them
 * paired to any weapon. They now carry ConsumableType 43703 at tiers 1/2/3 with effectType
 * DamageKinetic, which is what turns the live player's 31x guid 9 into usable heavy rounds. They
 * keep their empty BuyPrice - they are loot, granted by AugmentTemplates/augment_template_green
 * .json, not stock.
 *
 * NONE OF THE THREE MAY BE DELETED, and an earlier plan to retire them was retracted for three
 * independent reasons: 5 and 9 are ResourceType.EscortGreen_Rounds and ResourceType
 * .LinerGreen_Rounds so checkResourceCoverage() below throws without them; augment_template_green
 * .json grants all three by guid and the validator at the foot of this file errors on a granted
 * guid with no card; and ItemCountable.fromGUID (ItemCountable.java:34-37) does no catalogue
 * lookup at all, so a retired countable is not dropped on load the way a retired system is - it
 * reaches the client and hangs the Hold forever with no timeout.
 *
 * 10-13 are the event trade-in boxes; 11 carries the LootItem action that pairs it with
 * augment_template_green.json. 63148366 / 172582782 / 130797813 are mining drops.
 *
 * untrashable: the Hold shows a recycle button purely on Trashable, dropping a countable drops the
 * ENTIRE stack, and the server has no Trashable check at all. The four event boxes and the FTL
 * fragment are stacks a misclick should not be able to destroy.
 */
const LEGACY_META = {
  // The three green-rounds SKUs sort at 900, after every buyable round: they cannot be bought, so
  // putting them at the top of the Round tab would be a row of permanently greyed-out buttons.
  3:         { key: 'consumable_high_quality_rounds',        frame: 156, weight: 900,
               sell: { [TYLIUM]: 25 }, canBeSold: true },
  5:         { key: 'consumable_medium_high_quality_rounds', frame:  68, weight: 900 },
  9:         { key: 'consumable_heavy_high_quality_rounds',  frame: 120, weight: 900 },
  10:        { key: 'augment_event_pristine_ice',     frame: 133, weight: 100, untrashable: true },
  11:        { key: 'augment_event_sacred_herbs',     frame: 131, weight: 100, untrashable: true,
               action: 'LootItem' },
  12:        { key: 'augment_event_foodstuffs',       frame: 130, weight: 100, untrashable: true },
  13:        { key: 'augment_event_precious_metals',  frame: 132, weight: 100, untrashable: true },
  63148366:  { key: 'resource_plutonium',    frame:  12, weight: 42, buyCount: 10,
               buy: { [TIT]: 50 }, sell: { [TIT]: 10 }, canBeSold: true },
  172582782: { key: 'resource_uranium',      frame:  13, weight: 43,
               sell: { [TIT]: 25 }, canBeSold: true },     // a mining drop, sell-only
  130797813: { key: 'resource_ftl_fragment', frame: 214, weight: 41, buyCount: 10, untrashable: true,
               buy: { [TYLIUM]: 100 }, sell: { [TYLIUM]: 25 }, canBeSold: true },
};

/* Every ResourceType guid MUST end up with a ShipConsumable card. The server hands a resource to
 * the client by guid, the client asks for its card, and ItemCountable.Read blocks on a card that
 * never arrives - the Linerx5Nuke stall this check was written for. Checked against the guids
 * actually emitted rather than against a list kept in this file, because a hand-kept list is
 * exactly what let that happen. */
function checkResourceCoverage(emitted) {
  const src = fs.readFileSync(path.resolve(CORE_SRC, 'enums/ResourceType.java'), 'utf8');
  for (const m of src.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*(\d+)L?\s*\)/gm)) {
    const [, name, guid] = m;
    if (name === 'None' || emitted.has(Number(guid))) continue;
    throw new Error(
      `ResourceType.${name} (guid ${guid}) gets no ShipConsumable card - consumables-real.js does `
      + `not carry it and LEGACY_META does not either. The client blocks on it forever.`);
  }
}

function consumableCards() {
  /* One row shape for both sources so the emitter below has a single path. The dump record is the
   * reference; LEGACY_META fills the same fields in for the ten guids the dump has no card for,
   * and LEGACY_CONSUMABLES supplies the type corrections for 3/5/9. */
  const rows = CONSUMABLES_REAL.map(r => {
    const rate = CURRENCY_RATES[r.guid];
    if (!!rate !== (r.price.buy === null)) throw new Error(
      `consumables-real.js and CURRENCY_RATES disagree about guid ${r.guid} (${r.key}): the module `
      + `${r.price.buy === null ? 'defers its price to this file' : 'carries its own price'} and this `
      + `file ${rate ? 'does' : 'does not'} hold a rate for it. One of the two moved.`);
    return {
      guid: r.guid, key: r.key, atlas: r.atlas, frame: r.frame, icon: r.icon,
      ct: r.ct, tier: r.tier, effect: r.effect, action: r.action, isAugment: r.isAugment,
      autoConsume: r.autoConsume, trashable: r.trashable, attrs: r.attrs, add: r.add, mul: r.mul,
      missileHull: r.missileHull,
      buyCount: rate ? rate[3] : r.buyCount,
      category: r.price.category, itemType: r.price.itemType, faction: r.price.faction,
      sortNames: r.price.sortNames, weight: r.price.sortWeight,
      buy: rate ? rate[0] : r.price.buy,
      upgrade: rate ? {} : r.price.upgrade,
      sell: rate ? rate[1] : r.price.sell,
      canBeSold: rate ? rate[2] : r.price.canBeSold,
    };
  });

  const fixes = new Map(LEGACY_CONSUMABLES.map(l => [l.guid, l]));
  Object.entries(LEGACY_META).forEach(([g, m]) => {
    const guid = Number(g);
    const fix = fixes.get(guid);
    if (!fix) throw new Error(
      `LEGACY_META has guid ${guid} but consumables-real.js does not list it in `
      + `LEGACY_CONSUMABLES - one of the two tables was edited without the other`);
    rows.push({
      guid, key: m.key, atlas: 'GUI/Inventory/items_atlas', frame: m.frame, icon: '',
      ct: fix.ct || 0, tier: fix.tier || 0, effect: fix.effect || 'None',
      action: m.action || 'None', isAugment: m.action !== undefined,
      autoConsume: false, trashable: !m.untrashable, attrs: fix.attrs || [], add: {}, mul: {},
      buyCount: m.buyCount || 1,
      category: (fix.price && fix.price.category) || 'Resource',
      itemType: (fix.price && fix.price.itemType) || 'Resource',
      faction: 'Neutral', sortNames: [], weight: m.weight,
      buy: m.buy || {}, upgrade: {}, sell: m.sell || {}, canBeSold: !!m.canBeSold,
    });
  });

  const byGuid = new Set();
  rows.forEach(r => {
    if (byGuid.has(r.guid)) throw new Error(
      `countable guid ${r.guid} is emitted twice - the dump import and LEGACY_META both claim it`);
    byGuid.add(r.guid);
  });
  checkResourceCoverage(byGuid);

  return rows.flatMap(r => [
    card(r.guid, 'GUI', {
      /* level 0, not 1: a "LEVEL n" chip renders whenever Level > 0, which is meaningless on a
       * stack of water, and none of these keys has a .Name_<n> variant for GUICard.cs to find. */
      key: r.key, level: 0,
      guiAtlasTexturePath: r.atlas, frameIndex: r.frame,
      /* guiIcon is loaded as a WHOLE standalone texture with no atlas fallback by the money bar
       * and every price row, and the image widget ADOPTS the texture's size - which is why any
       * guid used as a KEY in a Price items map has to keep one. Only the six currencies have
       * one; everything else draws from its atlas frame. */
      guiIcon: r.icon, guiAvatarSlotTexturePath: '', guiTexturePath: '', args: [],
    }),
    card(r.guid, 'ShipConsumable', {
      /* ConsumableType and Tier together are the ammo-pairing key: ItemList.cs:135 passes a
       * countable to a weapon when Card.ConsumableType matches the ability's and
       * (Card.Tier == abilityTier || Card.Tier == 0). Tier 0 therefore means "fits every hull
       * tier", which is right for water and tuning kits and wrong for ammunition - it would put
       * light rounds in a capital ship's magazine. Every ammunition record here is tier-locked
       * 1-4 because the dump's own cards are. */
      ConsumableType: r.ct, Tier: r.tier,
      /* On a consumable ItemBuffAdd is a FRACTIONAL MULTIPLIER, not an absolute: applyAbilitySlot
       * Stats runs applyStatsMultToIfBonusExistsInApplyOn against the ability's own stats and adds
       * the product, so DamageHigh 0.15 is +15%. It also means a consumable can only modify a stat
       * the ability already has - which is what keeps a mine's DrainLow off a plain missile. */
      ItemBuffMultiply: stats(r.mul), ItemBuffAdd: stats(r.add),
      Action: r.action, IsAugment: r.isAugment, AutoConsume: r.autoConsume,
      Trashable: r.trashable,
      buyCount: r.buyCount, consumableAttributes: r.attrs, effectType: r.effect,
      /* Warhead missile HP - non-zero on the eight nukes only, 0 = no override. Server-only card
       * field: FireMissileAction reads it to give the spawned missile the WARHEAD's hull points
       * instead of the launcher's, and ShipConsumableCard.write never puts it on the wire. See
       * WARHEAD_HULL in gen-consumables-real.js for the values and why ItemBuffAdd cannot carry
       * this. Present on every card because G17 demands every declared field. */
      MissileHullPoints: r.missileHull || 0,
    }),
    card(r.guid, 'Price', {
      /* Category is a ShopCategory constant and ItemType a ShopItemType one. They are different
       * enums that both contain 'Resource' and 'Augment', which is how seven of these cards
       * carried ItemType 'Consumable' until recently - Gson leaves a bad name null and
       * ShopItemCard.write does bw.writeByte(shopItemType.value), which NPEs and drops the socket.
       * For the 165 imported countables both names are the dump's own Price card's; for the ten in
       * LEGACY_META they come from LEGACY_CONSUMABLES, which is where the three green-rounds SKUs
       * stop being Resource/Resource and become Consumable/Round. */
      Category: r.category, ItemType: r.itemType, Tier: r.tier, Faction: r.faction,
      SortingNames: r.sortNames, SortingWeight: r.weight,
      /* An empty BuyPrice means NOT STOCKED for a countable - setupShop's first pass skips it. It
       * does not mean free. That is how the loot-only SKUs and the seven boosters with no factor
       * template stay out of the store while keeping their sell price, which is the whole reason
       * those seven can ship at all: PlayerProtocol's UseAugment logs "Activated augment but no
       * template!" and returns, so a stocked one would be a purchase that does nothing. */
      BuyPrice: price(r.buy), UpgradePrice: price(r.upgrade),
      SellPrice: price(r.sell), CanBeSold: r.canBeSold,
    }),
  ]);
}

/* ================================================================ SECTOR-SPAWNED OBJECTS
 * Guids come from the shipped SectorTemplates. Missing cards are not fatal (Sector.run wraps
 * each spawn in a try/catch) but they crash-log once per tick and leave the sector empty.
 * Asteroids are detected by string match: Catalogue requires prefabName to CONTAIN "asteroid"
 * and NOT contain "field", and auto-generates their collider from the radius.
 */
const CRUISERS = [
  { guid: 29, prefab: 'galactica', loca: 'cruiser_galactica', faction: 'Colonial', radius: 300 },
  { guid: 28, prefab: 'basestar',  loca: 'cruiser_basestar',  faction: 'Cylon',    radius: 250 },
];

/* ================================================================ SECTOR FURNITURE
 * Planetoids, outposts and weapon platforms, all referenced BY GUID from the shipped Tannhauser
 * sector template. These guids are upstream data, not ours to choose.
 *
 * I originally deleted all ten of these objects from the sector rather than author their cards,
 * because SpaceObjectFactory throws when a card is missing and the whole sector dies. That was
 * backwards: the sector was telling us what content the real game had.
 *
 * What each type demands (SpaceObjectFactory.java):
 *   Planetoid       World + Owner                    :243-247  "Cards for Planetoid missing"
 *   Outpost         World + Owner                    :398
 *   WeaponPlatform  World + Owner + Ship             :357-362  "could not find cards!"
 * The Ship card matters for platforms because the factory reads MaxHullPoints / MaxPowerPoints
 * off it and hands its Tier to NpcBehaviourTemplates.createPlatFormTemplate.
 *
 * Prefabs and loca keys are all verified present in the client:
 *   humanoutpost / cylonoutpost                bgo.outpost_human / bgo.outpost_cylon
 *   human_stationary_platform_{small,medium,large} and the cylon set
 *                                              bgo.stationary_{colonial,cylon}_platform_{...}
 *   planetoid1_1 .. planetoid3_3               no loca key exists for planetoids at all
 */
/* The first four guids are upstream's (referenced by the shipped Tannhauser template, prefabs
 * exactly as the original derivation cycled them - do not re-derive, 47344836 really is a second
 * planetoid1_1). The six at 47345001+ are ours: the planetoid_rock bundle holds ten planetoid
 * prefabs and only four were ever carded, so a generated sector could not vary its skyline. All
 * ten names are verified against the client assetmap by the World-prefab rule in validate(). */
const PLANETOIDS = [
  [47343042, 'planetoid1_1'], [47344578, 'planetoid2_2'],
  [47344835, 'planetoid3_3'], [47344836, 'planetoid1_1'],
  [47345001, 'planetoid1_2'], [47345002, 'planetoid1_3'],
  [47345003, 'planetoid2_1'], [47345004, 'planetoid2_3'],
  [47345005, 'planetoid3_1'], [47345006, 'planetoid3_2'],
];

/* THE TWO OUTPOSTS - one card per faction, instanced across the galaxy.
 *
 * These two guids are referenced by every sector template that carries an Outpost entry, which is
 * now most of the map rather than only Tannhauser: emit-sector-templates.js gives each generated
 * sector an outpost per faction its control group permits, and sectors 0 and 6 gained their
 * owner's. Who actually HOLDS one at boot is SectorFactory.setupOutpostStates, not this file.
 *
 * An outpost is a CAPITAL SHIP, not a large platform: research/bsgo_wiki/Outposts.txt files both
 * under [[Category:Colonial Capital Ships]] / [[Category:Cylon Capital Ships]] (Outposts.txt:111-112),
 * and its per-faction stat block - :101-104 Colonial, :106-109 Cylon, byte-identical - is the source
 * for three of the four numbers below:
 *     Base Hull Points   50,000 regular / 55,000 upgraded / 60,000 fortified   (:101 / :106)
 *     Power              4,500                                                 (:102 / :107)
 *     Visual Range       1,300 m                                              (:103 / :108)
 * We ship only the "regular" tier. 55k is system-control level 5 (Outposts.txt:29) and 60k level 8
 * (:32); the server has no tier ladder - one flat outpost per faction. 50,000 is 3.3x the 15,000
 * Heavy Sentry Platform on that same page (:39) and 4x the 12,500 Nexus Guardian, the tallest row in
 * research/data/platforms.json, which is what "outclasses a platform" has to mean numerically.
 *
 * TIER 4 - and it MUST be the same value on the Ship and the ShipLight card, because the server gates
 * on ShipCard.getTier() and the client on ShipCardLight.Tier. A mismatch splits the two with no error
 * anywhere; the new Ship/ShipLight validator now fails the build on it.
 * The tier is genuinely ours to choose here: NpcBehaviourTemplates.createOutpostTemplate()
 * (NpcBehaviourTemplates.java:31-34) takes NO tier at all. Its platform sibling,
 * createPlatFormTemplate(tier, template) (:36-58), throws "Tier not implemented" for anything but
 * 1/2/3 - but ONLY after an early return at :38-42 that ignores the tier entirely whenever the
 * template carries maximumAggroDistance > 0. Sector 10's four platform records carry none, so for
 * those four (all MEDIUM, guid 1783473191/97) the throw is live - which is why the medium stays
 * tier 2, and why every PLATFORMS tier sits inside the switch's legal 1/2/3 range.
 * What actually reads an outpost's tier:
 *   - Ship.ShipExplosion (client Ship.cs:198) -> ExplosionEffectState.cs:114/133: 1 small, 2 medium,
 *     3|4 LARGE with distInvisible 10000. Outside 1..4 the prefab array stays null and the station
 *     dies with NO explosion, logging "No explosion prefabs found".
 *   - AbilityAction.targetTierCheck (:216-233) and client ShipAbstractAbility.cs:103-113: both do
 *     tierToEnum(tier) = 1 << (tier-1). 4 -> 8 -> ShipAbilityTargetTier.Tier4, a real constant.
 *     Tier 0 would compute 1 << 31 and forValue() returns NULL. Only harmless today because every
 *     ability we author carries TargetTiers ['Any'] (cards.js:1299) and both sides short-circuit.
 *   - CollisionResolution.getTier (:52-58) -> getResolutionForce baseForce = |dTier| * 8. Tier 4
 *     therefore gives a tier-1 fighter the maximum shove off the hull. The outpost itself is never
 *     shoved: resolveCollisionInfo (:213-225) always makes it the staticObject, because
 *     MovementController.isMovingObject() returns false (MovementController.java:219-222) and only
 *     DynamicMovementController overrides it (:115-118) - and Ship does not override
 *     SpaceObject.createMovementController (SpaceObject.java:90-93), so an Outpost gets a
 *     StaticMovementController. resolveMovingXStaticObject then calls setCollisionManeuver on the
 *     MOVING object only (:326).
 *   - Dormant: wrapCollider (:603-615) keys ColliderTemplates by prefab name.
 *     ServerConfigurationUtils/global/ColliderTemplates holds 30 files under Colonial/Cylon/Neutral -
 *     29 hull colliders plus comet.json - and nothing for humanoutpost, cylonoutpost or any platform
 *     prefab, so the outpost has no collider at all yet.
 *
 * NOT READ ANYWHERE: the system-map icon does not come from the tier or the class.
 * GUISystemMap.GetShipType is a TOOLTIP selector - its only caller is :536,
 * SetTooltip(tooltipsDictonary[GetShipType(ref ship)]), inside the MouseOverIcon branch at :531 - and
 * MapIconType is only ever a key into tooltipsDictonary (:333, :482-512). The actual sprite is
 * atlasCache.GetCachedEntryBy(cruiserShip.WorldCard.SystemMapTexture, cruiserShip.WorldCard.FrameIndex)
 * at :715, and the list it draws from is built at :709-723, which SKIPS any CruiserShip/WeaponPlatform
 * whose WorldCard.FrameIndex < 0 (:712). So with frameIndex -1 the outpost has no map icon and no map
 * tooltip. That is deliberate and it is the better of the two options while systemMapTexutres is '':
 * ResourceLoader.Load('') returns null and AtlasCache.GetCachedEntryBy hands back UnknownItem
 * (AtlasCache.cs:66-77), so frameIndex 0 would draw the unknown-item sprite rather than nothing.
 * Every World card in the build ships systemMapTexutres: '' today, so this is a global gap, not an
 * outpost one - see the deferred list.
 *
 * PowerRecovery: 165 = 3.667% of the wiki-attested 4,500 pool (Outposts.txt:102). No source states an
 * outpost's recharge, so the RATIO is borrowed and the number is INFERRED, not attested. 3.667% is
 * what the dump's two tier-4 capital hulls carry (guids 3917123639 and 3765070071: MaxPowerPoints
 * 1500, PowerRecovery 55), and it is independently corroborated by the only two attested capital
 * recharge figures in the corpus - Battlestar Pegasus.txt:21/:30 and Basestar.txt:24/:25 both give
 * Power 2,000 with Power Recharge 60/sec, i.e. 3.0%. Across all 95 dumped Ship cards the ratio band
 * is 2.4%-5.2%, median 3.636%; 165 sits inside it.
 * It previously shipped 15 - the fighter default of 5 scaled 3x - which is 0.333%, seven times below
 * the LOWEST ratio ever shipped, and the comment claimed it was "inert anyway until the outpost has
 * weapons". That escape hatch expired with this change. The twelve mounts draw 67.5 pp/s continuously
 * (6 x 25/4.8 + 4 x 100/18 + 2 x 3.5/0.5), so at 15/s the 4,500 pool emptied in 86 seconds and the
 * station then fired at a 22% duty cycle forever - and because AbilityAction.java:88-91 rejects PER
 * SLOT, the 3.5-pp point defence would starve out the 25-pp cannons and the 100-pp launchers
 * entirely, leaving a station that reads as harmless. 165 leaves ~2.4x headroom and refills from
 * empty in 27 s. PowerPointsTimer does not exclude Outpost or WeaponPlatform, so it does tick.
 */
const OUTPOST_TIER = 4;
const OUTPOSTS = [
  { guid: 1450701610, faction: 'Colonial', prefab: 'humanoutpost', loca: 'outpost_human' },
  { guid: 1450701611, faction: 'Cylon',    prefab: 'cylonoutpost', loca: 'outpost_cylon' },
];

/* The weapon platforms - the sentry ring guards instanced four times around each outpost. Three
 * tiers per faction since 2026-07-31: Light / Medium / Heavy, the wiki's own sentry ladder.
 *
 * These guids are NOT arbitrary and NOT "Ancient art we have to improvise": they are named in
 * StaticCardGUID (BSGOCore enums/StaticCardGUID.java:29-40), which lists humanstationary1..6 as
 * 1783473190-95 and cylonstationary1..6 as 1783473196-201. So 1783473191 is humanstationary2 and
 * 1783473197 is cylonstationary2 - one MEDIUM platform per faction, not two Ancient ones - and the
 * light/heavy tiers take the enum's own 1-and-3 rows: 1783473190/1783473196 (humanstationary1/
 * cylonstationary1) light, 1783473192/1783473198 (humanstationary3/cylonstationary3) heavy. All
 * four verified card-free before use. I first authored the mediums with Cylon models because the
 * sector template labels their FACTION as Ancient; the guid is the stronger signal and the enum
 * settles it.
 *
 * FACTION IS NOW THE OWNER'S, NOT Ancient. Upstream's four Tannhauser platform templates were
 * labelled Ancient, which is what a platform guarding NOBODY looks like. The templates now name
 * the outpost's own faction, and this card has to agree with them: the object is constructed with
 * weaponPlatformTemplate.getFaction() (SpaceObjectFactory.java:370), so the TEMPLATE decides who
 * it shoots, while this card is what the client renders and reads a faction off. Leaving the two
 * disagreeing means a Colonial platform that displays as Ancient.
 *
 * TIER 1/2/3 (light/medium/heavy) IS DELIBERATE AND LOAD-BEARING three ways:
 *   - module bindings: ShipBindings selects turret/missile_tier{shipTier} (ShipBindings.java:93-97)
 *     and moduleCards() already emits tiers 1-4, so no new Module cards are needed;
 *   - client death explosion: ExplosionEffectState maps tier 1 -> small, 2 -> medium, 3 -> LARGE
 *     (see the outpost comment above);
 *   - collision shove: baseForce = |dTier| * 8.
 * createPlatFormTemplate's 1/2/3 switch (NpcBehaviourTemplates.java:36-58) is bypassed anyway:
 * every generated ring template carries maximumAggroDistance > 0, so the early return at :38-42
 * fires first - but all three tiers sit inside the switch's legal range regardless.
 *
 * STATS ARE ATTESTED, and the comment that used to stand here was wrong. It cited
 * research/data/platforms.json for "Light 1,500 HP, Medium 5,000, Large 15,000" - none of those three
 * numbers is in that file, which has no "Large" size at all and whose Medium rows read 4250-5750 HP
 * at 750 power. That file describes the NEUTRAL asteroid platforms (Interdiction / Sentinel /
 * Guardian / Suppression), a different NPC family. These guids are the ring guards that spawn
 * around an OUTPOST, which makes them SENTRY platforms, and the wiki gives all three tiers exactly
 * (Outposts.txt:37-39, corroborated by Dev Blog 15.txt:75-80 and all six bsgonline per-faction
 * infobox pages):
 *   Light Sentry Platform:  7,500 Hull, 3,000 Energy, 8 x 20 mm autocannon + 2 x Interceptor
 *                           Missile Launcher (PLATFORM_WEAPONS 6041/6042)
 *   Medium Sentry Platform: 10,000 Hull, 3,000 Energy, 8 x 127 mm autocannon + 5 x Medium Missile
 *                           Launcher (202/203 actually fit the outpost's pair, 1957961850 and
 *                           3756543070; the dump's own medium-class guns 4001980506 / 2936089294
 *                           now ship as ordinary tier-3 player weapons and no config fits them)
 *   Heavy Sentry Platform:  15,000 Hull, 3,000 Energy, 2 x 63 mm Flak + 2 x 15 mm PD +
 *                           8 x 40.6 cm cannon + 5 x Heavy Missile Launcher (6051-6054)
 * The armament counts are why the prefabs carry exactly 13 / 10 / 16 usable mounts (see
 * HARDPOINTS; large is one short of Heavy's 17, hence the shared-spot 17th slot below). Armour
 * 35/60/75 is attested but still NOT shipped - these platforms seed no ArmorValue at all. That used
 * to be free because ArmorAlgorithmV0 returned a constant 1; SectorAlgorithms now runs V1, so
 * armour is live and every point of it these hulls do not carry is damage they do take.
 * PowerRecovery 110 = 3.667% of 3,000, the same borrowed capital ratio as the outpost - INFERRED.
 * Continuous-fire draw per fit: light 8 x 3/3.5 + 2 x 15/45 = 7.5 pp/s, medium (A/B fit)
 * 8 x 25/4.8 + 5 x 100/18 = 69.4, heavy 8 x 25/8 + 5 x 100/30 + 2 x 7/1 + 2 x 3.5/0.5 = 69.7 -
 * all clear the 110 floor, so no slot ever starves (the per-slot rejection trap, see the outpost
 * PowerRecovery comment).
 * radius = max composed root-local AABB extent, rounded up to the next 5 (the medium convention:
 * 167.108 -> 170 human / 183.341 -> 185 cylon; small 96.412 -> 100 / 111.059 -> 115, large
 * 296.911 -> 300 / 385.797 -> 390 measured 2026-07-31, shipped as ColliderTemplates). Cosmetic
 * server-side (WorldCard.getRadius has no caller in BSGOCore) but it must cover the mounts.
 * slots = usable mounts (placeholders take none); the heavy rows additionally name extraMount,
 * the missile mount whose spot the hand-written 17th slot shares. */
const PLATFORMS = [
  { guid: 1783473190, faction: 'Colonial', prefab: 'human_stationary_platform_small',
    loca: 'stationary_colonial_platform_small',  hp: 7500,  pwr: 3000, tier: 1, radius: 100, slots: 10 },
  { guid: 1783473191, faction: 'Colonial', prefab: 'human_stationary_platform_medium',
    loca: 'stationary_colonial_platform_medium', hp: 10000, pwr: 3000, tier: 2, radius: 170, slots: 13 },
  { guid: 1783473192, faction: 'Colonial', prefab: 'human_stationary_platform_large',
    loca: 'stationary_colonial_platform_large',  hp: 15000, pwr: 3000, tier: 3, radius: 300, slots: 16,
    extraMount: 'bullet05' },
  { guid: 1783473196, faction: 'Cylon',    prefab: 'cylon_stationary_platform_small',
    loca: 'stationary_cylon_platform_small',     hp: 7500,  pwr: 3000, tier: 1, radius: 115, slots: 10 },
  { guid: 1783473197, faction: 'Cylon',    prefab: 'cylon_stationary_platform_medium',
    loca: 'stationary_cylon_platform_medium',    hp: 10000, pwr: 3000, tier: 2, radius: 185, slots: 13 },
  { guid: 1783473198, faction: 'Cylon',    prefab: 'cylon_stationary_platform_large',
    loca: 'stationary_cylon_platform_large',     hp: 15000, pwr: 3000, tier: 3, radius: 390, slots: 16,
    extraMount: 'bullet09' },
];

function sectorFurnitureCards() {
  const out = [];

  // Planetoids are scenery: not targetable, no stats, but the factory still demands both cards.
  PLANETOIDS.forEach(([guid, prefab], i) => {
    out.push(card(guid, 'World', {
      prefabName: prefab, lodCount: 1, radius: 400.0,
      spots: [], systemMapTexutres: '',
      // -1, not 0: WorldCard.FrameIndex defaults to -1 and GUISystemMap hides anything below
      // zero. A 0 here claims atlas frame 0 and draws the wrong icon on the system map.
      frameIndex: -1, secondaryFrameIndex: -1,
      // Targetable like the original: a planetoid you can select is one you can navigate by
      // and set approach on. It has no stats and nothing shoots it - the regulation card's
      // ability-target tables never list Planetoid(16) for weapons.
      targetable: true, showBracketWhenInRange: true, forceShowOnMap: true,
    }));
    out.push(card(guid, 'Owner', { IsDockable: false, DockRange: 0.0, Level: 1 }));
    /* A PLANETOID WITHOUT A GUI CARD IS AN INVISIBLE WALL.
     * These shipped World + Owner only, and the server logged
     *   "Card should not be send because it's null! 47344835 1"
     * once per planetoid per player - view 1 is GUI. The client asks for it, gets null, and the
     * object never finishes constructing, so it is never drawn. The SERVER still has it, at radius
     * 400, and still collides with it: you fly into something you cannot see. Harmless while only
     * upstream's sector 10 had planetoids and they sat out of the way; every generated sector now
     * places two to four of them, which is how this surfaced on the run to 103 Heleb's outpost.
     * There is no bgo.planetoid* key in the bundle - the earlier note that planetoids have no loca
     * at all was right about that spelling - but bgo.planet_1..10 all resolve, so the icon and the
     * name come from those. The key is what the GUI-key validator checks, and it passes. */
    out.push(card(guid, 'GUI', {
      key: 'planet_' + ((i % 10) + 1), level: 1,
      guiAtlasTexturePath: 'GUI/Inventory/items_atlas', frameIndex: 0,
      guiIcon: '', guiAvatarSlotTexturePath: 'GUI/Slots/avatar_asteroid_temp',
      guiTexturePath: '', args: [],
    }));
  });

  OUTPOSTS.forEach(o => {
    out.push(card(o.guid, 'World', {
      prefabName: o.prefab, lodCount: 1, radius: 250.0,
      // Twelve real mounts, extracted from the prefab - see HARDPOINTS. WeaponAction.java:55-57
      // refuses to fire without a spot whose hash matches the firing slot's, and the spot transform
      // is then what the range gate, the firing arc, the hit-chance distance and the missile spawn
      // point are all measured from.
      spots: spots(o.prefab), systemMapTexutres: '',
      frameIndex: -1, secondaryFrameIndex: -1,
      targetable: true, showBracketWhenInRange: true, forceShowOnMap: true,
    }));
    // Dockable: an outpost is a station. DockRange is generous because the model is 250 units.
    out.push(card(o.guid, 'Owner', { IsDockable: true, DockRange: 400.0, Level: 1 }));
    /* A TARGETABLE WORLD OBJECT MUST CARRY A PORTRAIT, AND ITS FRAME INDEX MUST BE 0.
     * These shipped frameIndex 166 with an empty avatar path, and rendered as a scrambled block of
     * colour in the target bracket. Both halves were wrong, and upstream's own 08-world.json says so
     * unambiguously: EVERY targetable world object it ships - both cruisers and all nine asteroids -
     * uses frameIndex 0 plus a real GUI/Slots texture, and a NON-ZERO frame appears only on
     * inventory items (resources, consumables, augments), where the atlas frame IS the icon. With no
     * avatar texture the bracket falls back to the atlas and crams the whole 400x946 sheet into a
     * 40x36 box - the same failure the ship GUI cards document at the hull block above. 166 was
     * simply an invented inventory frame on an object that has no inventory icon.
     * TEXTURE NAMES ARE VERIFIED, NOT GUESSED. Read out of the client's own resources.assets, where
     * each carries the identical Texture2D header signature as the known-good avatar_asteroid_temp.
     * The drydock pair is the right portrait for an outpost specifically: it is the faction-paired
     * station art, and an outpost is the dockable station. Note that plain 'avatar_human' and
     * 'avatar_cylon' are NOT assets - they only ever match as substrings of avatar_humandrydock and
     * avatar_cylon_temp, so referencing either would Resources.Load to null. */
    out.push(card(o.guid, 'GUI', {
      key: o.loca, level: 1,
      guiAtlasTexturePath: 'GUI/Inventory/items_atlas', frameIndex: 0,
      guiIcon: '',
      guiAvatarSlotTexturePath: o.faction === 'Colonial'
        ? 'GUI/Slots/avatar_humandrydock' : 'GUI/Slots/avatar_cylondrydock',
      guiTexturePath: '', args: [],
    }));
    /* SHIP (view 10). createOutpost (SpaceObjectFactory.java:387-425) fetches World + Owner + Ship at
     * the template's objectGUID (:398-400) and throws IllegalArgumentException
     * "SpaceObjectFactory; could not find cards!" (:401-404) if any one is absent. It then reads
     * MaxHullPoints and MaxPowerPoints off this card with getStat() (:409-410), which returns a BOXED
     * Float - absent means null, and the unboxing into setHp(float) NPEs. Either way the throw leaves
     * OutpostSpawnTimer.spawnOp (:98-109, which catches ONLY IllegalStateException), passes through
     * timerUpdater.run() (Sector.java:119) and lands in Sector.run's catch (Sector.java:125-128): the
     * tick TRUNCATES - spaceObjectRemover (:121) and sectorZoneManagement (:123) never run that cycle -
     * and it repeats every 5 s forever with nothing in the log but "Sector[N] single crash". */
    out.push(card(o.guid, 'Ship', {
      ShipObjectKey: o.guid, Level: 1, MaxLevel: 1, LevelRequirement: 1,
      /* 12, never -1. CatalogueProtocol.shipCardFilter (:98-105) returns Optional.empty() for
       * HangarID -1, so the card becomes undeliverable and the client waits on it forever; the
       * validator at cards.js:2596 already fails the build on it. 12 has no icon art and no ship-shop
       * queue position, same as the platforms. research/world/outpost_cards.json ships -1.
       * Durability 400 DELIBERATELY BREAKS the DURABILITY table (cards.js:860: tier 4 = 12000). Only
       * player-owned hulls read getDurability() - HangarShip.java:91/139-229 and
       * DurabilityCostCalculator - and an outpost is in no hangar, has no Price card and is in no
       * ShipList, so the value is inert. 400 is the tier-1 figure kept purely to match PLATFORMS. */
      HangarID: 12, Durability: 400, Tier: OUTPOST_TIER,
      /* ShipRole (templates/utils/ShipRole.java) is Fighter..Mothership(14) with NO 'Defender' and
       * NO 'Multi'; those two exist only in ShipRoleDeprecated (None, Fighter, Defender, Command,
       * Multi, Mothership, Carrier, Stealth). A name outside the enum is a null array element and
       * ShipCard.write NPEs on shipRole.value (ShipCard.java:95). 'Mothership' is legal in BOTH
       * enums, which is why the cruisers use it - and it is the only capital value that is not
       * 'Carrier'. Carrier must be avoided: ShipRoleDeprecated.Carrier is a live client behaviour
       * switch in eight places (Party.cs:133/152, DradisUpdater.cs:29, GUISlotManager.cs:144,
       * GUISystemMap.cs:1227, DockingButton.cs:198, PlayerShip.cs:356, ArenaProtocol.cs:99) that
       * drives anchoring and party hosting. A station must not read as an anchorable carrier. */
      ShipRoles: ['Mothership'], ShipRoleDeprecated: 'Mothership',
      // '' is legal - ShipCard.cs:146 skips the paperdoll load entirely, as the cruisers rely on.
      PaperdollUiLayoutfile: '',
      /* TWELVE WEAPON MOUNTS - 6 long-range cannon, 4 long-range launcher, 2 point defence, which
       * are the three classes Outposts.txt:104/:109 attests ("Long range cannons, long range missile
       * launchers, point defence systems"). The 6/4/2 split is INFERRED: it is the only attested
       * 12-mount capital split in the corpus (Battlestar Pegasus.txt:50-52), and no source states an
       * outpost's counts. Which physical mount takes which class is a GUESS from geometry.
       * SLOTS ALONE STILL FIRE NOTHING. setupWeaponConfig (SpaceObjectFactory.java:650-694) returns
       * at :656-657 on a missing ShipConfigTemplate, ELEVEN LINES BEFORE it reads this array at :668
       * - so the earlier note here, that Slots were pointless without a template, was right about the
       * template and wrong about the ordering. The template lives at
       * ServerConfigurationUtils/global/ShipConfigTemplates/{colonial,cylon}/20{0,1}_outpost_*.json
       * and is what actually arms the station. Both are required, neither alone does anything, and
       * neither failure logs a line.
       * ImmutableSlots and VariantHangarIDs must still be present as EMPTY arrays: Gson's
       * UnsafeAllocator skips field initialisers and ShipCard.write calls writeDescArray /
       * writeUInt32Collection on them unguarded (ShipCard.java:99-105). */
      Slots: stationSlots(o.prefab, 12), CubitOnlyRepair: false,
      VariantHangarIDs: [], ParentHangarID: -1,
      /* THE OVERRIDES GO AFTER flightStats(), NOT BEFORE IT. flightStats returns HullRecovery 5
       * (cards.js:141) and DetectionVisual/Inner/Outer 250/1000/2500 (cards.js:171) of its own, so an
       * earlier Object.assign source is silently overwritten - which is exactly what happened to the
       * platforms below: they ask for HullRecovery 0 at cards.js:1806 and the live 08-world.json emits
       * 5. An outpost that regenerates hull breaks the whole conquest loop, because the 3,600-second
       * repair block (SectorFactory.java:133, and the wiki's 60 minutes at Outposts.txt:20) is the
       * intended punishment for losing one and HullPointsTimer would undo a raid between waves.
       * Flight stats are 1 m/s across the board, exactly as PLATFORMS does it, NOT the zeroes in
       * research/world/outpost_cards.json. Two reasons, both real:
       *   (1) FLIGHT_REQUIRED at cards.js:2440-2451 fails the build on any of eight stats <= 0;
       *   (2) client Ship.CreateMovementController (Ship.cs:104-107) builds a real ManeuverController
       *       from the Movement card for every ship it renders.
       * NOT a reason, and the PLATFORMS comment at cards.js:1798-1802 is wrong about this: the SERVER
       * never divides by these. An Outpost gets a StaticMovementController (SpaceObject.java:90-93 -
       * Ship does not override it), isMovingObject() is false (MovementController.java:219-222) so
       * CollisionResolution always makes it the static object and only maneuvers the other one (:326),
       * and StaticMovementController.move (:16-41) never calls maneuver.nextFrame() - it only latches.
       * MovementSimulation is unreachable for a static object. Fix the platform comment when you next
       * touch it rather than propagating it.
       * Do NOT zero FtlRange: cards.js:2491-2494 takes min(FtlRange) across EVERY Ship card in the
       * build and errors when the longest star pair exceeds it, so an outpost at 0 would fail galaxy
       * traversability for the whole catalogue. Nothing jumps an outpost, so inheriting flightStats'
       * 200/1 is free.
       * DetectionVisualRadius 1300 is the wiki's "Visual Range: 1,300 metres" (Outposts.txt:103/:108),
       * and it DELIBERATELY OVERRIDES a dumped value, against the policy stated at cards.js:932
       * ("Dumped radii LAST, so they win"): detection('Mothership', 4) returns [1750, 2000, 5000], so
       * Inner/Outer are the dumped tier-4 capital row and Visual is the wiki's. Justification:
       * SystemsStatsGenerator.cs:79 maps the wiki's "Visual Range" to dradis_visual_range, and Visual
       * is the see-through-cloak bubble (cards.js:153) which nothing uses yet - so the wiki number is
       * the better-sourced one and costs nothing. Inner/Outer are what drive DradisManager's
       * per-object scan and stay dumped; the draft's 6000/6000 was 3x the real capital numbers.
       * The 5000 Outer clears both ceilings: the base check at cards.js:2467-2468 (>= 10000) and the
       * buffed check at cards.js:2740-2760, which multiplies by the strongest skill_map_range step.
       * DELIBERATELY NOT SHIPPED, against the draft: ArmorValue 60 (ArmorAlgorithmV0.getMultiplicator
       * returns a constant 1, installed by SectorAlgorithms.defaultAlgorithms():29-38 - armour is
       * ignored), FirewallRating 200 (only DeBuffAction.java:40 reads it and no EW ability card
       * exists), Avoidance 0, and DradisRange 6000 (in the client's hiddenStats, read by nothing).
       * CriticalDefense stays at the 0 that flightStats supplies: the draft's 200 would make
       * DamageCalculator -> CritchanceAlgorithmV1 (5 + 0.15*(critOffense - 200))*0.01 clamp to 0 for
       * every weapon we ship, i.e. a crit-immune outpost. */
      Stats: stats(Object.assign({ MaxHullPoints: 50000, MaxPowerPoints: 4500 },
        flightStats({ speed: 1, boost: 1, accel: 1, pitch: 1, yaw: 1, roll: 1, strafe: 1 }),
        detection('Mothership', OUTPOST_TIER),
        { PowerRecovery: 165, HullRecovery: 0, DetectionVisualRadius: 1300 })),
      Faction: o.faction, ImmutableSlots: [], nextShipCardGuid: 0,
    }));
    /* MOVEMENT (view 28). Ship.java:36-39 fetches it by the WORLD card's guid and throws
     * "MovementCard cannot be null" in the constructor of EVERY Ship subclass, before anything
     * looks at speed - so an anchored station needs one exactly as much as a fighter does. The
     * client fetches the same card at Ship.cs:106. Copied from PLATFORMS, which is also the
     * MovementCard(guid) convenience-constructor default (MovementCard.java:20-22).
     * research/world/outpost_cards.json sets maxPitch and maxRoll to 0; they are non-zero here only
     * because the client's ManeuverController reads them, not because the server does. */
    out.push(card(o.guid, 'Movement', {
      minYawSpeed: 0.1, maxPitch: 360.0, maxRoll: 80.0,
      pitchFading: 2.0, yawFading: 2.0, rollFading: 400.0,
    }));
    /* SHIPLIGHT (view 42). Client Ship.LoadCards (Ship.cs:65-69) fetches it at objectGUID and adds
     * it to AreCardsLoaded, which gates isLoaded (SpaceObject.cs:390). Without it the outpost never
     * finishes constructing: no model, no bracket, no name tag, no DRADIS entry, nothing to click -
     * and the only trace is one "Card should not be send because it's null! <guid> 42" per client
     * on the server (CatalogueProtocol.java:76), because Catalogue.FetchCard caches an empty
     * placeholder and requests it forever (client Catalogue.cs:17-31).
     * Tier and both role fields must equal the Ship card's; the server reads ShipCard, the client
     * reads ShipCardLight, and only these three fields are on both. The new Ship/ShipLight validator
     * fails the build if they drift. */
    out.push(card(o.guid, 'ShipLight', {
      ShipObjectKey: o.guid, Tier: OUTPOST_TIER,
      ShipRoles: ['Mothership'], ShipRoleDeprecated: 'Mothership',
    }));
    /* Price(23): the client fetches the Price view for things its target/info UI can show,
     * stations included - without one the server logs "Card should not be send because it's
     * null! <guid> 23" once per client per guid, live-caught the first time a ring appeared.
     * An empty BuyPrice means NOT FOR SALE everywhere since the shop guards, which is exactly
     * right for a station. */
    out.push(card(o.guid, 'Price', {
      Category: 'Ship', ItemType: 'Ship', Tier: OUTPOST_TIER, Faction: o.faction,
      SortingNames: [], SortingWeight: 0,
      BuyPrice: price({}), UpgradePrice: price({}), SellPrice: price({}), CanBeSold: false,
    }));
  });

  PLATFORMS.forEach(p => {
    out.push(card(p.guid, 'World', {
      prefabName: p.prefab, lodCount: 1, radius: p.radius,
      // Every platform prefab's trailing two transforms are origin placeholders (medium
      // bullet14/15, small bullet11/12, large bullet17/18): emitted as spots, but no slot
      // points at them - see the HARDPOINTS station comment.
      spots: spots(p.prefab), systemMapTexutres: '',
      frameIndex: -1, secondaryFrameIndex: -1,
      targetable: true, showBracketWhenInRange: true, forceShowOnMap: false,
    }));
    out.push(card(p.guid, 'Owner', { IsDockable: false, DockRange: 0.0, Level: 1 }));
    out.push(card(p.guid, 'Ship', {
      ShipObjectKey: p.guid, Level: 1, MaxLevel: 1, LevelRequirement: 1,
      // HangarID 12 has no icon art in either faction, which is exactly right for something that
      // must never appear in the ship shop.
      HangarID: 12, Durability: 400, Tier: p.tier,
      ShipRoles: ['Artillery'], ShipRoleDeprecated: 'None',
      // Empty is LEGAL here - ShipCard.cs:146 skips the paperdoll load entirely when the layout
      // name is blank, which is what the two cruisers already rely on.
      PaperdollUiLayoutfile: '',
      /* PER-TIER WEAPON MOUNTS - 10 light (8 cannon + 2 launcher, Outposts.txt:37), 13 medium
       * (8 + 5, :38, corroborated by Dev Blog 15.txt:75-80 and both bsgonline infoboxes), 17 heavy
       * (8 cannon + 5 missile + 2 flak + 2 PD, :39). The prefabs carry exactly 10 / 13 real mounts
       * plus two origin placeholders, so the light/medium COUNTS are not guesses - two independent
       * sources agree. The large prefab has only 16 usable mounts, ONE SHORT of Heavy's 17: the
       * 5th missile launcher takes a hand-written 17th slot (SlotId = p.slots = 16) sharing the
       * extraMount missile mount's spot. Two slots on one spot passes the hash validator (each
       * slot's hash resolves to a real spot) and the server fires per SLOT (WeaponAction looks the
       * spot up by the slot's own hash), so both rounds leave the same muzzle; the second turret
       * model renders co-located - cosmetic. WHICH mount is which class IS geometry work, recorded
       * in the ShipConfigTemplate (204-207). As on the outpost, Slots are inert until that
       * template exists. */
      Slots: stationSlots(p.prefab, p.slots).concat(p.extraMount ? [{
        SlotId: p.slots,
        ObjectPoint: p.extraMount,
        ObjectPointServerHash: HARDPOINTS[p.prefab][p.extraMount].hash,
        SystemType: 'weapon',
        Level: 1,
      }] : []), CubitOnlyRepair: false,
      VariantHangarIDs: [], ParentHangarID: -1,
      // A platform is anchored by its template transform and never moves - but the factory still
      // calls createMovementController on it, and MovementSimulation DIVIDES by RollMaxSpeed.
      // Zero there is the `roll is NaN` bug that cost us an evening, so these are small non-zero
      // values rather than the honest zeroes. 1 m/s across the board: the validator requires
      // Speed > 0 too, and at 1 the platform is anchored in practice by its template transform.
      /* THE OVERRIDES GO AFTER flightStats(), NOT BEFORE IT - the outpost block above already
       * documents this rule, and this block was the live bug it was describing. flightStats returns
       * HullRecovery 5, so with the overrides as the FIRST Object.assign source the honest 0 was
       * silently overwritten and the emitted 08-world.json shipped HullRecovery 5 on both platforms.
       * Platforms.txt:1 - "Unlike ships, platforms do not recover any hull points lost in combat." An
       * armed platform that heals 5 hp/s between waves undoes a raid.
       * DradisRange is DECORATIVE: nothing in BSGOCore reads ObjectStat.DradisRange (grep returns
       * only the enum constant). Real aggro is autoAggroDistance 1200 in the sector template,
       * consumed by NpcBehaviourTemplates.java:38-42. Kept only so the card carries the figure. */
      Stats: stats(Object.assign({ MaxHullPoints: p.hp, MaxPowerPoints: p.pwr },
        flightStats({ speed: 1, boost: 1, accel: 1, pitch: 1, yaw: 1, roll: 1, strafe: 1 }),
        { PowerRecovery: 110, HullRecovery: 0, DradisRange: 1200 })),
      Faction: p.faction, ImmutableSlots: [], nextShipCardGuid: 0,
    }));
    // Ship.java:38 throws "MovementCard cannot be null" - EVERY Ship subclass needs one, whether
    // or not it can move, because the constructor dereferences it before anything checks speed.
    out.push(card(p.guid, 'Movement', {
      minYawSpeed: 0.1, maxPitch: 360.0, maxRoll: 80.0,
      pitchFading: 2.0, yawFading: 2.0, rollFading: 400.0,
    }));
    /* Client WeaponPlatform : CruiserShip : Ship, so Ship.LoadCards (Ship.cs:65-69) demands a
     * ShipLight card at the platform guid and puts it in AreCardsLoaded - without it the platform
     * never finishes constructing (isLoaded, SpaceObject.cs:390), exactly like an outpost, and the
     * only trace is "Card should not be send because it's null! <guid> 42" per client on the server
     * (CatalogueProtocol.java:76). This is why the two Tannhauser platforms have never rendered.
     * Tier must equal the Ship card's: the server reads ShipCard.getTier(), the client reads
     * ShipCardLight.Tier. The new Ship/ShipLight validator fails the build if they drift.
     * NOTE what this does NOT fix: the platform still has no system-map icon, because
     * GUISystemMap.cs:712 skips any CruiserShip/WeaponPlatform whose WorldCard.FrameIndex < 0 and the
     * platform World card ships frameIndex -1 (cards.js:1783). The tier switch at GUISystemMap.cs:1354
     * is on the TOOLTIP path (GetShipType's only caller is :536) and is unreachable while the icon is
     * skipped. Sector 10 has FOUR platform objects (two per guid) but only two distinct card guids. */
    out.push(card(p.guid, 'ShipLight', {
      ShipObjectKey: p.guid, Tier: p.tier,
      ShipRoles: ['Artillery'], ShipRoleDeprecated: 'None',
    }));
    // Price(23) for the same reason as the outposts above: fetched by the client's info UI,
    // empty BuyPrice = not for sale.
    out.push(card(p.guid, 'Price', {
      Category: 'Ship', ItemType: 'Ship', Tier: p.tier, Faction: p.faction,
      SortingNames: [], SortingWeight: 0,
      BuyPrice: price({}), UpgradePrice: price({}), SellPrice: price({}), CanBeSold: false,
    }));
    /* Same fix as the outposts above, and for the same reason - see that comment for the evidence.
     * The platforms take the faction-generic placeholder rather than the drydock art: a sentry
     * platform is a weapon emplacement, not a station, and cannot be docked at. Both names are
     * verified present in the client's resources.assets as standalone Texture2D assets. */
    out.push(card(p.guid, 'GUI', {
      key: p.loca, level: 1,
      guiAtlasTexturePath: 'GUI/Inventory/items_atlas', frameIndex: 0,
      guiIcon: '',
      guiAvatarSlotTexturePath: p.faction === 'Colonial'
        ? 'GUI/Slots/avatar_colonial_temp' : 'GUI/Slots/avatar_cylon_temp',
      guiTexturePath: '', args: [],
    }));
  });

  return out;
}

const ASTEROIDS = [
  57968050, 57968051, 57968052,
  57969586, 57969587, 57969588,
  57969842, 57969843, 57969844,
];

/* ================================================================ SCENERY EXPANSION
 *
 * The client ships 846 prefabs and upstream carded exactly 9 asteroids + 4 planetoids of them as
 * scenery, which is why every sector is the same grey rock field. These tables card the rest of
 * the usable dressing at fresh guids (collision-checked against the whole emitted catalogue by
 * the duplicate-guid rule) for emit-sector-templates.js to place. Two shapes, and only two:
 *
 *   ASTEROID-TYPE (5797xxxx): World+Owner+GUI, targetable, byte-for-byte the nine originals'
 *     card shape. The server gives every Asteroid a SphereCollider at template-radius x 0.9
 *     (SpaceObjectFactory.java:109) and rolls its resource from the sector's asteroidDesc - a
 *     rock that rolls nothing scans red, which is the game's own resourceless-rock convention
 *     (most of sector 10's rocks are empty). The World radius here is COSMETIC: the wire radius
 *     is the template's own (Asteroid.java:34-41), so 60/85/110 cycled just mirrors the originals.
 *
 *   DEBRIS-TYPE (61000xxx): World+Owner+GUI, targetable:false. ColliderTemplates are looked up
 *     by prefab name and none exists for any of these, so debris is fly-through dressing with no
 *     HP and no stats (DebrisPile sets HideStats). The wire scale comes from the template, not
 *     the World radius; radius is kept plausible anyway - wreck/chunk pieces borrow their parent
 *     hull's extent so anything that ever reads it (loot scatter, bounds) stays sane.
 *
 * Every prefab name below is verified against the client assetmap at build time (the World-prefab
 * rule in validate() fails the build on a miss) - a name the client cannot load silently renders
 * as the placeholder ship model (RootScript.cs:69-101), which on a "debris pile" would be a
 * ghost fleet. */

/* Asteroid-type scenery. GUI keys are level-aware loca stems, all verified in the bundle:
 * the plain rocks reuse the originals' enemy_stationary_silver_asteroid1-3 rotation; the event
 * rocks get their own family's real names (Golden / Silver / Spooky Green / Spooky Orange
 * Asteroid) - upstream flew these as AsteroidBot NPCs, we ship them as plain rocks for boss-lair
 * "vein" dressing. */
const SCENERY_ASTEROIDS = (() => {
  const out = [];
  const add = (guid, prefab, key) => out.push({ guid, prefab, key });
  // 57970001-11: the 11 members of the carded asteroid1-4_1-5 family upstream never used.
  // Same bundle (asteroid_rock) the nine originals already load, so zero new download risk.
  ['1_2', '1_3', '2_3', '2_4', '2_5', '3_1', '3_4', '3_5', '4_1', '4_2', '4_5']
    .forEach((s, i) => add(57970001 + i, 'asteroid' + s, 'enemy_stationary_silver_asteroid' + (i % 3 + 1)));
  // 57970021-35: colored deco asteroids (deco_asteroids_space bundle) - the palette variety the
  // original field lacks. Color-major so a palette picker can slice one color as a contiguous run.
  ['black', 'bluesteel', 'bright', 'dark', 'precious'].forEach((c, ci) =>
    [1, 2, 3].forEach(n => add(57970021 + ci * 3 + n - 1, `decoasteroid_${c}_${n}`,
      'enemy_stationary_silver_asteroid' + n)));
  // 57970041-49: deco rocks (deco_rocks bundle) - cluster/lair dressing.
  [1, 2, 3].forEach((n, ni) => ['a', 'b', 'c'].forEach((l, li) =>
    add(57970041 + ni * 3 + li, `deco_rock_${n}_${l}`, 'enemy_stationary_silver_asteroid' + (li + 1))));
  // 57970051-62: event rocks (asteroid_gold bundle).
  [['gold', 'golden'], ['silver', 'silver'], ['spookygreen', 'green'], ['spookyorange', 'orange']]
    .forEach(([p, k], pi) => [1, 2, 3].forEach(n =>
      add(57970051 + pi * 3 + n - 1, `asteroid${p}_${n}`, `enemy_stationary_${k}_asteroid${n}`)));
  return out;
})();

/* Debris-type scenery. The GUI key is load-bearing in a way no other type's is: DebrisPile.cs
 * :10-25 renders the GUI card's Name UNLESS it resolves to a raw "%$bgo." string, in which case
 * the client substitutes the localized "Debris Field". DEBRIS_FALLBACK_KEY exploits that on
 * purpose: bgo.common.debris_field exists in the bundle only as a BARE key (no .Name form), so
 * GUICard.Name misses, DebrisPile catches the miss, and the object reads "Debris Field" - the
 * spelling keeps the intent greppable against the loca dump. The GUI-key validator carves out
 * exactly this guid set for it; everything else still has to resolve.
 * Keys that DO resolve and fit are used instead: the two akh wrecks ("Lost Watchdog"/"Lost
 * Argus"), five scavenger-station parts ("ScavengerStation" - the un-carded parts borrow the
 * generic ring_segment key so the whole structure reads as one station), the cargo-parcel key
 * ("Container") for the loot-container props, and the two jump-beacon keys ("Colonial/Cylon Jump
 * Beacon", split three prefabs per faction so the emitter can landmark either side's corridor). */
const DEBRIS_FALLBACK_KEY = 'common.debris_field';
const DEBRIS_SCENERY = (() => {
  const out = [];
  const add = (guid, prefab, radius, key) =>
    out.push({ guid, prefab, radius, key: key || DEBRIS_FALLBACK_KEY });
  const donorRadius = donor => {
    const h = HULLS.find(x => x.prefab === donor);
    if (!h) throw new Error('DEBRIS_SCENERY: no HULLS donor "' + donor + '" for a wreck radius');
    return h.extent;
  };
  // 61000001-17: debris piles and rings (decor_debris_piles bundle + massive_debris_wall).
  for (let i = 1; i <= 5; i++) add(61000000 + i, 'debrispile' + i, 100);
  for (let i = 6; i <= 9; i++) add(61000000 + i, `debrispile${i}_nt`, 100);
  for (let i = 1; i <= 5; i++) add(61000009 + i, 'debrispile_cylon' + i, 100);
  add(61000015, 'debrisring', 100);
  add(61000016, 'debrisring_1', 100);
  add(61000017, 'massive_debris_wall', 300);
  /* 61000021-52: one wreck per hull, in that hull's own bundle. 32, not the 30 the guid plan
   * guessed: the scout wreck exists for BOTH factions (nobody flies the scout, but the wreck is
   * scenery), so the run extends two guids into the unallocated 61000053-60 gap. Order is
   * human-then-cylon, t1 {fighter,command,defender,merit,multi2,scout,stealth}, t2/t3
   * {fighter,command,defender,merit}, t4carrier. The scout borrows the t1fighter's extent -
   * there is no scout HULLS entry to donate one. */
  const wreckHulls = [];
  for (const f of ['human', 'cylon']) {
    ['fighter', 'command', 'defender', 'merit', 'multi2', 'scout', 'stealth']
      .forEach(t => wreckHulls.push(f + 't1' + t));
    for (const tier of [2, 3])
      ['fighter', 'command', 'defender', 'merit'].forEach(t => wreckHulls.push(f + 't' + tier + t));
    wreckHulls.push(f + 't4carrier');
  }
  wreckHulls.forEach((hull, i) => {
    const donor = hull.endsWith('t1scout') ? hull.replace('scout', 'fighter') : hull;
    const key = hull === 'humant1fighter' ? 'decoration_sm_akh_co_t1fighter_wreck'
              : hull === 'cylont1fighter' ? 'decoration_sm_akh_cy_t1fighter_wreck' : undefined;
    add(61000021 + i, hull + '_wreck', donorRadius(donor), key);
  });
  /* 61000061-87: broken-capital chunk sets, the graveyard set pieces. 27, not the 25 the plan
   * counted - its own enumeration lists 27 - so the run extends two guids into the unallocated
   * 61000088-90 gap. Radius donor is the capital the chunks came off, per set. */
  [
    ['helwreck01', 'cylont3command'],
    ['helwreck02_chunk1', 'cylont3command'], ['helwreck02_chunk2', 'cylont3command'],
    ['helwreck02_chunk3', 'cylont3command'], ['helwreck02_chunk4', 'cylont3command'],
    ['helwreck02_chunk5', 'cylont3command'], ['helwreck02_chunk6', 'cylont3command'],
    ['jormungwreck01', 'cylont3defender'],
    ['humandefendert3_jotuun_debris_b', 'humant3defender'],
    ['humandefendert3_jotuun_debris_engine', 'humant3defender'],
    ['humandefendert3_jotuun_debris_front', 'humant3defender'],
    ['humandefendert3_jotuun_debris_middle_b', 'humant3defender'],
    ['humandefendert3_jotuun_debris_middle_m', 'humant3defender'],
    ['humandefendert3_jotuun_debris_middle_t', 'humant3defender'],
    ['humant2defender_destroyed_a', 'humant2defender'],
    ['humant2defender_destroyed_a_antenna', 'humant2defender'],
    ['humant2defender_destroyed_a_arm', 'humant2defender'],
    ['humant2defender_destroyed_a_engine', 'humant2defender'],
    ['humant2defender_destroyed_b', 'humant2defender'],
    ['cylont2command_destroyed_a', 'cylont2command'],
    ['cylont2command_destroyed_a_fin', 'cylont2command'],
    ['cylont2command_destroyed_a_wing', 'cylont2command'],
    ['humanfightert2_scythe_debris_back', 'humant2fighter'],
    ['humanfightert2_scythe_debris_back_fin', 'humant2fighter'],
    ['humanfightert2_scythe_debris_front', 'humant2fighter'],
    ['humant2fighter_scythe_debris_b', 'humant2fighter'],
    ['raider_wreck1', 'cylont1fighter'],
  ].forEach(([p, donor], i) => add(61000061 + i, p, donorRadius(donor)));
  /* 61000091-105: scavenger station parts. The assetmap holds 15 (the plan guessed 16); five
   * carry their own loca key, the rest borrow ring_segment's so the assembled structure is one
   * "ScavengerStation" on every nameplate. */
  const PART_LOCA = new Set(['inner_ring', 'ring_segment', 'ring_segment_left',
                             'ring_segment_right', 'shaft_stack_medium_2']);
  ['deco', 'inner_ring', 'reactor', 'ring_arm', 'ring_segment', 'ring_segment_joint',
   'ring_segment_left', 'ring_segment_right', 'shaft_sphere_middle', 'shaft_sphere_top',
   'shaft_stack_long', 'shaft_stack_medium', 'shaft_stack_medium_2', 'shaft_stack_small',
   'shaft_stack_small_2',
  ].forEach((p, i) => add(61000091 + i, 'decoration_scavenger_station_' + p, 300,
    'decoration_scavenger_station_' + (PART_LOCA.has(p) ? p : 'ring_segment')));
  // 61000111-115: loot-container props (decor_loot bundle) - "Container" on the nameplate.
  for (let i = 1; i <= 5; i++) add(61000110 + i, 'item_container' + i, 30, 'sector_cargo_parcel_event');
  // 61000121-126: jump-beacon props. Cosmetic landmarks only - the real JumpBeacon type has no
  // server factory arm. Three named Colonial, three Cylon; the emitter picks by corridor side.
  [['ftl_jump_beacon_blue', 'jump_beacon_human'], ['ftl_jump_beacon_green', 'jump_beacon_cylon'],
   ['ftl_jump_beacon_red', 'jump_beacon_cylon'], ['jump_beacon_standard', 'jump_beacon_human'],
   ['jump_beacon_improved', 'jump_beacon_human'], ['jump_beacon_advanced', 'jump_beacon_cylon'],
  ].forEach(([p, k], i) => add(61000121 + i, p, 30, k));
  // 61000131-134: cracked-planet dressing. Radii are eyeballed off the model families - nothing
  // reads them for Debris, but a future Asteroid re-type would inherit something sane.
  add(61000131, 'planet_debrisring', 300);
  add(61000132, 'planet_rockbig', 150);
  add(61000133, 'planet_rocksmall', 60);
  add(61000134, 'planet_rocks_and_water', 300);
  return out;
})();
// The GUI-key validator's carve-out set: only these guids may carry the deliberate-miss key.
const DEBRIS_SCENERY_GUIDS = new Set(DEBRIS_SCENERY.map(d => d.guid));

function sectorObjectCards() {
  const out = [];

  CRUISERS.forEach(c => {
    out.push(card(c.guid, 'World', {
      prefabName: c.prefab, lodCount: 1, radius: c.radius,
      spots: [], systemMapTexutres: '',
      frameIndex: 0, secondaryFrameIndex: 0,
      targetable: true, showBracketWhenInRange: true, forceShowOnMap: true,
    }));
    out.push(card(c.guid, 'Owner', { IsDockable: true, DockRange: 1500.0, Level: 1 }));
    out.push(card(c.guid, 'GUI', {
      key: c.loca, level: 1,
      guiAtlasTexturePath: 'GUI/Inventory/items_atlas', frameIndex: 0,
      guiIcon: '', guiAvatarSlotTexturePath: 'GUI/Slots/' + c.prefab, guiTexturePath: '', args: [],
    }));
    out.push(card(c.guid, 'Ship', {
      ShipObjectKey: c.guid, Level: 1, MaxLevel: 1, LevelRequirement: 1,
      HangarID: 200 + c.guid, Durability: 1.0, Tier: 4,
      ShipRoles: ['Mothership'], ShipRoleDeprecated: 'Mothership',
      PaperdollUiLayoutfile: '',            // empty is safe; a WRONG name throws client-side
      Slots: [], CubitOnlyRepair: false,
      VariantHangarIDs: [], ParentHangarID: -1,
      Stats: stats(Object.assign({ MaxHullPoints: 500000, MaxPowerPoints: 1000 },
        flightStats({ speed: 20, boost: 25, accel: 5,
                      pitch: 6, yaw: 6, roll: 10, strafe: 4 }),
        // Overrides go AFTER flightStats() (see the platform block above), else its
        // HullRecovery 5 default ships. Scenery capitals do not regenerate hull.
        { HullRecovery: 0 })),
      Faction: c.faction, ImmutableSlots: [], nextShipCardGuid: 0,
    }));
    out.push(card(c.guid, 'Movement', {
      minYawSpeed: 0.05, maxPitch: 20.0, maxRoll: 10.0,
      pitchFading: 4.0, yawFading: 4.0, rollFading: 400.0,
    }));
    // Ship.LoadCards depends on a ShipLight card at the object guid - without it the cruiser
    // never finishes constructing client-side.
    out.push(card(c.guid, 'ShipLight', {
      ShipObjectKey: c.guid, Tier: 4,
      ShipRoles: ['Mothership'], ShipRoleDeprecated: 'Mothership',
    }));
  });

  ASTEROIDS.forEach((guid, i) => {
    // cycle the verified asteroid prefab family so fields aren't visually uniform
    const prefab = 'asteroid' + ((i % 4) + 1) + '_' + ((i % 5) + 1);
    out.push(card(guid, 'World', {
      prefabName: prefab, lodCount: 1, radius: 60.0 + (i % 3) * 25.0,
      spots: [], systemMapTexutres: '',
      frameIndex: 0, secondaryFrameIndex: 0,
      targetable: true, showBracketWhenInRange: true, forceShowOnMap: false,
    }));
    out.push(card(guid, 'Owner', { IsDockable: false, DockRange: 0.0, Level: 1 }));
    // The client fetches a GUI card by ownerGUID, which for an asteroid is its own guid, and
    // AreCardsLoaded depends on it. Without this the rock has no model, no bracket and no
    // dradis entry - which is exactly what makes a sector look empty.
    out.push(card(guid, 'GUI', {
      key: 'enemy_stationary_silver_asteroid' + ((i % 3) + 1), level: 1,
      guiAtlasTexturePath: 'GUI/Inventory/items_atlas', frameIndex: 0,
      guiIcon: '', guiAvatarSlotTexturePath: 'GUI/Slots/avatar_asteroid_temp', guiTexturePath: '', args: [],
    }));
  });

  // The expansion rocks: same three cards, same 60/85/110 rotation, same avatar - see the
  // SCENERY EXPANSION comment above for why the shape is copied rather than varied.
  SCENERY_ASTEROIDS.forEach((a, i) => {
    out.push(card(a.guid, 'World', {
      prefabName: a.prefab, lodCount: 1, radius: 60.0 + (i % 3) * 25.0,
      spots: [], systemMapTexutres: '',
      frameIndex: 0, secondaryFrameIndex: 0,
      targetable: true, showBracketWhenInRange: true, forceShowOnMap: false,
    }));
    out.push(card(a.guid, 'Owner', { IsDockable: false, DockRange: 0.0, Level: 1 }));
    out.push(card(a.guid, 'GUI', {
      key: a.key, level: 1,
      guiAtlasTexturePath: 'GUI/Inventory/items_atlas', frameIndex: 0,
      guiIcon: '', guiAvatarSlotTexturePath: 'GUI/Slots/avatar_asteroid_temp', guiTexturePath: '', args: [],
    }));
  });

  /* Debris scenery. targetable:false - no bracket, no red box, no DRADIS entry, and the
   * portrait/frame validator deliberately skips untargetable World cards, so the empty avatar is
   * fine. frameIndex -1 like the planetoids: the system map hides anything below zero, and 0
   * would claim atlas frame 0 and draw the wrong icon. */
  DEBRIS_SCENERY.forEach(d => {
    out.push(card(d.guid, 'World', {
      prefabName: d.prefab, lodCount: 1, radius: d.radius,
      spots: [], systemMapTexutres: '',
      frameIndex: -1, secondaryFrameIndex: -1,
      targetable: false, showBracketWhenInRange: false, forceShowOnMap: false,
    }));
    out.push(card(d.guid, 'Owner', { IsDockable: false, DockRange: 0.0, Level: 1 }));
    out.push(card(d.guid, 'GUI', {
      key: d.key, level: 1,
      guiAtlasTexturePath: 'GUI/Inventory/items_atlas', frameIndex: 0,
      guiIcon: '', guiAvatarSlotTexturePath: '', guiTexturePath: '', args: [],
    }));
  });

  return out;
}

/* ================================================================ BOOTSTRAP CARDS */
function bootstrapCards() {
  // Player.setupBasicHangar builds HangarShip serverID 1 from the STARTER guid, and the client
  // decides ownership by matching ShipCard.HangarID == ship.ServerID. The starter must therefore
  // BE the tier-1 entry in the list, or nothing is ever "owned" and the hangar's primary button
  // NREs. 50 / 74 stay authored (ShipConfigTemplates pin them for NPC spawns) but out of the
  // list, so they cannot shadow HangarID 1.
  /* The list is emitted in the CLIENT'S OWN QUEUE ORDER, not by HangarID.
   * ShipQueue builds ships[i] by iterating the list, but PeriodicUpdate then writes each icon into
   * ships[shipOrder.FindIndex(HangarID)]. When the two orders differ, ships[i].Name is taken from
   * one card while the icon and the click target come from another - so sorting the list to match
   * shipOrder makes i == FindIndex for every hull and the whole class of mismatch disappears.
   * 16 and 17 are spliced in only when a listed ship carries them, at those fixed positions.
   * Derived from HULLS so the list and the cards can never drift apart. */
  const listFor = f => {
    const mine = HULLS.filter(h => h.faction === f && !h.rentalOnly);
    const has = id => mine.some(h => h.hangar === id);
    const order = [1, 4, ...(has(16) ? [16] : []), 7, 11, ...(has(17) ? [17] : []),
                   2, 5, 8, 13, 3, 6, 9, 14, 15];
    const listed = mine.sort((a, b) => order.indexOf(a.hangar) - order.indexOf(b.hangar)).map(h => h.g);
    /* The rented flagships ride along at the END, after the queue-ordered hulls. They must be in
     * the list at all - a card the ShipList never names is a card the hangar can never show, and
     * that is exactly why a paid-for Pegasus was invisible - but they carry a ParentHangarID, so
     * ShipListCard.MoveVariants lifts them out of ShipCards into VariantShipCards before either
     * the hangar grid or the shop queue iterates it. Appending rather than splicing keeps
     * shipOrder aligned for every hull that IS queue-drawn. */
    return listed.concat(HULLS.filter(h => h.faction === f && h.rentalOnly).map(h => h.g));
  };
  const colonial = listFor('Colonial');
  const cylon = listFor('Cylon');

  // ShipListCard.write() indexes upgradeShipCardGuids[i] over shipCardGuids.length,
  // so the upgrade array must be at least as long. 0 = "no upgrade".
  const shipList = (guid, guids) => card(guid, 'ShipList', {
    shipCardGuids: guids,
    upgradeShipCardGuids: guids.slice(),   // NOT 0: FetchCard(0) is null and Flag.Depend NREs
  });

  /* Star Ids are NOT arbitrary: the client resolves each sector's display name from the Id via
   * its own localisation (SectorDesc.cs:68), so using the real BSGO ids gives real names for free.
   * CanJumpColonial / CanJumpCylon are server-only - MapStarDesc.java:44-56 writes eleven fields
   * and these two are not among them - and are the authoritative gate at GameProtocol.java:363-364.
   * The base-sector lockout is separate and unconditional: GalaxyMapCard.java:88-102 hardcodes
   * Colonial {0,49} and Cylon {6,50}, and GameProtocol.java:364 refuses any jump into the enemy's
   * pair regardless of these flags.
   *
   * StarFaction is Neutral on all 58 rows of victti's decompile and all 30 of the live-server dump,
   * and nothing in GalaxyMapSector.cs branches on it. Neutral everywhere matches every source.
   *
   * BEACON FLAGS SHIP FALSE, and they used to default TRUE. Both halves of the feature are dead:
   * GameProtocol.java:416-420 answers RequestJumpToBeacon with sendEzMsg("... is not
   * implemented!"), and `new SectorBeaconStateUpdate` appears zero times in the server, so
   * ColonialIsJumpBeacon can never become true client-side and the button can never render.
   * False is the honest value and it is what all 58 dump rows carry.
   *
   * GUIIndex must be 0, 1 or 2. GalaxyMapSector.cs:51-63 switches it to anim_star_big/_middle/
   * _small and otherwise leaves texturePath as string.Empty, which then goes into
   * new GuiAnimationSimple((Texture2D)ResourceLoader.Load("")) - so a bad value is an NRE in the
   * galaxy map, not merely a missing texture. */
  const star = (s) => ({
    Id: s.id, Position: V2(s.pos.x, s.pos.y),
    GUIIndex: s.gui,
    StarFaction: 'Neutral',
    ColonialThreatLevel: s.colThreat,
    CylonThreatLevel: s.cylThreat,
    SectorGUID: s.sectorGuid,
    CanColonialOutpost: s.colOutpost,
    CanCylonOutpost: s.cylOutpost,
    CanColonialJumpBeacon: false,
    CanCylonJumpBeacon: false,
    CanJumpColonial: s.colJump,
    CanJumpCylon: s.cylJump,
  });
  return [
    shipList(STATIC.shipListColonial, colonial),
    shipList(STATIC.shipListCylon, cylon),

    // ApplicationBootstrap calls Quarkus.asyncExit(-1) if this card is absent.
    // Start sectors are hardcoded server-side: Colonial 0, Cylon 6.
    card(STATIC.galaxyMap, 'GalaxyMap', {
      /* The map KEY must equal Id: SectorRegistry.java:62 reads mapStar.getValue().getId(), but
       * GalaxyMapCard.getStar(id) and GameProtocol both look the map up BY KEY, so a key that
       * disagrees with its own Id makes a star buildable and unjumpable at the same time.
       * Emitted in ascending id order because Gson hands the server a LinkedHashMap and
       * SectorRegistry iterates it in that order - so if a batch does fail, the last sector id
       * logged before the throw names the one missing its template.
       *
       * The VALUE's SectorGUID is the Sector CARD guid, NOT the sector id. Player.setFaction copies
       * it into the player's location and the client then fetches the Sector card at that guid -
       * passing the id here made it FetchCard(0) -> null -> NRE on the space loading screen
       * forever. This was the top blocker for undocking.
       *
       * Changing or removing a star is migration-safe: the locations table persists only
       * sector_id, and SqLiteProvider re-derives the guid from the star at load time, falling back
       * to getStarterSectorForFaction when the id is no longer a star. Lowering STAGE strands
       * nobody - it walks them home. */
      stars: Object.fromEntries(
        SECTORS.slice().sort((a, b) => a.id - b.id).map(s => [String(s.id), star(s)])),

      /* tiers is an RCP LADDER, not ship tiers. Galaxy.getMiningBonus (Galaxy.java:242-258) walks
       * it as thresholds: rcp < tiers[0] -> 0, else 5% x i for the band it lands in, else
       * 5% x tiers.length. RCP is fed by Galaxy.java:104 getRCPUpdate(100, 1) - 100 per sector
       * where your faction holds the outpost, +1 per mining ship in a sector. With the old
       * [1,2,3,4] a single mining ship pinned the bonus at its 20% ceiling forever. This ladder
       * puts the four 5% steps at one, three, six and ten fully-held outpost sectors.
       * BALANCE KNOB, NOT RECOVERED DATA - no source gives upstream's values. Written as uint16
       * (GalaxyMapCard.java:42-45), so each entry must be <= 65535. */
      tiers: [100, 300, 600, 1000],
      baseScalingMultiplier: 1,
      /* Keys are RCP DIFFERENCES, not sector ids, and values are integer percent.
       * Galaxy.getOpBonus (Galaxy.java:215-239) sorts the keys DESCENDING, takes the first whose
       * key <= |rcpMine - rcpTheirs|, multiplies by baseScalingMultiplier and negates it for
       * whoever is ahead: the underdog outpost-HP bonus. The old {0:1, 6:1, 10:1} made every delta
       * resolve to 1%, i.e. no bonus at all, because the keys were being written as sector ids.
       * This ladder tops out at the +-36% the wiki describes. Also a balance knob.
       * Both key and value go out as writeUInt32 (GalaxyMapCard.java:57-62), so no negatives here -
       * the sign is applied server-side. Keep baseScalingMultiplier at 1: Galaxy.java:233 does
       * `num5 *= (int) base`, so any fractional base truncates the whole bonus to 0. */
      sectorScalingMultiplier: { '0': 0, '100': 6, '300': 12, '600': 24, '1000': 36 },
    }),

    card(STATIC.global, 'Global', {
      // Cost per durability point. At 0.5 cubits the cubit route was an 8x premium over titanium
      // (1 cubit = 32 tylium = 16 titanium); 0.125 brings it to a 2x convenience premium. A
      // negative power of two so it survives any ceil/round on either side of the wire.
      TitaniumRepairCard: 1.0, CubitsRepairCard: 0.125,
      CapitalShipPrice: 0, UndockTimeout: 0.0,
      // NOT 0: the client fetches this guid and depends on the result, and FetchCard(0) is null
      // -> NRE inside Card.Load, so the Global card itself never finishes loading. Reward card 1
      // already exists. The three bonus keys are equally mandatory - the friend-invites UI
      // indexes 5/10/25 with no ContainsKey guard, so fixing only the guid trades the NRE for a
      // KeyNotFoundException.
      friendBonusRewardGuid: 1, specialFriendBonus: { 5: 1, 10: 1, 25: 1 },
    }),

    // AvatarCatalogue. The slot keys are NOT the AvatarItem enum names - the client uses short
    // lowercase tokens, and derives texture keys as "<item>_tex" and material keys as "<item>_".
    // Per AvatarInfo.Init the valid sets are:
    //   human  items: hair head suit beard glasses helmet | textures: faces_tex hands_tex
    //          materials: hair_ beard_
    //   cylon  items: head arms body legs                 | textures: (none)
    //          materials: head_ arms_ body_ legs_
    // Every one of these is indexed WITHOUT a ContainsKey guard, so a missing key throws.
    // An entry is required for every (race, sex) pair the UI can produce - human has a gender
    // selector, so female must exist or GetAvatarIndex returns -1 and the list is indexed with it.
    // Item values are the client's own documented defaults (AvatarSelector.GetDefault).
    card(STATIC.avatarCatalogue, 'AvatarCatalogue', {
      avatarIndexes: [
        { race: 'human', sex: 'male',
          items: humanItems('male'),
          // Real files from bundles avatar_male_faces / avatar_male_hands (10 of each).
          // Index 0 is the client's documented default so the out-of-the-box avatar is correct;
          // the rest exist so any higher index the UI asks for is in range.
          textures: {
            faces_tex: faceList('male'),
            hands_tex: handList('male'),
          },
          // Keyed on EVERY hair/beard mesh, not just the default: the client looks the material up
          // by the currently-selected mesh name, so a single key means every other choice renders
          // with an empty material. volume_beard_empty stays first - GetMaterialCount reads the
          // first entry's length for the colour-arrow count.
          materials: {
            hair_: Object.fromEntries(seq('male_hair_', 10, true).map(h => [h, hairMats(h)])),
            beard_: Object.assign({ volume_beard_empty: [''] },
              Object.fromEntries(BEARD_MESHES.map(b => [b, beardMats(b)]))),
          } },
        // Female mirrors the male structure. The STRUCTURE is what must be right - a wrong asset
        // name renders no mesh, whereas a missing key throws. These names follow the male
        // convention and are unverified.
        { race: 'human', sex: 'female',
          items: humanItems('female'),
          textures: {
            faces_tex: faceList('female'),
            hands_tex: handList('female'),
          },
          materials: {
            hair_: Object.fromEntries(seq('female_hair_', 10, true).map(h => [h, hairMats(h)])),
            beard_: Object.assign({ volume_beard_empty: [''] },
              Object.fromEntries(BEARD_MESHES.map(b => [b, beardMats(b)]))),
          } },
        { race: 'cylon', sex: 'centurion',
          items: {
            head: centurionParts('head'), arms: centurionParts('arms'),
            body: centurionParts('body'), legs: centurionParts('legs'),
          },
          textures: {},          // AvatarInfo defines no texture slots for cylon
          materials: {
            head_: { centurion_head_v1: centurionMats('centurion_head_v1'),
                     centurion_head_v2: centurionMats('centurion_head_v2') },
            arms_: { centurion_arms_v1: centurionMats('centurion_arms_v1'),
                     centurion_arms_v2: centurionMats('centurion_arms_v2') },
            body_: { centurion_body_v1: centurionMats('centurion_body_v1'),
                     centurion_body_v2: centurionMats('centurion_body_v2') },
            legs_: { centurion_legs_v1: centurionMats('centurion_legs_v1'),
                     centurion_legs_v2: centurionMats('centurion_legs_v2') },
          } },
      ],
    }),

    card(STATIC.stickerList, 'StickerList', {
      // Required in SPACE, not just the hangar: Ship.ReadBindings depends on it for EVERY ship
      // in the sector, so an absent card blocks all of them.
      // NOT empty: ShipCustomizationWindow indexes [0] with no length guard BEFORE it sets
      // ready=true, so an empty array throws every frame the Decals tab is open.
      StickersColonial: [{ ID: 0, Texture: '' }], StickersCylon: [{ ID: 0, Texture: '' }],
      /* Ancient needs its own array or every Ancient-faction model load throws client-side:
       * StickerListCard.GetSticker runs Array.Find over the per-faction array, logs
       * "There is no Stickers for this faction: Ancient" and dereferences the null anyway.
       * 181 throws in a single play session, one per drone that spawned. */
      StickersAncient: [{ ID: 0, Texture: '' }],
    }),

    // ShopProtocol.injectUser -> setupEventShop() -> ShipSystem.fromGUID(227) then (226),
    // each orElseThrow. This runs during login registration, so a missing card here is an
    // immediate post-grant disconnect. The testingMode guard around it is commented out
    // upstream, so it ALWAYS runs. These two are the paint systems.
    shipSystem(226, 'ship_paint'),
    shipSystem(227, 'ship_paint'),
    // Trap for later: PaperdollSlot.cs:57 maps ShipSlotType.ship_paint to
    // bgo.inflight_shop.paint_first_letter ("P"), NOT ship_paint_first_letter - verified missing.
    // ...and their GUI + Price views. ShopProtocol puts both into the EventShop container, so the
    // client resolves all three views for each; the server logs "should not be send" without them.
    // 'system_ship_paint' is NOT a real loca key - verified absent from all 17 120 bgo.* keys in
    // the decompressed locale.lang_en, at every lookup form. The EventShop rows printed the raw
    // %$bgo.system_ship_paint.Name% and GUICard.Description returned null. These two exist and are
    // faction-correct: "Artemis's Twilight" and "Eileithyia's Twilight".
    ...[226, 227].flatMap(g => [
      card(g, 'GUI', {
        key: PAINT_LOCA[g], level: 1,
        guiAtlasTexturePath: 'GUI/Inventory/items_atlas', frameIndex: 0,
        guiIcon: '', guiAvatarSlotTexturePath: '', guiTexturePath: '', args: [],
      }),
      card(g, 'Price', {
        Category: 'System', ItemType: 'ShipPaint', Tier: 1, Faction: 'Neutral',
        SortingNames: [], SortingWeight: 0,
        BuyPrice: price({}), UpgradePrice: price({}), SellPrice: price({}),
        CanBeSold: false,
      }),
    ]),
    // A ship_paint system fetches a ShipPaint card at its own guid and depends on it. The event
    // shop stocks both paints unconditionally and the client depends on EVERY item before
    // broadcasting, so one unloaded paint kills the whole EventShop reply.
    // model "default" reuses the ship's own World prefab, so this needs no new art.
    /* shipCardGuid names the hull the paint belongs to, and both of these named the wrong one. The
     * loca keys are ..._human_viper_mk3_... and ..._cylon_war_raider_mk2_..., but 2366349390 is
     * humant1fighter (Viper Mk II) and 1427261742 is cylont1fighter (the plain Raider). Repointed to
     * the hulls the keys name: 5016 humant1multi2 (Viper Mk III) and 5116 cylont1multi2 ('Cylon War'
     * Raider Mk II). This is the only gate on where an event paint can be worn - ItemList.cs:129
     * compares the active ship's guid against shipCardGuid and its NextCard - so before the repoint
     * the two skins fitted the wrong ship and could not be fitted to the right one. */
    card(226, 'ShipPaint', { model: 'default', paintTexture: '', shipCardGuid: 5016 }),
    card(227, 'ShipPaint', { model: 'default', paintTexture: '', shipCardGuid: 5116 }),

    // A brand-new player is routed to GameLocation.Starter, not Avatar. StarterLocation emits
    // NeutralRewardCard (guid 1) for both factions, and the client's StarterLevelProfile blocks
    // on it. RewardCard.Read chains a GUI card at the same guid and depends on both.
    card(1, 'Reward', {
      experience: 0, shipItems: [], action: 'None',
      packagedCubits: 0, packageName: 'starter',
      itemGroup: 0, colonialItems: [], cylonItems: [],
    }),
    card(1, 'GUI', {
      // MUST resolve to a key that HAS a .Description: the faction-select screen calls
      // .Replace() on it with no null guard, and a missing key yields null rather than "".
      // bgo.bonus_starter.* has zero entries; bonus_starter_mid exists with a description.
      key: 'bonus_starter_mid', level: 1,
      guiAtlasTexturePath: 'GUI/Inventory/items_atlas', frameIndex: 0,
      guiIcon: '', guiAvatarSlotTexturePath: '', guiTexturePath: '', args: [],
    }),

    // EventShop. ShopProtocol hardcodes guid 11133 and sends it unconditionally at login.
    // Without this card the client's TradeInWindowWidget calls List.AddRange(null) on
    // eventRessources and throws EVERY FRAME - which spams the log, destroys the framerate,
    // and aborts the mediator broadcast so the rest of the hangar UI is never built.
    // eventRessources are the event boxes ShopProtocol stocks into the EventShop container.
    card(11133, 'EventShop', {
      shopNameColonial: 'Event Shop', shopNameCylon: 'Event Shop',
      shopDescriptionColonial: 'Trade event items.', shopDescriptionCylon: 'Trade event items.',
      shopErrorMissingRessources: 'Not enough resources.',
      shopErrorCannotBuy: 'Cannot buy this item.',
      eventRessources: [11, 12, 13],
    }),
  ];
}

/* ================================================================ PROGRESSION */
const LOCA_KEYS = (() => {
  try {
    return new Set(fs.readFileSync(path.resolve(__dirname, 'loca-keys.txt'), 'utf8')
      .split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(Boolean));
  } catch { return null; }
})();

function loadCounterTypes() {
  const f = path.resolve(CORE_SRC, 'templates/cards/CounterCardType.java');
  const src = fs.readFileSync(f, 'utf8');
  const body = src.slice(src.indexOf('{') + 1);
  const out = [];
  for (const m of body.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*(0[xX][0-9a-fA-F]+|\d+)\s*\)/gm)) {
    out.push({ name: m[1], guid: m[2].toLowerCase().startsWith('0x') ? parseInt(m[2], 16) : Number(m[2]) });
  }
  if (!out.length) throw new Error('CounterCardType.java parsed to nothing - refusing to emit blind');
  return out;
}
const COUNTER_TYPES = loadCounterTypes();
const COUNTER_GUID = Object.fromEntries(COUNTER_TYPES.map(c => [c.name, c.guid]));
const TOKEN_GUID = 130920111;

function counterCards() {
  return COUNTER_TYPES.filter(c => c.guid !== TOKEN_GUID)
    .map(c => card(c.guid, 'Counter', { Name: c.name }));
}

const SKILL_ATLAS = 'GUI/SkillBuyPanel/skills_icons_all';
const SKILL_GUID_BASE = 900000000;
const SKILL_MAX_LEVEL = 5;
const PCT = 0.02;
const PCT_REGEN = 0.06;
const SKILL_PRICE = [0, 500, 1500, 3500, 7000, 12500];
const SKILL_TIME = [60, 300, 900, 2700, 7200, 14400];

function fnv1a32(s) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

const SKILLS = [
  { key: 'skill_cannon_optimal_range',    group: 'Weapon', icon: 27, up: { OptimalRange: PCT } },
  { key: 'skill_cannon_accuracy',         group: 'Weapon', icon: 21, req: 'skill_cannon_optimal_range', up: { Accuracy: PCT } },
  { key: 'skill_cannon_critical_offense', group: 'Weapon', icon: 24, req: 'skill_cannon_optimal_range', up: { CannonCriticalOffense: PCT } },
  { key: 'skill_missile_max_range',       group: 'Weapon', icon: 28, up: { MissileMaxRange: PCT } },
  { key: 'skill_missile_rate_of_fire',    group: 'Weapon', icon: 32, req: 'skill_missile_max_range', down: { MissileCooldown: PCT } },
  { key: 'skill_speed',                   group: 'Engine', icon: 25, up: { Speed: PCT } },
  { key: 'skill_acceleration',            group: 'Engine', icon: 1,  req: 'skill_speed', up: { Acceleration: PCT } },
  { key: 'skill_boost_speed',             group: 'Engine', icon: 23, req: 'skill_speed', up: { BoostSpeed: PCT } },
  { key: 'skill_turning_range',           group: 'Engine', icon: 26, up: { TurnSpeed: PCT } },
  { key: 'skill_ftl_range',               group: 'Engine', icon: 19, up: { FtlRange: PCT } },
  { key: 'skill_ftl_charge',              group: 'Engine', icon: 35, req: 'skill_ftl_range', down: { FtlCharge: PCT } },
  { key: 'skill_hp_recovery',             group: 'Hull', icon: 22, up: { HullRecovery: PCT_REGEN } },
  { key: 'skill_armor_penalty',           group: 'Hull', icon: 20, add: { CriticalDefense: 3 } },
  { key: 'skill_armor_turning_rate_penalty', group: 'Hull', icon: 3, req: 'skill_armor_penalty', up: { MaxHullPoints: PCT } },
  { key: 'skill_map_range',               group: 'Computer', icon: 12, up: { DetectionOuterRadius: PCT } },
  { key: 'skill_pp_recovery',             group: 'Computer', icon: 13, req: 'skill_map_range', up: { PowerRecovery: PCT_REGEN }, add: { MaxPowerPoints: 5 } },
  { key: 'skill_dradis_interference_reduction', group: 'Computer', icon: 34, up: { DetectionInnerRadius: PCT } },
  { key: 'skill_dradis_awareness',        group: 'Computer', icon: 40, req: 'skill_dradis_interference_reduction', add: { DetectionVisualRadius: 5 } },
];

function skillCards() {
  const out = [];
  const GROUP_SORT_BASE = { Weapon: 100, Engine: 200, Hull: 300, Computer: 400 };
  SKILLS.forEach((s, line) => {
    const hash = fnv1a32(s.key);
    const reqHash = s.req ? fnv1a32(s.req) : 0;
    const sortWeight = GROUP_SORT_BASE[s.group] + line;
    for (let lvl = 0; lvl <= SKILL_MAX_LEVEL; lvl++) {
      const guid = SKILL_GUID_BASE + line * 100 + lvl;
      const next = lvl === SKILL_MAX_LEVEL ? 0 : guid + 1;
      const mult = {};
      Object.entries(s.up || {}).forEach(([k, v]) => { if (lvl) mult[k] = +(1 + v * lvl).toFixed(4); });
      Object.entries(s.down || {}).forEach(([k, v]) => { if (lvl) mult[k] = +(1 - v * lvl).toFixed(4); });
      const flat = {};
      Object.entries(s.add || {}).forEach(([k, v]) => { if (lvl) flat[k] = v * lvl; });
      out.push(card(guid, 'Skill', {
        Level: lvl, MaxLevel: SKILL_MAX_LEVEL,
        nextSkillCardGuid: next, Hash: hash,
        TrainingTime: SKILL_TIME[lvl], Price: SKILL_PRICE[lvl],
        Group: s.group,
        StaticBuff: stats(flat), MultiplyBuff: stats(mult),
        RequireSkillHash: reqHash, SortWeight: sortWeight,
      }));
      out.push(card(guid, 'GUI', {
        key: s.key, level: lvl,
        guiAtlasTexturePath: SKILL_ATLAS, frameIndex: s.icon,
        guiIcon: '', guiAvatarSlotTexturePath: '', guiTexturePath: '', args: [],
      }));
    }
  });
  return out;
}

/* Room NPCs, keyed by the GameObject name the room prefab actually uses.
 *
 * The names are NOT guesses: each room scene carries a `camerabox_<name>` object per interactive
 * character (DialogCharacterInfo.FindCameraBox does the lookup by the same string RoomLevel used
 * to find the NPC), so the set of cameraboxes in a bundle IS the room's cast list. Read out of
 * the decompressed bundles:
 *   scene_human_cic     -> Apollo, Adama, Tyrol, Starbuck   (Apollo and Adama also have spotlights)
 *   scene_cylon_cic     -> Leoben, No1, No6, Sharon
 *   scene_human_outpost -> Officer
 *   scene_cylon_outpost -> Sharon
 * We shipped only Apollo and Leoben, so every other figure in those rooms was scenery: visible,
 * lit, and completely unclickable. In the Colonial CIC that meant clicking Admiral Adama - the
 * obvious "admiral" in the room - did nothing at all, and the outposts had nobody to talk to,
 * which is what made the flagship rental unreachable anywhere but the home CIC.
 *
 * A name with no matching child is not fatal: RoomLevel logs "Could not create NPC" and skips.
 * But every NPC listed here MUST have a GUI card at its guid - NPCArea.Update dereferences
 * npc.NPCGUICard on hover with no null guard. */
const NPC_GUI = {
  Apollo:   575838400,   // npc_apollo       Apollo
  Leoben:   575838401,   // npc_no2          Number Two 'Leoben'
  Adama:    575838402,   // npc_adama        Admiral Adama 'The Old Man'
  Tyrol:    575838403,   // npc_tyrol        SCPO Tyrol 'The Chief'
  Starbuck: 575838404,   // npc_starbuck     Starbuck
  No1:      575838405,   // npc_no1          Number One 'Cavil'
  No6:      575838406,   // npc_no6          Number Six 'Caprica'
  Sharon:   575838407,   // npc_no8          Number Eight 'Sharon'
  Officer:  575838408,   // npc_humanoutpost Outpost Quartermaster
};
const NPC_LOCA = {
  Apollo: 'npc_apollo', Leoben: 'npc_no2', Adama: 'npc_adama', Tyrol: 'npc_tyrol',
  Starbuck: 'npc_starbuck', No1: 'npc_no1', No6: 'npc_no6', Sharon: 'npc_no8',
  Officer: 'npc_humanoutpost',
};

const MISSIONS = [
  { id: 2001, guid: 575838305, rewardGuid: 575839305, faction: 'Colonial',
    file: 'colonial/2001_colonial_platform1.json',
    key: 'mission_colonial_squashing_the_bugs', level: 1,
    // Blacklist and counter both restored from the upstream template. I had rewritten this
    // mission to opposite_faction_killed because I had DELETED the weapons platforms it counts;
    // now the platforms are back, so the real objective is back. The blacklist is also evidence:
    // sectors 110, 111, 39, 20 and 27 are real ids we do not ship yet.
    /* Upstream's own ids first (0, 6, 110, 111, 39, 20, 27), then the space Colonials may not
     * enter. MissionDistributor.getSectorIdBasedOnTemplate (MissionDistributor.java:114-144) picks
     * from galaxyMapCard.getStars().keySet() filtered by blacklist and whitelist ONLY - there is
     * no faction filter in that method - so without these a Colonial pilot can be handed "kill 3
     * platforms in 103 Heleb", a system GameProtocol.java:364 refuses to let him enter, and the
     * mission is uncompletable with nothing explaining why. Validator V7 fails the build on it.
     * 5 103 Heleb, 12 Fenris, 13 101 Crucis are cylon_restricted; 50 47 Tartalon is the Cylon base
     * sector (GalaxyMapCard.java:100), barred unconditionally regardless of its jump flags. */
    sector: { staticSectorId: 0, useRandomSector: true,
              blacklist: [0, 6, 110, 111, 39, 20, 27, 5, 12, 13, 50], whitelist: [] },
    counters: { stationaries_killed: 3 },
    reward: { exp: 300, items: { [TYLIUM]: 2000 } } },
  { id: 2002, guid: 575838310, rewardGuid: 575839310, faction: 'Colonial',
    file: 'colonial/2002_colonial_mining.json',
    key: 'mission_colonial_mining_resources', level: 1,
    sector: { staticSectorId: 0, useRandomSector: false, blacklist: [], whitelist: [] },
    counters: { tylium_mined: 1500 },
    reward: { exp: 250, items: { [TIT]: 400 } } },
  { id: 2003, guid: 575838312, rewardGuid: 575839312, faction: 'Colonial',
    file: 'colonial/2003_colonial_patrol.json',
    key: 'mission_colonial_patrol_assignment', level: 2,
    sector: { staticSectorId: 10, useRandomSector: false, blacklist: [], whitelist: [] },
    counters: { pve_killed: 5 },
    reward: { exp: 500, items: { [TYLIUM]: 3000, [TIT]: 500 } } },
  { id: 1001, guid: 575838304, rewardGuid: 575839304, faction: 'Cylon',
    file: 'cylon/1001_cylon_platform1.json',
    key: 'mission_cylon_squashing_the_bugs', level: 1,
    // Restored from upstream, as above. Note the Cylon blacklist differs from the Colonial one in
    // its last two entries (47, 22 vs 20, 27) - the two factions are barred from different space.
    /* Upstream's own ids first (0, 6, 110, 111, 39, 47, 22), then the space Cylons may not enter -
     * see the note on the Colonial template above. 1 Beta Antini, 7 Tau Nehmet, 8 Epsilon Krau are
     * colonial_restricted; 49 Delta Canopis is the Colonial base sector (GalaxyMapCard.java:97). */
    sector: { staticSectorId: 0, useRandomSector: true,
              blacklist: [0, 6, 110, 111, 39, 47, 22, 1, 7, 8, 49], whitelist: [] },
    counters: { stationaries_killed: 3 },
    reward: { exp: 300, items: { [TYLIUM]: 2000 } } },
  { id: 1002, guid: 575838311, rewardGuid: 575839311, faction: 'Cylon',
    file: 'cylon/1002_cylon_mining.json',
    key: 'mission_cylon_mining_resources', level: 1,
    sector: { staticSectorId: 0, useRandomSector: false, blacklist: [], whitelist: [] },
    counters: { tylium_mined: 1500 },
    reward: { exp: 250, items: { [TIT]: 400 } } },
  { id: 1003, guid: 575838313, rewardGuid: 575839313, faction: 'Cylon',
    file: 'cylon/1003_cylon_patrol.json',
    key: 'mission_cylon_patrol_assignment', level: 2,
    sector: { staticSectorId: 10, useRandomSector: false, blacklist: [], whitelist: [] },
    counters: { pve_killed: 5 },
    reward: { exp: 500, items: { [TYLIUM]: 3000, [TIT]: 500 } } },
];

const missionGui = key => ({
  key, level: 1,
  guiAtlasTexturePath: 'GUI/Inventory/items_atlas', frameIndex: 0,
  guiIcon: '', guiAvatarSlotTexturePath: '', guiTexturePath: '', args: [],
});

function missionCards() {
  const out = [];
  for (const m of MISSIONS) {
    out.push(card(m.guid, 'Mission', {
      Level: m.level, LevelRequirement: m.levelRequirement || 0, LevelUpperLimit: 0,
      rewardCardGuid: m.rewardGuid, receiverGuiCardGuid: 0, Action: 'undefined',
    }));
    out.push(card(m.guid, 'GUI', missionGui(m.key)));
    out.push(card(m.rewardGuid, 'Reward', {
      experience: m.reward.exp,
      shipItems: Object.entries(m.reward.items)
        .map(([guid, count]) => ({ itemType: 'Countable', cardGuid: Number(guid), count })),
      action: 'None', packagedCubits: 0, packageName: 'assignment', itemGroup: 0,
      colonialItems: [], cylonItems: [],
    }));
    out.push(card(m.rewardGuid, 'GUI', missionGui(m.key)));
  }
  // One GUI card per room NPC: NPCArea.Update reads Name and Description off it for the hover
  // tooltip, with no null guard, so a listed NPC without one crashes the room on mouseover.
  for (const [npc, guid] of Object.entries(NPC_GUI)) out.push(card(guid, 'GUI', missionGui(NPC_LOCA[npc])));
  return out;
}

function emitMissionTemplates() {
  const root = path.join(CORE_ROOT, 'ServerConfigurationUtils/global/MissionTemplateConfiguration');
  const owned = new Set(MISSIONS.map(m => path.normalize(path.join(root, m.file))));
  const ourIds = new Set(MISSIONS.map(m => m.id));
  const walk = d => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(d, e.name))
                    : (e.name.endsWith('.json') ? [path.join(d, e.name)] : [])) : []);
  for (const f of walk(root)) {
    if (owned.has(path.normalize(f)) || f.includes('!')) continue;
    let arr;
    try { arr = JSON.parse(fs.readFileSync(f, 'utf8').replace(/\/\/[^\n]*/g, '')); } catch { continue; }
    for (const t of arr || []) {
      if (ourIds.has(t.id))
        throw new Error(`MissionTemplate id ${t.id} is also declared by ${f}`);
    }
  }
  /* Refuse to silently overwrite a template whose objective differs from ours.
   * This generator unconditionally rewrites the files it owns, and two of them (2001/1001) are
   * ALSO upstream data. A restore of the upstream versions therefore survived exactly until the
   * next `node cards.js`, which put our invented objective straight back with nothing logged -
   * the restore looked successful and was undone minutes later. Compare before writing, and make
   * a divergence a build failure rather than a silent revert. */
  for (const m of MISSIONS) {
    const p = path.join(root, m.file);
    if (fs.existsSync(p) && !process.env.CARDGEN_FORCE_MISSIONS) {
      try {
        const cur = JSON.parse(fs.readFileSync(p, 'utf8').replace(/\/\/[^\n]*/g, ''))[0] || {};
        const curCounter = ((cur.missionCountEntries || [])[0] || {}).guid;
        const ourCounter = COUNTER_GUID[Object.keys(m.counters)[0]];
        if (curCounter !== undefined && ourCounter !== undefined && curCounter !== ourCounter)
          throw new Error(
            `MissionTemplate ${m.id} (${m.file}): on disk it counts ${curCounter}, we would write ` +
            `${ourCounter}. Refusing to overwrite - if ours is right, re-run with ` +
            `CARDGEN_FORCE_MISSIONS=1; if the file is right, fix the MISSIONS table.`);
      } catch (e) {
        if (/Refusing to overwrite/.test(e.message)) throw e;   // our own guard, not a parse fail
      }
    }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify([{
      id: m.id, missionGuid: m.guid, faction: m.faction,
      missionSectorDesc: {
        staticSectorId: m.sector.staticSectorId,
        useRandomSector: m.sector.useRandomSector,
        sectorIdsBlacklist: m.sector.blacklist,
        sectorIdsWhitelist: m.sector.whitelist,
      },
      missionCountEntries: Object.entries(m.counters)
        .map(([name, needCount]) => ({ guid: COUNTER_GUID[name], needCount })),
    }], null, 2) + '\n', 'ascii');
  }
  return MISSIONS.length;
}

function progressionCards() {
  return [...counterCards(), ...skillCards(), ...missionCards()];
}

/* ================================================================ VALIDATION
 * Catches the failure modes that would otherwise surface as an opaque server-side NPE
 * or, worse, as a client that connects and then hangs forever with no error.
 */
/* Enum names used as JSON MAP KEYS are the nastiest failure mode in this whole pipeline.
 * Gson silently maps an unknown enum name to a NULL key; the writer then does
 * entry.getKey().value and NPEs - which the server catches by CLOSING THE CLIENT'S SOCKET.
 * The symptom is a mid-session disconnect with no client-side clue, so validate the names
 * against the server's own enum source rather than trusting them. */
const stripJavaComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/* Parse the CONSTANT LIST of a Java enum out of its source.
 *
 * The old version matched /^\s*NAME\s*\(/ line by line, which is only right for an enum whose
 * constants all take arguments and which has nothing else in it. It also swallowed the enum's own
 * constructor and any `this(...)` delegation, so ObjectStat.java parsed to 296 "constants" of which
 * three - ObjectStat, getMappings, this - are not constants at all. Nothing failed because those
 * extra names only ever made the check MORE permissive, but a validator that accepts
 * `stats: { this: 1 }` is not doing its job.
 *
 * A Java enum's constant list is everything from the opening brace up to the first `;` at brace and
 * paren depth zero (or the closing brace when the enum has no members at all, e.g. SkillGroup).
 * Splitting that on depth-zero commas gets both spellings - `MaxHullPoints(1)` and a bare `Weapon` -
 * with one parser, and cannot reach a method or a constructor because those live past the `;`. */
function enumConstants(src) {
  const s = stripJavaComments(src);
  const m = /\benum\s+\w+/.exec(s);
  if (!m) return null;
  const open = s.indexOf('{', m.index);
  if (open < 0) return null;
  const out = [];
  let depth = 0, cur = '';
  for (let i = open + 1; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '{' || ch === '[') { depth++; continue; }
    if (ch === ')' || ch === '}' || ch === ']') { if (depth === 0) break; depth--; continue; }
    if (depth > 0) continue;
    if (ch === ';') { out.push(cur); cur = ''; break; }
    if (ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  const names = new Set(out.map(t => (t.trim().match(/^[A-Za-z_]\w*/) || [])[0]).filter(Boolean));
  return names.size ? names : null;
}

function loadEnumNames(relPath) {
  try { return enumConstants(fs.readFileSync(path.resolve(CORE_SRC, relPath), 'utf8')); }
  catch { return null; }
}
const OBJECT_STATS = loadEnumNames('templates/utils/ObjectStat.java');

/* Every enum under templates/ and enums/, indexed by SIMPLE NAME - which is how the card classes
 * spell them, because they all import io.github.luigeneric.templates.utils.*. The card-field
 * validator below uses this to check any enum-typed field on any card, so a new card view or a new
 * enum-valued field is covered the day it lands rather than the day somebody remembers to add a
 * rule for it. First definition wins on a duplicate simple name; templates/ is scanned first
 * because that is where the card classes resolve from. */
const JAVA_ENUM_PROBLEMS = [];
const JAVA_ENUMS = (() => {
  const idx = new Map(), from = new Map();
  const walk = d => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.java')) continue;
      let src;
      try { src = fs.readFileSync(p, 'utf8'); } catch { continue; }
      const m = /\benum\s+(\w+)/.exec(stripJavaComments(src));
      if (!m) continue;
      const rel = path.relative(CORE_SRC, p).replace(/\\/g, '/');
      if (idx.has(m[1])) {
        /* Two enums with the same SIMPLE name: a card field naming that type would be checked
         * against whichever file was scanned first, which is a coin toss. Report it rather than
         * validate against the wrong constant set. */
        JAVA_ENUM_PROBLEMS.push(`enum "${m[1]}" is declared in both ${from.get(m[1])} and ${rel} - a card field of that type would be checked against whichever was scanned first`);
        continue;
      }
      const names = enumConstants(src);
      /* A file that says `enum X` and yields no constants means the parser broke, not that the
       * enum is empty. Left unreported it would silently turn every check on that type into a
       * no-op, which is the worst possible outcome for a validator. */
      if (!names) { JAVA_ENUM_PROBLEMS.push(`${rel} declares "enum ${m[1]}" but its constant list parsed to nothing - every check against that type would silently pass`); continue; }
      idx.set(m[1], names);
      from.set(m[1], rel);
    }
  };
  walk(path.join(CORE_SRC, 'templates'));
  walk(path.join(CORE_SRC, 'enums'));
  return idx.size ? idx : null;
})();

function validate(cards) {
  const errs = [];
  const seen = new Map();

  /* "Is there a card of view V at guid G?" is the single most-asked question in here, and the
   * ladder made it expensive: a linear scan per question was fine over 1,800 cards and is 80
   * million comparisons over 11,500. Index it once. */
  const viewsOf = new Map();
  cards.forEach(c => {
    let s = viewsOf.get(c.cardGUID);
    if (!s) viewsOf.set(c.cardGUID, s = new Set());
    s.add(c.cardView2);
  });
  const hasView = (guid, view) => { const s = viewsOf.get(guid); return !!s && s.has(view); };

  if (!OBJECT_STATS) {
    errs.push('could not read ObjectStat.java - cannot verify stat names (refusing to emit blind)');
  } else {
    const checkStats = (obj, at) => {
      if (!obj || !obj.stats) return;
      Object.keys(obj.stats).forEach(k => {
        if (!OBJECT_STATS.has(k))
          errs.push(`${at}: "${k}" is not an ObjectStat constant - Gson would make it a null map key and the server would drop the connection`);
      });
    };
    cards.forEach(c => {
      const at = `card guid=${c.cardGUID} view=${c.cardView2}`;
      // Every ObjectStats-typed field on every card type, not just Stats - an ability's
      // remote/toggle buffs are written the same way and fail the same way.
      ['Stats', 'StaticBuffs', 'MultiplyBuffs', 'StaticBuff', 'MultiplyBuff', 'ItemBuffAdd', 'ItemBuffMultiply',
       'RemoteBuffAdd', 'RemoteBuffMultiply', 'ToggleSystemAdd', 'ToggleSystemMultiply',
      ].forEach(k => checkStats(c[k], `${at} .${k}`));
    });
  }

  /* The StatView check that used to live here is gone: G17 below now checks EVERY enum-typed field
   * on every card view against the enum's own source, and ShipSystemCard.Views is one of them. */

  /* An equip that references a missing ability card sets the slot FIRST and then throws, after
   * the item has already left the hold - so the item silently vanishes. Catch it here instead. */
  cards.filter(c => c.cardView2 === 'ShipSystem').forEach(c => {
    (c.shipAbilityCards || []).forEach(ab => {
      if (!hasView(ab, 'ShipAbility'))
        errs.push(`ShipSystem ${c.cardGUID}: ability ${ab} has no ShipAbility card - equipping it destroys the item`);
      if (!hasView(ab, 'GUI'))
        errs.push(`ShipAbility ${ab}: no GUI card at the ability guid - the item never finishes loading`);
    });
    if (!hasView(c.cardGUID, 'Price'))
      errs.push(`ShipSystem ${c.cardGUID}: no Price card at its own guid - the item never finishes loading`);
    /* The server gate (ShipSystemCard.isObjectKeyRestrictionsBlocked) compares the hull's
     * ShipObjectKey, NOT the ship card guid. A restriction entry matching no emitted Ship's
     * ShipObjectKey can never pass, so the item is silently unequippable dead stock. */
    (c.ShipObjectKeyRestrictions || []).forEach(k => {
      if (!cards.some(x => x.cardView2 === 'Ship' && x.ShipObjectKey === k))
        errs.push(`ShipSystem ${c.cardGUID}: ShipObjectKeyRestrictions entry ${k} matches no emitted ` +
                  `Ship card's ShipObjectKey - the restriction can never pass and the item is unequippable`);
    });
  });

  /* A ship with no rotation/acceleration stats is not slow - it is BROKEN. MovementController
   * reads these with getStatOrDefault (0 when absent), the turn math divides by them, and the
   * sector's movement updater then throws "roll is NaN" every tick. The ship is invisible and
   * immovable, and the client reports nothing at all. */
  /* ---- A PROJECTILE NEEDS ALL SIX ROTATION STATS, AND MISSING ROLL IS A SECTOR-WIDE CRASH.
   * The missile action copies the ability's ItemBuffAdd wholesale onto the projectile and the
   * projectile then flies on the ordinary movement simulation, so an ability carrying Speed is a
   * flying object and needs a flying object's stats. MovementSimulation.moveToDirection:60 does
   *   RollAcceleration * (rollAngleError / maxRoll - rollSpeed * RollFading / RollMaxSpeed)
   * - a division by RollMaxSpeed. Absent is 0, the quotient is NaN, and the Euler3 constructor
   * throws "pitch is NaN" from inside SectorMovementUpdater: the sector's whole tick dies every
   * frame the missile is alive, and the only symptom is "Sector[N] single crash" in the log while
   * the game silently stops responding. Cost us exactly that on the first capital missile.
   * Keyed on Speed rather than on ActionType so a new projectile family cannot dodge it by
   * inventing an action name. */
  const PROJECTILE_ROT = ['YawMaxSpeed', 'YawAcceleration', 'PitchMaxSpeed', 'PitchAcceleration',
                          'RollMaxSpeed', 'RollAcceleration'];
  cards.filter(c => c.cardView2 === 'ShipAbility'
                 && c.ItemBuffAdd && c.ItemBuffAdd.stats && c.ItemBuffAdd.stats.Speed)
       .forEach(c => {
    const st = c.ItemBuffAdd.stats;
    PROJECTILE_ROT.forEach(k => {
      if (!(Number(st[k]) > 0))
        errs.push(`ShipAbility ${c.cardGUID}: carries Speed ${st.Speed} so it flies, but ${k} is `
          + `${st[k] === undefined ? 'absent' : st[k]} - MovementSimulation.moveToDirection divides by `
          + `RollMaxSpeed and the Euler3 constructor then throws "pitch is NaN" inside `
          + `SectorMovementUpdater, killing the whole sector's tick every frame the projectile lives`);
    });
    // LifeTime's timer re-throws every tick when unset, and MaxHullPoints auto-unboxes on spawn.
    ['LifeTime', 'MaxHullPoints'].forEach(k => {
      if (!(Number(st[k]) > 0))
        errs.push(`ShipAbility ${c.cardGUID}: carries Speed but ${k} is ${st[k] === undefined ? 'absent' : st[k]} - NPE on the first shot`);
    });
  });

  const FLIGHT_REQUIRED = ['Speed', 'Acceleration', 'PitchMaxSpeed', 'YawMaxSpeed',
                           'RollMaxSpeed', 'PitchAcceleration', 'YawAcceleration',
                           'RollAcceleration'];
  cards.filter(c => c.cardView2 === 'Ship').forEach(c => {
    const st = (c.Stats && c.Stats.stats) || {};
    FLIGHT_REQUIRED.forEach(k => {
      if (!(k in st))
        errs.push(`Ship ${c.cardGUID}: missing flight stat ${k} - defaults to 0, which NaNs the movement sim`);
      else if (!(Number(st[k]) > 0))
        errs.push(`Ship ${c.cardGUID}: flight stat ${k} is ${st[k]} - must be > 0`);
    });
  });

  /* A zero sensor radius puts every ship outside IsInMapRange: no bracket, nothing clickable,
   * no name tag, no DRADIS. In-game that is indistinguishable from "the NPC is broken". */
  const SENSOR_REQUIRED = ['DetectionInnerRadius', 'DetectionOuterRadius', 'DetectionVisualRadius'];
  cards.filter(c => c.cardView2 === 'Ship').forEach(c => {
    const st = (c.Stats && c.Stats.stats) || {};
    SENSOR_REQUIRED.forEach(k => {
      if (!(Number(st[k]) > 0))
        errs.push(`Ship ${c.cardGUID}: sensor stat ${k} is ${st[k] === undefined ? 'absent' : st[k]} - a zero radius puts the ship outside IsInMapRange, so no bracket, nothing clickable, no name tag and no DRADIS entry. Indistinguishable in game from a broken NPC.`);
    });
    /* Both of these pushed an EMPTY message, so the check fired and reported nothing: the build
     * failed on a blank line with no explanation of which ship or which stat. A validator whose
     * message is lost is worse than no validator, because it produces an unexplained red build.
     * The live-server dump gives the real scale here - DetectionVisual/Inner/Outer are 200/1000/2000
     * on a Viper, not the flat 1500/8000/9000 we invented - so the 10,000 ceiling is generous. */
    if (Number(st.DetectionOuterRadius) >= 10000)
      errs.push(`Ship ${c.cardGUID}: DetectionOuterRadius ${st.DetectionOuterRadius} is >= 10000. Real hulls sit around 2000 (dump), and an oversized radius subscribes the whole sector to this ship - which is what made Tannhauser unplayably laggy.`);
  });

  /* ===================================================== GALAXY VALIDATORS  V1-V6
   * REPLACES cards.js lines 2471-2512 (the whole "THE GALAXY MUST BE TRAVERSABLE AND AFFORDABLE"
   * block). That check compared the LONGEST STAR PAIR against FtlRange, which was right for a
   * three-star map where every hop is direct and is WRONG for a real galaxy: home to home is
   * 619.5 units and no hull will ever have that range. It fails the build the instant a fourth
   * star lands. Topology here is emergent, not declared - there is no adjacency list anywhere in
   * the wire format (MapStarDesc.java:14-38 is thirteen fields, none a neighbour list) - so the
   * right question is whether the graph induced by "distance <= FtlRange" CONNECTS, per faction,
   * over the stars that faction is allowed to enter.
   *
   * Every failure in here is silent or fatal at runtime and invisible in code review. Keep them
   * at build time.
   */
  {
    const gm = cards.find(c => c.cardView2 === 'GalaxyMap');
    const ships = cards.filter(c => c.cardView2 === 'Ship' && c.Stats && c.Stats.stats);
    if (gm && ships.length) {
      const stars = Object.values(gm.stars || {});
      const pos = s => s.Position || s.position;
      const D = (a, b) => Math.hypot(pos(a).x - pos(b).x, pos(a).y - pos(b).y);
      const withRange = ships.filter(s => s.Stats.stats.FtlRange);
      const minRange = Math.min(...withRange.map(s => s.Stats.stats.FtlRange));
      const maxCost = Math.max(...ships.map(s => s.Stats.stats.FtlCost || 0));

      /* ---- read every SectorTemplate once; V1, V2a, V3 and V5 all need it.
       * SectorFactory.java:102-106 matches templates by the sectorID INSIDE the file, so the
       * filename does not matter. Upstream's own files are Gson-lenient (sectorTemplate10 carries
       * 31 // comments and 18 unquoted `"faction": Colonial`), so strip both rather than trusting
       * them to be strict JSON. */
      const templates = (() => {
        try {
          const dir = path.join(CORE_ROOT, 'ServerConfigurationUtils/global/SectorTemplates');
          const out = new Map();
          for (const f of fs.readdirSync(dir)) {
            if (f.startsWith('!') || !f.endsWith('.json')) continue;   // upstream's disable convention
            const raw = fs.readFileSync(path.join(dir, f), 'utf8').replace(/^﻿/, '');
            const clean = raw.replace(/\/\/[^\n]*/g, '')
                             .replace(/("faction"\s*:\s*)([A-Za-z]\w*)/g, '$1"$2"');
            let t;
            try { t = JSON.parse(clean); }
            catch (e) { errs.push(`SectorTemplate ${f} does not parse: ${e.message} - the template reader takes the whole server down at boot`); continue; }
            if (typeof t.sectorID !== 'number') { errs.push(`SectorTemplate ${f} has no numeric sectorID - SectorFactory can never match it to a star`); continue; }
            if (out.has(t.sectorID))
              errs.push(`SectorTemplate sectorID ${t.sectorID} is declared twice (${out.get(t.sectorID).file} and ${f}) - SectorFactory.java:102-106 uses findAny(), so which one a sector gets is arbitrary`);
            out.set(t.sectorID, { file: f, t });
          }
          return out;
        } catch { return null; }
      })();

      /* ---- V2a  THE SECTORTEMPLATE MUST EXIST ON DISK.  Highest-value check in the file.
       * One aggregated error, not 55: at a high STAGE every missing template would otherwise print
       * the same paragraph and bury every other finding. */
      if (!templates) {
        errs.push('could not read ServerConfigurationUtils/global/SectorTemplates - refusing to bless the star list blind');
      } else {
        const missing = stars.filter(st => !templates.has(st.Id)).map(st => st.Id);
        if (missing.length)
          errs.push(`Galaxy: ${missing.length} star(s) have NO SectorTemplate with a matching sectorID on disk: [${missing.join(', ')}].\n`
            + `    This is NOT "a system you cannot visit". SectorRegistry.java:52-68 builds every star inside the bean\n`
            + `    constructor and SectorFactory.java:102-108 throws IllegalArgumentException("SectorTemplate is null\n`
            + `    inside sector creation!") out of it. Galaxy (@Singleton with @Scheduled(every="1s")), GameServer,\n`
            + `    ProtocolRegistry and GameProtocol all take SectorRegistry as a constructor dependency, so nothing\n`
            + `    that serves a player can be built either - and the exception message does not name the sector.\n`
            + `    Write the templates, or lower STAGE. Never ship a star ahead of its template.`);
      }

      // ---- V2b  the other three artifacts, which live in this file, plus the wire-format limits.
      stars.forEach(st => {
        const g = st.SectorGUID;
        const sec = cards.find(c => c.cardGUID === g && c.cardView2 === 'Sector');
        if (!sec)
          errs.push(`Galaxy star ${st.Id}: no Sector card at SectorGUID ${g} - SectorFactory.java:86-88 throws IllegalStateException out of the SectorRegistry constructor`);
        const gui = cards.find(c => c.cardGUID === g && c.cardView2 === 'GUI');
        if (!gui)
          errs.push(`Galaxy star ${st.Id}: no GUI card at SectorGUID ${g} - Catalogue.getSectorCardByID looks the Sector card up THROUGH the GUI card (Catalogue.java:190-203)`);
        else if (gui.key !== 'sector' + st.Id)
          errs.push(`Galaxy star ${st.Id}: GUI card at ${g} has key "${gui.key}", must be "sector${st.Id}" - Catalogue.java:194 matches on exactly that string`);
        if (sec && !cards.some(c => c.cardGUID === sec.regulationCardGuid && c.cardView2 === 'Regulation'))
          errs.push(`Galaxy star ${st.Id}: regulationCardGuid ${sec.regulationCardGuid} has no Regulation card - SectorFactory.java:90-93`);
        if (![0, 1, 2].includes(st.GUIIndex))
          errs.push(`Galaxy star ${st.Id}: GUIIndex ${st.GUIIndex} is not 0/1/2 - GalaxyMapSector.cs:51-63 leaves texturePath empty and then feeds it to ResourceLoader.Load, which NREs the galaxy map`);
        // writeInt16 (MapStarDesc.java:49-50)
        [['ColonialThreatLevel', st.ColonialThreatLevel], ['CylonThreatLevel', st.CylonThreatLevel]]
          .forEach(([k, v]) => {
            if (!(v >= -32768 && v <= 32767))
              errs.push(`Galaxy star ${st.Id}: ${k} ${v} does not fit the int16 MapStarDesc.java:49-50 writes`);
          });
        if (LOCA_KEYS && !LOCA_KEYS.has(`bgo.sector${st.Id}.name`))
          errs.push(`Galaxy star ${st.Id}: bgo.sector${st.Id}.Name is not in the client bundle - SectorDesc.cs:68 resolves the display name from the Id ALONE, so the galaxy map prints the raw %$bgo.sector${st.Id}.Name%`);
      });

      /* ---- V6  one GUI key per sector id, exactly once. Catalogue.java:192-195 takes findFirst()
       * over every GUI card in the catalogue, so a duplicate key silently binds a sector to the
       * wrong Sector card - wrong size, wrong skybox, wrong Regulation. */
      const keyCount = {};
      cards.filter(c => c.cardView2 === 'GUI' && /^sector\d+$/.test(c.key || ''))
           .forEach(c => { keyCount[c.key] = (keyCount[c.key] || 0) + 1; });
      Object.entries(keyCount).forEach(([k, n]) => {
        if (n > 1) errs.push(`GUI key "${k}" appears ${n} times - Catalogue.java:192-195 takes findFirst(), so which Sector card that sector gets is arbitrary`);
      });
      // and every sector GUI key must belong to a star, or it is a card nobody can reach
      Object.keys(keyCount).forEach(k => {
        const id = Number(k.slice(6));
        if (!stars.some(st => st.Id === id))
          console.warn(`GUI key "${k}" has no matching GalaxyMap star - the Sector card at that guid is unreachable dead weight`);
      });

      /* ---- V4  per-faction connectivity. GameProtocol.java:360-364 allows a jump when
       *   distance <= FtlRange  AND  starDestination.canJumpFaction(myFaction)
       *   AND NOT GalaxyMapCard.isBaseSector(invert(myFaction), destination)
       * so a faction may not even TRANSIT a star it cannot enter. BFS from its start sector
       * (GalaxyMapCard.java:78-86: Colonial 0, Cylon 6) over faction-legal nodes only. */
      const BASE = { Colonial: [0, 49], Cylon: [6, 50] };
      const byId = new Map(stars.map(s => [s.Id, s]));
      const legal = (s, f) => (f === 'Colonial' ? s.CanJumpColonial : s.CanJumpCylon)
                              && !BASE[f === 'Colonial' ? 'Cylon' : 'Colonial'].includes(s.Id);
      ['Colonial', 'Cylon'].forEach(f => {
        const home = f === 'Colonial' ? 0 : 6;
        if (!byId.has(home)) {
          errs.push(`Galaxy: no star at id ${home}, the hardcoded ${f} start sector (GalaxyMapCard.java:78-86). getStarterSectorForFaction returns null and Player.setFaction NREs on every new character`);
          return;
        }
        if (!legal(byId.get(home), f))
          errs.push(`Galaxy: star ${home} is the ${f} start sector but CanJump${f} is false - every ${f} character spawns somewhere it may not be`);
        const targets = stars.filter(s => legal(s, f));
        const seen = new Set([home]); const q = [home];
        while (q.length) {
          const cur = byId.get(q.shift());
          targets.forEach(o => { if (!seen.has(o.Id) && D(cur, o) <= minRange) { seen.add(o.Id); q.push(o.Id); } });
        }
        const un = targets.filter(s => !seen.has(s.Id)).map(s => s.Id);
        if (un.length)
          errs.push(`Galaxy: ${f} cannot reach star(s) [${un.join(', ')}] from its start sector ${home} at FtlRange ${minRange}. `
            + `Add an intermediate star or raise FtlRange - the client greys the tile out (GalaxyMapSector.cs:228-231) and the server answers sendJumpSectorNotAllowed, with no explanation either way`);
      });

      /* ---- V4b  affordability, and no isolated node. JumpTimer.java:104-106 charges
       * ceil(FtlCost * distance) in tylium, and the CLIENT additionally gates the whole map on
       * min(FtlRange, Hold.Tylium / FtlCost) (Me.cs:160; GalaxyMapSectorsLayout.cs:36 draws the
       * warp_limit circle from the same Min), so a pilot who cannot afford his NEAREST hop sees
       * every star grey out with no message at all. Price the worst nearest-neighbour hop - the
       * cheapest move anyone can be forced to make - against a quarter of the starting grant.
       * Read the grant rather than hardcoding it so the two cannot drift. */
      let grant = 25000;
      try {
        const props = fs.readFileSync(path.join(CORE_ROOT, 'src/main/resources/application.properties'), 'utf8');
        const m = /^gameserver\.starter-params\.start-tylium\s*=\s*(\d+)/m.exec(props);
        if (m) grant = Number(m[1]);
      } catch { /* fall back to the documented default */ }
      if (stars.length > 1) {
        const nn = stars.map(a => Math.min(...stars.filter(b => b !== a).map(b => D(a, b))));
        const worstNn = Math.max(...nn);
        if (worstNn > minRange)
          errs.push(`Galaxy: star ${stars[nn.indexOf(worstNn)].Id}'s nearest neighbour is ${worstNn.toFixed(1)} away but the weakest hull has FtlRange ${minRange} - it is an isolated node`);
        const hop = Math.ceil(maxCost * worstNn);
        if (hop > grant * 0.25)
          errs.push(`Galaxy: the worst nearest-neighbour hop costs ${hop} tylium at FtlCost ${maxCost} - ${(100 * hop / grant).toFixed(0)}% of the ${grant} starting grant. Below ${hop} tylium the client's warp circle shrinks inside the nearest star and the ENTIRE map greys out. FtlCost is charged PER UNIT DISTANCE (JumpTimer.java:104-106); the canonical value is 1`);
      }

      /* ---- V7  a random-sector mission may not land in space its own faction cannot enter.
       * MissionDistributor.getSectorIdBasedOnTemplate (MissionDistributor.java:114-144) picks the
       * sector from galaxyMapCard.getStars().keySet() filtered by the blacklist and whitelist
       * ONLY - there is no faction filter anywhere in that method. So the moment a
       * faction-restricted star joins the galaxy, a random-sector mission can hand a Colonial
       * pilot "kill 3 platforms in 103 Heleb", a system GameProtocol.java:364 will refuse to let
       * him enter. The mission is then uncompletable and nothing explains why.
       * This is the check that makes stage 6 (the six restricted systems) safe to land: it fails
       * the build until both blacklists are extended.
       * Upstream's own blacklists are independent evidence for the control groups, incidentally:
       * the Colonial template bars 20 and 27, both cylon_controlled; the Cylon template bars 22,
       * colonial_controlled, and 47, which SectorFactory.java:124-129 seeds with 3000 Colonial
       * outpost points. Each side is barred from the other's space, exactly as the wikis say. */
      MISSIONS.forEach(m => {
        const s = m.sector;
        if (s.staticSectorId !== 0 || !s.useRandomSector) return;
        const enemyBase = m.faction === 'Colonial' ? [6, 50] : [0, 49];
        const bad = stars
          .filter(st => !s.blacklist.includes(st.Id))
          .filter(st => !s.whitelist.length || s.whitelist.includes(st.Id))
          .filter(st => !(m.faction === 'Colonial' ? st.CanJumpColonial : st.CanJumpCylon)
                        || enemyBase.includes(st.Id))
          .map(st => st.Id);
        if (bad.length)
          errs.push(`MissionTemplate ${m.id} (${m.faction}) can roll sector(s) [${bad.join(', ')}], which that faction may not enter. MissionDistributor.java:132-141 filters by blacklist/whitelist only - it never checks CanJumpFaction - so the mission becomes uncompletable with no message. Add these ids to its blacklist.`);
      });

      if (templates) {
        /* ---- V1  a sector may not reference an object card that does not exist.
         * SpawnScheduler.update() (SpawnScheduler.java:24-31) has no try/catch, so a missing card
         * throws into Sector.run's catch (Exception) and TRUNCATES that sector's tick every cycle.
         * The only symptom is a repeating "Sector[N] single crash" line, and two call sites emit the
         * identical string "SpaceObjectFactory; could not find cards!" (SpaceObjectFactory.java:362
         * and :403), so the log cannot tell you which type failed. Hence a build-time check.
         *
         * Outpost is graded differently, because an Outpost entry can be present and inert.
         * Its spawn only ever runs when the OutpostSpawnTimer is registered - which needs BOTH
         * progress templates (SectorFactory.java:333) - AND either the star's CanOutpost flag for
         * that faction is true (via OutpostState.getDelta, which returns 0 outright when
         * canOutpost is false, OutpostState.java:80-92) or the sector is a base sector, where
         * OutpostSpawnTimer.java:42-56 spawns unconditionally without consulting OutpostState.
         * When the spawn cannot run, a missing card is a latent defect: warn. When it can run, it
         * is a per-tick exception: error. Note spawnOp catches ONLY IllegalStateException
         * (OutpostSpawnTimer.java:98-108), and a missing card throws IllegalArgumentException,
         * so it is NOT swallowed - it reaches Sector.run.
         * This grading is what keeps sector 10's two Outpost entries (guids 1450701610/1450701611,
         * which have World+Owner+GUI but no Ship/Movement yet) a warning today instead of a red
         * build, while making them a hard error the moment anyone flips sector 10's flag. */
        const NEED = {
          /* GUI is REQUIRED, not optional. Without it CatalogueProtocol logs
           * "Card should not be send because it's null! <guid> 1" and the client never finishes
           * constructing the object - so it is not drawn, while the server keeps it at its full
           * radius and still collides with it. An invisible wall, with no client-side error. */
          Planetoid:      ['World', 'Owner', 'GUI'],
          Outpost:        ['World', 'Owner', 'Ship', 'Movement'],
          WeaponPlatform: ['World', 'Owner', 'Ship', 'Movement'],
          Asteroid:       ['World', 'Owner', 'GUI'],
          Cruiser:        ['World', 'Owner', 'GUI'],
          MiningShip:     ['World', 'Owner', 'GUI'],
          /* Debris and Planet do NOT go through SpawnController - buildSectorSpaceObjects spawns
           * them directly at sector creation (SectorFactory.java:477-488), and createDebrisPile /
           * createPlanet still fetch World+Owner and throw on a miss (SpaceObjectFactory.java:205,
           * :285-289) - at BOOT, inside the SectorRegistry constructor, so a missing card here is
           * a server that never comes up rather than a truncated tick. GUI is the same client
           * rule as everything else: no GUI card, no construction, invisible object. */
          Debris:         ['World', 'Owner', 'GUI'],
          Planet:         ['World', 'Owner', 'GUI'],
        };
        const BASE_OWNER = { 0: 'Colonial', 49: 'Colonial', 6: 'Cylon', 50: 'Cylon' };
        const outpostSpawnIsLive = (sid, faction) => {
          const st = stars.find(s => s.Id === sid), e = templates.get(sid);
          if (!st || !e) return false;
          if (!(e.t.colonialProgressTemplate && e.t.cylonProgressTemplate)) return false;
          if (BASE_OWNER[sid] === faction) return true;
          return faction === 'Colonial' ? !!st.CanColonialOutpost : !!st.CanCylonOutpost;
        };
        const starIds = new Set(stars.map(s => s.Id));
        for (const [sid, { file, t }] of templates) {
          if (!starIds.has(sid)) continue;            // not shipped this stage; not our problem yet
          const seenPair = new Set();
          for (const o of (t.spaceObjectTemplates || [])) {
            const need = NEED[o.spaceEntityType];
            if (!need) continue;                      // anything else has no NEED row yet
            const soft = o.spaceEntityType === 'Outpost' && !outpostSpawnIsLive(sid, String(o.faction));
            for (const v of need) {
              const kk = `${o.objectGUID}|${v}`;
              if (seenPair.has(kk)) continue;
              seenPair.add(kk);
              if (!cards.some(c => c.cardGUID === o.objectGUID && c.cardView2 === v)) {
                const msg = `SectorTemplates/${file}: ${o.spaceEntityType} objectGUID ${o.objectGUID} has no ${v} card`;
                if (soft) console.warn(`${msg} - LATENT: its spawn cannot run yet (no CanOutpost flag / no progress templates). It becomes a per-tick exception in sector ${sid} the moment it can.`);
                else errs.push(`${msg} - the spawn throws IllegalArgumentException into Sector.run's catch and truncates sector ${sid}'s tick every cycle`);
              }
            }
          }

          /* ---- V3  nothing outside sector bounds. Client rule: SpaceLevel.cs:134
           * PlayerIsInEmptySpace => |pos.x| > GetSectorSize().x/2 || |pos.z| > GetSectorSize().y/2,
           * where GetSectorSize() is (Card.Width, Card.Length) (SpaceLevel.cs:130), and the player
           * gets %$bgo.etc.fly_too_far% (SpaceLevel.cs:597-601).
           * WARNING, not error, and here is why: sectors 0 and 6 each ship one upstream Asteroid,
           * guid 57969844, at z = 35980.51 - 3.6x their own half-length. It is pristine upstream
           * data and permanently unreachable. Promote this to errs.push once the two upstream files
           * are fixed or that rock is explicitly allowlisted. Do NOT widen a sector to hide it.
           * Corner order does not matter: BgoRandom.getRndBetween swaps when min > max, so an
           * unordered spawn box is legal. Only out-of-bounds is a defect. */
          const secCard = (() => {
            const st = stars.find(s => s.Id === sid);
            return st && cards.find(c => c.cardGUID === st.SectorGUID && c.cardView2 === 'Sector');
          })();
          if (secCard) {
            const hx = secCard.width / 2, hz = secCard.length / 2;
            const oob = [];
            for (const o of (t.spaceObjectTemplates || [])) {
              const p = o.position; if (!p) continue;
              if (Math.abs(p.x) > hx || Math.abs(p.z) > hz)
                oob.push(`${o.spaceEntityType} ${o.objectGUID} at (${p.x}, ${p.z})`);
            }
            for (const sa of (t.spawnAreaTemplates || []))
              for (const k of ['a', 'b'])
                if (sa[k] && (Math.abs(sa[k].x) > hx || Math.abs(sa[k].z) > hz))
                  oob.push(`spawnArea corner ${k} at (${sa[k].x}, ${sa[k].z})`);
            if (oob.length)
              console.warn(`SectorTemplates/${file}: ${oob.length} item(s) outside the sector's own ${secCard.width} x ${secCard.length} bounds - unreachable, and a player who follows one gets %$bgo.etc.fly_too_far%: ${oob.slice(0, 4).join('; ')}${oob.length > 4 ? ' ...' : ''}`);
          }
        }

        /* ---- V5  outpost prerequisites are consistent. A CanOutpost flag is a promise the
         * template has to keep, in two independent places:
         *   SectorFactory.java:333-336 registers the outpost timers ONLY when BOTH progress
         *     templates are non-null, so without them the flag never does anything;
         *   createOutpost filters spaceObjectTemplates for an Outpost entry of that faction and
         *     throws IllegalStateException into spawnOp's EMPTY catch (OutpostSpawnTimer.java:100-108)
         *     when there is none - silently, forever, with no log line.
         * The client meanwhile already draws the outpost marker from the flag alone
         * (GalaxyMapSector.cs:146-160), so a premature true is a visible lie. */
        stars.forEach(st => {
          /* Base sectors force-spawn regardless of the flag - OutpostSpawnTimer.java:42-56 never
           * consults OutpostState for {0,49}/{6,50} - so they are checked even with both flags
           * false. That is what makes stage 7 (ids 49 and 50) the one batch that cannot be
           * generated from the same recipe as the rest. */
          const baseOwner = { 0: 'Colonial', 49: 'Colonial', 6: 'Cylon', 50: 'Cylon' }[st.Id];
          if (!st.CanColonialOutpost && !st.CanCylonOutpost && !baseOwner) return;
          const e = templates.get(st.Id);
          if (!e) return;                             // V2a already reported it
          if (baseOwner && e.t.colonialProgressTemplate && e.t.cylonProgressTemplate) {
            const has = (e.t.spaceObjectTemplates || [])
              .some(o => o.spaceEntityType === 'Outpost' && String(o.faction) === baseOwner);
            if (!has)
              errs.push(`Galaxy star ${st.Id} is a ${baseOwner} BASE sector and SectorTemplates/${e.file} has both progress templates, so OutpostSpawnTimer.java:42-56 will call spawnOp(${baseOwner}) unconditionally - but the template has no ${baseOwner} Outpost entry. createOutpost throws IllegalStateException into spawnOp's empty catch: it fails silently, forever, with no log line. Either add the Outpost entry or drop the progress templates from this sector.`);
          }
          if (!st.CanColonialOutpost && !st.CanCylonOutpost) return;
          if (!e.t.colonialProgressTemplate || !e.t.cylonProgressTemplate)
            errs.push(`Galaxy star ${st.Id}: CanOutpost is true but SectorTemplates/${e.file} is missing ${!e.t.colonialProgressTemplate ? 'colonialProgressTemplate' : ''}${!e.t.colonialProgressTemplate && !e.t.cylonProgressTemplate ? ' and ' : ''}${!e.t.cylonProgressTemplate ? 'cylonProgressTemplate' : ''} - SectorFactory.java:333 never registers the outpost timers, so the flag is a lie the client still draws`);
          [['Colonial', st.CanColonialOutpost], ['Cylon', st.CanCylonOutpost]].forEach(([f, on]) => {
            if (!on) return;
            const has = (e.t.spaceObjectTemplates || [])
              .some(o => o.spaceEntityType === 'Outpost' && String(o.faction) === f);
            if (!has)
              errs.push(`Galaxy star ${st.Id}: Can${f}Outpost is true but SectorTemplates/${e.file} has no ${f} Outpost in spaceObjectTemplates - createOutpost throws IllegalStateException into spawnOp's empty catch and the outpost never appears, with no log line, forever`);
          });
        });
      }
    }
  }

  /* THE SHIP-SHOP QUEUE INVARIANT.
   * The queue sizes its array from the shop-listed ship count but indexes it by each ship's
   * position in a fixed HangarID order. If the shop-listed ids are not a PREFIX of that order it
   * indexes past the end - on a periodic update, so it throws every frame from the moment the
   * player enters the hangar. The symptom is unplayable lag, not an error message. */
  const shipCards = cards.filter(c => c.cardView2 === 'Ship');
  const priceOf = g => cards.find(x => x.cardGUID === g && x.cardView2 === 'Price');
  cards.filter(c => c.cardView2 === 'ShipList').forEach(sl => {
    // A ship only reaches the queue if it is BOTH in the ShipList and stocked by the shop.
    const listed = (sl.shipCardGuids || [])
      .map(g => ({ guid: g, ship: shipCards.find(s => s.cardGUID === g), pr: priceOf(g) }))
      .filter(e => e.ship && e.pr && Object.keys(e.pr.BuyPrice.items || {}).length > 0);
    const n = listed.length;
    // ShipQueue.InitIcons splices 16 and 17 in ONLY when a shop-listed ship carries them, at
    // fixed positions (after 4 and after 11 respectively). Model that exactly, or a legitimate
    // command-token hull looks like an error and a bogus one slips through.
    const has = id => listed.some(e => e.ship.HangarID === id);
    const QUEUE_ORDER = [1, 4, ...(has(16) ? [16] : []), 7, 11, ...(has(17) ? [17] : []),
                         2, 5, 8, 13, 3, 6, 9, 14, 15];
    listed.forEach(e => {
      const idx = QUEUE_ORDER.indexOf(e.ship.HangarID);
      if (idx === -1)
        errs.push(`ShipList ${sl.cardGUID}: ship ${e.guid} HangarID ${e.ship.HangarID} is not in the queue order - it would never render`);
      else if (idx >= n)
        errs.push(`ShipList ${sl.cardGUID}: ship ${e.guid} HangarID ${e.ship.HangarID} sits at queue index ${idx} but only ${n} ships are stocked - IndexOutOfRange every frame in the hangar`);
    });
    // The list order must EQUAL the client's queue order. ShipQueue builds ships[i] by iterating
    // the list but places each icon at shipOrder.FindIndex(HangarID); if those disagree, the label
    // on a queue slot comes from a different ship than its icon and click target.
    const listedOrder = listed.map(e => e.ship.HangarID);
    const wantOrder = QUEUE_ORDER.filter(id => listedOrder.includes(id));
    if (JSON.stringify(listedOrder) !== JSON.stringify(wantOrder))
      errs.push(`ShipList ${sl.cardGUID}: order ${JSON.stringify(listedOrder)} does not match the client's queue order ${JSON.stringify(wantOrder)} - ships[i] and shipOrder[i] would disagree`);

    // Icon art only exists for these ids; anything else renders a blank tile.
    const ICONS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 14, 15, 16, 17]);
    listed.forEach(e => {
      if (!ICONS.has(e.ship.HangarID))
        errs.push(`Ship ${e.guid}: HangarID ${e.ship.HangarID} has no icon texture - blank tile in the hangar`);
    });
  });

  /* Regulation's two maps are indexed by the same keyset, unguarded. */
  cards.filter(c => c.cardView2 === 'Regulation').forEach(c => {
    const rel = Object.keys(c.abilityTargetRelations || {});
    const groups = new Set(cards.filter(x => x.cardView2 === 'ShipAbility')
      .map(x => String(x.AbilityGroupId)));
    [...groups].forEach(g => {
      if (!rel.includes(g))
        errs.push(`Regulation ${c.cardGUID}: no entry for AbilityGroupId ${g} - KeyNotFoundException on the first target check`);
    });
  });
  const isAscii = s => typeof s !== 'string' || /^[\x00-\x7F]*$/.test(s);

  const walkStrings = (o, at) => {
    if (o === null || o === undefined) return;
    if (typeof o === 'string') { if (!isAscii(o)) errs.push(`non-ASCII string at ${at}: ${JSON.stringify(o)}`); return; }
    if (Array.isArray(o)) return o.forEach((v, i) => walkStrings(v, `${at}[${i}]`));
    if (typeof o === 'object') return Object.entries(o).forEach(([k, v]) => walkStrings(v, `${at}.${k}`));
  };

  cards.forEach((c, i) => {
    const at = `card[${i}] guid=${c.cardGUID} view=${c.cardView2}`;
    if (typeof c.cardGUID !== 'number') errs.push(`${at}: missing/!number cardGUID`);
    if (typeof c.cardView !== 'number') errs.push(`${at}: cardView must be the INT`);
    if (typeof c.cardView2 !== 'string') errs.push(`${at}: cardView2 must be the STRING enum name`);
    if (VIEW[c.cardView2] === undefined) errs.push(`${at}: unknown cardView2 - aborts the whole catalogue load`);
    else if (VIEW[c.cardView2] !== c.cardView) errs.push(`${at}: cardView/cardView2 disagree (${c.cardView} vs ${VIEW[c.cardView2]})`);
    if (c.cardGUID < 0 || c.cardGUID > 4294967295) errs.push(`${at}: guid outside uint32`);

    const key = `${c.cardGUID}|${c.cardView}`;
    if (seen.has(key)) errs.push(`${at}: DUPLICATE (guid,view) - last write wins, merge order is unstable`);
    seen.set(key, true);
    walkStrings(c, at);
  });

  // ShipCard.Read fetches World + GUI by its OWN guid and blocks forever if they never arrive.
  cards.filter(c => c.cardView2 === 'Ship').forEach(c => {
    ['World', 'GUI'].forEach(v => {
      if (!seen.has(`${c.cardGUID}|${VIEW[v]}`))
        errs.push(`Ship ${c.cardGUID}: no ${v} card at the same guid - the client will hang on load`);
    });
    if (c.HangarID === -1) errs.push(`Ship ${c.cardGUID}: HangarID -1 makes the card unsendable`);
  });

  // Regulation writes by iterating one map and indexing the other unguarded.
  cards.filter(c => c.cardView2 === 'Regulation').forEach(c => {
    const a = Object.keys(c.abilityTargetRelations || {});
    const b = new Set(Object.keys(c.abilityTargetTypes || {}));
    a.filter(k => !b.has(k)).forEach(k =>
      errs.push(`Regulation ${c.cardGUID}: key ${k} missing from abilityTargetTypes - NPE on write`));
  });

  cards.filter(c => c.cardView2 === 'ShipList').forEach(c => {
    if ((c.upgradeShipCardGuids || []).length < (c.shipCardGuids || []).length)
      errs.push(`ShipList ${c.cardGUID}: upgradeShipCardGuids shorter than shipCardGuids - AIOOBE on write`);
  });

  [STATIC.galaxyMap, STATIC.shipListColonial, STATIC.shipListCylon].forEach(g => {
    if (![...seen.keys()].some(k => k.startsWith(g + '|')))
      errs.push(`MISSING boot-mandatory card guid ${g}`);
  });


  /* ---------------------------------------------------------------- PROGRESSION */
  {
    const hasCard = (g, v) => seen.has(`${g}|${VIEW[v]}`);

    // ---- COUNTERS
    cards.filter(c => c.cardView2 === 'Counter').forEach(c => {
      if (typeof c.Name !== 'string' || !c.Name)
        errs.push(`Counter ${c.cardGUID}: Name missing - writeString(null) NPEs and drops the socket`);
      if (c.cardGUID === TOKEN_GUID)
        errs.push(`Counter ${c.cardGUID} is ResourceType.Token - Counters logs "Critical" on init`);
      if (COUNTER_GUID[c.Name] !== c.cardGUID)
        errs.push(`Counter ${c.cardGUID}: Name "${c.Name}" does not match CounterCardType - no server code can increment it`);
    });

    // ---- SKILLS
    const SKILL_GROUPS = loadEnumNames('templates/utils/SkillGroup.java');
    if (!SKILL_GROUPS) errs.push('could not read SkillGroup.java - refusing to emit blind');
    const skills = cards.filter(c => c.cardView2 === 'Skill');
    const byGuid = new Map(skills.map(c => [c.cardGUID, c]));
    const lines = new Map();

    skills.forEach(c => {
      if (!lines.has(c.Hash)) lines.set(c.Hash, []);
      lines.get(c.Hash).push(c);
      if (SKILL_GROUPS && !SKILL_GROUPS.has(c.Group))
        errs.push(`Skill ${c.cardGUID}: Group "${c.Group}" is not a SkillGroup constant - null enum, NPE on write, socket closed`);
      if (!hasCard(c.cardGUID, 'GUI'))
        errs.push(`Skill ${c.cardGUID}: no GUI card at the same guid - the skill row never finishes loading`);
      if (!(c.Hash > 0 && c.Hash <= 4294967295))
        errs.push(`Skill ${c.cardGUID}: Hash ${c.Hash} outside uint32 or zero`);
      if (!(c.SortWeight >= 0 && c.SortWeight <= 65535))
        errs.push(`Skill ${c.cardGUID}: SortWeight ${c.SortWeight} outside uint16 - writeUInt16 truncates`);
      [['Level', c.Level], ['MaxLevel', c.MaxLevel]].forEach(([n, v]) => {
        if (!Number.isInteger(v) || v < 0 || v > 255)
          errs.push(`Skill ${c.cardGUID}: ${n} ${v} does not survive writeByte/ReadByte (0..255)`);
      });
      if (c.nextSkillCardGuid !== 0 && !byGuid.has(c.nextSkillCardGuid))
        errs.push(`Skill ${c.cardGUID}: nextSkillCardGuid ${c.nextSkillCardGuid} has no Skill card - the client hangs on IsLoaded.Depend AND upgradeSkill charges XP for nothing`);
      if ((c.nextSkillCardGuid === 0) !== (c.Level === c.MaxLevel))
        errs.push(`Skill ${c.cardGUID}: chain end (next=${c.nextSkillCardGuid}) disagrees with Level ${c.Level}/MaxLevel ${c.MaxLevel}`);
      if (c.Level === 0 && c.Price !== 0)
        errs.push(`Skill ${c.cardGUID}: level-0 card must have Price 0 - it is never charged`);
      if (c.Level >= 1 && !(c.Price > 0))
        errs.push(`Skill ${c.cardGUID}: Price ${c.Price} at level ${c.Level} - upgradePrice() reads THIS card's price, so the upgrade is free`);
      if (!(c.TrainingTime > 0))
        errs.push(`Skill ${c.cardGUID}: TrainingTime ${c.TrainingTime} - Container.PeriodicUpdate divides by it, NaN progress bar`);
    });

    const allHashes = new Set(skills.map(c => c.Hash));
    const weightOfLine = new Map();
    lines.forEach((chain, hash) => {
      const zero = chain.filter(c => c.Level === 0);
      if (zero.length !== 1)
        errs.push(`Skill line ${hash}: ${zero.length} level-0 cards - setupStarterSkills needs exactly 1`);
      const levels = chain.map(c => c.Level).sort((a, b) => a - b);
      if (levels.some((l, i) => l !== i))
        errs.push(`Skill line ${hash}: levels are ${levels.join(',')} - must be a gapless 0..MaxLevel run`);
      ['Group', 'SortWeight', 'MaxLevel'].forEach(f => {
        if (new Set(chain.map(c => c[f])).size !== 1)
          errs.push(`Skill line ${hash}: mixed ${f} across levels`);
      });
      chain.forEach(c => {
        if (c.RequireSkillHash !== 0 && !allHashes.has(c.RequireSkillHash))
          errs.push(`Skill ${c.cardGUID}: RequireSkillHash ${c.RequireSkillHash} matches no skill line - Me.GetSkillLevel returns -1, permanently unbuyable`);
        if (c.RequireSkillHash === c.Hash)
          errs.push(`Skill ${c.cardGUID}: requires itself`);
      });
      const w = chain[0].SortWeight;
      if (weightOfLine.has(w))
        errs.push(`Skill line ${hash}: SortWeight ${w} already used by line ${weightOfLine.get(w)} - List<T>.Sort is unstable and rows swap under Container's captured index`);
      weightOfLine.set(w, hash);
    });

    // SkillBook.mapToObjectStats SETS these per group; two owners means HashMap order decides.
    const RACY = {
      Weapon: ['CannonCriticalOffense', 'OptimalRange', 'Accuracy', 'MiningCooldown', 'DamageMining',
               'MiningAccuracy', 'MiningArmorPiercing', 'MissileCriticalOffense', 'MissileCooldown',
               'MissileMaxRange'],
      Hull: ['RestorePowerPointCost', 'RestoreCooldown'],
      Computer: ['BuffPowerPointCost', 'BuffDuration', 'BuffMaxRange', 'DebuffPowerPointCost', 'DebuffCooldown'],
      Engine: ['ManeuverCooldown', 'BuffPowerPointCost'],
    };
    Object.entries(RACY).forEach(([grp, keys]) => keys.forEach(k => {
      const owners = new Set(skills
        .filter(c => c.Group === grp && ((c.MultiplyBuff || {}).stats || {})[k] !== undefined)
        .map(c => c.Hash));
      if (owners.size > 1)
        errs.push(`SkillGroup ${grp}: ${owners.size} lines carry MultiplyBuff.${k} - mapToObjectStats SETS it, HashMap order decides`);
    }));

    // Dead-buff check. applyStatsAddTo / getStatsMultiplyBonus only touch keys the ship map has.
    const SHIP_STAT_KEYS = new Set();
    const SHIP_STAT_ZERO = new Set();
    cards.filter(c => c.cardView2 === 'Ship').forEach(c =>
      Object.entries((c.Stats && c.Stats.stats) || {}).forEach(([k, v]) => {
        SHIP_STAT_KEYS.add(k);
        if (v !== 0) SHIP_STAT_ZERO.add(k);
      }));
    const EXPANDS = { TurnSpeed: ['PitchMaxSpeed', 'YawMaxSpeed'], TurnAcceleration: ['PitchAcceleration', 'YawAcceleration'] };
    skills.forEach(c => {
      const routed = new Set(RACY[c.Group] || []);
      Object.keys((c.MultiplyBuff || {}).stats || {}).forEach(k => {
        if (routed.has(k)) return;
        const targets = EXPANDS[k] || [k];
        if (!targets.every(t => SHIP_STAT_KEYS.has(t)))
          errs.push(`Skill ${c.cardGUID}: MultiplyBuff.${k} hits no ship stat (${targets.join('+')} absent from every Ship card) and is not ability-routed for group ${c.Group} - cosmetic`);
        else if (!targets.every(t => SHIP_STAT_ZERO.has(t)))
          errs.push(`Skill ${c.cardGUID}: MultiplyBuff.${k} targets a stat whose base is 0 on some Ship card - base*m - base == 0, so the buff is a no-op there`);
      });
      Object.keys((c.StaticBuff || {}).stats || {}).forEach(k => {
        if (EXPANDS[k])
          errs.push(`Skill ${c.cardGUID}: StaticBuff.${k} is dropped - applySkills calls applyStatsAddTo directly, mapObjectStats runs on the multiply path only`);
        else if (!SHIP_STAT_KEYS.has(k))
          errs.push(`Skill ${c.cardGUID}: StaticBuff.${k} hits no ship stat - cosmetic`);
      });
    });

    /* DRADIS-CHEAT HEADROOM. SendDradisDataHandler.java:31 logs a "Dradis-Cheat!" warning for
     * every DetectionOuterRadius >= 10000 the client reports, on the client's own dradis timer.
     * A fully-trained skill_map_range multiplies the ship's base, so the BUFFED value is what
     * must stay under the ceiling - otherwise every maxed player spams the one log we diagnose
     * from. Not fatal, but it would bury every other warning. */
    {
      const DRADIS_CEIL = 10000;
      let maxMult = 1;
      skills.forEach(c => {
        const m = ((c.MultiplyBuff || {}).stats || {}).DetectionOuterRadius;
        if (m !== undefined && m > maxMult) maxMult = m;
      });
      let maxFlat = 0;
      skills.forEach(c => {
        const a = ((c.StaticBuff || {}).stats || {}).DetectionOuterRadius;
        if (a !== undefined && a > maxFlat) maxFlat = a;
      });
      cards.filter(c => c.cardView2 === 'Ship').forEach(c => {
        const base = ((c.Stats && c.Stats.stats) || {}).DetectionOuterRadius;
        if (base === undefined) return;
        const buffed = base * maxMult + maxFlat;
        if (buffed >= DRADIS_CEIL)
          errs.push(`Ship ${c.cardGUID}: DetectionOuterRadius ${base} buffs to ${buffed} at max skill, ` +
                    `>= the ${DRADIS_CEIL} "Dradis-Cheat!" warning in SendDradisDataHandler - lower the base or the skill step`);
      });
    }

    // ---- MISSIONS
    cards.filter(c => c.cardView2 === 'Mission').forEach(c => {
      if (!hasCard(c.cardGUID, 'GUI'))
        errs.push(`Mission ${c.cardGUID}: no GUI card at the same guid - Mission.Read depends on it forever`);
      if (typeof c.Action !== 'string')
        errs.push(`Mission ${c.cardGUID}: Action must be a string ("undefined" when unused) - null NPEs the writer`);
      if (!hasCard(c.rewardCardGuid, 'Reward'))
        errs.push(`Mission ${c.cardGUID}: rewardCardGuid ${c.rewardCardGuid} has no Reward card`);
      if (!hasCard(c.rewardCardGuid, 'GUI'))
        errs.push(`Mission ${c.cardGUID}: reward ${c.rewardCardGuid} has no GUI card at its own guid - RewardCard.Read depends on it`);
    });

    // ---- REWARDS (applies to the pre-existing starter reward too)
    cards.filter(c => c.cardView2 === 'Reward').forEach(c => {
      ['colonialItems', 'cylonItems'].forEach(k => {
        if (!Array.isArray(c[k]))
          errs.push(`Reward ${c.cardGUID}: ${k} must be present as an array - Gson bypasses the ctor and the writer NPEs on null`);
        else if (c[k].length)
          errs.push(`Reward ${c.cardGUID}: ${k} is non-empty - ItemProvider.writeItems emits 3 extra bytes/item that ItemFactory.ReadList never reads; the client stream desyncs. Use shipItems.`);
      });
      (c.shipItems || []).forEach(it => {
        ['GUI', 'Price', 'ShipConsumable'].forEach(v => {
          if (!hasCard(it.cardGuid, v))
            errs.push(`Reward ${c.cardGUID}: item ${it.cardGuid} has no ${v} card - the hold loads it forever`);
        });
      });
    });

    // ---- MISSION TEMPLATES (data lives in JS, not in a card)
    const stars = (() => {
      const gm = cards.find(c => c.cardView2 === 'GalaxyMap');
      return gm ? Object.values(gm.stars || {}).map(s => s.Id) : [];
    })();
    const seenIds = new Set();
    MISSIONS.forEach(m => {
      if (seenIds.has(m.id))
        errs.push(`MissionTemplate id ${m.id} declared twice - MissionTemplateReader throws at boot`);
      seenIds.add(m.id);
      if (!(m.id > 0 && m.id <= 65535))
        errs.push(`MissionTemplate id ${m.id}: serverID is written as uint16`);
      if (!hasCard(m.guid, 'Mission'))
        errs.push(`MissionTemplate ${m.id}: missionGuid ${m.guid} has no Mission card`);
      if (!Object.keys(m.counters).length)
        errs.push(`MissionTemplate ${m.id}: no countEntries - allMatch() over an empty stream is TRUE, so the mission arrives already Completed`);
      Object.keys(m.counters).forEach(n => {
        if (COUNTER_GUID[n] === undefined)
          errs.push(`MissionTemplate ${m.id}: "${n}" is not a CounterCardType constant`);
        else if (!hasCard(COUNTER_GUID[n], 'Counter'))
          errs.push(`MissionTemplate ${m.id}: counter ${n} has no Counter card - MissionCountable.Read depends on it and the mission list never loads`);
        else if (LOCA_KEYS && !LOCA_KEYS.has('bgo.text_counters.' + n))
          errs.push(`MissionTemplate ${m.id}: counter "${n}" has no bgo.text_counters.${n} key - the objective line renders the raw key`);
      });
      const s = m.sector;
      if (s.staticSectorId !== 0 && !stars.includes(s.staticSectorId))
        errs.push(`MissionTemplate ${m.id}: staticSectorId ${s.staticSectorId} is not a galaxy-map star - the mission silently becomes global`);
      if (s.staticSectorId === 0 && s.useRandomSector) {
        const pool = stars.filter(id => !s.blacklist.includes(id))
                          .filter(id => !s.whitelist.length || s.whitelist.includes(id));
        if (!pool.length)
          errs.push(`MissionTemplate ${m.id}: blacklist/whitelist leave no star - rng.nextInt(0) throws inside the dialog handler and the player gets NO missions`);
      }
    });

    // ---- LOCA for every GUI card we author here
    /* EVERY GUI key we author must resolve in the client bundle, not just the ones for skills and
     * missions. Name falls back to returning its own ARGUMENT on a miss, so a dead key prints
     * "%$bgo.<key>.Name%" straight on screen; Description uses a try-get and yields NULL, which
     * NREs the two widgets that call .Replace() on it.
     * This used to check only skills/missions/NPCs, and two weapon abilities shipped with dead
     * keys because the client does NOT name a system and its ability off the same stem -
     * system_torpedo_missile_launcher pairs with ability_torpedo_launcher. */
    if (!LOCA_KEYS) errs.push('could not read loca-keys.txt - cannot verify GUI keys');
    else {
      cards.filter(c => c.cardView2 === 'GUI' && c.key).forEach(c => {
        /* The debris scenery guids are the ONE sanctioned exception, and only with the one
         * sanctioned key. DebrisPile.cs:19-22 substitutes the localized "Debris Field" whenever
         * GUICard.Name resolves to a raw "%$bgo." string, and DEBRIS_FALLBACK_KEY misses ON
         * PURPOSE to trigger exactly that (bgo.common.debris_field exists only as a bare key, no
         * .Name form). Scoped by guid so an unresolvable key anywhere else - including a debris
         * entry that MEANT to use a real key and typoed it - still fails the build; these guids
         * are only ever placed as SpaceEntityType.Debris, the one type with the fallback. The
         * Description miss is equally deliberate there: DebrisPile hides the stats panel, so the
         * tooltip widgets that NRE on a null Description never run for it. */
        const debrisFallback = DEBRIS_SCENERY_GUIDS.has(c.cardGUID) && c.key === DEBRIS_FALLBACK_KEY;
        // Both lookups are level-aware (GUICard.cs:38-82): Name tries NameCylon, then
        // Name_<Level>, then Name; Description tries Description_<Level>, then Description. Any
        // one of those forms satisfies it - the ship keys only ship the _1/_2 variants.
        const anyOf = (...forms) => forms.some(f => LOCA_KEYS.has(`bgo.${c.key}.${f}`));
        if (!debrisFallback && !anyOf('name', `name_${c.level}`, 'namecylon'))
          errs.push(`GUI ${c.cardGUID}: bgo.${c.key}.Name is not in the client bundle - the raw %$bgo...% prints on screen`);
        if (!debrisFallback && !DEBRIS_SCENERY_GUIDS.has(c.cardGUID) && !anyOf('description', `description_${c.level}`))
          console.warn(`GUI ${c.cardGUID}: bgo.${c.key}.Description is not in the client bundle - GUICard.Description yields null and NREs the widgets that .Replace() on it`);
      });
    }

    /* ---- EVERY World PREFAB MUST EXIST IN THE CLIENT ASSETMAP.
     * RootScript.Construct requests PrefabName + ".prefab" (then "_lowres.prefab") from the
     * bundle catalogue; a name no bundle carries falls through BOTH lookups to the placeholder
     * ship model (RootScript.cs:69-101) with nothing but a client-side log line. On a hull that
     * is at least obvious; on scenery it is a fleet of ghost placeholder ships parked in a
     * "debris field". Historically every prefab here was verified by hand against
     * assetmap.json - this rule is that verification, kept honest for the ~150 scenery prefabs
     * the expansion tables add. Checked case-insensitively: bundle asset names are lowercase. */
    {
      const amPath = path.resolve(__dirname, '../../BSGOCore/client/live/assetbundles/assetmap.json');
      let amPrefabs = null;
      try {
        amPrefabs = new Set(JSON.parse(fs.readFileSync(amPath, 'utf8'))
          .flatMap(b => b.assets || [])
          .filter(a => a.endsWith('.prefab'))
          .map(a => a.slice(0, -'.prefab'.length).toLowerCase()));
      } catch { /* reported below - a missing assetmap must not silently skip the rule */ }
      if (!amPrefabs || !amPrefabs.size)
        errs.push(`could not read the client assetmap at ${amPath} - cannot verify World prefab names, refusing to emit blind`);
      else cards.filter(c => c.cardView2 === 'World' && c.prefabName).forEach(c => {
        const p = String(c.prefabName).toLowerCase();
        // A lowres-only prefab is loadable: the hi-res miss falls back to _lowres before the
        // placeholder does. Live case: decoration_scavenger_station_ring_segment ships ONLY as
        // its _lowres variant, and the client renders that.
        if (!amPrefabs.has(p) && !amPrefabs.has(p + '_lowres'))
          errs.push(`World ${c.cardGUID}: prefab "${c.prefabName}" is in no client asset bundle - RootScript falls through hi-res and lowres to the placeholder ship model, silently`);
      });
    }

    /* ---- TARGETABLE WORLD OBJECTS NEED A PORTRAIT, AND FRAME 0.
     * The target bracket renders guiAvatarSlotTexturePath. With it empty the client falls back to
     * guiAtlasTexturePath and squeezes the entire 400x946 inventory sheet into the 40x36 portrait
     * box, which on screen is an unreadable block of colour - how the outposts and sentry platforms
     * shipped. The paired half is frameIndex: upstream's 08-world.json uses 0 on every targetable
     * world object (both cruisers, all nine asteroids) and a non-zero frame ONLY on inventory items,
     * where the atlas frame is the icon. A world object has no inventory icon, so a non-zero frame
     * there is always a mistake. Both halves are checked because either alone reproduces the bug.
     * Scoped to World cards that are actually targetable: scenery (planetoids, targetable:false)
     * never gets a bracket, and non-World GUI cards are inventory art where a frame is correct. */
    const guiByGuid = new Map(cards.filter(c => c.cardView2 === 'GUI').map(c => [c.cardGUID, c]));
    cards.filter(c => c.cardView2 === 'World' && c.targetable).forEach(w => {
      const g = guiByGuid.get(w.cardGUID);
      if (!g) return;   // a missing GUI card is a separate, louder failure already covered above
      if (!g.guiAvatarSlotTexturePath)
        errs.push(`GUI ${g.cardGUID} (${g.key}): targetable World object with no guiAvatarSlotTexturePath - ` +
                  `the target bracket falls back to the atlas and renders the whole sheet as colour mush`);
      // A stray frame index is only DEFINITELY harmful when there is no portrait to render instead;
      // with an avatar present the bracket never consults the atlas, so this is drift, not a defect.
      // Warned rather than failed, because missile_normal ships 177 with a real avatar and no source
      // says that is wrong - the evidence supports the portrait rule, not a blanket frame rule.
      if (g.frameIndex !== 0)
        console.warn(`WARN GUI ${g.cardGUID} (${g.key}): targetable World object with frameIndex ` +
                     `${g.frameIndex}; upstream ships 0 on every one (inert while an avatar is set)`);
    });

    /* ---- LOOT / AUGMENT TEMPLATES cross-check.
     * These files are hand-edited JSON outside the generator, but anything they can hand a
     * player must have GUI + ShipConsumable + Price at that guid, or the client's
     * ItemCountable.Read depends on a card that never arrives and the hold loads forever with no
     * error. Also verifies every lootId a sector references actually resolves - an unresolved id
     * makes getTemplateLst filter it out and the kill silently pays NOTHING (no items, no XP). */
    {
      const G = path.join(CORE_ROOT, 'ServerConfigurationUtils/global');
      const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/\/\/[^\n]*/g, '')); } catch { return null; } };
      const listed = d => { try { return fs.readdirSync(path.join(G, d)).filter(f => f.endsWith('.json') && !f.includes('!')); } catch { return []; } };

      const lootIds = new Set();
      ['LootTemplates', 'AugmentTemplates'].forEach(d => listed(d).forEach(f => {
        const arr = readJson(path.join(G, d, f));
        if (!Array.isArray(arr)) return;
        arr.forEach(t => {
          if (d === 'LootTemplates' && t.id !== undefined) lootIds.add(t.id);
          if (d === 'LootTemplates' && t.type && !['Damage', 'RadiusDamage'].includes(t.type))
            errs.push(`${d}/${f}: type "${t.type}" - LootTemplateDeserializer throws on anything but Damage/RadiusDamage, aborting the whole template load`);
          (t.lootEntryInfos || []).forEach(e => {
            const g = e.shipItem && e.shipItem.cardGuid;
            if (g === undefined) return;
            ['GUI', 'ShipConsumable', 'Price'].forEach(v => {
              if (!hasCard(g, v))
                errs.push(`${d}/${f}: item guid ${g} has no ${v} card - the client hangs on it forever in the hold`);
            });
          });
        });
      }));

      listed('SectorTemplates').concat(
        (() => { try { return fs.readdirSync(path.join(G, 'SectorTemplates')).filter(f => f.endsWith('.json_v3.json') && !f.includes('!')); } catch { return []; } })()
      ).forEach(f => {
        const raw = (() => { try { return fs.readFileSync(path.join(G, 'SectorTemplates', f), 'utf8'); } catch { return ''; } })();
        const refs = new Set([...raw.matchAll(/"lootI[dD]"\s*:\s*(\d+)/g)].map(m => Number(m[1])));
        refs.forEach(id => {
          if (!lootIds.has(id))
            errs.push(`SectorTemplates/${f}: lootId ${id} has no LootTemplate - SpaceObjectFactory.getTemplateLst filters it out and every kill silently pays nothing`);
        });
      });
    }

    /* ---- EVERY VIEW WE EMIT MUST BE ONE THE CLIENT CAN CONSTRUCT.
     * CardFactory.CreateCard (client CardFactory.cs:5-50) is a switch with 39 arms and
     * `_ => throw new Exception("Unknown Card View: " + cardView)` at :48. The throw happens INSIDE
     * Catalogue.FetchCard at Catalogue.cs:26, BEFORE AddCard at :27, so the card never enters the
     * cache, the exception unwinds out of CatalogueProtocol.ParseMessage and ProtocolManager.cs:54-63
     * swallows it into Debug.LogError. Net effect: the card is silently dropped and anything that
     * Depend()s on it waits forever. MapPart(40) and MapPartSet(41) are in the client's CardView enum
     * but absent from the factory, so they are exactly as fatal as a made-up number.
     * NonShipStats(48) is the one legitimate exception: it is server-internal (CardView.java:49,
     * consumed by SpaceObjectFactory.java:134/138 for the comet) and is not in the client enum at
     * all, so the client never requests it and CatalogueProtocol.java never pushes it unsolicited. */
    {
      const CLIENT_CONSTRUCTIBLE = new Set([
        1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 13, 14, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26,
        28, 29, 30, 31, 32, 34, 35, 36, 37, 38, 39, 42, 43, 44, 45, 46, 47,
      ]);
      const SERVER_ONLY_VIEWS = new Set([48]);
      cards.forEach(c => {
        const v = VIEW[c.cardView2];
        if (v === undefined) { errs.push(`card ${c.cardGUID}: view name "${c.cardView2}" is not in the VIEW table`); return; }
        if (!CLIENT_CONSTRUCTIBLE.has(v) && !SERVER_ONLY_VIEWS.has(v))
          errs.push(`card ${c.cardGUID}: view ${c.cardView2}(${v}) has no CardFactory.CreateCard case - the client throws "Unknown Card View" inside Catalogue.FetchCard (Catalogue.cs:26) before AddCard, ProtocolManager.cs:54-63 swallows it, and the card is silently dropped`);
      });
    }

    /* ---- EVERY Ship CARD NEEDS A ShipLight CARD AT THE SAME GUID.
     * Client Ship.LoadCards (Ship.cs:65-69) fetches ShipLight at objectGUID and adds it to
     * AreCardsLoaded, which gates isLoaded (SpaceObject.cs:390). Without it the object never
     * finishes constructing: no model, no bracket, no name tag, no DRADIS entry, nothing to click.
     * The only trace is one "Card should not be send because it's null! <guid> 42" per client on the
     * server (CatalogueProtocol.java:76) - the client's Catalogue.FetchCard has already cached an
     * empty placeholder (Catalogue.cs:17-31) and there is no timeout anywhere, so it waits forever.
     * Tier and both role fields must match the Ship card: the server reads ShipCard.getTier(), the
     * client reads ShipCardLight.Tier, and a mismatch splits the two with no error anywhere. */
    cards.filter(c => c.cardView2 === 'Ship').forEach(c => {
      const light = cards.find(l => l.cardView2 === 'ShipLight' && l.cardGUID === c.cardGUID);
      if (!light) {
        errs.push(`Ship ${c.cardGUID}: no ShipLight card at the same guid - Ship.LoadCards (Ship.cs:65-69) gates AreCardsLoaded on it, so isLoaded (SpaceObject.cs:390) never becomes true and the object never finishes constructing`);
        return;
      }
      if (light.Tier !== c.Tier)
        errs.push(`Ship ${c.cardGUID}: Tier ${c.Tier} but ShipLight Tier ${light.Tier} - the server gates on ShipCard.getTier() and the client on ShipCardLight.Tier, so the two disagree silently`);
      if (light.ShipRoleDeprecated !== c.ShipRoleDeprecated)
        errs.push(`Ship ${c.cardGUID}: ShipRoleDeprecated "${c.ShipRoleDeprecated}" but ShipLight "${light.ShipRoleDeprecated}" - GUISystemMap and DockingButton branch on the ShipLight value`);
    });

    /* ---- EVERY Sector CARD MUST POINT AT A Regulation CARD THAT EXISTS.
     * regulationCardGuid 0 is not "no regulation": client Catalogue.FetchCard returns null on guid 0
     * (Catalogue.cs:19-21) and SectorCard.Read does IsLoaded.Depend(null) -> NRE inside Card.Load, so
     * the sector card never finishes loading and the space loading screen hangs. A non-zero guid with
     * no card behind it is worse on the server: SectorFactory.java:91-94 throws IllegalStateException
     * out of the @ApplicationScoped SectorRegistry constructor and the process never boots. */
    cards.filter(c => c.cardView2 === 'Sector').forEach(s => {
      if (!s.regulationCardGuid)
        errs.push(`Sector ${s.cardGUID}: regulationCardGuid is 0/absent - FetchCard(0) is null (Catalogue.cs:19-21) and SectorCard.Read does IsLoaded.Depend(null) -> NRE`);
      else if (!hasCard(s.regulationCardGuid, 'Regulation'))
        errs.push(`Sector ${s.cardGUID}: regulationCardGuid ${s.regulationCardGuid} has no Regulation card - SectorFactory.java:91-94 throws IllegalStateException out of the SectorRegistry constructor`);
    });

    /* ---- AN OUTPOST TEMPLATE IS DEAD WEIGHT UNLESS ITS STAR ALLOWS OUTPOSTS.
     * SectorFactory.java:333-338 only registers OutpostSpawnTimer at all when the sector template
     * carries BOTH progress templates. Inside it, OutpostSpawnTimer.delayedUpdate:58/69 gates on
     * OutpostState.isOutPost(), which is getDelta() == 1 (OutpostState.java:94-99), and getDelta()
     * returns a hard 0 when canOutpost is false (:82-85). canOutpost is the galaxy star's
     * CanColonialOutpost / CanCylonOutpost, read at SectorFactory.java:133-134. So with the flag off
     * the outpost cards ship, the template sits there, and nothing ever spawns - no error, no log.
     * Spawning ALSO needs opPoints >= 900 (OutpostState.java:89), seeded to 3000 only for sector ids
     * 27 and 47 (SectorFactory.java:124-130). Force it in-game with the DebugProtocol commands
     * sector_op_all_max (DebugProtocol.java:806-816) or sector_op <faction> <pts> (:817-840).
     *
     * THE BASE SECTORS ARE EXEMPT FROM THE FLAG, AND ONLY FROM THE FLAG. OutpostSpawnTimer:43-56
     * runs BEFORE the OutpostState branch and calls spawnOp unconditionally whenever the sector is
     * one of GalaxyMapCard's hardcoded base ids - Colonial {0,49}, Cylon {6,50} (:88-102). It never
     * consults OutpostState, so canOutpost, opPoints and the 900 threshold are all irrelevant there;
     * despawnOp:84-88 likewise refuses to remove anything from a base sector. What a base sector
     * DOES need is a template of its OWN faction, because that is the only faction :43-56 ever
     * spawns - and an enemy-faction template in a base sector is unreachable content, since the
     * OutpostState branch that could spawn it needs a flag the base sector has no reason to set. */
    {
      const gm = cards.find(c => c.cardView2 === 'GalaxyMap');
      const ST = path.join(CORE_ROOT, 'ServerConfigurationUtils/global/SectorTemplates');
      const walk = d => {
        let out = [];
        let ents;
        try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return out; }
        for (const e of ents) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) out = out.concat(walk(p));
          else if (e.name.endsWith('.json') && !p.includes('!')) out.push(p);
        }
        return out;
      };
      walk(ST).forEach(f => {
        const raw = (() => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } })();
        const m = /"sectorID"\s*:\s*(\d+)/.exec(raw);
        if (!m) return;
        const id = Number(m[1]);
        const rel = path.relative(ST, f).replace(/\\/g, '/');
        const hasProgress = /"colonialProgressTemplate"/.test(raw) && /"cylonProgressTemplate"/.test(raw);
        // Outpost records carry their faction two lines above the spaceEntityType.
        const factions = new Set([...raw.matchAll(/"faction"\s*:\s*"?(\w+)"?[\s\S]{0,80}?"spaceEntityType"\s*:\s*"Outpost"/g)].map(x => x[1]));
        if (!factions.size) return;
        if (!hasProgress) {
          errs.push(`SectorTemplates/${rel}: has ${factions.size} Outpost template(s) but is missing colonialProgressTemplate/cylonProgressTemplate - SectorFactory.java:333 never registers OutpostSpawnTimer, so no outpost can ever spawn here`);
          return;
        }
        const star = gm && gm.stars ? gm.stars[String(id)] : null;
        if (!star) {
          errs.push(`SectorTemplates/${rel}: has Outpost templates but sector id ${id} is not a star on the GalaxyMap card - the sector is never created`);
          return;
        }
        // GalaxyMapCard.java:88-102, hardcoded and not read from any card.
        const baseFaction = ({ 0: 'Colonial', 49: 'Colonial', 6: 'Cylon', 50: 'Cylon' })[id] || null;
        if (baseFaction) {
          if (!factions.has(baseFaction))
            errs.push(`SectorTemplates/${rel}: sector ${id} is the ${baseFaction} base sector, where OutpostSpawnTimer.java:43-56 spawns a ${baseFaction} outpost unconditionally, but the template carries only ${[...factions].join('/')} - createOutpost filters templates by faction (SpaceObjectFactory.java:389-394) and throws IllegalStateException, the one exception spawnOp:105-108 swallows silently`);
          factions.forEach(fac => {
            if (fac !== baseFaction)
              errs.push(`SectorTemplates/${rel}: sector ${id} is the ${baseFaction} base sector but carries a ${fac} Outpost template - the base-sector branch only ever spawns ${baseFaction}, and the OutpostState branch that could spawn ${fac} needs Can${fac}Outpost on a star that has no reason to set it, so this template is unreachable`);
          });
          return;   // the flag genuinely does not apply here
        }
        factions.forEach(fac => {
          const flag = fac === 'Colonial' ? 'CanColonialOutpost' : 'CanCylonOutpost';
          if (!star[flag])
            errs.push(`star ${id}: ${flag} is false but SectorTemplates/${rel} carries a ${fac} Outpost template - OutpostState.getDelta (OutpostState.java:82-85) returns 0 forever when canOutpost is false, so isOutPost() never becomes true and OutpostSpawnTimer never calls createOutpost`);
        });
      });
    }

    /* ---- SECTOR BOUNDS.
     * The Sector card's Width/Length ARE the playable extent - FULL extents, centred on the origin.
     * Full, not half, on three independent server witnesses that all halve before using the value
     * as a +/- bound: FieldSpaceGroupCreatable.java:60-62, PlanetoidWithAsteroids.java:65-67 and
     * SectorRandomGenerationUtils.java:62-64. The client agrees, SpaceLevel.cs:134:
     *   PlayerIsInEmptySpace => |pos.x| > GetSectorSize().x/2 || |pos.z| > GetSectorSize().y/2
     * with GetSectorSize() == float2(Card.Width, Card.Length) (SpaceLevel.cs:207-210).
     * Anything authored past that half-extent is real but unusable:
     *   - SpaceLevel.cs:597-606 shows %$bgo.etc.fly_too_far% ONCE per boundary crossing (it latches
     *     on isEmptySpaceMessageShown at :601 and re-arms at :605), so the only symptom of a
     *     far-out object is that you fly at it forever with no feedback;
     *   - SystemMap3DCameraView.cs:202-204 drops the 3D map to a "combat zone left" top view;
     *   - GUISystemMap.cs:1250-1266 SpaceToMap divides by width/2 and length/2, so
     *     ClampToAreaBorder pins the icon to the map rim - you cannot navigate to it.
     * The SERVER clamps nothing: SpaceObjectFactory.createAsteroid:107 takes
     * AsteroidTemplate.getTransform() verbatim, so the object spawns real, targetable and
     * loot-bearing, just out of reach.
     * THIS IS WHAT FOUND IT: sectors 0 and 6 each shipped one asteroid at z = 35980.51, 3.60x
     * their own length/2 of 10000 - the record is identified by its unique x = -1609.761
     * (objectGUID 57969844 is shared by 47 records in sector 0 and identifies nothing).
     *
     * Y warns instead of failing: no live path reads Card.Height as a bound. SpaceLevel.cs:130
     * GetSectorSizeV3 is consumed only by SystemMap3DWindowViewUi.cs:79-83, which normalises all
     * three axes by Width. The three server height users are all real code but none of them runs
     * in a shipped sector: FieldSpaceGroupCreatable and PlanetoidWithAsteroids have no callers, and
     * SectorRandomGenerationUtils is reachable only from DebugProtocol.java:1155/1183/1219.
     *
     * PARSE FAILURE IS AN ERROR, NEVER A SKIP. SectorTemplateReader hands these files to Gson,
     * whose fromJson uses a LENIENT JsonReader, so sectorTemplate10 legally carries // comments AND
     * unquoted enum values ("faction": Colonial, from line 24770). A strict JSON.parse that
     * silently returned null there would make this validator pass by checking nothing, which is
     * worse than not having it at all. NaN/Infinity are rejected explicitly rather than coerced to
     * a string, because a coerced NaN skips the node and the bad coordinate ships invisibly. */
    {
      const ST = path.join(CORE_ROOT, 'ServerConfigurationUtils/global/SectorTemplates');
      /* RECURSIVE, because TemplateReader.getFilePaths (TemplateReader.java:47-52) is
       * Files.walk(templatePath) - a template in a subdirectory is loaded by the server, so a flat
       * readdir would load-and-never-check it. Same two filters as the server. */
      const walk = d => {
        let out = [];
        let ents;
        try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return out; }
        for (const e of ents) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) out = out.concat(walk(p));
          else if (e.name.endsWith('.json') && !p.includes('!')) out.push(p);
        }
        return out;
      };
      const templates = walk(ST);
      if (!templates.length)
        errs.push('SectorTemplates: none on disk - SectorRegistry.java:52-68 calls createSector for every galaxy star inside an @ApplicationScoped constructor and SectorFactory.java:107 throws straight out of it');

      /* Just enough of Gson's lenient mode to hand the file to JSON.parse: strip comments, quote
       * bare words (enum values AND unquoted keys), drop trailing commas, and REFUSE the
       * non-finite literals rather than quoting them into a silent skip. */
      const lenient = src => {
        let out = '', inStr = false, esc = false, sq = false;
        for (let i = 0; i < src.length; i++) {
          const ch = src[i];
          if (inStr) {
            if (esc) { out += ch; esc = false; continue; }
            if (ch === '\\') { out += ch; esc = true; continue; }
            if (sq && ch === "'") { out += '"'; inStr = false; sq = false; continue; }
            if (!sq && ch === '"') { out += ch; inStr = false; continue; }
            out += (ch === '"' && sq) ? '\\"' : ch;
            continue;
          }
          if (ch === '"') { inStr = true; out += ch; continue; }
          if (ch === "'") { inStr = true; sq = true; out += '"'; continue; }
          if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
          if (ch === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }
          out += ch;
        }
        // Quote every bare word that is not a JSON literal. Zero-width lookahead on the trailing
        // delimiter so consecutive bare words in an array are each matched.
        out = out.replace(/([:[{,]\s*)([A-Za-z_]\w*)(?=\s*[,}\]:])/g, (m, a, w) => {
          if (w === 'true' || w === 'false' || w === 'null') return m;
          if (w === 'NaN' || w === 'Infinity') throw new SyntaxError('non-finite literal ' + w);
          return `${a}"${w}"`;
        });
        if (/(^|[^\w."])-?(NaN|Infinity)([^\w"]|$)/.test(out)) throw new SyntaxError('non-finite numeric literal');
        out = out.replace(/,(\s*[}\]])/g, '$1');   // trailing commas
        return JSON.parse(out);
      };

      /* Every positional {x,y,z} node anywhere in the document, with its JSON path. Shape-driven on
       * purpose: it covers spaceObjectTemplates[].position, spawnAreaTemplates[].a/.b and
       * botSpawnTemplates[].spawnArea.min/.max today, and any positional key a future template adds
       * without this needing to know about it. Euler3 (pitch/yaw/roll) does not match; a node with
       * a numeric w is a quaternion and is skipped rather than bounds-checked. There is no key-count
       * cap, so a position that gains a sibling field is still checked. A SpawnArea only ever yields
       * points between .a and .b (SpawnArea.java:27 -> BgoRandom.getInsideVectors), so checking the
       * two corners bounds the whole area. */
      const vecs = (node, at, acc) => {
        if (node === null || typeof node !== 'object') return acc;
        if (Array.isArray(node)) { node.forEach((v, i) => vecs(v, `${at}[${i}]`, acc)); return acc; }
        if (['x', 'y', 'z'].every(k => typeof node[k] === 'number') && typeof node.w !== 'number')
          { acc.push([at, node]); return acc; }
        Object.keys(node).forEach(k => vecs(node[k], `${at}.${k}`, acc));
        return acc;
      };

      /* id -> Sector card, resolved the way the SERVER resolves it: Catalogue.getSectorCardByID
       * (Catalogue.java:190-203) finds the GUI card whose key is "sector"+id, then takes the Sector
       * card at that same guid. Derived from the emitted cards rather than from the SECTORS table so
       * this keeps working whatever shape that table takes. */
      const sectorById = new Map();
      cards.filter(c => c.cardView2 === 'GUI' && /^sector\d+$/.test(c.key || '')).forEach(g => {
        const sec = cards.find(c => c.cardGUID === g.cardGUID && c.cardView2 === 'Sector');
        if (sec) sectorById.set(Number(String(g.key).slice(6)), sec);
      });

      const templateIds = new Set();
      templates.forEach(f => {
        const rel = path.relative(ST, f).replace(/\\/g, '/');
        let d;
        try { d = lenient(fs.readFileSync(f, 'utf8')); }
        catch (e) {
          errs.push(`SectorTemplates/${rel}: will not parse (${e.message}) - refusing to bounds-check a template blind`);
          return;
        }
        if (typeof d.sectorID !== 'number') {
          errs.push(`SectorTemplates/${rel}: no numeric sectorID - SectorFactory.java:102-108 can never match it to a star`);
          return;
        }
        if (templateIds.has(d.sectorID))
          errs.push(`SectorTemplates/${rel}: duplicate sectorID ${d.sectorID} - Files.walk order decides which one wins`);
        templateIds.add(d.sectorID);
        const sec = sectorById.get(d.sectorID);
        /* ERROR, not warn: this is a boot crash, not dead weight. SectorRegistry builds a Sector for
         * every galaxy star; SectorFactory.java:86-88 resolves the Sector card through
         * Catalogue.getSectorCardByID and throws IllegalStateException out of an @ApplicationScoped
         * constructor when it is empty. */
        if (!sec) {
          errs.push(`SectorTemplates/${rel}: sectorID ${d.sectorID} has no Sector card reachable via a GUI card keyed "sector${d.sectorID}" - SectorFactory.java:86-88 throws IllegalStateException out of the SectorRegistry constructor`);
          return;
        }
        const half = { x: sec.width / 2, y: sec.height / 2, z: sec.length / 2 };
        // Fail loud rather than open: |v| > NaN is false, so a missing dimension would make this
        // validator pass by checking nothing.
        const bad = ['x', 'y', 'z'].filter(ax => !Number.isFinite(half[ax]) || half[ax] <= 0);
        if (bad.length) {
          errs.push(`Sector ${sec.cardGUID} (id ${d.sectorID}): width/height/length missing or <= 0 (${bad.join(', ')}) - the bounds check cannot run`);
          return;
        }
        const field = { x: 0, z: 0 };
        const nodes = vecs(d, '$', []);
        if (!nodes.length)
          errs.push(`SectorTemplates/${rel}: no positional data at all - the sector would spawn empty`);
        nodes.forEach(([at, v]) => {
          field.x = Math.max(field.x, Math.abs(v.x));
          field.z = Math.max(field.z, Math.abs(v.z));
          ['x', 'z'].forEach(ax => {
            if (Math.abs(v[ax]) > half[ax])
              errs.push(`SectorTemplates/${rel} ${at}: |${ax}| ${v[ax]} is outside sector ${d.sectorID}'s own half-extent ${half[ax]} (${(Math.abs(v[ax]) / half[ax]).toFixed(2)}x) - SpaceLevel.cs:134 calls that empty space, the system map clamps it to the rim, and no player can reach it`);
          });
          if (Math.abs(v.y) > half.y)
            console.warn(`SectorTemplates/${rel} ${at}: |y| ${v.y} exceeds height/2 ${half.y} - no live path reads Card.Height as a bound, but the record is suspect`);
        });
        /* A card far bigger than its content is a system-map SCALE bug, not a reachability bug:
         * SpaceToMap divides by half the extent, so the whole field collapses toward the middle of
         * the map. Warns with the tightest extent that would still contain everything. */
        ['x', 'z'].forEach(ax => {
          const dim = ax === 'x' ? 'width' : 'length';
          if (field[ax] && half[ax] > field[ax] * 2)
            console.warn(`Sector ${sec.cardGUID} (id ${d.sectorID}): ${dim} ${sec[dim]} is ${(half[ax] / field[ax]).toFixed(1)}x the content's |${ax}| reach ${field[ax].toFixed(1)} - the field draws as a blob in the middle of the system map; tightest safe ${dim} is ${Math.ceil(field[ax] * 2)}`);
        });
      });

      /* The reverse direction, and the one that actually crashes the boot: a Sector card with no
       * template on disk. SectorFactory.java:102-108 throws IllegalArgumentException when no
       * SectorTemplate carries the star's sectorID. */
      [...sectorById.keys()].forEach(id => {
        if (!templateIds.has(id))
          errs.push(`Sector id ${id} has a Sector card but no SectorTemplate on disk with sectorID ${id} - SectorFactory.java:102-108 throws IllegalArgumentException out of the SectorRegistry constructor and the server never boots`);
      });
    }
    // ---- ROOM NPCs (missions are unreachable without one)
    const NPC_BY_PREFAB = { cic_human: ['Adama', 'Apollo', 'Starbuck', 'Tyrol'],
                            cic_cylon: ['Leoben', 'No1', 'No6', 'Sharon'] };
    /* An NPC-less room is fine - the outpost hangars have none, and the hangar prefabs carry no
     * NPC child transforms to attach one to. What is NOT fine is a FACTION with no reachable
     * mission NPC anywhere, since RoomProtocol.Talk is the only entry to MissionDistributor.
     * So: check the invariant per faction, not per room. */
    const roomsWithNpcs = cards.filter(c => c.cardView2 === 'Room' && (c.NPCs || []).length);
    ['cic_human', 'cic_cylon'].forEach(p => {
      const ok = roomsWithNpcs.some(c => {
        const w = cards.find(x => x.cardGUID === c.cardGUID && x.cardView2 === 'World');
        return w && w.prefabName === p;
      });
      if (!ok)
        errs.push(`No room with prefab ${p} has an NPC - RoomProtocol.Talk is the only entry to MissionDistributor, so that faction can never get an assignment`);
    });
    cards.filter(c => c.cardView2 === 'Room').forEach(c => {
      const world = cards.find(x => x.cardGUID === c.cardGUID && x.cardView2 === 'World');
      const roster = NPC_BY_PREFAB[world && world.prefabName] || null;
      (c.NPCs || []).forEach(n => {
        if (roster && !roster.includes(n.NPC))
          errs.push(`Room ${c.cardGUID}: NPC "${n.NPC}" is not a child transform of ${world.prefabName} (${roster.join('/')}) - RoomLevel logs "npcObject is null" and skips it`);
        if (!hasCard(n.NPCGUID, 'GUI'))
          errs.push(`Room ${c.cardGUID}: NPCGUID ${n.NPCGUID} has no GUI card - the hover tooltip never renders`);
      });
    });
  }


  /* ============================================================ PAPERDOLL INVARIANT
   * Placement is a linear search by SlotId VALUE inside the UpgradeLevel whose Level equals
   * ShipCard.Level - PaperdollLayoutBig.cs:28-31 leaves BOTH GetSlotLayouts and the .Find(...)
   * that follows it unguarded.
   *   BIG  : a slot the SERVER instantiates with no entry at that Level is a NullReferenceException
   *          - GUIShopPaperDollSlot.cs:170 (silent, every shop refresh), DWPaperdoll.cs:53 (silent),
   *          InflightShop/Paperdoll.cs:54-58 (logs, then dereferences the null anyway).
   *   SMALL: tolerant - GUISmallPaperdoll.cs:106-113 skips layout ids the ship lacks, so a missing
   *          entry only costs an in-flight firing button. Warn, do not fail.
   * Only slots with Level <= ShipCard.Level are instantiated (HangarShip.java:99-105).
   * All 65 shipped layout files define exactly UpgradeLevel 1 and 2 - no others.
   * '' is a LEGAL PaperdollUiLayoutfile: ShipCard.cs:146 skips the load entirely, and the two
   * cruisers (28/29) rely on that. Do not fail on it. */
  /* Slot ids per UpgradeLevel, GENERATED from the shipped paperdoll layout files by
   * tools/cardgen/extract-paperdolls.js - not hand-maintained. Every layout the roster uses is
   * here; regenerate when the roster grows.
   *   BIG  : a slot the SERVER instantiates with no entry at that Level is a NullReferenceException
   *          - GUIShopPaperDollSlot.cs:170 (silent, every shop refresh), DWPaperdoll.cs:53 (silent),
   *          InflightShop/Paperdoll.cs:54-58 (logs, then dereferences the null anyway).
   *   SMALL: tolerant - GUISmallPaperdoll.cs:106-113 skips layout ids the ship lacks, so a missing
   *          entry only costs an in-flight firing button. Warn, do not fail.
   * Only slots with Level <= ShipCard.Level are instantiated (HangarShip.java:99-105).
   * '' is a LEGAL PaperdollUiLayoutfile: ShipCard.cs:146 skips the load entirely, and the two
   * cruisers (28/29) rely on that. Do not fail on it. */
  const LAYOUT_BIG = {
    ship_avenger_paperdoll_layouts:                { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,16], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16] },
    ship_banshee_paperdoll_layouts:                { 1: [0,1,2,3,4,5,7,8,9,10,11,14,15,16,17], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17] },
    ship_berserker_paperdoll_layouts:              { 1: [0,1,2,3,4,5,6,7,8,9,10,11,15], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] },
    ship_brimir_paperdoll_layouts:                 { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26] },
    ship_commandtoken_basestar_paperdoll_layouts:  { 1: [7,6,5,2,11,4,3,8,9,1,10,0,12,13], 2: [7,6,5,2,11,4,3,8,9,1,10,0,12] },
    ship_commandtoken_pegasus_paperdoll_layouts:   { 1: [3,8,9,11,7,6,1,2,5,10,0,4,12,13], 2: [3,8,9,11,7,6,1,2,5,10,0,4,12] },
    ship_cruiser_paperdoll_layouts:                { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,17], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17] },
    ship_dominator_paperdoll_layouts:              { 1: [0,1,2,3,4,5,6,7,8,9,10,11,15,16,17], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17] },
    ship_dreadnought_paperdoll_layouts:            { 1: [0,1,2,3,4,5,6,7,8,9,10,11,14,15,17], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17] },
    ship_gungnir_paperdoll_layouts:                { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,16,17,18], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18] },
    ship_gunstar_paperdoll_layouts:                { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,19], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19] },
    ship_halberd_paperdoll_layouts:                { 1: [2,0,6,8,4,7,15,14,11,12,9,1,5,10,13,16], 2: [2,3,0,6,8,4,7,15,14,11,12,9,1,5,10,13,16] },
    ship_heavy_raider_paperdoll_layouts:           { 1: [0,1,2,3,4,5,6,7,8,10,11,13,14], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14] },
    ship_liche_paperdoll_layouts:                  { 1: [13,0,1,4,7,8,14,15,12,10,9,5,2,11,6,16], 2: [13,0,1,4,7,8,14,15,12,10,9,5,2,11,6,3,16] },
    ship_nidhogg_paperdoll_layouts:                { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,16,17,18], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18] },
    ship_nova_paperdoll_layouts:                   { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,19], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19] },
    ship_phantom_paperdoll_layouts:                { 1: [0,1,2,3,4,5,6,7,8,9,10,11,14,15,17], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17] },
    ship_raider_1b_paperdoll_layouts:              { 1: [0,2,3,4,5,6,7,8,9,10,11,12,13,14,15], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] },
    ship_raider_paperdoll_layouts:                 { 1: [0,1,2,3,4,5,6,7,8,9,10,13,14], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14] },
    ship_raptor_paperdoll_layouts:                 { 1: [0,1,2,3,4,6,7,8,9,10,11,13,14], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14] },
    ship_rhino_paperdoll_layouts:                  { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,14,15], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] },
    ship_scout_paperdoll_layouts:                  { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,14,15], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] },
    ship_sentinel_paperdoll_layouts:               { 1: [0,1,2,3,4,5,6,7,8,9,10,11,14,15,17], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17] },
    ship_spectre_paperdoll_layouts:                { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,16], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16] },
    ship_surtur_paperdoll_layouts:                 { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26] },
    ship_viper_mk7_paperdoll_layouts:              { 1: [0,2,3,4,5,6,7,8,9,10,11,12,13,14,15], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] },
    ship_viper_paperdoll_layouts:                  { 1: [0,1,2,3,4,5,6,7,8,10,11,13,14], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14] },
    ship_wrath_paperdoll_layouts:                  { 1: [0,1,2,3,4,5,6,7,8,9,10,11,15], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] },
  };
  const LAYOUT_SMALL = {
    ship_avenger_paperdoll_layouts:                { 1: [0,1,2,5,12,13], 2: [0,1,2,5,12,13] },
    ship_banshee_paperdoll_layouts:                { 1: [0,1,2,3,16], 2: [0,1,2,3,12,13,16] },
    ship_berserker_paperdoll_layouts:              { 1: [0,1,2,3], 2: [0,1,2,3,12,13] },
    ship_brimir_paperdoll_layouts:                 { 1: [0,1,2,3,4,5,6,7,8,9], 2: [0,1,2,3,4,5,6,7,8,9,20,21] },
    ship_commandtoken_basestar_paperdoll_layouts:  { 1: [0,4,2,5,11,10,1,3,7,9,6,8], 2: [0,1,2,3,4,5,6,7] },
    ship_commandtoken_pegasus_paperdoll_layouts:   { 1: [3,4,5,2,11,10,0,1,7,9,6,8], 2: [0,1,2,3,4,5,6,7] },
    ship_cruiser_paperdoll_layouts:                { 1: [0,1,2,3,4,5], 2: [0,1,2,3,4,5,14,15] },
    ship_dominator_paperdoll_layouts:              { 1: [0,1,2,3,16], 2: [0,1,2,3,12,13,16] },
    ship_dreadnought_paperdoll_layouts:            { 1: [4,0,1,2,3,5], 2: [4,0,1,2,3,5,12,13] },
    ship_gungnir_paperdoll_layouts:                { 1: [4,0,1,2,3,5,12,13], 2: [4,0,1,2,15,3,5,12,13] },
    ship_gunstar_paperdoll_layouts:                { 1: [12,1,2,3,4,13,0,5], 2: [12,1,2,3,4,13,0,5] },
    ship_halberd_paperdoll_layouts:                { 1: [0,2,4,1,5,6], 2: [0,2,6,4,1,5,3] },
    ship_heavy_raider_paperdoll_layouts:           { 1: [0,1,2], 2: [0,1,2,9] },
    ship_liche_paperdoll_layouts:                  { 1: [0,2,6,1,5,4], 2: [0,2,4,6,1,5,3] },
    ship_nidhogg_paperdoll_layouts:                { 1: [11,1,0,2,3,12,4,5], 2: [11,1,0,2,15,3,12,4,5] },
    ship_nova_paperdoll_layouts:                   { 1: [12,13,0,1,2,3,4,5], 2: [12,13,0,1,2,3,4,5] },
    ship_phantom_paperdoll_layouts:                { 1: [2,3,0,1,4,5], 2: [2,12,3,0,1,4,5,13] },
    ship_raider_1b_paperdoll_layouts:              { 1: [3,4,2,0], 2: [3,1,4,2,0] },
    ship_raider_paperdoll_layouts:                 { 1: [0,1,2], 2: [0,1,2,12] },
    ship_raptor_paperdoll_layouts:                 { 1: [0,1,2], 2: [0,1,2,12] },
    ship_rhino_paperdoll_layouts:                  { 1: [0,1,2,12], 2: [0,1,2,12,13] },
    ship_scout_paperdoll_layouts:                  { 1: [12,0,1,2], 2: [12,0,1,2,13] },
    ship_sentinel_paperdoll_layouts:               { 1: [0,1,2,3,4,5], 2: [0,1,2,3,4,5,12,13] },
    ship_spectre_paperdoll_layouts:                { 1: [0,1,2,3,12,13], 2: [0,1,2,3,12,13] },
    ship_surtur_paperdoll_layouts:                 { 1: [0,1,2,3,4,5,6,7,8,9], 2: [0,1,2,3,4,5,6,7,8,9,20,21] },
    ship_viper_mk7_paperdoll_layouts:              { 1: [3,4,2,0], 2: [3,1,4,2,0] },
    ship_viper_paperdoll_layouts:                  { 1: [0,1,2], 2: [0,1,2,12] },
    ship_wrath_paperdoll_layouts:                  { 1: [0,1,2,3], 2: [0,1,2,3,12,13] },
  };
  /* A hull is PLAYER-OWNABLE if it is in a ShipList or carries a Price card. Only such a hull can
   * ever become Game.Me.ActiveShip, and PaperdollLayoutBig is dereferenced NOWHERE ELSE - every one
   * of the three client sites goes through Game.Me.ActiveShip, which is a HangarShip:
   *   Gui.CharacterStatus.InflightShop/Paperdoll.cs:32,52-53  Game.Me.ActiveShip.Card.PaperdollLayoutBig
   *   Gui.DamageWindow/DWPaperdoll.cs:28,44,52-53             HangarShip activeShip = Game.Me.ActiveShip
   *   GUIShopPaperDollSlot.cs:169-170                         Game.Me.ActiveShip.Card.PaperdollLayoutBig
   * ShipCard.cs:146 `if (!string.IsNullOrEmpty(PaperdollUiLayoutfile))` skips the layout LOAD when
   * the name is blank, so PaperdollLayoutBig is already null on every NPC hull - including the two
   * cruisers, which is why '' is documented above as legal. An Outpost or WeaponPlatform is
   * client-side a CruiserShip, never a HangarShip; it is in no ShipList and has no Price card, so
   * the null cannot be reached. The rule stays in full force for anything a player can hold, which
   * is the case it was written for. Without this, arming the stations fails the build. */
  /* A Price card alone no longer marks a hull ownable: the stations carry Price(23) views now
   * (the client's info UI fetches them), but with an EMPTY BuyPrice, which the shop guards
   * treat as not-for-sale everywhere. Ownable means listed, or priced with a real cost. */
  const ownableGuids = new Set([
    ...cards.filter(c => c.cardView2 === 'ShipList').flatMap(c => c.shipCardGuids || []),
    ...cards.filter(c => c.cardView2 === 'Price'
                      && Object.keys((c.BuyPrice || {}).items || {}).length > 0).map(c => c.cardGUID),
  ]);
  cards.filter(c => c.cardView2 === 'Ship').forEach(c => {
    if (!c.PaperdollUiLayoutfile) {
      if ((c.Slots || []).length && ownableGuids.has(c.cardGUID))
        errs.push(`Ship ${c.cardGUID}: has Slots but no PaperdollUiLayoutfile - PaperdollLayoutBig stays null`);
      return;
    }
    /* The DUMP's own PaperdollLayoutBig/Small wins over the hand-extracted table, which is not
     * uniformly trustworthy: most of its rows list a full slot set, but ship_viper's said
     * { 1: [0,1,2] } where the real layout has twelve entries at level 1. Anything the dump does
     * not cover still falls back to the table. */
    const real = LAYOUTS_REAL[c.PaperdollUiLayoutfile];
    const B = (real && real.big) || LAYOUT_BIG[c.PaperdollUiLayoutfile];
    const SM = (real && real.small) || LAYOUT_SMALL[c.PaperdollUiLayoutfile];
    if (!B || !SM) {
      errs.push(`Ship ${c.cardGUID}: layout "${c.PaperdollUiLayoutfile}" is not in the verified table - add it (65 files exist) or the layout is unvalidated`);
      return;
    }
    if (!B[c.Level] || !SM[c.Level]) {
      errs.push(`Ship ${c.cardGUID}: Level ${c.Level} has no UpgradeLevel in ${c.PaperdollUiLayoutfile} - every shipped layout defines only 1 and 2; PaperdollLayoutBig.cs:30 NREs`);
      return;
    }
    (c.Slots || []).forEach(s => {
      if (s.Level > c.Level) return;                 // HangarShip.java:100 never instantiates it
      if (!B[c.Level].includes(s.SlotId))
        errs.push(`Ship ${c.cardGUID}: SlotId ${s.SlotId} has no BIG layout entry at Level ${c.Level} - NRE at GUIShopPaperDollSlot.cs:170 / DWPaperdoll.cs:53 / InflightShop/Paperdoll.cs:58`);
      if (!SM[c.Level].includes(s.SlotId))
        console.warn(`WARN Ship ${c.cardGUID}: SlotId ${s.SlotId} has no SMALL layout entry at Level ${c.Level} - no in-flight control for that slot`);
    });
  });

  /* PlayerProtocol.addShip refuses any card with Level > 1 and returns SILENTLY.
   * A Level-2 card in a ShipList is a hull that can never be bought. */
  const listedGuids = new Set(cards.filter(c => c.cardView2 === 'ShipList')
    .flatMap(c => c.shipCardGuids || []));
  cards.filter(c => c.cardView2 === 'Ship' && listedGuids.has(c.cardGUID)).forEach(c => {
    if (c.Level > 1)
      errs.push(`Ship ${c.cardGUID}: Level ${c.Level} but it is in a ShipList - addShip returns silently, the hull is unbuyable`);
  });

  /* Spot.FindSpots (Spot.cs:58-76) matches objectPointName against prefab transform names by exact
   * equality and drops misses silently. A name no prefab carries = no muzzle FX, no firing arc,
   * missiles from the ship origin - with nothing in any log. */
  const POINTS_BY_PREFAB = {
    humant1fighter:  ['bullet01','bullet02','bullet03','elitebullet04','sticker1'],
    humant1command:  ['bullet01','bullet02','bullet03','elitebullet04','sticker1'],
    cylont1fighter:  ['bullet01','bullet02','bullet03','elitebullet04','sticker'],
    cylont1command:  ['bullet01','bullet02','bullet03','elitebullet04','sticker1'],
    humant1defender: ['bullet01','bullet02','bullet03','elitebullet04','elitebullet05','sticker1','sticker2','sticker3','sticker4'],
    cylont1defender: ['bullet01','bullet02','bullet03','elitebullet04','elitebullet05','sticker1','sticker2','sticker3'],
    humant1merit:    ['bullet01','bullet02','bullet03','bullet04','bullet05','sticker1'],
    cylont1merit:    ['bullet01','bullet02','bullet03','bullet04','bullet05','sticker1'],
    // Stations, from tools/cardgen/extract-hardpoints.py against human_outpost / cylon_outpost /
    // {human,cylon}_stationary_platform_{small,medium,large}. Not guesses - see HARDPOINTS. Adding
    // them STRENGTHENS this check: without the entry the station prefabs would be skipped silently.
    humanoutpost:    ['bullet01','bullet02','bullet03','bullet04','bullet05','bullet06',
                      'bullet07','bullet08','bullet09','bullet10','bullet11','bullet12'],
    cylonoutpost:    ['bullet01','bullet02','bullet03','bullet04','bullet05','bullet06',
                      'bullet07','bullet08','bullet09','bullet10','bullet11','bullet12'],
    human_stationary_platform_medium:
                     ['bullet01','bullet02','bullet03','bullet04','bullet05','bullet06','bullet07',
                      'bullet08','bullet09','bullet10','bullet11','bullet12','bullet13',
                      'bullet14','bullet15'],
    cylon_stationary_platform_medium:
                     ['bullet01','bullet02','bullet03','bullet04','bullet05','bullet06','bullet07',
                      'bullet08','bullet09','bullet10','bullet11','bullet12','bullet13',
                      'bullet14','bullet15'],
    human_stationary_platform_small:
                     ['bullet01','bullet02','bullet03','bullet04','bullet05','bullet06','bullet07',
                      'bullet08','bullet09','bullet10','bullet11','bullet12'],
    cylon_stationary_platform_small:
                     ['bullet01','bullet02','bullet03','bullet04','bullet05','bullet06','bullet07',
                      'bullet08','bullet09','bullet10','bullet11','bullet12'],
    human_stationary_platform_large:
                     ['bullet01','bullet02','bullet03','bullet04','bullet05','bullet06','bullet07',
                      'bullet08','bullet09','bullet10','bullet11','bullet12','bullet13',
                      'bullet14','bullet15','bullet16','bullet17','bullet18'],
    cylon_stationary_platform_large:
                     ['bullet01','bullet02','bullet03','bullet04','bullet05','bullet06','bullet07',
                      'bullet08','bullet09','bullet10','bullet11','bullet12','bullet13',
                      'bullet14','bullet15','bullet16','bullet17','bullet18'],
  };
  cards.filter(c => c.cardView2 === 'World' && c.prefabName in POINTS_BY_PREFAB).forEach(c =>
    (c.spots || []).forEach(s => {
      if (!POINTS_BY_PREFAB[c.prefabName].includes(s.objectPointName))
        errs.push(`World ${c.cardGUID}: spot "${s.objectPointName}" is not a transform on ${c.prefabName} - Spot.FindSpots drops it silently`);
    }));
  // A slot whose hash has no matching spot can never bind a weapon at all.
  const worldByGuid = new Map(cards.filter(c => c.cardView2 === 'World').map(c => [c.cardGUID, c]));
  cards.filter(c => c.cardView2 === 'Ship').forEach(c => {
    const w = worldByGuid.get(c.cardGUID); if (!w) return;
    const hashes = new Set((w.spots || []).map(s => s.objectPointServerHash));
    (c.Slots || []).forEach(s => {
      /* ONLY WEAPON-BEARING SLOTS BIND TO A HARDPOINT. A hull, computer, engine, avionics, role or
       * ship_paint module does not render on the ship, so it has no transform to attach to and no
       * spot on the World card, by design - most of them carry the sentinel ObjectPoint
       * "undefined" (hash 44673, the hash of that literal string).
       * Keyed on the TYPE rather than on the sentinel, because upstream is not consistent about it:
       * both carriers leave a stale "bullet01" on six of their module slots. That is inert - the
       * slot never attaches either way - but it does mean the sentinel alone is not a safe test. */
      if (!['weapon', 'gun', 'launcher', 'defensive_weapon', 'special_weapon'].includes(s.SystemType))
        return;
      if (!hashes.has(s.ObjectPointServerHash))
        errs.push(`Ship ${c.cardGUID} slot ${s.SlotId}: ObjectPointServerHash ${s.ObjectPointServerHash} has no spot on the World card - GetObjectPoint returns null, the weapon never attaches`);
    });
  });

  /* Slot types must be real ShipSlotType constants (a bad name = null enum = NPE on write) AND
   * must have a matching ShipSystem, or the slot can never be filled. The inverse matters too:
   * a system type with nowhere to go is unsellable, unequippable stock. */
  const SLOT_TYPES = ['undefined','computer','engine','hull','weapon','ship_paint','avionics',
                      'launcher','defensive_weapon','gun','role','special_weapon'];
  const shipsAll = cards.filter(c => c.cardView2 === 'Ship');
  const sysAll = cards.filter(c => c.cardView2 === 'ShipSystem');
  const sysTypes = new Set(sysAll.map(c => c.SlotType));
  shipsAll.forEach(c => (c.Slots || []).forEach(s => {
    if (!SLOT_TYPES.includes(s.SystemType))
      errs.push(`Ship ${c.cardGUID} slot ${s.SlotId}: "${s.SystemType}" is not a ShipSlotType - null enum, NPE on write`);
    if (s.SystemType === 'undefined')
      errs.push(`Ship ${c.cardGUID} slot ${s.SlotId}: undefined has no bgo.shop.undefined loca and renders "[]"`);
  }));

  /* ---- CROSS-FACTION PARITY ON THE SHARED CAPITAL STAT BLOCKS.
   *
   * Two pairs of hulls are deliberately matched across the factions - Pegasus/Basestar on
   * CAPITAL_FLIGHT, Galactica/Guardian on FLAGSHIP_FLIGHT - and each pair carries the SAME object by
   * reference precisely so the numbers cannot be edited apart. That guarantee is not total, though:
   * realStats is applied over flightStats() and detection(), so a field NEITHER block names still
   * comes from the row's own tier / roleDep / agility columns, and repair Durability is a separate
   * per-PREFAB table that the shared object does not reach at all. Change a paired hull's roleDep
   * and its detection radii move on one faction only, with nothing in the diff to say so.
   * So this checks the property that actually matters - the two hulls a player compares in a fight
   * emit identical Stats and identical Durability - rather than trusting the shared reference. */
  {
    const byBlock = new Map();
    HULLS.filter(h => h.realStats).forEach(h => {
      if (!byBlock.has(h.realStats)) byBlock.set(h.realStats, []);
      byBlock.get(h.realStats).push(h);
    });
    byBlock.forEach(group => {
      if (group.length < 2) return;
      const cards_ = group.map(h => shipsAll.find(c => c.cardGUID === h.g)).filter(Boolean);
      const ref = cards_[0];
      cards_.slice(1).forEach(c => {
        if (JSON.stringify(c.Stats) !== JSON.stringify(ref.Stats))
          errs.push(`Ship ${c.cardGUID} (${c.Faction}) and ${ref.cardGUID} (${ref.Faction}) share one `
            + `realStats block but emit DIFFERENT Stats - one faction's capital outperforms the other`);
        if (c.Durability !== ref.Durability)
          errs.push(`Ship ${c.cardGUID} (${c.Faction}) and ${ref.cardGUID} (${ref.Faction}) share one `
            + `realStats block but their repair pools differ (${c.Durability} vs ${ref.Durability}) - `
            + `Durability is keyed per PREFAB in DURABILITY, which the shared block does not reach`);
      });
    });
  }

  /* A BAY A PLAYER CANNOT FILL IS A CONTENT GAP, NOT A DATA DEFECT - reported once per
   * (slot type, tier) cell, not once per slot.
   *
   * This used to be an error per slot. That was right while the slot table was hand-written, where
   * an unfillable slot meant somebody had invented a slot type. It is wrong now that the layouts
   * come from the live-server dump: the real hulls carry hull / computer / engine / avionics slots,
   * we have simply never authored a single module to put in them, and the previous rule turned that
   * one missing feature into 380 identical error lines that failed the build.
   *
   * TIER IS PART OF THE CELL because it is part of the lock. ContainerVisitor refuses a system
   * whose Tier is not exactly the active ship's, and the store's equipable-only filter is forced on
   * in the equip view - so "we stock SOME role modules" says nothing about whether a tier-4 carrier
   * can fill its role bay. Reporting per type alone is what let 84 empty paint bays sit behind two
   * tier-1 event skins without a word.
   *
   * SCOPED TO HULLS A PLAYER CAN REACH: every hull in a ShipList plus the Advanced twin each one
   * chains to. An NPC hull's bays are filled by guid from ShipConfigTemplates, which never consults
   * slot type or tier (BLOCK-5) and is checked by G13 instead; counting them here would report the
   * outposts' 24 tier-4 weapon bays as missing content when the dump has no weapon/t4 family at all
   * and their configs name tier-3 guns that install fine. */
  const shipByGuid = new Map(shipsAll.map(c => [c.cardGUID, c]));
  const flyable = (() => {
    const seen = new Set();
    cards.filter(c => c.cardView2 === 'ShipList').forEach(l => (l.shipCardGuids || []).forEach(g => {
      for (let s = shipByGuid.get(g); s && !seen.has(s.cardGUID); s = shipByGuid.get(s.nextShipCardGuid))
        seen.add(s.cardGUID);
    }));
    return [...seen].map(g => shipByGuid.get(g));
  })();
  const stockedCells = new Set(sysAll.map(c => `${c.SlotType}/t${c.Tier}`));
  const gapCells = new Map();
  flyable.forEach(c => (c.Slots || []).forEach(s => {
    if (!SLOT_TYPES.includes(s.SystemType) || s.SystemType === 'undefined') return;
    const cell = `${s.SystemType}/t${c.Tier}`;
    if (stockedCells.has(cell)) return;
    if (!gapCells.has(cell)) gapCells.set(cell, { bays: 0, hulls: new Set() });
    gapCells.get(cell).bays++;
    gapCells.get(cell).hulls.add(c.cardGUID);
  }));
  [...gapCells.entries()].sort().forEach(([cell, g]) => {
    console.warn(`CONTENT GAP: ${g.bays} bay(s) of "${cell}" across ${g.hulls.size} player-flyable hull(s) `
      + `(${[...g.hulls].sort((a, b) => a - b).join(', ')}), and the catalogue has no ShipSystem of that `
      + `slot type at that tier - those bays render empty and nothing can be fitted to them.`);
  });
  sysTypes.forEach(t => {
    if (!shipsAll.some(c => (c.Slots || []).some(s => s.SystemType === t)))
      errs.push(`ShipSystem type ${t} exists but no ship declares a ${t} slot - unequippable`);
  });

  /* ---- EVERY FLYABLE PAINT BAY HAS SOMETHING TO PUT IN IT.
   *
   * Per HULL CARD, because for a paint the tier is the loose half of the lock and the hull is the
   * tight one. ItemList.FilterByTier (ItemList.cs:129) does not even look at Tier for an item
   * carrying a PaintCard: it admits the paint when the ACTIVE SHIP's guid equals the paint's
   * shipCardGuid or equals the NextCard of the card at that guid, which is how one paint pointed at
   * a level-1 hull covers that hull and its Advanced twin and nothing else. CheckSystemForSlot
   * (ShopWindow.cs:1039) then demands PaintCard.shipCard.Equals(ActiveShip.Card), and ShipCard
   * .Equals compares Tier + ShipRoleDeprecated + HangarID - per family, not per tier, again.
   * So the cell check above cannot see this: ONE tier-2 paint keeps "ship_paint/t2" stocked while
   * fifteen of the sixteen tier-2 hull cards still have nothing to wear. That is exactly how two
   * whole Cylon families ended up paintless with a green build.
   *
   * Faction is not part of the test. It is guaranteed by construction (gen-paints-real.js takes a
   * paint's faction from the hull it points at, which is the only way ShopWindow.cs:1010-1013 and
   * ItemList.cs:144 can both let it through) and G16 already checks that everything sharing a hull
   * family agrees. */
  {
    const painted = new Set();         // hull guids some emitted paint points at
    const paintGuids = new Set(cards.filter(c => c.cardView2 === 'ShipPaint').map(c => c.cardGUID));
    cards.filter(c => c.cardView2 === 'ShipPaint').forEach(p => {
      const target = shipByGuid.get(p.shipCardGuid);
      if (!target) {
        errs.push(`ShipPaint ${p.cardGUID}: shipCardGuid ${p.shipCardGuid} has no Ship card - ItemList.cs:129 dereferences it on every hangar filter pass and it fits no hull at all`);
        return;
      }
      painted.add(target.cardGUID);
      if (target.nextShipCardGuid) painted.add(target.nextShipCardGuid);
    });
    const withBay = flyable.filter(c => (c.Slots || []).some(s => s.SystemType === 'ship_paint'));
    const bare = withBay.filter(c => !painted.has(c.cardGUID));
    bare.forEach(c => errs.push(
      `Ship ${c.cardGUID} (tier ${c.Tier}) has a ship_paint bay and NO paint points at it - the bay `
      + `is unfillable, and the per-cell check above cannot see it because any other paint at tier `
      + `${c.Tier} satisfies that cell`));
    console.log(`  paint coverage: ${withBay.length - bare.length}/${withBay.length} player-flyable `
      + `hull card(s) with a ship_paint bay have at least one fittable paint`);

    /* ---- AND A PAINT NEVER CARRIES ShipObjectKeyRestrictions.
     * The dump's own paints all carry one, so a future re-import will offer them, and now that
     * restrictions are live for every other family the obvious move is to "finish the job". Do not.
     * The per-hull lock for a paint is shipCardGuid, checked immediately above and at ItemList.cs
     * :129, ShopWindow.cs:1039 and GUIShopPaperDoll.cs:159. A restriction list adds nothing the
     * player can see - GuiAdvancedRequirementsPanel.cs:60-77 renders the PaintCard's ship name
     * instead and skips the restriction block entirely - and can only subtract: the server gate at
     * ContainerVisitor.java:134-135 applies to a paint like anything else, so an entry that does not
     * exactly match the hull shipCardGuid already names is a paint nothing can wear. */
    cards.filter(c => c.cardView2 === 'ShipSystem' && paintGuids.has(c.cardGUID)
                   && (c.ShipObjectKeyRestrictions || []).length).forEach(c => errs.push(
      `ShipSystem ${c.cardGUID} carries a ShipPaint card AND ShipObjectKeyRestrictions - a paint's `
      + `per-hull lock is shipCardGuid; the restriction list is invisible in the tooltip and can `
      + `only make the paint unwearable`));
  }

  /* The server keys the hangar by serverId and copies serverId from ShipCard.HangarID at purchase,
   * so two sellable ships of one faction sharing a HangarID overwrite each other in the hangar. */
  cards.filter(c => c.cardView2 === 'ShipList').forEach(sl => {
    const seenIds = new Map();
    (sl.shipCardGuids || []).forEach(g => {
      const s = cards.find(x => x.cardGUID === g && x.cardView2 === 'Ship');
      if (!s) return;
      if (seenIds.has(s.HangarID))
        errs.push(`ShipList ${sl.cardGUID}: guids ${seenIds.get(s.HangarID)} and ${g} both use HangarID ${s.HangarID} - the second overwrites the first`);
      seenIds.set(s.HangarID, g);
    });
  });

  /* Price VALUES must be DYADIC RATIONALS - an integer plus some sum of negative powers of two.
   *
   * Three pieces of arithmetic run over the same number and they have to land on the same answer:
   * the server charges ceil(value * count) (ContainerVisitor:245) and credits (long)(value * count)
   * on a sale (:576); the client refuses the purchase when Count < value * count with an INTEGER
   * Count (Price.cs:70); and the tooltip prints the raw product. Any integer count of a dyadic
   * value is computed exactly in binary floating point, so all three agree. 0.03 is the canonical
   * failure - 0.03 * 33 is 0.9900000000000001, and the three sides round it three ways.
   *
   * The rule used to be "integer, or a negative power of two", which is the same idea drawn too
   * tight: it rejected 1.5 tylium a round and 22.5 cubits a repair cell, which are 19 of the
   * original's own prices and are perfectly exact. Sums of powers of two are admitted now; a
   * denominator finer than 2^20 is not, because nothing in a shop is priced in millionths and the
   * cutoff is what stops the test degenerating into "is representable at all".
   *
   * Values BELOW 1 get a warning as well as the test. GUIShopConfirmWindow.GetPurchaseUnit:618-628
   * takes the smallest price component and, when it is under 1, makes the buy arrow step
   * round(1/value) - so 1/2^n steps to a whole unit of currency and anything else (3/4 steps by 1
   * and charges 0.75) leaves the server rounding a fraction on every click. It is a rounding
   * nuisance, not a disagreement, so it must not fail the build: the dump prices standard rounds
   * to sell at 0.75 tylium each.
   *
   * And at most TWO currency components: the shop row has exactly two icon/label pairs and the
   * loop silently overwrites the second. */
  /* Zero is allowed and is not the same as an absent key. 136 of the dump's own level cards carry
   * Cubits at exactly 0, and ContainerVisitor.upgradeSystemByPack reads that key - so removing the
   * zero and synthesising one are both wrong in different directions, and the rule must not push
   * anyone toward either. */
  const priceOk = v => v >= 0 && Number.isInteger(v * 1048576);
  cards.filter(c => c.cardView2 === 'Price').forEach(c => {
    ['BuyPrice', 'UpgradePrice', 'SellPrice'].forEach(k => {
      const items = (c[k] && c[k].items) || {};
      Object.entries(items).forEach(([g, v]) => {
        if (!priceOk(v))
          errs.push(`Price ${c.cardGUID}.${k}[${g}] = ${v} is neither an integer nor a negative power of two nor a sum of the two - ceil() vs raw float disagree`);
        else if (v > 0 && v < 1 && !Number.isInteger(1 / v))
          console.warn(`WARN Price ${c.cardGUID}.${k}[${g}] = ${v}: under 1 and not 1/2^n, so the `
            + `buy arrow steps by round(1/${v}) = ${Math.round(1 / v)} and each step charges `
            + `${v * Math.round(1 / v)} - the server rounds that, the tooltip does not`);
      });
      if (Object.keys(items).length > 2)
        errs.push(`Price ${c.cardGUID}.${k} has ${Object.keys(items).length} currency components - the shop row only renders two`);
    });
    // sellItem removes the item and THEN credits getSellItems(sellPrice) - an empty SellPrice with
    // CanBeSold true destroys the item for nothing.
    const nSell = Object.keys((c.SellPrice && c.SellPrice.items) || {}).length;
    if (c.CanBeSold && nSell === 0)
      errs.push(`Price ${c.cardGUID}: CanBeSold with an empty SellPrice - selling destroys the item for zero`);
  });

  /* ============================================================ ITEM AND ABILITY INTEGRITY  G1-G17
   *
   * The equipment pass multiplies the catalogue roughly sevenfold and adds a ten-level upgrade
   * ladder, so most of what follows is vacuous on today's content and has teeth the moment a
   * content package lands. That is deliberate: a rule written after the bug it would have caught is
   * a rule that already cost a debugging session. Where a rule IS live today it says so.
   *
   * Everything here is derived from the server's own sources - the Java card classes, the Java
   * enums, the ability factory's switch, the shipped ShipConfigTemplates - rather than from lists
   * kept in this file. A hardcoded list stops covering the thing it was written for as soon as the
   * source moves, and does it silently.
   */
  {
    const sysCards = cards.filter(c => c.cardView2 === 'ShipSystem');
    const abCards = cards.filter(c => c.cardView2 === 'ShipAbility');
    const conCards = cards.filter(c => c.cardView2 === 'ShipConsumable');
    const shipCardList = cards.filter(c => c.cardView2 === 'Ship');
    const priceOfGuid = new Map(cards.filter(c => c.cardView2 === 'Price').map(c => [c.cardGUID, c]));
    const buyCount = p => Object.keys((p && p.BuyPrice && p.BuyPrice.items) || {}).length;

    /* ---- G17  EVERY CARD CARRIES EVERY FIELD ITS JAVA CLASS DECLARES, AND EVERY ENUM-TYPED FIELD
     * NAMES A REAL CONSTANT.
     *
     * Gson allocates through UnsafeAllocator, so a field the JSON omits is left null (or at the
     * primitive default) and no constructor ever runs to fix it. The card writers dereference their
     * fields unguarded - ShopItemCard.write does bw.writeByte(shopItemType.value) - so an omitted
     * reference field or an enum name that is not a real constant is an NPE inside the catalogue
     * push, which the server answers by closing that player's socket mid-session with nothing on
     * the client to explain it.
     *
     * Both the view -> class map and the field list are parsed out of the server, not restated
     * here: CardBuilder's own deserialize switch gives the class, and the class's source gives the
     * fields and their types. Only depth-zero declarations count, so the nested Sticker / RoomDoor /
     * RoomNpc / AvatarIndex helper classes do not leak in as phantom card fields.
     *
     * LIVE TODAY: this is the rule that catches ItemType 'Consumable' on the seven LOOT_EXTRAS
     * Price cards - 'Consumable' is a ShopCategory constant and not a ShopItemType one. */
    {
      const CARD_SRC = path.join(CORE_SRC, 'templates/cards');
      const viewClass = (() => {
        try {
          const src = fs.readFileSync(path.join(CORE_SRC, 'templates/templates/readers/CardBuilder.java'), 'utf8');
          const m = {};
          for (const x of src.matchAll(/case\s+(\w+)\s*->\s*card\s*=\s*context\.deserialize\(json,\s*(\w+)\.class\)/g))
            m[x[1]] = x[2];
          return Object.keys(m).length ? m : null;
        } catch { return null; }
      })();

      const fieldCache = new Map();
      const declaredFields = (cls, depth = 0) => {
        if (fieldCache.has(cls)) return fieldCache.get(cls);
        let src;
        try { src = stripJavaComments(fs.readFileSync(path.join(CARD_SRC, cls + '.java'), 'utf8')); }
        catch { return null; }
        const open = src.indexOf('{', src.search(/\bclass\s+\w+/));
        // Keep only the text at brace depth zero inside the class body: that excludes method
        // bodies, constructors and nested classes in one pass.
        let d = 0, shallow = '';
        for (let i = open + 1; i < src.length; i++) {
          const ch = src[i];
          if (ch === '{') { d++; continue; }
          if (ch === '}') { if (d === 0) break; d--; continue; }
          if (d === 0) shallow += ch;
        }
        const out = [];
        const re = /(?:@SerializedName\(\s*"([^"]+)"\s*\)\s*)?(?:public|protected|private)\s+(?!static\b)(?:final\s+)?([\w.]+(?:\s*<[^;]*?>)?(?:\s*\[\s*\])?)\s+(\w+)\s*(?:=[^;]*)?;/g;
        for (const m of shallow.matchAll(re))
          out.push({ json: m[1] || m[3], type: m[2].replace(/\s+/g, '') });
        const ext = /\bclass\s+\w+\s+extends\s+(\w+)/.exec(src);
        if (ext && depth < 5) { const sup = declaredFields(ext[1], depth + 1); if (sup) out.push(...sup); }
        if (depth === 0) fieldCache.set(cls, out);
        return out;
      };
      // Set<X> / List<X> / X[] all check their ELEMENT type; the wrapper is irrelevant here.
      const elemType = t => ((t.match(/<([\w.]+)>/) || [])[1] || t.replace(/\[\]$/, '')).replace(/^.*\./, '');

      JAVA_ENUM_PROBLEMS.forEach(p => errs.push(`enum index: ${p}`));
      if (!viewClass) errs.push('could not parse CardBuilder.java\'s deserialize switch - refusing to emit cards whose field lists were never checked');
      else if (!JAVA_ENUMS) errs.push('could not index the server\'s enums - refusing to emit enum-valued fields blind');
      else {
        const views = new Set(cards.map(c => c.cardView2));
        views.forEach(v => {
          const cls = viewClass[v];
          if (!cls) { errs.push(`card view ${v} has no arm in CardBuilder's deserialize switch - every card of that view deserialises to null and the whole catalogue load aborts`); return; }
          const fields = declaredFields(cls);
          if (!fields || !fields.length) { errs.push(`could not parse the field list of ${cls}.java (view ${v}) - refusing to emit ${v} cards unchecked`); return; }
          cards.filter(c => c.cardView2 === v).forEach(c => {
            fields.forEach(f => {
              if (!(f.json in c)) {
                errs.push(`${v} ${c.cardGUID}: no "${f.json}" field, which ${cls} declares as ${f.type} - Gson leaves it null and the card writer NPEs, closing the player's socket`);
                return;
              }
              const et = elemType(f.type);
              if (!JAVA_ENUMS.has(et)) return;
              const vals = Array.isArray(c[f.json]) ? c[f.json] : [c[f.json]];
              vals.forEach(x => {
                if (typeof x !== 'string')
                  errs.push(`${v} ${c.cardGUID}.${f.json}: ${JSON.stringify(x)} is not a string, but ${cls} declares it as ${et} - Gson needs the enum's NAME`);
                else if (!JAVA_ENUMS.get(et).has(x))
                  errs.push(`${v} ${c.cardGUID}.${f.json}: "${x}" is not a ${et} constant - null enum, NPE on write, socket closed`);
              });
            });
          });
        });
      }
    }

    /* ---- G1  A ShipSystem NEEDS A GUI CARD AT ITS OWN GUID.
     * GameItemCard.Read fetches GUI and Price by the item's own guid and IsLoaded.Depend()s on
     * both. The Price half is already checked above; without the GUI half the shop row and the hold
     * tile never finish loading, and there is no timeout on the client. */
    sysCards.forEach(c => {
      if (!hasView(c.cardGUID, 'GUI'))
        errs.push(`ShipSystem ${c.cardGUID}: no GUI card at its own guid - GameItemCard.Read depends on it and the row never finishes loading`);
    });

    /* ---- G3  SLOT IDS ARE UNIQUE WITHIN ONE HULL.
     * ShipSlots.addSlot keys by SlotId, so a duplicate silently overwrites the earlier slot: the
     * hull ends up with fewer bays than its own card lists and the paperdoll draws a control for a
     * slot the server does not have. */
    shipCardList.forEach(c => {
      const seenIds = new Set();
      (c.Slots || []).forEach(s => {
        if (seenIds.has(s.SlotId))
          errs.push(`Ship ${c.cardGUID}: SlotId ${s.SlotId} appears twice - ShipSlots.addSlot keys by SlotId, so the second silently replaces the first`);
        seenIds.add(s.SlotId);
      });
    });

    /* ---- G4  A PRICED SYSTEM MUST BE ONE THE SHOP CAN ACTUALLY STOCK.
     * ShopProtocol.setupShop:258 stocks Level 1 and avionics unconditionally, and :267-271 also
     * stocks Level 10 and Level 15 when starterParams().testingMode() is on, which the %dev profile
     * sets. So a BuyPrice at any other level is money quoted for an item the store never lists.
     *
     * Levels 10 and 15 warn rather than error because they ARE reachable on a dev profile, and the
     * reachable case is the dangerous one: 75 of the dump's 219 level-10 cards price themselves in
     * tylium BELOW their own SellPrice. W5 answered that by shipping BuyPrice on level 1 only, so
     * this branch is silent today and stays as the tripwire for a future import that reinstates a
     * mid-ladder price. Do not "fix" a level-10 warning by inventing a price above the sell value -
     * an absent BuyPrice already refuses the sale at ContainerVisitor:695-698. */
    sysCards.forEach(c => {
      if (!buyCount(priceOfGuid.get(c.cardGUID)) || c.Level === 1 || c.SlotType === 'avionics') return;
      if (c.Level === 10 || c.Level === 15)
        console.warn(`WARN ShipSystem ${c.cardGUID}: Level ${c.Level} with a non-empty BuyPrice - invisible in the store on a normal profile, but ShopProtocol.java:267-271 stocks it under testingMode(), where a dump-priced upgrade level can be worth more sold than bought`);
      else
        errs.push(`ShipSystem ${c.cardGUID}: Level ${c.Level} with a non-empty BuyPrice - ShopProtocol.setupShop stocks only Level 1, avionics, and (under testingMode) 10 and 15, so this is priced dead stock`);
    });

    /* ---- G5  THE UPGRADE CHAIN IS ACYCLIC, GAPLESS AND FULLY CARDED.
     * Catalogue.java:119 and RefundProcessor:55 both WALK the NextCard chain to its end. A cycle is
     * an infinite loop inside a request thread; a link with no card behind it is an NPE in the
     * refund path and a client that waits forever for a card that never arrives. Level must step by
     * exactly one because ContainerVisitor charges THIS card's UpgradePrice and installs the next
     * one, so a skipped level is a level the player pays for and never gets.
     *
     * LIVE: 220 chains of ten rungs each (the 219 imported systems and the C-31) plus 356 items
     * that do not ladder. Everything else in the catalogue is still Level 1 / MaxLevel 1 / next 0
     * and passes the same rules trivially.
     *
     * The MaxLevel ceiling is READ OUT OF PlayerProtocol, not restated here, because the server's
     * own cheat check is the real limit: a card claiming MaxLevel 15 would draw fifteen squares in
     * the client's upgrade counter and then be refused at the eleventh with nothing but a server
     * log line to say why. The dump has all fifteen rungs and re-importing them is a one-constant
     * change in gen-systems-real.js, so this needs to be a build failure and not a comment. */
    {
      const upgradeCap = (() => {
        try {
          const m = /\bnewLevel\s*>\s*(\d+)\b/.exec(stripJavaComments(
            fs.readFileSync(path.join(CORE_SRC, 'core/protocols/player/PlayerProtocol.java'), 'utf8')));
          return m ? Number(m[1]) : null;
        } catch { return null; }
      })();
      if (upgradeCap === null)
        errs.push('could not find PlayerProtocol\'s "newLevel > N" upgrade cheat check - refusing to ship an upgrade ladder whose ceiling was never checked against the server\'s');

      const sysByGuid = new Map(sysCards.map(c => [c.cardGUID, c]));
      sysCards.forEach(c => {
        if (upgradeCap !== null && c.MaxLevel > upgradeCap)
          errs.push(`ShipSystem ${c.cardGUID}: MaxLevel ${c.MaxLevel} but PlayerProtocol refuses any upgrade to a level above ${upgradeCap} as a cheat - the top ${c.MaxLevel - upgradeCap} rung(s) are unreachable and the client still draws them`);
        if ((c.nextShipSystemCardGuid === 0) !== (c.Level === c.MaxLevel))
          errs.push(`ShipSystem ${c.cardGUID}: Level ${c.Level}/MaxLevel ${c.MaxLevel} disagrees with nextShipSystemCardGuid ${c.nextShipSystemCardGuid} - the chain either dead-ends early or runs past its own MaxLevel`);
        if (!c.nextShipSystemCardGuid) return;
        const next = sysByGuid.get(c.nextShipSystemCardGuid);
        if (!next) {
          errs.push(`ShipSystem ${c.cardGUID}: nextShipSystemCardGuid ${c.nextShipSystemCardGuid} has no ShipSystem card - Catalogue.java:119 walks this chain at boot and RefundProcessor:55 NPEs on it`);
          return;
        }
        ['GUI', 'Price'].forEach(v => {
          if (!hasView(next.cardGUID, v))
            errs.push(`ShipSystem ${c.cardGUID}: upgrades to ${next.cardGUID}, which has no ${v} card - the upgraded item never finishes loading`);
        });
        if (next.Level !== c.Level + 1)
          errs.push(`ShipSystem ${c.cardGUID}: Level ${c.Level} upgrades to ${next.cardGUID} at Level ${next.Level} - must be exactly +1 or the player pays for a level they never receive`);
        if (next.MaxLevel !== c.MaxLevel)
          errs.push(`ShipSystem ${c.cardGUID}: MaxLevel ${c.MaxLevel} but its successor ${next.cardGUID} says ${next.MaxLevel} - the client draws the ladder from whichever card it happens to hold`);
        /* ContainerVisitor charges THIS card's UpgradePrice and installs the next one. An empty
         * UpgradePrice is not "free by design" anywhere in the original's data - it is a level the
         * player gets for nothing, on an item that then sells for the higher level's price. */
        const p = priceOfGuid.get(c.cardGUID);
        if (p && !Object.keys((p.UpgradePrice && p.UpgradePrice.items) || {}).length)
          errs.push(`ShipSystem ${c.cardGUID}: upgradeable to ${next.cardGUID} but its Price card has an empty UpgradePrice - ContainerVisitor charges nothing and the level is free`);
        // Walk to the end from here; a cycle shows up as a repeat within one walk.
        const walked = new Set([c.cardGUID]);
        let cur = next;
        while (cur && cur.nextShipSystemCardGuid) {
          if (walked.has(cur.cardGUID)) {
            errs.push(`ShipSystem ${c.cardGUID}: its upgrade chain loops back to ${cur.cardGUID} - Catalogue.java:119 never terminates and the server hangs at boot`);
            break;
          }
          walked.add(cur.cardGUID);
          cur = sysByGuid.get(cur.nextShipSystemCardGuid);
        }
      });

      /* ---- G5b  A RUNG FITS ITS OWN LEVEL'S ABILITY.
       * Everything a weapon does lives on its ability card - damage, range, cooldown, power cost -
       * so a level-10 gun carrying the level-1 ability guid IS a level-1 gun. It would load, equip
       * and fire; nothing anywhere would complain; the player would just have paid nine upgrades
       * for numbers that never moved. The only rule that catches it is this one, and it is cheap
       * because the dump agrees the two Levels track on all 15 rungs of all 234 of its chains. */
      const abByGuid = new Map(abCards.map(c => [c.cardGUID, c]));
      sysCards.forEach(c => (c.shipAbilityCards || []).forEach(g => {
        const a = abByGuid.get(g);
        if (a && a.Level !== c.Level)
          errs.push(`ShipSystem ${c.cardGUID} is Level ${c.Level} but fits ability ${g}, which is Level ${a.Level} - the item's whole stat block comes off the ability card, so this rung performs at Level ${a.Level}`);
      }));
    }

    /* ---- G6/G7  WIRE-FORMAT AND DIVISOR LIMITS ON A ShipSystem.
     * MaxCountPerShip is written as a byte, so 256 becomes 0 - which means UNLIMITED
     * (ShopWindow.cs:1043 only applies the cap when it is > 0), turning a one-per-ship item into a
     * fill-every-bay item. Durability is the DIVISOR in ShipSlot.quality(); at 0 the quotient is
     * NaN, every comparison against it is false, and the repair cost calculator charges nothing. */
    sysCards.forEach(c => {
      if (!(Number.isInteger(c.MaxCountPerShip) && c.MaxCountPerShip >= 0 && c.MaxCountPerShip <= 255))
        errs.push(`ShipSystem ${c.cardGUID}: MaxCountPerShip ${c.MaxCountPerShip} does not survive writeByte (0..255) - 256 wraps to 0, which means unlimited`);
      if (!(Number(c.Durability) > 0))
        errs.push(`ShipSystem ${c.cardGUID}: Durability ${c.Durability} - ShipSlot.quality() divides by it, so 0 gives NaN and repair becomes free`);
    });

    /* ---- G9  AN ABILITY'S ActionType MUST BE ONE AbilityActionFactory CAN BUILD.
     * The factory's default arm throws IllegalArgumentException, and the throw escapes through
     * AbilityCastRequestQueue.run into Sector.run's per-tick catch - which abandons timerUpdater,
     * spaceObjectRemover and sectorZoneManagement for that tick FOR EVERYONE IN THE SECTOR. One
     * unbuildable ability is a sector-wide stutter every time anybody presses the button.
     * The set is PARSED from the factory's own case labels, so adding an arm ships the abilities
     * that needed it and removing one fails this build instead of arming the outage. */
    {
      const dispatchable = (() => {
        try {
          const src = stripJavaComments(fs.readFileSync(path.join(CORE_SRC,
            'core/sector/management/abilities/AbilityActionFactory.java'), 'utf8'));
          // Scoped to the one switch over `type` and stopped at its default arm, so a second
          // switch added to this file later cannot silently widen the accepted set.
          const start = src.search(/\bswitch\s*\(\s*type\s*\)/);
          if (start < 0) return null;
          const end = src.indexOf('default', start);
          const body = src.slice(start, end === -1 ? src.length : end);
          const out = new Set();
          for (const m of body.matchAll(/\bcase\s+([A-Za-z0-9_,\s]+?)\s*->/g))
            m[1].split(',').forEach(s => { if (s.trim()) out.add(s.trim()); });
          return out;
        } catch { return null; }
      })();
      const ACTION_TYPES = JAVA_ENUMS && JAVA_ENUMS.get('AbilityActionType');
      if (!dispatchable || dispatchable.size < 14)
        errs.push(`could not parse AbilityActionFactory's case labels (got ${dispatchable ? dispatchable.size : 0}) - refusing to emit abilities whose dispatch was never checked`);
      else {
        // A case label that is not a real enum constant means the parse drifted, not that the
        // server grew a new type; fail rather than quietly widening the accepted set.
        if (ACTION_TYPES) dispatchable.forEach(t => {
          if (!ACTION_TYPES.has(t))
            errs.push(`AbilityActionFactory has a case for "${t}", which is not an AbilityActionType constant - the case-label parse has drifted and this rule is no longer checking anything`);
        });
        abCards.forEach(c => {
          if (!dispatchable.has(c.ActionType))
            errs.push(`ShipAbility ${c.cardGUID}: ActionType ${c.ActionType} has no arm in AbilityActionFactory - create() throws and the exception truncates the whole sector's tick every time this ability is cast`);
        });
      }
    }

    /* ---- G10  TargetTiers MUST BE NON-EMPTY.
     * ShipAbility.canAffect tests membership, so an empty set matches no ship at any tier: the
     * ability is castable, costs power, and can never resolve against a target. */
    abCards.forEach(c => {
      if (!Array.isArray(c.TargetTiers) || !c.TargetTiers.length)
        errs.push(`ShipAbility ${c.cardGUID}: TargetTiers is empty - the ability can never affect a Ship of any tier`);
    });

    /* ---- G10b  A MISSILE ABILITY MUST FULLY DESCRIBE THE PROJECTILE IT SPAWNS.
     *
     * FireMissileAction:65-70 copies the ability's whole ItemBuffAdd onto the spawned object and
     * then reads Speed and MaxHullPoints straight back off it through nullable getters, so an
     * absent key is an unboxing NPE on the FIRST SHOT. LifeTime is worse than that: it arms a timer
     * that re-throws every tick for as long as the round would have lived. And MovementSimulation
     * .moveToDirection:60 divides by RollMaxSpeed, so a zero in any of the six rotation stats puts
     * NaN into the Euler3 constructor and throws inside SectorMovementUpdater every frame - which
     * is exactly why the Rocket Pack is on the drop list rather than in the catalogue.
     *
     * DrainLow is the other half of the rule and it points the other way. DamageMediator
     * .dealDamageFromMissile:209-221 decides between the single-target path and the torpedo AoE
     * path purely on whether the projectile carries DrainLow, so a plain missile that happens to
     * have one silently stops damaging what it hit. Torpedoes are meant to be on that path and are
     * exempt. (A consumable cannot introduce the key: applyStatsMultToIfBonusExistsInApplyOn and
     * applyStatsAddTo both only write keys the target already has.) */
    {
      const MISSILE_ACTIONS = ['FireMissle', 'FireTorpedo', 'FireHeavyMissile', 'FireLightMissile'];
      const NEEDED = ['Speed', 'MaxHullPoints', 'LifeTime', 'YawMaxSpeed', 'YawAcceleration',
                      'PitchMaxSpeed', 'PitchAcceleration', 'RollMaxSpeed', 'RollAcceleration'];
      abCards.filter(c => MISSILE_ACTIONS.includes(c.ActionType)).forEach(c => {
        const s = (c.ItemBuffAdd || {}).stats || {};
        const missing = NEEDED.filter(k => !s[k]);
        if (missing.length)
          errs.push(`ShipAbility ${c.cardGUID} (${c.ActionType}): ItemBuffAdd has no non-zero ${missing.join(', ')} - the spawned projectile NPEs or divides to NaN inside the sector tick on the first shot`);
        if (c.ActionType !== 'FireTorpedo' && s.DrainLow !== undefined)
          errs.push(`ShipAbility ${c.cardGUID} (${c.ActionType}): carries DrainLow, which routes it into dealDamageFromMissile's torpedo AoE branch - the missile hits and does nothing`);
      });
    }

    /* ---- G11  ConsumableOption 'Using' DEMANDS AMMUNITION THAT EXISTS AND CAN BE BOUGHT.
     * With 'Using' the weapon refuses to fire unless a matching countable is in the slot, and the
     * refusal is silent - the trigger simply does nothing. The demand set is COMPUTED from the
     * emitted abilities rather than restated, so it tracks whatever the ammo packages ship.
     * ItemList.cs:135 accepts a countable when Card.Tier == tier || Card.Tier == 0, so a tier-0
     * consumable satisfies every tier.
     *
     * LIVE. 78 of the 133 imported abilities are 'Using' and between them demand 30 distinct
     * (ConsumableType, ConsumableTier) pairs. Both sides of that number are derived - the demand
     * from the emitted ability cards here, and the supply from the emitted ShipConsumable cards -
     * so neither the pair count nor the roster is written down anywhere it could go stale. The
     * cross-check below compares this file's count against the one gen-systems-real.js measured
     * independently out of the dump; they are two different derivations of the same fact, and a
     * disagreement means a system or a whole family stopped being emitted. */
    abCards.filter(c => c.ConsumableOption === 'Using').forEach(a => {
      const match = conCards.filter(k => k.ConsumableType === a.ConsumableType
        && (k.Tier === a.ConsumableTier || k.Tier === 0));
      if (!match.length)
        errs.push(`ShipAbility ${a.cardGUID}: ConsumableOption Using with ConsumableType ${a.ConsumableType} / ConsumableTier ${a.ConsumableTier}, and no ShipConsumable matches - the weapon silently cannot fire`);
      else if (!match.some(k => buyCount(priceOfGuid.get(k.cardGUID))))
        errs.push(`ShipAbility ${a.cardGUID}: its ammunition (ConsumableType ${a.ConsumableType} tier ${a.ConsumableTier}, guid(s) ${match.map(k => k.cardGUID).join('/')}) has an empty BuyPrice, so the shop never stocks it and the weapon can never be loaded`);
    });

    /* ---- G11b  WARN: a stocked consumable that no emitted ability can load.
     * Not an error - mines and jump transponders are real, sellable, and drop from loot even while
     * every system that fires them sits on the drop list. The point is that the set is reviewed
     * rather than discovered, which means the list has to stay short enough to read: three classes
     * of countable are excluded because their consumer provably is not an ability slot.
     *   - Augments and Category Resource: consumed by the shop or by UseAugment.
     *   - Anything setupShop (ShopProtocol.java:227-232) never stocks. It adds only Consumable,
     *     Resource and Augment, so the one Category None card is not on sale whatever its price.
     *   - ItemType Radio and TechAnalysis: their consumers are protocols, not slots - fleet chat
     *     and ContainerVisitor.augmentMassActivationIsFineAndRemove respectively. */
    const SLOTLESS_ITEM_TYPES = new Set(['Radio', 'TechAnalysis']);
    const STOCKED_CATEGORIES = new Set(['Consumable', 'Resource', 'Augment']);
    {
      const demanded = new Set();
      abCards.forEach(a => { if (a.ConsumableOption === 'Using') demanded.add(`${a.ConsumableType}/${a.ConsumableTier}`); });
      /* Cross-check against gen-systems-real.js's own count, measured out of the dump by a
       * different route. Never assert a literal here: the number is 30 today and is a property of
       * which systems survived the import, so hardcoding it would turn a real regression - a
       * dropped weapon family taking its demand with it - into a passing build. */
      if (demanded.size !== new Set(SYSTEMS_REAL.filter(r => r.ability
          && r.ability.dumpConsumableOption === 'Using')
        .map(r => `${r.ability.consumableType}/${r.ability.consumableTier}`)).size)
        errs.push(`demanded (ConsumableType, ConsumableTier) pairs: this file derives ${demanded.size} `
          + `from the emitted ability cards, systems-real.js derives a different count from the dump - `
          + `an ability family is being emitted with the wrong pairing key, or has stopped being emitted`);
      console.log(`  ammunition: ${demanded.size} demanded (ConsumableType, ConsumableTier) pair(s) `
        + `across ${abCards.filter(a => a.ConsumableOption === 'Using').length} 'Using' abilities, all supplied`);
      const orphan = conCards.filter(k => {
        if (k.IsAugment) return false;
        const p = priceOfGuid.get(k.cardGUID);
        if (!p || !buyCount(p) || p.Category === 'Resource') return false;
        if (!STOCKED_CATEGORIES.has(p.Category) || SLOTLESS_ITEM_TYPES.has(p.ItemType)) return false;
        return !demanded.has(`${k.ConsumableType}/${k.Tier}`) && !demanded.has(`${k.ConsumableType}/0`);
      });
      if (orphan.length)
        console.warn(`WARN: ${orphan.length} stocked ShipConsumable(s) that no emitted ability demands - `
          + `they are buyable and sellable but no weapon can load them: ${orphan.map(k => k.cardGUID).join(', ')}`
          + (demanded.size ? '' : `. NOTE every emitted ability is still ConsumableOption NotUsing, so the demand set is `
            + `empty and this list is the whole priced consumable roster rather than a genuine orphan set. It becomes `
            + `meaningful when USING_ENABLED flips in gen-systems-real.js.`));
    }

    /* ---- G11c  NUCLEAR AMMUNITION MUST ROUTE TO A PROJECTILE THAT EXISTS.
     * FireMissileAction.getMissileGUID:104-129 picks the projectile guid off the loaded countable:
     * effectType DamageNuclear with no DamageHigh goes to MissileTorpedo, DamageHigh exactly 4.0 to
     * MissileMiniNuke, exactly 19.0 to MissileNuke, and anything else falls out of the branch with
     * the guid still 0. SpaceObjectFactory.createMissile throws on a guid it cannot resolve and
     * that throw escapes into Sector.run's per-tick catch, so it is not one player's problem - it
     * abandons the timers and the object remover for everyone in the sector, on every shot.
     *
     * Three emitted countables sit in that hole: the merit mines, at DamageHigh 0.3. They are safe
     * only because FireMissileAction carries an explicit `missileGUID == 0` fallback to
     * StaticCardGUID.MissileCard, and SelectConsumable (PlayerProtocol.java:718-743) validates
     * neither ConsumableType nor Tier, so a crafted packet can put any countable in any slot -
     * this is reachable on purpose, not only by accident. Check the fallback is still there. */
    {
      const routed = { 0: 29963472, 4: 244685066, 19: 253392099 };
      const src = fs.readFileSync(path.join(CORE_SRC,
        'core/sector/management/abilities/actions/FireMissileAction.java'), 'utf8');
      const hasFallback = /missileGUID\s*==\s*0/.test(src);
      conCards.filter(k => k.effectType === 'DamageNuclear').forEach(k => {
        const dh = k.ItemBuffAdd.stats.DamageHigh;
        const guid = routed[dh === undefined ? 0 : dh];
        if (guid && !cards.some(c => c.cardGUID === guid && c.cardView2 === 'World'))
          errs.push(`ShipConsumable ${k.cardGUID}: DamageNuclear with DamageHigh ${dh} routes to projectile ${guid}, which has no World card - createMissile throws and truncates the sector tick on every shot`);
        if (!guid && !hasFallback)
          errs.push(`ShipConsumable ${k.cardGUID}: DamageNuclear with DamageHigh ${dh} matches none of getMissileGUID's three cases, and FireMissileAction no longer carries the missileGUID == 0 fallback - firing it truncates the whole sector's tick`);
      });
    }

    /* ---- G12  WARN: a module buffing a stat no hull of its tier seeds.
     *
     * ObjectStats.applyStatsAddTo and applyStatsMultTo (ObjectStats.java:148-180) only write keys
     * the TARGET map already contains, and statsWithSlots is seeded solely from the Ship card's
     * Stats block and never gains a key. So a buff on a stat the hull does not seed does nothing at
     * all - no error, no log, the tooltip still shows the number.
     *
     * WARN AND NEVER ERROR. Nine of the keys real modules buff are seeded by no hull in the
     * ORIGINAL's own data either, so no amount of extraction can ever satisfy this rule for them -
     * it is a property of the game, not of our port. They are allowlisted below with the two CAMS
     * keys, which are a different mechanism again.
     *
     * TurnSpeed and TurnAcceleration are NOT allowlisted and must never be: ObjectStats
     * .mapObjectStats (:106-119) rewrites them to the Pitch/Yaw pairs BEFORE the containsKey test,
     * and those four keys are seeded, so the buffs are live. They are expanded here for the same
     * reason. */
    {
      const EXPAND = { TurnSpeed: ['PitchMaxSpeed', 'YawMaxSpeed'], TurnAcceleration: ['PitchAcceleration', 'YawAcceleration'] };
      /* The nine, cross-joined from every dump ShipSystem's StaticBuffs/MultiplyBuffs keys against
       * the union of all 95 dump Ship Stats blocks: buffed by real modules, seeded by no hull.
       * SkillBook.java:261 maps MissileCooldown to Cooldown for SKILLS only, and
       * RestoreBuffAction.java:37-39 reads PowerPointRestore off the ABILITY's ItemBuffAdd, so
       * neither ever reaches ship stats. */
      const UNSEEDABLE_BUFF_STATS = new Set([
        'DrainResistance', 'PowerPointRestore', 'ToggleSystemCooldown',
        'MissileCooldown', 'MissilePowerPointCost',
        'LightMissileCooldown', 'LightMissilePowerPointCost',
        'HeavyMissileCooldown', 'HeavyMissilePowerPointCost',
        /* CannonAngle and MiningAngle are NOT hull stats and are not meant to be.
         * ShipSubscribeInfo.java:97-130 - the block commented "cams system stats on abilities" -
         * reads them straight off a fitted system's MultiplyBuffs and multiplies the FireCannon /
         * FireMining ability's Angle by them. They never go near applyStatsAddTo. */
        'CannonAngle', 'MiningAngle',
      ]);
      const seededByTier = new Map();
      shipCardList.forEach(s => {
        if (!seededByTier.has(s.Tier)) seededByTier.set(s.Tier, new Set());
        Object.keys((s.Stats && s.Stats.stats) || {}).forEach(k => seededByTier.get(s.Tier).add(k));
      });
      const dead = new Map();
      sysCards.forEach(c => {
        const seed = seededByTier.get(c.Tier) || new Set();
        ['StaticBuffs', 'MultiplyBuffs'].forEach(b => {
          Object.entries((c[b] && c[b].stats) || {}).forEach(([k, v]) => {
            if (b === 'MultiplyBuffs' && Number(v) === 0)
              errs.push(`ShipSystem ${c.cardGUID}: MultiplyBuffs.${k} is 0 - applyStatsMultTo multiplies the hull's stat by it, so fitting this zeroes ${k} outright`);
            (EXPAND[k] || [k]).forEach(key => {
              if (seed.has(key) || UNSEEDABLE_BUFF_STATS.has(key)) return;
              const id = `${key}|${c.Tier}`;
              if (!dead.has(id)) dead.set(id, { stat: key, tier: c.Tier, guids: [] });
              dead.get(id).guids.push(c.cardGUID);
            });
          });
        });
      });
      [...dead.values()].sort((a, b) => (a.tier - b.tier) || a.stat.localeCompare(b.stat)).forEach(d =>
        console.warn(`WARN dead buff: ${d.stat} is buffed by ${d.guids.length} tier-${d.tier} system(s) `
          + `(${d.guids.slice(0, 6).join(', ')}${d.guids.length > 6 ? ', ...' : ''}) but no emitted tier-${d.tier} hull SEEDS `
          + `that stat, so applyStatsAddTo/applyStatsMultTo skip it and the module does nothing`));
    }

    /* ---- G13/G15  EVERY GUID A SHIPPED ShipConfigTemplate NAMES MUST EXIST.
     *
     * SpaceObjectFactory.java:698 calls ShipSystem.fromGUID OUTSIDE setupWeaponConfig's try, so a
     * config naming a guid we do not emit throws on NPC SPAWN - not at boot, not in this build, but
     * the first time somebody flies into that sector. Every faction directory is walked, ancient/
     * included, in both the live tree (the only one ShipConfigReader.java:17 actually reads) and
     * the tracked config/ mirror, because a repoint applied to one and not the other is a bug that
     * survives the next regeneration.
     * ServerConfigurationUtils_public/ is deliberately NOT walked: it is a pristine upstream copy
     * kept for diffing and it is not ours to keep in step.
     *
     * A shipGUID with no Ship card is tolerated with a warning - ancient/100_40_drone_small.json
     * has one today and the drone spawns from a Ship card we do not emit. */
    {
      const roots = [
        path.join(CORE_ROOT, 'ServerConfigurationUtils/global/ShipConfigTemplates'),
        path.resolve(__dirname, '../../config/ShipConfigTemplates'),
      ].filter(d => fs.existsSync(d));
      if (!roots.length) {
        errs.push('no ShipConfigTemplates directory found in either the live tree or config/ - refusing to bless the catalogue without checking what the NPC configs reference');
      } else {
        const files = [];
        const walk = d => {
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.json') && !e.name.startsWith('!')) files.push(p);
          }
        };
        roots.forEach(walk);
        const pinnedItems = new Map(), pinnedCons = new Map(), armedSlots = [];
        files.forEach(f => {
          const rel = path.relative(path.resolve(__dirname, '../..'), f).replace(/\\/g, '/');
          let parsed;
          try { parsed = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); }
          catch (e) {
            errs.push(`ShipConfigTemplates ${rel} does not parse: ${e.message} - ShipConfigReader takes the server down at boot on it`);
            return;
          }
          (Array.isArray(parsed) ? parsed : [parsed]).forEach(cfg => {
            if (cfg.shipGUID != null && !cards.some(c => c.cardGUID === cfg.shipGUID && c.cardView2 === 'Ship'))
              console.warn(`WARN ${rel}: shipGUID ${cfg.shipGUID} has no emitted Ship card - that NPC cannot spawn (tolerated: ancient/100_40_drone_small.json is like this today)`);
            (cfg.slotConfigs || []).forEach(s => {
              if (s.itemGUID != null) { if (!pinnedItems.has(s.itemGUID)) pinnedItems.set(s.itemGUID, []); pinnedItems.get(s.itemGUID).push(rel); }
              if (s.consumableGUID != null) { if (!pinnedCons.has(s.consumableGUID)) pinnedCons.set(s.consumableGUID, []); pinnedCons.get(s.consumableGUID).push(rel); }
              if (s.itemGUID != null) armedSlots.push({ rel, slot: s });
            });
          });
        });
        pinnedItems.forEach((where, g) => {
          if (!cards.some(c => c.cardGUID === g && c.cardView2 === 'ShipSystem'))
            errs.push(`ShipConfigTemplates: itemGUID ${g} (${[...new Set(where)].join(', ')}) has no emitted ShipSystem card - ShipSystem.fromGUID at SpaceObjectFactory.java:698 is outside setupWeaponConfig's try, so this throws the first time that NPC spawns, not at boot`);
          // G15: the guid is spoken for. If a hull ever lands on it the config silently arms a slot
          // with something that is not a weapon.
          if (cards.some(c => c.cardGUID === g && c.cardView2 === 'Ship'))
            errs.push(`ShipConfigTemplates: itemGUID ${g} (${[...new Set(where)].join(', ')}) is also an emitted Ship card guid - a pinned item guid has been reused for a hull`);
        });
        pinnedCons.forEach((where, g) => {
          if (!cards.some(c => c.cardGUID === g && c.cardView2 === 'ShipConsumable'))
            errs.push(`ShipConfigTemplates: consumableGUID ${g} (${[...new Set(where)].join(', ')}) has no emitted ShipConsumable card - the NPC's weapon has no ammunition card and cannot fire`);
        });

        /* ---- G13b  AN NPC MISSILE LAUNCHER MUST BE HANDED ITS AMMUNITION IN THE CONFIG.
         *
         * NPCs are exempt from the ammo CHECK - AbilityAction.checkConsumablesSatisfied:143 and
         * processConsumables:166 both return early for a non-player - but FireMissileAction is not
         * an ability check, it is the shot itself, and getMissileGUID reads the loaded countable to
         * decide which projectile to spawn. With ConsumableOption Using and an empty slot the card
         * is null, the method logs and returns -1, and the mount silently never fires. That is how
         * the outposts and weapon platforms lost their missile batteries the moment USING_ENABLED
         * went true: setupWeaponConfig only calls setCurrentConsumable when consumableGUID != 0.
         *
         * Only the missile family reads the countable. Cannons, point defence and flak go through
         * WeaponAction and never touch it, which is why they need nothing here. */
        const MISSILE_ACTIONS = new Set(['FireMissle', 'FireTorpedo', 'FireHeavyMissile', 'FireLightMissile']);
        armedSlots.forEach(({ rel, slot }) => {
          const sys = cards.find(c => c.cardGUID === slot.itemGUID && c.cardView2 === 'ShipSystem');
          if (!sys) return;   // already reported above
          (sys.shipAbilityCards || []).forEach(ag => {
            const a = cards.find(c => c.cardGUID === ag && c.cardView2 === 'ShipAbility');
            if (!a || a.ConsumableOption !== 'Using' || !MISSILE_ACTIONS.has(a.ActionType)) return;
            const ammo = slot.consumableGUID
              && cards.find(c => c.cardGUID === slot.consumableGUID && c.cardView2 === 'ShipConsumable');
            if (!ammo) {
              errs.push(`${rel} slot ${slot.slotID}: ${slot.itemGUID} fires ${a.ActionType} with ConsumableOption Using and the slot has no consumableGUID - FireMissileAction.getMissileGUID reads a null card, returns -1, and the mount never fires`);
              return;
            }
            if (ammo.ConsumableType !== a.ConsumableType || (ammo.Tier !== a.ConsumableTier && ammo.Tier !== 0))
              errs.push(`${rel} slot ${slot.slotID}: ammunition ${slot.consumableGUID} is ConsumableType ${ammo.ConsumableType}/tier ${ammo.Tier} but the weapon wants ${a.ConsumableType}/${a.ConsumableTier}`);
            if (ammo.effectType === 'DamageNuclear')
              console.warn(`WARN ${rel} slot ${slot.slotID}: armed with nuclear ammunition ${slot.consumableGUID} - `
                + `every shot from this NPC spawns a nuke, and SelectConsumable does not gate NPCs at all`);
          });
        });
      }
    }

    /* ---- G13c  A HAND-AUTHORED CONFIG FILE MUST SURVIVE A FRESH UNPACK.
     *
     * The server reads ONLY the live tree, the live tree is gitignored, and a fresh checkout
     * rebuilds it as upstream unpack + config/ overlay + the generators. A file that exists only
     * in the live tree therefore works today and silently vanishes on the next machine - which is
     * exactly how the outposts (200-203) and then the light/heavy platforms (204-207) shipped
     * unarmed, twice. config/upstream-manifest.txt lists what the upstream unpack provides, taken
     * from a pristine copy; its own header says how to regenerate it. Directories a generator
     * owns wholesale are skipped: JsonCards (cards.js), SectorTemplates
     * (emit-sector-templates.js), MissionTemplateConfiguration (emitMissionTemplates above). */
    {
      const manifestPath = path.resolve(__dirname, '../../config/upstream-manifest.txt');
      const liveRoot = path.join(CORE_ROOT, 'ServerConfigurationUtils/global');
      const cfgRoot = path.resolve(__dirname, '../../config');
      if (!fs.existsSync(manifestPath)) {
        errs.push('config/upstream-manifest.txt is missing - cannot tell hand-authored live-tree files from upstream ones');
      } else if (fs.existsSync(liveRoot)) {
        const upstream = new Set(fs.readFileSync(manifestPath, 'utf8').split('\n')
          .map(s => s.trim()).filter(s => s && !s.startsWith('#')));
        const GENERATED = new Set(['JsonCards', 'SectorTemplates', 'MissionTemplateConfiguration']);
        const walkLive = (d, rel) => {
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const r = rel ? rel + '/' + e.name : e.name;
            if (e.isDirectory()) { if (!rel && GENERATED.has(e.name)) continue; walkLive(path.join(d, e.name), r); }
            else if (!upstream.has(r) && !fs.existsSync(path.join(cfgRoot, r)))
              errs.push(`${r} exists only in the gitignored live tree - it vanishes on a fresh unpack. Mirror it `
                + `into config/ (and config/README.md), or add it to config/upstream-manifest.txt if a newer upstream drop provides it`);
          }
        };
        walkLive(liveRoot, '');
      }
    }

    /* ---- G14  THE THREE DELIBERATE STATION-WEAPON FIXES MUST STILL BE THERE.
     * All three are documented at length on the STATION_OVERRIDES map: the two cone widenings exist
     * because WeaponAction.java:72-83 enforces the arc from each hardpoint's own transform, so at
     * 90 degrees most of a station's batteries never bear; the range/lifetime pair exists because
     * station aggro reaches 4,000 m and the dump's 2,000 m round could never answer a sniper.
     * They are OVERRIDES of the original's own numbers, which means a future dump re-import would
     * revert all three and look correct doing it. This rule is the thing that notices. */
    {
      const STATION_OVERRIDES = [
        [2805480538, 'Angle', 180, 'outpost long-range cannon: 90 deg leaves the flank batteries unable to bear'],
        [3400376042, 'Angle', 360, 'outpost point defence: a last-ditch bubble with a 90 deg cone'],
        [1849929854, 'MaxRange', 4000, 'outpost missile: station aggro is 3500/4000, so a 2000 m round can never answer a sniper'],
        [1849929854, 'LifeTime', 55, 'outpost missile: 50 s dies ~213 m short of 4 km once the 15 m/s^2 ramp is paid'],
      ];
      STATION_OVERRIDES.forEach(([g, k, want, why]) => {
        const a = cards.find(c => c.cardGUID === g && c.cardView2 === 'ShipAbility');
        if (!a) { errs.push(`station override: ShipAbility ${g} is not emitted, so the fix "${why}" has been lost`); return; }
        const got = Number(((a.ItemBuffAdd || {}).stats || {})[k]);
        if (got !== want)
          errs.push(`station override: ShipAbility ${g} ${k} is ${got} and must be ${want} - ${why}. If a dump re-import moved it, keep the override; if the override is genuinely obsolete, delete it here and on the STATION_OVERRIDES map together`);
      });
    }

    /* ---- G16  A RESTRICTION ENTRY MUST BE A ShipObjectKey THAT IS ALSO A LOADABLE SHIP CARD.
     * The server gate (ShipSystemCard.isObjectKeyRestrictionsBlocked) compares the hull's
     * ShipObjectKey, but the CLIENT fetches a SHIP CARD at each entry (ShipSystemCard.cs:96-102) to
     * name the hull in the restriction tooltip. That is the historical trap that produced
     * "Card should not be send because it's null! 268081382 10" and an infinite loading screen: an
     * entry has to satisfy BOTH readings, so it must be an objKey AND a guid carrying the full ship
     * view set. hullIdentityCards() is what puts a card set at those 30 guids.
     *
     * WHICH card the client renders is not ambiguous: FetchCard resolves by guid, so it is the
     * identity card at the entry itself and nothing else. That makes the rest of the rule a
     * comparison against the hull the restriction is MEANT to name - the family's ShipList member,
     * the one a player actually flies:
     *   Tier               the server unlocks the item for every hull carrying this objKey, but the
     *                      store filters by the ACTIVE hull's tier, so a disagreement makes the item
     *                      visible on one member and invisible on another with nothing saying why.
     *   ShipRoleDeprecated + HangarID  GuiAdvancedRequirementsPanel.cs:98 colours "Required ship:"
     *                      by comparing the fetched card's HangarID against the active ship's, so a
     *                      wrong one reads as unmet while you sit in the hull it names.
     *   Faction            :93 skips a restriction entry whose Faction is not the player's, and
     *                      TradeInWindowWidget.cs:161 hides the item outright, so a wrong faction
     *                      makes the item nameless or invisible.
     * HangarID is deliberately NOT required to agree across the whole family: our NPC clones share
     * their prefab's objKey and legitimately park on HangarID 12, and 12 of the 24 keys in use
     * today have such a clone. It is the identity card that has to be right, not the clones.
     * LIVE TODAY: the six tiered platform weapons carry SENTRY_HULLS and exercise this. */
    {
      const byObjKey = new Map();
      shipCardList.forEach(s => {
        if (!byObjKey.has(s.ShipObjectKey)) byObjKey.set(s.ShipObjectKey, []);
        byObjKey.get(s.ShipObjectKey).push(s);
      });
      const listedShipGuids = new Set(cards.filter(c => c.cardView2 === 'ShipList')
        .flatMap(c => c.shipCardGuids || []));
      const reported = new Set();
      const once = (id, msg) => { if (reported.has(id)) return; reported.add(id); errs.push(msg); };
      sysCards.forEach(c => (c.ShipObjectKeyRestrictions || []).forEach(k => {
        const group = byObjKey.get(k);
        if (!group) return;   // already reported by the objKey rule further up
        ['Ship', 'World', 'GUI', 'Price', 'ShipLight'].forEach(v => {
          if (hasView(k, v)) return;
          once(`${k}|${v}`, `ShipSystem ${c.cardGUID}: ShipObjectKeyRestrictions entry ${k} is a valid ShipObjectKey but there is no ${v} card at guid ${k} - ShipSystemCard.cs:96-102 fetches a Ship card at the entry itself, and a card that never arrives is an infinite loading screen with no timeout`);
        });
        const tiers = [...new Set(group.map(s => s.Tier))];
        if (tiers.length > 1)
          once(`${k}|Tier`, `ShipObjectKey ${k} is shared by Ship cards ${group.map(s => s.cardGUID).join('/')} whose Tier values disagree (${tiers.join(', ')}) - the server unlocks the item for all of them while the store's equipable filter shows it at one tier only`);

        /* The card the client will actually fetch. It is in `group` only if its own ShipObjectKey
         * is k, and if it is not then the server and the client are talking about different hulls:
         * the gate opens for family k while the tooltip names whoever owns that guid. */
        const idCard = group.find(s => s.cardGUID === k);
        if (!idCard) {
          once(`${k}|identity`, `ShipObjectKey ${k}: the Ship card at guid ${k} carries ShipObjectKey ${(cards.find(x => x.cardGUID === k && x.cardView2 === 'Ship') || {}).ShipObjectKey} - the server unlocks the item for the ${k} family but ShipSystemCard.cs:100 fetches that card and names a different hull`);
          return;
        }
        const listedMembers = group.filter(s => listedShipGuids.has(s.cardGUID));
        if (listedMembers.length > 1) {
          once(`${k}|listed`, `ShipObjectKey ${k}: Ship cards ${listedMembers.map(s => s.cardGUID).join('/')} are all in a ShipList - the identity card can only describe one of them`);
          return;
        }
        // No ShipList member at all is the stations' case: the identity card IS the only card in
        // the family, so there is nothing to compare it against.
        if (!listedMembers.length) return;
        ['Tier', 'ShipRoleDeprecated', 'HangarID', 'Faction'].forEach(f => {
          if (idCard[f] === listedMembers[0][f]) return;
          once(`${k}|${f}|id`, `ShipObjectKey ${k}: the identity card at guid ${k} has ${f} ${idCard[f]} but the player-flyable hull of that family (${listedMembers[0].cardGUID}) has ${listedMembers[0][f]} - the restriction tooltip renders the identity card, so it would describe the wrong hull`);
        });
      }));
    }

    /* ---- REGULATION KEYSET SANITY.
     * applyRegulationTargeting derives the keys, so the ability-coverage rule further up can no
     * longer fire. What it cannot see is a build in which the derivation never ran at all, which
     * would ship both maps empty and KeyNotFoundException every ability on the client. */
    cards.filter(c => c.cardView2 === 'Regulation').forEach(c => {
      REGULATION_BASE_GROUPS.forEach(g => {
        if (!(String(g) in (c.abilityTargetRelations || {})))
          errs.push(`Regulation ${c.cardGUID}: no entry for group ${g} - applyRegulationTargeting seeds 0..3 unconditionally, so this card was written before it ran`);
      });
    });
  }

  /* Anything a template can drop into a Hold must have all three countable views, or the row never
   * finishes loading: blank tile, matched by no filter (ItemType.None), unsellable, and it holds one
   * of the 70 hold slots forever. */
  ['AugmentTemplates', 'LootTemplates'].forEach(dir => {
    const d = path.join(CORE_ROOT, 'ServerConfigurationUtils/global', dir);
    if (!fs.existsSync(d)) return;
    fs.readdirSync(d).filter(f => !f.includes('!') && f.endsWith('.json')).forEach(f => {
      const txt = fs.readFileSync(path.join(d, f), 'utf8');
      for (const m of txt.matchAll(/"cardGuid"\s*:\s*(\d+)/g)) {
        const g = Number(m[1]);
        ['GUI', 'ShipConsumable', 'Price'].forEach(v => {
          if (!cards.some(c => c.cardGUID === g && c.cardView2 === v))
            errs.push(`${dir}/${f}: grants guid ${g} but there is no ${v} card - it would never finish loading in the hold`);
        });
      }
    });
  });

  return errs;
}

/* ================================================================ EMIT */
/* Where BSGOCore is checked out. Override with BSGOCORE_PATH when it does not sit next to this
 * repo, e.g.  BSGOCORE_PATH=D:/src/BSGOCore  node tools/cardgen/cards.js */
const CORE = CORE_ROOT;
const OUT = path.join(CORE, 'ServerConfigurationUtils/global/JsonCards');

function emit(file, cards) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(cards, null, 2), 'ascii');
  return cards.length;
}

const boot = bootstrapCards();
// The two starter hulls now live in HULLS (starter: true) - they are ordinary roster entries that
// happen to be granted for free, so they must not be emitted twice.
const starters = HULLS.filter(h => h.starter).flatMap(shipCards);
const world = [...roomCards(), ...sectorCards(), ...sectorObjectCards(), ...sectorFurnitureCards(), ...consumableCards()];
const weapons = [...realSystemCards(), ...paintCards(), ...handAuthoredSystemCards(),
                 ...weaponCards(), ...missileObjectCards(), ...moduleCards(), ...cometCards()];
const ADVANCED_HULLS = HULLS.filter(h => !h.npcOnly && !h.rentalOnly).map(h => Object.assign({}, h, {
  g: h.g + ADVANCED_OFFSET, advanced: true, starter: false,
  name: 'Advanced ' + h.name,
  hp: Math.round(h.hp * 1.18), pwr: Math.round(h.pwr * 1.15), speed: Math.round(h.speed * 1.05),
}));
const ships = [...HULLS.filter(h => !h.starter), ...NPC_HULLS, ...NPC_HEAVIES, ...ADVANCED_HULLS].flatMap(shipCards);
const progression = progressionCards();
/* Last, because it reads everything else: which object keys already carry a card set, which hull
 * is the ShipList member of its family, and what that hull's World and GUI cards say. */
ships.push(...hullIdentityCards([...boot, ...starters, ...world, ...ships, ...weapons, ...progression]));
const all = [...boot, ...starters, ...world, ...ships, ...weapons, ...progression];

/* The Regulation card's two maps are the one thing that cannot be written where the card is
 * declared: their keyset is every AbilityGroupId that actually shipped, and the abilities are built
 * further down the file than the sector cards. Mutates the card in place, so the emitted order is
 * untouched. Must run BEFORE validate() - the empty maps it replaces would fail the sanity rule. */
const nGroups = applyRegulationTargeting(all);

const errors = validate(all);
if (errors.length) {
  console.error('VALIDATION FAILED:\n  ' + errors.join('\n  '));
  process.exit(1);
}

const n1 = emit('00-bootstrap.json', boot);
const n3 = emit('05-starter-ships.json', starters);
const n4 = emit('08-world.json', world);
const n2 = emit('10-ships.json', ships);
const n5 = emit('12-weapons.json', weapons);
const n6 = emit('14-progression.json', progression);
const nT = emitMissionTemplates();
console.log('  12-weapons         ' + n5);
console.log('  14-progression     ' + n6 + '  (+' + nT + ' mission templates)');
console.log(`  05-starter-ships   ${n3}\n  08-world           ${n4}`);

const byView = {};
all.forEach(c => { byView[c.cardView2] = (byView[c.cardView2] || 0) + 1; });
console.log(`validation passed - ${all.length} cards`);
console.log(`  00-bootstrap.json  ${n1}`);
console.log(`  10-ships.json      ${n2}`);
console.log('  by view:', Object.entries(byView).map(([k, v]) => `${k}=${v}`).join(' '));
// The Regulation keyset is derived, so print it: it is the one emitted number nothing else reports,
// and a drop in it means a whole ability family stopped being emitted.
console.log(`  Regulation: ${nGroups} AbilityGroupId key(s), derived from the emitted abilities`);

/* The systems the import deliberately leaves out, printed every run. These are not a data defect -
 * every one of them would throw out of AbilityActionFactory and truncate the sector's tick - but
 * they ARE missing content a returning player will look for by name, including four complete tiered
 * families. Burying that in a JSON file nobody opens is how it gets forgotten. */
console.log(`  ${SYSTEMS_DROPPED.dropped.length} dump system(s) NOT shipped (tools/cardgen/systems-dropped.json):`);
SYSTEMS_DROPPED.dropped.forEach(d =>
  console.log(`    ${d.guid}  ${d.slot}/t${d.tier}  ${d.key}  - ${d.reason}`));
// Same reasoning for the paint import, which drops its own. The list lives in paints-real.js and
// is regenerated from the dump, so a future re-import that quietly drops more shows up here.
console.log(`  ${PAINTS_DROPPED.length} dump paint(s) NOT shipped (tools/cardgen/paints-real.js):`);
PAINTS_DROPPED.forEach(d =>
  console.log(`    ${d.sys}  ship_paint/t${d.tier}  ${d.key}  - ${d.reason}`));
// And the consumable import's own drop list, for the same reason.
console.log(`  ${CONSUMABLES_DROPPED.length} dump consumable(s) NOT shipped (tools/cardgen/consumables-real.js):`);
CONSUMABLES_DROPPED.forEach(d =>
  console.log(`    ${d.guid}  ${d.key}  - ${d.reason}`));
