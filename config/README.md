# Config overlay

BSGOCore keeps `ServerConfigurationUtils/` out of git (see its `.gitignore:91`), so these
hand-authored files cannot ship as patches. Copy them over your unpacked
`ServerConfigurationUtils/global/` tree, preserving the directory names.

Everything under `JsonCards/` is **generated** — run `tools/cardgen/cards.js` instead, do not
hand-edit it. These files are the parts the generator does not produce.

`upstream-manifest.txt` lists the files the upstream unpack itself provides. `cards.js` reads it
to catch a hand-authored file that exists only in the live tree — that is how the outposts and
then the weapon platforms shipped unarmed, twice — and fails the build until the file is either
mirrored here or added to the manifest.

## ColliderTemplates/

One collider per flyable prefab, plus eight hand-measured station colliders. Strike and line
hulls are spheres, generated from each prefab's own hardpoint spread by
`tools/cardgen/extract-hardpoints.py`. The capitals are AABB boxes measured from the prefab
meshes by `tools/cardgen/extract-bounds.py`, because a sphere wide enough to cover a capital
bow-to-stern reaches far past its broadside, and the collider is what missiles detonate against:
the Brimir's old 428 sphere stopped missiles ~260 units off the hull, the Pegasus's 1174 sphere
~800. The extractor reproduces upstream's own basestar box to two decimals, which is how we know
the two measurements agree on method.

A missing ColliderTemplate is not a warning. `SectorJoinQueue` dereferenced it unguarded, threw,
and the player silently never spawned into the sector — no error client-side, just a load that
never finishes. The null-guard is in `patches/0003-sector-join-null-collider.patch`; these files
are what make the guard unnecessary in the first place.

The sizes are not uniform because **the models are not a common scale and the client never
rescales them**: a Viper is ~10 units across and the Pegasus's hull is over 1,800 long. The same
extent drives the World card radius and the camera zoom range, so a hull cannot end up with a
collider and a camera that disagree about how big it is.

| Prefab | Faction | Radius |
|---|---|---|
| `humant1command` | Colonial | 10 |
| `humant1defender` | Colonial | 10 |
| `humant1fighter` | Colonial | 10 |
| `humant1merit` | Colonial | 10 |
| `humant1multi2` | Colonial | 7 |
| `humant1stealth` | Colonial | 6 |
| `humant2command` | Colonial | 61 |
| `humant2defender` | Colonial | 61 |
| `humant2fighter` | Colonial | 61 |
| `humant2merit` | Colonial | 74 |
| `humant3command` | Colonial | 166 |
| `humant3defender` | Colonial | 216 |
| `humant3fighter` | Colonial | 258 |
| `humant3merit` | Colonial | 216 |
| `cylont1command` | Cylon | 10 |
| `cylont1defender` | Cylon | 10 |
| `cylont1fighter` | Cylon | 10 |
| `cylont1merit` | Cylon | 10 |
| `cylont1multi2` | Cylon | 7 |
| `cylont1stealth` | Cylon | 7 |
| `cylont2command` | Cylon | 61 |
| `cylont2defender` | Cylon | 61 |
| `cylont2fighter` | Cylon | 61 |
| `cylont2merit` | Cylon | 74 |
| `cylont3command` | Cylon | 216 |
| `cylont3defender` | Cylon | 216 |
| `cylont3fighter` | Cylon | 196 |
| `cylont3merit` | Cylon | 133 |

The capital boxes, measured 2026-08-04 (centre offsets are in the files):

| Prefab | Faction | Half-extents (x × y × z) |
|---|---|---|
| `humant4carrier` (Brimir) | Colonial | 163 × 92 × 384 |
| `humant4pegasus` (file `pegasus.json`) | Colonial | 365 × 157 × 907 |
| `cylont4carrier` (Surtur) | Cylon | 249 × 125 × 350 |

The `galactica` and `basestar` boxes come with the upstream unpack (see
`upstream-manifest.txt`) and are left alone. An old `basestar.json` sphere override (r=863)
lived here from the first import; it never ran — the live tree kept upstream's box — and it is
deleted rather than kept as a trap for the next fresh overlay.

The station colliders are `AABB` boxes, not spheres, measured from the client prefabs
(2026-07-31). `extract-hardpoints.py` does not produce them, so they only exist as these files:
`human_stationary_platform_{small,medium,large}`, `cylon_stationary_platform_{small,medium,large}`,
`humanoutpost` and `cylonoutpost`.

## LootTemplates/

| File | What drops it | Notes |
|---|---|---|
| `111_npc_fighter.json` | every NPC fighter in every sector | 250 XP, tylium + titanium, 25% water, 8% cubits — the **only** cubit faucet in the game |
| `114_npc_tier2.json` | NPC escort wings (threat 8+) | authored alongside the generated sectors |
| `116_npc_tier3.json` | NPC line wings (threat 14+) | authored alongside the generated sectors |
| `119_ancient_drone.json` | ancient drones | 900 XP |
| `121_boss.json` | 9 of the 46 lair bosses | the original jackpot: tylium + titanium + water, 60% cubit roll |
| `122_boss_tylium_vein.json` | 7 lair bosses | 130k tylium, thin on everything else |
| `123_boss_cubit_hoard.json` | 7 lair bosses | 4000 cubits and 1200 merits; merits past the daily cap convert to Uranium in `lootToUser`, so nothing is lost |
| `124_boss_ammunition_cache.json` | 9 lair bosses | ordnance, level-banded: heavy rounds/missiles at `[26,255]`, medium at `[0,25]` |
| `125_boss_ancient_cache.json` | 7 lair bosses | plutonium, FTL fragments, tuning kits, tech analyses |
| `126_boss_wrecker.json` | 7 lair bosses | titanium-heavy plus mines, flak and nukes |
| `5_outpost.json` | outpost kills | id 5 is upstream's own loot id for outposts; 6000 XP and a tylium-heavy payout |
| `101_weapon_platform.json` | weapon-platform kills | id 101, upstream's platform loot id; 1500 XP |
| `20_pvp.json` | player kills, ids 20–23 by victim tier | `lootPlayerSetup` looks up `20 + tier - 1`, so all four ids must exist or a PvP kill pays nothing |

The six boss templates all sit at 15000 XP, `chance` 1.0 and roughly the same total value, so which
one a lair carries is flavour rather than a farming target. `emit-sector-templates.js` picks per
sector from `(s.id + 3 * isCylon) % 6` — no draw from the layout LCG, so changing the list moves
only the two `lootId` fields per lair sector and leaves every rock where it was. The +3 offset means
the two lairs inside one contested sector never share a template.

The ids are not free choices: `20`–`23` is what the server computes from the victim's tier, and
`111` is referenced by guid from `sectorTemplate10.json`'s `botSpawnTemplates` and
`miningShipConfig.npcGuidLootIds`. `5` and `101` are the ids upstream puts on its own outposts and
platforms; without the files, `SpaceObjectFactory.getTemplateLst` filters both out on
`Optional::isPresent` — silently — so every station in the galaxy pays nothing on death, and the
`outposts_killed` counter can never increment because `CounterCardDistributor.outpostKilled` sits
inside the per-template loop. `122`–`126` were free to take: `StaticLootId`'s header reserves 1–99
for the server's own computed ids (including `3` for comets, whose file is parked behind a `!`
prefix and never loaded), and `LootTemplateReader` throws `Double Entry in LootTemplates!!!` on a
collision, which kills the whole template load at boot rather than the one file.

Every `cardGuid` in a loot template must have a full `GUI` + `ShipConsumable` + `Price` card set.
Without all three the row never finishes loading in the hold: blank tile, matched by no filter,
unsellable, and it occupies one of the 70 hold slots forever — the client has **no timeout** on
card loads. `tools/cardgen/cards.js` validates this for you and fails the build if it is violated.

## AugmentTemplates/

Ten `AugmentFactorTemplate` files, one per booster the shop stocks. **Generated** — run
`tools/cardgen/gen-consumables-real.js`, which writes them here and into the live tree at the same
time.

An augment card is only a label. `PlayerProtocol`'s `UseAugment` looks the guid up in
`AugmentTemplates`, insists the result is an `AugmentFactorTemplate` specifically, and returns after
logging `"No factor template"` if it is anything else. Without a file here the booster tab sells
buttons that do nothing.

`value: 1.0` means **+100%**, not ×1. `Factors.getMultiplierFor` folds the active factors starting
from 1.0, so a value of 1 doubles the rate. `Factors.getBoostLimiter()` is 2.0 and
`activateAugment` refuses anything above the remaining headroom, so nothing here may exceed 2.0.
Each file's duration and value are read off the client's own description string, so the tooltip and
the effect cannot drift apart.

Seven of the original's eighteen boosters have no file and ship with an empty `BuyPrice` instead:
three grant experience outright, three change skill-training time, and one is the FTL Override. The
server has no path for any of them — the reason for each is recorded next to its guid in
`tools/cardgen/gen-consumables-real.js`.

`augment_template_divine_inspireation.json` and `augment_template_green.json` are upstream files and
are not mirrored here.

## ShipConfigTemplates/

A ShipConfigTemplate is what arms an NPC. Without one, `setupWeaponConfig` returns early and the
ship is an unarmed punching bag.

Most of these are **generated** — `tools/cardgen/emit-npc-configs.js` writes the sixteen heavy-NPC
files (57/81, 60-65, 84-89, 90/91) here and into the live tree at the same time. Rerun it after any
change to hull slot layouts or to the weapon catalogue; it is idempotent.

The eight strike-wing files `colonial/{11,12,14,15}` and `cylon/{35,36,38,39}` are **upstream files
with one edit**, and they are mirrored here rather than left in the live tree because the live tree
is not in git. Upstream arms those NPCs with `4171922670` / `1798343138` (level 5 of two weapon
chains) and `3694197064` / `1320617532` (level 15). The equipment pass ships a ten-level ladder, so
the level-15 pair can never exist and the level-5 pair does not exist until W5 lands; all four are
repointed to the level-1 card of their own chain, `2645025994` and `271446462`. Without the mirror,
a fresh unpack of `ServerConfigurationUtils_public` reintroduces the originals and
`tools/cardgen/cards.js` fails with four "has no emitted ShipSystem card" errors — which is the
polite version of what happens otherwise: `ShipSystem.fromGUID` sits outside `setupWeaponConfig`'s
try at `SpaceObjectFactory.java:698`, so the throw lands on the first player to fly into that
sector, not at boot.

The eight station files `colonial/{200,202,204,206}` and `cylon/{201,203,205,207}` — per faction,
the outpost plus the light, medium and heavy weapon platforms — are **ours, not upstream**, and
were living only in the live tree, which meant a fresh unpack left every outpost and platform in
the galaxy unarmed. All eight are mirrored here now.

The eighteen missile mounts on the outpost and medium-platform files carry an explicit
`"consumableGUID": 218608438` (Heavy HE Warhead).
That is not decoration. Once the imported weapons went `ConsumableOption: Using`,
`FireMissileAction.getMissileGUID` started reading the loaded countable to choose which projectile
to spawn, and an empty slot gives it a null card: it logs, returns -1, and the mount never fires.
NPCs are exempt from the ammunition *check* — `AbilityAction.checkConsumablesSatisfied:143` returns
early for a non-player, and nothing is ever deducted — but they are not exempt from this, because
this is the shot itself rather than a check on it. `cards.js` errors on any config slot that arms a
`Using` missile launcher without matching ammunition.

The light and heavy platforms need no such entry. Their launchers (`6042`, `6052`) are
hand-authored `NotUsing` weapons, and on the `NotUsing` path `getMissileGUID` never reads the
loaded countable — it fires the default missile directly.

The six capital files `colonial/{5015,5017,5019}` and `cylon/{5115,5117,5119}` — Brimir, Pegasus,
Galactica and their Cylon counterparts — are **ours**, hand-authored for the debug console's
`spawn` command, which can put any hull in the catalogue into space as an NPC. These hulls are
player ships and had no config, so a spawned flagship was an unarmed punching bag that could only
ram. Each seats the rental stock (`6031` guns, `6034` launchers) plus a point-defence/flak pair
(`6032`/`6033`) on the defensive bays — all four are `NotUsing`, so no ammunition entries. Ids
equal ship guids, matching the directory's convention.

## Not included

The three sector templates (`sectorTemplate0`, `6`, `10`) are ~750 KB of upstream data with small
edits, so they are described in `PATCHES.md` rather than duplicated here.
