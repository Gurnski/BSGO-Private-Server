# Server patches

Thirteen patches against [BSGOCore](https://github.com/luigeneric/BSGOCore) at baseline
**`23bad98a`** ("Fix PulseManeuver, fix DynamicMovementController", #10).

Together they touch **18 files, +365 / −59**. Verified: applied in order with
`git apply --ignore-whitespace` to a clean worktree of `23bad98a`, the result is byte-identical
(modulo CRLF) to the tree this server actually runs.

## Why patches and not a fork

BSGOCore is AGPL-3.0 and actively developed. Patches keep our changes reviewable in isolation,
make it obvious which are bug fixes worth sending upstream (1, 3, 5, 6, 8, 9, 12) and which are
deployment choices that are only right for a small private server (2, 4, 11, 13), and let us rebase
without a merge history nobody wants to read.

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
undocumented.

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

`GameProtocol.java`, `MovementController.java` · 2 files, +8 −8

Eight unguarded `getStat` calls become `getStatOrDefault`.

**If missing:** an instant disconnect. `ObjectStats.getStat` returns a boxed `Float` from a plain
map lookup, so a missing stat auto-unboxes `null`:
`Cannot invoke "java.lang.Float.floatValue()" because the return value of … getStat … is null`.

**What this patch does not fix:** it converts the disconnect into a `0` stat, and
`MovementSimulation` then divides by `getRollMaxSpeed()` and NaNs every tick (`roll is NaN`). From
there it is a card bug — `tools/cardgen/cards.js` validates the full flight-stat set and fails the
build rather than letting it reach the client.

## 0007 — persistence and shutdown

`SqLiteProvider.java`, `GameServer.java` · 2 files, +157 −20

The largest patch, and the one that stops progress vanishing:

- `writeLocation` never persists `Disconnect`, and null-guards the previous location.
- `bulkWritePlayerToDb` gives each player its own transaction via
  `QuarkusTransaction.requiringNew()`, so one bad row cannot roll back everyone else's session.
- `fetchSkillBook` restores by **skill hash**, not serverID.
- `shutdownProcess()` bulk-writes every cached player. Upstream wrote only guilds — so a clean
  shutdown discarded every player's session.

Related upstream bug, **not** patched: `ApplicationBootstrap.onShutdown()` logs
`"shutdown already triggered"` and then **falls through** — no `return`.

## 0008 — launcher module binding

`ShipBindings.java` · 1 file, +6 −1

The guard around the binding loop accepted `weapon` only, but the `FireMissle` branch sits inside
it — so a launcher-typed slot could never emit a missile-pod binding and the pod simply never
appeared on the model. Widened to `weapon || launcher`.

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

`ContainerVisitor.java`, `ShopProtocol.java`, `PlayerProtocol.java` · 3 files, +21 −3

Four server-side holes, three of them reachable only from a modified client:

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

`OutpostSpawnTimer.java` · 1 file, +21 −2

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

---

## 0013 — outpost seeding from star flags

`SectorFactory.java` · 1 file, +33 −10

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

## Data changes that are not patches

`ServerConfigurationUtils/` is gitignored upstream, so config cannot ship as a diff.

- **`config/`** in this repo holds the hand-authored collider and loot templates. See its README.
- **`tools/cardgen/cards.js`** generates the whole `JsonCards/` catalogue (1 260 cards). Never
  hand-edit those files.
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
