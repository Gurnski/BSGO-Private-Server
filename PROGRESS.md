# Progress

Where this server actually is. Everything below marked **works** has been observed working against
a real client, not merely implemented.

Baseline: BSGOCore `23bad98a` + 13 patches + a 1,260-card generated catalogue.
Client: Unity 5.1.5f1 BSGO, protocol revision 4578.

---

## Works

**Login and account lifecycle.** Repeat logins, reconnects, and clean shutdown all preserve the
character. This took patches 0002/0004 (sessions) and 0007 (persistence) — before them you could
log in exactly once and a clean shutdown discarded everyone's session.

**Character creation.** Faction select → avatar → first spawn.

**Space.** Undock, fly, boost, FTL. The ship spawns, is visible, moves, and the camera sits behind
it. Every one of those was separately broken at some point; see *Hard-won details* below.

**Room / hangar.** Dock, walk the CIC, talk to the NPC, open the shop.

**Catalogue.** 1,260 cards stream to the client with no `Card should not be send because it's
null!` lines and no infinite loads.

**Galaxy and outposts.** All 58 accessible systems ship, with a generated sector template per
star. 26 outposts spawn at boot — verified by the spawn log line patch 0012 added — each ringed
by four faction-matched weapon platforms, and 31 contested systems are capturable through the
existing conquest mechanic (patch 0013).

**Mining.** Asteroids carry resources and respawn. XP now scales with asteroid size rather than
being a flat 50.

**Ship shop.** Fourteen hulls per faction across four tiers, correct art, correct names, correct
level gates, buyable.

---

## Partly working

**Combat.** Weapons fire and NPCs are targetable. Damage, death, loot award and NPC return fire
have not been end-to-end verified against a client.

**NPCs.** Bots spawn and fly. Aggro behaviour is untested.

**Missions.** Six templates generate and load. Completion flow untested.

---

## Not started

Guilds beyond what upstream ships · tournaments · ship upgrading (`MaxLevel` is pinned at 1
server-side, though the `UpgradeShip` path itself works) · ship scrapping (`ScrapShip` is a logged
no-op upstream and `RemoveShip` has no case in `parseMessage` at all).

---

## The roster

The complete roster: **fourteen hulls per faction**, tier 1 through the tier-4 carriers, plus the
command-token flagship.

| Hangar | Tier | Colonial | Cylon | Level | Price |
|---|---|---|---|---|---|
| 1 | 1 | Viper Mk II *(starter)* | Raider *(starter)* | 1 | 12 000 T |
| 4 | 1 | Raptor | Heavy Raider | 2 | 15 000 T |
| 7 | 1 | Rhino | Marauder | 3 | 18 000 T |
| 11 | 1 | Viper Mk VII | Cylon War Raider | 5 | 25 000 T |
| 17 | 4 | **Pegasus** | **Basestar** | 1 | 25 000 T |
| 2 | 2 | Scythe | Banshee | 7 | 60 000 T |
| 5 | 2 | Glaive | Spectre | 9 | 60 000 T |
| 8 | 2 | Maul | Wraith | 11 | 60 000 T |
| 13 | 2 | Halberd | Liche | 13 | 60 000 T |
| 3 | 3 | Aesir | Fenrir | 15 | 150 000 T |
| 6 | 3 | Vanir | Hel | 17 | 150 000 T |
| 9 | 3 | Jotunn | Jormung | 19 | 150 000 T |
| 14 | 3 | Gungnir | Nidhogg | 21 | 150 000 T |
| 15 | 4 | Brimir | Surtur | 24 | 420 000 T |

The table is in **queue order**, not HangarID order, because that is the order the shop renders
and the order the ShipList is emitted in.

**Why the order is load-bearing.** `ShipQueue.InitIcons` builds its order as
`1, 4, [16], 7, 11, [17], 2, 5, 8, 13, 3, 6, 9, 14, 15` — 16 and 17 spliced in only when a listed
ship carries them — then allocates `ships[shipCards.Count]` and pairs `ships[i]` with
`shipOrder[i]`, while `PeriodicUpdate` places each card at `shipOrder.FindIndex(HangarID)`. A
listed HangarID that is not in that order returns −1 and indexes `ships[-1]`; a count that exceeds
it runs off the end. Both throw on a *periodic update*, i.e. every frame from the moment you enter
the hangar, which reads as catastrophic lag rather than an error. The generator emits the list in
exactly that order and validates it.

HangarID also picks the **icon**:
`GUI/InfoJournal/Ships/{Human|Cylon}{HangarID}{_notbought|_upgraded}`, loaded and then dereferenced
with no null guard. Every id we use is verified present. 10 and 12 have no art in either faction —
which is why the ten NPC-only hulls (50–52, 54, 55, 74–76, 78, 79) are parked on **12**: authored,
because `sectorTemplate10` spawns six of them by guid and the ShipConfigTemplates pin all ten, but
out of every ShipList and unable to shadow a real hangar slot.

**The models are not a common scale, and the client never rescales them.** A Viper is ~10 units
across; a Pegasus is ~1170. So the collider radius, the World card radius and the camera zoom
range are all derived from one measured per-hull extent. A fixed zoom range — which is what every
hull had while the roster was tier-1 only — would put the camera 850 units *inside* a battlestar.

**Weapons exist at every tier**, because tier is a hull-class lock: the equip check demands the
system's tier equal the *active ship's* tier exactly, and the Store tab force-enables an
equipable-only filter it never clears. A tier-2 hull with only tier-1 weapons authored means an
empty shop and an invisible hold. Twenty-four weapons, six per tier, named from the client's own
strings (Light for tiers 1–2, Medium for 3, Heavy for the capitals).

### Tuning knobs

- **Level gates** — `LEVEL` in the roster block. The curve is `floor(sqrt(exp/1000)+1)`, so level
  21 is 400 000 XP. At 250 XP per NPC that is a long climb; halve the table if you want the whole
  roster reachable in a weekend.
- **The Pegasus and Basestar sit at level 1 on purpose.** In BSGO they were command-token
  flagships rather than a rank reward, and gating the best-looking ship in the game behind 400 000
  XP on a private server helps nobody. They cost 25 000 tylium.

---

## The card generator

`tools/cardgen/cards.js` is the centre of gravity of this project. It emits all 1,260 cards and, more
importantly, **encodes what the client will not tolerate**. It fails the build rather than let a
bad card reach a player, because the client has *no timeout on card loads* — a single malformed
card is an infinite loading screen with nothing in any log.

Run it after any card change and **fully restart** the server. Quarkus live-reload does not rebuild
the catalogue.

```sh
node tools/cardgen/cards.js          # BSGOCORE_PATH=... if BSGOCore is not a sibling
```

Validators, each earned by a real failure:

- every card carries all three keys (`cardGUID`, `cardView` int, `cardView2` enum name)
- `ObjectStat` and `StatView` names checked against the server's own enums
- complete flight-stat set on every ship (a missing one is `roll is NaN` every tick)
- ship-queue HangarID prefix invariant
- **paperdoll invariant** — a slot the server instantiates with no layout entry at that level is an
  unguarded NRE on three separate client refresh paths
- hardpoint names must be real transforms on that prefab (`Spot.FindSpots` drops misses *silently*)
- every slot's `ObjectPointServerHash` must have a matching spot on the World card
- slot types must be real `ShipSlotType` constants **and** have a matching `ShipSystem`
- ShipList entries must be `Level == 1` (`addShip` refuses `Level > 1` and returns *silently*)
- price values must be integers or negative powers of two, ≤ 2 currency components
- `CanBeSold` with an empty `SellPrice` destroys the item for nothing
- every loot/augment `cardGuid` must have a full `GUI` + `ShipConsumable` + `Price` set

`tools/cardgen/negtest.js` breaks each of these deliberately in a throwaway copy and asserts the
error surfaces — because a validator that silently never fires is worse than none. **14/14 caught.**

---

## Hard-won details

Things that cost hours and are not obvious from either codebase.

**Diagnosis rule.** Abrupt disconnect → read `server.log`. Infinite loading → read the client's
`output_log.txt`. They almost never both have it.

**Gson bypasses constructors.** Cards are allocated via `UnsafeAllocator`, so Java field
initialisers never run. Every reference-typed field the writer touches must be present in the JSON
or it is an NPE on write.

**Strings must be ASCII.** `writeString` prefixes `String.length()` but emits `getBytes()` — any
multi-byte character desynchronises the stream.

**Camera zoom.** `MinZoom`/`MaxZoom` *overwrite* the camera's entire range (client default 5..100).
`10..20` parked the camera inside a hull of radius 20, looking down. `DefaultZoom` is not read at
all when the card is applied.

**`GUI/Slots/<prefab>` does not exist.** That folder holds eleven chrome textures and no ship art,
so `Resources.Load` returned null silently and every ship fell through to the items_atlas fallback.
The real per-ship portraits are `GUI/InfoJournal/Ships/<Faction><HangarID>`.

**`IsUpgraded` is `Level == MaxLevel`.** At 1/1 that is permanently **true**, so owned hulls hide
the upgrade panel and render their `_upgraded` icon from the moment of purchase. Intended here.

**Hold capacity 70 is client-only.** The server has no cap, so loot can overflow to "(74/70)".

**Restricted sectors.** Each faction's home is closed to the other side — `CanJumpColonial` /
`CanJumpCylon` are server-only and never written to the wire.

---

## Licensing

BSGOCore is AGPL-3.0; the patches in `patches/` are derivative works of it and carry that licence.
This repository's original material — the card generator, tools, docs and config overlay — is MIT.

**No Bigpoint client code, assets or decompiled sources are in this repository, and none ever
should be.** You need your own copy of the client.
