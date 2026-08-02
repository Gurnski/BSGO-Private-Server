// Negative test: prove the new validators actually fire, by breaking one thing at a time
// in a throwaway copy of cards.js and asserting the expected error surfaces.
const fs = require('fs');
const cp = require('child_process');
const path = require('path');

const SRC = path.join(__dirname, 'cards.js');
// Same resolution rule as cards.js: BSGOCORE_PATH overrides the in-repo default.
const CORE = process.env.BSGOCORE_PATH ? path.resolve(process.env.BSGOCORE_PATH) : path.resolve(__dirname, '../../server');
const TMP = path.join(__dirname, 'cards_negtest.js');
const orig = fs.readFileSync(SRC, 'utf8');

const cases = [
  // [label, find, replace, expected substring in stderr/stdout]
  // Rename a spot that HULL_SLOTS does NOT reference, so slotCards still resolves and the only
  // thing that changes is the objectPointName the World card emits.
  ['bad hardpoint name',
   "sticker1:                { hash: 45294, pos: V3(0, 0, 0), rot: QUAT(0, 1, 0, 0)",
   "bogus_sticker:           { hash: 45294, pos: V3(0, 0, 0), rot: QUAT(0, 1, 0, 0)",
   'is not a transform on'],
  ['CanBeSold with empty SellPrice',
   'SellPrice: price({ [TYLIUM]: Math.round(tyl / 4) }), CanBeSold: true,',
   'SellPrice: price({}), CanBeSold: true,',
   'CanBeSold with an empty SellPrice'],
  ['non-power-of-two fractional price',
   '{ [CUB]: 0.03125 }', '{ [CUB]: 0.03 }',
   'neither an integer nor a negative power of two'],
  // SlotId 30 exists in no layout at any level - the NRE this guard is built around.
  /* Anchored on the DUMP-fed slot path, not on HULL_SLOTS. HULL_SLOTS is now only the fallback for
   * the eleven non-flyable prefabs (rooms, outposts, platforms, capitals) - all 26 flyable hulls
   * take their slots from hulls-real.js, so a probe in the old table changed nothing and this test
   * quietly stopped testing anything. Shifting every slot id by 30 puts them all outside the
   * paperdoll's layout, which is the NRE this guard exists for. */
  ['slot with no big-paperdoll entry at that level',
   '      SlotId: id,\n      ObjectPoint: point,',
   '      SlotId: id + 30,\n      ObjectPoint: point,',
   'has no BIG layout entry at Level'],
  // A slot hash that no spot on the World card carries: the weapon silently never attaches.
  // slotCards() and spots() both read HARDPOINTS today, so the only way to make them disagree is
  // to skew one side - which is exactly the future divergence this guard exists to catch.
  ['slot hash with no matching spot',
   'ObjectPointServerHash: hp[point].hash,', 'ObjectPointServerHash: hp[point].hash + 50,',
   'has no spot on the World card'],
  // FTL must stay affordable. FtlCost is charged PER UNIT DISTANCE, so a plausible-looking
  // value strands players with no error shown anywhere.
  ['FTL cost strands players',
   'FtlCooldown: 35, FtlCost: 1,', 'FtlCooldown: 35, FtlCost: 100,',
   'of the 25000 starting grant'],
  // ShipList entries must be Level 1 - addShip refuses Level > 1 and returns silently.
  ['Level 2 hull listed in a ShipList',
   'ShipObjectKey: hull.objKey || guid, Level: adv ? 2 : 1, MaxLevel: 2,',
   'ShipObjectKey: hull.objKey || guid, Level: 2, MaxLevel: 2,',
   'but it is in a ShipList'],

  /* Ship without ShipLight is the defect that kept the two Tannhauser platforms from ever rendering.
   * Re-homing the ShipLight card to guid+1 leaves the Ship card without one, which is the shape of
   * the original bug. Fires: "Ship 1783473191: no ShipLight card at the same guid". */
  ['platform loses its ShipLight card',
   "out.push(card(p.guid, 'ShipLight', {",
   "out.push(card(p.guid + 1, 'ShipLight', {",
   'no ShipLight card at the same guid'],
  /* The server gates on ShipCard.getTier() and the client on ShipCardLight.Tier. A drift between them
   * produces no error anywhere at runtime, which is exactly why it needs a build failure. */
  ['ShipLight Tier drifts from the Ship card',
   "out.push(card(o.guid, 'ShipLight', {\n      ShipObjectKey: o.guid, Tier: OUTPOST_TIER,",
   "out.push(card(o.guid, 'ShipLight', {\n      ShipObjectKey: o.guid, Tier: 3,",
   'but ShipLight Tier'],
  /* Emptying the server-only allowlist makes the comet's NonShipStats(48) card the probe: it is the
   * one view we ship that CardFactory.CreateCard has no case for. Proves the view check fires and
   * documents that 48 is the single deliberate exemption. */
  ['card view the client cannot construct',
   'const SERVER_ONLY_VIEWS = new Set([48]);',
   'const SERVER_ONLY_VIEWS = new Set([]);',
   'has no CardFactory.CreateCard case'],
  /* A Sector card pointing at a Regulation guid with no card behind it is a boot crash
   * (SectorFactory.java:91-94, IllegalStateException out of the SectorRegistry constructor). */
  ['sector points at a Regulation card that does not exist',
   'regulationCardGuid: s.regGuid,',
   'regulationCardGuid: s.regGuid + 1,',
   'has no Regulation card'],
  /* Reverting the star-10 flags reproduces the pre-patch state, in which the outpost cards ship and
   * OutpostState.getDelta returns 0 forever so nothing spawns - silently, with no log line. */
  /* The star flags are derived in galaxy.js now, not written per sector, so the probe turns one
   * off at the point cards.js reads it. Every non-base sector carrying a Colonial Outpost template
   * then has that template with the flag off, which is the silent-forever case: getDelta returns 0
   * outright when canOutpost is false, so isOutPost() never becomes true and createOutpost is
   * never called - no error, no log line, just an outpost that never appears. */
  ['outpost template with the star flag off',
   'CanColonialOutpost: s.colOutpost,',
   'CanColonialOutpost: false,',
   'carries a Colonial Outpost template'],
  /* The bounds validator is only worth having if shrinking the card below its own template's
   * content is a build failure. width/length 8000 (half-extent 4000) puts sector 0's own asteroid
   * field - which reaches |z| 5064 - outside the card, and shrinks all 58 sectors at once. */
  ['sector card smaller than its own template content',
   'width: s.extent, height: s.extent, length: s.extent,',
   'width: 8000.0, height: s.extent, length: 8000.0,',
   "is outside sector 0's own half-extent"],
];

// Redirect emit so the negative test never writes into the real catalogue.
const OUTDIR = path.join(__dirname, 'negtest_out').replace(/\\/g, '/');
fs.mkdirSync(OUTDIR, { recursive: true });

let pass = 0;
for (const [label, find, repl, expect] of cases) {
  if (orig.indexOf(find) < 0) { console.log('SKIP (anchor gone): ' + label); continue; }
  let s = orig.replace(find, repl);
  s = s.replace(/const OUT = path\.join\(CORE, 'ServerConfigurationUtils\/global\/JsonCards'\);/,
                "const OUT = '" + OUTDIR + "';");
  fs.writeFileSync(TMP, s);
  // cards.js resolves CORE_ROOT from __dirname unless BSGOCORE_PATH is set, and this copy does
  // not live next to the checkout.
  const env = Object.assign({}, process.env,
    { BSGOCORE_PATH: CORE });
  const r = cp.spawnSync(process.execPath, [TMP], { encoding: 'utf8', env });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = out.indexOf(expect) >= 0;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok ? '' : '   <-- expected "' + expect + '"'));
  if (!ok) {
    console.log('      anchor replaced: ' + (s !== orig) + ', exit ' + r.status);
    console.log('      ---- output ----\n' + out.split('\n').slice(0, 25).map(l => '      ' + l).join('\n'));
  }
  if (ok) pass++;
}
// The loot/augment coverage guard reads real files off disk, so it needs a real (temporary) one.
// Written and removed in a try/finally so a failure here never leaves it in the server config.
const LOOTDIR = path.join(CORE, 'ServerConfigurationUtils/global/LootTemplates');
const PROBE = path.join(LOOTDIR, '99999_negtest_probe.json');
let total = cases.length + 1;
try {
  fs.writeFileSync(PROBE, JSON.stringify([{
    id: 99999, type: 'Damage', rewardCount: 1, experience: 1, chance: 1.0,
    lootEntryInfos: [{ chance: 1.0, levelIntervall: [0, 255], variationPercentage: 0,
      shipItem: { count: 1, cardGuid: 987654321, itemType: 'Countable' } }],
  }], null, 2));
  let s = orig.replace(/const OUT = path\.join\(CORE, 'ServerConfigurationUtils\/global\/JsonCards'\);/,
                       "const OUT = '" + OUTDIR + "';");
  fs.writeFileSync(TMP, s);
  const env = Object.assign({}, process.env,
    { BSGOCORE_PATH: CORE });
  const r = cp.spawnSync(process.execPath, [TMP], { encoding: 'utf8', env });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = out.indexOf('grants guid 987654321 but there is no') >= 0;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + 'loot template grants an unauthored guid');
  if (!ok) console.log(out.split('\n').slice(0, 20).map(l => '      ' + l).join('\n'));
  if (ok) pass++;
} finally {
  fs.rmSync(PROBE, { force: true });
  if (fs.existsSync(PROBE)) console.error('!!! FAILED TO REMOVE PROBE: ' + PROBE);
  else console.log('      (probe removed from LootTemplates)');
}

fs.rmSync(TMP, { force: true });
fs.rmSync(OUTDIR, { recursive: true, force: true });
console.log(pass + '/' + total + ' negative tests caught');
process.exit(pass === total ? 0 : 1);
