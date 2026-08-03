'use strict';
/*
 * Generate tools/cardgen/consumables-real.js from the live-server card dump.
 *
 * We ship 42 ShipConsumable cards against the original's 166, and 40 of the 42 carry
 * ConsumableType 0 / Tier 0 / effectType None because nobody had the real values. The original
 * had a whole economy here: 99 kinds of ammunition, repair and power cells, flares, anti-radiation
 * packs, armour plate, and an 18-item booster tab. Seventeen of the systems this pass emits fire
 * or consume one of those families and go silently inert without them - AbilityAction.preFun
 * returns false, process() returns, and nothing is logged on either side.
 *
 * Everything here is read from the dump: guids, loca keys, atlases and frames, consumable type,
 * tier, buffs, effect type, buy/sell prices and buy counts. Four values are deliberately NOT the
 * dump's, each marked in the record and explained at the point of departure below.
 *
 *   node tools/cardgen/gen-consumables-real.js        (BSGO_DUMP overrides the dump path)
 *
 * This writes tools/cardgen/consumables-real.js and, when --write-templates is passed, the
 * AugmentFactorTemplate JSON files the booster tab needs to do anything when activated.
 */
const fs = require('fs');
const path = require('path');

const DUMP = process.env.BSGO_DUMP ||
  path.resolve(__dirname, '../../research/dumps/cards_20260729_223813.json');
const OUT = path.join(__dirname, 'consumables-real.js');
const CORE_ROOT = process.env.BSGOCORE_PATH ? path.resolve(process.env.BSGOCORE_PATH)
                                            : path.resolve(__dirname, '../../server');
const CORE_SRC = path.join(CORE_ROOT, 'src/main/java/io/github/luigeneric');
/* Two destinations, on purpose. BSGOCore keeps ServerConfigurationUtils/ out of git
 * (server/.gitignore:91), so the live tree is where the server reads from but not where the files
 * survive a fresh unpack - config/ is the tracked overlay for exactly that reason. Write both, or
 * the booster tab works on this machine and nowhere else. */
const TEMPLATE_DIRS = [
  path.join(CORE_ROOT, 'ServerConfigurationUtils/global/AugmentTemplates'),
  path.resolve(__dirname, '../../config/AugmentTemplates'),
];
const LOCA = path.join(__dirname, 'loca-keys.txt');
const SYSTEMS_REAL = path.join(__dirname, 'systems-real.js');

const CUBITS = 264733124;

const fail = [];
const warn = [];
const die = m => { console.error('gen-consumables-real: ' + m); process.exit(1); };

// ---------------------------------------------------------------- the server's own enums
/* Gson maps an unknown enum NAME to null and never complains. The card then writes
 * augmentActionType.value / effectType.getValue() / shopItemType.value and NPEs, and the server
 * answers an NPE during a card write by closing the player's socket. Read the constants out of
 * the Java rather than trusting a name that looked right in the dump - `Consumable` is a real
 * ShopCategory and NOT a real ShopItemType, and that exact confusion is live in our tree today. */
function enumNames(relPath) {
  const src = fs.readFileSync(path.resolve(CORE_SRC, relPath), 'utf8');
  const names = new Set();
  for (const m of src.slice(src.indexOf('{') + 1).matchAll(/^\s*(?:@\w+\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*[(,;]/gm))
    names.add(m[1]);
  if (!names.size) die(`could not parse any constants out of ${relPath}`);
  return names;
}
const E = {
  category:  enumNames('templates/utils/ShopCategory.java'),
  itemType:  enumNames('templates/utils/ShopItemType.java'),
  effect:    enumNames('templates/utils/ConsumableEffectType.java'),
  action:    enumNames('templates/utils/AugmentActionType.java'),
  faction:   enumNames('enums/Faction.java'),
  stat:      enumNames('templates/utils/ObjectStat.java'),
  factor:    enumNames('enums/FactorType.java'),
  source:    enumNames('enums/FactorSource.java'),
  missileType:   enumNames('templates/utils/MissileType.java'),
  explosionView: enumNames('templates/utils/MissileExplosionView.java'),
};

/* Every ResourceType guid is pinned by the Java enum and loadResources() in cards.js throws if one
 * has no RESOURCE_META entry. Those guids keep their identity in cards.js; this module only
 * supplies the consumable fields for them, never a replacement icon or price. */
const RESOURCE_GUIDS = new Set(
  [...fs.readFileSync(path.resolve(CORE_SRC, 'enums/ResourceType.java'), 'utf8')
      .matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*(\d+)L?\s*\)/gm)]
    .filter(m => m[1] !== 'None').map(m => Number(m[2])));

// Guids cards.js already emits from its LOOT_EXTRAS table (loot drops with no ResourceType entry).
const LOOT_EXTRA_GUIDS = new Set([3, 2836381, 103992173, 201509789, 25398605, 136433549, 232850813]);

const LOCA_KEYS = new Set(fs.readFileSync(LOCA, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean));
const hasLoca = k => LOCA_KEYS.has(`bgo.${k}.name`) && LOCA_KEYS.has(`bgo.${k}.description`);

// ---------------------------------------------------------------- dump
const raw = JSON.parse(fs.readFileSync(DUMP, 'utf8'));
const cards = raw.cards || raw;
const byGuid = view => new Map(cards.filter(c => c.viewName === view).map(c => [c.guid, c.fields]));
const gui = byGuid('GUI'), price = byGuid('Price'), abil = byGuid('ShipAbility');

/* The dump serialises a Price as [{guid, amount}]; Java declares Map<Long,Float> items and
 * cards.js's price() helper builds {guid: amount}. Handing the array through unchanged gives Gson
 * a Map it cannot fill, so the card ships with an empty price and the item is silently free or
 * silently unsellable depending on which side you look from. */
const priceMap = p => Object.fromEntries(((p && p.items) || []).map(i => [i.guid, i.amount]));

// ---------------------------------------------------------------- demanded (ConsumableType, Tier) pairs
/* G11's demand set. NEVER hardcode this: an ability with ConsumableOption 'Using' whose ammo has
 * no buyable card cannot fire and says nothing about why. Prefer systems-real.js once B3 has
 * landed - that is the emitted roster - and fall back to re-deriving the same 219-system filter
 * from the dump so this generator stands alone.
 *
 * The BLUEPRINT filter (§1.1): Level 1, SlotType != ship_paint, ability ActionType inside
 * AbilityActionFactory's dispatch set, and no missile whose six rotation stats are all zero. */
const DISPATCHABLE = new Set([
  // AbilityActionFactory.create's 14 cases as it stands today...
  'Slide', 'Buff', 'Debuff', 'ActivatePaintTheTarget', 'DropFlare', 'DeflectMissile', 'ResourceScan',
  'RestoreBuff', 'FireMissle', 'FireTorpedo', 'FireCannon', 'FireMining', 'Flak', 'PointDefence',
  // ...plus the five B1 adds. Anything outside this set throws IllegalArgumentException out of
  // AbilityCastRequestQueue.run and abandons the rest of that sector tick for everyone in it.
  'FireHeavyMissile', 'FireMachineGun', 'FireShotgun', 'FireKillCannon', 'FireLightMissile',
]);
const ROTATION = ['PitchAcceleration', 'PitchMaxSpeed', 'YawAcceleration',
                  'YawMaxSpeed', 'RollAcceleration', 'RollMaxSpeed'];

/* B3's module. Read its DEMANDED_CONSUMABLES export if it has one; otherwise fall back to the
 * ability rows. The live consumableOption is 'NotUsing' until W4b flips USING_ENABLED, so the
 * demand has to come from dumpConsumableOption - keying off the live value would report zero pairs
 * and make the whole coverage assertion vacuous at exactly the moment it is supposed to bite. */
function demandFromSystemsReal() {
  if (!fs.existsSync(SYSTEMS_REAL)) return null;
  const mod = require(SYSTEMS_REAL);
  const pairs = new Map();
  if (Array.isArray(mod.DEMANDED_CONSUMABLES)) {
    for (const d of mod.DEMANDED_CONSUMABLES)
      pairs.set(`${d.consumableType}/${d.consumableTier}`, (d.systems || []).map(String));
  } else {
    const rows = mod.SYSTEMS_REAL || mod.systems;
    if (!Array.isArray(rows)) return null;
    for (const s of rows) {
      const a = s.ability;
      if (!a) continue;
      if ((a.dumpConsumableOption || a.consumableOption) !== 'Using') continue;
      const k = `${a.consumableType}/${a.consumableTier}`;
      if (!pairs.has(k)) pairs.set(k, []);
      pairs.get(k).push(s.key || String(s.sys));
    }
  }
  if (!pairs.size) return null;
  return { pairs, source: 'systems-real.js', systems: (mod.SYSTEMS_REAL || []).length };
}

function demandFromDump() {
  const pairs = new Map();
  let kept = 0, dropped = 0;
  for (const c of cards) {
    if (c.viewName !== 'ShipSystem') continue;
    const f = c.fields;
    if (f.Level !== 1) continue;
    const slot = f.SlotType && f.SlotType.name;
    if (!slot || slot === 'ship_paint') continue;
    const ref = (f.AbilityCards || [])[0];
    const a = ref ? (abil.get(ref.guid) || ref.fields) : null;
    if (a) {
      if (!DISPATCHABLE.has(a.ActionType && a.ActionType.name)) { dropped++; continue; }
      const st = (a.ItemBuffAdd && a.ItemBuffAdd.stats) || {};
      if (st.Speed !== undefined && ROTATION.every(k => !st[k])) { dropped++; continue; }
    }
    kept++;
    if (!a || !a.ConsumableOption || a.ConsumableOption.name !== 'Using') continue;
    const k = `${a.ConsumableType}/${a.ConsumableTier}`;
    if (!pairs.has(k)) pairs.set(k, []);
    pairs.get(k).push((gui.get(c.guid) || {}).Key || String(c.guid));
  }
  if (kept !== 219 || dropped !== 15)
    warn.push(`re-derived roster is ${kept} kept / ${dropped} dropped, not the blueprint's 219/15 - ` +
              `the §1.1 filter has drifted, check before trusting the demand set`);
  return { pairs, source: 'dump (systems-real.js not present yet)', systems: kept };
}

/* Take the UNION of the two, never one or the other. Under-counting demand is the failure this
 * package exists to prevent, and the two derivations can only disagree if B3's roster and the §1.1
 * filter have drifted apart - which is worth a loud warning, not a silent narrowing. */
const DEMAND = (() => {
  const fromDump = demandFromDump();
  const fromModule = demandFromSystemsReal();
  if (!fromModule) return fromDump;
  for (const [k, v] of fromDump.pairs) {
    if (!fromModule.pairs.has(k)) {
      warn.push(`pair ${k} is demanded by the dump roster but absent from systems-real.js - keeping it`);
      fromModule.pairs.set(k, v);
    }
  }
  for (const k of fromModule.pairs.keys())
    if (!fromDump.pairs.has(k)) warn.push(`pair ${k} is demanded by systems-real.js but not by the dump roster`);
  return { ...fromModule, source: `systems-real.js union dump (${fromDump.pairs.size} from the dump)` };
})();

// ---------------------------------------------------------------- departures from the dump
/* 1097622313 consumable_mega_rounds: buyCount 0, empty BuyPrice, empty SellPrice, SortingWeight 0
 * and no loot template anywhere in the tree grants it. A dev item. It is also the only dump
 * consumable with CanBeSold true and an empty SellPrice, which cards.js already rejects (selling
 * would destroy the stack for nothing). Recorded in DROPPED so the omission is data, not silence. */
const DEV_ITEMS = new Map([[1097622313, 'dev item: no buy price, no sell price, buyCount 0, granted by nothing']]);

/* 92666191 Divine Inspiration is priced at ZERO cubits in the dump. A BuyPrice of {cubits: 0} is
 * not empty, so setupShop stocks it, and isEnoughInContainer returns true for a price of 0 - free
 * x2 XP/Loot/Mining/Merits, forever, for everyone. cards.js already prices it at 4,000 and explains
 * why; keep that and record what the dump said so a future re-import cannot quietly undo it. */
const PRICE_OVERRIDE = new Map([[92666191, { [CUBITS]: 4000 }]]);

/* Augments the server cannot honour. PlayerProtocol's UseAugment requires an AugmentFactorTemplate
 * specifically - it logs "No factor template" and returns for anything else - so an augment we
 * cannot back with factors must not be stocked, or a player pays cubits for a button that does
 * nothing. Empty BuyPrice keeps the card (loot and holds still resolve it) and keeps it out of the
 * shop. The cards stay; only the price goes. */
const NO_STOCK = new Map([
  [262252598, 'grants 1000 XP outright; the only augment template that carries experience is ' +
              'AugmentLootItemTemplate, reachable only through analyseNotIdentifiedObject (needs a ' +
              'Tech Analysis Kit). A FactorType.Experience value of 1000 would be a 1001x XP rate, ' +
              'and Factors.getBoostLimiter caps a factor at 2.0 anyway'],
  [169509747, 'grants 5000 XP outright - same as 262252598'],
  [169509748, 'grants 25000 XP outright - same as 262252598'],
  [106127830, 'skill-training rate booster; FactorType.SkillLearning is @Deprecated and DECISIONS ' +
              'forbids resurrecting it in this pass'],
  [129251673, 'skill-training rate booster - same as 106127830'],
  [38481526,  'takes 15 minutes off the skill in training. Action SkillTime has no server handler ' +
              'at all, and AugmentTemplateReader throws IllegalStateException at boot on an ' +
              'augmentActionType it cannot dispatch, so a template file is not an option either'],
  [166681557, 'FTL Override. AugmentTeleportTemplate parses, but UseAugment demands a factor ' +
              'template, so activation logs "No factor template" and returns'],
]);

/* The booster tab, backed by real factors. FactorTypeRecord's javadoc: value 1 = +100%, and
 * Factors.getMultiplierFor folds from 1.0, so 1.0 IS a doubling. Values and durations are read off
 * the client's own description strings so the card and the tooltip cannot disagree; the loca key is
 * quoted next to each. Factors.getBoostLimiter is 2.0, so nothing here may exceed 2.0 or
 * activateAugment silently refuses it. */
const AUGMENT_FACTORS = new Map([
  [198796758, { key: 'augment_inc_experience',         hours: 24,  f: [['Experience', 1.0]] }],   // "2x Experience / 24 hours"
  [253000105, { key: 'augment_inc_experience_50_12h',  hours: 12,  f: [['Experience', 0.5]] }],   // "1.5x Experience / 12 hours"
  [140108213, { key: 'augment_experience_100_7d',      hours: 168, f: [['Experience', 1.0]] }],   // "+100% Experience / 7 days"
  [241136389, { key: 'augment_experience_100_short',   hours: 1,   f: [['Experience', 1.0]] }],   // "+100% Experience / 1 hour"
  [89768911,  { key: 'augment_inc_token',              hours: 24,  f: [['MeritIncome', 1.0]] }],  // "2x Merits / 24 hours"
  [119151097, { key: 'augment_inc_token_50_12h',       hours: 12,  f: [['MeritIncome', 0.5]] }],  // "1.5x Merits / 12 hours"
  [228331797, { key: 'augment_merit_100_7d',           hours: 168, f: [['MeritIncome', 1.0]] }],  // "+100% Merits / 7 days"
  [228331798, { key: 'augment_merit_100_7d_cap',       hours: 168, f: [['MeritIncome', 1.0], ['MeritCapacity', 1.0]] }], // "+100% Merits and +100% Merit Cap / 7 days"
  [22368085,  { key: 'augment_merit_100_short',        hours: 1,   f: [['MeritIncome', 1.0]] }],  // "+100% Merits / 1 hour"
  [118647064, { key: 'augment_inc_mining',             hours: 24,  f: [['AsteroidYield', 1.0]] }],// "2x Mining Income / 24 hours"
]);
// 92666191 keeps the AugmentFactorTemplate that already ships in augment_template_divine_inspireation.json.
const AUGMENT_TEMPLATE_EXISTS = new Set([92666191]);

/* ---------------------------------------------------------------- guids the dump does not have
 * Ten countables cards.js emits at guids that appear on no dump card at any view. They are not
 * phantoms and they are not duplicates: guids 5 and 9 are pinned by ResourceType
 * (EscortGreen_Rounds, LinerGreen_Rounds) so deleting them fails loadResources(), and the live
 * player holds 31 of guid 9. They stay, and the three ammo ones get the fields they should always
 * have had - today all three are ConsumableType 0 / Tier 0, which means no weapon can chamber them.
 *
 * Only the fields that are WRONG are listed. buy/sell prices stay with cards.js: these are
 * drop-only ammo and event boxes, and their prices are deliberate. W1 owns the Price ItemType fix
 * (guid 3 is one of the seven live cards typed 'Consumable', which is a ShopCategory and not a
 * ShopItemType, so shopItemType binds to null and the card write NPEs the socket). */
const LEGACY_CONSUMABLES = [
  { guid: 3, key: 'consumable_high_quality_rounds', owner: 'LOOT_EXTRAS',
    ct: 43703, tier: 1, effect: 'DamageKinetic', attrs: ['standard'],
    price: { category: 'Consumable', itemType: 'Round', tier: 1 },
    why: 'light green rounds, the striker drop from augment_template_green.json' },
  { guid: 5, key: 'consumable_medium_high_quality_rounds', owner: 'RESOURCE_META',
    ct: 43703, tier: 2, effect: 'DamageKinetic', attrs: ['standard'],
    price: { category: 'Consumable', itemType: 'Round', tier: 2 },
    why: 'ResourceType.EscortGreen_Rounds - pinned by the Java enum, medium green rounds' },
  { guid: 9, key: 'consumable_heavy_high_quality_rounds', owner: 'RESOURCE_META',
    ct: 43703, tier: 3, effect: 'DamageKinetic', attrs: ['standard'],
    price: { category: 'Consumable', itemType: 'Round', tier: 3 },
    why: 'ResourceType.LinerGreen_Rounds - pinned by the Java enum, and the live player holds 31' },
  // The rest are correct as they stand. ConsumableType 0 means "chambers in nothing", which is what
  // a mining resource or an event box should be, and Tier 0 means "shows on every hull".
  { guid: 10, key: 'augment_event_pristine_ice',    owner: 'RESOURCE_META', noChange: 'event trade-in box' },
  { guid: 11, key: 'augment_event_sacred_herbs',    owner: 'RESOURCE_META', noChange: 'event box; keeps Action LootItem and its AugmentLootItemTemplate' },
  { guid: 12, key: 'augment_event_foodstuffs',      owner: 'RESOURCE_META', noChange: 'event trade-in box' },
  { guid: 13, key: 'augment_event_precious_metals', owner: 'RESOURCE_META', noChange: 'event trade-in box' },
  { guid: 63148366,  key: 'resource_plutonium',    owner: 'RESOURCE_META', noChange: 'mining resource' },
  { guid: 172582782, key: 'resource_uranium',      owner: 'RESOURCE_META', noChange: 'mining resource' },
  { guid: 130797813, key: 'resource_ftl_fragment', owner: 'RESOURCE_META', noChange: 'mining resource' },
];

// ---------------------------------------------------------------- records
const rows = [], dropped = [];
for (const c of cards) {
  if (c.viewName !== 'ShipConsumable') continue;
  const f = c.fields, g = gui.get(c.guid), p = price.get(c.guid);
  const key = g && g.Key;
  if (!g || !p) { fail.push(`consumable ${c.guid}: dump has no ${!g ? 'GUI' : 'Price'} card`); continue; }
  if (DEV_ITEMS.has(c.guid)) {
    dropped.push({ guid: c.guid, key, reason: DEV_ITEMS.get(c.guid) });
    continue;
  }

  /* The Java field is consumableAttributes, a String[] with no @SerializedName. The dump calls it
   * sortingAttributes and stores [{m_value, m_attribute}]. Copying the dump key through gives Gson
   * nothing to bind, the field stays null, and writeStringArray NPEs on the first card write -
   * i.e. the socket drops the moment anyone opens the store. Take the m_attribute strings. */
  const attrs = (f.sortingAttributes || []).map(a => a.m_attribute);

  /* Every augment in the dump carries buyCount 0. GuiMenuItem renders "x0" and its buy button
   * calls MoveTo(Hold, 0), so the whole booster tab is a row of no-ops at 0 cubits. One is the
   * floor. Recorded as dumpBuyCount wherever it differs. */
  const buyCount = Math.max(1, f.buyCount);

  const noStock = NO_STOCK.get(c.guid);
  const dumpBuy = priceMap(p.BuyPrice);
  const buy = noStock ? {} : (PRICE_OVERRIDE.get(c.guid) || dumpBuy);

  /* The six Price-category-Resource cards are the currencies, and a currency's price is an
   * exchange rate the whole economy is tuned against, not an item price. cards.js sets those in
   * SHOP_STOCK (32 tylium to the cubit, 16 titanium) and they must survive this pass untouched -
   * the dump's 0.1 cubits per tylium is a different rate AND a value the buy arrow cannot step,
   * since it derives the step as round(1/value). Record what the dump said and hand no price. */
  const isCurrency = p.Category.name === 'Resource';

  const rec = {
    guid: c.guid, key,
    atlas: g.GUIAtlasTexturePath || '', frame: g.FrameIndex, icon: g.GUIIcon || '',
    ct: f.ConsumableType, tier: f.Tier,
    effect: f.effectType.name, action: f.Action.name,
    isAugment: f.IsAugment, autoConsume: f.AutoConsume, trashable: f.Trashable,
    buyCount, attrs,
    add: (f.ItemBuffAdd && f.ItemBuffAdd.stats) || {},
    mul: (f.ItemBuffMultiply && f.ItemBuffMultiply.stats) || {},
    price: {
      category: p.Category.name, itemType: p.ItemType.name, tier: p.Tier,
      faction: p.Faction.name, sortNames: p.SortingNames || [], sortWeight: p.SortingWeight,
      buy: isCurrency ? null : buy,
      upgrade: isCurrency ? null : priceMap(p.UpgradePrice),
      sell: isCurrency ? null : priceMap(p.SellPrice),
      canBeSold: isCurrency ? null : p.CanBeSold,
    },
    // Which cards.js table already emits this guid. W4 edits those entries in place rather than
    // adding a card; anything with owner null is new. Note that owner does NOT mean "keep cards.js's
    // values" - only priceOwner means that, and only for prices.
    owner: RESOURCE_GUIDS.has(c.guid) ? 'RESOURCE_META'
         : LOOT_EXTRA_GUIDS.has(c.guid) ? 'LOOT_EXTRAS' : null,
  };
  if (f.buyCount !== buyCount) rec.dumpBuyCount = f.buyCount;
  if (noStock) { rec.noStock = noStock; rec.dumpBuy = dumpBuy; }
  if (PRICE_OVERRIDE.has(c.guid)) rec.dumpBuy = dumpBuy;
  if (isCurrency) {
    rec.priceOwner = 'cards.js SHOP_STOCK';
    rec.dumpBuy = dumpBuy;
    rec.dumpSell = priceMap(p.SellPrice);
  }
  rows.push(rec);
}
rows.sort((a, b) => a.price.category.localeCompare(b.price.category) ||
                    a.price.itemType.localeCompare(b.price.itemType) ||
                    a.tier - b.tier || a.ct - b.ct || a.guid - b.guid);

// ---------------------------------------------------------------- the three nuclear projectiles
/* FireMissileAction.getMissileGUID routes DamageNuclear ammo to one of three projectile guids by
 * ItemBuffAdd.DamageHigh: absent -> MissileTorpedo, 4.0 -> MissileMiniNuke, 19.0 -> MissileNuke.
 * We emit projectile cards only for the plain missile (117216909), and
 * SpaceObjectFactory.createMissile THROWS on a missing World/Owner/Movement card - which truncates
 * the whole sector tick. Nuclear ammo cannot ship without these three.
 *
 * Everything except the Missile card is identity: the client picks the visual prefab from
 * faction+tier+type and the server builds the collider from radius, so prefabName only has to be a
 * real non-null ASCII string - the same reasoning cards.js already applies to 117216909. Speed,
 * LifeTime and MaxHullPoints come from the firing ability, not from here. maxRoll must stay
 * non-zero: it is a divisor in the movement sim and 0/0 puts NaN into the missile's position. */
const NUKE_PROJECTILES = [
  { guid: 29963472,  key: 'missile_torpedo',      missileType: 'Torpedo', explosionView: 'Torpedo',
    note: 'DamageNuclear ammo with NO DamageHigh stat: the three item_consumable_*_torpedo_token ' +
          'cards and item_consumable_escort_anti_capital_nuke' },
  { guid: 244685066, key: 'missile_nuclear_mini', missileType: 'Nuke',    explosionView: 'NuclearMini',
    note: 'DamageNuclear ammo with DamageHigh exactly 4.0: the three consumable_*mini_nuke cards' },
  { guid: 253392099, key: 'missile_nuclear',      missileType: 'Nuke',    explosionView: 'Nuclear',
    note: 'DamageNuclear ammo with DamageHigh exactly 19.0: the four consumable_*torpedo_token cards' },
].map(m => ({
  ...m, prefabName: 'colonialsmallmissile', radius: 3.0, frame: 177, avatar: 'GUI/Slots/missile',
}));

// ---------------------------------------------------------------- checks
const nameOf = (set, v, at) => { if (!set.has(v)) fail.push(`${at}: "${v}" is not a constant of that Java enum`); };

for (const r of rows) {
  const at = `consumable ${r.guid} (${r.key})`;
  if (!r.key) fail.push(`${at}: no loca key`);
  else if (!hasLoca(r.key)) fail.push(`${at}: key missing .name or .description in loca-keys.txt`);

  // The twelve declared fields of ShipConsumableCard, minus cardGUID. Gson leaves an omitted
  // reference field null and write() dereferences every one of them.
  for (const k of ['ct', 'tier', 'effect', 'action', 'isAugment', 'autoConsume', 'trashable', 'buyCount'])
    if (r[k] === undefined || r[k] === null) fail.push(`${at}: field ${k} is null`);
  if (!Array.isArray(r.attrs)) fail.push(`${at}: consumableAttributes is not an array`);
  if (!r.add || !r.mul) fail.push(`${at}: ItemBuffAdd/ItemBuffMultiply missing`);

  nameOf(E.effect, r.effect, `${at} effectType`);
  nameOf(E.action, r.action, `${at} Action`);
  nameOf(E.category, r.price.category, `${at} Price.Category`);
  nameOf(E.itemType, r.price.itemType, `${at} Price.ItemType`);
  nameOf(E.faction, r.price.faction, `${at} Price.Faction`);
  for (const k of [...Object.keys(r.add), ...Object.keys(r.mul)]) nameOf(E.stat, k, `${at} stat`);

  // ShopCategory.Unknown.getType() throws IllegalStateException the first time the shop touches it.
  if (r.price.category === 'Unknown') fail.push(`${at}: Price.Category Unknown throws in getType()`);
  // The live bug this package exists to stop repeating: Consumable is a ShopCategory, not a
  // ShopItemType, so shopItemType stays null and ShopItemCard.write NPEs on shopItemType.value.
  if (r.price.itemType === 'Consumable')
    fail.push(`${at}: Price.ItemType 'Consumable' is a ShopCategory, not a ShopItemType`);
  if (r.tier !== r.price.tier)
    fail.push(`${at}: ShipConsumable.Tier ${r.tier} != Price.Tier ${r.price.tier} - ItemList filters on one and the shop sorts on the other`);
  if (r.tier < 0 || r.tier > 4) fail.push(`${at}: Tier ${r.tier} out of range`);
  if (r.buyCount < 1 || r.buyCount > 65535) fail.push(`${at}: buyCount ${r.buyCount} does not fit a uint16`);
  // The currencies hand no price at all; cards.js owns those rows and the checks below are its job.
  if (r.priceOwner) continue;
  // sellItem removes the stack first and credits getSellItems() second.
  if (r.price.canBeSold && !Object.keys(r.price.sell).length)
    fail.push(`${at}: CanBeSold with an empty SellPrice destroys the item for nothing`);
  /* A price of zero is not an empty price. setupShop skips a card whose BuyPrice is empty, but
   * {cubits: 0} has an entry, so the item is stocked - and isEnoughInContainer returns true the
   * moment priceCount is 0. That is a free item for everyone, forever. The dump ships one
   * (Divine Inspiration at 0 cubits); anything else that lands here is the same mistake. */
  if (Object.keys(r.price.buy).length && Object.values(r.price.buy).every(v => v === 0))
    fail.push(`${at}: BuyPrice is present but zero - the shop stocks it and hands it out free`);
  for (const [k, m] of [['buy', r.price.buy], ['sell', r.price.sell], ['upgrade', r.price.upgrade]]) {
    if (Object.keys(m).length > 2)
      fail.push(`${at}: ${k} price has ${Object.keys(m).length} currency components, the shop row renders two`);
    for (const [g, v] of Object.entries(m)) {
      if (v < 0) fail.push(`${at}: ${k} price ${g} is negative`);
      /* cards.js requires every price value to be an integer or a negative power of two, because
       * the server charges ceil(value*count) while the client compares the raw float. That rule is
       * derived for a currency traded at an arbitrary count. A countable is bought in fixed stacks
       * of buyCount, and 27 of the original's prices are halves (1.5 tylium a round, 22.5 cubits a
       * repair cell). They are safe exactly when value*buyCount is a whole number, which is the
       * check below - both sides then agree to the unit. Anything that fails this is a real
       * mismatch and stays an error. */
      if (!Number.isInteger(v) && !Number.isInteger(v * r.buyCount) &&
          !(v > 0 && Number.isInteger(1 / v) && ((1 / v) & ((1 / v) - 1)) === 0))
        fail.push(`${at}: ${k} price ${g} = ${v} is fractional and ${v} x buyCount ${r.buyCount} is not whole`);
    }
  }
  if (r.isAugment && Object.keys(r.price.buy).length &&
      !AUGMENT_FACTORS.has(r.guid) && !AUGMENT_TEMPLATE_EXISTS.has(r.guid))
    fail.push(`${at}: stocked augment with no AugmentFactorTemplate - UseAugment logs "No factor template" and returns`);
}

// Demand coverage. This is the whole point of the package.
const supply = new Map();
for (const r of rows) {
  if (!r.price.buy || !Object.keys(r.price.buy).length) continue;
  const k = `${r.ct}/${r.tier}`;
  supply.set(k, (supply.get(k) || 0) + 1);
}
const uncovered = [...DEMAND.pairs.keys()].filter(k => !supply.has(k));
for (const k of uncovered)
  fail.push(`demanded pair ${k} has no buyable consumable - every system in [${DEMAND.pairs.get(k).join(', ')}] ` +
            `fires nothing and logs nothing`);

/* Nuclear countables that FireMissileAction.getMissileGUID cannot place. It recognises
 * DamageHigh 4.0 (mini nuke), 19.0 (nuke) and absent (torpedo); anything else leaves missileGUID
 * at 0 and SpaceObjectFactory.createMissile throws, which escapes into Sector.run's per-tick catch
 * and abandons that tick for everyone in the sector. Three mines carry DamageHigh 0.3 and land
 * there, and SelectConsumable validates neither ConsumableType nor Tier, so a crafted packet can
 * seat one in a missile slot. B1 added a fallback that fires an ordinary missile instead. If that
 * fallback is ever reverted, these cards become a sector-wide denial of service - so check for it
 * rather than trusting that it is still there. */
const OUT_OF_BAND_NUKES = rows.filter(r => r.effect === 'DamageNuclear' &&
  r.add.DamageHigh !== undefined && r.add.DamageHigh !== 4 && r.add.DamageHigh !== 19);
if (OUT_OF_BAND_NUKES.length) {
  const src = (() => { try {
    return fs.readFileSync(path.join(CORE_SRC,
      'core/sector/management/abilities/actions/FireMissileAction.java'), 'utf8');
  } catch { return ''; } })();
  if (!/if\s*\(\s*missileGUID\s*==\s*0\s*\)/.test(src))
    fail.push(`${OUT_OF_BAND_NUKES.length} DamageNuclear consumables (${OUT_OF_BAND_NUKES.map(r => r.guid).join(', ')}) ` +
              `have a DamageHigh getMissileGUID does not map, and its "missileGUID == 0" fallback is gone - ` +
              `firing one takes down the sector tick`);
}

// The non-dump legacy guids, checked against the same rules as everything else.
for (const l of LEGACY_CONSUMABLES) {
  const at = `legacy consumable ${l.guid} (${l.key})`;
  if (!hasLoca(l.key)) fail.push(`${at}: key missing .name or .description in loca-keys.txt`);
  if (rows.some(r => r.guid === l.guid)) fail.push(`${at}: also present in the dump - it is not legacy`);
  if (l.noChange) continue;
  nameOf(E.effect, l.effect, `${at} effectType`);
  nameOf(E.category, l.price.category, `${at} Price.Category`);
  nameOf(E.itemType, l.price.itemType, `${at} Price.ItemType`);
  if (l.price.itemType === 'Consumable')
    fail.push(`${at}: Price.ItemType 'Consumable' is a ShopCategory, not a ShopItemType`);
  if (l.tier !== l.price.tier) fail.push(`${at}: ShipConsumable.Tier ${l.tier} != Price.Tier ${l.price.tier}`);
}
// H11: every ResourceType guid must still have a home. Deleting one fails cards.js's loadResources().
for (const g of RESOURCE_GUIDS)
  if (!rows.some(r => r.guid === g) && !LEGACY_CONSUMABLES.some(l => l.guid === g))
    fail.push(`ResourceType guid ${g} is in neither CONSUMABLES_REAL nor LEGACY_CONSUMABLES`);

/* G11b, reported not enforced. A consumable nothing can use is shop clutter, not a crash - but it
 * has to be visible or it gets rediscovered as a bug report. Currencies, resources and augments are
 * never "used" by an ability and are excluded, and so are the two Consumable-category items whose
 * consumer is a protocol rather than a slot: Comm Access is spent by the fleet-chat handler and the
 * Tech Analysis Kit by analyseNotIdentifiedObject. Neither will ever appear in a demand set. */
const NOT_ABILITY_FED = new Set(['Radio', 'TechAnalysis']);
const UNUSED = rows.filter(r => r.price.category === 'Consumable' &&
                                !NOT_ABILITY_FED.has(r.price.itemType) &&
                                !DEMAND.pairs.has(`${r.ct}/${r.tier}`))
                   .map(r => ({ guid: r.guid, key: r.key, ct: r.ct, tier: r.tier, itemType: r.price.itemType }));

if (rows.length + dropped.length !== 166)
  fail.push(`expected 166 dump ShipConsumable cards, saw ${rows.length + dropped.length}`);

for (const m of NUKE_PROJECTILES) {
  nameOf(E.missileType, m.missileType, `projectile ${m.guid} MissileType`);
  nameOf(E.explosionView, m.explosionView, `projectile ${m.guid} MissileExplosionView`);
  // These are HUD bracket labels on a targetable object, not shop rows: .name only, no .description.
  if (!LOCA_KEYS.has(`bgo.${m.key}.name`)) fail.push(`projectile ${m.guid}: loca key ${m.key} has no .name`);
  if (rows.some(r => r.guid === m.guid)) fail.push(`projectile guid ${m.guid} collides with a consumable`);
}

for (const [guid, a] of AUGMENT_FACTORS) {
  const at = `augment template ${guid} (${a.key})`;
  if (!rows.some(r => r.guid === guid)) fail.push(`${at}: no consumable record at that guid`);
  if (a.hours < 1) fail.push(`${at}: activeTimeInHours must be at least 1`);
  for (const [type, value] of a.f) {
    nameOf(E.factor, type, `${at} FactorType`);
    // Factors.getBoostLimiter() is 2; activateAugment refuses a factor above the remaining limit.
    if (value > 2) fail.push(`${at}: factor ${type} value ${value} exceeds the 2.0 boost limiter`);
  }
}

if (fail.length) {
  console.error(`gen-consumables-real: ${fail.length} problem(s)\n  ` + fail.join('\n  '));
  process.exit(1);
}
warn.forEach(w => console.warn('  WARN ' + w));

// ---------------------------------------------------------------- augment templates
/* AugmentTemplateReader dispatches on the file's augmentActionType: None -> AugmentFactorTemplate,
 * Teleport -> AugmentTeleportTemplate, LootItem -> AugmentLootItemTemplate, anything else ->
 * IllegalStateException, which kills the boot. Every file this writes is None. */
const templateJson = (guid, a) => JSON.stringify([{
  // Gson ignores a field the class does not declare, and cards.js's template cross-check keys off
  // "cardGuid", which this never contains - so a provenance marker here costs nothing. Not a //
  // comment: the reader is lenient about those but nothing else that reads this tree is.
  _generated: 'tools/cardgen/gen-consumables-real.js - do not hand-edit',
  factorSource: 'Augment',
  factorTypeRecords: a.f.map(([type, value]) => ({ type, value })),
  activeTimeInHours: a.hours,
  augmentActionType: 'None',
  associatedItemGUID: guid,
}], null, 4) + '\n';

const templateFiles = [...AUGMENT_FACTORS].map(([guid, a]) => ({
  file: `augment_template_${a.key.replace(/^augment_/, '')}.json`, guid, key: a.key, json: templateJson(guid, a),
}));
if (!process.argv.includes('--no-templates')) {
  nameOf(E.source, 'Augment', 'AugmentFactorTemplate factorSource');
  for (const dir of TEMPLATE_DIRS) {
    fs.mkdirSync(dir, { recursive: true });
    for (const t of templateFiles) fs.writeFileSync(path.join(dir, t.file), t.json);
    console.log(`  ${templateFiles.length} augment templates -> ${path.relative(process.cwd(), dir)}`);
  }
}

// ---------------------------------------------------------------- emit
const j = v => JSON.stringify(v);
const body = rows.map(r => {
  const p = r.price;
  const extra = [
    r.dumpBuyCount !== undefined ? `dumpBuyCount: ${r.dumpBuyCount}` : null,
    r.owner ? `owner: '${r.owner}'` : null,
    r.dumpBuy ? `dumpBuy: ${j(r.dumpBuy)}` : null,
    r.noStock ? `noStock: ${j(r.noStock)}` : null,
  ].filter(Boolean);
  return `  { guid: ${r.guid}, key: '${r.key}', ct: ${r.ct}, tier: ${r.tier}, ` +
    `effect: '${r.effect}', action: '${r.action}',\n` +
    `    atlas: '${r.atlas}', frame: ${r.frame}, icon: '${r.icon}', ` +
    `isAugment: ${r.isAugment}, autoConsume: ${r.autoConsume}, trashable: ${r.trashable}, buyCount: ${r.buyCount},\n` +
    `    attrs: ${j(r.attrs)}, add: ${j(r.add)}, mul: ${j(r.mul)},\n` +
    `    price: { category: '${p.category}', itemType: '${p.itemType}', tier: ${p.tier}, ` +
    `faction: '${p.faction}', sortNames: ${j(p.sortNames)}, sortWeight: ${p.sortWeight},\n` +
    `             buy: ${j(p.buy)}, upgrade: ${j(p.upgrade)}, sell: ${j(p.sell)}, canBeSold: ${p.canBeSold} }` +
    (extra.length ? `,\n    ${extra.join(', ')} },` : ' },');
}).join('\n');

const censusBy = f => {
  const m = {};
  for (const r of rows) m[f(r)] = (m[f(r)] || 0) + 1;
  return Object.keys(m).sort().map(k => `${k}=${m[k]}`).join(', ');
};
const stocked = rows.filter(r => r.price.buy && Object.keys(r.price.buy).length).length;
const owned = rows.filter(r => r.owner).length;

fs.writeFileSync(OUT,
`/* ==================================== REAL CONSUMABLES AND BOOSTERS, FROM A LIVE SERVER
 *
 * GENERATED FILE - do not hand-edit. Regenerate with tools/cardgen/gen-consumables-real.js.
 *
 * ${rows.length} ShipConsumable records: every consumable the original server had, less the
 * ${dropped.length} dev item${dropped.length === 1 ? '' : 's'} listed in CONSUMABLES_DROPPED. ${owned} sit at guids cards.js already emits
 * (see .owner) and are edits, not additions; the remaining ${rows.length - owned} are new. ${stocked} carry a
 * non-empty BuyPrice and therefore appear in the shop.
 *
 * By Price category: ${censusBy(r => r.price.category)}
 * By item type:      ${censusBy(r => r.price.itemType)}
 *
 * Field names are ours; the mapping onto the twelve fields ShipConsumableCard.java declares is:
 *   ct -> ConsumableType   tier -> Tier        add -> ItemBuffAdd   mul -> ItemBuffMultiply
 *   action -> Action       isAugment -> IsAugment                   autoConsume -> AutoConsume
 *   trashable -> Trashable buyCount -> buyCount effect -> effectType
 *   attrs -> consumableAttributes
 *
 * That last one is the trap. Java calls the field consumableAttributes and types it String[] with
 * no @SerializedName; the DUMP calls it sortingAttributes and stores [{m_value, m_attribute}].
 * Emit the dump's key or the dump's shape and Gson binds nothing, the field stays null, and
 * ShipConsumableCard.write NPEs on writeStringArray - which the server answers by closing the
 * player's socket, with nothing logged client-side. attrs below is already the m_attribute list.
 *
 * Prices are {currencyGuid: amount} maps, matching cards.js's price() helper and Java's
 * Map<Long,Float>, NOT the dump's [{guid, amount}] array.
 *
 * Five values are deliberately not the dump's, each marked in the record it belongs to:
 *   - buyCount is floored at 1 (dumpBuyCount records the original). Every augment shipped with 0,
 *     which makes GuiMenuItem's buy button call MoveTo(Hold, 0).
 *   - 92666191 Divine Inspiration keeps our 4,000-cubit price. The dump prices it at 0 cubits,
 *     and a zero price is not an empty price: the shop stocks it and hands it out free.
 *   - seven augments the server has no way to honour carry an empty BuyPrice and a noStock reason.
 *     PlayerProtocol's UseAugment insists on an AugmentFactorTemplate; anything else logs
 *     "No factor template" and returns, so stocking them would sell a button that does nothing.
 *   - the six currencies hand no price at all (priceOwner, with dumpBuy/dumpSell for reference).
 *     A currency's price is an exchange rate the rest of the economy is tuned against, and
 *     cards.js's SHOP_STOCK owns it.
 *   - consumable_mega_rounds is dropped outright (CONSUMABLES_DROPPED says why).
 *
 * Tier is copied verbatim and ammunition is tier-locked 1-4, not 0. ItemList's tier filter passes
 * a countable when Card.Tier == tier || Card.Tier == 0, so tier 0 would list light rounds on a
 * capital ship. Tier 0 here means only what it means in the dump: currencies and boosters.
 */
'use strict';

/* Every (ConsumableType, Tier) pair an ability with ConsumableOption 'Using' demands, across the
 * ${DEMAND.systems} emitted systems. Source: ${DEMAND.source}.
 * cards.js's G11 rule re-derives this from the abilities it actually emits; this copy exists so the
 * standalone check has something to assert against and so the set can be reviewed as a diff. */
const CONSUMABLE_DEMAND = ${JSON.stringify([...DEMAND.pairs.keys()].sort((a, b) => {
  const [ac, at] = a.split('/').map(Number), [bc, bt] = b.split('/').map(Number);
  return ac - bc || at - bt;
}))};

const CONSUMABLES_REAL = [
${body}
];

/* Ten countables cards.js emits at guids that appear on no dump card. Guids 3, 5 and 9 are
 * green-rounds ammunition emitted today with ConsumableType 0 and Tier 0, which means no weapon can
 * chamber them; the fields below are the correction, and guid 3's Price is one of the seven live
 * cards typed 'Consumable' - a ShopCategory, not a ShopItemType, so the card write NPEs the socket.
 * Guids 5 and 9 are pinned by ResourceType and cannot be deleted (loadResources() throws), and the
 * live player holds 31 of guid 9. Prices stay with cards.js: these are drops, not stock. Records
 * carrying noChange are already correct and are listed only so the set is complete. */
const LEGACY_CONSUMABLES = ${JSON.stringify(LEGACY_CONSUMABLES, null, 2)};

// Dump cards we deliberately do not emit, and why. Any change here is a reviewed diff.
const CONSUMABLES_DROPPED = ${JSON.stringify(dropped, null, 2)};

/* Priced consumables that no emitted ability can use. Kept because they are real, sellable, and
 * drop from loot - but the systems that fired them are on the §1.1 drop list, so they are shop
 * rows with nothing behind them. This is the list cards.js's G11b warning is expected to print. */
const CONSUMABLES_UNUSED = ${JSON.stringify(UNUSED, null, 2)};

/* AugmentFactorTemplate payloads for the boosters that can be honoured. Written to
 * ServerConfigurationUtils/global/AugmentTemplates/ by
 * \`node tools/cardgen/gen-consumables-real.js --write-templates\`; carried here so a validator can
 * check card and template agree without parsing the JSON tree. value 1.0 = +100%: FactorTypeRecord
 * documents it and Factors.getMultiplierFor folds from 1.0. */
const AUGMENT_TEMPLATES = ${JSON.stringify(templateFiles.map(t => ({ guid: t.guid, key: t.key, file: t.file, body: JSON.parse(t.json)[0] })), null, 2)};

/* The three nuclear projectiles FireMissileAction.getMissileGUID selects by ItemBuffAdd.DamageHigh.
 * SpaceObjectFactory.createMissile throws on a missing World/Owner/Movement card and takes the rest
 * of the sector tick with it, so nuclear ammo cannot be stocked until these exist. Each needs
 * World + Owner + Movement + GUI + Missile at its guid, modelled on cards.js's missileObjectCards(). */
const NUKE_PROJECTILES = ${JSON.stringify(NUKE_PROJECTILES, null, 2)};

module.exports = {
  CONSUMABLES_REAL, LEGACY_CONSUMABLES, CONSUMABLES_DROPPED, CONSUMABLES_UNUSED,
  CONSUMABLE_DEMAND, AUGMENT_TEMPLATES, NUKE_PROJECTILES,
};
`);

console.log(`${rows.length} consumables -> ${path.relative(process.cwd(), OUT)}`);
console.log(`  demand set from ${DEMAND.source}: ${DEMAND.pairs.size} pairs, all covered`);
console.log(`  ${owned} edits to existing guids, ${rows.length - owned} new, ${stocked} stocked`);
console.log(`  by category: ${censusBy(r => r.price.category)}`);
console.log(`  by itemType: ${censusBy(r => r.price.itemType)}`);
console.log(`  dropped: ${dropped.length}` + dropped.map(d => `\n    ${d.guid} ${d.key} - ${d.reason}`).join(''));
console.log(`  augment templates: ${templateFiles.length} factor-backed, ` +
            `${NO_STOCK.size} unstockable, 1 pre-existing (92666191)`);
console.log(`  priced but unusable (G11b): ${UNUSED.length}` +
            UNUSED.map(u => `\n    ${u.guid} ${u.key} ct ${u.ct} t${u.tier}`).join(''));
