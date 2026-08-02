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
    role: 'Carrier', roleDep: 'Carrier', lvl: 24, tyl: 420000,
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
  { g: 5017, name: 'Pegasus', faction: 'Colonial', hangar: 17, tier: 4,
    prefab: 'pegasus', loca: 'ship_commandtoken_pegasus', paperdoll: 'ship_commandtoken_pegasus_paperdoll_layouts',
    role: 'Mothership', roleDep: 'Mothership', lvl: 1, tyl: 25000, tokens: 20000, rentalOnly: true,
    hp: 15400, pwr: 660, speed: 52, agility: 0.55, extent: 1174,
    realStats: CAPITAL_FLIGHT },
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
    role: 'Carrier', roleDep: 'Carrier', lvl: 24, tyl: 420000,
    hp: 14000, pwr: 600, speed: 52, agility: 0.55, extent: 375 },
  /* The Basestar is the Pegasus's stated counterpart (the infobox says so on both pages) and the
   * two are deliberately matched in every other figure we ship, so it takes the same flight block.
   * Its own wiki page has no infobox numbers to check this against. */
  { g: 5117, name: 'Basestar', faction: 'Cylon', hangar: 17, tier: 4,
    prefab: 'basestar', loca: 'ship_commandtoken_basestar', paperdoll: 'ship_commandtoken_basestar_paperdoll_layouts',
    role: 'Mothership', roleDep: 'Mothership', lvl: 1, tyl: 25000, tokens: 20000, rentalOnly: true,
    hp: 15400, pwr: 660, speed: 52, agility: 0.55, extent: 863,
    realStats: CAPITAL_FLIGHT },
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
  const src = HULLS.find(h => h.prefab === base);
  return Object.assign({}, src, {
    g, hangar: 12, starter: false, npcOnly: true,
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
 * The two capitals are the original event bosses: the Colonial C5-07 Poseidon and its "fearsome
 * cylon counterpart" the Kraken (10,290 HP, level 120, all cannons, per the wiki page). Ours sit
 * at 20,000 HP because they also field their carrier hull's missile pods - the wiki's Kraken had
 * no launchers. Their ShipConfigTemplates arm the launcher slots, which only carriers and the
 * stealth hulls actually have. */
const NPC_HEAVIES = [
  // [guid, prefab, name override, hp override]
  [60, 'humant2fighter'], [61, 'humant2command'], [62, 'humant2defender'],
  [63, 'humant3fighter'], [64, 'humant3command'], [65, 'humant3defender'],
  [84, 'cylont2fighter'], [85, 'cylont2command'], [86, 'cylont2defender'],
  [87, 'cylont3fighter'], [88, 'cylont3command'], [89, 'cylont3defender'],
  [90, 'humant4carrier', 'C5-07 Poseidon', 20000],
  [91, 'cylont4carrier', 'Kraken', 20000],
].map(([g, prefab, name, hp]) => {
  const src = HULLS.find(h => h.prefab === prefab);
  return Object.assign({}, src, {
    g, hangar: 12, starter: false, npcOnly: true, lvl: 1,
    name: name || src.name,
  }, hp ? { hp } : {});
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
const { EQUIPMENT_REAL } = require('./equipment-real.js');

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
  pegasus: {           // Pegasus - REAL transforms, re-extracted from the client bundle 2026-08-02
    bullet01:                { hash:  49813, pos: V3(-350.94944, -95.217966, -236.744682), rot: QUAT(0.707107, 0, -0.707107, 0) },
    bullet02:                { hash:  50321, pos: V3(-350.892249, -95.183284, -68.559715), rot: QUAT(0.707107, 0, -0.707107, 0) },
    bullet03:                { hash:  19778, pos: V3(-350.892277, -95.183278, 97.203041), rot: QUAT(0.707107, 0, -0.707107, 0) },
    bullet04:                { hash:  50370, pos: V3(-197.31748, -14.993818, 404.189082), rot: QUAT(0.707107, 0, -0.707107, 0) },
    bullet05:                { hash:  21514, pos: V3(-72.639383, -14.372976, 866.223428), rot: QUAT(0, 0, 1, 0) },
    bullet06:                { hash:  64121, pos: V3(71.57479, -14.367258, 866.527068), rot: QUAT(0, 0, 1, 0) },
    bullet07:                { hash:  64555, pos: V3(197.727594, -14.983938, 404.182905), rot: QUAT(0.707107, 0, 0.707107, 0) },
    bullet08:                { hash:  18078, pos: V3(352.574734, -95.209134, 97.18218), rot: QUAT(0.707107, 0, 0.707107, 0) },
    bullet09:                { hash:  21539, pos: V3(352.574762, -95.209148, -68.580577), rot: QUAT(0.707107, 0, 0.707107, 0) },
    bullet10:                { hash:     10, pos: V3(352.64489, -95.207384, -236.666155), rot: QUAT(0.707107, 0, 0.707107, 0) },
    bullet11:                { hash:     11, pos: V3(0.000004, -0.000009, -19.171537), rot: QUAT(1, 0, 0, 0) },
    bullet12:                { hash:     12, pos: V3(-0.000005, -0.000006, 25.570395), rot: QUAT(1, 0, 0, 0) },
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
   * than read off. What was here before was an arbitrary permutation: slot 3 on bullet10, slot 2 a
   * 'launcher' on bullet01 (a PORT-SIDE TURRET), and slots 6 and 8 as weapons on bullet11/bullet12,
   * which sit at (0, 0, +-20) - dead centre, inside the hull. That put gun models inside the ship
   * firing backwards and a missile pod on a broadside mount, which is what "the orientation is a
   * mess" was. The hardpoint ROTATIONS were never the problem: working the axis-angle through,
   * bullet01-04 map forward onto (-1,0,0) and bullet07-10 onto (+1,0,0), so the port turrets really
   * do point port and the starboard ones starboard.
   *
   * The geometry is perfectly symmetric and settles the layout on its own:
   *   bullet01..05  port side, running aft to bow      bullet06..10  starboard, bow to aft
   *   bullet11/12   on the centre line at z = -19 and +26, inside the hull
   * Ten turrets and two centre-line bays. The bays are LAUNCHER mounts, not guns: both t4 carriers
   * in the dump carry exactly two launcher slots, and the points they sit on are named
   * bullet11_launcher and bullet12_launcher. Same two indices, same pair count, same place.
   *
   * WHAT GOES WHERE IS SETTLED BY THE WIKI, AND THE GEOMETRY AGREES WITH IT EXACTLY.
   * research/bsgo_wiki/Battlestar Pegasus.txt:50-52 lists the ship as pre-installed with twelve
   * level-15 systems - 6 Cannon Battery, 4 Missile Battery, 2 Point Defence Battery - and twelve is
   * our hardpoint count. The mounts then fall into precisely those three groups by height:
   *   y = -95.2   bullet01,02,03 + bullet08,09,10   SIX low broadside mounts   -> gun (cannon)
   *   y = -15.0   bullet04,05    + bullet06,07      FOUR upper forward mounts  -> launcher (missile)
   *   centre line bullet11,12                       TWO at (0,0,+-20)          -> defensive_weapon
   * Six, four and two, matching the wiki's counts without being told them. The centre pair is the
   * point-defence/flak mount, which is what the paperdoll shows centrally.
   *
   * I had these two as 'launcher' in the previous pass, reasoning from the dumped t4 carriers
   * naming their launcher points bullet11_launcher/bullet12_launcher. That was the wrong call -
   * the index coincidence is real but the Pegasus is a different ship, and its own page says point
   * defence. defensive_weapon is the slot type both point defence and flak use.
   *
   * All twelve ids stay inside the 0-13 set the paperdoll defines
   * (ship_commandtoken_{pegasus,basestar}_paperdoll_layouts), leaving 12 and 13 free rather than
   * filled with invented module slots. */
  pegasus:            [[0, 'gun', 'bullet01', 1], [1, 'gun', 'bullet02', 1], [2, 'gun', 'bullet03', 1], [3, 'launcher', 'bullet04', 1], [4, 'launcher', 'bullet05', 1], [5, 'launcher', 'bullet06', 1], [6, 'launcher', 'bullet07', 1], [7, 'gun', 'bullet08', 1], [8, 'gun', 'bullet09', 1], [9, 'gun', 'bullet10', 1], [10, 'defensive_weapon', 'bullet11', 1], [11, 'defensive_weapon', 'bullet12', 1]],
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
  const hp = HARDPOINTS[prefab];
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
  pegasus: 500000, basestar: 500000,
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
      // MUST stay empty: HangarWindow.GetShipIcon dereferences every cell of the 3x5 grid
      // unguarded, and with a tier-1-only roster 11 of 15 cells are null. Both call sites are
      // reachable only through ItemPressed -> AnyVariantsOwned(icon.Card), which is false while
      // this is empty.
      VariantHangarIDs: [], ParentHangarID: -1,
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

    // level drives the loca suffix: bgo.<key>.Name_<level> then bgo.<key>.Name
    card(guid, 'GUI', {
      key: hull.loca, level: 1,
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

    card(guid, 'Owner', { IsDockable: false, DockRange: 0.0, Level: 1 }),

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
 * No NPC: RoomLevel.SetupAreaNpcs does GameObject.Find("NPCs").transform.FindChild(name) against
 * the room prefab, and the hangar prefabs have no NPC children - a wrong name would just log
 * "npcObject is null" and skip, but an empty list is honest. */
const ROOMS = [
  { guid: 3608851,   prefab: 'cic_human',    loca: 'room_outpost_cic',    npc: 'Apollo' },
  { guid: 259498852, prefab: 'cic_cylon',    loca: 'room_basestar_cic',   npc: 'Leoben' },
  { guid: 151517344, prefab: 'hangar_human', loca: 'room_outpost_human',  npc: null },
  { guid: 151517343, prefab: 'hangar_cylon', loca: 'room_outpost_cylon',  npc: null },
];

function roomCards() {
  return ROOMS.flatMap(r => [
    card(r.guid, 'Room', {
      doors: [{ Door: 'door_undock', roomGUID: UNDOCK_DOOR }],
      // The ONLY entry point to MissionDistributor. RoomLevel.SetupAreaNpcs does
      // GameObject.Find("NPCs").transform.FindChild(NPC), so this string must match a child
      // transform of the room prefab, not a loca key. A wrong name is NOT fatal - the client
      // logs "Could not create NPC: X because npcObject is null" and skips it - so that log
      // line is the runtime check. RoomProtocol.java:42 also hardcodes Leoben/Apollo.
      NPCs: r.npc ? [{ NPC: r.npc, NPCGUID: NPC_GUI[r.npc] }] : [],
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
      // KEY = ShipAbilityCard.AbilityGroupId. The client uses the RAW dictionary indexer on it,
      // so a group with no entry here is a KeyNotFoundException the first time you validate a
      // target - on the per-frame path. The server also indexes abilityTargetTypes by the
      // RELATIONS keyset unguarded, so both maps must carry the SAME keys.
      // Values are raw bitmask ints, not enum names:
      //   side:   Self=1 Any=2 Neutral=4 Friend=8 Enemy=16
      //   target: Asteroid=1 Ship=2 Any=4 Missile=8 Planetoid=16 Mine=32 JTT=64 Comet=128
      // Asteroids are Faction.Neutral, so Enemy alone would NOT let you shoot rocks.
      // Group 0 is seeded as a safety net for any ability that ships with AbilityGroupId 0.
      /* Group 3 is GROUP_DEFENSIVE - flak and point defence. It is Enemy-only (16) and deliberately
       * NOT Neutral (4): a flak screen that chewed through every asteroid the ship drifted past
       * would strip the field and spam loot. Target types stay Ship+Asteroid-capable (1,2) because
       * the pair of maps must carry identical keysets - the server indexes abilityTargetTypes by
       * the RELATIONS keyset with no guard - but the relation is what actually gates it. */
      /* GROUP 2 IS MISSILES, AND THEY MAY NOT BE AIMED AT ROCKS. Target type 1 is Asteroid and 2
       * is Ship; missiles get Ship only, and the relation drops Neutral (4) for Enemy (16) alone,
       * because asteroids are Faction.Neutral and either gate on its own would still let them
       * through. Cannons keep both - shooting rocks is how mining works - so this is the one group
       * that differs.
       * A missile that CLIPS an asteroid in flight is a separate matter and still resolves:
       * CollisionResolution.resolveMissileOther destroys both. This only stops you selecting a rock
       * and launching at it. */
      abilityTargetRelations: { 0: [4, 16], 1: [4, 16], 2: [16], 3: [16] },
      abilityTargetTypes: { 0: [1, 2], 1: [1, 2], 2: [2], 3: [1, 2] },
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

/* ================================================================ WEAPONS
 * Five card views per weapon across TWO guids:
 *   sysGuid: ShipSystem(2) + GUI(1) + Price(23)
 *   abGuid : ShipAbility(6) + GUI(1)
 * The system card depends on a Price card at its OWN guid, and the ability card's constructor
 * depends on a GUI card at the ABILITY guid. Miss either and the item never finishes loading.
 * System guids are PINNED by the shipped ShipConfigTemplates - do not renumber them.
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

/* Tier is a HULL-CLASS LOCK, not a quality grade. The equip check demands the system's tier equal
 * the ACTIVE SHIP's tier exactly, the Store tab force-enables the equipable-only filter and never
 * clears it for Hold or Locker, and the tier filter then hides every system of another tier - a
 * ShipSystem gets no tier-0 escape, only countables do. While every reachable hull is tier 1, a
 * tier-2/3 weapon is invisible in the shop AND invisible in your own hold after you pay for it.
 * These three grades stay a price/stat progression WITHIN tier 1. Restore tier 2 and 3 on the same
 * day the tier-2/3 hulls enter the ShipList, not before. */
const CANNONS = [
  { sys: 2645025994, ab: 71000010, tier: 1, key: 'standard_issue_autocannon', frame: 172, abFrame: 93, tyl: 2500, dur: 200,
    st: { Accuracy: 100, DamageLow: 18, DamageHigh: 26, CriticalOffense: 20, ArmorPiercing: 20,
          MinRange: 0, OptimalRange: 400, MaxRange: 700, Angle: 40, Cooldown: 1.0, PowerPointCost: 1.5 } },
  { sys: 4171922670, ab: 71000020, tier: 1, key: 'cyclone_autocannon', frame: 173, abFrame: 101, tyl: 9000, dur: 700,
    st: { Accuracy: 120, DamageLow: 30, DamageHigh: 44, CriticalOffense: 30, ArmorPiercing: 30,
          MinRange: 0, OptimalRange: 500, MaxRange: 850, Angle: 40, Cooldown: 0.9, PowerPointCost: 2.0 } },
  { sys: 3694197064, ab: 71000075, tier: 1, key: 'monsoon_autocannon_x', frame: 208, abFrame: 104, tyl: 26000, dur: 2000,
    st: { Accuracy: 150, DamageLow: 55, DamageHigh: 80, CriticalOffense: 45, ArmorPiercing: 45,
          MinRange: 0, OptimalRange: 650, MaxRange: 1100, Angle: 40, Cooldown: 1.1, PowerPointCost: 2.5 } },
];

/* The missile action copies the ability's ItemBuffAdd wholesale onto the projectile, then reads
 * Speed and MaxHullPoints with a nullable getter that auto-unboxes - so either being absent is
 * an NPE on the first shot. LifeTime is the same, and its timer re-throws EVERY tick.
 * Never add DrainLow here: it branches into the torpedo AoE path, which then filters by an
 * unset radius and the missile does nothing at all.
 *
 * "LAUNCHERS" is the missile FAMILY, not the slot type. In the dump these very guids are SlotType
 * 'weapon' (271446462 is weapon/T1 there): T1-T3 hulls have ZERO launcher slots, so sub-T4
 * missiles competed with cannons for the ordinary weapon hardpoints. Only the tier-4 entries
 * (6024-6026 below, plus capital 6034) emit as 'launcher' - the type exists solely on the four
 * T4 hulls. The emission loop applies the split; typing all nine T1-T3 missiles 'launcher' was
 * the bug that made every one of them unequippable stock. */
const LAUNCHERS = [
  { sys: 271446462, ab: 71000110, tier: 1, key: 'light_missile_launcher', frame: 227, abFrame: 98, tyl: 3500, dur: 250,
    st: { DamageLow: 90, DamageHigh: 130, CriticalOffense: 20, ArmorPiercing: 25,
          MinRange: 100, MaxRange: 1500, Angle: 45, Cooldown: 8.0, PowerPointCost: 10,
          Speed: 220, MaxHullPoints: 40, LifeTime: 12,
          Acceleration: 200, YawAcceleration: 90, YawMaxSpeed: 90,
          PitchAcceleration: 90, PitchMaxSpeed: 90, RollAcceleration: 90, RollMaxSpeed: 90 } },
  { sys: 1798343138, ab: 71000120, tier: 1, key: 'skyseeker_missile_launcher', frame: 231, abFrame: 99, tyl: 12000, dur: 900,
    st: { DamageLow: 150, DamageHigh: 210, CriticalOffense: 30, ArmorPiercing: 35,
          MinRange: 100, MaxRange: 1800, Angle: 45, Cooldown: 7.5, PowerPointCost: 12,
          Speed: 250, MaxHullPoints: 60, LifeTime: 14,
          Acceleration: 220, YawAcceleration: 100, YawMaxSpeed: 100,
          PitchAcceleration: 100, PitchMaxSpeed: 100, RollAcceleration: 100, RollMaxSpeed: 100 } },
  { sys: 1320617532, ab: 71000175, tier: 1, key: 'crossbow_missile_launcher', frame: 176, abFrame: 29, tyl: 34000, dur: 2500,
    st: { DamageLow: 240, DamageHigh: 330, CriticalOffense: 45, ArmorPiercing: 50,
          MinRange: 100, MaxRange: 2200, Angle: 45, Cooldown: 7.0, PowerPointCost: 15,
          Speed: 280, MaxHullPoints: 90, LifeTime: 16,
          Acceleration: 240, YawAcceleration: 110, YawMaxSpeed: 110,
          PitchAcceleration: 110, PitchMaxSpeed: 110, RollAcceleration: 110, RollMaxSpeed: 110 } },
];

/* ================================================================ HIGHER WEAPON TIERS
 * Tier is a HULL-CLASS LOCK: the equip check demands the system's tier equal the ACTIVE SHIP's
 * tier EXACTLY, and the Store tab force-enables the equipable-only filter and never clears it for
 * Hold or Locker. A ShipSystem gets no tier-0 escape, only countables do. So every hull tier that
 * exists needs its own full set of weapons, or a player who buys a tier-2 hull finds the shop
 * empty and their tier-1 guns invisible in their own hold.
 *
 * Names are the client's own, resolved from the decompressed locale bundle - Light for tier 1-2,
 * Medium for tier 3, Heavy for the capitals, which is how BSGO itself graded them. Stats and
 * prices scale from the tier-1 templates above rather than being authored per weapon, so the
 * curve stays monotonic by construction.
 *
 * Icons repeat across tiers by design: the tier filter means a player only ever sees ONE tier's
 * weapons at a time, so a shared frame is never visible next to its twin.
 * Guids 6000+ and abilities 71002000+ are free ranges - the tier-1 guids above are PINNED by the
 * shipped ShipConfigTemplates and must not move. */
const TIER_WEAPONS = {
  2: {
    mult: 2.2, range: 1.15, priceMult: 4, durMult: 3, maxCannon: 6, maxLauncher: 3,
    cannons: [
      [6001, 71002001, 'hullpiercer_cannon', 174],               // MEC-A9 'Hawk'
      [6002, 71002002, 'standard_issue_autocannon_crit', 190],   // MEC-A6P 'Fang-P'
      [6003, 71002003, 'cyclone_autocannon_crit', 222],          // MEC-A8P 'Tornado-P'
    ],
    launchers: [
      [6004, 71002004, 'torpedo_missile_launcher', 189, 'torpedo_launcher'],   // HD-96 'Nova'
      [6005, 71002005, 'light_missile_launcher_crit', 209],      // HD-70P 'Lightning-P'
      [6006, 71002006, 'skyseeker_missile_launcher_crit', 230],  // HD-82P 'Longbow-P'
    ],
  },
  3: {
    mult: 4.5, range: 1.35, priceMult: 10, durMult: 7, maxCannon: 8, maxLauncher: 4,
    cannons: [
      [6011, 71002011, 'standard_escort_autocannon', 204],       // MEC-E12(S) 'Claw'
      [6012, 71002012, 'medium_cannon_defensive', 242],          // MEC-E13(S) 'Hurricane'
      [6013, 71002013, 'longrange_escort_cannon', 244, 'longrange_escort_autocannon'], // MEC-E17(S) 'Falcon'
    ],
    launchers: [
      [6014, 71002014, 'medium_missile_launcher_2', 23],         // HD-M63(S) 'Scorpio'
      [6015, 71002015, 'medium_versatile_missile_launcher', 29], // HD-M50(S) 'Thunderbolt'
      [6016, 71002016, 'mangonel_missile_launcher', 39],         // HD-M70X 'Mangonel-X'
    ],
  },
  4: {
    mult: 9, range: 1.8, priceMult: 25, durMult: 18, maxCannon: 12, maxLauncher: 6,
    cannons: [
      [6021, 71002021, 'heavy_cannon', 16],                      // MEC-L31(M) 'Talon'
      [6022, 71002022, 'tempest_autocannon_x', 17],              // MEC-L36X 'Tempest-X'
      [6023, 71002023, 'heavy_cannon_crit', 43],                 // MEC-L31P 'Talon-P'
    ],
    launchers: [
      [6024, 71002024, 'standard_large_launcher', 227],          // HD-H40(M) 'Stormstrike'
      [6025, 71002025, 'large_long_range_launcher', 231],        // HD-H48(M) 'Ballista'
      [6026, 71002026, 'trebuchet_missile_launcher', 176],       // HD-H54X 'Trebuchet-X'
    ],
  },
};

/* Scale one tier-1 template into a higher tier. Damage/HP-like stats take the tier multiplier,
 * ranges take a gentler one (a capital that outranges the map is not fun), and everything that is
 * a RATE or a COST is left alone - cooldown and power cost are what keep the curve honest. */
function scaleWeapon(base, t, sys, ab, key, frame, abFrame) {
  const SCALED = ['DamageLow', 'DamageHigh', 'CriticalOffense', 'ArmorPiercing', 'Accuracy',
                  'MaxHullPoints'];
  const RANGED = ['MinRange', 'OptimalRange', 'MaxRange'];
  const st = {};
  for (const [k, v] of Object.entries(base.st)) {
    if (SCALED.includes(k)) st[k] = Math.round(v * t.mult);
    else if (RANGED.includes(k)) st[k] = Math.round(v * t.range);
    else st[k] = v;
  }
  return {
    sys, ab, key, frame, abFrame, tier: null,   // tier filled in by the caller
    tyl: Math.round(base.tyl * t.priceMult / 100) * 100,
    dur: Math.round(base.dur * t.durMult / 10) * 10,
    st,
  };
}

/* Build the full per-tier weapon lists. Tier 1 is the authored set above; 2-4 are derived. */
const CANNONS_BY_TIER = { 1: CANNONS };
const LAUNCHERS_BY_TIER = { 1: LAUNCHERS };
for (const [tierStr, t] of Object.entries(TIER_WEAPONS)) {
  const tier = Number(tierStr);
  CANNONS_BY_TIER[tier] = t.cannons.map(([sys, ab, key, frame, abKey], i) =>
    Object.assign(scaleWeapon(CANNONS[i], t, sys, ab, key, frame, CANNONS[i].abFrame), { tier, abKey }));
  LAUNCHERS_BY_TIER[tier] = t.launchers.map(([sys, ab, key, frame, abKey], i) =>
    Object.assign(scaleWeapon(LAUNCHERS[i], t, sys, ab, key, frame, LAUNCHERS[i].abFrame), { tier, abKey }));
}
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
 * STATS ARE TRANSCRIBED, NOT SCALED. Weapons.txt:1995-2075 gives a full block for all three, so
 * none of them goes through scaleWeapon(). Note how far they are from anything the tier ladder
 * would have produced: the cannon reloads in 4.25s for 325-410 damage at 4,100 m, and the point
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
 */
const CAPITAL_WEAPONS = [
  { sys: 6031, ab: 71002031, slot: 'gun', key: 'capship_cannon', action: 'FireCannon',
    launch: 'Auto', max: 6, frame: 16, abFrame: 93, tyl: 250000, dur: 50000,
    views: ['Target', 'DMGHigh', 'MaxRange', 'OptimalRange', 'Accuracy', 'CriticalOffense',
            'ArmorPiercing', 'Angle', 'Cooldown', 'BuffCost'],
    st: { Accuracy: 130, DamageLow: 325, DamageHigh: 410, CriticalOffense: 100, ArmorPiercing: 40,
          MinRange: 0, OptimalRange: 2500, MaxRange: 4100, Angle: 180,
          Cooldown: 4.25, PowerPointCost: 25 } },

  { sys: 6032, ab: 71002032, slot: 'defensive_weapon', key: 'capship_pd', action: 'PointDefence',
    launch: 'Auto', max: 2, frame: 17, abFrame: 101, tyl: 90000, dur: 50000,
    views: ['Target', 'DMGHigh', 'MaxRange', 'OptimalRange', 'Accuracy', 'CriticalOffense',
            'ArmorPiercing', 'Angle', 'Cooldown', 'BuffCost'],
    st: { Accuracy: 600, DamageLow: 8, DamageHigh: 12, CriticalOffense: 100, ArmorPiercing: 5,
          MinRange: 0, OptimalRange: 1000, MaxRange: 1600, Angle: 360,
          Cooldown: 0.5, PowerPointCost: 4 } },

  /* DUMPED, not from the wiki - the closer of the dump's two tier-4 Flak families (the 90-degree
   * one; the other is a 22.5-degree 20-30 damage variant). Flak trades point defence's twitch
   * reload for reach and punch: 1.0s for 10-28 at 1,500 m against 0.5s for 8-12 at 1,600 m. */
  { sys: 6033, ab: 71002033, slot: 'defensive_weapon', key: 'capship_flak', action: 'Flak',
    launch: 'Auto', max: 2, frame: 43, abFrame: 104, tyl: 120000, dur: 50000,
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
    launch: 'Auto', max: 4, frame: 227, abFrame: 98, tyl: 300000, dur: 50000,
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

const MAX_PER_SHIP = { 1: { cannon: 4, launcher: 2 } };
for (const [tierStr, t] of Object.entries(TIER_WEAPONS))
  MAX_PER_SHIP[Number(tierStr)] = { cannon: t.maxCannon, launcher: t.maxLauncher };

/* Name resolves as bgo.<Key>.NameCylon -> .Name_<Level> -> .Name, and the final lookup returns
 * its ARGUMENT on a miss - so a dead key prints "%$bgo.<key>.Name%" on screen. Description uses
 * a try-get, so a miss yields NULL, which NREs the two widgets that call .Replace() on it.
 * system_<stem> and ability_<stem> are a PAIR - both guids need a GUI card with the same stem.
 * Default frame 159 is the red "?" tile: an obvious "nobody chose a frame" marker. */
const gui = (guid, key, frameIndex = 159, avatar = '') => card(guid, 'GUI', {
  key, level: 1,
  guiAtlasTexturePath: 'GUI/Inventory/items_atlas', frameIndex,
  guiIcon: '', guiAvatarSlotTexturePath: avatar, guiTexturePath: '', args: [],
});

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

function weaponCards() {
  const out = [];

  /* Capital weapons first. These are authored per-weapon rather than derived, so they sit outside
   * the tier loop: nothing about a 4.25-second 325-410 damage battery comes from scaling a fighter
   * autocannon. All four are Tier 4 - ShopWindow.CheckSystemForSlot requires
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

  /* STATION WEAPONS - the outpost and sentry-platform batteries.
   *
   * EVERY NUMBER ON A-E BELOW IS TRANSCRIBED VERBATIM from the level-1 card in
   * research/dumps/cards_20260729_223813.json: stats, GUI key, GUI frame, buy price, durability and
   * item class - EXCEPT three deliberate envelope fixes on the fitted A/B/C set, called out inline
   * and in the divergences note below. The guids are the LIVE guids, which are free here - all ten
   * were checked against JsonCards/*.json and this file, zero hits. The six TIERED entries that
   * follow them (6041+) are NOT verbatim - see their own block comment.
   *
   * WHY NOT CAPITAL_WEAPONS, which already exist above. Three reasons, all attested:
   *  (1) SLOT TYPE. ShipBindings.setSlots emits a turret ShipModuleBinding only for weapon-bearing
   *      slot types. 6031 is 'gun' and 6032/6033 'defensive_weapon' - the CAPITAL types - and until
   *      the guard was widened this session those emitted no binding and no turret model at all.
   *      Every NPC and station weapon in the live dump is SlotType 'weapon', so these sidestep the
   *      question entirely; Update 06.txt:50 ("the turrets on Colonial Outposts have been turned in
   *      the wrong direction") proves outposts had visible, oriented turrets.
   *  (2) RANGE. The dump's tier-4 capital long-range families carry MinRange 2300 / 2250, which
   *      WeaponAction.java:78-82 enforces as a HARD FLOOR - a station armed with them literally
   *      cannot shoot anything inside 2.25 km, i.e. anything actually attacking it.
   *  (3) PROVENANCE. The CAPITAL_WEAPONS block carries the wiki's Pegasus stat line, which is
   *      correct for the Pegasus and wrong for a station. These are the game's own station-class
   *      weapons, three of which still carry surviving display names.
   *
   * AbilityGroupId stays 1/2/3. The dump's real ids (3162894 / 26082229 / 124095957) would fail the
   * Regulation validator in this file and then KeyNotFoundException the client on its first target
   * check, so they are deliberately not used.
   *
   * Affect: MultiWeaponTarget is the dump's own value and is INERT server-side - the enum constant
   * in ShipAbilityAffect.java is its only occurrence in BSGOCore, and NpcStaticTimer.java:76 branches
   * only on == Area - so these behave as Selected. Kept because it is what the card said.
   * DELIBERATE DIVERGENCES FROM THE DUMP: MaxLevel 1 / UserUpgradeable false (we ship no level ladder
   * and nextShipSystemCardGuid is 0, so a client upgrade button would dead-end); Indestructible true
   * (durability is a hangar-repair concept an NPC has no path to); SkillHashes [] (the dump's
   * 38471110 / 75107830 are player skill hooks and no matching Skill card exists here).
   * THREE ENVELOPE FIXES on the fitted A/B/C set (2026-07-31, the tiered-platform pass) - damage,
   * cooldowns and every other stat untouched, the fitted medium loadout is approved as-is:
   *   A Angle 90 -> 180, C Angle 90 -> 360: per-mount cones are enforced from each hardpoint's own
   *     transform (WeaponAction.java:72-83), so at 90 degrees the batteries on the far flank never
   *     bear and most of a station's guns sit silent (the field-report symptom). The Pegasus wiki
   *     arcs above (180 cannon / 360 PD) are the precedent.
   *   B MaxRange 2000 -> 4000, LifeTime 50 -> 55: station aggro is already 3500/4000
   *     (NpcBehaviourTemplates.java:42-45; emit-sector-templates.js AGGRO_AUTO/AGGRO_MAX), so a
   *     sniper at 2.1 km could never be answered. The dump itself sized the round for 4 km
   *     (LifeTime 50 x Speed 80 = 4,000 m) - but that ignores the acceleration ramp: spawning at
   *     rest and accelerating at 15 m/s^2 costs 80^2/(2*15) ~= 213 m, so a 50 s round dies ~3,787 m
   *     out, just short of a full 4,000 m shot (needs ~52.7 s). 55 covers it with margin. B is
   *     shared with the outpost, so this also doubles the outpost's missile envelope - intended.
   * Range ladder after the fixes: cannons 1,600 light < 2,000 medium < 4,000 heavy; missiles
   * 3,500 / 4,000 / 4,000 - every platform can answer fire anywhere inside its own leash. */
  const STATION_VIEWS_GUN = ['DMGLow', 'DMGHigh', 'DrainHigh', 'DrainLow', 'ArmorPiercing',
    'MinRange', 'MaxRange', 'OptimalRange', 'Accuracy', 'CriticalOffense', 'Cooldown', 'BuffCost',
    'Angle', 'Durability'];
  const STATION_VIEWS_MSL = ['DMGLow', 'DMGHigh', 'ArmorPiercing', 'MinRange', 'MaxRange',
    'TurnSpeed', 'Speed', 'CriticalOffense', 'Cooldown', 'BuffCost', 'Angle', 'Durability'];
  /* The four tiered-platform hulls (PLATFORMS light/heavy below) - the shop gate for the six
   * tiered weapons. Every entry is an emitted Ship card whose ShipObjectKey EQUALS its guid
   * (platform Ship cards set ShipObjectKey = guid), which is the rule the NUKE block documents and
   * the restriction validator enforces. */
  const SENTRY_HULLS = [1783473190, 1783473192, 1783473196, 1783473198];
  const STATION_WEAPONS = [
    // A - the outpost's "long range cannons" (Outposts.txt:104). 2,000 m matches Platforms.txt:1
    // "for heavy platforms is around 2,000 metres"; the heavy set below (6051/6052) now reaches
    // 4,000. Angle 90 -> 180 is the flank-battery cone fix - divergences note above.
    { sys: 1957961850, ab: 2805480538, key: 'long_range_cruiser_cannon', frame: 100,
      action: 'FireCannon', affect: 'MultiWeaponTarget', group: GROUP_CANNON,
      sort: 'cannon', tyl: 20000, dur: 17500, views: STATION_VIEWS_GUN,
      st: { Accuracy: 125, Angle: 180, ArmorPiercing: 35, Cooldown: 4.8, CriticalOffense: 100,
            DamageLow: 35, DamageHigh: 70, MinRange: 0, OptimalRange: 800, MaxRange: 2000,
            PowerPointCost: 25 } },

    // B - the outpost's "long range missile launchers". All six rotation stats are present, so the
    // `roll is NaN` sector-killer (MovementSimulation divides by RollMaxSpeed) cannot occur.
    // MaxRange 2000 -> 4000 and LifeTime 50 -> 55: the dump sized the round for 4 km (50 s x
    // 80 m/s) but the 15 m/s^2 acceleration ramp costs ~213 m, so 50 s falls just short of a
    // 4,000 m shot - divergences note above.
    { sys: 3756543070, ab: 1849929854, key: 'large_long_range_launcher', frame: 98,
      action: 'FireMissle', affect: 'MultiWeaponTarget', group: GROUP_MISSILE,
      sort: 'missile', tyl: 20000, dur: 17500, views: STATION_VIEWS_MSL,
      st: { Angle: 90, ArmorPiercing: 35, Cooldown: 18, CriticalOffense: 100,
            DamageLow: 55, DamageHigh: 150, MinRange: 200, MaxRange: 4000, PowerPointCost: 100,
            Speed: 80, Acceleration: 15, LifeTime: 55, MaxHullPoints: 15, Avoidance: 650,
            InertiaCompensation: 100,
            YawAcceleration: 30, YawMaxSpeed: 30, PitchAcceleration: 30, PitchMaxSpeed: 30,
            RollAcceleration: 30, RollMaxSpeed: 30 } },

    // C - the outpost's "point defence systems". Affect: Area, exactly as every defensive family in
    // the dump. NOTE the reach really is 540 m - this is a last-ditch bubble, not a turret.
    // Angle 90 -> 360: a bubble with a cone was the one absurdity the dump shipped - note above.
    { sys: 1277437130, ab: 3400376042, key: 'perimiter_cannon', frame: 26,
      action: 'PointDefence', affect: 'Area', group: GROUP_DEFENSIVE,
      sort: 'pd', tyl: 20000, dur: 17500, views: STATION_VIEWS_GUN,
      st: { Accuracy: 500, Angle: 360, ArmorPiercing: 5, Cooldown: 0.5, CriticalOffense: 100,
            DamageLow: 1, DamageHigh: 5, MinRange: 0, OptimalRange: 400, MaxRange: 540,
            PowerPointCost: 3.5 } },

    // D - authored as the Medium Sentry Platform's "8 x 127 mm autocannon turrets" (Outposts.txt:38)
    // but fitted by NO ShipConfigTemplate - 202/203 arm the medium platform with A/B above. Kept
    // dump-verbatim as deliberate dead stock for a future medium re-fit.
    { sys: 4001980506, ab: 2260225690, key: 'heavy_cannon', frame: 92,
      action: 'FireCannon', affect: 'MultiWeaponTarget', group: GROUP_CANNON,
      sort: 'cannon', tyl: 20000, dur: 17500, views: STATION_VIEWS_GUN,
      st: { Accuracy: 125, Angle: 90, ArmorPiercing: 35, Cooldown: 4, CriticalOffense: 100,
            DamageLow: 35, DamageHigh: 70, MinRange: 0, OptimalRange: 675, MaxRange: 1700,
            PowerPointCost: 25 } },

    // E - authored as the Medium Sentry Platform's "5 x Medium Missile Launchers" (Outposts.txt:38).
    // Dead stock like D: fitted by no template, kept dump-verbatim.
    { sys: 2936089294, ab: 1754528990, key: 'standard_large_launcher', frame: 99,
      action: 'FireMissle', affect: 'MultiWeaponTarget', group: GROUP_MISSILE,
      sort: 'missile', tyl: 20000, dur: 17500, views: STATION_VIEWS_MSL,
      st: { Angle: 90, ArmorPiercing: 35, Cooldown: 15, CriticalOffense: 100,
            DamageLow: 55, DamageHigh: 150, MinRange: 200, MaxRange: 1800, PowerPointCost: 100,
            Speed: 80, Acceleration: 15, LifeTime: 33.75, MaxHullPoints: 15, Avoidance: 650,
            InertiaCompensation: 100,
            YawAcceleration: 30, YawMaxSpeed: 30, PitchAcceleration: 30, PitchMaxSpeed: 30,
            RollAcceleration: 30, RollMaxSpeed: 30 } },

    /* ---- TIERED SENTRY WEAPONS (2026-07-31). The wiki's Light/Heavy Sentry loadouts
     * (Outposts.txt:37/:39) map name-for-name onto dump families; stats are transcribed from the
     * level-1 family cards with the adjustments documented per entry - so these get NEW guids from
     * the free 6000+/71002000+ ranges (6041/6042 light, 6051-6054 heavy; all verified zero hits
     * across cards.js and JsonCards) rather than the dump guids, which stay reserved for verbatim
     * transcriptions. AbilityGroupId stays 1/2/3, as everywhere in this file.
     * GUI keys are the dump's FULL keys (no system_/ability_ stem prefixing): fullKey: true routes
     * the emit below through the NUKE-precedent unprefixed form, and the ability key is the system
     * key with '_system_' -> '_ability_' - one rule covers all six, all 12 keys resolve .name in
     * loca-keys.txt. System and ability share the atlas frame (dump convention).
     * ShipObjectKeyRestrictions = SENTRY_HULLS on all six: for a ShipSystem the Price card merely
     * existing puts it in the shop, and an empty BuyPrice means FREE, not hidden - a 4 km capital
     * gun on a player tier-3 hull would be broken. The gate is safe on both sides: the client
     * fetches a Ship card per entry and every entry is an emitted platform Ship card whose
     * ShipObjectKey equals its guid, and setupWeaponConfig never consults restrictions when
     * fitting NPC ships (isObjectKeyRestrictionsBlocked's only caller is the player-equip path,
     * ContainerVisitor.java:133) - so the platforms themselves still arm. A/B/C above stay
     * ungated: weaker than player T3 guns, pre-existing exposure. */

    // LIGHT - the Light Sentry's "8 x 20 mm autocannon turrets" (Outposts.txt:37), from dump family
    // item_slot_strike_stealth_weapon_system_20mm_autocannon (gun/T1: 9-18 @ 0.4 s, 0/400/650).
    // Damage x2.2 at station cadence (0.4 -> 3.5 s); Accuracy 400 KEPT - the anti-strike identity;
    // Angle 360 (turret); MaxRange 1600 is Platforms.txt:1's attested light-platform gun range.
    { sys: 6041, ab: 71002041, key: 'item_slot_strike_stealth_weapon_system_20mm_autocannon',
      fullKey: true, restrict: SENTRY_HULLS, frame: 173,
      action: 'FireCannon', affect: 'MultiWeaponTarget', group: GROUP_CANNON,
      sort: 'cannon', tyl: 20000, dur: 17500, views: STATION_VIEWS_GUN,
      st: { Accuracy: 400, Angle: 360, ArmorPiercing: 10, Cooldown: 3.5, CriticalOffense: 100,
            DamageLow: 20, DamageHigh: 40, MinRange: 0, OptimalRange: 800, MaxRange: 1600,
            PowerPointCost: 3 } },

    // LIGHT - the Light Sentry's "2 x Interceptor Missile Launchers" (Outposts.txt:37), from dump
    // family item_slot_strike_stealth_weapon_system_interceptor_missile (launcher/T1: 300 @ 30 s,
    // 300-1000). Damage x2; MaxRange 3500 attested (Platforms.txt:1); MinRange 200 (station floor,
    // not the dump's 300). LifeTime 30, NOT the naive 3500/150 ~= 23.3 s: the 15 m/s^2 ramp to
    // 150 m/s costs 150^2/(2*15) = 750 m, so a full 3,500 m shot needs ~28.3 s - same physics as
    // the B fix above. 30 covers it with margin.
    { sys: 6042, ab: 71002042, key: 'item_slot_strike_stealth_weapon_system_interceptor_missile',
      fullKey: true, restrict: SENTRY_HULLS, frame: 177,
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
    // (WeaponAction.java:78-82) would leave a campable dead zone on an immobile station - the
    // exact trap reason (2) above documents, and 6031/6033 in CAPITAL_WEAPONS are the in-file
    // precedent. Capital feel survives via Accuracy 125 + OptimalRange 2750 (a close, fast strike
    // craft is still mostly missed); the close-in deterrent is the flak/PD pair's design role.
    { sys: 6051, ab: 71002051, key: 'item_slot_capital_system_gun_long_range_cc',
      fullKey: true, restrict: SENTRY_HULLS, frame: 43,
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
      fullKey: true, restrict: SENTRY_HULLS, frame: 209,
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
    // Flak + Affect Area: AbilityActionFactory implements Flak (:89-91 -> FlakAction), and
    // NpcStaticTimer's Area branch (NpcStaticTimer.java:96-107) feeds it every enemy in the
    // station's list rather than one target - the kill-box that punishes divers.
    { sys: 6053, ab: 71002053, key: 'item_slot_capital_system_dw_aoe_flak',
      fullKey: true, restrict: SENTRY_HULLS, frame: 89,
      action: 'Flak', affect: 'Area', group: GROUP_DEFENSIVE,
      sort: 'pd', tyl: 20000, dur: 17500, views: STATION_VIEWS_GUN,
      st: { Accuracy: 300, Angle: 360, ArmorPiercing: 15, Cooldown: 1.0, CriticalOffense: 100,
            DamageLow: 20, DamageHigh: 56, MinRange: 0, OptimalRange: 1200, MaxRange: 1500,
            PowerPointCost: 7 } },

    // HEAVY - the Heavy Sentry's "2 x 15 mm Point Defence turrets" (Outposts.txt:39), from dump
    // family item_slot_capital_system_dw_point_defence (dw/T4: 3-7 @ 0.5 s). Damage x2; same Area
    // path as C and the flak above.
    { sys: 6054, ab: 71002054, key: 'item_slot_capital_system_dw_point_defence',
      fullKey: true, restrict: SENTRY_HULLS, frame: 26,
      action: 'PointDefence', affect: 'Area', group: GROUP_DEFENSIVE,
      sort: 'pd', tyl: 20000, dur: 17500, views: STATION_VIEWS_GUN,
      st: { Accuracy: 500, Angle: 360, ArmorPiercing: 5, Cooldown: 0.5, CriticalOffense: 100,
            DamageLow: 6, DamageHigh: 14, MinRange: 0, OptimalRange: 500, MaxRange: 1200,
            PowerPointCost: 3.5 } },
  ];
  /* Tier 3 is what the dump has them at, so per this file's own tier-lock rule they stay invisible
   * in the shop while every reachable hull is Tier 1 - which is what we want for NPC hardware.
   * The six tiered entries additionally carry ShipObjectKeyRestrictions (SENTRY_HULLS), so even a
   * future tier-3 player hull cannot equip them - see their block comment. */
  STATION_WEAPONS.forEach(w => out.push(
    shipSystem(w.sys, 'weapon', {
      Tier: 3, shipAbilityCards: [w.ab],
      Durability: w.dur, Class: 'Elite',
      Indestructible: true, Trashable: false, MaxCountPerShip: 0,
      ShipObjectKeyRestrictions: w.restrict || [],
      Views: w.views,
    }),
    /* fullKey entries carry the dump's FULL GUI key; the ability key is the system key with
     * '_system_' -> '_ability_' (one rule, all six) - the NUKE emit is the exact precedent. The
     * legacy five keep the system_/ability_ stem prefixing. */
    gui(w.sys, w.fullKey ? w.key : 'system_' + w.key, w.frame),
    sysPrice(w.sys, 3, w.tyl, w.sort),
    abilityCard(w.ab, w.group, w.action, 'Auto', w.st, w.affect),
    // The dump gives the system card and its ability card the SAME atlas frame on all five.
    gui(w.ab, w.fullKey ? w.key.replace('_system_', '_ability_') : 'ability_' + w.key, w.frame),
  ));

  for (const tier of [1, 2, 3, 4]) {
    const cap = MAX_PER_SHIP[tier];
    CANNONS_BY_TIER[tier].forEach(w => out.push(
      shipSystem(w.sys, 'weapon', {
        Tier: w.tier, shipAbilityCards: [w.ab],
        // Durability is the repair pool: one titanium per point. A flat 1000 made a fully worn
        // starter cannon cost 2000 T to repair - 80% of its own purchase price and 2.5x a full
        // hull repair. Scale it to the weapon instead: ~8% of price in titanium.
        // MaxCountPerShip has to grow with tier too: a carrier has ten gun slots, and a cap of
        // four would leave six of them permanently empty with no way to tell why.
        Durability: w.dur, Indestructible: true, Trashable: true, MaxCountPerShip: cap.cannon,
        Views: ['Target', 'DMGHigh', 'MaxRange', 'OptimalRange', 'Accuracy', 'CriticalOffense',
                'ArmorPiercing', 'Angle', 'Cooldown', 'BuffCost'],
      }),
      gui(w.sys, 'system_' + w.key, w.frame),
      sysPrice(w.sys, w.tier, w.tyl, 'cannon'),
      abilityCard(w.ab, GROUP_CANNON, 'FireCannon', 'Auto', w.st),
      gui(w.ab, 'ability_' + (w.abKey || w.key), w.abFrame),
    ));
    LAUNCHERS_BY_TIER[tier].forEach(w => out.push(
      /* SlotType is 'weapon' below tier 4, exactly as the dump types these guids: T1-T3 hulls
       * have no launcher slots at all, so their missiles compete with cannons for the weapon
       * hardpoints. Only tier 4 keeps 'launcher' - the slot type the four T4 hulls carry. */
      shipSystem(w.sys, tier < 4 ? 'weapon' : 'launcher', {
        Tier: w.tier, shipAbilityCards: [w.ab],
        Durability: w.dur, Indestructible: true, Trashable: true, MaxCountPerShip: cap.launcher,
        Views: ['Target', 'DMGHigh', 'MaxRange', 'Angle', 'Cooldown', 'BuffCost',
                'Speed', 'HP', 'LifeTime', 'ArmorPiercing', 'CriticalOffense'],
      }),
      gui(w.sys, 'system_' + w.key, w.frame),
      sysPrice(w.sys, w.tier, w.tyl, 'missile'),
      // "FireMissle" is the real spelling - the typo is in both the server enum and the client.
      abilityCard(w.ab, GROUP_MISSILE, 'FireMissle', 'Manual', w.st),
      gui(w.ab, 'ability_' + (w.abKey || w.key), w.abFrame),
    ));
  }
  return out;
}

/* ================================================================ EQUIPMENT (hull / engine / computer / special_weapon)
 *
 * The passive fit-out the roster flew without: every hull, engine and computer bay on every ship
 * was empty fleet-wide (338 slots), because no ShipSystem of those types existed. One family per
 * slot type per tier fills all of them - the tier lock (system tier == active ship tier, exactly)
 * means a single family covers every hull of its tier, and every family here is faction-Neutral,
 * exactly as the dump prices them.
 *
 * EVERY NUMBER IS TRANSCRIBED VERBATIM from the level-1 card of its family in
 * research/dumps/cards_20260729_223813.json: guids (all 13 checked against JsonCards - zero
 * collisions, same convention as STATION_WEAPONS), stats, durability, GUI keys and frames, buy
 * prices, item class. GUI frames repeat within a slot type by design (armor 15/15/15/205, jets
 * 18/18/18/3, battery 49x4) - the tier filter means only one tier is ever on screen at a time.
 *
 * ArmorValue and TurnAcceleration are transcribed but INERT server-side: they are real ObjectStat
 * constants (so the validator passes them), but no emitted hull Stats block seeds either key and
 * ObjectStats.applyStatsAddTo only updates keys already present - and ArmorAlgorithmV0 returns a
 * constant 1 anyway. The client tooltip still shows them, which is why they stay.
 *
 * DELIBERATE DIVERGENCES FROM THE DUMP, same set as STATION_WEAPONS: MaxLevel 1 /
 * UserUpgradeable false (we ship no level ladder), Indestructible true, SkillHashes [] (the
 * dump's hooks reference Skill cards we do not emit). MaxCountPerShip: the dump says 0
 * (unlimited, client-enforced only - the server never reads the field); we cap at the slot count
 * of the largest bay of that type per tier (5, except the T4 hull/engine bays at 4) so the cap
 * can never strand a bay.
 *
 * SHIP RESTRICTIONS ARE DROPPED ON ALL TWELVE: the dump restricts only the three T1 families, to
 * the full T1 roster of both factions BY DUMP SHIP GUIDS (dump viper = 107780547, ours = 50) -
 * porting the list verbatim would reference nonexistent ships, and the tier lock already encodes
 * the exact same gate. The nuke below is the one item that keeps a restriction list, re-pointed
 * at OUR hull guids.
 *
 * DELIBERATELY LEFT EMPTY - both are what the dump itself shows:
 *   role (4 slots, T2+T4): the dump's only role family (item_slot_capital_system_role_spawn_mode,
 *     395660941) needs ActionType Fortify, and AbilityActionFactory has NO Fortify case - casting
 *     it server-side throws IllegalArgumentException. Defer until a FortifyAction exists.
 *   avionics (18 slots, T1): the dump contains ZERO avionics ShipSystem cards - the original
 *     game's own T1 ships flew with the slot present and nothing to put in it.
 */
const EQUIP_META = {
  hull:     { itemType: 'Hull',     sort: 'armor' },
  engine:   { itemType: 'Engine',   sort: 'thruster' },
  computer: { itemType: 'Computer', sort: 'power' },
};
const EQUIPMENT = [
  // hull - the armour-plating ladder. HP for a speed/agility penalty.
  { sys: 3710683484, slot: 'hull', tier: 1, key: 'system_light_armor_hp', frame: 15, tyl: 8000, dur: 2500, max: 5,
    st: { Acceleration: -0.3, ArmorValue: 2.25, MaxHullPoints: 22.5, TurnAcceleration: -0.75 } },
  { sys: 3036094828, slot: 'hull', tier: 2, key: 'system_medium_armor_hp', frame: 15, tyl: 12000, dur: 7500, max: 5,
    st: { Acceleration: -0.15, ArmorValue: 2.125, MaxHullPoints: 82.5, TurnAcceleration: -0.375 } },
  { sys: 4123900252, slot: 'hull', tier: 3, key: 'system_large_armor_hp', frame: 15, tyl: 16000, dur: 17500, max: 5,
    st: { Acceleration: -0.075, ArmorValue: 1.75, MaxHullPoints: 175, TurnAcceleration: -0.15 } },
  { sys: 2812496040, slot: 'hull', tier: 4, key: 'item_slot_capital_system_hull_plating_hull', frame: 205, tyl: 350000, dur: 20000, max: 4,
    st: { Acceleration: -0.4, PowerRecovery: -6, MaxHullPoints: 1000 } },

  // engine - the jets ladder. Straight speed, cheapest of the three types per tier.
  { sys: 3490637135, slot: 'engine', tier: 1, key: 'system_strike_craft_jets', frame: 18, tyl: 5000, dur: 2500, max: 5,
    st: { BoostSpeed: 1.25, Speed: 1.25 } },
  { sys: 2410760927, slot: 'engine', tier: 2, key: 'system_escort_jets', frame: 18, tyl: 7500, dur: 7500, max: 5,
    st: { BoostSpeed: 1, Speed: 1 } },
  { sys: 295091983, slot: 'engine', tier: 3, key: 'system_cruiser_jets', frame: 18, tyl: 10000, dur: 17500, max: 5,
    st: { BoostSpeed: 0.75, Speed: 0.75 } },
  { sys: 3138986623, slot: 'engine', tier: 4, key: 'item_slot_capital_system_engine_turbo_boosters', frame: 3, tyl: 400000, dur: 20000, max: 4,
    st: { Acceleration: 0.2, BoostSpeed: 1.5 } },

  // computer - the battery ladder. Flat power-pool extension.
  { sys: 3027494597, slot: 'computer', tier: 1, key: 'system_battery', frame: 49, tyl: 3000, dur: 2500, max: 5,
    st: { MaxPowerPoints: 5 } },
  { sys: 4263239493, slot: 'computer', tier: 2, key: 'system_medium_battery', frame: 49, tyl: 4500, dur: 7500, max: 5,
    st: { MaxPowerPoints: 10 } },
  { sys: 1125637509, slot: 'computer', tier: 3, key: 'system_large_battery', frame: 49, tyl: 6000, dur: 17500, max: 5,
    st: { MaxPowerPoints: 25 } },
  { sys: 858754334, slot: 'computer', tier: 4, key: 'item_slot_capital_system_computer_high_density_capacitor', frame: 49, tyl: 350000, dur: 15000, max: 5,
    st: { MaxPowerPoints: 200 } },
];

/* THE T2 NUKE - the one special_weapon family in the dump, and the item that closes the two
 * special_weapon slots (dominator 5008 / banshee 5108, one each). An anti-carrier siege missile:
 * Elite class, targets Tier4 ONLY (TargetTiers, dump verbatim - it cannot be fired at a fighter),
 * 1800-2100 damage, min range 1350. ItemBuffAdd is the dump's level-1 block verbatim; it already
 * carries Speed + all six rotation stats + LifeTime + MaxHullPoints, so the projectile validator
 * passes it untouched.
 *
 * THREE DELIBERATE ADJUSTMENTS, none optional:
 *   AbilityGroupId: the dump's hash (22860668) fails this file's Regulation validator and then
 *     KeyNotFoundException-crashes the client on its first target check - same story as every
 *     other dump group id. GROUP_MISSILE, like every missile family here.
 *   ConsumableOption NotUsing + ConsumableType 0 (dump: Using / 662): the dump nuke burns an ammo
 *     item per shot (ShipConsumable 92998406, ConsumableType 662) that we do not emit. NotUsing
 *     per the launcher convention above makes the ammo check a no-op; switch to Using only once
 *     that consumable is ported AND buyable.
 *   ShipObjectKeyRestrictions [] (dump: [268081382, 218289587]): in the dump a ship's card guid
 *     EQUALS its ShipObjectKey, so one list serves both the server gate (compares objKey,
 *     ShipSystemCard.isObjectKeyRestrictionsBlocked) and the client, which fetches a SHIP card at
 *     each entry (observed live: "Card should not be send because it's null! 268081382 10" when
 *     the list carried objKeys, and objKey-vs-card-guid is split in OUR data). Emitting the
 *     restriction empty is safe because the gate is structural anyway: dominator/banshee are the
 *     ONLY hulls with a special_weapon slot. Do not emit a non-empty list unless every entry is
 *     BOTH an emitted Ship card guid and that ship's objKey. */
const NUKE = {
  sys: 2858586174, ab: 1197214302,
  key: 'item_slot_escort_system_assault_launcher_nuclear_missile_anti_carrier',
  abKey: 'item_slot_escort_ability_assault_launcher_nuclear_missile_anti_carrier',
  frame: 244, tyl: 215000, dur: 7500,
  st: { Acceleration: 20, Angle: 90, ArmorPiercing: 60, Avoidance: 550, Cooldown: 16,
        CriticalOffense: 200, DamageHigh: 2100, DamageLow: 1800, MaxHullPoints: 850,
        LifeTime: 105, MaxRange: 1900, MinRange: 1350, PowerPointCost: 42, Speed: 90,
        InertiaCompensation: 100,
        PitchAcceleration: 30, PitchMaxSpeed: 30, YawAcceleration: 30, YawMaxSpeed: 30,
        RollAcceleration: 30, RollMaxSpeed: 30 },
};

function equipmentCards() {
  const out = [];
  /* The twelve passive families are pure static-buff items: ShipSystem + GUI + Price at one guid,
   * no ability card, no Module, no ShipConfigTemplate. Buffs apply on fit via
   * ShipSubscribeInfo.applySlotSystemStats. */
  /* The hand-authored twelve are superseded by equipment-real.js - the original's own 75
   * hull/engine/computer modules, with real buffs, keys and prices. A hand entry whose guid the
   * dump also carries is dropped so the two cannot emit the same card twice. */
  const realGuids = new Set(EQUIPMENT_REAL.map(e => e.sys));
  [...EQUIPMENT.filter(m => !realGuids.has(m.sys)), ...EQUIPMENT_REAL].forEach(m => {
    const meta = EQUIP_META[m.slot];
    out.push(
      shipSystem(m.sys, m.slot, {
        Tier: m.tier,
        StaticBuffs: stats(m.st),
        Durability: m.dur, Indestructible: true, Trashable: true, MaxCountPerShip: m.max,
        Views: ['StaticBuff', 'MultiplyBuff', 'Durability'],
      }),
      // The dump's GUI key IS the family key here (no system_/ability_ stem split) - all twelve
      // resolve in loca-keys.txt with .name and .description.
      gui(m.sys, m.key, m.frame),
      sysPrice(m.sys, m.tier, m.tyl, meta.sort, meta.itemType),
    );
  });

  out.push(
    shipSystem(NUKE.sys, 'special_weapon', {
      Tier: 2, shipAbilityCards: [NUKE.ab],
      ShipObjectKeyRestrictions: [],
      Durability: NUKE.dur, Class: 'Elite',
      Indestructible: true, Trashable: true, MaxCountPerShip: 0,
      // The dump's own Views list - identical to STATION_VIEWS_MSL.
      Views: ['DMGLow', 'DMGHigh', 'ArmorPiercing', 'MinRange', 'MaxRange', 'TurnSpeed', 'Speed',
              'CriticalOffense', 'Cooldown', 'BuffCost', 'Angle', 'Durability'],
    }),
    gui(NUKE.sys, NUKE.key, NUKE.frame),
    sysPrice(NUKE.sys, 2, NUKE.tyl, 'missile'),
    abilityCard(NUKE.ab, GROUP_MISSILE, 'FireMissle', 'Manual', NUKE.st, 'Selected',
                { TargetTiers: ['Tier4'] }),
    // The dump gives system and ability GUI cards the same frame (244), like the station weapons.
    gui(NUKE.ab, NUKE.abKey, NUKE.frame),
  );
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

/* The missile PROJECTILE. The server hard-throws if Owner/World/Movement are missing at this
 * guid, so a launcher without these cards fails the moment it fires. */
const MISSILE_OBJECT = 117216909;

function missileObjectCards() {
  return [
    // The client overrides this prefab from faction+tier+type, and the server builds an explicit
    // collider rather than looking one up - so this only has to be a real, non-null ASCII string.
    card(MISSILE_OBJECT, 'World', {
      prefabName: 'colonialsmallmissile', lodCount: 1, radius: 3.0,
      spots: [], systemMapTexutres: '', frameIndex: 0, secondaryFrameIndex: 0,
      targetable: true, showBracketWhenInRange: false, forceShowOnMap: false,
    }),
    // This object is targetable, so a dead key would print on the HUD bracket.
    gui(MISSILE_OBJECT, 'missile_normal', 177, 'GUI/Slots/missile'),
    card(MISSILE_OBJECT, 'Owner', { IsDockable: false, DockRange: 0.0, Level: 1 }),
    // maxRoll must not be 0 - it is a divisor in the movement sim and 0/0 puts NaN into position.
    card(MISSILE_OBJECT, 'Movement', {
      minYawSpeed: 1.0, maxPitch: 360.0, maxRoll: 80.0,
      pitchFading: 2.0, yawFading: 2.0, rollFading: 400.0,
    }),
    card(MISSILE_OBJECT, 'Missile', { explosionView: 'Standard', missileType: 'Normal' }),
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

/* ================================================================ RESOURCES / CURRENCY
 * Every countable item the client sees needs THREE views at the same guid:
 *   GUI(1)            - icon + loca key
 *   ShipConsumable(3) - what ItemCountable.Read fetches; its Read chains the GUI card
 *   Price(23)         - ShopItemCard, needed by the shop and hangar panels
 * Guids are from the server's ResourceType enum and are FIXED. Loca keys are real keys from the
 * client's locale bundle, so these display proper names ("Tylium", "Merits") rather than raw keys.
 * Icon paths are verified Resources paths from the client's mainData container.
 */
// Loca keys verified present in the client's locale bundle, so these display real names.
// Anything not listed falls back to a generated key: missing loca renders the raw key on
// screen, which is cosmetic and obvious in QA - unlike a missing card, which hangs the client.
/* guid: [locaKey, guiIcon, frameIndex]. EVERY ResourceType guid MUST appear here.
 *
 * locaKey  - verified present with .Name AND .Description in the client's locale bundle. A dead
 *            key prints the raw "%$bgo.<key>.Name%" on screen, and makes Description NULL, which
 *            NREs the widgets that call .Replace() on it without a guard.
 * guiIcon  - loaded as a WHOLE standalone texture with NO atlas fallback by the money bar and
 *            every price row, and the image widget ADOPTS the texture's size. The old
 *            GUI/items/*_box paths are 560x380 shop banners - they inflated the currency bar into
 *            a row of posters. Any guid used as a KEY in a Price items map must keep an icon.
 * frameIndex - tile in GUI/Inventory/items_atlas: 400x946 at 40x35 = 10 cols x 27 rows = 270
 *            frames, 0 = top-left, 269 reserved. Out of range is not fatal (draws unknownItem).
 */
const RESOURCE_META = {
  // currencies / materials - frames matched pixel-for-pixel against the GUI/Common/* icons
  264733124: ['resource_cubits',            'GUI/Common/cubits',     25],
  207047790: ['resource_titanium',          'GUI/Common/titanium',    4],
  215278030: ['resource_tylium',            'GUI/Common/thylium',     6],
  130762195: ['resource_water',             'GUI/Common/water',       5],
  130920111: ['resource_token',             'GUI/Common/token',     109],
  254909109: ['resource_tuning_kit',        'GUI/Common/tuningkit', 112],
  187088612: ['consumable_tech_analysis',   '',                      22],
  63148366:  ['resource_plutonium',         '',                      12],
  172582782: ['resource_uranium',           '',                      13],
  28157328:  ['consumable_radio',           '',                     184],
  130797813: ['resource_ftl_fragment',      '',                     214],
  166681557: ['augment_teleport',           '',                     203],
  92666191:  ['augment_divine_inspiration', '',                     254],
  // event trade-in boxes - the four red/gold hexes colour-match these names
  13: ['augment_event_precious_metals', '', 132],
  11: ['augment_event_sacred_herbs',    '', 131],
  12: ['augment_event_foodstuffs',      '', 130],
  10: ['augment_event_pristine_ice',    '', 133],
  // ammunition. BEST-EFFORT frames: the atlas encodes QUALITY (silver / green tip / red tip),
  // not calibre, so the light/medium/heavy split is a judgement call. All indices are legal.
  197609684: ['consumable_standard_issue_rounds',        '',  67],
  17980086:  ['consumable_standard_issue_missile',       '',  78],
  101797958: ['consumable_high_quality_missile',         '',  77],
  126173396: ['consumable_medium_standard_rounds',       '',  69],
  5:         ['consumable_medium_high_quality_rounds',   '',  68],
  221436534: ['consumable_medium_standard_missile',      '', 175],
  228448854: ['consumable_medium_high_quality_missile',  '',  79],
  59143780:  ['consumable_heavy_standard_issue_rounds',  '', 209],
  9:         ['consumable_heavy_high_quality_rounds',    '', 120],
  218608438: ['consumable_heavy_standard_issue_missile', '', 151],
  228410854: ['consumable_heavy_high_quality_missile',   '', 157],
  113883533: ['consumable_large_power_cell',             '', 124],
  // nukes. BEST-EFFORT: 8 tiles for 6 guids; gold -> x20 family, blue -> x5 family, by size.
  98392991:  ['consumable_torpedo',          '', 260],
  174428943: ['consumable_medium_torpedo',   '', 262],
  190162639: ['consumable_large_torpedo',    '', 264],
  195427878: ['consumable_mini_nuke',        '', 261],
  57483190:  ['consumable_medium_mini_nuke', '', 263],
  56189094:  ['consumable_large_mini_nuke',  '', 265],
};

/* ---------------------------------------------------------------- SHOP STOCK
 * The shop's first pass SKIPS any Price card whose BuyPrice is empty. Empty BuyPrice means
 * "not stocked" for Resource/Consumable/Augment/Ship - it does NOT mean free. (For a ShipSystem
 * the price card only has to EXIST, so there an empty BuyPrice really does mean free.)
 *
 * Price VALUES must be integers or negative powers of two: the server charges ceil(value*count)
 * while the client compares the raw float product and derives the buy step as round(1/value).
 * Only those two families make server and client agree exactly.
 *
 * Keep to tylium/titanium/cubits - the shop row renders at most two currency components, and
 * NREs on a currency whose icon does not resolve.
 */
const TIT = 207047790, CUB = 264733124;
// guid: [Category, ItemType, BuyPrice, SellPrice, CanBeSold, SortingWeight]
const SHOP_STOCK = {
  215278030: ['Resource', 'Resource', { [CUB]: 0.03125 }, {}, false, 10],   // Tylium, 32/cubit
  207047790: ['Resource', 'Resource', { [CUB]: 0.0625 }, {}, false, 11],    // Titanium, 16/cubit
  130762195: ['Resource', 'Resource', { [TYLIUM]: 2 }, { [TYLIUM]: 1 }, true, 20],      // Water
  254909109: ['Resource', 'Resource', { [CUB]: 25 }, {}, false, 30],                    // Tuning Kit
  187088612: ['Resource', 'Resource', { [TYLIUM]: 500 }, { [TYLIUM]: 100 }, true, 31],  // Tech Analysis
  28157328:  ['Resource', 'Resource', { [TIT]: 250 }, { [TIT]: 50 }, true, 40],         // Comm Access
  130797813: ['Resource', 'Resource', { [TYLIUM]: 100 }, { [TYLIUM]: 25 }, true, 41],   // FTL fragment
  63148366:  ['Resource', 'Resource', { [TIT]: 50 }, { [TIT]: 10 }, true, 42],          // Plutonium
  // 4000, not 500: it grants x2 XP and x2 Loot for 12h (Factors.getMultiplierFor sums from 1, so
  // a value of 1.0 IS a doubling), and at 500 it paid for itself roughly eight times over.
  92666191:  ['Augment', 'Augment', { [CUB]: 4000 }, {}, false, 10],                    // Divine Inspiration

  /* Ammo and gear must be Category|ItemType Consumable|<real type>, not the Resource|Resource
   * fallback. The Consumables tab filters purely on ItemType and its sub-buttons additionally
   * require Category == Consumable, so a mistyped card is invisible in that tab entirely. */
  197609684: ['Consumable', 'Round', { [TYLIUM]: 2 }, { [TYLIUM]: 1 }, true, 20],
  126173396: ['Consumable', 'Round', { [TYLIUM]: 4 }, { [TYLIUM]: 2 }, true, 21],
  59143780:  ['Consumable', 'Round', { [TYLIUM]: 8 }, { [TYLIUM]: 4 }, true, 22],
  101797958: ['Consumable', 'Missile', { [CUB]: 1 }, { [TYLIUM]: 3 }, true, 24],
  113883533: ['Consumable', 'Power', { [TYLIUM]: 200 }, { [TYLIUM]: 50 }, true, 26],

  /* Sell-only: an empty BuyPrice keeps them OUT of the shop while SellPrice and CanBeSold still
   * apply, so the Hold shows a Salvage button. Without at least one sellable DROP a new player
   * never sees the sell flow at all - the three starting currencies are all CanBeSold false.
   * Deliberately NOT giving cubits, merits, tylium, titanium or the event boxes a sell price:
   * they are in UNTRASHABLE precisely because one misclick would destroy a balance. */
  172582782: ['Resource', 'Resource', {}, { [TIT]: 25 }, true, 43],       // uranium, a mining drop
  98392991:  ['Consumable', 'Torpedo', {}, { [TYLIUM]: 250 }, true, 27],
  195427878: ['Consumable', 'Torpedo', {}, { [TYLIUM]: 250 }, true, 28],

  /* 17980086 (Striker missiles) is deliberately NOT stocked. Every ability card carries
   * ConsumableOption 'NotUsing', so a launcher fires identically with or without ammo and the
   * stack is never decremented - stocking it at 5 tylium x a buyCount of 100 is a pure
   * 500-tylium-per-click trap. Its ShipConsumable card stays (the Wheel of Fortune still hands
   * out this guid, and a missing card hangs the client). To wire ammo up later, change BOTH
   * ConsumableType and ConsumableOption in abilityCard() - never one without the other.
   * Cubits and merits never buy themselves; the event boxes are blacklisted server-side. */
};

/* Read every ResourceType guid straight from the server enum. Hand-maintaining this list is how
 * we ended up shipping a client that stalled on Linerx5Nuke: the server hands a resource to the
 * client, the client asks for its card, and a missing one leaves an unloaded placeholder forever. */
function loadResources() {
  const f = path.resolve(CORE_SRC, 'enums/ResourceType.java');
  const src = fs.readFileSync(f, 'utf8');
  const seen = new Set();
  const out = [];
  for (const m of src.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*(\d+)L?\s*\)/gm)) {
    const [, name, guid] = m;
    if (name === 'None' || seen.has(guid)) continue;
    seen.add(guid);
    const meta = RESOURCE_META[guid];
    // Fail LOUDLY. The old fallback synthesised "item_<enumname>", which does not exist in the
    // client bundle, and shipped cards that rendered a raw %$bgo.item_x.Name% string on screen.
    if (!meta) throw new Error(
      `ResourceType.${name} (guid ${guid}) has no RESOURCE_META entry - add one. A generated ` +
      `"item_${name.toLowerCase()}" key does not exist in the client bundle.`);
    out.push({ guid: Number(guid), key: meta[0], icon: meta[1], frame: meta[2] });
  }
  return out;
}
const RESOURCES = loadResources();

// Currencies and mining resources must NEVER be destructible: the hold shows a recycle button
// purely on Trashable, dropping a countable drops the ENTIRE stack, and the server has no
// Trashable check at all. One misclick would destroy a player's whole cubit balance.
const UNTRASHABLE = new Set([215278030, 207047790, 264733124, 130920111, 130762195,
                             254909109, 187088612, 28157328, 130797813, 92666191,
                             166681557, 10, 11, 12, 13]);

// The Activate button is gated purely on IsAugment, so without this Divine Inspiration costs
// 500 cubits and can never be used. Only guids with a matching AugmentTemplate belong here.
const AUGMENTS = { 92666191: 'None', 11: 'LootItem' };

// One shop click buys exactly this many, with no confirmation dialog. A flat 100 meant 2500
// cubits per click on tuning kits.
const BUY_COUNT = {
  215278030: 1000, 207047790: 1000, 130762195: 100,
  254909109: 1, 187088612: 5, 28157328: 5, 130797813: 10, 63148366: 10,
  17980086: 100, 92666191: 1,
};

// Shop sorting is ItemType -> Tier -> SortingWeight -> guid, so an unset weight left Merits and
// Cubits sorted above the Tylium they buy.
const SORT_WEIGHT = { 264733124: 1, 130920111: 2, 215278030: 3, 207047790: 4, 130762195: 5 };

/* Guids granted by the shipped AugmentTemplates/LootTemplates that are NOT in ResourceType.
 * They land in a player's hold as loot, and the client blocks forever on an item whose cards never
 * arrive, so each needs the full GUI + ShipConsumable + Price triple.
 *
 * I previously DELETED these seven from augment_template_green.json, on the reasoning that they
 * had no loca key and no icon so they must be phantoms. That was wrong twice over: the file is
 * upstream data we do not own, and the items are real. The upstream // comments identify each by
 * family and hull class (ammo / dc / ec x striker / escort / liner), and the client ships names
 * and descriptions for all of them - I had looked for the wrong keys.
 *
 * The guid -> key mapping below is INFERRED, not attested: the comments give family+hull-class and
 * the locale uses its own taxonomy, so the join is by meaning. It is a good join - the RC-pack
 * family is literally strike/escort/line, and power cells are light/medium/heavy on the same axis
 * - but if a real dump ever surfaces, check these seven first.
 * Every key below is verified present with BOTH .Name and .Description in locale.lang_en. */
const LOOT_EXTRAS = {
  // guid: [locaKey, atlasFrame, consumableType]
  3:         ['consumable_high_quality_rounds', 156, 1],            // Light HESC Rounds   (striker ammo)
  2836381:   ['item_consumable_strike_rc_pack', 190, 0],            // Strike RC Pack      (striker dc)
  103992173: ['item_consumable_escort_rc_pack', 190, 0],            // Escort RC Pack      (escort dc)
  201509789: ['item_consumable_line_rc_pack', 190, 0],              // Line RC Pack        (liner dc)
  25398605:  ['consumable_high_quality_power_cell', 128, 0],        // Light Improved Power Cell
  136433549: ['consumable_medium_hiqh_quality_power_cell', 128, 0], // Medium Improved  (sic: 'hiqh')
  232850813: ['consumable_large_high_quality_power_cell', 128, 0],  // Heavy Improved Power Cell
};

function lootExtraCards() {
  return Object.entries(LOOT_EXTRAS).flatMap(([g, [key, frame, consType]]) => {
    const guid = Number(g);
    return [
      card(guid, 'GUI', {
        // level 0, not 1: these have a plain .Name with no _<level> variant, and GUICard tries
        // Name_<Level> before Name, so any level works - but 0 matches the other countables.
        key, level: 0,
        guiAtlasTexturePath: 'GUI/Inventory/items_atlas', frameIndex: frame,
        guiIcon: '', guiAvatarSlotTexturePath: '', guiTexturePath: '', args: [],
      }),
      card(guid, 'ShipConsumable', {
        // ConsumableType 1 marks launcher/cannon ammo so the client can pair it to a weapon;
        // 0 is a general consumable. Tier 0 means "fits every ship tier" - a real tier here
        // would hide the item on every hull of another tier, including in your own hold.
        ConsumableType: consType, Tier: 0,
        ItemBuffMultiply: stats({}), ItemBuffAdd: stats({}),
        Action: 'None', IsAugment: false, AutoConsume: false,
        Trashable: true,
        buyCount: 1, consumableAttributes: [], effectType: 'None',
      }),
      // Empty BuyPrice keeps these OUT of the shop (the shop skips an empty buy price for a
      // countable), which is what we want - they are drops, not stock. They ARE sellable, so a
      // green box is worth opening.
      card(guid, 'Price', {
        Category: 'Consumable', ItemType: 'Consumable', Tier: 0, Faction: 'Neutral',
        SortingNames: [], SortingWeight: 900,
        BuyPrice: price({}), UpgradePrice: price({}),
        SellPrice: price({ [TYLIUM]: 25 }), CanBeSold: true,
      }),
    ];
  });
}

function resourceCards() {
  return RESOURCES.flatMap(r => {
    const s = SHOP_STOCK[r.guid];
    return [
      card(r.guid, 'GUI', {
        // level 0, not 1: a "LEVEL n" chip is rendered whenever Level > 0, which is meaningless
        // on a stack of water. 0 is safe elsewhere - selling and trashing both allow it.
        key: r.key, level: 0,
        guiAtlasTexturePath: 'GUI/Inventory/items_atlas', frameIndex: r.frame,
        guiIcon: r.icon, guiAvatarSlotTexturePath: '', guiTexturePath: '', args: [],
      }),
      card(r.guid, 'ShipConsumable', {
        // ConsumableType 1 marks launcher ammo; the client pairs ammo to a launcher by
        // matching this against the ability's ConsumableType.
        ConsumableType: r.guid === 17980086 ? 1 : 0,
        // Tier 0 means "any tier". The Store tab force-enables a tier filter against this
        // field, so Tier 1 would make every consumable vanish on a tier-2 hull.
        Tier: 0,
        ItemBuffMultiply: stats({}), ItemBuffAdd: stats({}),
        Action: AUGMENTS[r.guid] || 'None',
        IsAugment: AUGMENTS[r.guid] !== undefined,
        AutoConsume: false,
        Trashable: !UNTRASHABLE.has(r.guid),
        buyCount: BUY_COUNT[r.guid] || 1, consumableAttributes: [],
        // Must not be a nuclear type unless the nuke projectile guids are authored - the fire
        // action would select an unauthored projectile.
        effectType: r.guid === 17980086 ? 'DamageExplosion' : 'None',
      }),
      card(r.guid, 'Price', {
        Category: s ? s[0] : 'Resource', ItemType: s ? s[1] : 'Resource',
        Tier: 1, Faction: 'Neutral',
        SortingNames: [], SortingWeight: SORT_WEIGHT[r.guid] || (s ? s[5] : 100),
        BuyPrice: price(s ? s[2] : {}), UpgradePrice: price({}),
        SellPrice: price(s ? s[3] : {}), CanBeSold: s ? s[4] : false,
      }),
    ];
  });
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
const PLANETOIDS = [47343042, 47344578, 47344835, 47344836];

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
 *                           Missile Launcher (STATION_WEAPONS 6041/6042)
 *   Medium Sentry Platform: 10,000 Hull, 3,000 Energy, 8 x 127 mm autocannon + 5 x Medium Missile
 *                           Launcher (202/203 fit the outpost's A/B - see D/E's dead-stock note)
 *   Heavy Sentry Platform:  15,000 Hull, 3,000 Energy, 2 x 63 mm Flak + 2 x 15 mm PD +
 *                           8 x 40.6 cm cannon + 5 x Heavy Missile Launcher (6051-6054)
 * The armament counts are why the prefabs carry exactly 13 / 10 / 16 usable mounts (see
 * HARDPOINTS; large is one short of Heavy's 17, hence the shared-spot 17th slot below). Armour
 * 35/60/75 is attested but NOT shipped: ArmorAlgorithmV0.getMultiplicator returns a constant 1,
 * so ArmorValue is inert.
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
  PLANETOIDS.forEach((guid, i) => {
    out.push(card(guid, 'World', {
      prefabName: 'planetoid' + ((i % 3) + 1) + '_' + ((i % 3) + 1), lodCount: 1, radius: 400.0,
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
    return mine.sort((a, b) => order.indexOf(a.hangar) - order.indexOf(b.hangar)).map(h => h.g);
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
    card(226, 'ShipPaint', { model: 'default', paintTexture: '', shipCardGuid: 2366349390 }),
    card(227, 'ShipPaint', { model: 'default', paintTexture: '', shipCardGuid: 1427261742 }),

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

const NPC_GUI = { Apollo: 575838400, Leoben: 575838401 };

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
  out.push(card(NPC_GUI.Apollo, 'GUI', missionGui('npc_apollo')));
  out.push(card(NPC_GUI.Leoben, 'GUI', missionGui('npc_no2')));
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
function loadEnumNames(relPath) {
  const f = path.resolve(CORE_SRC, relPath);
  try {
    const src = fs.readFileSync(f, 'utf8');
    const body = src.slice(src.indexOf('{') + 1);
    const names = new Set();
    for (const m of body.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)) names.add(m[1]);
    return names.size ? names : null;
  } catch { return null; }
}
const OBJECT_STATS = loadEnumNames('templates/utils/ObjectStat.java');

function validate(cards) {
  const errs = [];
  const seen = new Map();

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

  /* StatView is a PLAIN enum (no constructor args) so the generic loader's regex misses it.
   * An unknown name in a Views array becomes a null enum and NPEs on write - which the server
   * answers by closing the client's socket, with no clue on the client side. */
  const STAT_VIEWS = (() => {
    try {
      const src = fs.readFileSync(path.resolve(CORE_SRC, 'templates/utils/StatView.java'), 'utf8');
      // Start at the enum's opening brace - the package declaration's semicolon comes BEFORE it,
      // so searching for the first ';' in the whole file inverts the slice and yields nothing.
      const open = src.indexOf('{');
      const semi = src.indexOf(';', open);
      const body = src.slice(open + 1, semi === -1 ? src.lastIndexOf('}') : semi);
      const names = new Set();
      for (const m of body.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:,|$)/gm)) names.add(m[1]);
      return names.size ? names : null;
    } catch { return null; }
  })();
  if (!STAT_VIEWS) errs.push('could not read StatView.java - refusing to emit blind');
  else cards.filter(c => Array.isArray(c.Views)).forEach(c =>
    c.Views.forEach(v => {
      if (!STAT_VIEWS.has(v))
        errs.push(`ShipSystem ${c.cardGUID}: "${v}" is not a StatView constant - null enum, NPE on write`);
    }));

  /* An equip that references a missing ability card sets the slot FIRST and then throws, after
   * the item has already left the hold - so the item silently vanishes. Catch it here instead. */
  cards.filter(c => c.cardView2 === 'ShipSystem').forEach(c => {
    (c.shipAbilityCards || []).forEach(ab => {
      if (!cards.some(x => x.cardGUID === ab && x.cardView2 === 'ShipAbility'))
        errs.push(`ShipSystem ${c.cardGUID}: ability ${ab} has no ShipAbility card - equipping it destroys the item`);
      if (!cards.some(x => x.cardGUID === ab && x.cardView2 === 'GUI'))
        errs.push(`ShipAbility ${ab}: no GUI card at the ability guid - the item never finishes loading`);
    });
    if (!cards.some(x => x.cardGUID === c.cardGUID && x.cardView2 === 'Price'))
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
            if (!need) continue;                      // Debris and friends are skipped by the spawner
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
        // Both lookups are level-aware (GUICard.cs:38-82): Name tries NameCylon, then
        // Name_<Level>, then Name; Description tries Description_<Level>, then Description. Any
        // one of those forms satisfies it - the ship keys only ship the _1/_2 variants.
        const anyOf = (...forms) => forms.some(f => LOCA_KEYS.has(`bgo.${c.key}.${f}`));
        if (!anyOf('name', `name_${c.level}`, 'namecylon'))
          errs.push(`GUI ${c.cardGUID}: bgo.${c.key}.Name is not in the client bundle - the raw %$bgo...% prints on screen`);
        if (!anyOf('description', `description_${c.level}`))
          console.warn(`GUI ${c.cardGUID}: bgo.${c.key}.Description is not in the client bundle - GUICard.Description yields null and NREs the widgets that .Replace() on it`);
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
  const sysTypes = new Set(cards.filter(c => c.cardView2 === 'ShipSystem').map(c => c.SlotType));
  shipsAll.forEach(c => (c.Slots || []).forEach(s => {
    if (!SLOT_TYPES.includes(s.SystemType))
      errs.push(`Ship ${c.cardGUID} slot ${s.SlotId}: "${s.SystemType}" is not a ShipSlotType - null enum, NPE on write`);
    if (s.SystemType === 'undefined')
      errs.push(`Ship ${c.cardGUID} slot ${s.SlotId}: undefined has no bgo.shop.undefined loca and renders "[]"`);
  }));

  /* A SLOT TYPE WITH NO SYSTEMS AT ALL IS A CONTENT GAP, NOT A DATA DEFECT - and it is reported
   * once per TYPE, not once per slot.
   *
   * This used to be an error per slot. That was right while the slot table was hand-written, where
   * an unfillable slot meant somebody had invented a slot type. It is wrong now that the layouts
   * come from the live-server dump: the real hulls carry hull / computer / engine / avionics slots,
   * we have simply never authored a single module to put in them, and the previous rule turned that
   * one missing feature into 380 identical error lines that failed the build.
   *
   * The distinction that still matters is kept below: a type we DO stock, on a hull where nothing
   * fits, is a real defect and stays an error. */
  const gapTypes = new Map();
  shipsAll.forEach(c => (c.Slots || []).forEach(s => {
    if (SLOT_TYPES.includes(s.SystemType) && s.SystemType !== 'undefined' && !sysTypes.has(s.SystemType))
      gapTypes.set(s.SystemType, (gapTypes.get(s.SystemType) || 0) + 1);
  }));
  [...gapTypes.entries()].sort((a, b) => b[1] - a[1]).forEach(([t, n]) => {
    console.warn(`CONTENT GAP: ${n} slot(s) of type "${t}" across the roster, and the catalogue has `
      + `no ShipSystem of that type - those slots render empty and nothing can be fitted to them. `
      + `The dump has 3,607 ShipSystem cards to draw the missing families from.`);
  });
  sysTypes.forEach(t => {
    if (t !== 'ship_paint' && !shipsAll.some(c => (c.Slots || []).some(s => s.SystemType === t)))
      errs.push(`ShipSystem type ${t} exists but no ship declares a ${t} slot - unequippable`);
  });

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

  /* Price VALUES must be integers or NEGATIVE POWERS OF TWO: the server charges ceil(value*count)
   * while the client compares the raw float and derives the buy-arrow step as round(1/value).
   * Only those two families make the two sides agree exactly. And at most TWO currency components:
   * the shop row has exactly two icon/label pairs and the loop silently overwrites the second. */
  const priceOk = v => Number.isInteger(v) ||
    (v > 0 && Number.isInteger(1 / v) && ((1 / v) & ((1 / v) - 1)) === 0);
  cards.filter(c => c.cardView2 === 'Price').forEach(c => {
    ['BuyPrice', 'UpgradePrice', 'SellPrice'].forEach(k => {
      const items = (c[k] && c[k].items) || {};
      Object.entries(items).forEach(([g, v]) => {
        if (!priceOk(v))
          errs.push(`Price ${c.cardGUID}.${k}[${g}] = ${v} is neither an integer nor a negative power of two - ceil() vs raw float disagree`);
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
const world = [...roomCards(), ...sectorCards(), ...sectorObjectCards(), ...sectorFurnitureCards(), ...resourceCards(), ...lootExtraCards()];
const weapons = [...weaponCards(), ...equipmentCards(), ...missileObjectCards(), ...moduleCards(), ...cometCards()];
const ADVANCED_HULLS = HULLS.filter(h => !h.npcOnly && !h.rentalOnly).map(h => Object.assign({}, h, {
  g: h.g + ADVANCED_OFFSET, advanced: true, starter: false,
  name: 'Advanced ' + h.name,
  hp: Math.round(h.hp * 1.18), pwr: Math.round(h.pwr * 1.15), speed: Math.round(h.speed * 1.05),
}));
const ships = [...HULLS.filter(h => !h.starter), ...NPC_HULLS, ...NPC_HEAVIES, ...ADVANCED_HULLS].flatMap(shipCards);
const progression = progressionCards();
const all = [...boot, ...starters, ...world, ...ships, ...weapons, ...progression];

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
