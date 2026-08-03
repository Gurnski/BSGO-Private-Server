/*
 * Generate tools/cardgen/paints-real.js from the live-server card dump.
 *
 * Ship paints were the most visible empty category in the store: 84 hull cards across the roster
 * carry a ship_paint bay and we shipped nothing that fits any of them, and the validator did not
 * even complain because it exempts ship_paint.
 *
 * The dump has 94 paints. Each is ONE guid carrying FOUR views - ShipSystem, GUI, Price and
 * ShipPaint - and every one of them is locked to a single hull. Two things have to change on the
 * way across:
 *
 *   ShipObjectKeyRestrictions -> [].  The dump's entry is a dump ShipObjectKey, and
 *   ShipSystemCard.cs:96-102 fetches a *Ship card* at every restriction entry and IsLoaded.Depend()s
 *   on it. None of our player hulls has a Ship card at its objKey, so porting the list verbatim
 *   reproduces the historical "Card should not be send because it's null! 268081382 10" - an
 *   infinite loading screen, because the client has no timeout on card loads. Nothing is lost:
 *   the per-hull lock is carried entirely by shipCardGuid through three independent client gates
 *   (ShopWindow.cs:1039, GUIShopPaperDoll.cs:159, ItemList.cs:128 + :144), and
 *   GuiAdvancedRequirementsPanel.cs:77 deliberately skips the restriction block for paints.
 *
 *   shipCardGuid -> OUR level-1 hull guid.  Join: paint's single restriction entry -> dump
 *   Ship.ShipObjectKey -> the dump Ship card's guid -> dump World.PrefabName -> our hull card for
 *   that prefab. The join is case-folded because the dump spells two prefabs CylonT1Stealth /
 *   HumanT1Stealth and a case-sensitive match silently drops both stealth hulls.
 *   Pointing at the level-1 card also covers the Advanced twin: ItemList.cs:128 accepts
 *   shipCard.CardGUID *or* shipCard.NextCard.CardGUID, and ShipCard.Equals (ShipCard.cs:85-91)
 *   compares Tier + ShipRoleDeprecated + HangarID, which base and Advanced share.
 *
 * Thirteen paints reach us with an empty BuyPrice and have to be given one. ShopProtocol.setupShop
 * (ShopProtocol.java:237-262) stocks every level-1 ShipSystem that merely has a Price card - the
 * isEmpty guard exists only on the countable loop above it - so an empty BuyPrice means FREE, not
 * hidden.
 *
 * Four flyable hull families end the port with an empty paint bay, so this also hand-authors an
 * 'advanced' paint for each. That texture key is ShipSkinSubstance.DEFAULT_SKIN_KEY
 * (ShipSkinSubstance.cs:8), which both skin components rewrite to the base look, so they need no
 * art asset - only a loca key, and all four exist.
 *
 * Reads the emitted JsonCards, not just the dump: the join target is our own hull card guid and
 * the coverage table is measured against the bays we actually emit, and only cards.js knows those.
 * Run cards.js first if hull guids or slot layouts have changed.
 *
 *   node tools/cardgen/gen-paints-real.js        (BSGO_DUMP overrides the dump path)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DUMP = process.env.BSGO_DUMP || path.join(ROOT, 'research/dumps/cards_20260729_223813.json');
const JSONCARDS = path.join(ROOT, 'server/ServerConfigurationUtils/global/JsonCards');
const LOCA = path.join(__dirname, 'loca-keys.txt');
const OUT = path.join(__dirname, 'paints-real.js');

const CUB = 264733124;            // cubits - the currency 67 of the dump's own paints are sold in
const NPC_HANGAR = 12;            // where cards.js parks the NPC-only hull variants; not flyable

/* The one dump paint we do not port. Its only restriction target is humant1scout, a hull we do not
 * emit, so there is no shipCardGuid to remap it onto; emitting it unrestricted would make a
 * scout-specific skin fit every hull in the game, which is exactly backwards for a hull skin. */
const DROP = new Map([
  [288972890, 'restricted to humant1scout, a hull we do not emit'],
]);

/* Hand-authored paints, one per family the dump leaves with an empty bay. The guid block 6070-6073
 * is free. 6000-6199 is the hand-authored system range, and what is taken in it today is 6031-6034,
 * 6041-6042, 6051-6054 (capital and platform weapons), 6060-6065 (avionics) and 6080-6089 (the C-31
 * ladder). 6001-6006, 6011-6016 and 6021-6026 used to be listed here as taken; the systems import
 * retired all eighteen and they are free now. The collision check below reads the emitted catalogue
 * rather than this comment, so a stale line here is misleading but not dangerous.
 *
 * The keys follow the dump's own convention for this family, 'system_paint_advanced_' + the hull's
 * loca key - verified against the twelve dump paints that use it. Note cylont2defender is the
 * Banshee, not the Wrath: ship_wrath is cylont2fighter, which already has three paints.
 * All four keys resolve in loca-keys.txt with .name and .description; the generator re-checks. */
const AUTHORED = [
  { guid: 6070, prefab: 'humant4carrier',  key: 'system_paint_advanced_ship_brimir' },
  { guid: 6071, prefab: 'cylont4carrier',  key: 'system_paint_advanced_ship_surtur' },
  { guid: 6072, prefab: 'cylont1multi2',   key: 'system_paint_advanced_ship_war_raider_mk2' },
  { guid: 6073, prefab: 'cylont2defender', key: 'system_paint_advanced_ship_banshee' },
];

/* In the original the 'advanced' paints were granted with the Advanced hull rather than sold, and
 * the two syfy skins were a promotion. We have no grant mechanism (pre-installed loadouts are out
 * of scope) and an empty BuyPrice on a ShipSystem means free-for-everyone, so they get a flat price
 * in the same currency the ordinary paints use. 6,000 sits below the dump's t3 cubit band
 * (10,000-25,000) on purpose: the job of this number is to stop the item being free, not to gate
 * it behind a grind it never had. */
const authoredPrice = tier => ({ [CUB]: tier <= 2 ? 3000 : 6000 });

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); return ok; };

/* ---------------------------------------------------------------- the dump */
const raw = JSON.parse(fs.readFileSync(DUMP, 'utf8'));
const dumpCards = raw.cards || raw;
const dumpView = v => new Map(dumpCards.filter(c => c.viewName === v).map(c => [c.guid, c.fields]));
const dShip = dumpView('Ship'), dWorld = dumpView('World');
const dGui = dumpView('GUI'), dPrice = dumpView('Price'), dPaint = dumpView('ShipPaint');

// A dump Ship card shares its guid with its World card, so ShipObjectKey -> prefab is one hop.
const objKeyToPrefab = new Map();
for (const [guid, f] of dShip) {
  const w = dWorld.get(guid);
  if (w && w.PrefabName) objKeyToPrefab.set(f.ShipObjectKey, w.PrefabName.toLowerCase());
}

/* ---------------------------------------------------------------- our roster */
const ours = {};
for (const fn of fs.readdirSync(JSONCARDS)) {
  for (const c of Object.values(JSON.parse(fs.readFileSync(path.join(JSONCARDS, fn), 'utf8')))) {
    (ours[c.cardView2] = ours[c.cardView2] || new Map()).set(c.cardGUID, c);
  }
}
const oShip = ours.Ship, oWorld = ours.World, oGui = ours.GUI;
const ourGuids = new Set();
for (const m of Object.values(ours)) for (const g of m.keys()) ourGuids.add(g);
/* Guids this module already owns are not collisions with itself. Without this, the first
 * regeneration after cards.js starts emitting paints would report all 97 as taken. */
try {
  for (const r of require(OUT).PAINTS_REAL) ourGuids.delete(r.sys);
} catch (e) { /* first run, no previous output */ }

/* Flyable hull families with a paint bay. The NPC variants share their prefab with a player hull
 * but sit on HangarID 12 and are out of every ShipList, so they are not part of the coverage
 * question - and ShipCard.Equals would reject a paint aimed at the player card anyway. */
const families = new Map();     // prefab -> { l1, l2, tier, faction }
for (const [guid, c] of oShip) {
  if (c.HangarID === NPC_HANGAR) continue;
  if (!(c.Slots || []).some(s => s.SystemType === 'ship_paint')) continue;
  const prefab = ((oWorld.get(guid) || {}).prefabName || '').toLowerCase();
  const fam = families.get(prefab) || { prefab, l1: null, l2: [], tier: c.Tier, faction: c.Faction };
  if (c.Level === 1) {
    check(!fam.l1, `two level-1 hull cards for ${prefab}: ${fam.l1 && fam.l1.cardGUID} and ${guid}`);
    fam.l1 = c;
  } else fam.l2.push(c);
  families.set(prefab, fam);
}
for (const fam of families.values()) {
  check(fam.l1, `${fam.prefab} has a paint bay but no level-1 hull card`);
  if (!fam.l1) continue;
  check(oGui.has(fam.l1.cardGUID), `${fam.prefab} level-1 card ${fam.l1.cardGUID} has no GUI card - the ` +
    `"Required ship" tooltip line reads PaintCard.shipCard.ItemGUICard.Name`);
  check(oWorld.has(fam.l1.cardGUID), `${fam.prefab} level-1 card ${fam.l1.cardGUID} has no World card - ` +
    `GuiPaintsViewWindow falls back to shipCard.WorldCard.PrefabName when model is "default"`);
  check(fam.l1.nextShipCardGuid && fam.l2.some(c => c.cardGUID === fam.l1.nextShipCardGuid),
    `${fam.prefab} level-1 card ${fam.l1.cardGUID} does not chain to its Advanced twin, so ` +
    `ItemList.cs:128 would hide its paints while the Advanced hull is active`);
}

/* ---------------------------------------------------------------- port the dump paints */
const rows = [];
const dropped = [];
const factionFixed = [];
for (const c of dumpCards) {
  if (c.viewName !== 'ShipSystem') continue;
  const f = c.fields;
  if (!f.SlotType || f.SlotType.name !== 'ship_paint') continue;

  const g = dGui.get(c.guid), p = dPrice.get(c.guid), s = dPaint.get(c.guid);
  if (!check(g && p && s, `dump paint ${c.guid} is missing one of its GUI/Price/ShipPaint views`)) continue;

  const restr = f.ShipObjectKeyRestrictions || [];
  const prefab = restr.length === 1 ? objKeyToPrefab.get(restr[0]) : undefined;
  const fam = prefab && families.get(prefab);

  if (DROP.has(c.guid) || !fam) {
    dropped.push({ sys: c.guid, key: g.Key, tier: f.Tier, prefab: prefab || '?',
      reason: DROP.get(c.guid) || `no flyable hull for restriction target ${restr.join(',')}` });
    continue;
  }
  check(!ourGuids.has(c.guid), `dump paint guid ${c.guid} collides with a card we already emit`);
  check(fam.tier === f.Tier, `paint ${c.guid} is tier ${f.Tier} but ${prefab} is tier ${fam.tier}; the ` +
    `tier lock in ShopWindow.cs:1049 would hide it forever`);

  const items = (p.BuyPrice && p.BuyPrice.items) || [];
  const buy = {};
  for (const i of items) buy[i.guid] = Math.round(i.amount);
  const priced = items.length ? 'dump' : 'authored';
  if (!items.length) Object.assign(buy, authoredPrice(f.Tier));

  /* Faction comes from the hull, not from the dump's Price card. The two agree on 93 of the 94, and
   * where they disagree the dump is wrong in a way that makes the paint invisible to everyone:
   * ShopWindow.cs:1010-1013 drops a store item whose ShopItemCard.Faction is non-Neutral and not the
   * player's, while ItemList.cs:144 drops a paint whose shipCard.Faction is not the player's. A card
   * that fails one of those for each faction can never be bought by anybody. */
  if (p.Faction.name !== fam.faction) factionFixed.push({ guid: c.guid, key: g.Key, was: p.Faction.name, now: fam.faction, prefab });

  rows.push({
    sys: c.guid, tier: f.Tier, faction: fam.faction, key: g.Key,
    guiAtlas: g.GUIAtlasTexturePath, frameIndex: g.FrameIndex, guiIcon: g.GUIIcon,
    paintTexture: s.paintTexture, model: s.model,
    ourShipCardGuid: fam.l1.cardGUID, prefab,
    sortingNames: p.SortingNames, price: buy, priced,
  });
}

/* ---------------------------------------------------------------- close the gaps */
const covered = new Map([...families.keys()].map(k => [k, 0]));
for (const r of rows) covered.set(r.prefab, covered.get(r.prefab) + 1);
const gaps = [...covered].filter(([, n]) => !n).map(([k]) => k).sort();

const authoredFor = new Set(AUTHORED.map(a => a.prefab));
check(gaps.length === authoredFor.size && gaps.every(p => authoredFor.has(p)),
  `AUTHORED does not match the measured gaps. gaps=[${gaps}] authored=[${[...authoredFor].sort()}]`);

for (const a of AUTHORED) {
  const fam = families.get(a.prefab);
  if (!check(fam, `AUTHORED paint ${a.guid} targets ${a.prefab}, which is not a flyable hull family`)) continue;
  check(!ourGuids.has(a.guid), `authored paint guid ${a.guid} collides with a card we already emit`);
  rows.push({
    sys: a.guid, tier: fam.tier, faction: fam.faction, key: a.key,
    // The dump uses one atlas and one frame for all 94 paints, and the generic ShipskinIcon for the
    // twelve that have no bespoke art. The shop reads GUIIcon, not the atlas (ShipSystem.cs:129-134).
    guiAtlas: 'GUI/AbilityToolbar/abilities_atlas', frameIndex: 129,
    guiIcon: 'GUI/EquipBuyPanel/ShipSkins/ShipskinIcon',
    paintTexture: 'advanced', model: 'default',
    ourShipCardGuid: fam.l1.cardGUID, prefab: a.prefab,
    sortingNames: ['standard'], price: authoredPrice(fam.tier), priced: 'authored', authored: true,
  });
  covered.set(a.prefab, covered.get(a.prefab) + 1);
}

/* ---------------------------------------------------------------- validate */
const loca = new Set(fs.readFileSync(LOCA, 'utf8').split(/\r?\n/).map(s => s.trim()));
const seen = new Set();
for (const r of rows) {
  check(!seen.has(r.sys), `duplicate paint guid ${r.sys}`); seen.add(r.sys);
  // A GUI card whose key is absent renders as [] and GUICard.Description returns null.
  check(loca.has(`bgo.${r.key}.name`), `${r.sys}: loca key bgo.${r.key}.name is absent`);
  check(loca.has(`bgo.${r.key}.description`), `${r.sys}: loca key bgo.${r.key}.description is absent`);
  check(Object.keys(r.price).length > 0, `${r.sys} (${r.key}) has no BuyPrice - ShopProtocol would stock it free`);
  for (const [cur, amt] of Object.entries(r.price)) check(amt > 0, `${r.sys} prices currency ${cur} at ${amt}`);
  const fam = families.get(r.prefab);
  check(fam && fam.l1.cardGUID === r.ourShipCardGuid, `${r.sys} points at ${r.ourShipCardGuid}, not ${r.prefab}'s level-1 card`);
  check(r.faction === 'Colonial' || r.faction === 'Cylon', `${r.sys} has Faction ${r.faction}`);
}
const stillEmpty = [...covered].filter(([, n]) => !n).map(([k]) => k);
check(!stillEmpty.length, `hull families with a paint bay and no paint: ${stillEmpty.join(', ')}`);

if (fail.length) {
  console.error(`gen-paints-real: ${fail.length} problem(s), nothing written`);
  for (const m of fail) console.error('  ' + m);
  process.exit(1);
}

/* ---------------------------------------------------------------- write */
rows.sort((a, b) => a.faction.localeCompare(b.faction) || a.tier - b.tier ||
  a.prefab.localeCompare(b.prefab) || a.sys - b.sys);

const famOf = p => families.get(p);
const covLines = [...covered].sort((a, b) =>
  famOf(a[0]).faction.localeCompare(famOf(b[0]).faction) || famOf(a[0]).tier - famOf(b[0]).tier ||
  a[0].localeCompare(b[0])).map(([prefab, n]) => {
    const f = famOf(prefab);
    const auth = rows.filter(r => r.prefab === prefab && r.authored).length;
    return ` *   ${f.faction.padEnd(8)} t${f.tier}  ${prefab.padEnd(16)} ${String(f.l1.cardGUID).padStart(11)}` +
           `  ${String(n).padStart(2)}${auth ? '   (' + auth + ' hand-authored)' : ''}`;
  });

const authoredCount = rows.filter(r => r.authored).length;
const byPriced = rows.filter(r => r.priced === 'authored' && !r.authored).length;

/* Only written when the dump and the hull actually disagree, so the note never claims a fix that a
 * future dump re-import no longer needs. */
const factionNote = !factionFixed.length ? '' :
` * faction is the HULL's, not the dump Price card's. They disagree on ${factionFixed.length} of the ${rows.length - authoredCount}:
${factionFixed.map(f => ` *   ${f.guid} ${f.key}\n *     filed under ${f.was} in the dump, but ${f.prefab} is ${f.now}.`).join('\n')}
 * A paint whose Price faction and hull faction disagree is invisible to both sides -
 * ShopWindow.cs:1010-1013 hides it from one, ItemList.cs:144 from the other.
 *`;

const q = s => `'${String(s).replace(/'/g, "\\'")}'`;
const list = a => `[${a.map(q).join(', ')}]`;
const money = o => `{ ${Object.entries(o).map(([k, v]) => `${k}: ${v}`).join(', ')} }`;

const body = rows.map(r =>
  `  { sys: ${r.sys}, tier: ${r.tier}, faction: ${q(r.faction)}, prefab: ${q(r.prefab)}, ` +
  `ourShipCardGuid: ${r.ourShipCardGuid},\n` +
  `    key: ${q(r.key)}, paintTexture: ${q(r.paintTexture)}, model: ${q(r.model)},\n` +
  `    guiAtlas: ${q(r.guiAtlas)}, frameIndex: ${r.frameIndex}, guiIcon: ${q(r.guiIcon)},\n` +
  `    sortingNames: ${list(r.sortingNames)}, price: ${money(r.price)}, priced: ${q(r.priced)}` +
  `${r.authored ? ', authored: true' : ''} },`).join('\n');

const dropBody = dropped.map(d =>
  `  { sys: ${d.sys}, key: ${q(d.key)}, tier: ${d.tier}, prefab: ${q(d.prefab)},\n` +
  `    reason: ${q(d.reason)} },`).join('\n');

fs.writeFileSync(OUT,
`/* ============================================ SHIP PAINTS, FROM A LIVE SERVER
 *
 * GENERATED FILE - do not hand-edit. Regenerate with tools/cardgen/gen-paints-real.js.
 *
 * ${rows.length} paints: ${rows.length - authoredCount} ported from the dump and ${authoredCount} hand-authored to close the last per-hull gaps.
 * Every flyable hull card with a ship_paint bay ends up with something that fits it, which is what
 * the 84 empty paint bays on the roster were about.
 *
 * Each record becomes FOUR cards at one guid: ShipSystem, GUI, Price and ShipPaint. That is the
 * dump's own shape - there is no separate paint entity.
 *
 * CONSTANT ACROSS ALL ${rows.length} - not in the records, the emitter supplies them:
 *   ShipSystem  SlotType 'ship_paint', Level 1, MaxLevel 1, nextShipSystemCardGuid 0,
 *               Durability 1, Class 'Standart', Views ['Cooldown','BuffCost','Durability'],
 *               Unique true, ReplaceableOnly false, UserUpgradeable false, Trashable false,
 *               Indestructible true, MaxCountPerShip 0, SkillHashes [], shipAbilityCards [],
 *               empty StaticBuffs/MultiplyBuffs, ShipRoleRestrictions []
 *   Price       Category 'System', ItemType 'ShipPaint', SortingWeight 9000, CanBeSold false,
 *               empty UpgradePrice and SellPrice
 * MaxCountPerShip is 0 on purpose: ShopWindow.cs:1043 only applies the limit when it is > 0, and a
 * paint is Unique anyway. Paints do not ladder - MaxLevel 1 on all 94 in the dump.
 *
 * ShipObjectKeyRestrictions MUST STAY EMPTY. ShipSystemCard.cs:96-102 fetches a Ship card at every
 * restriction entry and IsLoaded.Depend()s on it, and no player hull of ours has a Ship card at its
 * ShipObjectKey. Porting the dump's list verbatim is the historical "Card should not be send
 * because it's null! 268081382 10" - and because the client has no timeout on card loads, that is
 * an infinite loading screen rather than an error. Nothing is lost by dropping it: the per-hull
 * lock is carried by ourShipCardGuid through ShopWindow.cs:1039, GUIShopPaperDoll.cs:159 and
 * ItemList.cs:128 + :144, and GuiAdvancedRequirementsPanel.cs:77 skips the restriction block for
 * paints anyway.
 *
 * ourShipCardGuid is OUR level-1 hull card, not the dump's. It also covers the Advanced twin:
 * ItemList.cs:128 accepts shipCard.CardGUID or shipCard.NextCard.CardGUID, and ShipCard.Equals
 * compares Tier + ShipRoleDeprecated + HangarID, which base and Advanced share.
 *
 * priced: 'dump' is the original price. 'authored' is one we invented, because
 * ShopProtocol.java:237-262 stocks every level-1 ShipSystem that has a Price card with no isEmpty
 * guard, so an empty BuyPrice means free-for-everyone rather than hidden. ${byPriced} ported paints arrived
 * that way - the 'advanced' skins that came with the Advanced hull in the original, plus the two
 * syfy promo skins - and so do all ${authoredCount} authored ones.
 *${factionNote ? '\n' + factionNote : ''}
 * The ${authoredCount} authored records use paintTexture 'advanced', which is
 * ShipSkinSubstance.DEFAULT_SKIN_KEY (ShipSkinSubstance.cs:8) and needs no art asset - both skin
 * components rewrite it to the base look. A wrong or missing paintTexture is a Debug.LogWarning and
 * an unpainted ship (ShipSkin.cs:71-77), never a throw.
 *
 * PER-HULL COVERAGE - faction, tier, prefab, our level-1 hull guid, paints that fit it:
 *
${covLines.join('\n')}
 */
'use strict';

const PAINTS_REAL = [
${body}
];

/* Not ported, and why. Printed by cards.js so the gap stays visible. */
const PAINTS_DROPPED = [
${dropBody}
];

module.exports = { PAINTS_REAL, PAINTS_DROPPED };
`);

console.log(`${rows.length} paints (${rows.length - authoredCount} ported, ${authoredCount} authored) -> ${path.relative(process.cwd(), OUT)}`);
console.log(`  dropped: ${dropped.length}` + dropped.map(d => `\n    ${d.sys} ${d.key} - ${d.reason}`).join(''));
console.log(`  invented a price for ${byPriced} ported paints with an empty BuyPrice, and for all ${authoredCount} authored ones`);
for (const f of factionFixed) console.log(`  faction fixed: ${f.guid} ${f.key} ${f.was} -> ${f.now} (${f.prefab})`);
console.log('  per-hull coverage:');
for (const l of covLines) console.log('  ' + l.slice(3));
