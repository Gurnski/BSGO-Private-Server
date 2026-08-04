# BSGO Private Server

Battlestar Galactica Online shut down in 2019 and took its game data with it. The client shipped
with none of its own: no ship stats, no items, no sector layouts. Every card was fetched at runtime
from a server that no longer exists, and the card database was never published. Install the client
today and it connects to nothing, then waits forever.

This repo rebuilds that data, and the server fixes needed to run it. Right now that means 12,250
cards, 58 star systems, the original's full equipment catalogue, boss lairs worth bringing friends
to, two battlestars the live game never let anyone fly, the carriers' Outpost Mode, and an operator
console that can spawn any hull in the catalogue as a fighting NPC — so a Pegasus really can slug
it out with a Cylon outpost while you watch.

It does **not** contain the game. You need your own copy of the client.

## Built on BSGOCore

Everything here runs on [BSGOCore](https://github.com/luigeneric/BSGOCore) by
[luigeneric](https://github.com/luigeneric), an open-source reimplementation of the BSGO server
in Java (AGPL-3.0). The protocol, the sector simulation, movement, combat, persistence: all of
that is his work. This project is a layer on top of his server, not a replacement for it.

The server source lives in this repo at [`server/`](server/), imported as a git subtree so
luigeneric's full commit history and copyright ride along, with every change of ours as a
documented commit on top. Our [fork of BSGOCore](https://github.com/Gurnski/BSGOCore) stays
around as the vehicle for sending fixes back upstream.

What BSGOCore cannot provide is the game data, for the reason above: it was never published. A
fresh install has a working server with nothing to serve. That gap is what this repo fills, along
with fixes for the problems we hit on the way.

## What this repo adds

`tools/cardgen/` generates the card catalogue the server sends to clients: 12,250 cards covering
58 star systems, 14 hulls per faction from the tier-1 strikes up to the Pegasus and Basestar, the
original game's full equipment catalogue (219 systems as ten-level upgrade ladders, 175
consumables, 97 paints), skills, missions, the shop, and every resource type. The generator checks
each card against BSGOCore's own source and fails the build rather than emit a bad one, because the
client handles a bad card by hanging on the loading screen forever. It also writes a sector template
for each system, filled with belts, wrecks and boss lairs.

Our server changes are commits in `server/`; `patches/` keeps the same changes as standalone
patch files against pristine upstream, documented one by one in [PATCHES.md](PATCHES.md) with
the symptom each fixes. About half are bug fixes we offer upstream (see the fork); the rest are
choices that suit a small private server:

- the protocol-revision handshake the final client demands (without it, the client exits to
  desktop the moment it connects)
- reusable sessions and real persistence. Before these you could log in exactly once, and a
  clean shutdown discarded every player's progress
- guards against crashes and disconnects from missing stats, missing colliders and scene-load
  desync
- server-side checks against shop and avatar exploits
- mining respawn and XP fixes, plus economy tuning
- outpost spawning driven by the galaxy data instead of two hardcoded sector ids, which puts 26
  outposts on the map at boot and leaves 31 contested systems to capture
- the ability arms and armour curve that make imported equipment behave, so weapons that were
  decorative now hit, consume ammunition and are reduced by armour
- missile interception, rebuilt end to end. The client shipped the whole feature â€” missile
  brackets, a select-nearest-missile key, health bars â€” gated on server data that never enabled
  it. Enemy warheads are now real targets with real hull points; strike and escort guns can
  shoot them down, capitals rely on their flak and point-defence screens, and NPC screens sweep
  incoming missiles the same way yours do
- room NPCs, flagship rentals and the water-for-cubits exchange, all reconstructed from dialogue
  and message types the client still carries but upstream never sent
- an operator console grown out of upstream's debug protocol: `spawn` puts any hull in the
  catalogue into space as an armed, fighting NPC (`spawn_wing` rings up to twelve of them around
  you), with god mode, teleports and resource taps for testing alongside

`config/` holds hand-authored server config that upstream keeps out of git: collider templates
measured from the actual ship prefab meshes (bounding boxes for the capitals, whose old spheres
detonated missiles hundreds of units off the hull), the loot tables including six themed boss
jackpots, and the ship configs that arm every NPC, station and spawnable capital. Its own README
explains each.

For the rest, [QUICKSTART.md](QUICKSTART.md) covers setup and troubleshooting,
[PROGRESS.md](PROGRESS.md) records what has actually been seen working against a real client,
and [TODO.md](TODO.md) is what's next. This is an active project with plenty left to do.

One quirk makes all of this possible: the client never checks a content version. Card data only
has to be structurally valid, so it can be rebuilt from scratch. Asset names and localisation
keys are checked against the client's own tables, which is why ships display as "Viper Mk II"
instead of a raw key and prefabs resolve to real models.

## Status

Playable end to end: log in, fit a ship, fly out, fight NPCs, kill a boss, take a battlestar out
for an hour, or spawn one and referee. [PROGRESS.md](PROGRESS.md) has the detail. Everything
marked *working* below has been watched in a real client rather than merely validated; the rows
marked *deployed* landed too recently for that and are on the next flight's checklist.

| Area | State |
|---|---|
| Login, reconnects, persistence | working |
| Catalogue streaming (12,250 cards) | working |
| Character creation | working |
| Hangar, CIC, outpost rooms, shop | working |
| Space: undock, fly, boost, FTL, dock | working |
| Galaxy (58 systems, every reachable one contestable) | working |
| Sector content (45,849 placed objects: belts, wrecks, lairs) | working |
| Combat, damage, death, loot, XP | working |
| Equipment (219 systems Ã— 10 levels, 175 consumables, 97 paints) | working |
| NPCs with the original's own rank names | working |
| Boss lairs: level-120, 50,000-hull bosses with guard wings | working |
| Ship roster (14 hulls per faction, 4 tiers) | working |
| Capital rentals: Pegasus, Basestar, Galactica, Guardian Basestar | working |
| Water-for-cubits exchange | working |
| Mining | working |
| Missile interception: brackets, hull points, shoot-downs | working |
| Operator console: spawn NPCs, stage capital battles, god mode | working |
| Flak screens sweeping missiles, yours and the NPCs' | deployed |
| Rental clocks surviving a relog | deployed |
| Missions | partial: templates load and count, completion untested |
| Guilds, tournaments, ship scrapping | not started |

The Galactica and the Guardian Basestar were never flyable in the original game. They are here
because the models, the mounts and the names were all still in the client, waiting.

## Setup

You need JDK 21, Node.js, and your own BSGO client (protocol revision 4578, the final live
build). QUICKSTART.md walks through every step with the expected output; the short version:

```powershell
# 1. One clone gets everything, server included
git clone https://github.com/Gurnski/BSGO-Private-Server.git
cd BSGO-Private-Server\server

# 2. Server config
Copy-Item .env.example .env       # then edit: CLIENT_PATH, GAMESERVER_IGNORE_HASHES=true
New-Item -ItemType Directory -Force sqlite
bash certs/generate-certs.sh      # or generate cert.pem / key.pem however you like
Copy-Item -Recurse ServerConfigurationUtils_public ServerConfigurationUtils
Copy-Item -Recurse -Force ..\config\ColliderTemplates,..\config\LootTemplates,..\config\ShipConfigTemplates ServerConfigurationUtils\global\

# 3. Generate the card data (loca keys come from YOUR client and are never committed)
cd ..
node tools\cardgen\extract-loca-keys.js "<your-client>\assetbundles\locale.lang_en"
node tools\cardgen\emit-sector-templates.js
node tools\cardgen\cards.js

# 4. Run
cd server
$env:JAVA_HOME = "C:\path\to\jdk-21"
.\mvnw.cmd quarkus:dev
```

A healthy startup logs `size: 12250` (the card count) and `LoginServerEndpoint waiting for new
connections`. Anything else, see the troubleshooting table in QUICKSTART.md.

## Editing the data

Edit `tools/cardgen/cards.js` and re-run it. Don't hand-edit the generated JSON: one logical
thing (a ship) is 6 to 8 cards sharing a GUID across different views, and the generator keeps
them consistent. `tools/cardgen/negtest.js` breaks each validator on purpose in a throwaway
copy and asserts the error surfaces, because a validator that silently never fires is worse
than none.

Validation runs against BSGOCore's own source. Stat names are checked against the real
`ObjectStat` enum, and the resource list is read from `ResourceType.java`. Both checks exist
because a hand-maintained list had already caused a failure.

### Things that bite

Each of these cost real debugging time, and none of them fail loudly:

- Every card needs three keys: `cardGUID`, `cardView` (integer, used only for dispatch) and
  `cardView2` (string enum name, the field that actually binds). Get `cardView2` wrong and it
  silently becomes null, then NPEs at startup.
- Gson bypasses constructors, so Java field initialisers never run. Any reference-typed field
  the writer touches must be present in the JSON, or serialization throws and the server
  responds by closing the client's socket.
- An enum name used as a map key that isn't a real constant becomes a null key. Same outcome:
  abrupt disconnect, no client-side clue.
- Strings must be ASCII. The writer prefixes with `String.length()` but emits `getBytes()`, so
  a multi-byte character desynchronises the stream.
- The client has no timeout on card loads. A missing card doesn't error; the loading screen
  spins forever. The server log names the culprit:
  `Card should not be send because it's null! <guid> <view>`
- The client does not read index 0 for avatar defaults. It hard-indexes specific positions.
- Never edit `server/src` while the server is running under `quarkus:dev`. Dev mode watches the
  sources, and the attempted hot reload kills every sector thread while the login listener
  survives â€” the server looks up but nobody can spawn in. Stage the change, stop, sync, start.

The diagnosis rule that saves the most time: an abrupt disconnect is explained in the server
log. An infinite loading screen is explained in the client log. They almost never both have it.

## Licence and attribution

Original work in this repo (the card generator, the data it produces, the config overlay and
the documentation) is MIT licensed; see `LICENSE`.

Everything under `server/` is [BSGOCore](https://github.com/luigeneric/BSGOCore) by
[luigeneric](https://github.com/luigeneric) plus our changes, and stays **AGPL-3.0** under its
own [`LICENSE`](server/LICENSE); his commit history is preserved in this repo's history. The
patch files in `patches/` modify AGPL-3.0 code and carry that licence too.

**This project is not affiliated with or endorsed by Bigpoint.** It contains no game client, no
game assets, and no decompiled client code. Battlestar Galactica Online and its assets remain
the property of their respective owners. You must own a copy of the client to use any of this.

Proudly open source ~ Daniel Rea


