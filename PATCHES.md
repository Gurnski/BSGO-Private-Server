# Server patches

These changes also live as one commit each on the
[`private-server` branch of our fork](https://github.com/Gurnski/BSGOCore/tree/private-server),
which is what you actually clone and run. This file is the annotated changelog; the `patches/`
files are the same changes as standalone diffs against pristine upstream, for review or reapply.

Twenty-three patches against [BSGOCore](https://github.com/luigeneric/BSGOCore) at baseline
**`23bad98a`** ("Fix PulseManeuver, fix DynamicMovementController", #10).

Together they touch **47 files, +2 163 / −151**. Verified: applied in order with
`git apply --ignore-whitespace` to a clean worktree of `23bad98a`, the result is byte-identical
(modulo CRLF) to the tree this server actually runs.

**0015–0020 are back-filled documentation**, not new work. Those fifteen files were changed across
earlier sessions and never added to `tools/mkpatches.js`, so the coverage check had been failing and
`patches/` had gone stale for 0006, 0007, 0008, 0010, 0012 and 0013 as well. Their entries below are
short on purpose: the reasoning for each lives in the code comments, which is where it is useful.

## Why patches and not a fork

BSGOCore is AGPL-3.0 and actively developed. Patches keep our changes reviewable in isolation,
make it obvious which are bug fixes worth sending upstream (1, 3, 5, 6, 8, 9, 12, 14, 17, 18, 19)
and which are deployment choices that are only right for a small private server (2, 4, 11, 13, 15,
16, 20), and let us rebase without a merge history nobody wants to read.

## Applying

```sh
git clone https://github.com/luigeneric/BSGOCore   # inside this repo's checkout; it is gitignored
cd BSGOCore
git checkout 23bad98a
for p in ../patches/*.patch; do
  git apply --ignore-whitespace "$p" || { echo "FAILED: $p"; break; }
done
```

`--ignore-whitespace` is not optional: several files in the checkout are LF while others are CRLF,
so a strict apply fails on line endings alone. That is a local artefact, not drift.

**0002 and 0004 are a coupled pair.** `0002` calls a `Session` constructor that `0004` introduces.
Either one alone leaves BSGOCore in a state that does not compile.

## Regenerating

`tools/mkpatches.js` regenerates the whole set from a modified BSGOCore working tree and **fails**
if any modified file is not covered by exactly one patch group — so a change can never ship
undocumented. It reads the working tree from `BSGOCore/` beside this file, or from `BSGOCORE_PATH`.

That tree is the clone described above with our changes applied on top; it is gitignored and not
part of a fresh checkout, so run the clone first or the script has nothing to diff. If you edit
`server/` directly, copy the touched files across before regenerating — `server/` is the tree that
runs, the clone is only the diff baseline.

---

## 0001 — protocol revision 4578

`LoginProtocolWriteOnly.java` · 1 file, +5 −2

The client hardcodes protocol revision **4578** and calls `Application.Quit()` on a mismatch —
before drawing anything. Upstream sends `3`.

**If missing:** the client exits to desktop the instant it connects, with nothing in either log.

## 0002 — session lifetime

`SessionRegistry.java` · 1 file, +12 −2

`TIME_SESSION_VALID` raised to one week, and preconfigured sessions are registered as reusable.

**If missing:** you can log in exactly once. The session is consumed on connect and destroyed on
disconnect, so the second attempt hangs on *"Loading… please wait a bit"* forever. This is what
made it look like the server had gone down when it never had.

Note the diagnostic subtlety: `removeExpiredSessions()` has no scheduler — it only runs from
`checkUserAlreadyLoggedIn()`, i.e. during a login attempt, and *after* `sessionHandling()` already
fetched the session. So the **first** failed attempt sweeps the session out mid-login and the
server replies with nothing at all (`User session is not present for registry`); only later
attempts produce `Login failed for session, could not find:`.

## 0003 — null collider guard on sector join

`SectorJoinQueue.java` · 1 file, +14 −1

A missing `ColliderTemplate` threw inside the join path.

**If missing:** the player silently never spawns into the sector — no error client-side, just a
load that never finishes. Upstream already treats colliders as optional three lines below
(`.filter(SpaceObject::hasCollider)`), so this mostly makes it self-consistent.

See `config/ColliderTemplates/` for the eight templates that make the guard unnecessary.

## 0004 — reusable sessions

`Session.java` · 1 file, +27 −2

Adds a `reusable` flag: `notifyClosed()` returns `Created` instead of `Expired`, and
`invalidateIfTimeUP()` skips the sweep.

## 0005 — Disconnect location in scene loads

`SceneProtocol.java` · 1 file, +16 −1

`sendLoadNextScene()` substitutes `getNonDisconnectLocation()` when the location is `Disconnect`.

**If missing:** `DisconnectLocation` writes **zero bytes**, so the client reads the next message's
header as scene data and desynchronises the whole stream. The guard lives in the writer rather
than the login path because `sendLoadNextScene()` has nine call sites.

## 0006 — getStatOrDefault

`GameProtocol.java`, `MovementController.java` · 2 files, +26 −8

Eight unguarded `getStat` calls become `getStatOrDefault`.

**If missing:** an instant disconnect. `ObjectStats.getStat` returns a boxed `Float` from a plain
map lookup, so a missing stat auto-unboxes `null`:
`Cannot invoke "java.lang.Float.floatValue()" because the return value of … getStat … is null`.

**What this patch does not fix:** it converts the disconnect into a `0` stat, and
`MovementSimulation` then divides by `getRollMaxSpeed()` and NaNs every tick (`roll is NaN`). From
there it is a card bug — `tools/cardgen/cards.js` validates the full flight-stat set and fails the
build rather than letting it reach the client.

`GameProtocol.java` also carries a **docking faction check** that has nothing to do with
`getStatOrDefault`. It rides here because a file can belong to only one patch group and this one
already owned it. `IsDockable` is a property of the card, so it means "this is a station", not "this
station will have you" — an attacker could sit inside an enemy outpost's guns and dock out on demand.
Harmless while outposts were scenery; the dominant tactic the moment they shot back.

## 0007 — persistence and shutdown

`SqLiteProvider.java`, `GameServer.java` · 2 files, +182 −20

The largest patch, and the one that stops progress vanishing:

- `writeLocation` never persists `Disconnect`, and null-guards the previous location.
- **The restore side of the same bug.** `fetchPlayer` applied `previousLocation()` as the *current*
  location and threw the persisted current one away, so the periodic snapshot wrote
  `previous_game_locations_id = Starter` and the next restart resumed the character into
  faction-select — where picking a faction calls `setupBasicHangar()` and re-rolls a finished
  character. The writer then refuses to save at all from `Starter`/`Avatar`, so the mangled
  character could never be persisted again either. This is why characters kept vanishing.
- Capital rentals expire at hangar load (see 0016), because there is no server-to-client
  remove-ship message to do it live.
- `bulkWritePlayerToDb` gives each player its own transaction via
  `QuarkusTransaction.requiringNew()`, so one bad row cannot roll back everyone else's session.
- `fetchSkillBook` restores by **skill hash**, not serverID.
- `shutdownProcess()` bulk-writes every cached player. Upstream wrote only guilds — so a clean
  shutdown discarded every player's session.

Related upstream bug, **not** patched: `ApplicationBootstrap.onShutdown()` logs
`"shutdown already triggered"` and then **falls through** — no `return`.

## 0008 — launcher module binding

`ShipBindings.java` · 1 file, +20 −1

The guard around the binding loop accepted `weapon` only, but the `FireMissle` branch sits inside
it — so a launcher-typed slot could never emit a missile-pod binding and the pod simply never
appeared on the model. Now widened to every weapon-bearing slot type: `weapon`, `launcher`, `gun`,
`defensive_weapon`, `special_weapon`. The capital families use the last three — our Pegasus (5017)
and Basestar (5117) carry six `gun` and two `defensive_weapon` mounts, so eight of their twelve
hardpoints rendered nothing at all. Widening cannot bind a non-weapon: the switch below leaves
`moduleGUID` at 0 for any ability that does not fire.

The same switch also dispatches the new `FireKillCannon` / `FireShotgun` / `FireMachineGun` and
`FireHeavyMissile` / `FireLightMissile` action types to the turret and pod bindings — the model side
of what 0014 does to the server side.

## 0009 — mining respawn and asteroid XP

`AsteroidResourceSpawn.java`, `AsteroidLoot.java` · 2 files, +26 −3

Two economy bugs:

1. The `minRedPercentage >= 1` branch `return`ed **without rescheduling**, unlike the
   `ResourceType.None` branch directly above it. One sector configured that way permanently killed
   its own resource-respawn chain: every asteroid stayed empty forever and mining paid nothing,
   with no error anywhere.
2. `AsteroidLoot.getExp()` was a flat `50` regardless of asteroid size, which made the safe home
   sectors pay ~3.7× the XP/hour of contested Tannhauser — the only thing HP changes is
   time-to-kill. Now `max(5, maxHp/20)`.

## 0010 — shop and avatar guards

`ContainerVisitor.java`, `ShopProtocol.java`, `PlayerProtocol.java` · 3 files, +106 −4

Five server-side holes, three of them reachable only from a modified client:

- `checkItemToBuy` validated only price, never `ItemType` — so a hand-crafted `MoveItem`
  shop→hold bought a `StoreShip` straight into cargo, bypassing the level and faction checks
  `addShip` performs. Ships are stocked only so `ShipQueue.UpdateShipCards` can see them.
- An **empty** `BuyPrice` made `isEnoughInContainer` iterate zero entries and return `true`.
  Empty now means *not for sale*, everywhere.
- `setupEventShop` stocked the three event boxes unconditionally, and they ship with an empty
  BuyPrice — unlimited free boxes for anyone who clicked buy. The trade-in window uses them as
  *currency* (`eventRessources: [11,12,13]`), not as goods.
- `CreateAvatar` gained the location guard `SetFaction` already had. Everything below it re-grants
  the starter resources, so replaying it from in-flight was a free-resource exploit.
- **`upgradeSystemByPack` gave away levels.** The tuning-kit odds are
  `packCount / (cubitsPrice / 1000)`, and the `UpgradePrice` was read straight out of the map with
  no check. A missing Cubits entry unboxes `null`; a Cubits entry at **0** divides by zero, so the
  chance is `+Infinity`, `Mathf.min` pins it to `1f` and the roll always succeeds. The method never
  charges the `UpgradePrice` at all — only the kits — so that is a guaranteed free level-up for one
  tuning kit. 136 of the 2 190 upgrade levels in the card dump price Cubits at exactly 0, so it arms
  itself the moment `UserUpgradeable` systems ship. No price, no pack upgrade. The ordinary cubit
  upgrade path is untouched.

Two of these files also carry **capital-rental** hooks: `ContainerVisitor` turns a rental pass into a
`rentCapital` call rather than an item, and `PlayerProtocol.rentCapital` charges the dynamic price
and seats the hull at an offset hangar id. They are here because those files already belonged to
this group; the rest of that feature is 0016.

## 0011 — economy tuning

`application.properties` · 1 file, +11 −5

The starting grant was 400 000 tylium + 40 000 cubits + 30 000 titanium. At this server's own peg
(1 cubit = 32 tylium, 1 titanium = 2 tylium) that is **1 740 000 tylium-equivalent against roughly
197 000 of buyable content in the entire game** — 8.8× everything, before you fire a shot.

Now 25 000 / 500 / 2 000 ≈ 45 000 T-equivalent, which clears one full tier-1 loadout (8 500 T)
with room to spare. It has to clear one: `Player.setupBasicHangar` hands out the starter ship with
**empty slots** and `Reward` card 1 has `shipItems: []`.

Faction change also drops from 75 000 to 5 000 cubits. The `%test.` / `%dev.` profile overrides
are deliberately left at 99999999.

---

## 0012 — outpost spawn diagnostics

`OutpostSpawnTimer.java` · 1 file, +151 −1

`spawnOp`'s catch block was empty. `createOutpost` throws `IllegalStateException` for exactly one
reason — the sector has no `Outpost` template of the requested faction — and the timer retries
every five seconds forever, so an outpost that could never appear produced **no error, no log
line, and no symptom other than its absence**.

Both base sectors were in that state from the day the server was first run. The base-sector branch
at `:43-56` spawns an outpost unconditionally, without consulting `OutpostState` at all, and it had
never once succeeded.

Now logged once per faction — the retry itself is by design, since the same timer is how a captured
sector's outpost appears — plus an `info` line on a successful spawn. That line is what verified
the whole outpost rollout.

The timer has since grown **the outpost's defence ring**, which is most of this patch's size. The
original's ladder (`Outposts.txt`): level 3 is two light sentries, 4 is four light, 5 is two medium
plus two light, 6 is four medium, 7 is two heavy plus two medium, 8 and up is four heavy. Ring
positions come from the sector template's own ring entries, the card guids swap with the tier, and
base-sector rings are pinned to heavy. Reconciliation runs on a level change and on a full wipe but
never on a partial kill, so shooting one platform means something while a ring destroyed outright
returns with its outpost. The tier guids must stay in step with `PLATFORM_GUID` in
`tools/cardgen/emit-sector-templates.js`, which authors those cards.

---

## 0013 — outpost seeding from star flags

`SectorFactory.java` · 1 file, +44 −11

`setupOutpostStates` seeded outpost points for two hardcoded sector ids: 27 got 3 000 Cylon points,
47 got 3 000 Colonial. Everywhere else started at zero, and `OutpostState.isOutPost()` needs 900
before an outpost spawns.

Replaced with the rule those two are instances of: **a system only one faction may hold an outpost
in starts held by that faction; a contested system starts empty and has to be taken.** Eligibility
comes from the star's `CanColonialOutpost` / `CanCylonOutpost`, so it cannot drift from the
GalaxyMap card or from what the sector template can honour.

Nothing else changes — `SectorOutpostProgress`, `OutpostDecreaseTimer`, the 900-point threshold and
the 60-minute block after a death all still run, and a seeded outpost can be destroyed and lost like
any other. With the full galaxy this puts **26 outposts on the map at boot and leaves 31 contested
systems genuinely capturable.**

The rule reproduces upstream's 27 (Spectris is cylon-controlled) but **not** its 47: our sources put
Vidofnir in the contested group. If that literal was load-bearing for a reason we have not found,
this is where it went.

---

## 0014 — ability dispatch and armour

`AbilityActionFactory.java`, `FireCannonAction.java`, `FireMissileAction.java`, `FlakAction.java`,
`SectorAlgorithms.java` · 5 files, +136 −8

Four changes that have to land together, because the systems the first one unblocks are weapons and
half of what a weapon does is decided by the armour curve.

**Five missing `AbilityActionType` arms.** `create` had fourteen cases and a `default -> throw`.
The throw escapes `AbilityCastRequestQueue.run` into `Sector.run`'s per-tick catch, which abandons
the remaining timers, the object remover and the zone update *for every player in that sector* — and
on a `Launch: Auto` weapon it does so every frame. `FireMachineGun`, `FireShotgun` and
`FireKillCannon` join `FireCannon`: their abilities carry only accuracy, angle, damage and range, so
they are hitscan guns under other names. `FireHeavyMissile` and `FireLightMissile` join `FireMissle`:
theirs carry `Speed`, `MaxHullPoints`, `LifeTime` and the six rotation stats, which is exactly the
projectile stat set `FireMissileAction` reads back when it spawns the round.

`FireLightMissile` has no user yet — its only family in the card dump is the Rocket Pack, dropped for
having all six rotation stats at zero. It is wired anyway so that fixing the pack is a card change
with no server change behind it. **Do not delete it as dead code.**

**`getMissileGUID` could return 0.** The `DamageNuclear` branch recognises `DamageHigh` 4.0 and 19.0
and nothing else, so any other nuclear countable — the three mines at 0.3, or anything added later —
fell out with the guid still 0, and `SpaceObjectFactory.createMissile` throws on a guid it cannot
resolve. Same sector-tick truncation as above, and reachable on purpose: `SelectConsumable` validates
neither `ConsumableType` nor `Tier`, so a crafted packet can seat a mine in a missile slot and hold
the fire button. Unrecognised now fires an ordinary missile and logs.

**Missile spawn stats, for interception.** The spawned missile takes the launcher ability's
`MaxHullPoints`, so a nuke flew with a standard round's 5 HP; the missile action now lets a
warhead's `MissileHullPoints` card field override it (the field is 0021's). Also here: the explicit
`setHp` unboxed a nullable `Float` (the `setMaxHpPp` a line later already does the job with safe
defaults), and `MaxPowerPoints = 0` made the stat *present*, which a client that selects the
missile renders as a NaN power bar — both gone.

**Weapon FX for the new gun types.** The fx byte in the shot message is the only thing that picks
the client's tracer prefab (`Weaponry.CreateWeapon`), and the client keeps dedicated ones the
server never named: `Fx/Guns/{Faction}SmallMachineGun` (with its own sound player),
`Fx/Guns/{Faction}SmallFlechetteCannon`, `Fx/Guns/ShrapnelGun`. Dispatched as plain `Gun`/`Flak`,
the stealth machine gun and the assault KKC rendered as single long cannon bolts and the carriers'
shrapnel burst as a flak puff. `FireCannonAction` gained a constructor that takes an explicit
`WeaponFxType`; the factory sends `MachineGun` for `FireMachineGun`/`FireKillCannon` and
`Flechete` for `FireShotgun`; `FlakAction` sends `Shrapnel` when the casting slot is a `gun` bay —
the shrapnel burst is the only Flak-type ability that lives in one. Plain cannons in a `gun` bay
(the carriers' long-range CC, the stealth 20mm autocannon) send `MachineGun` too: in the live
game they fired KKC-style tracer rounds, not a single bolt. The `Mothership` role is the
exception — the Pegasus and Basestar fired standard big bolts like any liner, so they keep the
Gun fx whatever sits in their gun bays.

**`ArmorAlgorithmV0` → `V1`.** V0 returns a constant 1 — armour discarded, `ArmorPiercing` inert,
every armour-plating module and every hull `ArmorValue` decorative. V1 is the original's curve,
`(100 − clamp(armor − armorPiercing, 0, 99.9)) / 100`.

> **This one changes damage numbers for every player and every NPC in every sector.** It is not
> confined to new content: 97 of the stat blocks the card generator already emits carry a non-zero
> `ArmorValue` and only 40 abilities answer with any `ArmorPiercing`, so most existing targets get
> harder to kill. It is a deliberate call, not a bug fix — without it the whole armour line of the
> equipment pass ships as items that do nothing. Revert by putting `ArmorAlgorithmV0` back on the
> single commented line in `SectorAlgorithms.defaultAlgorithms()`; nothing else moves.

---

## 0015 — galaxy update payload

`Galaxy.java` · 1 file, +45 −19

Upstream shipped a hardcoded dynamic-mission probe — an Ancient mission in sector 63 — with its
three siblings commented out. Sector 63 is not on our galaxy map, and
`GalaxyMapMediator.UpdateDynamicMissions` throws on the client every time it arrives: 37 unhandled
exceptions in one play session, each aborting the rest of that galaxy update mid-apply. That is what
left the sector-entry prompt on screen forever. Nothing computes dynamic missions yet, so we send
none. Restore it alongside a real generator, and only for sector ids that exist on the map card.

Also here, because it is the same file: live per-faction outpost counts, which is what the
capital-rental price in 0016 is calculated against.

## 0016 — capital rental

`Hangar.java`, `DialogProtocol.java`, `CapitalRental.java`, `CounterCardType.java`,
`CapitalRentalExpiry.java`, `CapitalRentalRegistry.java` · 6 files, +828 −20

`CapitalRental.java` is a brand-new file, which made it invisible to `git diff` and it originally
shipped in no patch — a fresh checkout built from the patch set alone would not compile.
`mkpatches.js` now stages intent-to-add on new files so this class of gap diffs and is covered.

The Pegasus and the Basestar are rented by the hour from Admiral Adama (Colonial) or Number One
(Cylon), exactly as the original did it — the capital is never sold in the shop, it is authorised in
the CIC. Charged in merits at the `CapitalRental` price, which falls as your faction loses the map.

**The dialogue is a real menu now.** `DialogProtocol` used to answer every `Advance` with one
hardcoded remark and treat the single reply index as "do everything": it ran the mission update
*and* silently attempted the rental, so the only visible outcome was assignments refreshing and
there was no way to ask for a flagship at all. It now tracks which NPC is speaking (set by
`RoomProtocol` on the talk request) and what stage the conversation is at, and builds the answer
list per advance: assignments for everyone, plus request-flagship → grant → confirm-or-cancel for
the one officer who may authorise it. Nothing is charged until the confirmation comes back, and a
player who cannot afford it gets the original's own "not enough merits" line instead of silence.

**The rented hull has to land on `serverID == HangarID`.** `CapitalRental` used to park it at
`30 + hangarId` to dodge a collision, which made the ship unreachable: `ShipCard.GetHangarShip`
scans the hangar for `HangarID == ship.ServerID`, and the hangar window lights a flagship button
only when `Game.Me.Hangar[variantHangarID]` resolves — so a paid-for Pegasus sat at slot 47 while
every lookup asked for 18, invisible and uncommandable. The offset is gone (and it is no longer a compile-time constant trap: as a `static final int` it
had been INLINED into `PlayerProtocol`, so changing it recompiled nothing and the ship kept
landing on the old slot until a clean build). The collision it dodged is gone too, because the capitals now hold a `HangarID` of their own (card data) instead of
sharing 17 with the stealth hulls, and they reach the UI as **variants** of the tier-4 carrier
cell. The hangar grid is a fixed 3×5 of tier × role with two hardcoded cells, so a tier-4
Mothership has no cell it could ever occupy directly.

The phrases are the original game's, still in the client's locale bundle
(`npc_adama.Phrase__35a28c51…__1` = "Requesting temporary command of the Pegasus, sir. [Command
Battlestar]", and Number One's Basestar equivalent). The client substitutes `%CapShipCost%` from
`Galaxy.CapitalShipCost` — which is why 0015 now sends the live rental price in the conquest-price
update instead of a hardcoded 9 999 that matched nothing the server would charge.

`Hangar.removeShip` exists for the expiry: if the rented hull was active, activation falls back to
any remaining ship so the index cannot dangle. There is no server-to-client remove-ship message, so
expiry is enforced at hangar load (0007) where the client rebuilds its hangar anyway.

**The rental clock survives a relog now.** Expiry rides in the player's counters keyed by the
rented hull's own ship guid, but `Counters.injectOldCounters` refuses any guid without a Counter
card and `addCounterOf` only touches pre-seeded guids — so the expiry write landed nowhere, and
the load sweep read the missing counter as 0 and deleted every rental as expired on the first
relog, with time still on the clock. The fix is one enum in this patch: `CounterCardType` gains
`capital_rental_{pegasus,basestar,galactica,guardian}` at the four ship guids plus
`capital_rental_return_slot` (234), and `cards.js` emits a Counter card per entry, which is what
seeds the counter and lets the persisted value back in.

## 0017 — NPC combat

`SpaceObjectFactory.java`, `NpcTimer.java`, `NpcDynamicTimer.java`, `NpcStaticTimer.java`,
`MiningShipNpcAssassinTimer.java`, `DynamicNpcSpawn.java`, `NpcBehaviourTemplates.java`,
`AbilityCastRequestQueue.java` · 8 files, +192 −33

Also in `NpcTimer`: the kill-objective fallback now skips removed targets — without the filter,
an assassin whose mining ship just died re-acquired the corpse every pass for the rest of its
lifetime, flying at nothing and enqueueing casts the queue then discarded. And in
`NpcDynamicTimer`: patrolling bots re-level (keep heading, drop pitch and bank) — before, a bot
whose target died kept flying its final attack vector until it happened to exit its patrol box,
so a lair boss that fought once cruised its lair visibly tilted forever.

Also in `SpaceObjectFactory`: player-fired missiles no longer get a loot association. It resolved
to an empty template list (no `1_*.json` exists), harmless while nothing could kill a missile —
now that they are shootable it would be live claim surface for no benefit.

**The reason NPCs never shot back.** `createBotFighter` arms a bot with its `OwnerCard`'s level, and
`getFirstBestConfigForGUIDAndLevel` demanded `config.level` equal that level exactly. Every NPC Owner
card is Level 1 while every shipped `ShipConfigTemplate` carries the NPC's *rank* — upstream
10/20/75, ours 15/25/45/120 — so the lookup matched nothing for every bot in the game and each one
spawned with zero armed slots, silently. Bots flew, chased and rammed, and never fired. Stations were
unaffected because they use the no-level overload, which is why only they ever fought. The level is a
preference now: exact match wins, otherwise any config for that hull.

The rest is the fallout of making that work — an unarmed bot now warns once per sector per run rather
than flooding, stale target-cache entries are pruned when a station leaves the sector, removed ships
stop casting and re-registering autocasts, and station aggro moved to 3 500 acquire / 4 000 leash so
that something which opens fire from just outside acquisition range is not dropped the moment it
drifts a metre further out.

Three spawn fixes joined later. `createBotFighter` assembled its objectives with a double-brace
initializer that constructed `KillObjective` and `DefendObjective` without ever calling `add()`, so
both were discarded and every bot spawned objective-less. Kill is wired in properly now; Defend stays
out because no timer reads it. The fix matters most for the mining-ship assassins, which had lost the
one target they exist for. Their spawn also changed: instead of inheriting the mining ship's rotation
(which carries the planetoid mining spot's surface tilt) at anywhere up to 1 000+ m out, they appear
level, facing the mining ship, within ~350 m — inside their 400 m auto-aggro, so they actually
attack. And wing bots no longer spawn via `Quaternion.randomRotation`, which despite the name returns
only identity or ±90° yaw; each bot gets its own uniform random heading.

## 0018 — outpost death and loot

`DamageMediator.java`, `LootDistributorUtil.java`, `LootClaimHolder.java`,
`SpaceObjectRemover.java` · 4 files, +83 −6

Also in `DamageMediator`: a missile shot to hull zero leaves with `Hit` (killer as the hit
object), not `Death`. The client only plays the missile explosion on `Hit` — on `Death` a missile
silently pops out of existence — and `Death` is the cause that arms the loot machinery, which a
missile must never enter.

An outpost at hull zero retreats rather than exploding — it leaves with `JumpOut`, which plays the
client's FTL-out — but it still has to pay out like a kill, and only for the shot that actually
removed it. Outpost loot arrives with a null `lootOwner`, and that null used to abort
`objectLeftUpdate` mid-drain and leave the removed object in the sector as a zombie: marked, still
ticking, client never told. Loot now falls back to the highest player damage dealer, and
`SpaceObjectRemover` logs a throwing subscriber and keeps draining instead of abandoning the remove.

## 0019 — collision resolution

`CollisionResolution.java` · 1 file, +53 −2

Missile × asteroid had no branch at all: the round fell through the whole if/else, was neither
removed nor detonated, and carried on through the rock while the asteroid took no damage. Both are
destroyed now, damage first so the asteroid dies by the normal path and still drops its resources.
Static × static threw instead of being ignored — there is nothing to resolve when neither body can be
pushed — and the warning it raised now fires once per pair rather than ten times a second.

Missile × Cruiser fell through the same way: `Cruiser` is in `getShipTypes()`, so the primitive
pass paired missiles against the sector-template gate capitals, and the resolution list then
didn't mention them — no damage, no `Hit`, the round flew on through the hull until its lifetime
ran out and vanished without an explosion, because the client only plays a missile explosion for
`RemovingCause.Hit`. Cruisers are in the list now. Guns always damaged them through the ability
path; missiles were the odd one out.

## 0020 — debug console

`DebugProtocol.java`, `SpaceSubscribeInfo.java` · 2 files, +648 −23

Operator commands: `where`, `npcs`, `heal` and `push <speed> [seconds]`. `push` is why
`SpaceSubscribeInfo` gained a live stat overwrite — the server clamps every client speed report to
the ship's max, so the stat has to move for the shove to survive. Nothing here is persisted and
ordinary gameplay never uses that setter; stats otherwise change through buffs and modifiers, which
the client is told about.

The second wave hooks up the GameBridge admin panel and adds spawning:

- `spawn <ship> [x] [y] [z]` — an NPC of any hull in the catalogue, resolved by guid or by a
  piece of its GUI key (`raider`, `dreadnought`, `brimir`…), armed and flying the same
  behaviour/patrol/loot recipe as a sector wave bot. Offsets are in the operator's ship frame
  (x right, y forward, z up); no offsets parks it off your bow with both hulls' radii of
  clearance. `spawn_wing <ship> <count>` rings up to twelve of them around you;
  `list_ships [filter]` prints what a name resolves to. Same-key grade families collapse to the
  base grade; hits on different keys are listed instead of guessed at.
- `spawn_missile` — your selected ship fires one standard round at YOU, statted like the
  post-retune outpost round (200 HP, 120 m/s). Exists to test interception on demand.
- `god_mode true|false` — billion-point hull/power and full heal; off recomputes the real stats
  from the hangar card via `applyStats`, the same call the rental arm path uses. Live ship only,
  like `push`.
- `tp <x> <y> <z>`, `tp_target` (arrives radii + 300 short of the hull), `hp <value>`,
  `kill_em_all`/`reset_mobs` (dead NPCs pay nothing without damage claims; the wave timers
  respawn on their own schedule).
- `self_buff` grew `heal` and `hp` (doubled max hull, live only); `dmg` explains why it refuses —
  damage lives on shared ability card templates a buff would poison globally.
- `resource` accepts both shapes the panel sends: `resource <type> <amount>` for yourself and
  `resource <player> <typeOrGuid> <amount>` for the Give button, which the old two-read parser
  silently misparsed.
- Panel buttons with no server side yet answer with a reason instead of silence: `spawn_mine`,
  `spawn_flare`, `to_zone`, `map_part`, `restart_sector`, `loot_target_x10`.

## 0021 — missile interception

`ShipConsumableCard.java` · 1 file, +12 −0

Enemy missiles are selectable and shootable, with visible hull points. The client ships the whole
feature — missile HUD brackets, a select-nearest-missile keybinding (Z), health bars fed by the
stats subscription, an explicit `Missile` ability-target flag — all gated on server data, and the
original data shipped with no ability group allowed to target missiles, which is also why point
defence never intercepted anything and the missile jammer jammed nothing.

One of those gates turned out to be our own card data: the four projectile World cards shipped
`showBracketWhenInRange: false`, and `HudIndicatorInfo.HasStaticIndicator` tests exactly that
flag before it ever reaches its per-type missile rules — so the client never created a HUD
indicator for any missile, and the indicator is the only thing a mouse click can practically land
on at missile sizes. The flag is true now; the client's own rules keep brackets enemy-only, so
your own volleys stay clean.

This patch carries the one file no other group owns: `ShipConsumableCard` gains a server-only
`MissileHullPoints` field (never written to the wire), so a nuclear warhead can give its missile
its own hull points — strike nukes 50, escort 100, line 200, capital and anti-carrier 400. It
cannot ride in `ItemBuffAdd`, which is a fractional multiplier, not an absolute. The rest of the
feature lives with its owning groups (0014 missile spawn, 0017 loot association, 0018 death cause)
and in card data: the Regulation card's target masks now include `Missile(8)` for every gun family,
flak and point defence, and `DeflectMissile` targets only missiles.

## 0022 — room NPCs

`RoomProtocol.java` · 1 file, +20 −3

The talk handler accepted exactly two names, `Apollo` and `Leoben`, and the Room cards listed
exactly those two — so every other character standing in a room was scenery. In the Colonial CIC
that meant Admiral Adama, Tyrol and Starbuck were lit, animated and completely unclickable, and
clicking the obvious "admiral" in the room did nothing at all. The outpost hangars listed nobody,
which is what put the flagship rental out of reach anywhere except the home CIC.

The real cast list is recoverable from the client: each room scene carries one
`camerabox_<name>` object per interactive character (`DialogCharacterInfo.FindCameraBox` resolves
against the same string `RoomLevel` uses to find the NPC). Decompressing the four room bundles
gives Apollo/Adama/Tyrol/Starbuck, Leoben/No1/No6/Sharon, Officer, and Sharon respectively. The
handler now gates on that set; the cast itself is card data in `cards.js`.

## 0023 — water for cubits

`PlayerProtocolWriteOnly.java` · 1 file, +18 −0 (the dialogue side lives in `DialogProtocol`, which 0016 owns)

Mining is the only source of water and this exchange is its only sink, which makes it the only
cubit faucet a pilot controls — and it did not exist. Upstream reserved the `WaterExchangeValues`
message id (60) and never sent it, so the client's `%WaterAmountExchange%`, `%CubitAmountExchange%`
and `%MaxWaterAmountExchange%` placeholders had nothing to read and the quartermaster had nothing
to say.

The writer sends the five fields `Gui/Tools.cs` binds those placeholders to, so the officer's own
phrases quote the real numbers. Rate and cast are the original's: **5 water to 1 cubit**
(`research/bsgo_wiki/Water.txt:6`), offered by Starbuck aboard the Galactica, Number Six aboard
the Basestar, and any outpost quartermaster — the four the wiki names (`:8-17`), which are exactly
the four 0022 made clickable.

The original's **280,000-per-week ceiling (`:18`) is deliberately not implemented.** It throttled
the live game's only cubit faucet for an economy with a cash shop behind it; this server has
neither, so ice is worth cubits without limit. Leaving it out also keeps the exchange stateless.

The quote is recomputed against the hold at confirmation, so mining or moving water between the
quote and the answer cannot pay out more than is actually carried.

---

## Data changes that are not patches

`ServerConfigurationUtils/` is gitignored upstream, so config cannot ship as a diff.

- **`config/`** in this repo holds the hand-authored collider and loot templates. See its README.
- **`tools/cardgen/cards.js`** generates the whole `JsonCards/` catalogue (11 696 cards). Never
  hand-edit those files. Most of that is the equipment import: 219 systems × 10 upgrade levels,
  with their abilities, prices and icons. The generated modules it reads —
  `systems-real.js`, `paints-real.js`, `consumables-real.js`, `hulls-real.js` — each have their own
  `gen-*.js` and are regenerated from the card dump, not edited.
- **Item restrictions are one constant.** `RESTRICTIONS_ENABLED` in `gen-systems-real.js` decides
  whether the catalogue's `ShipObjectKeyRestrictions` lists are the real per-hull ones or empty.
  Setting it back to `false` and re-running that script plus `cards.js` returns every item in the
  store to fitting every hull of its tier. It is the revert for anything the restriction lists turn
  out to break, and it covers the hand-authored avionics and role modules too — they read the flag
  the generator stamps into the module rather than carrying their own.
- **Sector templates** are generated, not duplicated. `tools/cardgen/emit-sector-templates.js`
  writes one template per star in `galaxy.js` and augments the three upstream files in place. It is
  idempotent and deterministic — re-running produces byte-identical output — and it is verified to
  reproduce the full live state from a pristine `ServerConfigurationUtils_public/` checkout.

  Run it in the same commit as any change to `STAGE` in `galaxy.js`. A star with no template on
  disk is **not** "a system you cannot visit": `SectorRegistry` builds every star inside its bean
  constructor, so it is a server that does not boot, with an exception that does not name the
  sector. Validator V2a in `cards.js` fails the build first and lists every missing id.

  What it does to the three upstream files, none of which it ever regenerates:
  - **all three** — one asteroid at `z = 35 980.51` removed from sectors 0 and 6, 3.6× their own
    half-extent. The server spawns it verbatim, the client calls that position empty space and pins
    its map icon to the rim, so it was real, loot-bearing and permanently unreachable. Deleted
    rather than repaired: the obvious fix (a dropped decimal) has nothing corroborating it.
  - **sectors 0 and 6** — gained the owning faction's `Outpost`, a ring of four weapon platforms,
    and both progress templates. Without the progress templates the outpost timers are never
    registered at all, so the base-sector force-spawn had been unreachable since day one.
  - **sector 10** — its four weapon platforms were scattered across the sector with no relation to
    either outpost, and all four were faction `Ancient`, which makes an outpost's own guns neutral
    toward the fleet attacking it. Replaced by two rings of four, faction- and model-matched.
  - `minRedPercentage` lowered from `1` to `0.3` in sectors 0 and 6, without which patch 0009's
    respawn fix is unreachable and mining yields nothing in both home sectors.

## Attribution

BSGOCore is © its contributors, AGPL-3.0. These patches are derivative works of it and carry the
same licence. This repository's own original material (the card generator, docs and config
overlay) is MIT — see `LICENSE`.

No Bigpoint client code, assets or decompiled sources are included here, and none ever should be.
