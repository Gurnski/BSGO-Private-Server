/*
 * Extract the client's localisation table.
 *
 * Two outputs, deliberately separated:
 *
 *   1. tools/cardgen/loca-keys.txt      KEY NAMES only, lowercased, sorted.
 *      cards.js reads this to verify that every GUI card it authors points at a string the
 *      client can actually resolve. It is gitignored - derived from the Bigpoint client.
 *
 *   2. research/data/loca_values.json   the full key -> value map, keys in their REAL mixed
 *      case, values as shipped. This is the research dataset: the game documenting its own
 *      stat names, units, sector names and balance numbers. Also client-derived, also not
 *      for redistribution.
 *
 *   node tools/cardgen/extract-loca-keys.js "<client>/assetbundles/locale.lang_en"
 *
 * A missing key is not a crash - the client renders the raw "%$bgo.some.key.Name%" placeholder
 * where the item name should be, which is how "names have the raw text" bugs happen. The
 * validator turns that into a build failure instead.
 *
 * Requires `xz` on PATH (ships with Git for Windows; `apt install xz-utils` on Linux). The bundle
 * is a Unity 5 "UnityWeb" archive whose payload is LZMA-alone, which Node cannot decompress on
 * its own.
 *
 * WHY THIS WAS REWRITTEN
 * ----------------------
 * The old version scraped /bgo\.[A-Za-z0-9_.]+/ out of the raw decompressed bytes and threw the
 * values away. That regex is lossy in both directions:
 *   - it TRUNCATES the 780 keys that contain a space ("bgo.galaxymap.layout.colonial mines"
 *     came out as "bgo.galaxymap.layout.colonial"), so those keys could never validate; and
 *   - it INVENTS 3,065 entries that are not item keys at all - category names and the
 *     "%$bgo.x.y%" cross-references embedded inside other strings - which would let a dead GUI
 *     key pass validation if it happened to collide with a category name.
 * Parsing the XML properly yields exactly 14,055 real item keys and set-matches the
 * loca-keys.txt that is currently checked in, so cards.js sees no change.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');

const src = process.argv[2];
if (!src) {
  console.error('usage: node extract-loca-keys.js <path to locale.lang_en>');
  process.exit(2);
}

/* ------------------------------------------------------------------ unpack */
const buf = fs.readFileSync(src);
if (buf.subarray(0, 8).toString('latin1') !== 'UnityWeb') {
  console.error(src + ' does not start with "UnityWeb" - is that really the locale bundle?');
  process.exit(1);
}

// LZMA-alone header: 5 bytes of properties then an 8-byte uncompressed size. The two property
// bytes vary between builds, so look for either form rather than a fixed offset.
let at = buf.indexOf(Buffer.from([0x5d, 0, 0, 8, 0]));
if (at < 0) at = buf.indexOf(Buffer.from([0x5d, 0, 0, 1, 0]));
if (at < 0) { console.error('no LZMA-alone header found in ' + src); process.exit(1); }

const tmp = path.join(os.tmpdir(), 'bsgo-loca-' + process.pid + '.lzma');
fs.writeFileSync(tmp, buf.subarray(at));
const r = cp.spawnSync('xz', ['--format=lzma', '--decompress', '--stdout', '--single-stream', tmp],
                       { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 });
fs.rmSync(tmp, { force: true });
if (r.error || r.status !== 0) {
  console.error('xz failed: ' + (r.error ? r.error.message : (r.stderr || '').toString()));
  console.error('is xz on PATH?');
  process.exit(1);
}
const raw = r.stdout;

/* --------------------------------------------------------------- sectioning
 * The bundle holds seven Unity TextAssets, each a standalone XML document:
 * locale_layouts, locale_0..2, locale_dialogs, locale_cdb_objects, locale_sector_events.
 * TextAsset layout is <name len+bytes, align4><script len+bytes, align4>, so find each XML
 * declaration, read the int32 length that precedes it, then walk back over the alignment
 * padding to recover the asset name. */
function sections() {
  const latin = raw.toString('latin1');
  const out = [];
  let i = -1;
  while ((i = latin.indexOf('<?xml', i + 1)) >= 0) {
    if (i < 4) continue;
    const len = raw.readInt32LE(i - 4);
    if (len <= 0 || i + len > raw.length) continue;
    let j = i - 5;
    while (j > 0 && raw[j] === 0) j--;
    let name = '';
    while (j > 0) {
      const c = raw[j];
      if (c >= 32 && c < 127) { name = String.fromCharCode(c) + name; j--; } else break;
    }
    out.push({ name, offset: i, length: len, xml: raw.subarray(i, i + len).toString('utf8') });
  }
  return out;
}

/* ------------------------------------------------------------------ parsing
 * <language><category name=".."><item name=".."><![CDATA[..]]></item></category></language>
 *
 * Items carry attributes beyond name (comment="Max characters: 60" on 1,178 of them) and 275
 * are self-closing - an empty string in the shipped locale. Match the whole attribute blob and
 * pull `name` out of it; keying off `name="..."` immediately followed by `>` silently drops
 * every annotated item. */
const ITEM_RE = /<item\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/item>)/g;
const CAT_OPEN_RE = /<category\s+([^>]*?)>/g;
const NAME_RE = /(?:^|\s)name\s*=\s*"([^"]*)"/;

/* Categories are delimited by the NEXT <category> open tag, not by </category>.
 * locale_layouts ships 110 opens against 109 closes - "bgo.EquipBuyPanel.DetailsWindow.
 * gui_upgradebar_tooltip_layout" is never closed. Requiring a close tag makes an earlier
 * category swallow that block and silently drops one category from the census. Item keys are
 * fully qualified, so no VALUES are lost either way, but the category list has to be right:
 * locale_cdb_objects' category list is the object-card catalogue. */
function splitCategories(xml) {
  const opens = [];
  CAT_OPEN_RE.lastIndex = 0;
  let m;
  while ((m = CAT_OPEN_RE.exec(xml)) !== null) opens.push({ attrs: m[1], bodyStart: m.index + m[0].length, tagStart: m.index });
  return opens.map((o, i) => {
    const end = i + 1 < opens.length ? opens[i + 1].tagStart : xml.length;
    let body = xml.slice(o.bodyStart, end);
    const close = body.lastIndexOf('</category>');
    return { attrs: o.attrs, body: close >= 0 ? body.slice(0, close) : body, closed: close >= 0 };
  });
}

const unescapeXml = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, '&');

function itemValue(inner) {
  const m = inner.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1] : unescapeXml(inner.trim());
}

const secs = sections();
const entries = new Map();               // real mixed-case key -> value
const categories = {};                   // section -> [category name]
const perSection = [];
const anomalies = [];

for (const s of secs) {
  let cats = 0, items = 0;
  const catNames = [];
  for (const cm of splitCategories(s.xml)) {
    const cn = cm.attrs.match(NAME_RE);
    if (!cn) anomalies.push({ section: s.name, why: 'category without a name attribute', snippet: cm.attrs.slice(0, 120) });
    else catNames.push(cn[1]);
    if (!cm.closed) anomalies.push({ section: s.name, why: 'category is never closed in the shipped XML - delimited by the next <category> instead', category: cn ? cn[1] : null });
    cats++;
    ITEM_RE.lastIndex = 0;
    let im;
    while ((im = ITEM_RE.exec(cm.body)) !== null) {
      const nm = im[1].match(NAME_RE);
      if (!nm) { anomalies.push({ section: s.name, why: 'item without a name attribute', snippet: im[0].slice(0, 120) }); continue; }
      const key = nm[1];
      const val = im[2] === undefined ? '' : itemValue(im[2]);
      if (entries.has(key) && entries.get(key) !== val) {
        anomalies.push({ section: s.name, why: 'duplicate key with a different value', key, kept: entries.get(key), dropped: val });
      }
      entries.set(key, val);
      items++;
    }
  }
  // Every <item that the regexes did not consume is data we would be silently discarding.
  const rawItems = (s.xml.match(/<item\s/g) || []).length;
  if (rawItems !== items) anomalies.push({ section: s.name, why: 'unparsed <item> elements', expected: rawItems, parsed: items });
  const rawCats = (s.xml.match(/<category\s/g) || []).length;
  if (rawCats !== cats) anomalies.push({ section: s.name, why: 'unparsed <category> elements', expected: rawCats, parsed: cats });
  categories[s.name] = catNames;
  perSection.push({ name: s.name, bytes: s.length, categories: cats, items });
}

/* ------------------------------------------------------------------ outputs */
const keysOut = path.resolve(__dirname, 'loca-keys.txt');
const keys = [...new Set([...entries.keys()].map(k => k.toLowerCase()))].sort();
fs.writeFileSync(keysOut, keys.join('\n') + '\n', 'utf8');

const dataDir = path.resolve(__dirname, '..', '..', 'research', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const valuesOut = path.join(dataDir, 'loca_values.json');
fs.writeFileSync(valuesOut, JSON.stringify({
  _meta: {
    source: path.basename(src),
    source_path: src,
    generated_by: 'tools/cardgen/extract-loca-keys.js',
    generated_utc: new Date().toISOString(),
    note: 'Keys are the client\'s real mixed case. cards.js lowercases on lookup; loca-keys.txt ' +
          'is the lowercased key set of exactly these entries.',
    total_keys: entries.size,
    total_categories: Object.values(categories).reduce((a, v) => a + v.length, 0),
    sections: perSection,
    anomalies,
  },
  // Section -> its <category> names, in document order. locale_cdb_objects' 3,047 categories are
  // the real game's object-card catalogue; a category can exist with fields this flat map cannot
  // round-trip, so carry the list explicitly rather than re-deriving it from key prefixes.
  categories,
  values: Object.fromEntries([...entries.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
}, null, 1), 'utf8');

console.log(keys.length + ' keys -> ' + keysOut);
console.log(entries.size + ' key/value pairs -> ' + valuesOut);
for (const s of perSection) console.log('  ' + s.name.padEnd(22) + ' cat=' + String(s.categories).padStart(5) + ' items=' + String(s.items).padStart(5));
if (anomalies.length) console.warn(anomalies.length + ' anomaly/anomalies recorded in _meta.anomalies');
