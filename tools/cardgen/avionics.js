/* ================================ AVIONICS AND THE C-31 ROLE MODULE - HAND-AUTHORED
 *
 * HAND-AUTHORED FILE. There is no generator for this one and there cannot be: the 14,223-card
 * dump contains ZERO avionics ShipSystem cards and no tier-2 role card, so there is nothing to
 * transcribe. Everything here is reconstructed from the client's own localisation strings, the
 * wiki, the dev blogs and the server code that consumes these cards. Every number carries the
 * reason it is that number; if you change one, change its comment too.
 *
 * WHY THE DUMP IS EMPTY, AND WHY THAT IS NOT EVIDENCE OF ABSENCE
 *   avionics: ShopProtocol.java:258-262 stocks an avionics module only while the player does NOT
 *     already own one (`hasAlreadyInHoldLockerSlot`). The pilot whose session produced the dump
 *     owned theirs, so the shop never sent the cards and the dump never saw them. The slot itself
 *     is real - 34 avionics bays across the roster, all tier 1 - and 14 loca families
 *     (7 hull roles x {basic, combat}) are live in the client bundle with .name, .namecylon,
 *     .description and .shortdescription. Dev Blog 8 ("How Do I Choose a Control Scheme?")
 *     describes both modules and says "There is a module for each ship in the game."
 *   role/t2: the dump's only role family is the tier-4 Spawn Mode module. The C-31 is documented
 *     on the wiki, its loca key resolves, and the two hulls that carry a role/t2 bay
 *     (humant2defender / cylont2defender = Maul / Wraith) are exactly the ships the wiki names.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *   BAMS (the six `system_avionics_*_basic` keys). SpaceObjectFactory.java:303-308 checks only
 *     `getAvionicSlot().isPresent()` and then grants ShipAspect.Dogfight, which the client turns
 *     into FlightMode.Cams. Nothing anywhere looks at WHICH avionics card is fitted. A BAMS item
 *     would therefore promise classic controls in its tooltip and hand the player mouse controls
 *     instead. Six items that lie is worse than six items that do not exist. Fitting nothing at
 *     all already gives you the classic controls BAMS advertises.
 *   role/t1 Stealth and role/t4 Fortify. Both are real - `research/bsgo_wiki/Raven Mark VI-R.txt`
 *     :42-52,85 documents Stealth Mode with its own 10-level merit ladder, and the dump ships the
 *     Fortify role card (395660941) - but both are TOGGLE abilities, and the toggle-ability
 *     subsystem does not exist here: AbilityActionFactory has no Fortify case and constructing one
 *     throws IllegalArgumentException. Faking them as passive stat items would put a button in the
 *     UI that does nothing. Eight player-flyable role bays stay empty until that subsystem lands.
 *
 * RESTRICTIONS. Every record carries `ourRestrictions`, the ShipObjectKeys of the hulls the item
 * belongs to, and every record must still be EMITTED with `ShipObjectKeyRestrictions: []` until the
 * identity-card work lands. The server compares the list against the active ship's objKey
 * (ContainerVisitor.java:134-135) but the CLIENT fetches a full Ship card at every entry
 * (ShipSystemCard.cs:99-102) and blocks the parent card's IsLoaded on it. Our t1/t2 hull objKeys
 * have no card at that guid yet, and a card that never arrives is an infinite loading screen, not
 * an error - the client has no timeout. Base and Advanced hulls share one objKey (ADVANCED_HULLS
 * copies `objKey` and only bumps the guid), so one entry per family covers both.
 */
'use strict';

/* ---------------------------------------------------------------- CAMS AVIONICS, TIER 1
 *
 * Six modules, one per t1 hull family we fly. `recon` (Raptor FR / Heavy Raider FR) is skipped
 * because humant1scout / cylont1scout are not in the roster - shipping a module for a ship nobody
 * can buy just clutters the shop.
 *
 * One card serves both factions: the client resolves bgo.<Key>.NameCylon first and falls back to
 * .Name, and all six families carry both. So 6062 reads "Combat Avionics Maneuvering System
 * (CAMS) - Rhino" to a Colonial and "... - Marauder" to a Cylon, off one card.
 *
 * THE BUFF. The description is not decoration - it names the mechanic:
 *   "The Combat Avionics Maneuvering system is fly-by-wire ... replaces the analog maneuvering
 *    systems providing full Reaction Control Systems (RCS) ..."
 * and the server has a hook that exists for precisely this item. ShipSubscribeInfo.java:97-130 is
 * commented "cams system stats on abilities": for every fitted system it checks
 * `MultiplyBuffs.containsStat(CannonAngle)` and, if present, multiplies every FireCannon ability's
 * Angle by it. Nothing in the 14,223-card dump sets CannonAngle - because the one card family that
 * would have set it is the one family the dump is missing. So the CAMS modules are what that hook
 * was written for, and a wider gun cone is exactly what mouse-aimed flight controls feel like.
 * (The hook's other arm does the same for MiningAngle on FireMining; we leave that one alone -
 * a mining buff is not what "advanced flight controls" promises.)
 *
 * The multiply is safe to apply: ShipAbility.java:19 copies the card's ItemBuffAdd per instance and
 * applyAbilitySlotStats calls `ability.resetStats()` (:178) before the hook runs, so the Angle is
 * recomputed from the card each pass and never compounds. BasePropertyBuffer.onSlotUpdate then
 * pushes the widened Angle to the client, so the reticle and the server agree.
 *
 * *** HARD PRECONDITION ***: the hook does `ability.getItemBuffAdd().getStat(Angle) * mult` and
 * getStat returns a nullable Float, so a FireCannon or FireMining ability with NO Angle stat is an
 * unboxing NPE the moment a CAMS module is fitted. Checked: 458/458 dump FireCannon+FireMining
 * abilities carry Angle, and 17/17 of ours do. Keep it that way - the generator should assert it.
 *
 * 1.1 is the magnitude the original used for tier-1 RCS hardware: `..._engine_system_fog_gyro`
 * ships TurnSpeed 1.1 / TurnAcceleration 1.1 and `..._engine_system_translation_rcs` ships
 * TurnSpeed 1.1 / StrafeMaxSpeed 1.15. The client renders a MultiplyBuff as (v-1)*100 with a "%"
 * format (SystemsStatsGenerator.cs:541-553), so the tooltip reads "Cannon Angle +10%".
 *
 * All six carry the SAME value on purpose. Until restrictions are live any t1 hull can fit any of
 * the six, so a per-role spread would just mean everybody fits whichever one is strongest. It is
 * also the truer reading: Dev Blog 8 attributes the handling differences to the airframes ("each
 * ship has very distinct maneuvering attributes"), not to the avionics box, which is one design
 * fitted to all of them.
 *
 * Frame 199 is the `..._engine_system_coupled_rcs` icon - the closest thing the atlas has to an
 * RCS control unit. The real CAMS icon's frame is unknowable: no dump card, no card, no frame.
 * A wrong frame draws the wrong picture and nothing else.
 *
 * Durability 2500 and price 5,000 tylium put it level with every other tier-1 system in
 * equipment-real.js. In the original the module was free ("They will both be placed in your
 * locker") - we have no way to pre-place items, so it is a cheap shop item instead.
 */
const AVIONICS_CAMS = [
  // guid          loca family / hull it is named for              human objKey  cylon objKey
  { sys: 6060, family: 'interceptor', key: 'system_avionics_interceptor_combat',
    ourRestrictions: [107780547, 117312163] },   // Viper Mk II / Raider
  { sys: 6061, family: 'command',     key: 'system_avionics_command_combat',
    ourRestrictions: [116493059, 51742547] },    // Raptor / Heavy Raider
  { sys: 6062, family: 'assault',     key: 'system_avionics_assault_combat',
    ourRestrictions: [107966800, 107878853] },   // Rhino / Marauder
  { sys: 6063, family: 'bomber',      key: 'system_avionics_bomber_combat',
    ourRestrictions: [163729268, 189973171] },   // Viper Mk III / 'Cylon War' Raider Mk II
  { sys: 6064, family: 'multi',       key: 'system_avionics_multi_combat',
    ourRestrictions: [163729272, 11152787] },    // Viper Mk VII / 'Cylon War' Raider
  { sys: 6065, family: 'stealth',     key: 'system_avionics_stealth_combat',
    ourRestrictions: [59555849, 113318329] },    // Raven Mk VI-R / Malefactor
// Both arrays carry the same field names (plus `family` here, which is documentation only), so one
// mapper in the generator can emit either. Fields that happen to match a shipSystem() default are
// still spelled out - a default that changes underneath us should not silently re-tune these items.
].map(a => Object.assign(a, {
  slot: 'avionics', tier: 1, frame: 199,
  level: 1, maxLevel: 1, next: 0, userUpgradeable: false,
  st: {}, mul: { CannonAngle: 1.1 },
  dur: 2500, max: 1,
  // Sold under `gyro`, the sorting bucket the original files stabilisers and RCS units in.
  // ItemType Avionics is a real ShopItemType constant and drives the shop's own avionics tab.
  itemType: 'Avionics', sort: 'gyro',
  buy: { 215278030: 5000 },        // tylium
  upgrade: {},                     // never upgradeable, but the field is dereferenced on write
  sell: { 215278030: 1250 },       // a quarter of the buy price, the sysPrice convention
  class: 'Standart',
  views: ['MultiplyBuff', 'Durability'],
  // Swappable by design: Dev Blog 8 says "simply change the CAMS module out for the BAMS module".
  // Unique stays false because ShopProtocol already de-stocks an owned avionics module server-side,
  // which is the original's own behaviour and the reason the dump has no avionics cards at all.
  unique: false, replaceableOnly: false, trashable: true, indestructible: true,
}));

/* ---------------------------------------------------------------- C-31 RECHARGE MODULE, role/t2
 *
 * `research/bsgo_wiki/C31-Recharge Module.txt:1` - "a special 'role ability' slot which is only
 * available for the Maul/Wraith and its advanced versions", and :5-9 gives the level-10 effect:
 * +80 power, +29% power recharge, +29% hull recovery, +15,218 durability, "upgraded by merits
 * only", maximum level 10. Those two hulls are humant2defender / cylont2defender, the only role/t2
 * bays in the roster.
 *
 * It is entirely PASSIVE, which is why it can ship at all: ShipSubscribeInfo.applySlotSystemStats
 * (:65-84) walks every fitted slot and applies StaticBuffs additively and MultiplyBuffs
 * multiplicatively with no ability involved. So `AbilityCards: []`, no ShipAbility card, no
 * AbilityActionType, and no Java change - unlike role/t1 and role/t4.
 *
 * ALL THREE BUFFED KEYS ARE SEEDED BY THE HULL, which is the whole ballgame: applyStatsAddTo and
 * applyStatsMultTo (ObjectStats.java:148-180) only write keys the target map ALREADY contains, and
 * statsWithSlots is seeded solely from the Ship card's Stats block. humant2defender /
 * cylont2defender seed MaxPowerPoints 200, PowerRecovery 10, HullRecovery 8.9 - all present, all
 * non-zero, so the multiplies are not no-ops either.
 *
 * THE LADDER. The wiki gives level 10; levels 1-9 are ours. They are scaled the way the dump's own
 * ladders scale, measured over all 234 complete 10-level chains in the dump:
 *   Durability   L1/L10 median 0.500 (p25 = p50 = p75 = 0.500, n=234)  -> L1 is half of L10
 *   StaticBuffs  L1/L10 median 0.500 (n=149)                           -> L1 is half of L10
 *   MultiplyBuffs (L1-1)/(L10-1) median 0.690 (n=35)                   -> L1 delivers ~69% of the
 *                                                                          level-10 bonus
 * and linear in between, the dump's dominant shape. That last one lands beautifully: 0.29 x 0.69 =
 * 0.20, so the multiplier runs 1.20 1.21 1.22 ... 1.29, a flat +0.01 per level onto the wiki's
 * exact figure. Compare the dump's own `..._engine_system_focused_ftl`, whose FtlRange runs
 * 1.26 -> 1.467 in even 0.023 steps.
 *
 *   L      1     2     3     4     5     6     7     8     9    10
 *   PP    40    44    49    53    58    62    67    71    76    80     StaticBuffs.MaxPowerPoints
 *   x    1.20  1.21  1.22  1.23  1.24  1.25  1.26  1.27  1.28  1.29    MultiplyBuffs, both keys
 *   dur 7609  8454  9300 10145 10991 11836 12682 13527 14373 15218
 *
 * PRICES. Merits (130920111) carry the cost, as the wiki says. Flat across the ten levels, which
 * is what the dump's own role ladder does - the Spawn Mode module is 32,000 cubits + 16,000 merits
 * to buy and the identical figure to upgrade on every one of its ten levels. 2,000 merits to buy
 * matches `system_paint_raptor_rescue_a`, the only other merit-priced level-1 system in the dump,
 * and is the closest we can get to the wiki's "Free. Comes with the Maul or Wraith when purchased."
 *
 * The 2,000 CUBITS in UpgradePrice is not flavour. ContainerVisitor.upgradeSystemByPack reads
 * `UpgradePrice.getItems().get(Cubits.guid)` and computes `min(1, packCount / (cubits / 1000))`:
 *   - missing key  -> unboxing NPE, which drops the player's socket
 *   - 0            -> division by zero, chance = +inf -> clamped to 1, so ONE tuning kit buys a
 *                     guaranteed level for free. That is the exploit, and it is armed by any
 *                     zero-or-absent cubits entry, so never "just add a zero" here.
 *   - 2000         -> two tuning kits for a certain level-up, one kit for a coin flip.
 * The 1,000-cubit floor is where a single kit becomes a guarantee; 2,000 is the smallest round
 * number clear of it. The normal merit upgrade path charges this too, so it is kept small.
 *
 * DEVIATIONS FROM THE ORIGINAL, both forced, both for PATCHES.md:
 *   - The wiki says the module comes with the ship and is not removable. Player.setupBasicHangar
 *     (Player.java:166-175) builds a HangarShip with zero systems and there is no player-side
 *     equivalent of ShipConfigTemplates, so we cannot pre-install anything. It ships as an ordinary
 *     purchasable role item.
 *   - Because it is bought rather than granted, it is Trashable and CanBeSold with a merit refund.
 *     The dump's role module is neither, but an item the original never made you buy has no
 *     business being a permanent inventory trap when a mis-click puts it in your hold.
 * Kept from the dump's role module: Class Elite, Unique (the shop hides it once you own one), and
 * ReplaceableOnly, which makes the client confirm before installing and refuse stray drags -
 * the closest the UI gets to "fitted at the factory".
 * Indestructible follows this repo's convention rather than the dump's: we ship no repair loop, so
 * a system that can be destroyed by durability loss would just quietly disappear.
 *
 * Frame 190 is the icon the dump gives `..._hull_system_power_buff` and `..._hull_system_regen_buff`
 * - the two items whose effect is literally "more power pool, faster recharge". The real C-31 icon
 * exists (the wiki has C-31_Recharge_Module.png) but nothing tells us its frame index.
 */
const C31_KEY = 'item_slot_escort_system_assault_role_recharge_module';
const C31_GUID_BASE = 6080;                          // 6080..6089, one card per level
const C31_RESTRICTIONS = [218289587, 268081382];     // humant2defender / cylont2defender objKeys

// Level 10 is the wiki's; levels 1-9 interpolate from half (Durability, MaxPowerPoints) or from
// 69% of the bonus (the multipliers), per the dump curves quoted above.
const C31_MAX_POWER_L10 = 80;
const C31_DURABILITY_L10 = 15218;
const C31_MULT_L10 = 1.29;
const C31_MULT_L1 = 1.20;

const lerp = (a, b, t) => a + (b - a) * t;

const C31_LEVELS = Array.from({ length: 10 }, (_, i) => {
  const level = i + 1;
  const t = i / 9;                                   // 0 at level 1, 1 at level 10
  // toFixed(2) is not cosmetic: 1.2 + 0.01*3 is 1.2300000000000002 in binary floating point, and
  // that lands in the JSON verbatim.
  const mult = Number(lerp(C31_MULT_L1, C31_MULT_L10, t).toFixed(2));
  return {
    sys: C31_GUID_BASE + i,
    next: level === 10 ? 0 : C31_GUID_BASE + i + 1,  // 0 at the top: PlayerProtocol refuses to
                                                     // upgrade a card whose next guid is 0
    level, maxLevel: 10, userUpgradeable: true,
    slot: 'role', tier: 2, key: C31_KEY, frame: 190,
    st: { MaxPowerPoints: Math.round(lerp(C31_MAX_POWER_L10 / 2, C31_MAX_POWER_L10, t)) },
    mul: { PowerRecovery: mult, HullRecovery: mult },
    dur: Math.round(lerp(C31_DURABILITY_L10 / 2, C31_DURABILITY_L10, t)),
    max: 1,
    ourRestrictions: C31_RESTRICTIONS,
    // The dump files its role module under ItemType Computer - there is no Role constant in
    // ShopItemType - and `power` is the bucket it files batteries and energy recovery units in.
    itemType: 'Computer', sort: 'power',
    buy: { 130920111: 2000 },
    // Charged for the step from THIS level to the next (ContainerVisitor.java:347-364 accumulates
    // the UpgradePrice of every level it walks past), so level 10's copy is never spent.
    upgrade: { 130920111: 1000, 264733124: 2000 },
    // A quarter of the merits sunk in at this level: 2000 to buy plus 1000 per level gained.
    sell: { 130920111: 500 + 250 * i },
    class: 'Elite',
    views: ['StaticBuff', 'MultiplyBuff', 'Durability'],
    unique: true, replaceableOnly: true, trashable: true, indestructible: true,
  };
});

/* CannonAngle is not seeded by any hull's Stats block and never will be - it is not a ship stat.
 * It is read straight off the fitted system's MultiplyBuffs by the CAMS hook and applied to an
 * ability's Angle. So the "a buffed key the hull does not seed is dead" rule does not apply to it,
 * and whatever validator enforces that rule has to know. */
const AVIONICS_UNSEEDED_STAT_ALLOWLIST = ['CannonAngle'];

module.exports = {
  AVIONICS_CAMS, C31_LEVELS, C31_KEY, C31_GUID_BASE, C31_RESTRICTIONS,
  AVIONICS_UNSEEDED_STAT_ALLOWLIST,
};

/* Run this file directly to check the ladder still lands where the wiki says it does. It is the
 * only thing standing between a stray edit and a C-31 that quietly stops matching its own page. */
if (require.main === module) {
  const fail = [];
  const top = C31_LEVELS[9];
  if (top.st.MaxPowerPoints !== 80) fail.push(`L10 MaxPowerPoints ${top.st.MaxPowerPoints} != 80`);
  if (top.mul.PowerRecovery !== 1.29) fail.push(`L10 PowerRecovery ${top.mul.PowerRecovery} != 1.29`);
  if (top.mul.HullRecovery !== 1.29) fail.push(`L10 HullRecovery ${top.mul.HullRecovery} != 1.29`);
  if (top.dur !== 15218) fail.push(`L10 Durability ${top.dur} != 15218`);
  if (top.next !== 0) fail.push('L10 still points at a next card');
  C31_LEVELS.forEach(l => {
    if (!(l.upgrade[264733124] > 0))
      fail.push(`L${l.level} UpgradePrice has no positive Cubits entry - arms upgradeSystemByPack`);
  });
  const guids = [...AVIONICS_CAMS.map(a => a.sys), ...C31_LEVELS.map(l => l.sys)];
  if (new Set(guids).size !== guids.length) fail.push('duplicate guid');

  console.log('avionics (CAMS, tier 1):');
  AVIONICS_CAMS.forEach(a =>
    console.log(`  ${a.sys}  ${a.family.padEnd(11)} ${a.key.padEnd(36)} CannonAngle x${a.mul.CannonAngle}`));
  console.log('C-31 Recharge Module (role, tier 2):');
  C31_LEVELS.forEach(l =>
    console.log(`  L${String(l.level).padStart(2)}  guid ${l.sys} -> ${l.next}  ` +
                `PP +${l.st.MaxPowerPoints}  x${l.mul.PowerRecovery}  dur ${l.dur}  ` +
                `up ${l.upgrade[130920111]} merits + ${l.upgrade[264733124]} cubits`));
  if (fail.length) { console.error('FAILED:\n  ' + fail.join('\n  ')); process.exit(1); }
  console.log(`OK - ${AVIONICS_CAMS.length} avionics + ${C31_LEVELS.length} C-31 levels`);
}
