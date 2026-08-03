/*
 * Move a live player's saved items off guids the equipment pass retires.
 *
 * The problem this exists for: the server swallows a saved item whose card is gone. Fitted systems
 * go through SqLiteProvider.java:196-207, hold/locker systems through SqlLiteContainers.java:238-247
 * and :423-433, and all three catch the IllegalArgumentException that ShipSystem.fromGUID throws for
 * a missing card and only log.warn it. The item is simply absent on the next login - no message, no
 * refund, and nothing in the DB says it was ever there once the container is written back.
 *
 * Countables are worse, not better. ItemCountable.fromGUID never consults the catalogue (it only
 * rejects a negative count), so a retired countable guid survives the load and reaches the client,
 * where ItemCountable.Read does IsLoaded.Depend(Card) on a ShipConsumable card that never arrives.
 * There is no timeout on that. The hold spins forever.
 *
 * So: audit first, migrate second, and never guess at what is in the DB.
 *
 *   node tools/migrate-equipment-guids.js audit
 *   node tools/migrate-equipment-guids.js audit --write-snapshot
 *   node tools/migrate-equipment-guids.js migrate                 (dry run, prints the ledger)
 *   node tools/migrate-equipment-guids.js migrate --apply
 *
 * AUDIT is read-only against the DB. It derives the retired set by diffing every guid the DB
 * references against every guid the emitted catalogue carries - it does not carry a list of
 * "known bad" guids, because a hand-maintained list is exactly the thing that misses one.
 *
 * MIGRATE needs to know what a retired item WAS (slot type, tier, sell price) after its cards are
 * already gone, so audit writes a snapshot of the pre-pass catalogue and migrate reads identities
 * out of that. Take the snapshot BEFORE the retiring package runs or the migration has nothing to
 * price the refund against.
 *
 *   --db PATH        default server/sqlite/bgo_server.db
 *   --cards PATH     a JsonCards directory, a single card file, or the original-server dump; the
 *                    dump is how you rehearse a migration before the retiring package has landed
 *   --snapshot PATH  default tools/migrate-equipment-guids.snapshot.json
 *   --retire A,B,C   audit only: also treat these guids as retired, to preview a planned retirement
 *   --map OLD=NEW    override the automatic replacement pick
 *   --sql            print the statements instead of trusting the tool to run them
 *   --force          proceed past a missing pre-pass backup, a live-looking -wal, or a blocked row
 *
 * No new dependencies: node:sqlite ships with Node (>=22.5 behind --experimental-sqlite, unflagged
 * from 23.4). If the flag is missing this script re-execs itself with it.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/* node:sqlite is flagged on Node 22. Re-exec rather than making every caller remember the flag;
 * the guard env var stops that turning into a fork bomb if the module is missing for some other
 * reason. */
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  if (process.env.BSGO_MIGRATE_REEXEC) {
    console.error('node:sqlite is unavailable even with --experimental-sqlite. Node >= 22.5 required.');
    console.error(String(e && e.message));
    process.exit(2);
  }
  const r = require('child_process').spawnSync(
    process.execPath,
    ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', __filename, ...process.argv.slice(2)],
    { stdio: 'inherit', env: Object.assign({}, process.env, { BSGO_MIGRATE_REEXEC: '1' }) });
  process.exit(r.status === null ? 1 : r.status);
}

/* node:sqlite prints an ExperimentalWarning to stderr for each database handle it opens, and
 * --disable-warning does not catch every one of them. The whole point of this tool is that a human
 * reads its output before deciding to run it, so swallow that one warning and pass on any other. */
process.removeAllListeners('warning');
process.on('warning', w => {
  if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
  console.warn(w.stack || String(w));
});

/* ================================================================ ARGS */

const argv = process.argv.slice(2);
const MODE = (argv[0] && !argv[0].startsWith('--')) ? argv.shift() : 'audit';
const flag = n => argv.includes('--' + n);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };

const REPO = path.resolve(__dirname, '..');
const DB_PATH = path.resolve(opt('db', path.join(REPO, 'server/sqlite/bgo_server.db')));
const CARDS = path.resolve(opt('cards', path.join(REPO, 'server/ServerConfigurationUtils/global/JsonCards')));
const SNAPSHOT = path.resolve(opt('snapshot', path.join(__dirname, 'migrate-equipment-guids.snapshot.json')));
const PRE_PASS_BACKUP = path.join(REPO, 'server/sqlite/bgo_server.db.bak-before-equipment-pass');
const APPLY = flag('apply');
const AS_SQL = flag('sql');
const FORCE = flag('force');
const TYLIUM = 215278030;

// Extra guids to treat as retired on top of whatever the diff finds. This is how you preview a
// retirement that has not happened yet - pass the guids the retiring package is going to delete.
const EXTRA_RETIRED = new Set(
  String(opt('retire', '')).split(',').map(s => s.trim()).filter(Boolean).map(Number));

// old=new pairs that override the automatic pick. The automatic rule is deliberate but it is a
// rule, not a judgement; this is the escape hatch.
const OVERRIDES = new Map(
  String(opt('map', '')).split(',').map(s => s.trim()).filter(Boolean)
    .map(s => { const [a, b] = s.split('='); return [Number(a), Number(b)]; }));

if (!['audit', 'migrate'].includes(MODE)) {
  console.error(`unknown mode "${MODE}" - expected audit or migrate`);
  process.exit(2);
}

/* ================================================================ CATALOGUE */

/* What each kind of saved row needs before it is safe to load, and why.
 *
 * The server-side column is the view whose absence throws (or, for countables, does not throw and
 * should). The client-side ones come from the decompile: GameItemCard.Read fetches GUI + Price and
 * IsLoaded.Depend()s on both, so every ShipItem needs that pair whatever else it needs;
 * ShipSystem.cs:102 adds ShipSystem (and ShipPaint when SlotType is ship_paint);
 * ItemCountable.cs:29 adds ShipConsumable; HangarShip.cs:108-115 adds Ship and Camera. */
const REQUIRED_VIEWS = {
  system:    ['ShipSystem', 'GUI', 'Price'],
  countable: ['ShipConsumable', 'GUI', 'Price'],
  ship:      ['Ship', 'GUI', 'Price', 'Camera'],
  skill:     ['Skill'],
  counter:   ['Counter'],
};

/* Every guid-bearing column in the schema, with the card kind it names. Anything not listed here is
 * either not a card guid (avatar_items.item_id is a slot index, mails.mail_template_guid resolves
 * against MailTemplates/ not JsonCards) or has no guid at all. Keep this table honest: a column
 * added later and left out of it is a silent hole in the audit. */
const REF_COLUMNS = [
  { table: 'ship_systems',         col: 'guid',      kind: 'system',    pk: ['players_id', 'containers_id', 'server_id', 'guid'] },
  { table: 'shipSlots',            col: 'guid',      kind: 'system',    pk: ['players_id', 'ship_id', 'server_id'] },
  { table: 'item_countables',      col: 'guid',      kind: 'countable', pk: ['players_id', 'containers_id', 'server_id', 'guid'] },
  { table: 'players_hangar_ships', col: 'guid',      kind: 'ship',      pk: ['players_id', 'server_id', 'guid'] },
  { table: 'player_skills',        col: 'card_guid', kind: 'skill',     pk: ['player_id', 'server_id'] },
  { table: 'counters',             col: 'guid',      kind: 'counter',   pk: ['players_id', 'guid'] },
  // caps.guid names a currency (merits today). It is not fetched as a card on either side, but a
  // currency the catalogue stopped emitting is still a bug, so it is checked as a countable.
  { table: 'caps',                 col: 'guid',      kind: 'countable', pk: ['players_id', 'guid'], advisory: true },
  { table: 'player_missions',      col: 'mission_guid', kind: 'mission', pk: ['player_id', 'mission_id', 'mission_guid', 'counter_guid'], advisory: true },
  { table: 'player_missions',      col: 'counter_guid', kind: 'counter', pk: ['player_id', 'mission_id', 'mission_guid', 'counter_guid'], advisory: true },
];

const num = v => (typeof v === 'bigint' ? Number(v) : v);

/* Read a catalogue into  guid -> {views, slotType, tier, durability, key, sell, buy, consumableType}.
 *
 * Takes the emitted JsonCards directory, a single JSON file of emitted cards, or the original-server
 * card dump - the shape is sniffed per record, not assumed from the path. The dump is accepted
 * because the new catalogue is built FROM it, so pointing at the dump is how you plan a migration
 * before the retiring package has actually run. */
function loadCatalogue(target) {
  const st = fs.statSync(target);
  const files = st.isDirectory()
    ? fs.readdirSync(target).filter(f => f.endsWith('.json')).sort().map(f => path.join(target, f))
    : [target];
  if (!files.length) throw new Error(`no .json cards under ${target}`);
  const cat = new Map();
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    const arr = Array.isArray(raw) ? raw : raw.cards;
    if (!Array.isArray(arr)) throw new Error(`${f} is neither a card array nor a card dump`);
    for (const c of arr) ingest(cat, c);
  }
  // Only level 1 of an upgrade chain is a thing the shop sells or a migration should hand anybody;
  // the dump carries all 15 levels and our own ladder will carry 10.
  for (const m of cat.values()) if (m.views.has('ShipSystem') && m.level !== 1) m.midLadder = true;
  return cat;
}

function blankMeta(guid) {
  return { guid, views: new Set(), slotType: null, tier: null, durability: null, key: null,
           sell: {}, buy: {}, consumableType: null, level: null,
           restrictions: null, maxPerShip: null, objectKey: null };
}

/* One record, either shape. The dump nests fields under .fields, names the view .viewName, keeps
 * enums as {name, value} objects and prices as arrays of {guid, amount}; the emitted cards are flat,
 * name the view .cardView2, and use plain strings and guid->amount maps. Everything past this point
 * only ever sees the flat shape. */
function ingest(cat, c) {
  const dump = c.viewName !== undefined;
  const view = dump ? c.viewName : c.cardView2;
  const g = num(dump ? c.guid : c.cardGUID);
  if (view === undefined || g === undefined) return;
  const f = dump ? (c.fields || {}) : c;
  const en = v => (v && typeof v === 'object' ? v.name : v);
  const prices = p => {
    const out = {};
    if (!p || !p.items) return out;
    if (Array.isArray(p.items)) for (const it of p.items) out[String(num(it.guid))] = num(it.amount);
    else for (const [k, v] of Object.entries(p.items)) out[String(k)] = num(v);
    return out;
  };
  if (!cat.has(g)) cat.set(g, blankMeta(g));
  const m = cat.get(g);
  m.views.add(view);
  if (view === 'ShipSystem') {
    m.slotType = en(f.SlotType); m.tier = num(f.Tier);
    m.durability = num(f.Durability); m.level = num(f.Level);
    m.restrictions = (f.ShipObjectKeyRestrictions || []).map(num);
    m.maxPerShip = num(f.MaxCountPerShip);
  }
  if (view === 'Ship') m.objectKey = num(f.ShipObjectKey);
  if (view === 'ShipConsumable') { m.consumableType = num(f.ConsumableType); m.tier = num(f.Tier); }
  if (view === 'GUI' && m.key === null) m.key = f.Key || f.key || null;
  if (view === 'Price') {
    m.sell = prices(f.SellPrice); m.buy = prices(f.BuyPrice);
    if (m.tier === null) m.tier = num(f.Tier);
  }
}

const sellTylium = m => num((m.sell && (m.sell[TYLIUM] || m.sell[String(TYLIUM)])) || 0);

/* ================================================================ SNAPSHOT */

function writeSnapshot(cat, file) {
  const out = {
    _header: 'GENERATED FILE - do not hand-edit. Regenerate with tools/migrate-equipment-guids.js audit --write-snapshot.',
    _why: 'Identity of every card the catalogue emitted BEFORE the equipment pass retired anything. ' +
          'migrate mode prices refunds and matches slot/tier against this, because by then the retired cards are gone.',
    _takenAt: new Date().toISOString(),
    _source: path.relative(REPO, CARDS).replace(/\\/g, '/'),
    cards: {},
  };
  for (const [g, m] of [...cat].sort((a, b) => a[0] - b[0])) {
    out.cards[g] = {
      views: [...m.views].sort(), key: m.key, slotType: m.slotType, tier: m.tier,
      level: m.level, durability: m.durability, consumableType: m.consumableType,
      restrictions: m.restrictions, maxPerShip: m.maxPerShip, objectKey: m.objectKey,
      sell: m.sell, buy: m.buy,
    };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
  return Object.keys(out.cards).length;
}

function readSnapshot(file) {
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cat = new Map();
  for (const [g, v] of Object.entries(raw.cards || {})) {
    const m = blankMeta(Number(g));
    Object.assign(m, v, { views: new Set(v.views || []) });
    cat.set(Number(g), m);
  }
  return { meta: raw, cat };
}

/* ================================================================ DB READ */

/* Foreign keys stay OFF, and that is not laziness.
 *
 * ship_systems and item_countables both declare FOREIGN KEY (containers_id) REFERENCES containers(id),
 * but `containers` has no `id` column at all - its key is (container_types_id, players_id). SQLite
 * only notices a malformed FK when it has to check one, so with enforcement on, every write to
 * those tables fails with "foreign key mismatch". The server reaches this database through JDBC,
 * which leaves SQLite's default (off), so the schema has never been checked in anger. Turning it on
 * here would only make this script fail where the server succeeds. */
function openDb(readOnly) {
  if (!fs.existsSync(DB_PATH)) { console.error(`no database at ${DB_PATH}`); process.exit(2); }
  return new DatabaseSync(DB_PATH, { readOnly, enableForeignKeyConstraints: false });
}

function tableExists(db, name) {
  return db.prepare("select 1 from sqlite_master where type='table' and name=?").get(name) !== undefined;
}

/* Every row in the DB that names a card guid, flattened. guid 0 is skipped everywhere: an empty
 * ship slot stores 0 and SqLiteProvider.java:193 skips it before it ever reaches fromGUID. */
function collectRefs(db) {
  const refs = [];
  for (const spec of REF_COLUMNS) {
    if (!tableExists(db, spec.table)) continue;
    for (const row of db.prepare(`select * from "${spec.table}"`).all()) {
      const g = num(row[spec.col]);
      if (!g) continue;
      refs.push({ spec, guid: g, row });
    }
  }
  return refs;
}

const rowKey = (spec, row) => spec.pk.map(c => `${c}=${num(row[c])}`).join(' ');

/* ================================================================ AUDIT */

/* A reference is broken when the catalogue does not carry every view that reference needs. Missing
 * the whole guid and missing one view of it fail differently (silent drop vs infinite load), so both
 * are reported and the reason says which. */
function auditRefs(refs, cat) {
  const findings = [];
  for (const r of refs) {
    const m = cat.get(r.guid);
    const forced = EXTRA_RETIRED.has(r.guid);
    const need = REQUIRED_VIEWS[r.spec.kind];
    if (!need) continue;                      // mission guids etc: no card-view contract to check
    let missing;
    if (forced) missing = ['<retired by request>'];
    else if (!m) missing = ['<no card at all>'];
    else {
      missing = need.filter(v => !m.views.has(v));
      // A paint is a ShipSystem plus a ShipPaint card; the client depends on both.
      if (m.slotType === 'ship_paint' && !m.views.has('ShipPaint')) missing.push('ShipPaint');
      if (m.midLadder) missing.push('<mid-ladder card, not a level-1 item>');
    }
    if (missing.length) findings.push({ ref: r, meta: m || null, missing });
  }
  return findings;
}

function describe(m) {
  if (!m) return 'unknown item';
  const bits = [];
  if (m.key) bits.push(m.key);
  if (m.slotType) bits.push(`${m.slotType}/t${m.tier}`);
  else if (m.consumableType !== null && m.consumableType !== undefined) bits.push(`consumable ct=${m.consumableType}/t${m.tier}`);
  const s = sellTylium(m);
  if (s) bits.push(`sell ${s} tylium`);
  return bits.join('  ') || 'no metadata';
}

/* ================================================================ REPLACEMENT PLAN */

/* Which ships each retired guid is currently bolted to, as ShipObjectKeys.
 *
 * shipSlots.ship_id is the hangar slot, i.e. players_hangar_ships.server_id, and the ship's card
 * guid is on that row. A replacement has to be legal on those hulls or the player gets an item that
 * loads but can never be re-fitted: ShipSystemCard.isObjectKeyRestrictionsBlocked returns true when
 * the restriction set is non-empty and does not contain the hull's objKey. */
function fittedHulls(db, findings, cat) {
  const shipGuid = new Map();
  for (const r of db.prepare('select players_id, server_id, guid from players_hangar_ships').all())
    shipGuid.set(`${num(r.players_id)}/${num(r.server_id)}`, num(r.guid));
  const owned = new Map();                             // players_id -> Set of objKey
  for (const [k, g] of shipGuid) {
    const pid = Number(k.split('/')[0]);
    const m = cat.get(g);
    if (!owned.has(pid)) owned.set(pid, new Set());
    if (m && m.objectKey) owned.get(pid).add(m.objectKey);
  }
  const mustAdmit = new Map();                         // retired guid -> Set of objKey it is fitted to
  const inHold = new Map();                            // retired guid -> Set of players_id holding it loose
  for (const f of findings) {
    const { spec, guid, row } = f.ref;
    if (spec.table === 'shipSlots') {
      const g = shipGuid.get(`${num(row.players_id)}/${num(row.ship_id)}`);
      const m = g !== undefined ? cat.get(g) : null;
      if (!mustAdmit.has(guid)) mustAdmit.set(guid, new Set());
      if (m && m.objectKey) mustAdmit.get(guid).add(m.objectKey);
    } else if (spec.table === 'ship_systems') {
      if (!inHold.has(guid)) inHold.set(guid, new Set());
      inHold.get(guid).add(num(row.players_id));
    }
  }
  return { mustAdmit, inHold, owned };
}

/* Pick replacements family by family, where a family is one (SlotType, Tier) pair.
 *
 * Tier is not negotiable: a system's Tier must equal the active ship's tier exactly for it to be
 * equippable, so a tier-3 bay can only ever hold a tier-3 system. Slot type likewise - the bay is
 * what it is. Restrictions are the third hard filter, see fittedHulls above; without it the obvious
 * "cheapest weapon/t3" answer is a sentry-platform gun that no player hull can mount.
 *
 * Within what survives the rule is rank-preserving. Absolute prices are not comparable across the
 * two catalogues - ours were hand-scaled, the dump's are the original economy - but standing inside
 * a family is, so the retired item's price percentile among ALL its old family members (not just
 * the retired ones) is carried over to the new family. A player's best gun stays their best gun.
 * Where several retired items in one family would land on the same candidate they are spread out,
 * so two different items do not silently become the same item.
 *
 * Families with no candidate at all - weapon/t4 is the one this pass creates, because the original
 * game has no weapon bay on any tier-4 hull - cannot be remapped. Those items are refunded in
 * tylium at their own sell price, which is what the shop would have paid for them. */
function planReplacements(findings, oldCat, newCat, hulls) {
  const retiredGuids = [...new Set(findings.map(f => f.ref.guid))].sort((a, b) => a - b);
  const admits = (m, keys) => !m.restrictions || !m.restrictions.length
    || [...keys].every(k => m.restrictions.includes(k));

  const candidatesFor = (guid, slotType, tier) => {
    const need = hulls.mustAdmit.get(guid) || new Set();
    // A loose item in the hold is not bolted to anything, so nothing is strictly illegal - but an
    // item restricted to hulls its owner does not fly is dead weight, so those are excluded too.
    const owners = hulls.inHold.get(guid) || new Set();
    const flyable = new Set();
    for (const pid of owners) for (const k of (hulls.owned.get(pid) || [])) flyable.add(k);
    const legal = m => {
      if (need.size) return admits(m, need);
      if (!m.restrictions || !m.restrictions.length) return true;
      if (!owners.size) return true;                   // nothing known about who holds it
      return [...flyable].some(k => m.restrictions.includes(k));
    };
    return [...newCat.values()]
      .filter(m => !m.midLadder && m.slotType === slotType && m.tier === tier
                   && REQUIRED_VIEWS.system.every(v => m.views.has(v))
                   && !retiredGuids.includes(m.guid) && legal(m))
      .sort((a, b) => sellTylium(a) - sellTylium(b) || a.guid - b.guid);
  };

  // Percentile of a guid inside its own old (slotType, tier) family, by sell price.
  const oldFamilies = new Map();
  for (const m of oldCat.values()) {
    if (!m.slotType) continue;
    const k = `${m.slotType}/t${m.tier}`;
    if (!oldFamilies.has(k)) oldFamilies.set(k, []);
    oldFamilies.get(k).push(m);
  }
  for (const list of oldFamilies.values()) list.sort((a, b) => sellTylium(a) - sellTylium(b) || a.guid - b.guid);
  const percentile = m => {
    const list = oldFamilies.get(`${m.slotType}/t${m.tier}`) || [];
    if (list.length < 2) return 0.5;
    return list.findIndex(x => x.guid === m.guid) / (list.length - 1);
  };

  const families = new Map();
  for (const g of retiredGuids) {
    const m = oldCat.get(g);
    if (!m || !m.slotType) continue;                   // countables and unknowns handled below
    const k = `${m.slotType}/t${m.tier}`;
    if (!families.has(k)) families.set(k, []);
    families.get(k).push(m);
  }

  const plan = new Map();                              // retired guid -> {action, to, from, candidates}
  for (const [famKey, members] of families) {
    const [slotType, tierStr] = famKey.split('/t');
    members.sort((a, b) => percentile(a) - percentile(b) || a.guid - b.guid);
    const taken = new Set();
    members.forEach(m => {
      const forced = OVERRIDES.get(m.guid);
      const cands = candidatesFor(m.guid, slotType, Number(tierStr));
      if (forced !== undefined) {
        plan.set(m.guid, { action: 'remap', to: newCat.get(forced) || blankMeta(forced), from: m, candidates: cands, why: '--map override' });
        return;
      }
      if (!cands.length) {
        plan.set(m.guid, { action: 'refund', to: null, from: m, candidates: [],
                           why: `${famKey} has no surviving item this hull can mount` });
        return;
      }
      const p = percentile(m);
      let i = Math.round(p * (cands.length - 1));
      // Spread collisions outward so two distinct items do not both become the same one.
      if (taken.has(i) && taken.size < cands.length) {
        for (let d = 1; d < cands.length; d++) {
          if (i + d < cands.length && !taken.has(i + d)) { i += d; break; }
          if (i - d >= 0 && !taken.has(i - d)) { i -= d; break; }
        }
      }
      taken.add(i);
      plan.set(m.guid, { action: 'remap', to: cands[i], from: m, candidates: cands,
                         why: `price percentile ${(p * 100).toFixed(0)}% of ${famKey} -> candidate ${i + 1}/${cands.length}` });
    });
  }

  // Countables match on (ConsumableType, Tier) instead of (SlotType, Tier), same rank rule.
  const countables = retiredGuids.map(g => oldCat.get(g))
    .filter(m => m && !m.slotType && m.consumableType !== null && m.consumableType !== undefined);
  for (const m of countables) {
    const forced = OVERRIDES.get(m.guid);
    const cands = forced !== undefined ? [] : [...newCat.values()]
      .filter(c => c.consumableType === m.consumableType && c.tier === m.tier
                   && REQUIRED_VIEWS.countable.every(v => c.views.has(v))
                   && !retiredGuids.includes(c.guid))
      .sort((a, b) => sellTylium(a) - sellTylium(b) || a.guid - b.guid);
    if (forced !== undefined)
      plan.set(m.guid, { action: 'remap', to: newCat.get(forced) || blankMeta(forced), from: m, candidates: [], why: '--map override' });
    else if (cands.length)
      plan.set(m.guid, { action: 'remap', to: cands[0], from: m, candidates: cands, why: `nearest surviving ct=${m.consumableType}/t${m.tier}` });
    else
      plan.set(m.guid, { action: 'refund', to: null, from: m, candidates: [], why: `no surviving ct=${m.consumableType}/t${m.tier} consumable` });
  }

  // Anything left has no usable identity in the snapshot. Refuse rather than invent one.
  for (const g of retiredGuids) {
    if (plan.has(g)) continue;
    plan.set(g, { action: 'blocked', to: null, from: oldCat.get(g) || null, candidates: [],
                  why: 'no slot/tier or consumable identity in the snapshot - pass --map to say what it becomes' });
  }
  return plan;
}

/* ================================================================ LEDGER + WRITE */

/* Build the exact per-row edits. Fitted rows (shipSlots) are emptied rather than deleted when the
 * item is refunded - the row IS the bay, and deleting it would lose the slot. Hold rows are deleted,
 * because there the row IS the item. */
function buildEdits(findings, plan, db, oldCat) {
  const edits = [];
  const refunds = [];
  // Running total per merge target, so two source stacks folding into the same destination do not
  // both compute their new count from the same starting value and lose one of the two.
  const merged = new Map();
  for (const f of findings) {
    const { spec, guid, row } = f.ref;
    const p = plan.get(guid);
    if (spec.advisory) { edits.push({ kind: 'advisory', f, p }); continue; }
    if (!p || p.action === 'blocked') { edits.push({ kind: 'blocked', f, p }); continue; }

    if (p.action === 'remap') {
      const dur = p.to && p.to.durability !== null && p.to.durability !== undefined
        ? p.to.durability : num(row.durability);
      if (spec.table === 'shipSlots') {
        edits.push({ kind: 'update', f, p, sql: `UPDATE shipSlots SET guid=?, durability=? WHERE players_id=? AND ship_id=? AND server_id=?`,
                     args: [p.to.guid, dur, num(row.players_id), num(row.ship_id), num(row.server_id)] });
      } else if (spec.table === 'ship_systems') {
        edits.push({ kind: 'update', f, p, sql: `UPDATE ship_systems SET guid=?, durability=? WHERE players_id=? AND containers_id=? AND server_id=? AND guid=?`,
                     args: [p.to.guid, dur, num(row.players_id), num(row.containers_id), num(row.server_id), guid] });
      } else if (spec.table === 'item_countables') {
        // The target stack may already exist in this container; the PK is (player, container,
        // server_id, guid) so a blind UPDATE would either collide or leave two stacks of the same
        // thing. Merge into the existing row when there is one.
        const existing = db.prepare(
          'select server_id, count from item_countables where players_id=? and containers_id=? and guid=?')
          .get(num(row.players_id), num(row.containers_id), p.to.guid);
        if (existing) {
          const mk = `${num(row.players_id)}/${num(row.containers_id)}/${p.to.guid}`;
          const before = merged.has(mk) ? merged.get(mk) : num(existing.count);
          const after = clampCount(before + num(row.count));
          merged.set(mk, after);
          edits.push({ kind: 'update', f, p, merge: before,
                       sql: `UPDATE item_countables SET count=? WHERE players_id=? AND containers_id=? AND server_id=? AND guid=?`,
                       args: [after, num(row.players_id), num(row.containers_id), num(existing.server_id), p.to.guid] });
          edits.push({ kind: 'delete', f, p,
                       sql: `DELETE FROM item_countables WHERE players_id=? AND containers_id=? AND server_id=? AND guid=?`,
                       args: [num(row.players_id), num(row.containers_id), num(row.server_id), guid] });
        } else {
          edits.push({ kind: 'update', f, p, sql: `UPDATE item_countables SET guid=? WHERE players_id=? AND containers_id=? AND server_id=? AND guid=?`,
                       args: [p.to.guid, num(row.players_id), num(row.containers_id), num(row.server_id), guid] });
        }
      } else {
        edits.push({ kind: 'blocked', f, p, why: `no remap rule for table ${spec.table}` });
      }
      continue;
    }

    // refund
    const unit = sellTylium(p.from || oldCat.get(guid) || {});
    const qty = spec.table === 'item_countables' ? num(row.count) : 1;
    const amount = unit * qty;
    refunds.push({ players_id: num(row.players_id), amount, f, p, unit, qty });
    if (spec.table === 'shipSlots') {
      edits.push({ kind: 'update', f, p, refund: amount,
                   sql: `UPDATE shipSlots SET guid=0, durability=0 WHERE players_id=? AND ship_id=? AND server_id=?`,
                   args: [num(row.players_id), num(row.ship_id), num(row.server_id)] });
    } else if (spec.table === 'ship_systems') {
      edits.push({ kind: 'delete', f, p, refund: amount,
                   sql: `DELETE FROM ship_systems WHERE players_id=? AND containers_id=? AND server_id=? AND guid=?`,
                   args: [num(row.players_id), num(row.containers_id), num(row.server_id), guid] });
    } else if (spec.table === 'item_countables') {
      edits.push({ kind: 'delete', f, p, refund: amount,
                   sql: `DELETE FROM item_countables WHERE players_id=? AND containers_id=? AND server_id=? AND guid=?`,
                   args: [num(row.players_id), num(row.containers_id), num(row.server_id), guid] });
    } else {
      edits.push({ kind: 'blocked', f, p, why: `no refund rule for table ${spec.table}` });
    }
  }
  return { edits, refunds };
}

// ItemCountable clamps to a uint32 on every update (ItemCountable.java:60). Going over in the DB
// would silently lose the excess the first time the server touches the stack.
const COUNT_MAX = 4294967295;
const clampCount = n => Math.min(COUNT_MAX, Math.max(0, Math.round(n)));

/* Credits land on the player's existing tylium stack. If they somehow have none, a stack has to be
 * created, and it needs a server_id no other item in that container is using. */
function buildCredits(db, refunds) {
  const byPlayer = new Map();
  for (const r of refunds) byPlayer.set(r.players_id, (byPlayer.get(r.players_id) || 0) + r.amount);
  const out = [];
  for (const [pid, amount] of byPlayer) {
    if (!amount) continue;
    const HOLD = 1;
    const row = db.prepare('select server_id, count from item_countables where players_id=? and containers_id=? and guid=?')
      .get(pid, HOLD, TYLIUM);
    if (row) {
      const before = num(row.count), after = clampCount(before + amount);
      out.push({ pid, before, after, amount, clamped: before + amount !== after,
                 sql: 'UPDATE item_countables SET count=? WHERE players_id=? AND containers_id=? AND server_id=? AND guid=?',
                 args: [after, pid, HOLD, num(row.server_id), TYLIUM] });
    } else {
      const used = db.prepare('select server_id from item_countables where players_id=? and containers_id=?').all(pid, HOLD)
        .map(r => num(r.server_id));
      let sid = 0; while (used.includes(sid)) sid++;
      out.push({ pid, before: 0, after: clampCount(amount), amount, clamped: false, created: sid,
                 sql: 'INSERT INTO item_countables(players_id, containers_id, server_id, guid, count) VALUES (?,?,?,?,?)',
                 args: [pid, HOLD, sid, TYLIUM, clampCount(amount)] });
    }
  }
  return out;
}

function backup() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const made = [];
  for (const suffix of ['', '-wal', '-shm']) {
    const src = DB_PATH + suffix;
    if (!fs.existsSync(src)) continue;
    const dst = `${DB_PATH}.bak-migrate-${stamp}${suffix}`;
    fs.copyFileSync(src, dst);
    made.push(dst);
  }
  return made;
}

/* ================================================================ REPORT */

const line = s => process.stdout.write(s + '\n');
const rule = () => line('-'.repeat(96));

function reportFindings(findings, cat) {
  if (!findings.length) { line('No broken references. Every guid the DB names resolves to a complete card set.'); return; }
  const byGuid = new Map();
  for (const f of findings) {
    if (!byGuid.has(f.ref.guid)) byGuid.set(f.ref.guid, []);
    byGuid.get(f.ref.guid).push(f);
  }
  line(`${findings.length} broken row(s) across ${byGuid.size} guid(s):`);
  for (const [guid, list] of [...byGuid].sort((a, b) => a[0] - b[0])) {
    rule();
    const m = cat.get(guid);
    line(`guid ${guid}  ${describe(m)}`);
    line(`  missing: ${[...new Set(list.flatMap(f => f.missing))].join(', ')}`);
    const byTable = new Map();
    for (const f of list) {
      const k = f.ref.spec.table;
      if (!byTable.has(k)) byTable.set(k, []);
      byTable.get(k).push(f);
    }
    for (const [t, rows] of byTable) {
      line(`  ${t}: ${rows.length} row(s)${rows[0].ref.spec.advisory ? '  (advisory - not a card fetch)' : ''}`);
      for (const f of rows) line(`      ${rowKey(f.ref.spec, f.ref.row)}`);
    }
  }
  rule();
}

function reportPlan(plan, edits, refunds, credits) {
  line('');
  line('PLAN');
  rule();
  for (const [guid, p] of [...plan].sort((a, b) => a[0] - b[0])) {
    const from = p.from ? describe(p.from) : 'unknown';
    if (p.action === 'remap') {
      line(`${guid}  ${from}`);
      line(`   -> ${p.to.guid}  ${describe(p.to)}`);
      line(`      ${p.why}`);
      if (p.candidates.length > 1)
        line(`      candidates: ${p.candidates.map(c => `${c.guid}(${sellTylium(c)})`).join(' ')}`);
    } else if (p.action === 'refund') {
      line(`${guid}  ${from}`);
      line(`   -> REFUND ${sellTylium(p.from)} tylium each`);
      line(`      ${p.why}`);
    } else {
      line(`${guid}  ${from}`);
      line(`   -> BLOCKED: ${p.why}`);
    }
  }
  rule();
  line('LEDGER (per row, before -> after)');
  rule();
  for (const e of edits) {
    const { spec, guid, row } = e.f.ref;
    const where = `${spec.table}[${rowKey(spec, row)}]`;
    if (e.kind === 'advisory') { line(`SKIP    ${where} guid ${guid} - advisory column, not migrated`); continue; }
    if (e.kind === 'blocked') { line(`BLOCKED ${where} guid ${guid} - ${e.why || (e.p && e.p.why)}`); continue; }
    if (e.kind === 'delete')
      line(`DELETE  ${where}  guid ${guid}${e.refund ? `  refund ${e.refund} tylium` : ''}`);
    else if (e.merge !== undefined)
      line(`MERGE   ${where}  guid ${guid} count ${num(row.count)} into stack ${e.p.to.guid} (${e.merge} -> ${e.args[0]})`);
    else if (e.refund)
      line(`EMPTY   ${where}  guid ${guid} -> 0  refund ${e.refund} tylium`);
    else
      line(`REMAP   ${where}  guid ${guid} -> ${e.args[0]}  durability ${num(row.durability)} -> ${e.args[1] !== undefined ? e.args[1] : num(row.durability)}`);
  }
  for (const c of credits)
    line(`CREDIT  item_countables[players_id=${c.pid} containers_id=1 guid=${TYLIUM}]  ${c.before} -> ${c.after}  (+${c.amount})${c.clamped ? '  CLAMPED at uint32 max' : ''}${c.created !== undefined ? `  (new stack, server_id ${c.created})` : ''}`);
  if (!edits.length && !credits.length) line('nothing to do');
  rule();
  const totals = refunds.reduce((a, r) => a + r.amount, 0);
  line(`${edits.filter(e => e.kind === 'update' || e.kind === 'delete').length} row edit(s), ` +
       `${refunds.length} refunded item(s) worth ${totals} tylium, ` +
       `${edits.filter(e => e.kind === 'blocked').length} blocked`);
}

/* MaxCountPerShip is not enforced on the DB load path - SqLiteProvider drops the system straight
 * into the slot without going through ShipSlots.CanAdd - so an over-limit fit loads fine and then
 * cannot be rebuilt if the player ever unfits it. Worth saying out loud, not worth blocking on. */
function warnMaxPerShip(db, findings, plan) {
  const perShip = new Map();
  for (const f of findings) {
    if (f.ref.spec.table !== 'shipSlots') continue;
    const p = plan.get(f.ref.guid);
    if (!p || p.action !== 'remap') continue;
    const k = `${num(f.ref.row.ship_id)}/${p.to.guid}`;
    perShip.set(k, (perShip.get(k) || 0) + 1);
  }
  for (const [k, n] of perShip) {
    const [ship, guid] = k.split('/');
    const m = [...plan.values()].map(p => p.to).find(t => t && t.guid === Number(guid));
    if (m && m.maxPerShip && n > m.maxPerShip)
      line(`WARN  ship ${ship} would carry ${n} x ${guid} but MaxCountPerShip is ${m.maxPerShip} - ` +
           `it loads, but the player can never re-fit past ${m.maxPerShip}`);
  }
}

/* ================================================================ MAIN */

function main() {
  line(`db      ${DB_PATH}`);
  line(`cards   ${CARDS}`);
  const cat = loadCatalogue(CARDS);
  line(`catalogue: ${cat.size} guid(s)`);
  if (EXTRA_RETIRED.size) line(`--retire: additionally treating ${[...EXTRA_RETIRED].join(', ')} as retired`);
  line('');

  const db = openDb(MODE === 'audit');
  const refs = collectRefs(db);
  line(`DB references ${new Set(refs.map(r => r.guid)).size} distinct guid(s) across ${refs.length} row(s)`);
  const findings = auditRefs(refs, cat);
  line('');
  reportFindings(findings, cat);

  if (MODE === 'audit') {
    const want = flag('write-snapshot');
    if (want) {
      const n = writeSnapshot(cat, SNAPSHOT);
      line('');
      line(`snapshot: wrote ${n} guid(s) to ${SNAPSHOT}`);
    } else if (!fs.existsSync(SNAPSHOT)) {
      line('');
      line(`NOTE  no catalogue snapshot at ${SNAPSHOT}.`);
      line('      migrate mode needs one taken BEFORE the retiring package runs, to know what a');
      line('      retired item was worth. Take it now:  audit --write-snapshot');
    }
    db.close();
    process.exit(findings.some(f => !f.ref.spec.advisory) ? 1 : 0);
  }

  /* ---- migrate ---- */
  const snap = readSnapshot(SNAPSHOT);
  if (!snap) {
    console.error(`\nmigrate needs the pre-pass catalogue snapshot at ${SNAPSHOT}.`);
    console.error('It records what each retired item was and what it sold for; without it a refund');
    console.error('has no price and a remap has no slot type to match. Run audit --write-snapshot');
    console.error('against the catalogue as it stood before the retiring package.');
    db.close();
    process.exit(2);
  }
  line(`snapshot: ${Object.keys(snap.meta.cards || {}).length} guid(s), taken ${snap.meta._takenAt}`);

  const oldCat = new Map(snap.cat);
  for (const [g, m] of cat) if (!oldCat.has(g)) oldCat.set(g, m);   // items added after the snapshot
  const hulls = fittedHulls(db, findings, cat);
  const plan = planReplacements(findings, oldCat, cat, hulls);
  const { edits, refunds } = buildEdits(findings, plan, db, oldCat);
  const credits = buildCredits(db, refunds);
  reportPlan(plan, edits, refunds, credits);
  warnMaxPerShip(db, findings, plan);

  const blocked = edits.filter(e => e.kind === 'blocked');
  if (blocked.length && !FORCE) {
    console.error(`\n${blocked.length} row(s) have no plan. Resolve them with --map old=new, or pass --force`);
    console.error('to apply everything else and leave them broken.');
    db.close();
    process.exit(1);
  }

  const statements = [...edits.filter(e => e.sql), ...credits];
  if (AS_SQL) {
    line('');
    line('-- SQL, in order. Run inside a transaction against a backed-up database.');
    line('BEGIN;');
    for (const s of statements) line(inlineSql(s.sql, s.args) + ';');
    line('COMMIT;');
  }

  if (!APPLY) {
    line('');
    line('DRY RUN - nothing written. Re-run with --apply to commit.');
    db.close();
    process.exit(0);
  }

  if (!fs.existsSync(PRE_PASS_BACKUP) && !FORCE) {
    console.error(`\nrefusing to write: the pre-pass backup ${PRE_PASS_BACKUP} is missing.`);
    console.error('That backup is the only copy of the player state from before this whole pass.');
    db.close();
    process.exit(2);
  }
  if (fs.existsSync(DB_PATH + '-wal') && fs.statSync(DB_PATH + '-wal').size > 0 && !FORCE) {
    console.error('\nrefusing to write: a non-empty -wal file suggests the server is running.');
    console.error('Stop it first, or pass --force if you are certain it is not.');
    db.close();
    process.exit(2);
  }

  db.close();
  const made = backup();
  line('');
  for (const b of made) line(`backup  ${b}`);

  const w = new DatabaseSync(DB_PATH, { enableForeignKeyConstraints: false });
  w.exec('BEGIN IMMEDIATE');
  try {
    for (const s of statements) w.prepare(s.sql).run(...s.args);
    w.exec('COMMIT');
  } catch (e) {
    w.exec('ROLLBACK');
    w.close();
    console.error('\nrolled back: ' + (e && e.message));
    process.exit(1);
  }
  w.close();
  line(`applied ${statements.length} statement(s)`);
  line('Re-run  audit  to confirm the DB is clean; a second  migrate --apply  is a no-op.');
}

// Only for the --sql transcript. Every value here is a number we produced ourselves, but quote
// anything that is not so the output is never silently wrong.
function inlineSql(sql, args) {
  let i = 0;
  return sql.replace(/\?/g, () => {
    const v = args[i++];
    return typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
  });
}

main();
