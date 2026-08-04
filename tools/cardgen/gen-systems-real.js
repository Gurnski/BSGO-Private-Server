/*
 * Generate tools/cardgen/systems-real.js and tools/cardgen/systems-dropped.json from the
 * live-server card dump.
 *
 * This is the whole player equipment catalogue as the original shipped it: 219 level-1 ship
 * systems, each with its ten-level upgrade ladder, its ability, and the prices for every rung.
 * We ship 115 systems today with no ladder at all, so a player buys a module once and it is the
 * same module forever.
 *
 * NOTHING HERE IS INVENTED. Every guid, stat, price, durability, GUI key, atlas frame, item class
 * and sorting weight is read out of research/dumps/cards_20260729_223813.json. The level ladders
 * are read too - they are NOT generated from a multiplier table. 122 of the 418 system buff and
 * durability series in the dump are not arithmetic (e.g. focused_ftl steps its durability
 * 4250 -> 4750 -> 5000), and 94 of the 1,355 ability series are not either
 * (system_flare_launcher's cooldown runs 16 15.4 14.8 14.2 13.6 13 12.8 12.4 12.2 10.6). Those are
 * hand-tuned numbers from the original's designers and the only way to have them is to copy them.
 *
 *   node tools/cardgen/gen-systems-real.js        (BSGO_DUMP overrides the dump path)
 *
 * The generator refuses to write anything unless every self-check below passes, because a bad
 * card here is not a bad card - Gson bypasses constructors, so a field we omit is null and a null
 * enum NPEs on card write, which drops the player's socket mid-catalogue with no client-side clue.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DUMP = process.env.BSGO_DUMP ||
  path.resolve(__dirname, '../../research/dumps/cards_20260729_223813.json');
const CORE_ROOT = process.env.BSGOCORE_PATH ? path.resolve(process.env.BSGOCORE_PATH)
  : path.resolve(__dirname, '../../server');
const CORE_SRC = path.join(CORE_ROOT, 'src/main/java/io/github/luigeneric');
const JSON_CARDS = path.join(CORE_ROOT, 'ServerConfigurationUtils/global/JsonCards');
const OUT = path.join(__dirname, 'systems-real.js');
const OUT_DROPS = path.join(__dirname, 'systems-dropped.json');

/* ------------------------------------------------------------------ THE TWO STAGING FLAGS
 *
 * These live HERE, in the generator, and are stamped into the generated module as data. They must
 * never become constants inside systems-real.js: the next person to regenerate would silently
 * revert whichever wave had flipped them, and the failure is invisible - a weapon that cannot fire
 * or an item list that hangs, not a build error.
 *
 * USING_ENABLED - emit each ability's real ConsumableOption instead of forcing NotUsing.
 *   'Using' makes the server refuse to fire unless a matching ShipConsumable is loaded
 *   (AbilityAction.java:147,172), and makes the client's ammo panel appear at all
 *   (ShipAbilityCard.cs:54 Countable). 78 of the 133 abilities want 'Using' and between them
 *   demand 30 distinct (ConsumableType, ConsumableTier) pairs. Flip this only once every one of
 *   those 30 pairs is stocked and buyable - see DEMANDED_CONSUMABLES in the generated module.
 *   Until then ConsumableType/ConsumableTier are carried verbatim but inert: both the server
 *   (AbilityAction.java:147) and the client (Countable) short-circuit on != Using.
 *
 * RESTRICTIONS_ENABLED - emit ourRestrictions instead of []. The client fetches a SHIP card at
 *   every ShipObjectKeyRestrictions entry (ShipSystemCard.cs:100) and IsLoaded.Depend()s on it
 *   (:102), with no timeout anywhere, so an entry with no Ship card behind it is a permanent
 *   loading screen - the `Card should not be send because it's null! 268081382 10` failure this
 *   repo has already shipped once. All 42 of our ship object keys now carry a full card set at
 *   the objKey guid, so the entries dereference.
 */
/* USING_ENABLED went true when the 165-card consumable import landed: all 30 demanded pairs are
 * now covered by a ShipConsumable with a non-empty BuyPrice, cards.js re-derives that set from the
 * emitted abilities on every run and errors on a pair it cannot satisfy (G11), and the one
 * remaining way to reach an unauthored projectile - a DamageNuclear countable whose DamageHigh is
 * neither 4.0 nor 19.0, which the three merit mines are - was closed on the server side by the
 * missileGUID == 0 fallback in FireMissileAction.getMissileGUID. Turning it back off is a
 * one-word edit here plus a regeneration; nothing downstream hardcodes either state. */
const USING_ENABLED = true;
/* RESTRICTIONS_ENABLED went true when hullIdentityCards() landed in cards.js: all 42 of our ship
 * object keys - the 12 that always had guid == objKey plus the 30 hull families that now get an
 * identity card set at their key - carry Ship + World + GUI + Price + ShipLight, so every entry
 * the client dereferences resolves. cards.js G16 re-checks that on every run, per entry, and
 * fails the build rather than shipping a dangling one.
 *
 * THIS IS THE REVERT. Setting it back to false and re-running `node tools/cardgen/gen-systems-real.js`
 * puts every ShipObjectKeyRestrictions list in the catalogue back to [] - the 219 imported systems
 * here, and the six CAMS modules and the C-31 ladder in cards.js, which read the stamped
 * FLAGS.restrictions rather than carrying their own switch. The store then shows every
 * tier-appropriate item to every hull again, which is the W5 state: less faithful, but it cannot
 * hang a loading screen. Nothing else in either file changes. */
const RESTRICTIONS_ENABLED = true;

/* ------------------------------------------------------------------ SCOPE
 *
 * Ten levels, not the dump's fifteen. PlayerProtocol.java:797 rejects any upgrade to a level above
 * 10 as cheating, GuiUpgradeCounter.cs:91 clamps the level selector to the card's MaxLevel and
 * :127-129 refuses anything above it. Levels 11-15 are unreachable content, so we stop the chain
 * at 10 and zero its NextCard rather than dangle a reference at a card we do not emit.
 */
const LEVELS = 10;

/* The dump's own guid stride between consecutive levels of a chain. This is a CHECK, never a
 * source: guids come from walking NextCard. It holds on all 1,971 steps of the 219 kept chains,
 * so a walk that lands somewhere else means the dump changed shape and the run should stop. */
const GUID_STRIDE = 381724169;

/* The six rotation stats plus LifeTime and MaxHullPoints. Any ability that launches a projectile
 * (it carries Speed) and leaves one of these at zero kills the sector, not the shot:
 * MovementSimulation.moveToDirection:60 divides by RollMaxSpeed, the NaN reaches the Euler3
 * constructor and it throws inside SectorMovementUpdater, every frame the projectile lives.
 * cards.js:1860-1876 records shipping exactly this and taking out sector 5 on the first shot. */
const PROJECTILE_STATS = ['YawAcceleration', 'YawMaxSpeed', 'PitchAcceleration', 'PitchMaxSpeed',
  'RollAcceleration', 'RollMaxSpeed', 'LifeTime', 'MaxHullPoints'];

/* ------------------------------------------------------------------ STATION OVERRIDES
 *
 * Three of the five weapons our outposts and sentry platforms fire are dump level-1 weapon/t3
 * cards, so they arrive here with everybody else and this module owns their identity. The three
 * envelope fixes cards.js has carried since 2026-07-31 have to survive that, or a station goes
 * back to shooting at nothing. Carried across verbatim from cards.js:1992-2005:
 *
 *   A (1957961850, long range cruiser cannon) Angle 90 -> 180 and
 *   C (1277437130, perimiter cannon)          Angle 90 -> 360
 *     Per-mount cones are enforced from each hardpoint's own transform (WeaponAction.java:72-83),
 *     so at 90 degrees the batteries on a station's far flank never bear and most of its guns sit
 *     silent - the original field-report symptom. C is a point-defence bubble, which is the one
 *     thing that should never have had a cone at all. The Pegasus wiki arcs (180 cannon / 360 PD)
 *     are the precedent.
 *   B (3756543070, large long range launcher) MaxRange 2000 -> 4000, LifeTime 50 -> 55,
 *     MaxHullPoints 15 -> 200
 *     Station aggro is already 3500/4000 (NpcBehaviourTemplates.java:42-45), so a sniper sitting
 *     at 2.1 km could never be answered. The dump sized the round for 4 km (50 s x 80 m/s) but
 *     ignored the ramp: spawning at rest and accelerating at 15 m/s^2 costs 80^2/(2*15) ~= 213 m,
 *     so a 50 s round dies ~3,787 m out. 55 s covers a full 4,000 m shot with margin.
 *     B's Angle is deliberately NOT changed - it is a launcher, not a battery.
 *     MaxHullPoints is the warhead's own HP now that missiles are shootable. The dump's 15 dates
 *     from a game where nothing could target a missile; the capital long-range launcher family
 *     (item_slot_capital_ability_launcher_long_range, 4020047009) fires the same 4 km ordnance
 *     class at 200, and a 50-second flight is exactly the round that SHOULD be interceptable on
 *     honest terms - 15 made it die to a single flak puff, and inconsistently with every other
 *     heavy round on the board.
 *   D (4001980506) and E (2936089294) are already dump-verbatim and get nothing.
 *
 * Each override is a FLOOR, not an assignment, and that distinction is load-bearing. Angle is
 * constant down A's and C's ladders so a floor and an assignment are the same thing there. B's is
 * not: the dump walks MaxRange 2000 -> 2500 and LifeTime 50 -> 62.5 up the chain, and by level 3
 * the dump's own numbers already beat the floor. Assigning 55 s at every level would SHORTEN the
 * level-10 round from 62.5 s to 55 s - an upgrade that makes the weapon worse. A floor takes the
 * fix at level 1 and then gets out of the way.
 *
 * The self-check asserts all three bind at level 1, so a future dump re-import cannot quietly undo
 * them. If the dump ever ships these values itself the assert turns the override into a no-op and
 * says so, which is the correct outcome.
 */
const STATION_OVERRIDES = {
  1957961850: { Angle: 180 },
  3756543070: { MaxRange: 4000, LifeTime: 55, MaxHullPoints: 200 },
  1277437130: { Angle: 360 },
};

/* The guid-stride checks assert that a family's ten level cards sit at a fixed arithmetic stride,
 * which is true of every ordinary equipment chain and is a good corruption check. Outpost Mode
 * (the carriers' role ability) does not follow it - its ten rungs were authored by hand in the
 * original data - so the chain is walked by its own NextCard pointers instead. Verified gapless:
 * ten rungs, Level 1..10, each pointing at the next. */
const STRIDE_EXEMPT = new Set([395660941]);

/* Currency guids, for the price report only. Tylium and Cubits buy the equipment ladder; Outpost
 * Mode is the one system the original priced differently, in merits to buy and merits plus tuning
 * kits to upgrade - which is what made it the expensive prestige fit players remember. */
const TYLIUM = 215278030, CUBITS = 264733124, MERITS = 130920111, TUNING_KIT = 254909109;
const ALLOWED_CURRENCIES = new Set([TYLIUM, CUBITS, MERITS, TUNING_KIT]);

/* ------------------------------------------------------------------ EXPECTED SHAPE
 *
 * Regression guards, not inputs. Everything below is DERIVED from the dump; these are what the
 * derivation produced when this generator was written and reviewed. A mismatch means either the
 * dump changed or a filter did, and either way it wants a human before it ships - so the run
 * fails rather than quietly emitting a different catalogue. Update these numbers only together
 * with the reason.
 */
/* Moved 219 -> 220 (and every count with it) when Outpost Mode joined: AbilityActionFactory
 * gained its Fortify arm, so the carriers' role ability is no longer a system that would throw
 * inside the sector tick. It brings one role/t4 census row, ten level records, ten ability
 * records and two GUI keys (its own and its ability's, which share a guid). */
const EXPECT = {
  kept: 220, dropped: 14, levelRecords: 2200, withAbility: 134, abilityRecords: 1340,
  abilityGroups: 17, demandedPairs: 30, guiKeys: 354,
  census: {
    'weapon/t1': 15, 'weapon/t2': 18, 'weapon/t3': 19,
    'computer/t1': 28, 'computer/t2': 20, 'computer/t3': 18, 'computer/t4': 9,
    'engine/t1': 15, 'engine/t2': 7, 'engine/t3': 7, 'engine/t4': 4,
    'hull/t1': 20, 'hull/t2': 11, 'hull/t3': 10, 'hull/t4': 5,
    'gun/t1': 3, 'gun/t4': 2,
    'launcher/t1': 2, 'launcher/t4': 2,
    'defensive_weapon/t4': 3,
    'special_weapon/t2': 1,
    'role/t4': 1,
  },
};

/* ================================================================ JAVA ENUMS
 *
 * Read the real enums out of the server source rather than trusting the dump's spelling. Gson
 * bypasses constructors, so a name that is not a Java constant deserialises to null and NPEs when
 * the card is written - which closes the socket in the middle of the catalogue and leaves the
 * player on a loading screen. Parsing beats a hand-written list because the list goes stale.
 */
function javaEnum(relPath) {
  const src = fs.readFileSync(path.resolve(CORE_SRC, relPath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const open = src.indexOf('{', src.search(/\benum\s+\w+/));
  const body = src.slice(open + 1, src.indexOf(';', open));   // the constant list ends at the ';'
  const out = new Set();
  for (const part of body.split(',')) {
    const m = part.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/);
    if (m) out.add(m[1]);
  }
  return out;
}
const E = {
  ObjectStat: javaEnum('templates/utils/ObjectStat.java'),
  StatView: javaEnum('templates/utils/StatView.java'),
  ShipSlotType: javaEnum('templates/utils/ShipSlotType.java'),
  ShipSystemClass: javaEnum('templates/utils/ShipSystemClass.java'),
  AbilityActionType: javaEnum('templates/utils/AbilityActionType.java'),
  ShipAbilityLaunch: javaEnum('templates/utils/ShipAbilityLaunch.java'),
  ShipAbilityAffect: javaEnum('templates/utils/ShipAbilityAffect.java'),
  ShipAbilityTargetTier: javaEnum('templates/utils/ShipAbilityTargetTier.java'),
  ShipConsumableOption: javaEnum('templates/utils/ShipConsumableOption.java'),
  ConsumableEffectType: javaEnum('templates/utils/ConsumableEffectType.java'),
  ShopCategory: javaEnum('templates/utils/ShopCategory.java'),
  ShopItemType: javaEnum('templates/utils/ShopItemType.java'),
  Faction: javaEnum('enums/Faction.java'),
};

/* Which AbilityActionTypes the server can actually build an action for - read out of the factory
 * itself rather than listed here, so it cannot go stale.
 *
 * AbilityActionFactory.create ends in `default -> throw new IllegalArgumentException`. That throw
 * escapes AbilityCastRequestQueue.run into Sector.run's per-tick catch and abandons the rest of
 * that tick FOR EVERY PLAYER IN THE SECTOR; on a Launch: Auto weapon it re-fires every frame. So a
 * system whose ability is not in this set is not a broken item, it is a sector outage, and it is
 * dropped. Reading the cases means adding a case to the factory ships the systems that needed it,
 * and removing one drops them again instead of arming the outage. */
const DISPATCHABLE_SET = (() => {
  const f = path.resolve(CORE_SRC, 'core/sector/management/abilities/AbilityActionFactory.java');
  const src = fs.readFileSync(f, 'utf8');
  const out = new Set();
  for (const m of src.matchAll(/case\s+([A-Za-z0-9_,\s]+?)\s*->/g))
    m[1].split(',').forEach(s => out.add(s.trim()));
  for (const t of out)
    if (!E.AbilityActionType.has(t))
      throw new Error(`AbilityActionFactory case '${t}' is not an AbilityActionType constant - ` +
        'the case parse is wrong, and trusting it would drop the whole catalogue');
  // B1 wired 19 cases. A smaller number means the parse broke or the patch was reverted; either
  // way, silently dropping half the catalogue is the wrong failure.
  if (out.size < 14)
    throw new Error(`only ${out.size} dispatchable AbilityActionTypes parsed out of ` +
      'AbilityActionFactory.java - expected at least 14');
  return out;
})();

/* Every localisation key present in the client bundle. A GUI card whose key is absent renders as
 * the literal `%$bgo.<key>.Name%` on screen, and a missing .description returns null and NREs the
 * two widgets that call .Replace() on it. */
const LOCA = new Set(fs.readFileSync(path.join(__dirname, 'loca-keys.txt'), 'utf8')
  .split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(Boolean));

/* Our roster's ship object keys, read from the emitted catalogue. These are what a restriction
 * entry must dereference: the server compares against activeShip.getShipCard().getShipObjectKey()
 * (ContainerVisitor.java:134-135) and the client fetches a Ship card at the same number. Only Ship
 * cards are read here, and nothing in this module produces a Ship card, so regenerating never
 * feeds on its own output. */
function ourObjectKeys() {
  let files;
  try { files = fs.readdirSync(JSON_CARDS).filter(f => f.endsWith('.json')); }
  catch { files = []; }
  if (!files.length)
    throw new Error(`no emitted catalogue at ${JSON_CARDS} - run \`node tools/cardgen/cards.js\` ` +
      `first; ourRestrictions cannot be translated without the roster's ShipObjectKeys`);
  const keys = new Set();
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(JSON_CARDS, f), 'utf8'));
    for (const c of (Array.isArray(j) ? j : j.cards || []))
      if (c.cardView2 === 'Ship') keys.add(c.ShipObjectKey);
  }
  return keys;
}

/* ================================================================ READ THE DUMP */
const raw = JSON.parse(fs.readFileSync(DUMP, 'utf8'));
const dumpCards = raw.cards || raw;
const view = v => new Map(dumpCards.filter(c => c.viewName === v).map(c => [c.guid, c.fields]));
const D = { sys: view('ShipSystem'), abil: view('ShipAbility'), gui: view('GUI'), price: view('Price') };

const OUR_KEYS = ourObjectKeys();
const problems = [];
const fail = m => problems.push(m);

const statsOf = block => (block && block.stats) || {};
const nonEmpty = o => Object.keys(o).length > 0;
const priceMap = (p) => {
  const out = {};
  for (const i of (p && p.items) || []) out[i.guid] = i.amount;
  return out;
};

/* ---------------------------------------------------------------- 1. candidates and the filter */
const candidates = dumpCards.filter(c => c.viewName === 'ShipSystem' &&
  c.fields.Level === 1 && c.fields.SlotType.name !== 'ship_paint');

const kept = [], drops = [];
for (const c of candidates) {
  const abilRefs = c.fields.AbilityCards || [];
  let reason = null;
  if (abilRefs.length) {
    const a = D.abil.get(abilRefs[0].guid);
    if (!a) reason = `ability card ${abilRefs[0].guid} missing from the dump`;
    else if (!DISPATCHABLE_SET.has(a.ActionType.name))
      reason = `ActionType ${a.ActionType.name} - AbilityActionFactory.create has no case for it ` +
               `and its default throws inside the sector tick`;
    else {
      const st = statsOf(a.ItemBuffAdd);
      if (st.Speed !== undefined) {
        const zero = PROJECTILE_STATS.filter(k => !st[k]);
        if (zero.length)
          reason = `projectile with zero ${zero.join('/')} - divides to NaN in MovementSimulation ` +
                   `and throws inside SectorMovementUpdater every frame the round lives`;
      }
    }
  }
  if (reason) drops.push({ c, reason }); else kept.push(c);
}

/* ---------------------------------------------------------------- 2. walk each chain */
const records = [];
let strideSteps = 0, strideBad = 0, zeroCubitUpgrades = 0;
/* Every (guid, view) pair this module will make cards.js emit. cards.js:4371 errors on a duplicate,
 * so catching it here means the failure names the system instead of the pair. */
const seenPair = new Map();
let duplicatePairs = 0;
const claimPair = (guid, v, who) => {
  const k = guid + '|' + v;
  if (seenPair.has(k)) { duplicatePairs++; fail(`duplicate (guid, view) ${k}: ${who} and ${seenPair.get(k)}`); }
  else seenPair.set(k, who);
};

for (const c of kept) {
  const f1 = c.fields, g1 = D.gui.get(c.guid), p1 = D.price.get(c.guid);
  if (!g1) { fail(`system ${c.guid} has no GUI card in the dump`); continue; }
  if (!p1) { fail(`system ${c.guid} has no Price card in the dump`); continue; }

  const a1ref = (f1.AbilityCards || [])[0];
  const a1 = a1ref ? D.abil.get(a1ref.guid) : null;
  const ag1 = a1ref ? D.gui.get(a1ref.guid) : null;
  if (a1ref && !ag1) fail(`ability ${a1ref.guid} of system ${c.guid} has no GUI card in the dump`);

  const dumpRestrictions = (f1.ShipObjectKeyRestrictions || []).slice().sort((x, y) => x - y);
  const ourRestrictions = dumpRestrictions.filter(k => OUR_KEYS.has(k));
  const ovr = STATION_OVERRIDES[c.guid] || null;

  const levels = [];
  let g = c.guid;
  for (let L = 1; L <= LEVELS; L++) {
    const f = D.sys.get(g), p = D.price.get(g);
    if (!f) { fail(`chain ${c.guid} breaks at level ${L}: no ShipSystem card ${g}`); break; }
    if (f.Level !== L) { fail(`chain ${c.guid} level ${L} card ${g} says Level ${f.Level}`); break; }
    if (!p) { fail(`chain ${c.guid} level ${L} card ${g} has no Price card`); break; }

    claimPair(g, 'ShipSystem', `system ${c.guid} level ${L}`);
    claimPair(g, 'GUI', `system ${c.guid} level ${L}`);
    claimPair(g, 'Price', `system ${c.guid} level ${L}`);

    const rec = { guid: g, dur: f.Durability };
    const st = statsOf(f.StaticBuffs), mu = statsOf(f.MultiplyBuffs);
    if (nonEmpty(st)) rec.st = st;
    if (nonEmpty(mu)) rec.mu = mu;
    rec.buy = priceMap(p.BuyPrice);
    rec.up = priceMap(p.UpgradePrice);
    rec.sell = priceMap(p.SellPrice);

    /* UpgradePrice is copied and never synthesised. An empty one is an UnmodifiablePrice NPE at
     * ShopItemCard.java:125-128 and again on write at :84, so it must be present - but a Cubits
     * entry at amount 0 is what arms the upgradeSystemByPack exploit (packCount / 0f is +Inf,
     * min(1, +Inf) is 1, rollChance(1) always succeeds and the method never charges the price).
     * 136 dump level cards carry Cubits at exactly 0. We keep them as they are and B1's guard
     * refuses the pack path instead; adding a Cubits entry the dump does not have would arm the
     * exploit on cards that are currently safe. */
    if (!Object.keys(rec.up).length) fail(`level card ${g} has an empty UpgradePrice`);
    if (rec.up[CUBITS] === 0) zeroCubitUpgrades++;

    const aref = (f.AbilityCards || [])[0];
    if ((f.AbilityCards || []).length > 1)
      fail(`level card ${g} carries ${f.AbilityCards.length} abilities - this module assumes one`);
    if (!!aref !== !!a1ref)
      fail(`chain ${c.guid} gains or loses its ability at level ${L}`);
    if (aref) {
      const a = D.abil.get(aref.guid);
      if (!a) { fail(`level card ${g} references missing ability ${aref.guid}`); break; }
      claimPair(aref.guid, 'ShipAbility', `ability of system ${c.guid} level ${L}`);
      /* Outpost Mode's ability shares its system's guid, so the (guid, GUI) pair is already
       * claimed by the system rung above and claiming it twice would read as a duplicate. Every
       * other family gives its ability a guid of its own. */
      if (aref.guid !== g)
        claimPair(aref.guid, 'GUI', `ability of system ${c.guid} level ${L}`);

      /* ItemBuffMultiply is empty on all 1,330 ability level cards of the 219, so the consumer
       * writes stats({}) for it. If a re-imported dump ever fills one, this catches it instead of
       * silently dropping the values. The two ToggleSystem blocks ARE carried now - they are how
       * a toggle ability (Outpost Mode) states what it does while engaged. */
      if (nonEmpty(statsOf(a.ItemBuffMultiply)))
        fail(`ability ${aref.guid} has a non-empty ItemBuffMultiply, which systems-real.js does not carry`);

      const add = Object.assign({}, statsOf(a.ItemBuffAdd));
      if (ovr) for (const [k, v] of Object.entries(ovr)) add[k] = Math.max(add[k] || 0, v);
      const ab = { guid: aref.guid, add };
      const radd = statsOf(a.RemoteBuffAdd), rmul = statsOf(a.RemoteBuffMultiply);
      if (nonEmpty(radd)) ab.radd = radd;
      if (nonEmpty(rmul)) ab.rmul = rmul;
      const tadd = statsOf(a.ToggleSystemAdd), tmul = statsOf(a.ToggleSystemMultiply);
      if (nonEmpty(tadd)) ab.tadd = tadd;
      if (nonEmpty(tmul)) ab.tmul = tmul;
      rec.ab = ab;

      if (L > 1 && !STRIDE_EXEMPT.has(c.guid)) {
        strideSteps++;
        const prevAb = levels[L - 2].ab.guid;
        if (((prevAb + GUID_STRIDE) >>> 0) !== aref.guid) {
          strideBad++;
          fail(`ability guid stride broken between levels ${L - 1} and ${L} of chain ${c.guid}`);
        }
      }
    }

    levels.push(rec);

    if (L < LEVELS) {
      const next = f.NextCard && f.NextCard.guid;
      if (!next) { fail(`chain ${c.guid} has no NextCard at level ${L}`); break; }
      if (!STRIDE_EXEMPT.has(c.guid)) {
        strideSteps++;
        if (((g + GUID_STRIDE) >>> 0) !== next) {
          strideBad++;
          fail(`system guid stride broken between levels ${L} and ${L + 1} of chain ${c.guid}`);
        }
      }
      g = next;
    }
  }
  if (levels.length !== LEVELS) { fail(`chain ${c.guid} produced ${levels.length} levels`); continue; }

  const rec = {
    sys: c.guid,
    slot: f1.SlotType.name,
    tier: f1.Tier,
    key: g1.Key,
    frame: g1.FrameIndex,
    cls: f1.Class.name,
    unique: f1.Unique,
    replaceableOnly: f1.ReplaceableOnly,
    trashable: f1.Trashable,
    indestructible: f1.Indestructible,
    maxPerShip: f1.MaxCountPerShip,
    views: f1.Views.map(v => v.name),
    price: {
      category: p1.Category.name,
      itemType: p1.ItemType.name,
      sortingNames: (p1.SortingNames || []).slice(),
      sortingWeight: p1.SortingWeight,
      faction: p1.Faction.name,
      canBeSold: p1.CanBeSold,
    },
    // What cards.js emits verbatim. [] until RESTRICTIONS_ENABLED; see the flag comment.
    restrictions: RESTRICTIONS_ENABLED ? ourRestrictions : [],
    dumpRestrictions,
    ourRestrictions,
    ability: null,
    levels,
  };

  if (a1) {
    rec.ability = {
      key: ag1.Key,
      frame: ag1.FrameIndex,
      actionType: a1.ActionType.name,
      // Cosmetic only: BuffActionType (ShipAbilityCard.cs:56-65) feeds BuffNotification.cs:19 and
      // nothing else, so the one card that sets it (a Buff action whose effect is a debuff on the
      // target) is carried as the dump has it.
      overwriteActionType: a1.OverwriteActionType.name,
      launch: a1.Launch.name,
      affect: a1.Affect.name,
      targetTiers: a1.TargetTiers.map(t => t.name),
      abilityGroupId: a1.AbilityGroupId,
      consumableType: a1.ConsumableType,
      consumableTier: a1.ConsumableTier,
      // What cards.js emits verbatim. NotUsing until USING_ENABLED; see the flag comment.
      consumableOption: USING_ENABLED ? a1.ConsumableOption.name : 'NotUsing',
      dumpConsumableOption: a1.ConsumableOption.name,
      guiBuffAtlas: a1.GUIBuffAtlas,
      guiBuffIndex: a1.GUIBuffIndex,
      onByDefault: a1.OnByDefault,
      effectTypeBlacklist: (a1.effectTypeBlacklist || []).map(e => e.name),
    };
    if ((a1.AffectedAbilityTypes || []).length)
      fail(`ability ${a1ref.guid} has a non-empty AffectedAbilityTypes, which this module drops`);
  }
  records.push(rec);
}

/* ---------------------------------------------------------------- 3. derived sets */
records.sort((a, b) => a.slot.localeCompare(b.slot) || a.tier - b.tier ||
  a.price.sortingWeight - b.price.sortingWeight || a.sys - b.sys);

const census = {};
for (const r of records) {
  const k = r.slot + '/t' + r.tier;
  census[k] = (census[k] || 0) + 1;
}

/* The (ConsumableType, ConsumableTier) pairs the kept systems demand, for the consumables package
 * to satisfy. Derived, never counted by hand: a pair with nothing stocked behind it makes its
 * weapon silently unable to fire the moment USING_ENABLED flips, with no error anywhere. Note this
 * reads the DUMP's option, not the emitted one - the demand exists whether or not we have wired
 * it up yet. */
const demanded = new Map();
for (const r of records) {
  const a = r.ability;
  if (!a || a.dumpConsumableOption !== 'Using') continue;
  const k = a.consumableType + '/' + a.consumableTier;
  if (!demanded.has(k)) demanded.set(k, { consumableType: a.consumableType, consumableTier: a.consumableTier, systems: [] });
  demanded.get(k).systems.push(r.sys);
}
const DEMANDED = [...demanded.values()]
  .sort((a, b) => a.consumableType - b.consumableType || a.consumableTier - b.consumableTier);

const groups = new Set(records.filter(r => r.ability).map(r => r.ability.abilityGroupId));

/* ---------------------------------------------------------------- 4. self-check */
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok, detail }); if (!ok) fail(`${name}: ${detail}`); };

check('systems kept', records.length === EXPECT.kept, `${records.length}, expected ${EXPECT.kept}`);
check('systems dropped', drops.length === EXPECT.dropped, `${drops.length}, expected ${EXPECT.dropped}`);

const censusDiff = [];
for (const k of new Set([...Object.keys(census), ...Object.keys(EXPECT.census)]))
  if ((census[k] || 0) !== (EXPECT.census[k] || 0))
    censusDiff.push(`${k} ${census[k] || 0} != ${EXPECT.census[k] || 0}`);
check('slot/tier census', censusDiff.length === 0, censusDiff.join(', ') || 'all 21 cells match');

const levelRecords = records.reduce((n, r) => n + r.levels.length, 0);
check('level records', levelRecords === EXPECT.levelRecords, `${levelRecords}, expected ${EXPECT.levelRecords}`);
check('every chain is a gapless 1-10 run', records.every(r => r.levels.length === LEVELS),
  `${records.filter(r => r.levels.length !== LEVELS).length} chains are not ${LEVELS} long`);
check('guid stride holds on every step', strideBad === 0 && strideSteps > 0,
  `${strideSteps} steps checked (system + ability), ${strideBad} broken`);

const withAbility = records.filter(r => r.ability).length;
const abilityRecords = records.reduce((n, r) => n + r.levels.filter(l => l.ab).length, 0);
check('systems with an ability', withAbility === EXPECT.withAbility, `${withAbility}, expected ${EXPECT.withAbility}`);
check('ability records', abilityRecords === EXPECT.abilityRecords, `${abilityRecords}, expected ${EXPECT.abilityRecords}`);

/* Every ability a level card points at must arrive with BOTH of its views. ShipAbilityCard.cs:67-72
 * does IsLoaded.Depend(GUICard) at its own guid, and the client has no timeout on card loads, so an
 * ability whose GUI card never comes is an infinite loading screen rather than a missing tooltip. */
const dangling = [];
const emittedAbilities = new Set();
for (const r of records) for (const l of r.levels) {
  if (!l.ab) continue;
  emittedAbilities.add(l.ab.guid);
  for (const v of ['ShipAbility', 'GUI'])
    if (!seenPair.has(l.ab.guid + '|' + v)) dangling.push(`${l.ab.guid} has no ${v} card`);
}
check('every referenced ability arrives with its ShipAbility and GUI cards', dangling.length === 0,
  dangling.length ? dangling.slice(0, 5).join(', ') : `${emittedAbilities.size} ability guids, both views each`);

check('no duplicate (guid, view)', duplicatePairs === 0,
  duplicatePairs ? `${duplicatePairs} duplicates` : `${seenPair.size} distinct pairs across ShipSystem/GUI/Price/ShipAbility`);

// stat keys
const badStats = new Set();
const eachStatBlock = fn => {
  for (const r of records) for (const l of r.levels) {
    if (l.st) fn(l.st); if (l.mu) fn(l.mu);
    if (l.ab) {
      fn(l.ab.add);
      if (l.ab.radd) fn(l.ab.radd); if (l.ab.rmul) fn(l.ab.rmul);
      if (l.ab.tadd) fn(l.ab.tadd); if (l.ab.tmul) fn(l.ab.tmul);
    }
  }
};
const statKeys = new Set();
eachStatBlock(b => Object.keys(b).forEach(k => { statKeys.add(k); if (!E.ObjectStat.has(k)) badStats.add(k); }));
check('every stat key is a real ObjectStat', badStats.size === 0,
  badStats.size ? [...badStats].join(', ') : `${statKeys.size} distinct keys, all present in ObjectStat.java`);

// enum names
const badEnum = [];
const wantEnum = (setName, value, where) => {
  if (!E[setName].has(value)) badEnum.push(`${where}: ${value} is not a ${setName} constant`);
  if (value === 'Unknown') badEnum.push(`${where}: Unknown is a real constant but never a real value`);
};
for (const r of records) {
  wantEnum('ShipSlotType', r.slot, `system ${r.sys} SlotType`);
  wantEnum('ShipSystemClass', r.cls, `system ${r.sys} Class`);
  r.views.forEach(v => wantEnum('StatView', v, `system ${r.sys} Views`));
  wantEnum('ShopCategory', r.price.category, `system ${r.sys} Price.Category`);
  wantEnum('ShopItemType', r.price.itemType, `system ${r.sys} Price.ItemType`);
  wantEnum('Faction', r.price.faction, `system ${r.sys} Price.Faction`);
  const a = r.ability;
  if (!a) continue;
  wantEnum('AbilityActionType', a.actionType, `ability of ${r.sys} ActionType`);
  wantEnum('AbilityActionType', a.overwriteActionType, `ability of ${r.sys} OverwriteActionType`);
  wantEnum('ShipAbilityLaunch', a.launch, `ability of ${r.sys} Launch`);
  wantEnum('ShipAbilityAffect', a.affect, `ability of ${r.sys} Affect`);
  a.targetTiers.forEach(t => wantEnum('ShipAbilityTargetTier', t, `ability of ${r.sys} TargetTiers`));
  wantEnum('ShipConsumableOption', a.consumableOption, `ability of ${r.sys} ConsumableOption`);
  a.effectTypeBlacklist.forEach(t => wantEnum('ConsumableEffectType', t, `ability of ${r.sys} effectTypeBlacklist`));
  if (!DISPATCHABLE_SET.has(a.actionType))
    badEnum.push(`ability of ${r.sys}: ActionType ${a.actionType} is not dispatchable`);
}
check('every enum name resolves in the Java enums', badEnum.length === 0,
  badEnum.length ? badEnum.slice(0, 5).join('; ') : `${records.length} systems + ${withAbility} abilities checked`);

// loca keys
const badKeys = [], allKeys = [];
for (const r of records) {
  allKeys.push(r.key);
  if (r.ability) allKeys.push(r.ability.key);
}
for (const k of allKeys) {
  const base = 'bgo.' + k.toLowerCase();
  if (!LOCA.has(base + '.name')) badKeys.push(k + ' (.name)');
  if (!LOCA.has(base + '.description')) badKeys.push(k + ' (.description)');
}
check('every GUI key resolves with .name and .description', badKeys.length === 0,
  badKeys.length ? badKeys.slice(0, 5).join(', ') : `${allKeys.length} keys, all present in loca-keys.txt`);
check('GUI key count', allKeys.length === EXPECT.guiKeys, `${allKeys.length}, expected ${EXPECT.guiKeys}`);

check('distinct AbilityGroupIds', groups.size === EXPECT.abilityGroups,
  `${groups.size}, expected ${EXPECT.abilityGroups}`);
check('demanded (ConsumableType, ConsumableTier) pairs', DEMANDED.length === EXPECT.demandedPairs,
  `${DEMANDED.length}, expected ${EXPECT.demandedPairs}`);

// staging flags
const optBad = records.filter(r => r.ability && r.ability.consumableOption !== 'NotUsing').length;
const resBad = records.filter(r => r.restrictions.length).length;
if (!USING_ENABLED)
  check('USING_ENABLED false: every emitted ConsumableOption is NotUsing', optBad === 0, `${optBad} are not`);
if (!RESTRICTIONS_ENABLED)
  check('RESTRICTIONS_ENABLED false: every emitted restriction list is empty', resBad === 0, `${resBad} are not`);

// station overrides
const ovrDetail = [];
let ovrOK = true;
for (const [guidStr, ovr] of Object.entries(STATION_OVERRIDES)) {
  const guid = Number(guidStr);
  const r = records.find(x => x.sys === guid);
  if (!r || !r.ability) { ovrOK = false; ovrDetail.push(`${guid} is not an emitted system with an ability`); continue; }
  for (const [stat, v] of Object.entries(ovr)) {
    const got = r.levels[0].ab.add[stat];
    if (got !== v) { ovrOK = false; ovrDetail.push(`${guid} L1 ${stat}=${got}, expected ${v}`); }
    else ovrDetail.push(`${guid} L1 ${stat}=${v}`);
    const floored = r.levels.every(l => (l.ab.add[stat] || 0) >= v);
    if (!floored) { ovrOK = false; ovrDetail.push(`${guid} ${stat} drops below ${v} up the ladder`); }
  }
}
check('station overrides bind at level 1 and hold as a floor', ovrOK, ovrDetail.join(', '));

// prices
const badCurrency = new Set();
for (const r of records) for (const l of r.levels)
  for (const m of [l.buy, l.up, l.sell]) for (const g of Object.keys(m))
    if (!ALLOWED_CURRENCIES.has(Number(g))) badCurrency.add(g);
check('prices use only tylium and cubits', badCurrency.size === 0,
  badCurrency.size ? [...badCurrency].join(', ') : `${levelRecords} level price sets`);

/* ---------------------------------------------------------------- 5. write */
if (problems.length) {
  console.error('SELF-CHECK FAILED - nothing written.\n');
  for (const p of problems.slice(0, 40)) console.error('  ' + p);
  if (problems.length > 40) console.error(`  ... and ${problems.length - 40} more`);
  process.exit(1);
}

const J = o => JSON.stringify(o);
const lvlLine = (l) => {
  const bits = [`guid: ${l.guid}`, `dur: ${l.dur}`];
  if (l.st) bits.push(`st: ${J(l.st)}`);
  if (l.mu) bits.push(`mu: ${J(l.mu)}`);
  bits.push(`buy: ${J(l.buy)}`, `up: ${J(l.up)}`, `sell: ${J(l.sell)}`);
  if (l.ab) {
    const ab = [`guid: ${l.ab.guid}`, `add: ${J(l.ab.add)}`];
    if (l.ab.radd) ab.push(`radd: ${J(l.ab.radd)}`);
    if (l.ab.rmul) ab.push(`rmul: ${J(l.ab.rmul)}`);
    if (l.ab.tadd) ab.push(`tadd: ${J(l.ab.tadd)}`);
    if (l.ab.tmul) ab.push(`tmul: ${J(l.ab.tmul)}`);
    bits.push(`ab: { ${ab.join(', ')} }`);
  }
  return `      { ${bits.join(', ')} },`;
};
const recBlock = (r) => {
  const head = [
    `    sys: ${r.sys}, slot: '${r.slot}', tier: ${r.tier}, key: '${r.key}', frame: ${r.frame},`,
    `    cls: '${r.cls}', unique: ${r.unique}, replaceableOnly: ${r.replaceableOnly}, ` +
      `trashable: ${r.trashable}, indestructible: ${r.indestructible}, maxPerShip: ${r.maxPerShip},`,
    `    views: ${J(r.views)},`,
    `    price: ${J(r.price)},`,
    `    restrictions: ${J(r.restrictions)}, dumpRestrictions: ${J(r.dumpRestrictions)}, ` +
      `ourRestrictions: ${J(r.ourRestrictions)},`,
    `    ability: ${r.ability ? J(r.ability) : 'null'},`,
    `    levels: [`,
    ...r.levels.map(lvlLine),
    `    ] },`,
  ];
  return '  {\n' + head.join('\n');
};

const censusLine = Object.keys(census).sort().map(k => k + '=' + census[k]).join(', ');
const body = records.map(recBlock).join('\n');

fs.writeFileSync(OUT,
`/* ============================================ REAL SHIP SYSTEMS, FROM A LIVE SERVER
 *
 * GENERATED FILE - do not hand-edit. Regenerate with tools/cardgen/gen-systems-real.js.
 *
 * The original's whole equipment catalogue: ${records.length} level-1 ship systems, each with the ten-level
 * upgrade ladder the original shipped, against the 115 unupgradeable items we author by hand.
 * ${levelRecords} level records, ${abilityRecords} ability records, ${withAbility} of the ${records.length} systems carry an ability.
 *
 * Everything here is READ from research/dumps/cards_20260729_223813.json - guids, stats, prices,
 * durability, GUI keys, atlas frames, item class, sorting. The ladders are read too, not scaled:
 * a large minority of the dump's level series are hand-tuned and not reproducible by any
 * multiplier. The generator refuses to write unless every value round-trips its own self-check.
 *
 * Per slot and tier: ${censusLine}
 *
 * ${drops.length} candidates were dropped - see systems-dropped.json for the guid, key and reason of each.
 *
 * SHAPE. Each record:
 *   sys/slot/tier/key/frame   the level-1 card guid, its slot, its tier, its GUI key and atlas frame
 *   cls .. maxPerShip         ShipSystem card fields, constant down the whole ladder
 *   views[]                   StatView names the client shows in the item tooltip
 *   price{}                   Price card fields that do not change with level
 *   restrictions[]            what to emit as ShipObjectKeyRestrictions - see FLAGS below
 *   dumpRestrictions[]        the dump's own list, for reference
 *   ourRestrictions[]         dumpRestrictions filtered to ship object keys our roster carries
 *   ability{} | null          ShipAbility card fields that do not change with level. The system's
 *                             shipAbilityCards is [levels[i].ab.guid] - the level's ability, not
 *                             the level-1 one.
 *   levels[]                  ten entries, levels 1..10 in order. levels[i] is level i+1, and
 *                             nextShipSystemCardGuid is levels[i+1].guid, or 0 at level 10.
 * Each level entry:
 *   guid, dur                 that level's card guid and Durability
 *   st{}, mu{}                StaticBuffs / MultiplyBuffs - ABSENT MEANS EMPTY
 *   buy/up/sell               {currencyGuid: amount}. up is never empty and is never synthesised.
 *   ab{}                      that level's ability: guid, add (ItemBuffAdd), and radd / rmul
 *                             (RemoteBuffAdd / RemoteBuffMultiply) when non-empty.
 * ItemBuffMultiply, ToggleSystemAdd and ToggleSystemMultiply are empty on all ${abilityRecords} ability
 * records, so they are not carried; write stats({}) for them. SkillHashes are not carried either:
 * the dump's are SkillCard.Hash values on a hashing scheme our Skill cards do not share, so
 * porting them would dangle 222 references. Emit [].
 *
 * FLAGS is the staging state this file was generated under. Both switches live in
 * gen-systems-real.js, NOT here, so that regenerating cannot silently revert them; cards.js
 * asserts the emitted cards match what FLAGS says.
 *   using        false -> every ability emits ConsumableOption NotUsing regardless of the dump's
 *                value (kept in ability.dumpConsumableOption). ${DEMANDED.length} (ConsumableType,
 *                ConsumableTier) pairs must be stocked and buyable before this can flip - they are
 *                listed in DEMANDED_CONSUMABLES.
 *   restrictions false -> every record emits restrictions: []. The client fetches a Ship card at
 *                every entry and waits forever if one never arrives, so this cannot flip until
 *                every ship object key in ourRestrictions has a card set behind it.
 */
'use strict';

const FLAGS = { using: ${USING_ENABLED}, restrictions: ${RESTRICTIONS_ENABLED} };

/* The ladder settings every emitted level card carries, here rather than retyped by the consumer.
 * maxLevel is ${LEVELS} on EVERY level, not the dump's 15: PlayerProtocol.java:797 refuses an upgrade past
 * 10 and GuiUpgradeCounter.cs:127-129 refuses anything over MaxLevel, so 15 would advertise five
 * rungs a player can never climb. userUpgradeable true is what makes the upgrade button appear at
 * all (PlayerProtocol.java:782,842). */
const LADDER = { levels: ${LEVELS}, maxLevel: ${LEVELS}, userUpgradeable: true };

/* The (ConsumableType, ConsumableTier) pairs the ${records.length} systems demand, derived from the dump's own
 * ConsumableOption: Using abilities. \`systems\` lists the level-1 system guids that want the pair.
 * A pair with no buyable consumable behind it makes every one of those weapons silently refuse to
 * fire the moment FLAGS.using flips - the server returns early in AbilityAction.java:172 and the
 * client's ammo panel has nothing to show. Never hardcode this list; read it. */
const DEMANDED_CONSUMABLES = [
${DEMANDED.map(d => `  { consumableType: ${d.consumableType}, consumableTier: ${d.consumableTier}, systems: ${J(d.systems)} },`).join('\n')}
];

const SYSTEMS_REAL = [
${body}
];

module.exports = { SYSTEMS_REAL, DEMANDED_CONSUMABLES, FLAGS, LADDER };
`);

const dropRows = drops.map(({ c, reason }) => ({
  guid: c.guid,
  key: (D.gui.get(c.guid) || {}).Key || null,
  slot: c.fields.SlotType.name,
  tier: c.fields.Tier,
  reason,
})).sort((a, b) => a.slot.localeCompare(b.slot) || a.tier - b.tier || a.guid - b.guid);

fs.writeFileSync(OUT_DROPS, JSON.stringify({
  _comment: [
    'GENERATED FILE - do not hand-edit. Regenerate with tools/cardgen/gen-systems-real.js.',
    'Dump level-1 ship systems the equipment pass deliberately does not ship, and why. This is',
    'player-visible content: four complete tiered families (mine launchers, Active DRADIS, Jump',
    'Transponders, Flak Blockers) plus Auto Pilot, Spawn Mode, the EMP Mine and the Rocket Pack.',
    'A returning player will look for these by name, so cards.js prints this list every run.',
    'Every entry is here because emitting it would take down a sector, not because we ran out of',
    'time - see the reason field. Any change to this file is a reviewed diff.',
  ],
  generatedFrom: path.basename(DUMP),
  dropped: dropRows,
}, null, 2) + '\n');

/* ---------------------------------------------------------------- 6. report */
const rel = p => path.relative(process.cwd(), p);
console.log(`${records.length} systems, ${levelRecords} level records -> ${rel(OUT)}`);
console.log(`${drops.length} dropped -> ${rel(OUT_DROPS)}`);
console.log('');
console.log('  slot/tier census');
for (const k of Object.keys(census).sort()) console.log('    ' + k.padEnd(22) + census[k]);
console.log('');
console.log('  dropped');
for (const d of dropRows) console.log(`    ${String(d.guid).padStart(10)} ${(d.slot + '/t' + d.tier).padEnd(20)} ${d.key}\n      ${d.reason}`);
console.log('');
console.log('  demanded consumables (ConsumableType/Tier -> systems)');
console.log('    ' + DEMANDED.map(d => `${d.consumableType}/${d.consumableTier} (${d.systems.length})`).join('  '));
console.log('');
console.log('  self-check');
for (const c of checks) console.log(`    ${c.ok ? 'PASS' : 'FAIL'}  ${c.name} - ${c.detail}`);
console.log('');
console.log(`  ${zeroCubitUpgrades} of ${levelRecords} level cards carry an UpgradePrice with Cubits at 0 - copied from the`);
console.log('  dump, never synthesised. B1\'s upgradeSystemByPack guard is what makes them safe.');

/* The original priced upgrades in cubits and let the sell value climb to match, so a level-10
 * card's SellPrice is far above its BuyPrice on every chain. That is a cubits sink in the live
 * shop, which only stocks level 1 - but ShopProtocol.setupShop ALSO stocks level 10 when
 * testingMode() is on, and `%dev` turns it on. On the chains below the level-10 BuyPrice is pure
 * tylium, so in a dev profile the pair is a tylium printer. Nothing to fix here (the numbers are
 * the dump's); W5 runs its live store check against the prod profile for this reason. */
let printers = 0, biggest = null;
for (const r of records) {
  const l = r.levels[LEVELS - 1];
  const gain = (l.sell[TYLIUM] || 0) - (l.buy[TYLIUM] || 0);
  if ((l.buy[CUBITS] || 0) !== 0 || gain <= 0) continue;
  printers++;
  if (!biggest || gain > biggest.gain) biggest = { key: r.key, gain };
}
console.log(`  ${printers} of ${records.length} level-10 cards have a tylium-only BuyPrice below their SellPrice ` +
  `(worst ${biggest ? biggest.key + ' +' + biggest.gain.toLocaleString('en-US') : 'none'}).`);
console.log('  Harmless in prod - the shop stocks level 1 only - but testingMode() also stocks level 10.');
console.log(`  AbilityActionFactory dispatches ${DISPATCHABLE_SET.size} ActionTypes; the ${new Set(records.filter(r => r.ability).map(r => r.ability.actionType)).size} this module emits are all in it.`);
