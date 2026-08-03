# TODO

Ordered by what unblocks the most. Each item says what is actually wrong, not just what to build.

## Next

### Missile interception, client side

Enemy missiles carry hull points and every gun, flak and point-defence ability group carries the
`Missile` target flag, so the server will happily let you shoot one. A player still cannot click a
missile to select it, and flak rarely kills one in practice.

The leading suspicion is that the client only draws a target bracket for objects inside
`DetectionOuterRadius`, and a bracket that is never drawn cannot be clicked or offered to the
auto-cast sweep that feeds flak its targets. Capitals carry different detection stats than strike
craft, which is where it was noticed. Verify that before changing any card data.

### Missile collisions on the carriers

Missiles fired from a Brimir behave oddly on impact. Undiagnosed. First thing to check is the
missile spawn point against the carrier's own 428-unit collider, since a projectile born inside its
parent's collision sphere is a plausible cause, but that is a guess and not a diagnosis.

### The Galactica's four synthesised mounts

`bullet09`–`12` on the Galactica do not exist in the client's model. They were added to bring her
armament up to the Pegasus's twelve, and the client can only bind a mount whose transform is really
there, so those four bays likely render no turret and may fire from the ship's origin. That could
also be feeding the carrier collision problem above.

Two honest options: drop back to her eight real mounts, applying the same change to the Guardian so
the pair stays identical, or search the bundle for other usable transforms.

### Rentals that survive a relog

`Counters.injectOldCounters` silently discards any counter whose guid has no Counter card, so the
rental expiry write lands nowhere and the login path deletes the hull as expired regardless of time
remaining. Emitting Counter cards for 5017, 5117, 5019, 5119 and 234 fixes it, and the same change
would allow a durable water-exchange ledger if one is ever wanted.

### Flagship auto-return

`CapitalRentalExpiry` is written and reviewed but has its `@Scheduled` annotation removed. Its
header lists the three defects that keep it off: it docks pilots who are not flying the rental, it
swaps ships from the scheduler thread while the sector thread still ticks that ship, and it rewrites
the player's sector id before the ship drains. Re-enable only when all three are genuinely fixed.

## Balance, once the above settles

Hull points now span 850 on a Viper Mk II to 100,000 on a flagship, and the equipment ladder is the
original's own rather than a tier multiplier. Nobody has timed kills across tiers with a person in
the cockpit. The capitals are the open question: twelve capital batteries against a Viper's four
guns may be correct for a battlestar or may be unplayable, and only play will say.

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
