# TODO

Ordered by what unblocks the most. Each item says what is actually wrong, not just what to build.

## Broken now

### Sector 10 dies on a NaN and takes everything with it

Tannhauser throws `yaw is NaN` out of the movement simulation and does it constantly: 16,849 times
in one three-hour run, and 5,493 in a fourteen-minute run before that. It is not new and it is worse
than a log full of noise.

`Sector.run()` wraps the whole tick body in one try, so when `sectorMovementUpdater.run()` throws,
the collision pass, the ability queue, every timer, the removal queue and zone management are all
skipped for that tick. A sector in this state has no weapons firing, no NPC movement, no loot, and
no visibility updates. Anyone flying Tannhauser is in a dead room that still renders.

Two separate jobs. Find the object whose rotation is going NaN (the sector-10 field is upstream's
own, so it is likely a template value rather than the sim), and split the tick into per-phase try
blocks so one bad object cannot silence the other six phases.

### The sector-entry overlay still sticks

"Perform any action to enter the sector" was fixed on 4 Aug: both visibility gates accept the
never-started state, and `VisibilityTimer` lifts the ghost after ten seconds. It is still happening
in a live client (reported 5 Aug).

What is ruled out: the sector was healthy (29, ticking normally, the player was firing and looting),
`VisibilityTimer` is registered, and the log carries zero `ghost jump lifted from NOT_STARTED`
traces. So the lift is almost certainly being sent and the client is latching anyway. Next step is a
log line on the send itself plus a reproduction, because right now the server side looks correct and
that cannot both be true.

## Unflown

Nothing here is proven until it flies.

### From 5 Aug, the outpost and NPC pass

- **Outposts shoot in all directions.** Their four missile launchers carry a 90 degree arc against
  hardpoints mounted three to starboard and one to port, so only ever one hemisphere could answer.
  Stations now ignore firing arcs entirely. **Check:** sit off an outpost's bow and its stern, and
  confirm all four launchers engage from both.
- **Capitals fight beam-on.** The capital cannon arc went from 180 (meaning "anywhere") to 65, and
  NPC capitals now steer 90 degrees off the bearing and circle instead of pursuing nose-first.
  **Check:** watch a Kraken or Poseidon engage. Does it circle at a sensible radius, or wander?
  This is the change most likely to look wrong.
- **Player carriers are affected too.** Brimir, Pegasus, Galactica, Surtur, Basestar and Guardian
  share that cannon and those flank hardpoints, so they must now turn to bring guns to bear.
  **Check:** whether a capital still feels worth its rental. If not, the bosses can move to their own
  cannon card and leave the players' alone.
- **Flak kills no longer fake a hit.** `ObjectLeftHit` names what was struck, and for a missile
  killed by damage it was naming the killer, so your own flak swatting a warhead read to the client
  as that warhead hitting you. No damage was ever dealt. **Check:** shoot down a missile and confirm
  the screen no longer shakes.
- **Ring platforms repair after 15 minutes.** Both partial losses and full wipes. A full wipe used
  to hit an unconditional rebuild inside the 5-second tick, so hitting a ring harder brought it back
  faster. **Check:** clear a ring, confirm nothing returns for 15 minutes, then that all four do.
- **NPC wings stopped brawling on spawn.** Both wings shared one z band and differed only in the
  sign of x, leaving 1,600 m between their nearest edges against 1,000-2,500 m of auto-aggro, and
  the Cylon wing sat 1,285 m from the Colonial outpost. They now take opposite corners: worst
  wing-to-wing gap 2,973 m, worst wing-to-enemy-outpost gap 4,401 m. **Check:** that a contested
  system is quiet until someone starts something.
- **NPCs level out after a fight.** The levelling code sat below an early return that skipped every
  ship without patrol objectives. **Check:** no capitals cruising at 40 degrees of bank.

### From 5 Aug, the galaxy pass

- **Outpost control survives a restart.** Table `sector_outpost_states`, migration V8, written at
  shutdown and after every console fill or clear, restored at boot with the star-flag seeding as
  the fallback for sectors with no saved row. Verified server-side over a full stop and start.
  **Check:** capture something, restart, confirm it is still yours.
- **The console drives outposts.** `outpost_fill [colonial|cylon|both] [<sectorId>|all]`,
  `outpost_clear`, `outpost_status`, `outpost_save`. Both arguments default, so bare `outpost_fill`
  fills the galaxy. The underlying machinery is verified but the command dispatch itself has never
  been exercised, because that needs an admin client. **Check:** run `outpost_status` first. If it
  prints the per-sector table, the other three are on the same path.
- **Outposts moved to opposite corners**, 8,204 to 8,528 m apart on a regular system against 5,100
  before. Spawn corridors gained clearance rather than losing it: 1,378 m from the nearest outpost
  ring, up from 450. The cost is that your own outpost is now a corner trip from undock, roughly 3.5
  to 4 km instead of 1.7. **Check:** whether that trip is tedious.

### From 4 Aug, still unconfirmed

Flak screens thinning missiles in both directions is confirmed working, indirectly: the phantom
screen shake could only happen if flak was killing warheads. The rest still wants eyes on it.

- An outpost missile reading 200 HP when selected (it was 15).
- The Pegasus's guns refusing a selected missile while a Viper's still track one.
- A missile detonating ~260 units off the Brimir's hull rather than at it, and a missile actually
  hurting a gate basestar.
- Every bay on a Galactica rendering a turret.
- A rental surviving a relog with time on the clock.
- Locked systems greying out their jump button.
- Comets in sector 10.

Outpost Mode's fortress half is confirmed: `Fortify ON for player 1` in a live session on 5 Aug.

## Next

### The Outpost Mode beacon

The wiki remembers Outpost Mode as a fleet jump beacon as well as a fortress: "allows all ships in
his group to jump to the carrier". Only the fortress half ships, and the missing half is missing
entirely rather than broken.

`SectorJumpTargetTransponderUpdate` exists as a class and is never constructed anywhere.
`ActivateJumpTargetTransponder` is an enum value with no protocol handler and no
`AbilityActionFactory` case, which is why `cards.js` deliberately drops the three jump-transponder
systems: the factory's default branch throws inside the sector tick.

So it needs the broadcast built and cleared on unfortify, death, dock and expiry, and a jump
destination wired into the jump flow. The second half is where the risk is, since a mistake there
strands players, and none of it can be tested without a client. Worth its own session with someone
online.

### Comets beyond sector 10

The timer only runs where a sector template asks for it, and only sector 10's does. Do a handful
first and watch for per-tick sector errors before turning it on galaxy-wide, since a comet kills any
ship it touches.

### Balance, once the above settles

Hull points span 850 on a Viper Mk II to 100,000 on a flagship, and the equipment ladder is the
original's own rather than a tier multiplier. Nobody has timed kills across tiers with a person in
the cockpit. The capitals are the open question, and the broadside arc has just changed the answer:
a twelve-bay Pegasus that has to turn to shoot is a different ship from one that did not.

Boss lairs pay six themed jackpots. Whether any of them is worth the fight is untested.

## Galaxy

All 58 accessible systems ship. Ids, names, guids, positions, threat levels and faction lockouts are
transcribed from the client; **sector contents are generated**. No source records where a single
asteroid sat in any system but 0, 6 and 10, so belts, clusters, junk fields and lairs are plausible
rather than recovered. The three upstream files are never regenerated.

`galaxy.js` holds the star table and `STAGE`, the number that grows the map; `emit-sector-templates.js`
writes the templates. They must move in the same commit: a star with no template on disk is a server
that does not boot.

On system size, since it comes up: the wiki says standard systems are 10,000 m across and only
Carillon, Exomera and 14 Toah are 40,000. That is what ships. Alpha Ceti's own upstream content
stops at 4,993 on x and 4,997 on z, which is a 5,000 half-extent to the metre. The one contradiction
is Tannhauser, whose upstream content reaches 7,368 and therefore cannot fit the wiki's figure,
which is why it carries a hardcoded 16,000 floor. `sizeM` in the star table is a blanket 10000 on
every row, so it is a placeholder rather than per-system data.

Still open here:

- Sector 10's hand-placed 1,360-asteroid field remains the only genuine sector content in existence.
  Anything that recovers more of the real layouts beats the generator.
- `SectorSlotData` sends 100/100 slots for every sector always, so a pilot sees a live jump button
  on a system the server will refuse, then a bare "sector not allowed" with no explanation.
- Comets stay off in generated sectors.

## Known-unfixable, documented so nobody re-investigates

**Ship scrapping.** `ScrapShip` is a logged no-op upstream and `RemoveShip` has zero cases in
`parseMessage`. Every hull is therefore `CanBeSold: false`, which is not a choice we made, and a
live footgun the day anyone wires it up, because `ContainerVisitor.sellItem` pays out on `CanBeSold`
alone with no second gate.

**Outpost retreat has no announcement.** `EmergencyMessage` does not carry text: the client wraps
whatever string it receives as `%$bgo.<s>.description%` and looks it up. Nothing in the client's
locale describes an outpost retreating, and no other broadcast writer renders literal text, so there
is no honest message to send. Passing a sentence renders the server-maintenance banner instead,
which is what used to happen on every outpost kill.

**Weapon hardpoint rotations are render transforms, not aiming axes.** Nearly every hull stores its
guns at 90 degrees off the nose, fighters included, because the rotation orients the muzzle flash.
Firing direction comes from the mount angle measured against that weapon's own `Angle` stat, which
is a deviation limit and not a cone width. Anything that reasons about where a ship's guns point has
to ask the second question, not the first. This already cost one session: a broadside check built on
mount angle alone classified every NPC in the game as a capital.
