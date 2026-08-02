/* ================================================================ THE GALAXY
 * The 58 accessible Veil Sector systems, and the staging control that decides how many of them
 * ship. Single source of truth for BOTH consumers:
 *   cards.js                  - Sector / GUI / Regulation cards and the GalaxyMap star map
 *   emit-sector-templates.js  - the SectorTemplate JSON each of those stars requires on disk
 * They must agree, so neither owns the table.
 *
 * Id, cardGuid, galaxy position, GUIIndex and both threat levels are TRANSCRIBED from
 * research/Server.cs (58 `new Sector(`) and research/Catalogue.cs (58 `MapStarDesc`). Nothing in
 * the table is invented. Content tier is a coverage score, documentation only - no code reads it.
 *
 * ---------------------------------------------------------------- WHY THE ID IS LOAD-BEARING
 * 1. SectorDesc.cs:68 -  public string Name => BsgoLocalization.Get("bgo.sector" + Id + ".Name")
 *    The display name comes from the star Id ALONE. No card, no server string. Whatever id we
 *    ship a star at is what the player reads.
 * 2. Catalogue.getSectorCardByID(id) (Catalogue.java:190-203) scans every GUI card for the one
 *    whose key == "sector" + id, then fetches the Sector card at THAT card's guid. The GUI key and
 *    the shared guid are mechanism, not decoration.
 *
 * ALL 58 IDS RESOLVE TO A REAL SYSTEM NAME IN OUR BUNDLE - INCLUDING 110-114. Checked row by row
 * against tools/cardgen/loca-keys.txt:
 *   bgo.sector110..114.Name  =>  Rayet / Canaris / Carillon / Exomera / 14 Toah   ALL PRESENT
 *   bgo.sector85.Name        =>  "New Sector"  (a placeholder)
 *   bgo.sector86..89.Name    =>  DO NOT EXIST
 * So do NOT re-home the five Update-51 systems to 85-89: that ships one placeholder name and four
 * dead keys. 57 of 58 names match Server.cs exactly; the one that does not is id 9, where
 * Server.cs repeats "Alpha Ceti" and our locale disambiguates it to "Alpha Extigens".
 *
 * ---------------------------------------------------------------- STAGE IS A LOADED GUN
 * SectorRegistry.java:52-68 walks EVERY star in galaxyMapCard.getStars() inside the bean
 * constructor and calls sectorFactory.createSector(id). With no SectorTemplate carrying that
 * sectorID, SectorFactory.java:102-108 throws
 *     IllegalArgumentException("SectorTemplate is null inside sector creation!")
 * and nothing between those two points catches it. Galaxy, GameServer, ProtocolRegistry and
 * GameProtocol all take SectorRegistry as a constructor dependency, so SectorRegistry failing means
 * nothing that serves a player can be built either. A star without a template is NOT "a system you
 * cannot visit" - it is a dead server, and the exception message does not name the sector.
 * NEVER raise STAGE without running emit-sector-templates.js in the same commit. The galaxy
 * validators in cards.js turn that mistake into a build failure that lists every missing id.
 *
 * ---------------------------------------------------------------- COLUMNS
 * grp -> jump and outpost eligibility, derived from 26 wiki pages that each bar ONLY the enemy
 * faction; the home faction is never barred from its own restricted system. The live server dump
 * (research/dumps/dump_sectors.json) independently confirms this on every star it did not
 * otherwise alter: 2 Balent colonial-only, 12 Fenris cylon-only, 22 Wegelin colonial-only,
 * 27 Spectris cylon-only.
 *   'CR' colonial_restricted   Cylons may not enter                              6 rows
 *   'KR' cylon_restricted      Colonials may not enter                           6 rows
 *   'Cc' colonial_controlled   both may jump, Cylon outposts barred              7 rows
 *   'Kc' cylon_controlled      both may jump, Colonial outposts barred           7 rows
 *   '--' contested             no restriction                                   32 rows
 *
 * cThr/kThr are per-faction recommended level, NOT a range (MapStarDesc.cs:13-15), written as
 * int16 (MapStarDesc.java:49-50). 255 is upstream's "the enemy may not come here" sentinel and
 * appears on exactly the 8 non-base restricted rows; the 4 base sectors carry 0/0.
 *
 * sizeM is the per-side sector size. The Sector card's Width/Length is 2x it - Width is the FULL
 * span: SpaceLevel.cs:134 flags the player out of bounds past GetSectorSize().x / 2f, and
 * GetSectorSize() is (Card.Width, Card.Length). Upstream's own sectorTemplate10 places objects out
 * to |x| = 7367.9, which needs a half-extent of 10,000 - so 10000 -> 20000 is what works. The
 * three 40,000 m Update-51 systems get 80000.
 *
 * NOTE G - the guid for ids 20-29. Server.cs and Catalogue.cs both give ten-digit values
 * 1957811313..1957811322. Every other sector guid in the game is nine digits, and the live server
 * reports 195781313..195781322. The nine-digit block bases are all congruent to 1 mod 16 and
 * spaced by multiples of 16; the ten-digit form breaks that family by three orders of magnitude.
 * INERT either way - the sector card guid is ours to choose and only has to be unique and to match
 * the star's SectorGUID and the GUI card's guid. Shipped as victti's literal values because those
 * are the decompiled client's own bytes.
 */
'use strict';

//    id     cardGuid        x       y  gui  cThr kThr  grp    sizeM tier    name
const GALAXY = [
  [  0,  163231265,  -302.0,  233.8, 0,   0,   0, 'CR', 10000, 'D'],  // Alpha Ceti      COLONIAL HOME + START
  [  1,  163231266,  -218.1,  217.0, 0,   2, 255, 'CR', 10000, 'B'],  // Beta Antini
  [  2,  163231267,  -157.0,  241.5, 1,   5,   5, 'Cc', 10000, 'B'],  // Balent
  [  3,  163231268,    59.0,  230.8, 1,   8,   8, '--', 10000, 'A'],  // Denebol
  [  4,  163231269,   173.7,  198.9, 1,   5,   5, 'Kc', 10000, 'A'],  // 69 Otaan
  [  5,  163231270,   254.9,  211.0, 1, 255,   2, 'KR', 10000, 'B'],  // 103 Heleb
  [  6,  163231271,   317.0,  209.0, 0,   0,   0, 'KR', 10000, 'D'],  // 242 Apollid     CYLON HOME + START
  [  7,  163231272,  -354.5,  160.8, 0,   3, 255, 'CR', 10000, 'B'],  // Tau Nehmet
  [  8,  163231273,  -271.1,  159.9, 1,   4, 255, 'CR', 10000, 'A'],  // Epsilon Krau
  [  9,  163231274,   -40.0,  231.4, 1,   8,   8, '--', 10000, 'B'],  // Alpha Extigens
  [ 10,  195781329,     8.1,  192.3, 0,  13,  13, '--', 10000, 'A'],  // Tannhauser
  [ 11,  195781330,    99.6,  174.0, 0,   7,   7, '--', 10000, 'A'],  // 71 Duneyrr
  [ 12,  195781331,   293.2,  154.0, 0, 255,   4, 'KR', 10000, 'A'],  // Fenris
  [ 13,  195781332,   360.8,  132.7, 1, 255,   3, 'KR', 10000, 'B'],  // 101 Crucis
  [ 14,  195781333,  -104.1,  210.4, 1,   6,   6, 'Cc', 10000, 'B'],  // Sigma Lyraes
  [ 15,  195781334,  -299.0,   94.8, 0,   9,   9, 'Cc', 10000, 'A'],  // Tau Carinai
  [ 16,  195781335,   -80.9,  153.3, 1,  12,  12, '--', 10000, 'A'],  // Omicron Decimus
  [ 17,  195781336,  -126.9,  103.8, 1,  15,  15, '--', 10000, 'B'],  // Tau Altaar
  [ 18,  195781337,   134.0,  124.1, 1,  12,  12, '--', 10000, 'A'],  // 84 Cerbero
  [ 19,  195781338,   265.0,   84.4, 1,   9,   9, 'Kc', 10000, 'A'],  // Anachron
  [ 20, 1957811313,   218.2,  150.0, 1,   6,   6, 'Kc', 10000, 'A'],  // 74 Imsida       guid: note G
  [ 21, 1957811314,  -379.8,   92.2, 1,  10,  10, 'Cc', 10000, 'B'],  // Omicron Percei  guid: note G
  [ 22, 1957811315,  -194.1,  149.5, 0,  11,  11, 'Cc', 10000, 'A'],  // Wegelin         guid: note G
  [ 23, 1957811316,  -222.3,   69.7, 0,  16,  16, 'Cc', 10000, 'B'],  // Marsamxett      guid: note G
  [ 24, 1957811317,     6.6,  133.8, 0,  19,  19, '--', 10000, 'B'],  // Raastaban       guid: note G
  [ 25, 1957811318,   134.0,   34.8, 0,  16,  16, '--', 10000, 'A'],  // 51 Bonamist     guid: note G
  [ 26, 1957811319,   197.0,   64.6, 0,  13,  13, 'Kc', 10000, 'B'],  // 68 Lepporis     guid: note G
  [ 27, 1957811320,   344.8,   75.7, 0,  10,  10, 'Kc', 10000, 'A'],  // Spectris        guid: note G
  [ 28, 1957811321,  -298.3,   28.9, 0,  14,  14, 'Cc', 10000, 'B'],  // Epsilon Iordiani guid: note G
  [ 29, 1957811322,  -298.0,  -51.8, 1,  17,  17, '--', 10000, 'A'],  // Asterian        guid: note G
  [ 30,  195781361,  -195.0,    4.2, 1,  20,  20, '--', 10000, 'B'],  // Kryphon
  [ 31,  195781362,    74.0,   54.6, 1,  20,  20, '--', 10000, 'B'],  // Nastrond
  [ 32,  195781363,   169.3,  -14.0, 1,  20,  20, '--', 10000, 'B'],  // 32 Serpentos
  [ 33,  195781364,   306.4,  -46.8, 0,  17,  17, 'Kc', 10000, 'A'],  // Zeidian
  [ 34,  195781365,   268.2,   13.9, 0,  14,  14, 'Kc', 10000, 'B'],  // 21 Tiche
  [ 35,  195781366,  -243.1, -108.1, 1,  18,  18, '--', 10000, 'A'],  // Beta Pleiadis
  [ 36,  195781367,  -200.5,  -54.5, 0,  20,  20, '--', 10000, 'B'],  // Gamma Gurun
  [ 37,  195781368,   -69.5,   58.8, 0,  20,  20, '--', 10000, 'B'],  // Huginn
  [ 38,  195781369,    64.9, -106.4, 1,  20,  20, '--', 10000, 'A'],  // Muninn
  [ 39,  195781370,    96.6,  -43.9, 0,  20,  20, '--', 10000, 'A'],  // 82 Tenland
  [ 40,  195781345,   156.7,  -82.9, 1,  20,  20, '--', 10000, 'B'],  // 169 Aretis
  [ 41,  195781346,   243.4,  -89.1, 0,  18,  18, '--', 10000, 'A'],  // 276 Exrun
  [ 42,  195781347,  -120.4, -142.8, 1,  20,  20, '--', 10000, 'A'],  // Delta Aurican
  [ 43,  195781348,  -113.5,    6.2, 1,  20,  20, '--', 10000, 'A'],  // Geirrod
  [ 44,  195781349,  -133.2,  -66.6, 1,  20,  20, '--', 10000, 'A'],  // Abalon
  [ 45,  195781350,   -68.2, -201.8, 0,  20,  20, '--', 10000, 'A'],  // Hatir
  [ 46,  195781351,     7.3, -165.2, 1,  20,  20, '--', 10000, 'A'],  // Calibaan
  [ 47,  195781352,    90.8, -186.2, 1,  20,  20, '--', 10000, 'B'],  // Vidofnir
  [ 48,  195781353,   176.2, -159.8, 1,  20,  20, '--', 10000, 'B'],  // 227 Gemino
  [ 49,  195781354,  -364.2,    4.7, 0,   0,   0, 'CR', 10000, 'D'],  // Delta Canopis   COLONIAL BASE
  [ 50,  195781137,   342.4,    5.5, 0,   0,   0, 'KR', 10000, 'D'],  // 47 Tartalon     CYLON BASE
  [ 51,  195781138,  -194.0, -173.0, 0,  20,  20, '--', 10000, 'A'],  // Muspell
  [ 52,  195781139,   249.0, -164.0, 0,  20,  20, '--', 10000, 'A'],  // Nilfhel
  [110,  179711473,  -354.0,  214.0, 0,   6, 255, 'CR', 10000, 'A'],  // Rayet
  [111,  179711474,   364.0,  184.0, 1, 255,   6, 'KR', 10000, 'A'],  // Canaris
  [112,  179711475,   -46.0,  109.0, 0, 115, 115, '--', 40000, 'A'],  // Carillon        40,000 m
  [113,  179711476,     6.0,   37.0, 0, 120, 120, '--', 40000, 'A'],  // Exomera         40,000 m
  [114,  179711477,    60.0,  106.0, 0, 115, 115, '--', 40000, 'A'],  // 14 Toah         40,000 m
];

/* Display names, for FILENAMES AND LOG LINES ONLY - never for anything the player sees.
 * SectorDesc.cs:68 resolves the name the player reads from the star Id alone, via
 * BsgoLocalization.Get("bgo.sector" + Id + ".Name"), so these strings are never sent and never
 * rendered. They exist so that sectorTemplate33_Zeidian.json is greppable and so a stack trace
 * names a system rather than a number. Every one is the value our own locale bundle returns for
 * that key; where Server.cs disagrees (id 9, which it calls a second "Alpha Ceti") the bundle
 * wins, because the bundle is what the client will actually display. */
const NAMES = {
  0: 'Alpha Ceti', 1: 'Beta Antini', 2: 'Balent', 3: 'Denebol', 4: '69 Otaan', 5: '103 Heleb',
  6: '242 Apollid', 7: 'Tau Nehmet', 8: 'Epsilon Krau', 9: 'Alpha Extigens', 10: 'Tannhauser',
  11: '71 Duneyrr', 12: 'Fenris', 13: '101 Crucis', 14: 'Sigma Lyraes', 15: 'Tau Carinai',
  16: 'Omicron Decimus', 17: 'Tau Altaar', 18: '84 Cerbero', 19: 'Anachron', 20: '74 Imsida',
  21: 'Omicron Percei', 22: 'Wegelin', 23: 'Marsamxett', 24: 'Raastaban', 25: '51 Bonamist',
  26: '68 Lepporis', 27: 'Spectris', 28: 'Epsilon Iordiani', 29: 'Asterian', 30: 'Kryphon',
  31: 'Nastrond', 32: '32 Serpentos', 33: 'Zeidian', 34: '21 Tiche', 35: 'Beta Pleiadis',
  36: 'Gamma Gurun', 37: 'Huginn', 38: 'Muninn', 39: '82 Tenland', 40: '169 Aretis',
  41: '276 Exrun', 42: 'Delta Aurican', 43: 'Geirrod', 44: 'Abalon', 45: 'Hatir', 46: 'Calibaan',
  47: 'Vidofnir', 48: '227 Gemino', 49: 'Delta Canopis', 50: '47 Tartalon', 51: 'Muspell',
  52: 'Nilfhel', 110: 'Rayet', 111: 'Canaris', 112: 'Carillon', 113: 'Exomera', 114: '14 Toah',
};

/* Batch order. Each entry is the CUMULATIVE id set, so bumping STAGE by one is the whole change
 * and reverting the number restores the previous galaxy exactly.
 *
 * STAGE 0 IS NOT REACHABLE FROM THIS TABLE. At the real coordinates the three originally-shipped
 * stars are not traversable: Alpha Ceti -> Tannhauser is 312.9 and 242 Apollid -> Tannhauser
 * 309.4, both past the 200-unit FtlRange every hull carries. The V2(-40,0)/V2(0,20)/V2(40,0)
 * coordinates we shipped before were the only reason that map worked. Stage 0 exists here as
 * documentation of what we came from; rolling back means reverting, not lowering STAGE to 0.
 *
 * Stage sizes ramp roughly geometrically so the per-sector tick and memory cost can be
 * extrapolated before committing. Sector.run() (Sector.java:100-131) is an unconditional
 * while-loop on a virtual thread whether or not a player is present (SectorRegistry.java:84).
 */
const STAGES = {
  0: [0, 6, 10],
  1: [0, 2, 4, 6, 10],
  2: [0, 2, 3, 4, 6, 10, 11, 16, 18, 25, 43],
  3: [0, 2, 3, 4, 6, 9, 10, 11, 15, 16, 18, 19, 22, 24, 25, 27, 29, 37, 43, 51],
  4: [0, 2, 3, 4, 6, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30,
      33, 34, 37, 43, 51],
  5: [0, 2, 3, 4, 6, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
      31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 51, 52],
  6: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
      26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48,
      51, 52],
  7: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
      26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48,
      49, 50, 51, 52],
  8: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
      26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48,
      49, 50, 51, 52, 110, 111, 112, 113, 114],
};
const STAGE = 8;                        // <- the one number that grows the galaxy

/* The three templates that are UPSTREAM DATA, hand-authored by Bigpoint and shipped with BSGOCore.
 * emit-sector-templates.js refuses to write these ids: whatever a generator produces, it is not
 * what shipped, and sector 10's 1,360-asteroid field and hand-placed planetoids are the only
 * genuine sector content we have. Our own edits to them (the outposts, the platform rings, the
 * out-of-bounds asteroid) are surgical and in-place. */
const UPSTREAM_TEMPLATES = new Set([0, 6, 10]);

/* ONE Regulation card for the whole galaxy, replacing 57 near-duplicates.
 * SectorFactory.java:91 resolves it per sector from sectorCard.getRegulationCardGuid(), and any
 * number of Sector cards may name the same guid. Every field on RegulationCard is read-only on
 * both sides of the wire and no call site mutates it, so sharing is behaviourally identical to
 * minting one per sector. Kept at 310000 so sector 0's existing Regulation card does not move. */
const SHARED_REGULATION = 310000;

/* Faction gates. CanJumpColonial / CanJumpCylon are SERVER-ONLY (MapStarDesc.java:44-56 writes
 * eleven fields and these two are not among them) and are the authoritative check at
 * GameProtocol.java:363-364. The outpost columns record who may HOLD an outpost here. */
const CONTROL = {
  CR:   { colJump: true,  cylJump: false, colOutpost: true,  cylOutpost: false },
  KR:   { colJump: false, cylJump: true,  colOutpost: false, cylOutpost: true  },
  /* Cc/Kc were one-faction outpost space; both flags are now true so every system both sides
   * can reach is also a system both sides can HOLD. The cost: patch 0013's seeding rule keys
   * off single-flag systems, so Cc/Kc now boot contested (empty) instead of pre-held by their
   * historical owner - reclaiming them is gameplay. Home space (CR/KR) keeps single-faction
   * outposts because the enemy cannot jump there at all. */
  Cc:   { colJump: true,  cylJump: true,  colOutpost: true,  cylOutpost: true  },
  Kc:   { colJump: true,  cylJump: true,  colOutpost: true,  cylOutpost: true  },
  '--': { colJump: true,  cylJump: true,  colOutpost: true,  cylOutpost: true  },
};

/* The hardcoded base sectors, GalaxyMapCard.java:88-102. Not read from any card, so this table
 * has to mirror the Java by hand. OutpostSpawnTimer.java:43-56 spawns the owner's outpost in these
 * four unconditionally, ignoring canOutpost, opPoints and the 900 threshold alike. */
const BASE_SECTOR = { 0: 'Colonial', 49: 'Colonial', 6: 'Cylon', 50: 'Cylon' };

/* Which faction, if any, holds this system's outpost the moment the server boots.
 *
 * A base sector is its owner's, always. Otherwise the control group decides: a system only one
 * faction may hold an outpost in is held by that faction, and a contested system starts empty and
 * has to be taken. That is the galaxy at rest - the map in the real game was not a blank slate
 * with two home systems, it showed who held what.
 *
 * This GENERALISES the two hardcodes it replaces. SectorFactory.setupOutpostStates:120-131 seeded
 * 3000 points for exactly two ids: 27 Cylon and 47 Colonial. 27 Spectris is cylon_controlled, so
 * the rule reproduces it. 47 Vidofnir it does NOT - our sources put Vidofnir in the contested
 * group, and 26 wiki pages plus the live-server dump are better evidence than one unexplained
 * literal. Recorded here rather than silently dropped. */
function outpostOwner(id, grp) {
  if (BASE_SECTOR[id]) return BASE_SECTOR[id];
  const c = CONTROL[grp];
  if (c.colOutpost && !c.cylOutpost) return 'Colonial';
  if (c.cylOutpost && !c.colOutpost) return 'Cylon';
  return null;                                   // contested - capturable, held by nobody at boot
}

/* Which outpost TEMPLATES a sector's file carries. This drives both the emitter and the star
 * flags, so the two can never disagree.
 *   - a base sector carries only its owner's: the base-sector branch spawns nothing else, and the
 *     OutpostState branch that could spawn the enemy's needs a flag a base sector has no reason to
 *     set, so an enemy template there would be unreachable content;
 *   - every other sector carries one per faction the control group permits, exactly as upstream's
 *     contested Tannhauser carries both. */
function outpostFactions(id, grp) {
  if (BASE_SECTOR[id]) return [BASE_SECTOR[id]];
  const c = CONTROL[grp];
  return [c.colOutpost && 'Colonial', c.cylOutpost && 'Cylon'].filter(Boolean);
}

const SECTORS = GALAXY
  .filter(([id]) => STAGES[STAGE].includes(id))
  .map(([id, sectorGuid, x, y, gui, colThreat, cylThreat, grp, sizeM, tier]) => {
    const ctl = CONTROL[grp];
    const factions = outpostFactions(id, grp);
    return {
      id, name: NAMES[id], sectorGuid, regGuid: SHARED_REGULATION,
      pos: { x, y }, gui, colThreat, cylThreat, grp, tier,
      /* sizeM IS the full span, not the half-extent. Doubling it made every system twice the
       * size it should be and the three 40 km Update-51 systems (Carillon, Exomera, 14 Toah)
       * genuinely absurd: generated content scales off the half-extent, so planetoids ended up
       * 40 km out and would not even stream in on arrival.
       * The corroboration is upstream's own layouts: Alpha Ceti and 242 Apollid place their
       * content out to |x| ~ 5,045 (p99), i.e. a full span of ~10,090 against the wiki's
       * 10,000 m - so the wiki number is the whole system, and half-extent is 5,000.
       * Tannhauser is the documented exception at |x| = 7,368; it keeps a hand-set floor below,
       * because its layout is upstream's and must not fall outside its own card. */
      extent: Math.max(sizeM, id === 10 ? 16000 : 0),
      colJump: ctl.colJump, cylJump: ctl.cylJump,
      /* The star flag is what the CLIENT draws the outpost marker and progress widget from
       * (GalaxyMapSector.cs:146-160) and what becomes OutpostState.canOutpost server-side
       * (SectorFactory.java:133-134). It may only be true when the template can honour it, or the
       * marker is a visible lie - so it is derived from the template contents, never set by hand.
       * A base sector reads false: the flag is genuinely unused there, because OutpostSpawnTimer
       * :43-56 never consults OutpostState, and claiming otherwise would draw a capture widget for
       * a system that cannot be captured. */
      colOutpost: !BASE_SECTOR[id] && factions.includes('Colonial'),
      cylOutpost: !BASE_SECTOR[id] && factions.includes('Cylon'),
      outpostFactions: factions,
      outpostOwner: outpostOwner(id, grp),
      isUpstreamTemplate: UPSTREAM_TEMPLATES.has(id),
      isBaseSector: BASE_SECTOR[id] || null,
    };
  });

module.exports = {
  GALAXY, NAMES, STAGES, STAGE, CONTROL, SHARED_REGULATION, SECTORS,
  UPSTREAM_TEMPLATES, BASE_SECTOR, outpostOwner, outpostFactions,
};
