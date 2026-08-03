"""Generate tools/cardgen/hulls-real.js from the live-server dump.

The dump itself is 14 MB of a running private server's catalogue and stays out of the repo; this
emits the slice cards.js needs as a committed, readable data module, so the build does not depend
on having the dump on disk.

Three things come out of it, all of which we had wrong:
  stats   - the full per-hull stat block, not just flight. Ours were formula-generated: every hull
            of a role shared one set, and only 18 keys were seeded at all. The real ones vary per
            hull, are much slower and heavier, and carry the armour/avoidance/firewall block that
            the module catalogue buffs.
  slots   - the real slot list: id, type, hardpoint, server hash, level. Ours had the wrong
            id->hardpoint mapping (so weapons mounted at the wrong points, hence the wrong
            orientation), an invented 'launcher' type, and no hull/computer/engine slots at all.
  layouts - the paperdoll slot-id sets per level, read off PaperdollLayoutBig/Small. Our hardcoded
            table listed 3 slots for the Viper where the real layout has 12.

WHY THE WHOLE STAT BLOCK AND NOT JUST FLIGHT. ShipSubscribeInfo.applySlotSystemStats:65-84 feeds
every fitted module's StaticBuffs / MultiplyBuffs through ObjectStats.applyStatsAddTo and
applyStatsMultTo, and both only write a key the target map ALREADY contains (ObjectStats.java:159,
:174). The target, statsWithSlots, is seeded solely from the Ship card's Stats block and never
gains a key. So a module that buffs a stat the hull does not seed is silently a no-op - which is
what an 18-key hull did to every armour, firewall, penetration and avoidance module in the
catalogue. Take the dump's keys verbatim rather than a hand-picked list, minus EXCLUDE below.
"""
import json, collections, os

# The dump is local research material and is not in the repo; point BSGO_DUMP at yours.
HERE = os.path.dirname(os.path.abspath(__file__))
DUMP = os.environ.get('BSGO_DUMP', os.path.join(HERE, '../../research/dumps/cards_20260729_223813.json'))
OUT = os.path.join(HERE, 'hulls-real.js')

# Seven keys the dump carries that cards.js owns instead. hulls-real.js stats are merged LAST in
# shipCards(), so anything emitted here beats cards.js - which for these seven would be a
# regression, not an import:
#   Ftl*     - our galaxy is not the original's. cards.js:124-139 sets FtlRange 200 against the
#              dump's 90-240 because our two stars sit 80 units apart, and FtlCost 1 because the
#              cost is charged per unit of distance. negtest case 6 anchors on the literal
#              "FtlCooldown: 35, FtlCost: 1," at cards.js:139; a hull-level FtlCost would override
#              it and the test would keep printing PASS while checking nothing.
#   Detection* - already set per hull by the DETECTION table in cards.js, which is the same dumped
#              data reorganised by role and tier so the two capitals we invented get a row too.
EXCLUDE = {'FtlRange', 'FtlCharge', 'FtlCooldown', 'FtlCost',
           'DetectionVisualRadius', 'DetectionInnerRadius', 'DetectionOuterRadius'}

# Emission order. Purely cosmetic - the JS object is a map - but it keeps the flight block first,
# where the comments in cards.js expect to find it, and makes a regenerated file diff cleanly
# against the last one. Any dump key not listed here and not in EXCLUDE is still emitted, sorted,
# at the end of the row, and the script says so; a fresh dump that adds a stat should be noticed,
# not dropped.
ORDER = [
    # Flight. These were the whole file before the stat block went in.
    'Speed', 'BoostSpeed', 'Acceleration', 'AccelerationMultiplierOnBoost',
    'PitchMaxSpeed', 'YawMaxSpeed', 'RollMaxSpeed', 'StrafeMaxSpeed',
    'PitchAcceleration', 'YawAcceleration', 'RollAcceleration', 'StrafeAcceleration',
    'InertiaCompensation', 'BoostCost',
    # Hull and energy. Cross-checked against the wiki infoboxes for all 22 hulls that have both a
    # page and a dump entry: they agree to the digit on every one, hull points and power alike,
    # with zero disagreements. Two independent sources matching exactly is the strongest
    # corroboration available here, so these override the hand-set hp/pwr in HULLS.
    'MaxHullPoints', 'MaxPowerPoints', 'HullRecovery', 'PowerRecovery',
    # Combat defence. The first four are live: DamageCalculator.java:124-125 reads ArmorValue and
    # CriticalDefense, WeaponAction.java:95-99 reads Avoidance and AvoidanceFading.
    'ArmorValue', 'Avoidance', 'AvoidanceFading', 'CriticalDefense',
    # FirewallRating is the target side of DeBuffAction.java:40 and PenetrationStrength the caster
    # side at :32. Decay* have no server reader; they are seeded so their modules are not no-ops.
    'FirewallRating', 'PenetrationStrength', 'DecayDamageFactor', 'DecayResistance',
    # Vitals, durability and cargo. Nothing on the server reads any of these yet either - they are
    # here so a module that buffs one is a real item rather than a silent no-op, and because a
    # missing key can never be added later without regenerating this file anyway.
    'MaxVitalPoints', 'VitalRecovery', 'DurabilityBonus',
    'CargoHoldVolume', 'CargoPickupDelay', 'CargoDropoffDelay', 'CargoLootDelay',
    'JumpTargetTransponderPowerPointCost',
]
assert not (set(ORDER) & EXCLUDE), 'a key cannot be both ordered and excluded'

cards = json.load(open(DUMP, encoding='utf-8'))['cards']
world = {c['guid']: c['fields'] for c in cards if c['viewName'] == 'World'}


def ename(v):
    return v['name'] if isinstance(v, dict) and 'name' in v else v


hulls, layouts, extra_keys = {}, {}, set()
for c in cards:
    if c['viewName'] != 'Ship':
        continue
    f = c['fields']
    if f.get('Level') != 1:
        continue
    w = world.get((f.get('WorldCard') or {}).get('guid')) or {}
    prefab = (w.get('PrefabName') or '').lower()
    if not prefab or prefab in hulls:
        continue
    stats = (f.get('Stats') or {}).get('stats') or {}
    keys = [k for k in ORDER if k in stats]
    rest = sorted(k for k in stats if k not in EXCLUDE and k not in ORDER)
    extra_keys.update(rest)
    hulls[prefab] = {
        'stats': {k: stats[k] for k in keys + rest},
        'slots': [[sl['SlotId'], ename(sl['SystemType']), sl.get('ObjectPoint') or '',
                   sl['ObjectPointServerHash'], sl.get('Level', 1)]
                  for sl in sorted(f.get('Slots') or [], key=lambda s: s['SlotId'])],
    }
    pf = f.get('PaperdollUiLayoutfile')
    if pf and pf not in layouts:
        rec = {}
        for tag, key in (('big', 'PaperdollLayoutBig'), ('small', 'PaperdollLayoutSmall')):
            lay = f.get(key) or {}
            per = {}
            for up in (lay.get('UpgradeLevels') or []):
                per[up['Level']] = sorted(sl['SlotId'] for sl in (up.get('SlotLayouts') or []))
            rec[tag] = per
        layouts[pf] = rec


def jnum(v):
    return ('%g' % v) if isinstance(v, float) else str(v)


HEADER = r"""/* ============================================ REAL HULL DATA, FROM A LIVE SERVER
 *
 * GENERATED FILE - do not hand-edit. Regenerate with the card dumper (Fulgar's GameDev tab)
 * plus tools/cardgen/gen-hulls-real.py against a fresh dump.
 *
 * Source: a 14,223-card dump of a running BSGO private server, every card fully resolved.
 * Stats are already de-obfuscated - the client stores each value minus a per-instance random
 * constant, so the raw numbers are meaningless without that pass. These are the LEVEL 1 cards,
 * i.e. the ship as bought; level 2 is the "Advanced" upgrade and is not modelled here.
 *
 * WHY THIS EXISTS. Everything in it replaced something we had generated from a formula:
 *   - flight stats were per-ROLE, so every tier-1 fighter flew identically. Real ones vary per
 *     hull, and are far slower and heavier: a Viper Mk II tops out at 55 m/s, not 115, and
 *     accelerates at 13.5, not 69. Ships that hit top speed instantly is what "the physics feel
 *     horrendous" was.
 *   - StrafeMaxSpeed and StrafeAcceleration are ZERO on every strike hull in the dump. We shipped
 *     40 and 80. Strike craft in this game do not strafe. Safe to zero: the movement sim only
 *     ever MULTIPLIES by them (MovementSimulation.java:203-208), never divides, and Strafe is
 *     not in the FLIGHT_REQUIRED set.
 *   - RollMaxSpeed and RollAcceleration were far too LOW - a real Viper rolls at 182 with 748
 *     acceleration against our 126/253. Slow forward, fast roll, is the shape of the real thing.
 *   - slot id -> hardpoint mapping was wrong, which is why weapons pointed the wrong way: each
 *     hardpoint carries its own rotation quaternion, so a weapon in the wrong slot renders at
 *     the wrong place AND the wrong angle.
 *   - the "launcher" slot type we put on all 30 hulls exists on exactly FOUR prefabs in the
 *     whole dump: the two stealth hulls and the two carriers. Nothing else has one.
 *   - hull / computer / engine / ship_paint / avionics slots were missing entirely, so no module
 *     could be fitted to anything.
 *
 * THE STAT BLOCK IS THE WHOLE BLOCK, NOT JUST FLIGHT, and that is load-bearing rather than tidy.
 * ShipSubscribeInfo.applySlotSystemStats:65-84 runs every fitted module's StaticBuffs through
 * ObjectStats.applyStatsAddTo and its MultiplyBuffs through applyStatsMultTo, and both write a
 * key ONLY if the target map already holds it (ObjectStats.java:159, :174). The target is seeded
 * once from this block and never gains a key afterwards. So a module buffing a stat the hull does
 * not seed does nothing at all - no error, no log line, just an item with no effect. While this
 * file carried 18 flight keys, every ArmorValue, FirewallRating, PenetrationStrength, Avoidance
 * and DecayResistance module in the catalogue was decorative. It now carries all 41 keys the
 * dump's Ship cards seed, less the seven cards.js owns: 34 in the file, 32 or 33 on any one hull.
 *
 * SEVEN DUMP KEYS ARE DELIBERATELY ABSENT: FtlRange, FtlCharge, FtlCooldown, FtlCost,
 * DetectionVisualRadius, DetectionInnerRadius, DetectionOuterRadius. shipCards() merges this
 * file's stats LAST, so emitting them here would silently beat cards.js, and cards.js is right
 * about all seven - our galaxy geometry is not the original's (cards.js:124-139) and the three
 * radii are already set per hull by the DETECTION table. negtest case 6 anchors on the literal
 * "FtlCooldown: 35, FtlCost: 1," at cards.js:139 and would go vacuous while still printing PASS.
 *
 * NINE BUFF KEYS CAN NEVER BE SEEDED - not by us, not by the original. Cross-joining the dump
 * modules' buff keys against the union of all 95 dump Ship stat blocks leaves these unseeded on
 * every hull the original ever shipped:
 *     DrainResistance  PowerPointRestore  ToggleSystemCooldown
 *     MissileCooldown        MissilePowerPointCost
 *     LightMissileCooldown   LightMissilePowerPointCost
 *     HeavyMissileCooldown   HeavyMissilePowerPointCost
 * No extraction can fix that, because there is nothing to extract. Two of them are inert by
 * design rather than by omission: SkillBook.java:261 maps MissileCooldown onto Cooldown for
 * SKILLS only, never for ship stats, and RestoreBuffAction.java:37-39 reads PowerPointRestore off
 * the casting ABILITY's ItemBuffAdd, never off the ship. The dead-buff validator treats exactly
 * this list as a known-inert allowlist and warns instead of failing - a module buffing one of
 * these is as inert here as it was on the live server, which is as close to correct as the data
 * allows. TurnSpeed and TurnAcceleration look unseeded by the same test (345 and 90 dump modules
 * buff them) but are NOT dead and must never be added to that allowlist: applySlotSystemStats
 * passes every buff through ObjectStats.mapObjectStats first, and :106-119 rewrites TurnSpeed to
 * Pitch/YawMaxSpeed and TurnAcceleration to Pitch/YawAcceleration, all four of which are seeded.
 *
 * THREE OF THE ADDED KEYS CHANGE COMBAT MATH FOR EVERY SHIP. All three are intended, and the
 * first two only make sense next to the dump's own weapons:
 *   - Avoidance / AvoidanceFading. WeaponAction.java:95-99 feeds them to
 *     HitchanceBasedOnThrottle, where the base hit chance is
 *     clamp(0.675 - 0.0015*(avoidance - accuracy), 0.05, 0.95). At the Avoidance 0 we shipped,
 *     Accuracy 100 hit 82.5% of the time and anything above 150 hit the 95% ceiling - there was no
 *     such thing as a miss. The real numbers are TIER-MATCHED: hulls carry 490-520 at tier 1,
 *     250-290 at tier 2, 30-70 at tier 3, 20 at tier 4, and the dump answers them with weapons at
 *     Accuracy 400 (tier 1), 335 (tier 2) and 125 (tier 3). Dump on dump is 51% at tier 1 and
 *     76-80% at tier 3, which is the curve the game was tuned around. Our CURRENT tier-1 weapons
 *     carry Accuracy 100-150, and against Avoidance 510 that is a 6-13% hit chance at full
 *     throttle: hulls and weapons are one balance system and have to land in the same wave.
 *     AvoidanceFading is 0.75 on tiers 1-2 and ABSENT on tiers 3-4. Absent reads as 0, and
 *     HitchanceBasedOnThrottle.java:62 short-circuits on 0 and returns the full avoidance - no
 *     divide, no NaN. So a tier-1/2 hull fades to 25% avoidance when stationary and a tier-3/4
 *     hull never fades at all.
 *   - ArmorValue: 0-10 at tier 1, 25-30 at tier 2, 40-45 at tier 3. Inert while SectorAlgorithms
 *     installs ArmorAlgorithmV0, whose getMultiplicator() returns a constant 1. Under V1 these
 *     change damage taken for every ship and NPC in the game.
 *   - CriticalDefense, 60-150. cards.js seeds 0 on every hull so that crit-defence buffs have
 *     something to apply to; the dump's real values win because this file merges last.
 *     CritchanceAlgorithmV1 gives clamp01((5 + 0.15*(critOffense - critDefense))/100), so a weapon
 *     needs CriticalOffense above critDefense - 33 to crit at all. Our tier-1 weapons carry 20-45
 *     against the new 60-120, so tier 1 crits stop entirely until the dump weapons (100-200) land.
 *     Tiers 3 and 4 are unaffected - ours already carry 90-405.
 * None of this reaches the ten stations, platforms and motherships or the two capitals, which have
 * no dump prefab and so no entry here. They keep Avoidance 0 (a 95% hit ceiling against them) and
 * whatever cards.js gives them, which for the Pegasus and the Basestar is CAPITAL_FLIGHT's
 * ArmorValue 60 / CriticalDefense 200.
 *
 * SLOT ROW: [slotId, slotType, objectPoint, objectPointServerHash, level]
 * objectPoint is "undefined" and the hash 44673 for every non-weapon slot - those do not attach
 * to a transform on the model, so they share one sentinel.
 */"""

L = [HEADER]
L.append("'use strict';")
L.append('')
L.append('const HULLS_REAL = {')
for p in sorted(hulls):
    h = hulls[p]
    L.append('  %s: {' % p)
    st = ', '.join('%s: %s' % (k, jnum(v)) for k, v in h['stats'].items())
    L.append('    stats: { %s },' % st)
    L.append('    slots: [')
    for sid, styp, pt, hsh, lvl in h['slots']:
        L.append("      [%d, '%s', '%s', %d, %d]," % (sid, styp, pt, hsh, lvl))
    L.append('    ],')
    L.append('  },')
L.append('};')
L.append('')
L.append('/* Paperdoll slot-id sets per level, read off the dump\'s own PaperdollLayoutBig/Small rather')
L.append(' * than re-extracted from the client. A slot with no BIG entry at its level is an NRE in the')
L.append(' * shop paperdoll; a slot with no SMALL entry merely has no in-flight control. */')
L.append('const LAYOUTS_REAL = {')
for pf in sorted(layouts):
    b = layouts[pf]['big']
    s = layouts[pf]['small']
    fmt = lambda d: '{ ' + ', '.join('%s: [%s]' % (k, ','.join(map(str, v))) for k, v in sorted(d.items())) + ' }'
    L.append('  %s: { big: %s, small: %s },' % (pf, fmt(b), fmt(s)))
L.append('};')
L.append('')
L.append('module.exports = { HULLS_REAL, LAYOUTS_REAL };')

open(OUT, 'w', encoding='utf-8', newline='\n').write('\n'.join(L) + '\n')
print('wrote %s  (%d hulls, %d paperdoll layouts)' % (OUT, len(hulls), len(layouts)))
tc = collections.Counter(s[1] for h in hulls.values() for s in h['slots'])
print('slot types:', dict(tc))
sk = collections.Counter(k for h in hulls.values() for k in h['stats'])
print('stat keys: %d distinct, %d..%d per hull' %
      (len(sk), min(len(h['stats']) for h in hulls.values()), max(len(h['stats']) for h in hulls.values())))
if extra_keys:
    print('NOT IN ORDER (emitted last, sorted - add them to ORDER if they are here to stay):',
          sorted(extra_keys))
