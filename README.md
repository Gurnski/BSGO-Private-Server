# BSGO Private Server

Tooling, game data and server patches for running a private server for **Battlestar Galactica
Online**, the Bigpoint MMO shut down in 2019. This is a preservation project.

It does **not** contain the game. You need your own copy of the client.

---

## Standing on BSGOCore

This project is built on [**BSGOCore**](https://github.com/luigeneric/BSGOCore) by
[**luigeneric**](https://github.com/luigeneric) — an open-source (AGPL-3.0) reimplementation of
the BSGO server in Java. BSGOCore is the foundation of everything here: the protocol, the sector
simulation, movement, combat, persistence — all of it is luigeneric's work, and none of this
would exist without it.

What BSGOCore could not ship is the **game data**. BSGO's client holds no data at all — no ship
stats, no items, no sector layouts. Every card is fetched from the server at runtime, and that
card database was never published, so out of the box the emulator has nothing to serve. This repo
fills that gap, and fixes what we hit along the way.

## What this repo adds

- **`tools/cardgen/`** — generates the complete card catalogue BSGOCore serves to clients:
  **1,260 cards**, validated before a single byte is written. The full galaxy (**58 star
  systems**), a **14-hull roster per faction** from tier-1 strikes to the Pegasus and Basestar,
  24 weapons across all four tiers, skills, missions, the shop, and the full resource/currency
  set. It also emits a generated sector template for every system.
- **`patches/`** — **13 patches** against BSGOCore (18 files, +365/−59), each documented in
  [`PATCHES.md`](PATCHES.md) with the symptom it fixes. Roughly half are bug fixes we intend to
  offer upstream; the rest are deployment choices for a small private server:
  - the protocol-revision handshake the 4578 client demands (without it the client exits to
    desktop on connect)
  - reusable sessions and real persistence — before these you could log in exactly once, and a
    clean shutdown discarded every player's progress
  - crash/disconnect guards (missing stats, missing colliders, scene-load desync)
  - server-side exploit guards in the shop and avatar paths
  - mining respawn and XP fixes, economy tuning
  - outposts: spawn diagnostics, and faction seeding driven by the galaxy data rather than two
    hardcoded sector ids — 26 outposts on the map at boot, 31 contested systems capturable
- **`config/`** — the hand-authored server config the emulator needs but upstream cannot ship:
  28 collider templates measured from the actual prefabs, and loot templates.
- **Docs** — [`QUICKSTART.md`](QUICKSTART.md) (verified setup + troubleshooting keyed to
  symptoms), [`PATCHES.md`](PATCHES.md), [`PROGRESS.md`](PROGRESS.md) (what is actually verified
  working), [`TODO.md`](TODO.md) (what's next — this is an active project).

Because the client has **no content-version check**, this data does not have to match Bigpoint's
originals — it only has to be structurally valid. Asset names and localisation keys are verified
against the client's own tables, so ships display as "Viper Mk II" rather than a raw key, and
prefabs resolve to real models.

---

## Status

Working end to end: login → catalogue → character creation → hangar → undock → space, at full
framerate. See [`PROGRESS.md`](PROGRESS.md) for the full picture; the short version:

| Area | State |
|---|---|
| Login, reconnects, persistence | working |
| Catalogue streaming (1,260 cards) | working |
| Character creation | working |
| Hangar / CIC / shop | working |
| Space: undock, fly, boost, FTL | working |
| Galaxy (58 systems, 26 outposts at boot) | working |
| Mining | working |
| Ship roster (14 hulls per faction, 4 tiers) | working |
| Combat | partial — fires, untested end to end |
| NPCs | partial — spawn and fly, aggro untested |
| Missions | partial — templates load, completion untested |
| Guilds, tournaments, ship upgrading | not started |

---

## Setup

Requires **JDK 21**, **Node.js**, and your own BSGO client (protocol revision 4578).
`QUICKSTART.md` has the full walkthrough with expected output at each step; the shape of it:

```powershell
# 1. This repo, with BSGOCore cloned inside it (BSGOCore/ is gitignored here)
git clone https://github.com/Gurnski/BSGO-Private-Server.git
cd BSGO-Private-Server
git clone https://github.com/luigeneric/BSGOCore.git
cd BSGOCore
git checkout 23bad98a

# 2. Apply the patch set
Get-ChildItem ..\patches\*.patch | ForEach-Object { git apply --ignore-whitespace $_.FullName }

# 3. Server config
Copy-Item .env.example .env       # then edit: CLIENT_PATH, GAMESERVER_IGNORE_HASHES=true
New-Item -ItemType Directory -Force sqlite
bash certs/generate-certs.sh      # or generate cert.pem / key.pem however you like
Copy-Item -Recurse ServerConfigurationUtils_public ServerConfigurationUtils
Copy-Item -Recurse -Force ..\config\ColliderTemplates,..\config\LootTemplates ServerConfigurationUtils\global\

# 4. Generate the card data (loca keys come from YOUR client - they are never committed)
cd ..
node tools\cardgen\extract-loca-keys.js "<your-client>\assetbundles\locale.lang_en"
node tools\cardgen\emit-sector-templates.js
node tools\cardgen\cards.js

# 5. Run
cd BSGOCore
$env:JAVA_HOME = "C:\path\to\jdk-21"
.\mvnw.cmd quarkus:dev
```

Healthy startup logs `size: 1260` (the card count) and `LoginServerEndpoint waiting for new
connections`. If anything else happens, `QUICKSTART.md` has a troubleshooting table keyed to
symptoms.

---

## Editing the data

Edit `tools/cardgen/cards.js` and re-run it — don't hand-edit the generated JSON. One logical
thing (a ship) is 6–8 cards sharing a GUID across different views, and the generator keeps them
consistent and validates before writing. `tools/cardgen/negtest.js` proves each validator
actually fires by breaking things on purpose.

It validates against BSGOCore's own source: stat names are checked against the real `ObjectStat`
enum, and the resource list is read from `ResourceType.java`. Both of those checks exist because a
hand-maintained list had already caused a failure.

### Things that bite

Documented here because each one cost real debugging time, and none of them fail loudly:

- **Every card needs three keys**: `cardGUID`, `cardView` (integer, used only for dispatch) and
  `cardView2` (string enum name, the field that actually binds). Get `cardView2` wrong and it
  silently becomes null, then NPEs at startup.
- **Gson bypasses constructors**, so Java field initialisers never run. Any reference-typed field
  the writer touches must be present in the JSON or serialization throws — and the server responds
  by closing the client's socket.
- **An enum name used as a map key that isn't a real constant becomes a null key.** Same outcome:
  abrupt disconnect, no client-side clue.
- **Strings must be ASCII.** The writer prefixes with `String.length()` but emits `getBytes()`, so
  a multi-byte character desynchronises the stream.
- **The client has no timeouts on card loads.** A missing card doesn't error — the loading screen
  spins forever. The server log names it: `Card should not be send because it's null! <guid> <view>`.
- **The client does not read index 0 for avatar defaults.** It hard-indexes specific positions.

Rule of thumb: **abrupt disconnect → server log. Infinite loading screen → client log.**

---

## Licence and attribution

Original work in this repo (the card generator, the data it produces, the config overlay and the
documentation) is released under the **MIT Licence** — see `LICENSE`.

[BSGOCore](https://github.com/luigeneric/BSGOCore) is a separate project by
**[luigeneric](https://github.com/luigeneric)**, licensed **AGPL-3.0**. It is not vendored here —
you clone it yourself. The patches in `patches/` are modifications to AGPL-3.0 code and carry
that licence.

**This project is not affiliated with or endorsed by Bigpoint.** It contains no game client, no
game assets, and no decompiled client code. Battlestar Galactica Online and its assets remain the
property of their respective owners. You must own a copy of the client to use any of this.
