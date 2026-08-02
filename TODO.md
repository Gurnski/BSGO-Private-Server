# TODO

Ordered by what unblocks the most. Each item says what is actually wrong, not just what to build.

---

## Next

### Verify combat end to end

Firing works and NPCs are targetable, but damage → death → loot award has never been watched
through a client. `20_pvp.json` (ids 20–23) and `111_npc_fighter.json` exist and validate, but
"the loot template loads" is not the same as "a kill pays out".

Check in this order: does an NPC take damage · does it die · does the corpse drop loot · does the
loot reach the hold · does XP arrive · does the NPC shoot back.

### NPC aggro and return fire

Bots spawn and fly. Whether they acquire and engage a player is untested. If they do not, players
have nothing to fight and the only cubit faucet in the game (`111`, 8% chance) never opens.

### Weapon and hull balance across four tiers

Hull HP now spans 850 (Viper Mk II) to 15 400 (Basestar), and cannon damage 18–720 per shot. Both
curves are derived from tier multipliers rather than hand-tuned, and nobody has timed an actual
kill at any tier. Expect this to need a real pass once combat is verified end to end.

The capitals are the open question: a Brimir has twelve slots against a Viper's four, so it fields
three times the guns *and* tier-4 damage. That may be correct for a capital ship or it may be
unplayable — it has not been tested with a person in the cockpit.

---


## Galaxy

All 58 accessible systems ship. Ids, names, guids, galaxy positions, threat levels and faction
lockouts are transcribed from the client; **sector contents are generated** — no source records
where a single asteroid sat in any sector but 0, 6 and 10, so the asteroid fields, planetoid
placements, spawn corridors and NPC patrol boxes are plausible rather than recovered. The three
upstream files are never regenerated.

`galaxy.js` holds the table and `STAGE`, the one number that grows the map; `emit-sector-templates.js`
writes the templates. They must move in the same commit — a star with no template on disk is a
server that does not boot, not a system you cannot visit. Validator V2a fails the build first.

Outposts: 26 spawn at boot, and 31 contested systems start unheld and are capturable through the
existing conquest mechanic. Weapon platforms ring their outpost four apiece.

Still open here:
- Sector 10's hand-placed 1 360-asteroid field is the only genuine sector content in existence.
  Anything that recovers more of the real layouts beats the generator.
- `SectorSlotData` sends 100/100 slots for every sector always, so a pilot still sees a live jump
  button on a system the server will refuse — a bare "sector not allowed" with no explanation.
- Loot templates 5 and 101 (outpost and platform drops) do not exist, so both pay nothing on death.
- Comets are off in generated sectors: sector 10 carries a `cometSectorDesc`, but the comet guid has
  never been confirmed to resolve to a full card set, and an unresolvable object is an exception on
  a timer in every sector at once.

---

## Known-unfixable, documented so nobody re-investigates

**Ship scrapping.** `ScrapShip` is a logged no-op upstream and `RemoveShip` has **zero cases** in
`parseMessage`. Every hull is therefore `CanBeSold: false` — not a limitation we chose, and a live
footgun the day anyone wires it up, because `ContainerVisitor.sellItem` pays out on `CanBeSold`
alone with no second gate.

**Ship upgrading.** Not wired server-side, so `MaxLevel` is pinned at 1 and `UpgradePrice` is
empty. The button is hidden anyway.

**Per-unit price formatting.** `GUIShopInventorySlot.cs:415` formats with `"#0.0"`, so tylium at
0.03125 cubits renders as **"0.0"** in the Store list. The confirm window is correct because
`Count` initialises to the purchase unit (32). Fixable only by moving tylium to 1/16 (formats
"0.1") and halving every cubit price.

**The Cylon tier-1 `BlueprintTexture` fields are swapped.**
`ship_heavy_raider_paperdoll_layouts` declares `BlueprintTexture: "cylont1defender"` and
`ship_scout` (the Marauder) declares `"cylont1command"` — both backwards. The prefabs' own child
meshes settle it: `CylonT1Defender_Marauder_Lod1` and friends, and the assetmap pairs
`cylont1command` with the heavyraider textures.

So: **`cylont1command` is the Heavy Raider and `cylont1defender` is the Marauder.** Take prefab
identity from mesh names, never from `BlueprintTexture`. The blueprint image shown on the paperdoll
is cosmetically wrong for those two and is unfixable server-side; do not "fix" it by swapping the
prefabs, which is what makes the two ships trade models.

**Sell-price quality asymmetry.** The client scales the displayed sell price by
`ShipSystem.Quality`; `ContainerVisitor.sellItem` has no quality term. Harmless while every weapon
is `Indestructible: true` (quality pinned at 1.0). In the player's favour if that changes.

**`ApplicationBootstrap.onShutdown()` falls through.** It logs `"shutdown already triggered"` with
no `return`, and two entry points reach it (`@PreDestroy` and the runtime shutdown hook). Upstream
bug, left alone deliberately — patch 0007 works around the consequence rather than changing
shutdown ordering.

---

## Housekeeping

- Sector templates are generated by `tools/cardgen/emit-sector-templates.js` rather than shipped:
  it is deterministic and idempotent, and is verified to reproduce the live state byte-for-byte
  from a pristine `ServerConfigurationUtils_public/` checkout. Re-run it after any `STAGE` change.
- `tools/mkpatches.js` fails if a modified BSGOCore file is not covered by a patch group. Run it
  after any server-side change.
- Run `tools/cardgen/negtest.js` after touching `validate()` — a validator that silently never
  fires is worse than none.
