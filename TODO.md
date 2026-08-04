# TODO

Ordered by what unblocks the most. Each item says what is actually wrong, not just what to build.

## Deployed 4 Aug, on the next flight's checklist

The day's fixes are live but not all have been watched in a real client. What was watched:
missile brackets are clickable and show hull points, the operator console spawns armed capitals
by name, and a spawned Pegasus held its standoff against a Cylon outpost and traded volleys.
Still to see:

- **Flak screens thinning missiles, in both directions.** NPC area weapons used to receive
  exactly one target id â€” the closest enemy ship â€” and stations refreshed their sweep list only
  when their target changed, so neither side's flak ever rolled against a missile launched
  mid-fight.
- **An outpost missile reading 200 HP when selected.** It was 15, the dump's value from a game
  where missiles could not be shot; the light-platform interceptor was 30.
- **The Pegasus's guns refusing a selected missile while a Viper's still track one.**
  Interception on line ships and capitals belongs to their flak and point-defence screens now.
- **A missile detonating at the Brimir's hull** instead of ~260 units off it (the capital
  colliders are measured boxes now, not length-sized spheres), and **a missile actually hurting
  a gate basestar** (missile Ã— Cruiser collisions used to pair up and then resolve to nothing).
- **Every bay on a Galactica rendering a turret.** The synthesised `bullet09`â€“`12` are gone;
  both flagships carry 4 gun / 2 launcher / 2 defensive on real mounts.
- **A rental surviving a relog with time on the clock.** Counter cards for the four rental guids
  plus the return-slot counter exist now, so the expiry write finally lands somewhere.
- **Two spawned capitals holding ~1.8 km and shelling each other** instead of ramming. The NPC
  stop rule ignored any target that was still moving, which between two chasing NPCs meant
  forever.
- **The "perform any action to enter the sector" overlay lifting** after 10 seconds or the first
  stick input, even when the CompleteJump handshake loses its race against the join queue.

## Deployed 5 Aug, unflown

A batch that closed the standing "Next" list. None of it has been seen in a client yet.

- **Outpost Mode** (patch 0025). The carriers' role ability, buyable again for merits and tuning
  kits. Engage and the carrier is an immobile fortress: no movement, no FTL, half turn rate, more
  armour and hull regeneration, at 550 power to enter and 15 a second to hold. **Check:** fit it in
  a carrier's role bay, press it, watch the fortress transformation and the speed pin to zero;
  confirm the galaxy map refuses a jump; let the power run out and confirm it releases itself;
  die or dock while fortified and confirm the ship comes back normal.
- **Every player hull spawns armed** - 86 generated configs, so `spawn viper`, `spawn dreadnought`
  and the stealth hulls fight instead of drifting. **Check:** spawn a few, confirm no "UNARMED" in
  the reply and no `ZERO armed slots` warning in the log.
- **Locked systems grey out their jump button** (patch 0026) instead of offering a jump the server
  then refuses. **Check:** as Colonial, look at a Cylon-locked system on the galaxy map.
- **Comets** are live in sector 10. The card set was one view short: the CLIENT depends on a
  Missile card at the comet guid and it was never emitted, so a comet would have been invisible
  while still killing anything it touched. **Check:** fly Tannhauser, or use `spawn_comet`.
- **The flagship auto-return was already fixed and running** - the two-phase hand-back has been in
  the committed tree since 4 Aug. What was stale was the patch baseline, seven files behind, which
  was quietly dropping that work from the patch set. Repaired.

## Next

### Verify the batch above in a client

Nothing above is proven until it flies. The checks are listed per item.

### Comets beyond sector 10

The timer only runs where a sector template asks for it, and only sector 10's does (upstream's
own). `emit-sector-templates.js` can emit a `cometSectorDesc` per generated sector; do a handful
first and watch for per-tick sector errors before turning it on galaxy-wide, since a comet kills
any ship it touches.

### The Outpost Mode beacon half

The wiki remembers Outpost Mode as a fleet jump beacon as well as a fortress: "allows all ships in
his group to jump to the carrier". Only the fortress half ships. `RequestJumpToBeacon` is an
explicit not-implemented stub upstream, so the beacon needs real work - the existing `GroupJump`
machinery is the obvious vehicle.

## Balance, once the above settles

Hull points now span 850 on a Viper Mk II to 100,000 on a flagship, and the equipment ladder is the
original's own rather than a tier multiplier. Nobody has timed kills across tiers with a person in
the cockpit. The capitals are the open question: a twelve-bay Pegasus against a Viper's four guns
may be correct for a battlestar or may be unplayable, and only play will say. The flagships carry
eight bays to that twelve and lean on the FLAGSHIP stat block instead, so whether they still feel
like the step above is part of the same question.

Boss lairs pay six themed jackpots. Whether any of them is worth the fight is untested.

## Galaxy

All 58 accessible systems ship. Ids, names, guids, positions, threat levels and faction lockouts
are transcribed from the client; **sector contents are generated**. No source records where a single
asteroid sat in any system but 0, 6 and 10, so belts, clusters, junk fields and lairs are plausible
rather than recovered. The three upstream files are never regenerated.

`galaxy.js` holds the star table and `STAGE`, the number that grows the map; `emit-sector-templates.js`
writes the templates. They must move in the same commit â€” a star with no template on disk is a
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
`parseMessage`. Every hull is therefore `CanBeSold: false` â€” not a choice we made, and a live
footgun the day anyone wires it up, because `ContainerVisitor.sellItem` pays out on `CanBeSold`
alone with no second gate.

**Outpost retreat has no announcement.** `EmergencyMessage` does not carry text: the client wraps
whatever string it receives as `%$bgo.<s>.description%` and looks it up. Nothing in the client's
locale describes an outpost retreating, and no other broadcast writer renders literal text, so there
is no honest message to send. Passing a sentence renders the server-maintenance banner instead,
which is what used to happen on every outpost kill.
