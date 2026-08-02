/*
 * Generate tools/cardgen/equipment-real.js from the live-server card dump.
 *
 * The hull / engine / computer ladders are the game's passive equipment: pure static-buff items
 * with no ability card. We shipped ONE of each family per tier (12 items total) against the
 * original's 75, which is why the store's Computer and Hull tabs looked all but empty and every
 * ship of a tier fitted identically.
 *
 * Everything emitted here is real: guids, loca keys, stat buffs, durability, max-per-ship and
 * prices are read from the dump, not invented. Systems whose buffs came back empty are skipped
 * rather than guessed at - a fitted module that does nothing is worse than an absent one.
 *
 *   node tools/cardgen/gen-equipment-real.js        (BSGO_DUMP overrides the dump path)
 */
const fs = require('fs');
const path = require('path');

const DUMP = process.env.BSGO_DUMP ||
  path.resolve(__dirname, '../../research/dumps/cards_20260729_223813.json');
const OUT = path.join(__dirname, 'equipment-real.js');
const FAMILIES = new Set(['hull', 'engine', 'computer']);

const raw = JSON.parse(fs.readFileSync(DUMP, 'utf8'));
const cards = raw.cards || raw;
const byGuid = (view) => new Map(cards.filter(c => c.viewName === view).map(c => [c.guid, c.fields]));
const gui = byGuid('GUI'), price = byGuid('Price');

const rows = [];
for (const c of cards) {
  if (c.viewName !== 'ShipSystem') continue;
  const f = c.fields;
  if (f.Level !== 1) continue;                        // level 1 is the card you buy
  const slot = f.SlotType && f.SlotType.name;
  if (!FAMILIES.has(slot)) continue;
  const st = (f.StaticBuffs && f.StaticBuffs.stats) || {};
  if (!Object.keys(st).length) continue;              // obfuscated/empty: skip, never guess
  const g = gui.get(c.guid), p = price.get(c.guid);
  if (!g || !p) continue;
  // Price components are {guid, amount} pairs; tylium is the only currency these use.
  const items = (p.BuyPrice && p.BuyPrice.items) || [];
  const tyl = (items.find(i => i.guid === 215278030) || {}).amount;
  if (!tyl) continue;
  rows.push({
    sys: c.guid, slot, tier: f.Tier, key: g.Key, frame: g.FrameIndex,
    tyl: Math.round(tyl), dur: f.Durability, max: f.MaxCountPerShip || 5,
    st,
  });
}

rows.sort((a, b) => a.slot.localeCompare(b.slot) || a.tier - b.tier || a.tyl - b.tyl);

const counts = {};
for (const r of rows) counts[r.slot + '/t' + r.tier] = (counts[r.slot + '/t' + r.tier] || 0) + 1;

const body = rows.map(r =>
  `  { sys: ${r.sys}, slot: '${r.slot}', tier: ${r.tier}, key: '${r.key}', frame: ${r.frame}, ` +
  `tyl: ${r.tyl}, dur: ${r.dur}, max: ${r.max},\n    st: ${JSON.stringify(r.st)} },`).join('\n');

fs.writeFileSync(OUT,
`/* ============================================ REAL PASSIVE EQUIPMENT, FROM A LIVE SERVER
 *
 * GENERATED FILE - do not hand-edit. Regenerate with tools/cardgen/gen-equipment-real.js.
 *
 * The hull / engine / computer ladders as the original shipped them: ${rows.length} items, against the
 * twelve we authored by hand. Guids, loca keys, stat buffs, durability, max-per-ship and tylium
 * prices are all read from the dump. Systems whose buffs came back obfuscated are omitted, so
 * everything here does something when you fit it.
 *
 * Per family and tier: ${Object.keys(counts).sort().map(k => k + '=' + counts[k]).join(', ')}
 */
'use strict';
const EQUIPMENT_REAL = [
${body}
];

module.exports = { EQUIPMENT_REAL };
`);
console.log(`${rows.length} systems -> ${path.relative(process.cwd(), OUT)}`);
console.log(Object.keys(counts).sort().map(k => '  ' + k.padEnd(14) + counts[k]).join('\n'));
