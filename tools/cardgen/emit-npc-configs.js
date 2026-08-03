/*
 * Emit ShipConfigTemplates for the escort/line/boss NPCs (the NPC_HEAVIES block in cards.js).
 *
 * A ShipConfigTemplate is what actually ARMS an NPC - without one, setupWeaponConfig returns
 * early and the ship is an unarmed punching bag. The upstream files (10-15, 34-39) cover the
 * strike NPCs; this writes one file per heavy NPC, slotting tier-matched guns into the hull's
 * real level-1 weapon slots from hulls-real.js, so the hardpoints always exist on the prefab.
 *
 * Carrier launcher slots (server_ids 8/9, the two level-1 'launcher' rows on both t4carrier
 * hulls in hulls-real.js) get the capship launcher 6034 - the boss "nuke" battery. Only carriers
 * and the two stealth hulls have launcher slots at all; the strike-side merit hulls keep the
 * tier-1 missile launcher + ammo pair (271446462 / 17980086) their tier lock demands.
 *
 * Output goes to BOTH the live server tree and the repo's config/ overlay, same rule as the
 * collider and loot templates: ServerConfigurationUtils is gitignored upstream, so the overlay
 * is how these ship. Idempotent - rerunning produces byte-identical files.
 *
 *   node tools/cardgen/emit-npc-configs.js      (BSGOCORE_PATH overrides the checkout)
 */
const fs = require('fs');
const path = require('path');
const { HULLS_REAL } = require('./hulls-real.js');
const { SYSTEMS_REAL } = require('./systems-real.js');

const CORE = process.env.BSGOCORE_PATH ? path.resolve(process.env.BSGOCORE_PATH) : path.resolve(__dirname, '../../server');
const LIVE = path.join(CORE, 'ServerConfigurationUtils/global/ShipConfigTemplates');
const REPO = path.resolve(__dirname, '../../config/ShipConfigTemplates');

const LAUNCHER = 271446462, MISSILE_AMMO = 17980086;
// The capship launcher (600 dmg @ 3,900 m). Its ability is ConsumableOption NotUsing, so
// FireMissileAction takes the default-projectile branch and the slot needs no consumableGUID -
// unlike the t1 launcher above, whose Using ability demands the ammo pair (cards.js G13b).
const CAP_LAUNCHER = 6034;

/* The gun pool per tier, PICKED FROM THE CATALOGUE rather than listed here. The old table named
 * 6001-6023, eighteen hand-scaled weapons that no longer exist, and a config naming a deleted guid
 * is not a build error anywhere - ShipSystem.fromGUID throws at SpaceObjectFactory.java:698, which
 * sits OUTSIDE setupWeaponConfig's try, so the first player to fly into that sector takes the
 * exception. Deriving the pool means deleting an item can never leave a config pointing at it.
 *
 * The filter is narrow on purpose, and each clause is load-bearing:
 *   FireCannon   - the weapon/t3 pool also holds a point-defence bubble, a flak screen, a mining
 *                  laser and a 260-second-cooldown nuclear torpedo. None of those is a gun.
 *   Launch Auto  - NpcStaticTimer fires what the ship carries; a Manual launcher is a player
 *                  trigger and would sit idle on an NPC.
 *   MinRange 0   - WeaponAction.java:78-82 enforces MinRange as a HARD FLOOR, so the tier-2
 *                  anti-capital cannon (MinRange 500) would be unable to answer anything actually
 *                  attacking the ship.
 * Tier 4 is gone with the table: no t4 hull in NPCS below has a `weapon` slot, and the dump has no
 * weapon/t4 system to put in one if it did. The carriers use the capital types instead. */
const gunPool = tier => SYSTEMS_REAL
  .filter(r => r.slot === 'weapon' && r.tier === tier && r.ability
            && r.ability.actionType === 'FireCannon' && r.ability.launch === 'Auto'
            && !(r.levels[0].ab.add.MinRange > 0))
  .map(r => r.sys);
const GUNS = { 1: gunPool(1), 2: gunPool(2), 3: gunPool(3) };
for (const [t, g] of Object.entries(GUNS)) {
  if (!g.length) { console.error('no weapon/t' + t + ' gun survives the pool filter'); process.exit(1); }
  console.log('tier ' + t + ' gun pool (' + g.length + '): ' + g.join(', '));
}

// [guid, prefab, gunTier, npcLevel, faction]
const NPCS = [
  // The merit hulls fly in the strike wings but had no arming config - a third of every wing was unarmed.
  [57, 'humant1merit', 1, 15, 'colonial'],
  [81, 'cylont1merit', 1, 15, 'cylon'],
  [60, 'humant2fighter', 2, 25, 'colonial'], [61, 'humant2command', 2, 25, 'colonial'], [62, 'humant2defender', 2, 25, 'colonial'],
  [63, 'humant3fighter', 3, 45, 'colonial'], [64, 'humant3command', 3, 45, 'colonial'], [65, 'humant3defender', 3, 45, 'colonial'],
  [84, 'cylont2fighter', 2, 25, 'cylon'], [85, 'cylont2command', 2, 25, 'cylon'], [86, 'cylont2defender', 2, 25, 'cylon'],
  [87, 'cylont3fighter', 3, 45, 'cylon'], [88, 'cylont3command', 3, 45, 'cylon'], [89, 'cylont3defender', 3, 45, 'cylon'],
  [90, 'humant4carrier', 4, 120, 'colonial'],
  [91, 'cylont4carrier', 4, 120, 'cylon'],
];

let n = 0;
for (const [guid, prefab, tier, level, faction] of NPCS) {
  const hull = HULLS_REAL[prefab];
  if (!hull) { console.error('no hulls-real entry for ' + prefab); process.exit(1); }
  const guns = GUNS[tier];
  let g = 0, d = 0;
  const slotConfigs = [];
  for (const [slotId, type, , , slotLevel] of hull.slots) {
    if (slotLevel > 1) continue;                    // the server never instantiates these at level 1
    // Strike/escort/line hulls type their mounts 'weapon'; the carriers use the capital set:
    // 'gun' (6031 x4), 'defensive_weapon' (6032/6033 x2 each) and 'launcher' (6034 x2). The
    // bosses used to carry the t1 light launcher + ammo pair here because the t4 launcher's ammo
    // binding was unverified; 6034's ability ships NotUsing, which sidesteps ammo binding
    // entirely (see CAP_LAUNCHER above), so the bosses now fire the battery their hull was
    // built for. The merit hulls keep the proven t1 pair.
    if (type === 'weapon') {
      if (!guns) { console.error(prefab + ': tier ' + tier + ' has a weapon slot and no gun pool'); process.exit(1); }
      slotConfigs.push({ slotID: slotId, itemGUID: guns[g++ % guns.length] });
    }
    else if (type === 'gun') slotConfigs.push({ slotID: slotId, itemGUID: 6031 });
    else if (type === 'defensive_weapon') slotConfigs.push({ slotID: slotId, itemGUID: [6032, 6033][d++ % 2] });
    else if (type === 'launcher') slotConfigs.push(tier === 4
      ? { slotID: slotId, itemGUID: CAP_LAUNCHER }
      : { slotID: slotId, itemGUID: LAUNCHER, consumableGUID: MISSILE_AMMO });
  }
  if (!slotConfigs.length) { console.error(prefab + ' produced no armed slots'); process.exit(1); }
  const json = JSON.stringify([{ id: guid, shipGUID: guid, level, slotConfigs }], null, 4) + '\n';
  const name = guid + '_' + prefab + '_' + level + '.json';
  for (const base of [LIVE, REPO]) {
    fs.mkdirSync(path.join(base, faction), { recursive: true });
    fs.writeFileSync(path.join(base, faction, name), json);
  }
  console.log(name + '  (' + slotConfigs.length + ' slots armed)');
  n++;
}
console.log(n + ' NPC configs written to live tree and config/ overlay');
