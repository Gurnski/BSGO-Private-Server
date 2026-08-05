# Quickstart

Step-by-step setup on Windows, with the expected output at each step and a troubleshooting table
keyed to symptoms. Everything here has been executed and confirmed working against a real client.

You need:

- **JDK 21** (Temurin works; Maven itself is not needed — `mvnw` downloads it)
- **Node.js** (any recent version)
- **git**
- **your own BSGO client**, protocol revision 4578 (the final live build). This repo contains no
  game content and never will.

---

## 1. Get the code

The server source ships in this repo at `server/` — luigeneric's BSGOCore imported with its
full history, plus every change of ours as a documented commit (`PATCHES.md` explains each
one). One clone gets everything; the tools find the server tree automatically
(`BSGOCORE_PATH` overrides).

```powershell
git clone https://github.com/Gurnski/BSGO-Private-Server.git
cd BSGO-Private-Server\server
```

## 2. Server configuration

```powershell
Copy-Item .env.example .env
New-Item -ItemType Directory -Force sqlite
bash certs\generate-certs.sh      # or generate certs\cert.pem + key.pem however you like
Copy-Item -Recurse ServerConfigurationUtils_public ServerConfigurationUtils
Copy-Item -Recurse -Force ..\config\ColliderTemplates,..\config\LootTemplates,..\config\ShipConfigTemplates ServerConfigurationUtils\global\
```

Then edit `.env`:

- `CLIENT_PATH` — full path to your `bsgo.exe` (used by `runclient.bat`)
- `GAMESERVER_IGNORE_HASHES=true` — your client's MD5 is not in the allowlist

Why each step exists: every template reader hardcodes `ServerConfigurationUtils/` (without the
`_public` suffix); Flyway cannot create the DB in a directory that does not exist; the HTTPS
listener needs the certs; and the `config/` overlay holds the collider, loot and NPC arming
templates the server needs but upstream cannot ship (see `config/README.md`). Copy
`ShipConfigTemplates` in that same overlay step alongside the other two directories.

## 3. Generate the card data

The catalogue is generated, not shipped as JSON. One input comes from **your client** — the
localisation key list — because it is client-derived and is never committed to this repo.

```powershell
cd ..
node tools\cardgen\extract-loca-keys.js "<your-client>\assetbundles\locale.lang_en"
node tools\cardgen\emit-sector-templates.js
node tools\cardgen\cards.js
```

`cards.js` must end with `validation passed - 12250 cards`. It fails the build rather than let a
bad card reach a client, because the client has no timeout on card loads — a single malformed
card is an infinite loading screen with nothing in any log.

## 4. Run the server

```powershell
cd server
$env:JAVA_HOME = "C:\path\to\jdk-21"     # must be a JDK 21, not the system-default JRE
.\mvnw.cmd quarkus:dev
```

Healthy startup looks like:

```
size: 12250
INFO [io.gi.lu.ne.LegacyTcpLoginServerListener] LoginServerListener successfully started
INFO [io.gi.lu.ne.LegacyTcpLoginServerListener] LoginServerEndpoint waiting for new connections
INFO [io.quarkus] bsgo-core 1.0.0-SNAPSHOT ... started in 4.131s
```

`size: N` is the card count actually parsed — if the line is missing, the catalogue never loaded.

One error is **expected and harmless**:

```
ERROR [io.gi.lu.ch.ChatServerClient] Failed to connect to chat server: Connection refused ... :27052
```

The chat server is a separate component upstream does not provide. It is not needed to play.

Stop the server with **Ctrl-C**, not by closing the window or killing the process. Players and
guilds are written from the shutdown hook, and so is outpost control: who holds which system is
saved on the way out and restored at the next boot. Closing the console window gives the JVM about
five seconds, which is not enough to finish; a forced kill skips the save entirely and the galaxy
comes back seeded rather than as you left it.

## 5. Connect the client

```powershell
.\runclient.bat 127.0.0.1 en
```

`runclient.bat` reads `CLIENT_PATH` from `.env` and passes the server address as a launcher
argument — no client modification needed.

After editing any card data: re-run `cards.js` and **fully restart** the server. Quarkus
live-reload does not rebuild the catalogue.

---

## Troubleshooting

The one rule that saves the most time: **abrupt disconnect → read the server log. Infinite
loading screen → read the client's `output_log.txt`.** They almost never both have it.

| Symptom | Cause |
|---|---|
| Client exits to desktop the instant it connects, nothing in either log | Patch `0001` not applied — the client hardcodes protocol revision 4578 and calls `Application.Quit()` on mismatch |
| First login works, second hangs on "Loading… please wait a bit" forever | Patches `0002`/`0004` not applied — the session is consumed on connect and destroyed on disconnect |
| `size:` line missing at boot | `ServerConfigurationUtils/` missing or misnamed (step 2) |
| Loading screen spins forever, server log says `Card should not be send because it's null! <guid> <view>` | A card is missing from the catalogue — the log names it |
| Player never spawns into the sector, no error anywhere | Missing `ColliderTemplate` — the `config/` overlay was not copied (step 2) |
| Login works but nobody spawns into any sector; the log shows every sector thread throwing an uncaught exception at the same timestamp | A source file was edited (or `mvnw compile` ran) while the server was up — dev mode's hot reload kills the sector threads and leaves the login listener alive. Restart the server; never touch `server/src` while it runs |
| Abrupt disconnect, server log shows `Cannot invoke "java.lang.Float.floatValue()"` | A ship card is missing a stat — patch `0006` turns the crash into a default, and `cards.js` validates the full flight-stat set |
| `roll is NaN` every tick in the server log | Incomplete flight stats on a ship card — regenerate with `cards.js`, which validates this |
| Progress lost after a server restart | Patch `0007` not applied — upstream's clean shutdown wrote guilds only |
| Captured systems back to their starting owners after a restart | The server was killed rather than stopped with Ctrl-C, so the shutdown hook never wrote `sector_outpost_states` |
| A `patches/` file fails to apply to pristine upstream | Wrong baseline (`git checkout 23bad98a`) or missing `--ignore-whitespace` — only relevant when reviewing, the fork already carries them |
| Server does not boot, exception does not name a sector | A star in `galaxy.js` has no sector template on disk — run `emit-sector-templates.js`; validator V2a in `cards.js` catches this first and lists every missing id |
| Client build fails under `mvnw` | `JAVA_HOME` points at the wrong Java — it must be a JDK 21 |
| Every label shows its raw key (`BGO.HUB.MENU.SHIP_HANGAR`), client log says `Requested unknown asset 'locale_0.xml'` | The `+language` launcher argument matched no locale bundle (a typo like `e` for `en`) — the client loads an empty string table with no error. `runclient.bat` validates the code and falls back to `en` |
