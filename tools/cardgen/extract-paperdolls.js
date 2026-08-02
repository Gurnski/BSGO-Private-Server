/*
 * Pull every ship paperdoll layout out of resources.assets.
 *
 * They are Unity TextAssets: a length-prefixed name, 4-byte-aligned padding, then a
 * length-prefixed UTF-8 body - so the JSON starts within a few bytes of the name. Each name also
 * appears elsewhere (asset reference tables), and those occurrences are followed by some OTHER
 * asset's body, which is how a naive "next {" pairs ship_raider with prometheus. So: try every
 * occurrence, require the '{' to be close, and require the parsed body to actually be a paperdoll.
 */
const fs = require('fs');
const path = require('path');

// Your client's resources.assets. The client is not part of this repo.
const RES = process.argv[2] || process.env.BSGO_RESOURCES;
if (!RES) {
  console.error('Usage: node extract-paperdolls.js <client>/bsgo_Data/resources.assets');
  process.exit(1);
}
const OUT = path.join(__dirname, 'paperdolls');
const blob = fs.readFileSync(RES).toString('latin1');
const MAX_GAP = 24;          // name end -> '{'

function balancedFrom(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) return s.slice(open, i + 1); }
  }
  return null;
}

function parseLoose(txt) {
  try { return JSON.parse(txt); } catch (e) {}
  // Some layouts use single quotes / trailing commas / unquoted keys.
  let t = txt.replace(/,(\s*[}\]])/g, '$1').replace(/'/g, '"')
             .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
  try { return JSON.parse(t); } catch (e) { return null; }
}

const names = new Set();
for (const m of blob.matchAll(/ship_[a-z0-9_]+_paperdoll_layouts/g)) names.add(m[0]);

fs.mkdirSync(OUT, { recursive: true });
const rows = [];
let ok = 0;
for (const name of [...names].sort()) {
  let found = null, at = -1;
  while ((at = blob.indexOf(name, at + 1)) >= 0) {
    const open = blob.indexOf('{', at + name.length);
    if (open < 0 || open - (at + name.length) > MAX_GAP) continue;
    const body = balancedFrom(blob, open);
    if (!body || body.indexOf('Paperdoll') < 0) continue;
    const j = parseLoose(body);
    if (!j) { rows.push([name, 'UNPARSEABLE', '', '']); found = 'bad'; break; }
    found = j;
    break;
  }
  if (!found) { rows.push([name, 'NOT FOUND', '', '']); continue; }
  if (found === 'bad') continue;

  fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(found, null, 2));
  ok++;
  const small = found.PaperdollLayoutSmall || {};
  const big = found.PaperdollLayoutBig || {};
  const lv = o => (o.UpgradeLevels || []).map(u =>
    u.Level + ':[' + (u.SlotLayouts || []).map(s => s.SlotId).join(',') + ']').join(' ');
  rows.push([name, small.BlueprintTexture || big.BlueprintTexture || '?', lv(small), lv(big)]);
}

console.log(ok + '/' + names.size + ' layouts extracted\n');
console.log('LAYOUT'.padEnd(46) + 'PREFAB'.padEnd(18) + 'SMALL slot ids by level');
for (const [n, tex, sm] of rows)
  console.log(n.replace(/_paperdoll_layouts$/, '').padEnd(46) + String(tex).padEnd(18) + sm);
