# TODO

Ordered by what unblocks the most. Each item says what is actually wrong, not just what to build.

## Fixed on 4 Aug, needs a flight to confirm

None of these four has been seen working in a real client yet. Each says what to look for.

### Missile brackets and clickability — was our own card data

The `DetectionOuterRadius` suspicion was wrong. The client decompile shows
`HudIndicatorInfo.HasStaticIndicator` refuses to create a HUD indicator for any object whose
World card says `showBracketWhenInRange: false` — and our four projectile World cards said
exactly that. No indicator means nothing for a mouse click to land on; detection radii only
decide when an existing bracket hides. The flag is true now and the client's own rules take over:
enemy-only brackets with the dedicated missile sprite and a health bar. Flak needs no bracket at
all — its auto-cast sweep (`GetObjectsWithinAOE`) runs over every loaded object — so "rarely
kills one" is cadence (the target list refreshes once per cast) and the short crossing window,
not targeting. **Check:** an incoming NPC missile shows a bracket, is clickable, and Z (select
nearest missile) still works.

### Early missile impacts on the carriers — oversized sphere colliders

Incoming missiles detonated far off the Brimir's hull because the collider was a 428-radius
sphere on a hull whose mesh is 326 wide, 184 tall and 768 long: sized to cover the length, it
reached ~260 units past the broadside. The Pegasus's 1174 sphere was ~800 units proud. All three
authored capital spheres are now AABB boxes measured from the prefab meshes by
`tools/cardgen/extract-bounds.py`, which reproduces upstream's own basestar box to two decimals.
Also found on the way: missile × Cruiser collisions paired but never resolved (patch 0019), so
missiles flew through the gate capitals doing nothing. **Check:** a missile fired at the Brimir
detonates at the hull, and a missile fired at a gate basestar actually hurts it.

### Flagships at eight real mounts

The galactica bundle holds exactly eight bullet locators; a transform dump found nothing else
positioned off-origin to bind a ninth bay to, so the invented `bullet09`–`12` are gone and both
flagships now carry 4 gun / 2 launcher / 2 defensive on real mounts. The Guardian dropped with
her to keep the pair identical; the cut mounts there are the two the artists left unmodelled plus
one launcher pair. The flagships now mount fewer tubes than the twelve-bay Pegasus pair and lean
on the FLAGSHIP stat block instead — that trade moves to Balance below. **Check:** every
Galactica bay renders a turret and fires from it.

### Station missiles at warhead-class HP — from the first flight's reports

Live play found the outpost round at 15 HP (the dump's value, from a game where missiles could
not be shot) and the light-platform interceptor at 30, while every capital launcher fires the
same ordnance class at 200. Both are 200 now: the outpost round through gen-systems-real's
station-override floor (self-checked, plus a G14 validator row), the interceptor in its stat
block. The outpost round still arrives from 4,000 m - that is its design envelope, set so a
sniper can never sit outside the station's reach - but at 200 HP its 50-second crawl is a fair
interception target instead of a free kill. **Check:** select an incoming outpost missile and
read 200 HP.

### Missile-shooting is a strike and escort privilege now

Guns could aim at warheads from every hull, battlestars included. The Regulation gun policy now
class-gates Missile(8) by the owning system's tier: t1/t2 gun groups keep it, the line and
capital cannon groups (including the capship battery) lose it, and flak/point defence keep it
everywhere - interception on the big hulls belongs to their screens. The dump's own ability
groups split cleanly along this line, so no group had to be fought. **Check:** in the Pegasus,
guns refuse a selected missile; in a Viper they still track one; capital flak still sweeps them.

### Rental clocks across relogs

`CounterCardType` now carries `capital_rental_{pegasus,basestar,galactica,guardian}` at the four
ship guids plus `capital_rental_return_slot` (234), so cards.js emits the Counter cards that let
`Counters.injectOldCounters` keep the persisted expiry instead of dropping it and deleting the
hull at login. The same mechanism would allow a durable water-exchange ledger if one is ever
wanted. **Check:** rent, relog, and the hull is still there with time on the clock.

## Next

### Flagship auto-return

`CapitalRentalExpiry` is written and reviewed but has its `@Scheduled` annotation removed. Its
header lists the three defects that keep it off: it docks pilots who are not flying the rental, it
swaps ships from the scheduler thread while the sector thread still ticks that ship, and it rewrites
the player's sector id before the ship drains. Re-enable only when all three are genuinely fixed.

## Balance, once the above settles

Hull points now span 850 on a Viper Mk II to 100,000 on a flagship, and the equipment ladder is the
original's own rather than a tier multiplier. Nobody has timed kills across tiers with a person in
the cockpit. The capitals are the open question: twelve capital batteries against a Viper's four
guns may be correct for a battlestar or may be unplayable, and only play will say. The flagships
now carry eight bays to the Pegasus pair's twelve (real mounts only, see above), so whether the
FLAGSHIP stat block still buys the "step above" feel is part of the same question.

Boss lairs pay six themed jackpots. Whether any of them is worth the fight is untested.

## Galaxy

All 58 accessible systems ship. Ids, names, guids, positions, threat levels and faction lockouts
are transcribed from the client; **sector contents are generated**. No source records where a single
asteroid sat in any system but 0, 6 and 10, so belts, clusters, junk fields and lairs are plausible
rather than recovered. The three upstream files are never regenerated.

`galaxy.js` holds the star table and `STAGE`, the number that grows the map; `emit-sector-templates.js`
writes the templates. They must move in the same commit — a star with no template on disk is a
server that does not boot.

Still open here:

- Sector 10's hand-placed 1,360-asteroid field remains the only genuine sector content in existence.
  Anything that recovers more of the real layouts beats the generator.
- `SectorSlotData` sends 100/100 slots for every sector always, so a pilot sees a live jump button
  on a system the server will refuse, then a bare "sector not allowed" with no explanation.
- Comets stay off in generated sectors. Sector 10 carries a `cometSectorDesc`, but the comet guid
  has never been confirmed to resolve to a full card set, and an unresolvable object is an exception
  on a timer in every sector at once.

## Known-unfixable, documented so nobody re-investigates

**Ship scrapping.** `ScrapShip` is a logged no-op upstream and `RemoveShip` has zero cases in
`parseMessage`. Every hull is therefore `CanBeSold: false` — not a choice we made, and a live
footgun the day anyone wires it up, because `ContainerVisitor.sellItem` pays out on `CanBeSold`
alone with no second gate.

**Outpost retreat has no announcement.** `EmergencyMessage` does not carry text: the client wraps
whatever string it receives as `%$bgo.<s>.description%` and looks it up. Nothing in the client's
locale describes an outpost retreating, and no other broadcast writer renders literal text, so there
is no honest message to send. Passing a sentence renders the server-maintenance banner instead,
which is what used to happen on every outpost kill.
