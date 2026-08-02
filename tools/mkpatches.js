// Regenerate the public repo's patch set from the live BSGOCore working tree.
// One patch per logical change, so each can be read and applied on its own.
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

// BSGOCore checkout: override with BSGOCORE_PATH if it is not the in-repo clone.
const CORE = process.env.BSGOCORE_PATH ? path.resolve(process.env.BSGOCORE_PATH) : path.resolve(__dirname, '../BSGOCore');
const OUT = path.resolve(__dirname, '../patches');

const GROUPS = [
  ['0001-protocol-revision-4578', [
    'src/main/java/io/github/luigeneric/core/protocols/login/LoginProtocolWriteOnly.java']],
  ['0002-session-lifetime', [
    'src/main/java/io/github/luigeneric/core/player/login/SessionRegistry.java']],
  ['0003-sector-join-null-collider', [
    'src/main/java/io/github/luigeneric/core/sector/management/SectorJoinQueue.java']],
  ['0004-reusable-sessions', [
    'src/main/java/io/github/luigeneric/core/player/login/Session.java']],
  ['0005-scene-disconnect-location', [
    'src/main/java/io/github/luigeneric/core/protocols/scene/SceneProtocol.java']],
  ['0006-stat-or-default', [
    'src/main/java/io/github/luigeneric/core/protocols/game/GameProtocol.java',
    'src/main/java/io/github/luigeneric/core/movement/MovementController.java']],
  ['0007-persistence-and-shutdown', [
    'src/main/java/io/github/luigeneric/database/SqLiteProvider.java',
    'src/main/java/io/github/luigeneric/core/GameServer.java']],
  ['0008-launcher-module-binding', [
    'src/main/java/io/github/luigeneric/core/spaceentities/bindings/ShipBindings.java']],
  ['0009-mining-respawn-and-xp', [
    'src/main/java/io/github/luigeneric/core/sector/management/spawn/AsteroidResourceSpawn.java',
    'src/main/java/io/github/luigeneric/core/sector/management/lootsystem/loot/AsteroidLoot.java']],
  ['0010-shop-and-avatar-guards', [
    'src/main/java/io/github/luigeneric/core/player/container/visitors/ContainerVisitor.java',
    'src/main/java/io/github/luigeneric/core/protocols/shop/ShopProtocol.java',
    'src/main/java/io/github/luigeneric/core/protocols/player/PlayerProtocol.java']],
  ['0011-economy-tuning', [
    'src/main/resources/application.properties']],
  /* Outposts. Two independent changes, both about the same failure: an outpost that can never
   * appear and says nothing about it.
   *   OutpostSpawnTimer  - spawnOp's catch was empty, so a sector with no Outpost template of the
   *     requested faction retried every five seconds forever in total silence. Both base sectors
   *     were in that state from the start. Now logged once per faction, plus an info line on a
   *     successful spawn.
   *   SectorFactory      - setupOutpostStates seeded outpost points for two hardcoded sector ids.
   *     Generalised to the rule those two are instances of, so faction space shows its owner. */
  ['0012-outpost-spawn-diagnostics', [
    'src/main/java/io/github/luigeneric/core/sector/timers/OutpostSpawnTimer.java']],
  ['0013-outpost-seeding-from-star-flags', [
    'src/main/java/io/github/luigeneric/core/sector/creation/SectorFactory.java']],
];

fs.mkdirSync(OUT, { recursive: true });
// Drop stale patches so a renamed/removed group cannot linger.
for (const f of fs.readdirSync(OUT).filter(f => f.endsWith('.patch'))) fs.rmSync(path.join(OUT, f));

let n = 0;
for (const [name, files] of GROUPS) {
  const r = cp.spawnSync('git', ['diff', '--', ...files], { cwd: CORE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) { console.error('git diff failed for ' + name + ': ' + r.stderr); process.exit(1); }
  if (!r.stdout.trim()) { console.error('EMPTY diff for ' + name + ' - files unchanged?'); continue; }
  fs.writeFileSync(path.join(OUT, name + '.patch'), r.stdout);
  console.log(name + '.patch  (' + r.stdout.split('\n').length + ' lines)');
  n++;
}

// Every modified file must be covered by exactly one group, or a change ships undocumented.
const status = cp.spawnSync('git', ['diff', '--name-only'], { cwd: CORE, encoding: 'utf8' }).stdout
  .split('\n').map(s => s.trim()).filter(Boolean);
const covered = new Set(GROUPS.flatMap(g => g[1]));
const missed = status.filter(f => !covered.has(f));
if (missed.length) {
  console.error('\n*** UNCOVERED MODIFIED FILES ***\n  ' + missed.join('\n  '));
  process.exit(1);
}
console.log('\n' + n + ' patches, all ' + status.length + ' modified files covered');
