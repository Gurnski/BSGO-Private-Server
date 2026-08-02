# Config overlay

BSGOCore keeps `ServerConfigurationUtils/` out of git (see its `.gitignore:91`), so these
hand-authored files cannot ship as patches. Copy them over your unpacked
`ServerConfigurationUtils/global/` tree, preserving the directory names.

Everything under `JsonCards/` is **generated** — run `tools/cardgen/cards.js` instead, do not
hand-edit it. These files are the parts the generator does not produce.

## ColliderTemplates/

One sphere collider per flyable prefab — 28 of them, generated from each prefab's own hardpoint
spread by `tools/cardgen/extract-hardpoints.py`.

A missing ColliderTemplate is not a warning. `SectorJoinQueue` dereferenced it unguarded, threw,
and the player silently never spawned into the sector — no error client-side, just a load that
never finishes. The null-guard is in `patches/0003-sector-join-null-collider.patch`; these files
are what make the guard unnecessary in the first place.

The radii are not uniform because **the models are not a common scale and the client never
rescales them**: a Viper is ~10 units across and a Pegasus ~1170. The same extent drives the World
card radius and the camera zoom range, so a hull cannot end up with a collider and a camera that
disagree about how big it is.

| Prefab | Faction | Radius |
|---|---|---|
| `humant1command` | Colonial | 10 |
| `humant1defender` | Colonial | 10 |
| `humant1fighter` | Colonial | 10 |
| `humant1merit` | Colonial | 10 |
| `humant2command` | Colonial | 61 |
| `humant2defender` | Colonial | 61 |
| `humant2fighter` | Colonial | 61 |
| `humant2merit` | Colonial | 74 |
| `humant3command` | Colonial | 166 |
| `humant3defender` | Colonial | 216 |
| `humant3fighter` | Colonial | 258 |
| `humant3merit` | Colonial | 216 |
| `humant4carrier` | Colonial | 428 |
| `pegasus` | Colonial | 1174 |
| `basestar` | Cylon | 863 |
| `cylont1command` | Cylon | 10 |
| `cylont1defender` | Cylon | 10 |
| `cylont1fighter` | Cylon | 10 |
| `cylont1merit` | Cylon | 10 |
| `cylont2command` | Cylon | 61 |
| `cylont2defender` | Cylon | 61 |
| `cylont2fighter` | Cylon | 61 |
| `cylont2merit` | Cylon | 74 |
| `cylont3command` | Cylon | 216 |
| `cylont3defender` | Cylon | 216 |
| `cylont3fighter` | Cylon | 196 |
| `cylont3merit` | Cylon | 133 |
| `cylont4carrier` | Cylon | 428 |


## LootTemplates/

| File | What drops it | Notes |
|---|---|---|
| `111_npc_fighter.json` | every NPC fighter in every sector | 250 XP, tylium + titanium, 25% water, 8% cubits — the **only** cubit faucet in the game |
| `20_pvp.json` | player kills, ids 20–23 by victim tier | `lootPlayerSetup` looks up `20 + tier - 1`, so all four ids must exist or a PvP kill pays nothing |

The ids are not free choices: `20`–`23` is what the server computes from the victim's tier, and
`111` is referenced by guid from `sectorTemplate10.json`'s `botSpawnTemplates` and
`miningShipConfig.npcGuidLootIds`.

Every `cardGuid` in a loot template must have a full `GUI` + `ShipConsumable` + `Price` card set.
Without all three the row never finishes loading in the hold: blank tile, matched by no filter,
unsellable, and it occupies one of the 70 hold slots forever — the client has **no timeout** on
card loads. `tools/cardgen/cards.js` validates this for you and fails the build if it is violated.

## Not included

The three sector templates (`sectorTemplate0`, `6`, `10`) are ~750 KB of upstream data with small
edits, so they are described in `PATCHES.md` rather than duplicated here.
