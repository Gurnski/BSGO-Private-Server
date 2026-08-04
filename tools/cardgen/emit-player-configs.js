/*
 * Emit ShipConfigTemplates for the PLAYER hulls, so the debug console's `spawn` command puts an
 * armed ship in space instead of a punching bag.
 *
 * setupWeaponConfig arms an NPC only from a ShipConfigTemplate matching its hull guid. The enemy
 * families have theirs (emit-npc-configs.js), the six capitals have hand-authored ones, and every
 * other player hull had nothing - so `spawn viper` produced a Viper that flew, aggroed and could
 * not shoot. These configs are for spawned NPC copies only; they never touch what a player fits.
 *
 * The hull table is READ FROM THE EMITTED CATALOGUE rather than listed here. A hardcoded list goes
 * stale the day a hull is added or a guid moves, and the failure is silent (a spawn that is quietly
 * unarmed). Every Ship card that is not an enemy family, a station or scenery gets a config.
 *
 * Output goes to BOTH the live server tree and the repo's config/ overlay, same rule as the
 * collider and loot templates. Idempotent - rerunning produces byte-identical files.
 *
 *   node tools/cardgen/emit-player-configs.js      (BSGOCORE_PATH overrides the checkout)
 *
 * Run it AFTER cards.js, since it reads what cards.js emitted.
 */
const fs = require('fs');
const path = require('path');
const { HULLS_REAL } = require('./hulls-real.js');
const { SYSTEMS_REAL } = require('./systems-real.js');

const CORE = process.env.BSGOCORE_PATH ? path.resolve(process.env.BSGOCORE_PATH) : path.resolve(__dirname, '../../server');
const JSONCARDS = path.join(CORE, 'ServerConfigurationUtils/global/JsonCards');
const LIVE = path.join(CORE, 'ServerConfigurationUtils/global/ShipConfigTemplates');
const REPO = path.resolve(__dirname, '../../config/ShipConfigTemplates');

const die = m => { console.error(m); process.exit(1); };

/* ---------------------------------------------------------------- the weapon pools
 * Derived from the catalogue exactly as emit-npc-configs.js derives them, and for the same
 * reason: a config naming a deleted guid is not a build error anywhere. ShipSystem.fromGUID
 * throws outside setupWeaponConfig's try, so the first player to fly into that sector eats it. */
const gunPool = tier => SYSTEMS_REAL
  .filter(r => r.slot === 'weapon' && r.tier === tier && r.ability
            && r.ability.actionType === 'FireCannon' && r.ability.launch === 'Auto'
            && !(r.levels[0].ab.add.MinRange > 0))
  .map(r => r.sys);
const GUNS = { 1: gunPool(1), 2: gunPool(2), 3: gunPool(3) };
for (const [t, g] of Object.entries(GUNS))
  if (!g.length) die(`no weapon/t${t} gun survives the pool filter`);

/* The two stealth hulls type their mounts 'gun' at tier 1 - the strike guns above are 'weapon'
 * and would not fit. All three stealth guns are Auto and have no minimum range. */
const STEALTH_GUNS = SYSTEMS_REAL
  .filter(r => r.slot === 'gun' && r.tier === 1 && r.ability && r.ability.launch === 'Auto')
  .map(r => r.sys);
if (!STEALTH_GUNS.length) die('no gun/t1 system survives the stealth pool filter');

/* Launchers. The capital battery (6034) is ConsumableOption NotUsing, so it needs no ammunition
 * entry; the tier-1 light launcher is Using and takes the ammo pair emit-npc-configs.js already
 * proves - cards.js validator G13b errors on a Using missile launcher without one. */
const CAP_LAUNCHER = 6034, LAUNCHER = 271446462, MISSILE_AMMO = 17980086;
const CAP_GUN = 6031, CAP_DEFENSIVE = [6032, 6033];

/* ---------------------------------------------------------------- the hull table
 * Ship cards, minus:
 *   enemy_*      - the NPC families, armed by emit-npc-configs.js
 *   station/scenery prefabs - outposts and platforms have hand-authored configs 200-207, and the
 *                  gate cruisers (guids 28/29, prefabs galactica/basestar) are sector furniture
 *                  spawned as Cruisers, not something `spawn` is meant to arm
 *   guids that already own a config - the six capitals, plus the two merit hulls whose NPC
 *                  configs (57/81) the any-level fallback already finds
 */
const ALREADY_CONFIGURED = new Set([57, 81, 5015, 5017, 5019, 5115, 5117, 5119]);
const SCENERY_PREFABS = new Set(['galactica', 'basestar']);

const all = [];
for (const f of fs.readdirSync(JSONCARDS).filter(f => f.endsWith('.json')))
  all.push(...JSON.parse(fs.readFileSync(path.join(JSONCARDS, f), 'utf8')));
if (!all.length) die(`no cards found in ${JSONCARDS} - run cards.js first`);

const worldByGuid = new Map(all.filter(c => c.cardView2 === 'World').map(c => [c.cardGUID, c]));
const keyByGuid = new Map(all.filter(c => c.cardView2 === 'GUI' && c.key).map(c => [c.cardGUID, c.key]));

const hulls = [];
for (const ship of all.filter(c => c.cardView2 === 'Ship')) {
  const guid = ship.cardGUID;
  const key = keyByGuid.get(guid) || '';
  const prefab = (worldByGuid.get(guid) || {}).prefabName;
  if (key.startsWith('enemy_')) continue;
  if (ALREADY_CONFIGURED.has(guid)) continue;
  if (!prefab || SCENERY_PREFABS.has(prefab)) continue;
  if (!HULLS_REAL[prefab]) continue;              // stations and anything without a slot table
  hulls.push({ guid, prefab, tier: ship.Tier, faction: String(ship.Faction).toLowerCase(), key });
}
if (!hulls.length) die('no player hulls resolved - has the catalogue changed shape?');

/* ---------------------------------------------------------------- ids
 * ShipConfigTemplate.id is a Java int. Two hulls (the Viper Mk II and its Advanced) carry guids
 * above 2^31, and Gson would throw reading them - taking the whole server down at boot rather
 * than failing one file. Those get a stable remap; everything else is its own guid, which is the
 * directory's convention. */
const INT_MAX = 2147483647;
const ID_REMAP = new Map([[2366349390, 2366], [2366649390, 302366]]);
const idFor = guid => {
  const id = ID_REMAP.has(guid) ? ID_REMAP.get(guid) : guid;
  if (id > INT_MAX) die(`hull ${guid} needs an ID_REMAP entry - ${id} overflows ShipConfigTemplate.id (int)`);
  return id;
};

// Ids owned by upstream, the station files, the capitals and the NPC configs. A collision is
// silent: ShipConfigs.putAll is a plain map put, so one of the two configs simply disappears.
const TAKEN = new Set([
  ...[10, 11, 12, 13, 14, 15, 34, 35, 36, 37, 38, 39, 100],
  ...[57, 60, 61, 62, 63, 64, 65, 81, 84, 85, 86, 87, 88, 89, 90, 91],
  ...[200, 201, 202, 203, 204, 205, 206, 207],
  ...[5015, 5017, 5019, 5115, 5117, 5119],
]);

let written = 0;
const usedIds = new Set();
for (const hull of hulls) {
  const slots = HULLS_REAL[hull.prefab].slots;
  const id = idFor(hull.guid);
  if (TAKEN.has(id)) die(`hull ${hull.guid} (${hull.prefab}) wants config id ${id}, which is already taken`);
  if (usedIds.has(id)) die(`config id ${id} emitted twice - the second would silently replace the first`);
  usedIds.add(id);

  let g = 0, s = 0, d = 0;
  const slotConfigs = [];
  for (const [slotId, type, , , slotLevel] of slots) {
    /* Level-2 mounts belong to the Advanced card, and these configs all declare level 1 - the
     * level the Owner card of every player hull carries, which is what createBotFighter arms
     * with. Arming a slot the spawned ship does not have fits nothing and warns. */
    if (slotLevel > 1) continue;

    if (type === 'weapon') {
      const pool = GUNS[hull.tier];
      if (!pool) die(`${hull.prefab}: tier ${hull.tier} has a weapon slot and no gun pool`);
      slotConfigs.push({ slotID: slotId, itemGUID: pool[g++ % pool.length] });
    }
    else if (type === 'gun') {
      slotConfigs.push({ slotID: slotId, itemGUID: hull.tier === 4 ? CAP_GUN : STEALTH_GUNS[s++ % STEALTH_GUNS.length] });
    }
    else if (type === 'defensive_weapon') {
      slotConfigs.push({ slotID: slotId, itemGUID: CAP_DEFENSIVE[d++ % CAP_DEFENSIVE.length] });
    }
    else if (type === 'launcher') {
      slotConfigs.push(hull.tier === 4
        ? { slotID: slotId, itemGUID: CAP_LAUNCHER }
        : { slotID: slotId, itemGUID: LAUNCHER, consumableGUID: MISSILE_AMMO });
    }
    /* 'special_weapon' is deliberately left empty. The one system of that type in the catalogue
     * is the anti-carrier nuke: MinRange 1,350, which WeaponAction enforces as a hard floor, so a
     * bot carrying it is mute against anything close enough to be fighting it. */
  }
  if (!slotConfigs.length) die(`${hull.prefab} (${hull.guid}) produced no armed slots`);

  const json = JSON.stringify([{ id, shipGUID: hull.guid, level: 1, slotConfigs }], null, 4) + '\n';
  const name = `${id}_${hull.prefab}.json`;
  for (const base of [LIVE, REPO]) {
    fs.mkdirSync(path.join(base, hull.faction), { recursive: true });
    fs.writeFileSync(path.join(base, hull.faction, name), json);
  }
  written++;
}

console.log(`gun pools: t1=${GUNS[1].length} t2=${GUNS[2].length} t3=${GUNS[3].length}, stealth guns=${STEALTH_GUNS.length}`);
console.log(`${written} player-hull configs written to the live tree and the config/ overlay`);
