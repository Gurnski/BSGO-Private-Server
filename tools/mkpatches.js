// Regenerate the public repo's patch set from the live BSGOCore working tree.
// One patch per logical change, so each can be read and applied on its own.
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// BSGOCore checkout: override with BSGOCORE_PATH if it is not the in-repo clone.
const CORE = process.env.BSGOCORE_PATH ? path.resolve(process.env.BSGOCORE_PATH) : path.resolve(__dirname, '../BSGOCore');
const OUT = path.resolve(__dirname, '../patches');

// The baseline is gitignored, so a fresh checkout does not have it. Refuse before touching
// anything: every diff below needs it, and patches/ must survive a run that cannot succeed.
if (!fs.existsSync(path.join(CORE, '.git'))) {
  console.error('BSGOCore checkout not found at ' + CORE +
    ' - clone it first (PATCHES.md "Regenerating") or point BSGOCORE_PATH at it.');
  process.exit(1);
}

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
  /* The ability-dispatch arms and the armour algorithm ship together because they are one
   * decision: the dump systems this unblocks are weapons, and half of what a weapon does is
   * decided by the armour curve. ContainerVisitor's tuning-kit guard is NOT here - it is a shop
   * guard and belongs with the other three in 0010, where that file already lives. */
  ['0014-ability-dispatch-and-armour', [
    'src/main/java/io/github/luigeneric/core/sector/management/abilities/AbilityActionFactory.java',
    'src/main/java/io/github/luigeneric/core/sector/management/abilities/actions/FireCannonAction.java',
    'src/main/java/io/github/luigeneric/core/sector/management/abilities/actions/FireMissileAction.java',
    'src/main/java/io/github/luigeneric/core/sector/management/abilities/actions/FlakAction.java',
    'src/main/java/io/github/luigeneric/core/sector/management/SectorAlgorithms.java']],
  /* 0015-0020 back-fill. These fifteen files were changed in earlier sessions and never added
   * here, so the coverage check below had been failing since - which is also why patches/ was
   * stale for 0008, 0010 and 0012. Grouped by theme; a file can only sit in one group, so where
   * a file carries two threads (Galaxy) the patch note says so. */
  ['0015-galaxy-update-payload', [
    'src/main/java/io/github/luigeneric/core/galaxy/Galaxy.java']],
  ['0016-capital-rental', [
    'src/main/java/io/github/luigeneric/core/player/Hangar.java',
    'src/main/java/io/github/luigeneric/core/protocols/dialog/DialogProtocol.java',
    'src/main/java/io/github/luigeneric/core/protocols/player/CapitalRental.java']],
  ['0017-npc-combat', [
    'src/main/java/io/github/luigeneric/core/sector/SpaceObjectFactory.java',
    'src/main/java/io/github/luigeneric/core/sector/timers/NpcTimer.java',
    'src/main/java/io/github/luigeneric/core/sector/timers/NpcDynamicTimer.java',
    'src/main/java/io/github/luigeneric/core/sector/timers/NpcStaticTimer.java',
    'src/main/java/io/github/luigeneric/core/sector/timers/MiningShipNpcAssassinTimer.java',
    'src/main/java/io/github/luigeneric/core/sector/management/spawn/DynamicNpcSpawn.java',
    'src/main/java/io/github/luigeneric/templates/npcbehaviour/NpcBehaviourTemplates.java',
    'src/main/java/io/github/luigeneric/core/sector/management/abilities/AbilityCastRequestQueue.java']],
  ['0018-outpost-death-and-loot', [
    'src/main/java/io/github/luigeneric/core/sector/management/damage/DamageMediator.java',
    'src/main/java/io/github/luigeneric/core/sector/management/lootsystem/LootDistributorUtil.java',
    'src/main/java/io/github/luigeneric/core/sector/management/lootsystem/claims/LootClaimHolder.java',
    'src/main/java/io/github/luigeneric/core/sector/management/SpaceObjectRemover.java']],
  ['0019-collision-resolution', [
    'src/main/java/io/github/luigeneric/core/sector/collision/CollisionResolution.java']],
  ['0020-debug-console', [
    'src/main/java/io/github/luigeneric/core/protocols/debug/DebugProtocol.java',
    'src/main/java/io/github/luigeneric/core/spaceentities/statsinfo/stats/SpaceSubscribeInfo.java']],
  /* Missile interception. The rest of the feature lives in files other groups already own -
   * FireMissileAction (0014) reads the warhead override, DamageMediator (0018) emits Hit for a
   * shot-down missile, SpaceObjectFactory (0017) drops the missile loot association - and in
   * card data (Regulation target masks, warhead MissileHullPoints). This group carries the one
   * file no other group covers: the server-only card field the warhead override reads. */
  ['0021-missile-interception', [
    'src/main/java/io/github/luigeneric/templates/cards/ShipConsumableCard.java']],
  /* Room NPCs. The talk handler accepted two hardcoded names, so every other character standing
   * in the CIC and outpost scenes was unclickable even once the Room cards listed them - and the
   * outpost rooms listed nobody at all, which put the flagship rental out of reach anywhere but
   * the home CIC. The cast list itself is card data (cards.js ROOMS/NPC_GUI). */
  ['0022-room-npcs', [
    'src/main/java/io/github/luigeneric/core/protocols/room/RoomProtocol.java']],
  /* Water for cubits. The exchange is the original's only player-controlled cubit faucet and the
   * only sink for mined water; upstream reserved the WaterExchangeValues message id and never
   * sent it, so the client's %WaterAmountExchange% placeholders had nothing to read. The dialogue
   * side lives in DialogProtocol, which 0016 already owns. */
  ['0023-water-exchange', [
    'src/main/java/io/github/luigeneric/core/protocols/player/PlayerProtocolWriteOnly.java']],
];

// A brand-new source file in the baseline working tree is invisible to `git diff` until it
// carries intent-to-add, so it would ship in no patch and the coverage check would not notice.
// CapitalRental.java did exactly that. Stage intent-to-add first; the diff then emits a proper
// new-file patch and the coverage check sees the path.
cp.spawnSync('git', ['add', '-N', '--', 'src'], { cwd: CORE });

// Diffs are staged in a temp directory and only replace patches/ after every group has
// diffed cleanly and the coverage check has passed. A run that dies part-way through must
// leave the existing set exactly as it found it.
const STAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'mkpatches-'));

let n = 0;
for (const [name, files] of GROUPS) {
  const r = cp.spawnSync('git', ['diff', '--', ...files], { cwd: CORE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) { console.error('git diff failed for ' + name + ': ' + r.stderr); process.exit(1); }
  if (!r.stdout.trim()) { console.error('EMPTY diff for ' + name + ' - files unchanged?'); continue; }
  fs.writeFileSync(path.join(STAGE, name + '.patch'), r.stdout);
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

// Everything checked out: swap the staged set in. Dropping the old files only now is what
// lets a renamed/removed group disappear without a failed run ever emptying patches/.
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT).filter(f => f.endsWith('.patch'))) fs.rmSync(path.join(OUT, f));
for (const f of fs.readdirSync(STAGE)) fs.copyFileSync(path.join(STAGE, f), path.join(OUT, f));
fs.rmSync(STAGE, { recursive: true, force: true });
console.log('\n' + n + ' patches, all ' + status.length + ' modified files covered');
