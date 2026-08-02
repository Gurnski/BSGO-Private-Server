"""Generate tools/cardgen/hulls-real.js from the live-server dump.

The dump itself is 14 MB of a running private server's catalogue and stays out of the repo; this
emits the slice cards.js needs as a committed, readable data module, so the build does not depend
on having the dump on disk.

Three things come out of it, all of which we had wrong:
  stats   - per-hull flight numbers. Ours were formula-generated: every hull of a role shared one
            set. The real ones vary per hull and are much slower and heavier.
  slots   - the real slot list: id, type, hardpoint, server hash, level. Ours had the wrong
            id->hardpoint mapping (so weapons mounted at the wrong points, hence the wrong
            orientation), an invented 'launcher' type, and no hull/computer/engine slots at all.
  layouts - the paperdoll slot-id sets per level, read off PaperdollLayoutBig/Small. Our hardcoded
            table listed 3 slots for the Viper where the real layout has 12.
"""
import json, collections, os

# The dump is local research material and is not in the repo; point BSGO_DUMP at yours.
HERE = os.path.dirname(os.path.abspath(__file__))
DUMP = os.environ.get('BSGO_DUMP', os.path.join(HERE, '../../research/dumps/cards_20260729_223813.json'))
OUT = os.path.join(HERE, 'hulls-real.js')

cards = json.load(open(DUMP, encoding='utf-8'))['cards']
world = {c['guid']: c['fields'] for c in cards if c['viewName'] == 'World'}

FLIGHT = ['Speed', 'BoostSpeed', 'Acceleration', 'AccelerationMultiplierOnBoost',
          'PitchMaxSpeed', 'YawMaxSpeed', 'RollMaxSpeed', 'StrafeMaxSpeed',
          'PitchAcceleration', 'YawAcceleration', 'RollAcceleration', 'StrafeAcceleration',
          'InertiaCompensation', 'BoostCost',
          # Hull and energy. Cross-checked against the wiki infoboxes for all 22 hulls that have
          # both a page and a dump entry: they agree to the digit on every one, hull points and
          # power alike, with zero disagreements. Two independent sources matching exactly is the
          # strongest corroboration available here, so these override the hand-set hp/pwr in HULLS.
          'MaxHullPoints', 'MaxPowerPoints', 'HullRecovery', 'PowerRecovery']


def ename(v):
    return v['name'] if isinstance(v, dict) and 'name' in v else v


hulls, layouts = {}, {}
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
    hulls[prefab] = {
        'stats': {k: stats[k] for k in FLIGHT if k in stats},
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


L = []
L.append('/* ============================================ REAL HULL DATA, FROM A LIVE SERVER')
L.append(' *')
L.append(' * GENERATED FILE - do not hand-edit. Regenerate with the card dumper (Fulgar\'s GameDev tab)')
L.append(' * plus tools/cardgen/gen-hulls-real.py against a fresh dump.')
L.append(' *')
L.append(' * Source: a 14,223-card dump of a running BSGO private server, every card fully resolved.')
L.append(' * Stats are already de-obfuscated - the client stores each value minus a per-instance random')
L.append(' * constant, so the raw numbers are meaningless without that pass. These are the LEVEL 1 cards,')
L.append(' * i.e. the ship as bought; level 2 is the "Advanced" upgrade and is not modelled here.')
L.append(' *')
L.append(' * WHY THIS EXISTS. Everything in it replaced something we had generated from a formula:')
L.append(' *   - flight stats were per-ROLE, so every tier-1 fighter flew identically. Real ones vary per')
L.append(' *     hull, and are far slower and heavier: a Viper Mk II tops out at 55 m/s, not 115, and')
L.append(' *     accelerates at 13.5, not 69. Ships that hit top speed instantly is what "the physics feel')
L.append(' *     horrendous" was.')
L.append(' *   - StrafeMaxSpeed and StrafeAcceleration are ZERO on every strike hull in the dump. We shipped')
L.append(' *     40 and 80. Strike craft in this game do not strafe. Safe to zero: the movement sim only')
L.append(' *     ever MULTIPLIES by them (MovementSimulation.java:203-208), never divides, and Strafe is')
L.append(' *     not in the FLIGHT_REQUIRED set.')
L.append(' *   - RollMaxSpeed and RollAcceleration were far too LOW - a real Viper rolls at 182 with 748')
L.append(' *     acceleration against our 126/253. Slow forward, fast roll, is the shape of the real thing.')
L.append(' *   - slot id -> hardpoint mapping was wrong, which is why weapons pointed the wrong way: each')
L.append(' *     hardpoint carries its own rotation quaternion, so a weapon in the wrong slot renders at')
L.append(' *     the wrong place AND the wrong angle.')
L.append(' *   - the "launcher" slot type we put on all 30 hulls exists on exactly FOUR prefabs in the')
L.append(' *     whole dump: the two stealth hulls and the two carriers. Nothing else has one.')
L.append(' *   - hull / computer / engine / ship_paint / avionics slots were missing entirely, so no module')
L.append(' *     could be fitted to anything.')
L.append(' *')
L.append(' * SLOT ROW: [slotId, slotType, objectPoint, objectPointServerHash, level]')
L.append(' * objectPoint is "undefined" and the hash 44673 for every non-weapon slot - those do not attach')
L.append(' * to a transform on the model, so they share one sentinel.')
L.append(' */')
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
