/*
 * Emit ShipConfigTemplates for the escort/line/boss NPCs (the NPC_HEAVIES block in cards.js).
 *
 * A ShipConfigTemplate is what actually ARMS an NPC - without one, setupWeaponConfig returns
 * early and the ship is an unarmed punching bag. The upstream files (10-15, 34-39) cover the
 * strike NPCs; this writes one file per heavy NPC, slotting tier-matched guns into the hull's
 * real level-1 weapon slots from hulls-real.js, so the hardpoints always exist on the prefab.
 *
 * Carrier launcher slots get the missile launcher + ammo pair the strike configs already use
 * (271446462 / 17980086) - that is the bosses' "nuke" battery, and only carriers and the two
 * stealth hulls have launcher slots at all.
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

const CORE = process.env.BSGOCORE_PATH ? path.resolve(process.env.BSGOCORE_PATH) : path.resolve(__dirname, '../../BSGOCore');
const LIVE = path.join(CORE, 'ServerConfigurationUtils/global/ShipConfigTemplates');
const REPO = path.resolve(__dirname, '../../config/ShipConfigTemplates');

const LAUNCHER = 271446462, MISSILE_AMMO = 17980086;
const GUNS = { 2: [6001, 6002, 6003, 6004, 6005, 6006], 3: [6011, 6012, 6013, 6014, 6015, 6016], 4: [6021, 6022, 6023] };

// [guid, prefab, gunTier, npcLevel, faction]
const NPCS = [
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
    // 'gun' (6031), 'defensive_weapon' (6032/6033) and 'launcher'. The launcher pair stays on
    // the t1 missile launcher + ammo because that pairing is the one the upstream strike configs
    // prove actually fires; the t4 launcher cards' ammo binding is unverified.
    if (type === 'weapon') slotConfigs.push({ slotID: slotId, itemGUID: guns[g++ % guns.length] });
    else if (type === 'gun') slotConfigs.push({ slotID: slotId, itemGUID: 6031 });
    else if (type === 'defensive_weapon') slotConfigs.push({ slotID: slotId, itemGUID: [6032, 6033][d++ % 2] });
    else if (type === 'launcher') slotConfigs.push({ slotID: slotId, itemGUID: LAUNCHER, consumableGUID: MISSILE_AMMO });
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
