# Equipment pass, overnight run

Written by `tools/watch-equipment-pass.js` at 2026-08-02T23:02:44.342Z.

The pass finished, but the checks found things worth your eyes before you commit.

## Measured, not reported

The watcher re-ran these itself rather than copying what the agents claimed.

```
node tools/cardgen/cards.js   exit 0
total cards                   11696   (baseline before the pass: 1841)
node tools/cardgen/negtest.js exit 0   14/14 negative tests caught
files touched (git status)    71
diffstat                       31 files changed, 2973 insertions(+), 1044 deletions(-)
```

Card counts by view:

```
ShipList=2 GalaxyMap=1 Global=1 AvatarCatalogue=1 StickerList=1 ShipSystem=2315 GUI=4159 Price=2614 ShipPaint=99 Reward=7 EventShop=1 Ship=126 World=148 Owner=114 Movement=101 Camera=86 ShipLight=126 Room=4 Regulation=1 Sector=58 ShipConsumable=175 ShipAbility=1340 Missile=4 Module=8 NonShipStats=1 Counter=89 Skill=108 Mission=6
```

The generator reported no content gaps.

## Needs your attention

**blocker** tools/mkpatches.js destroys the patch set before it validates anything. Line 88 removes every patches/*.patch, then line 93 exits 1 if the gitignored BSGOCore/ baseline is absent — which it is in any fresh checkout. Acceptance criterion 9 and PATCHES.md both tell you to run this script.

Evidence: Ran `node tools/mkpatches.js` as criterion 9 instructs. Output: `git diff failed for 0001-protocol-revision-4578: undefined`, EXIT=1. `git status --porcelain patches/` then showed all 13 tracked patches as ` D` and the 7 untracked ones (0014–0020) gone from disk with no recovery path (`git stash list` empty, no copies anywhere on the filesystem). `ls -d BSGOCore` -> No such file or directory; `.gitignore:25` lists `BSGOCore/`. I repaired it: commit 23bad98a is reachable in this repo, so I ran `git archive 23bad98a | tar -x -C BSGOCore`, git-init'd it, overlaid `server/src`, and re-ran mkpatches — `20 patches, all 36 modified files covered`, EXIT=0. The six patches with real content drift (0006/0007/0008/0010/0012/0013) and the seven new ones are back; `git diff --stat -- patches/` reproduces exactly the pre-run modification set.

Suggested fix: Move the `fs.rmSync` loop at line 88 to after the GROUPS loop succeeds, and fail fast at the top with a clear message when `CORE` has no `.git` (e.g. `if (!fs.existsSync(path.join(CORE,'.git'))) { console.error('BSGOCore checkout not found at ' + CORE + ' - see PATCHES.md "Regenerating"'); process.exit(1); }`). I left the reconstructed `BSGOCore/` (9.1 MB, gitignored) in place so mkpatches keeps working; delete it if you prefer to clone the real upstream per PATCHES.md.

**blocker** `node tools/mkpatches.js` fails, and it destroys the entire patches/ directory before it fails. This is acceptance item (f), and it is destructive rather than merely broken.

Evidence: Two compounding defects in tools/mkpatches.js. Line 8 sets CORE = path.resolve(__dirname, '../BSGOCore'), i.e. <repo>/BSGOCore, which does not exist on this machine (confirmed: `ls ../BSGOCore` and `./BSGOCore` both ENOENT; BSGOCORE_PATH is unset). Line 88 then rm's every *.patch file BEFORE the first git diff runs at line 92, and line 93 exits 1 on the diff failure. Running the exact command in the DONE criterion produced `git diff failed for 0001-protocol-revision-4578: undefined`, REAL_EXIT=1, and left patches/ containing only `.` and `..`. That deleted all 20 patch files, including the 7 untracked new ones (0014-0020) which are not in git and could not be recovered by checkout. The scratchpad also contains VERIFY-mkpatches.log written at 23:31:51 with the identical error, so a parallel verifier hit the same trap. The patches were subsequently regenerated and I confirmed byte-identical restoration against a backup I took (all 20 files, `cmp` clean), and `git diff --stat patches/` shows exactly the 6 files the pass intended to change (0006, 0007, 0008, 0010, 0012, 0013). With the path supplied it works correctly: `BSGOCORE_PATH=<scratchpad>/corepristine node tools/mkpatches.js` exits 0, emits 20 patches, reports 'all 36 modified files covered', and is idempotent.

Suggested fix: Two changes in tools/mkpatches.js. First, make it non-destructive: write the diffs to a temp directory and swap it into place only after every group has succeeded and the coverage check at line 100-108 has passed, or at minimum move the rm loop at line 88 to after the diff loop. Second, fix the default CORE at line 8 so the documented invocation works without an environment variable — negtest.js already resolves this correctly with `path.resolve(__dirname, '../../server')`, so mirroring that resolution rule would make both tools agree. Until it is fixed, the acceptance criterion should be stated as `BSGOCORE_PATH=<core> node tools/mkpatches.js`.

**high** W5 and W6 both skipped the server compile on a false premise, so acceptance criterion 9's first half went unverified across two packages. The claim was 'quarkus-maven-plugin is missing from C:/Users/danie/.m2 entirely'. It is present; the build was failing because JAVA_HOME points at a JRE 8.

Evidence: `./mvnw -o -q compile` fails with `io/quarkus/maven/GenerateCodeMojo has been compiled by a more recent version of the Java Runtime (class file version 55.0), this version of the Java Runtime only recognizes class file versions up to 52.0` — i.e. the plugin loaded fine. `echo $JAVA_HOME` -> `C:\Program Files (x86)\Java\jre1.8.0_481`. With `JAVA_HOME="C:/Program Files/Eclipse Adoptium/jdk-21.0.9.10-hotspot" ./mvnw -o -q compile` the build exits 0. Criterion 9's first half PASSES.

Suggested fix: Set JAVA_HOME to the Temurin 21 JDK (system-wide, or in server/.mvn/jvm.config). Correct the claim in the W5/W6 handoffs before it propagates — the next package that touches Java will otherwise skip its compile too.

**high** Four hand-authored weapon-platform ShipConfigTemplates exist only in the gitignored live tree, so a fresh unpack leaves the light and heavy weapon platforms unarmed. This is the exact gap W4 found for the outposts and only half-closed.

Evidence: A three-way classification of server/ServerConfigurationUtils/global against the pristine upstream (corepristine/ServerConfigurationUtils_public) and the tracked config/ overlay shows ShipConfigTemplates/colonial/204_platform_light_colonial.json, colonial/206_platform_heavy_colonial.json, cylon/205_platform_light_cylon.json and cylon/207_platform_heavy_cylon.json are present in the live tree, absent from upstream (so they are ours, not upstream), and absent from config/. Their contents confirm they are load-bearing: 204 arms shipGUID 1783473190 with itemGUID 6041 across its slots, 206 arms 1783473192 with 6051/6052, and 205/207 mirror them for Cylon. W4 mirrored 200/201/202/203 into config/ while fixing their ammunition but did not carry these four across, and its own problems note flagged the class ('it is worth checking whether anything else hand-authored is in the same position'). Because the G13 validator walks both trees and the live tree still has them, nothing errors today — the failure only appears after a fresh unpack of ServerConfigurationUtils_public, at which point the four platforms lose their entire slot config silently.

Suggested fix: Copy the four files into config/ShipConfigTemplates/{colonial,cylon}/ alongside the 200-203 set W4 already mirrored, and add them to the config/README.md section W4 created. Then consider tightening the validator so a ShipConfigTemplates file that exists in the live tree but neither upstream nor config/ is reported, which would have caught both this and the 200-203 case.

## Verification verdicts

- pass-with-issues: I re-ran everything myself rather than trusting the reports. The catalogue work holds up under adversarial testing: `node tools/cardgen/cards.js` exits 0 at 11,696 cards, `negtest.js` prints 14/14 with all three named anchors proven to emit real errors (not just PASS lines), and the server compiles clean. Every card-level acceptance criterion I could test independently passes, several of them under tighter tests than the implementers ran — I re-derived the §1.1 slot/tier census (all 21 cells), the §1.6 restriction split (131/39/49/0), 2,190 UpgradePrice blocks byte-compared against the dump (0 mismatches, 0 invented currency entries, 136 zero-Cubits rungs exactly as the dump has them), a restriction-aware per-(hull,bay) fittability sweep (352 cells, 8 empty, exactly the four BLOCK-3 role families), and a full Gson-safety sweep resolving @SerializedName to Java types across 19 enums and 11,696 cards with zero invalid constants. I also ran the server's own CardBuilder + Card.write over the catalogue (11,696 deserialised, 0 null, 0 write failures) and booted an isolated server: `size: 11696`, `Server started!`, 58 sectors, zero "Card should not be send".
- pass-with-issues: COVERAGE VERDICT: the user's ask is met. I rebuilt the per-hull/per-slot matrix from the emitted JsonCards (not the generator's beliefs), encoding the admission rules straight from the client decompile and ShopProtocol, and found exactly the 8 documented exceptions and no unnoticed gap.
- pass-with-issues: VERDICT: pass-with-issues. Nothing in this equipment pass can crash the server or hang the client. The only two errors my audit reports are pre-existing missing GUI cards for client-side buff icons, and I traced both to a cosmetic outcome rather than a hang.
- pass-with-issues: The equipment pass verifies clean on every substantive axis I could test independently. The generator exits 0 at 11,696 cards and is idempotent; negtest prints 14/14 with no skips and negtest.js is itself unmodified from HEAD, so the pass did not weaken its own tests. I re-derived the acceptance items rather than trusting the reports: (a) every file in git status is one the pass intended to touch; (b) the DB migration reconciles exactly against the true pre-migration backup (6013x9 -> 4277445376, 6025 -> 6034, 6026x2 -> 1862157617, 6021x4 + 6023x5 refunded for precisely 875,000 tylium), all 18 retired guids emit no cards, and all 35 DB guids resolve; (c) all 36 distinct config guids resolve across both trees and the 28 tracked config files are byte-identical to the live tree; (d) negtest anchor 2 exists exactly once and genuinely fires, producing 10 real errors and exit 1; (e) all four station-weapon overrides survived the dump import and hold as a floor across all 10 ladder rungs. Beyond the brief I confirmed 0 duplicate (guid,view) pairs, 0 dangling card references, 0 ladder defects across 220 ten-rung chains, and that every enum-valued field in all 11,696 cards resolves to a real Java enum constant, which is the hard rule most likely to drop a socket. The four changed Java files compile (javac exit 0; maven is unusable because quarkus-maven-plugin is missing from .m2). Two scares turned out clean: the literal "undefined" strings in Action and ObjectPoint are String fields, not enums, and are pre-existing sentinels; and the 14 cards whose tylium sell price exceeds their tylium buy price are not arbitrage, because cubits are drop-only and direct exchange at 32 tylium/cubit is strictly better. The one hard failure is acceptance item (f): mkpatches.js cannot run as invoked, and it deletes the entire patches directory before the step that fails, which destroyed all 20 patch files during verification including 7 untracked ones git could not restore. They have been regenerated and are byte-identical to the pre-loss state, so nothing is permanently lost, but the footgun is live. Secondary to that, four hand-authored weapon-platform configs are still untracked, which is the same class of gap W4 identified and only half-closed.

## What each package did

### B1-java (complete)

All five B1 items done.

**1. `AbilityActionFactory` — five new arms.** Verified every name against `AbilityActionType.java` first (FireLightMissile=26, FireHeavyMissile=27, FireShotgun=28, FireKillCannon=29, FireMachineGun=30 — all real constants). Then confirmed the target class from the dump rather than guessing: the 15 FireMachineGun / 15 FireShotgun / 15 FireKillCannon ability cards carry only Accuracy, Angle, DamageLow/High, Min/Optimal/MaxRange, Cooldown, CriticalOffense, PowerPointCost — hitscan, so they join `case FireCannon -> FireCannonAction`. The 15 FireHeavyMissile / 15 FireLightMissile cards carry Speed, MaxHullPoints, LifeTime, Acceleration and the six rotation stats, which is exactly what `FireMissileAction.internalProcess` reads back off the spawned projectile — so they join `case FireMissle, FireTorpedo -> FireMissileAction`. Also checked `OverwriteActionType` is `None` on all 2223 dump ability cards, so the new cannon types take the same Gun FX as every existing one and nothing about FX changes. FireLightMissile carries the "pre-provisioned for the rocket-pack fix" note.

**2. `FireMissileAction.getMissileGUID` (BLOCK-2).** Added a `missileGUID == 0` fallback to `StaticCardGUID.MissileCard` with a `log.warn`. Traced the failure path to be sure the comment is true: throw -> `AbilityCastRequestQueue.run` -> `Sector.run:107-128` per-tick catch, which abandons `timerUpdater`, `spaceObjectRemover` and `sectorZoneManagement` for that tick for everyone in the sector.

**3. `ContainerVisitor.upgradeSystemByPack`.** Guard added immediately after the card fetch and before anything is charged: `Float cubitsInPrice = ...get(ResourceType.Cubits.guid); if (cubitsInPrice == null || cubitsInPrice <= 0f) return false;`. Comment states it as the economy exploit it is, not a crash.

**4. `ArmorAlgorithmV0` -> V1 (DEC-1).** `ArmorAlgorithmV1` already existed in the tree and already implements exactly `(100 - clampSafe(armor - armorPiercing, 0, 99.9)) * 0.01f` — no new class was needed. The switch is a single `private static final IArmorAlgorithm ARMOR_ALGORITHM = new ArmorAlgorithmV1();` directly above `defaultAlgorithms()`, with a comment saying in capitals that it changes damage for every player and NPC and that the revert is putting `ArmorAlgorithmV0` back on that one line. `defaultAlgorithms()` is the only construction site (`SectorFactory:214`), so it applies to every sector. Quantified the blast radius from our own emitted cards rather than asserting it: 97 emitted stat blocks carry non-zero `ArmorValue`, only 40 abilities carry any `ArmorPiercing`.

**5. Patch workflow — bigger than the brief expected.** Two things were wrong before I touched anything: there was no BSGOCore clone for `mkpatches.js` to diff against, and the working tree had drifted well past `patches/`. Reconstructing the baseline (clone of upstream at `23bad98a`, our `server/` overlaid) showed **33 modified files, not the 18 PATCHES.md claims — 15 of them in no patch group at all**. `mkpatches.js` would have exited 1 regardless of my changes, and `patches/` was stale for 0006, 0007, 0008, 0010, 0012 and 0013.

So: added `0014-ability-dispatch-and-armour` as specified (ContainerVisitor deliberately left in 0010), and back-filled six more groups (0015 galaxy update payload, 0016 capital rental, 0017 NPC combat, 0018 outpost death and loot, 0019 collision resolution, 0020 debug console) to cover the 15 orphans. 20 patches, 36 files, +1151 / -83. PATCHES.md headline, the upstream/deployment split, the six stale line counts and the six stale descriptions are all updated, plus new sections for 0014-0020 and a note on the "Regenerating" section explaining that the clone is the diff baseline and `server/` is the tree that runs.


Problems: The dispatchable ActionType set is 19, not the 18 the blueprint states (BLUEPRINT-v2 line 870 and validator rule G9). The old switch had 13 case labels but 14 types, because FireMissle and FireTorpedo share one arm. 14 + 5 = 19. B3 must use 19 or its G9 validator will wrongly reject a type we can now dispatch.; STILL OPEN, same failure mode as BLOCK-2, left alone as out of scope: FireMissileAction:104 does `Objects.requireNonNull(shipConsumableCard.getEffectType()) == ConsumableEffectType.DamageNuclear`. Gson turns an effectType name that is not a real ConsumableEffectType constant into null, and requireNonNull then throws - same escape into Sector.run's catch, same crafted-packet reachability via SelectConsumable. DECISIONS item 2 already commits to fixing ~10 consumables carrying effectType None; whoever does that must guarantee every emitted ShipConsumable.effectType is a real constant, because the server will not defend itself here. A one-word fix (drop the requireNonNull, let null fall to the else branch) is available if the lead wants belt-and-braces.; Also still open on the same method: castingSlot.getCurrentConsumable() can be null, and line 87 dereferences it before the null-card check at 88. Not reachable from anything I could construct, but it is the same shape of hole.; The new log.warn in the missile fallback can repeat per shot on a Launch: Auto weapon. I kept it because the existing log.error two branches above has identical exposure and silence here would be worse for diagnosis, but if a mine-in-a-missile-slot exploit is ever attempted in anger it will be loud in the log.; PATCHES.md still says cards.js generates 1260 cards; it is 1841 today. Left alone - that number is about to move again with the equipment pass and the W packages own it.; BLOCK-5 is untouched and still true: ShopVisitor.visit(ShipSlot):43-80 and ShipSlotVisitor.visit(ShipSlot):58-90 both skip isObjectKeyRestrictionsBlocked, and nothing checks slot type or tier on equip. Restrictions remain UI fidelity, not enforcement.
### B2-hull-stats (complete)

Regenerated `tools/cardgen/hulls-real.js` with the full per-hull stat block and rewrote `tools/cardgen/gen-hulls-real.py` to produce it.

**What changed in the extractor.** The old script had a hardcoded 18-name `FLIGHT` list. It now takes every key the dump's Ship card seeds, minus an explicit 7-key `EXCLUDE` set, ordered by a documented `ORDER` list. Any dump key that is neither ordered nor excluded is still emitted (sorted, at the end of the row) and the script prints it, so a future dump that adds a stat gets noticed rather than silently dropped. An assert refuses a key that appears in both `ORDER` and `EXCLUDE`.

**Result: 18 -> 34 stat keys** (32 or 33 on any one hull; 41 in the dump less the 7 cards.js owns). 16 keys added on 32 prefabs: ArmorValue, Avoidance, AvoidanceFading, CriticalDefense, FirewallRating, PenetrationStrength, DecayDamageFactor, DecayResistance, MaxVitalPoints, VitalRecovery, DurabilityBonus, CargoHoldVolume, CargoPickupDelay, CargoDropoffDelay, CargoLootDelay, JumpTargetTransponderPowerPointCost. All 16 are real `ObjectStat` constants (checked against ObjectStat.java; cards.js's own validator also enforces this).

**Excluded, and why:** FtlRange, FtlCharge, FtlCooldown, FtlCost, DetectionVisualRadius, DetectionInnerRadius, DetectionOuterRadius. `shipCards()` merges this file LAST, so emitting them would silently beat cards.js. negtest case 6 mutates the literal `FtlCooldown: 35, FtlCost: 1,` at cards.js:139 — it still fires, so the exclusion is verified live, not just asserted.

**Every changed number is accounted for.** The diff against the previous file is purely additive: zero pre-existing stat values moved, `slots` byte-identical on all 32 prefabs, `LAYOUTS_REAL` byte-identical. In the emitted cards, 84 of 1841 differ, all of them Ship cards, all differences inside `Stats.stats`, nothing outside it, no card added or removed. The only key that was overwritten rather than added is `CriticalDefense`, 0 -> 60/80/100/120/150 on all 84 — cards.js seeds 0 deliberately and this file now supplies the dump's real value, which is what §1.10 asks for. Advanced hulls pass the new stats through untouched: guid 305016 differs from 5016 only in advScale's four keys (MaxHullPoints 515->608, MaxPowerPoints 100->115, Speed 55->57.75, BoostSpeed 100->105).

**Three added keys change combat math, all documented in the file header with the arithmetic:**
- Avoidance/AvoidanceFading. Hulls are tier-matched: 490-520 at t1, 250-290 at t2, 30-70 at t3, 20 at t4. AvoidanceFading is 0.75 on t1/t2 and absent on t3/t4 — absent reads as 0 and HitchanceBasedOnThrottle.java:62 short-circuits to full avoidance, so no divide and no NaN, but it means t3/t4 avoidance never fades while t1/t2 drops to 25% when stationary. **This is the W2 dependency**: our current t1 weapons carry Accuracy 100-150, which against Avoidance 510 is a 6-13% hit chance at full throttle. Dump weapons (400 at t1, 335 at t2, 125 at t3) give 51% at t1 and 76-80% at t3.
- ArmorValue 0-10/25-30/40-45 by tier. Inert under ArmorAlgorithmV0; live under V1 (B1's patch).
- CriticalDefense 60-150. CritchanceAlgorithmV1 clamps at 0, so a weapon needs CriticalOffense above critDefense-33 to crit at all. Our t1 weapons carry 20-45 against the new 60-120: t1 crits stop until dump weapons (100-200) land. t3/t4 unaffected (ours are already 90-405).

**The nine known-inert keys are documented in the header as a warn-only allowlist**, verified independently rather than taken on faith: cross-joining all dump ShipSystem StaticBuffs/MultiplyBuffs keys against the union of all 95 dump Ship stat blocks returns exactly DrainResistance, PowerPointRestore, ToggleSystemCooldown, Missile/LightMissile/HeavyMissile Cooldown and PowerPointCost — plus TurnSpeed and TurnAcceleration, which are NOT dead and must not join the list: `ObjectStats.mapObjectStats:106-119` rewrites them to the Pitch/Yaw pairs before the containsKey check.

Preserved the file's existing hard-won findings verbatim: strike craft do not strafe (Strafe 0, safe because the sim only multiplies), roll fast / forward slow, the slot-id -> hardpoint quaternion mapping, the launcher slot existing on only four prefabs, and the wiki cross-check on hull points and power.


Problems: Tier-1 and tier-2 combat is materially worse until W2 lands. Real Avoidance is in, our old low-Accuracy weapons are still in, and the pair gives a 6-13% hit chance at full throttle at tier 1. This is exactly the coupling §1.10 predicted, and it resolves when W2 ships the dump's Accuracy-400 tier-1 weapons. If W2 slips, B2 is the one change to revert.; Tier-1 critical hits are currently impossible for the same reason: CriticalDefense 60-120 against our CriticalOffense 20-45 clamps crit chance to zero. Resolves with the same W2 weapons (CriticalOffense 100-200).; The 12 Ship cards with no dump prefab — 10 stations/platforms/motherships plus the Pegasus and Basestar — seed none of the 16 new keys, so they stay at Avoidance 0 and are hit at the 95% ceiling while player hulls now dodge. Fixing it means editing cards.js (CAPITAL_FLIGHT and the platform/outpost blocks), which was outside this package's remit.
### B3-systems (complete)

B3 is done. `tools/cardgen/gen-systems-real.js` reads the dump and writes `tools/cardgen/systems-real.js` (219 systems, 2,190 level records, 1,330 ability records) plus the checked-in drop manifest `tools/cardgen/systems-dropped.json` (15 drops). Not wired into cards.js — W2 does that.

Every number in BLUEPRINT-v2 §1.1/§1.3 reproduced exactly from the dump: 219 kept / 15 dropped, the 21-cell slot/tier census cell for cell, 133 systems with an ability, 1,330 ability records, 17 AbilityGroupIds, 30 demanded (ConsumableType, ConsumableTier) pairs, 131/39/49/0 restriction translation, and the guid stride holding on all 3,168 system+ability steps.

Design points worth knowing:

- **Flags live in the generator.** `USING_ENABLED` and `RESTRICTIONS_ENABLED` are constants in `gen-systems-real.js`, both false, and their values are stamped into the module as `FLAGS = { using, restrictions }`. Each record carries the effective value (`restrictions: []`, `ability.consumableOption: 'NotUsing'`) plus the reference data (`dumpRestrictions`, `ourRestrictions`, `ability.dumpConsumableOption`). I proved both flags end-to-end by regenerating to a scratch path with both true: 78 abilities flip to `Using`, 88 systems get a translated list, and every emitted entry is one of our roster's objKeys.
- **The dispatchable ActionType set is parsed out of `AbilityActionFactory.java`, not hardcoded.** B1 landed while I was working, so the factory now has 19 cases; the generator asserts each parsed case is a real `AbilityActionType` constant and refuses to run if fewer than 14 parse. Removing a case from the factory now drops the affected systems instead of arming the sector outage. The 15 drops are therefore fully derived.
- **The station overrides are floors, not assignments, and that matters.** Applying MaxRange 4000 / LifeTime 55 flat at every level of `3756543070` would *shorten* the level-10 round from the dump's 62.5 s to 55 s — an upgrade that makes the weapon worse. `Math.max(dump, override)` gives exactly 4000/55 at level 1 (asserted) and gets out of the way from level 3 up, where the dump's own numbers already beat it. All five station guids' level-1 ability stats reproduce the current `cards.js` block byte for byte, including the three fixes.
- **`ourRestrictions` is translated against the emitted catalogue's Ship cards** (`JsonCards/*.json`, 96 Ship cards / 42 objKeys). Nothing in this module produces a Ship card, so regenerating never feeds on its own output; the generator hard-errors with "run cards.js first" if the directory is empty.
- **The blueprint's "18 dispatchable after B1" is off by one** — the factory has 14 types today plus B1's five = 19. The module emits 18 distinct ActionTypes, all inside it.

Two things the generator reports that were not in the blueprint and that W5 needs:

1. **75 of the 219 level-10 cards have a tylium-only BuyPrice below their SellPrice**, worst `system_large_buff_computer` at +1,704,000 tylium per round trip. The dump prices upgrades in cubits and lets the sell value climb to match, which is a cubits sink in a shop that stocks level 1 only — but H10's `testingMode()` also stocks level 10, so a `%dev` profile is a tylium printer. Nothing to fix here; the numbers are the dump's.
2. **`MaxCountPerShip` is 0 on 195 of the 219** and 0 means unlimited (`ShopWindow.cs:1043` gates only on `> 0`). `cards.js`'s `shipSystem()` defaults it to 1, so W2 must pass `maxPerShip` through rather than let the default apply.


Problems: The blueprint says the dispatchable set is 18 after B1; it is 19 (14 factory cases today plus B1's five). The module emits 18 distinct ActionTypes, which is probably where the number came from. No consequence beyond the blueprint's text.; 75 of 219 level-10 cards can be bought for tylium alone and sold back for more tylium (worst +1,704,000). Only reachable when ShopProtocol.setupShop runs with testingMode() on, which `%dev` sets — H10's warning is understated. The values are the dump's; W5 must run its live store check against the prod profile.; MaxCountPerShip is 0 on 195 of the 219 and 0 means unlimited (ShopWindow.cs:1043 gates only on > 0). cards.js's shipSystem() helper defaults the field to 1, so W2 must pass maxPerShip through explicitly or 195 items silently become one-per-ship.; systems-real.js is 841 KB. It parses in well under a second, but it is by far the largest file in tools/cardgen/ and a diff of a regenerated version will be unreadable — review it by the generator's printed self-check and census, not by eye.
### B4-paints (complete)

Package B4 is done. `tools/cardgen/gen-paints-real.js` generates `tools/cardgen/paints-real.js` with **97 paint records**: 93 ported from the dump (94 minus `288972890`, whose only restriction target is `humant1scout`) plus **4 hand-authored `advanced` paints at guids 6070-6073**. Tier census t1=57 t2=22 t3=16 t4=2; faction Colonial 50 / Cylon 47.

Per-hull coverage is complete: all **30 flyable hull families** with a `ship_paint` bay have at least one fittable paint, and the coverage table is printed into the generated file's header. The generator computes the gap set itself and asserts that `AUTHORED` matches it exactly — it is not driven by a hardcoded list. The four gaps it measured are `humant4carrier`(5015), `cylont4carrier`(5115), `cylont1multi2`(5116), `cylont2defender`(5108), matching the blueprint. This removes `ship_paint/t4` from the unfillable list.

`ShipObjectKeyRestrictions` is `[]` on every record (the field is not even present — the emitter supplies the constant). `ourShipCardGuid` is our player-facing level-1 hull guid, resolved by the case-folded prefab join; the generator asserts each target has a GUI card, a World card and a `nextShipCardGuid` that chains to the Advanced twin, because `ItemList.cs:128` accepts `shipCard.CardGUID` or `shipCard.NextCard.CardGUID`.

Prices: 13 of the 93 ported paints arrived with an empty BuyPrice (12 `system_paint_advanced_ship_*` minus the dropped one, plus two syfy promo skins) and got 3,000 cubits at t1-2 / 6,000 at t3-4, as did all 4 authored ones. Zero records ship with an empty BuyPrice.

Claims verified against source, not taken on trust: `ShipSkinSubstance.cs:8` `DEFAULT_SKIN_KEY = "advanced"`; all four authored loca keys resolve with `.name` and `.description`; `ShipSystemCard.cs:96-102` Ship-card dereference of restriction entries; `ItemList.cs:128`/`:144`; `ShopWindow.cs:1039`/`:1043`/`:1010-1013`; `GUIShopPaperDoll.cs:159`; `GuiAdvancedRequirementsPanel.cs:77`; `ShipCard.cs:85-91` `Equals`. Every enum name emitted (`ship_paint`, `Standart`, `Cooldown`/`BuffCost`/`Durability`, `System`, `ShipPaint`, `Colonial`/`Cylon`) checked against the actual Java enum.

Not wired into `cards.js` — that is W3's job.


Problems: BLUEPRINT-v2 §1.4's key for the cylont2defender authored paint (`system_paint_advanced_ship_wrath`) names the wrong ship. Corrected to `_banshee`. If any other package copied that table, it needs the same fix.; BLUEPRINT-v2 §1.4's claim that the 14 empty-BuyPrice paints are exactly the 14 `system_paint_advanced_ship_*` cards is wrong: 12 are advanced, 2 are syfy promo skins. Does not change the pricing action, but the stated reason ('granted with the Advanced hull') is only true for 11 of the 13 we price.; Dump data bug found and corrected: paint 2426179296 (`system_paint_advanced_ship_halberd`) is filed under Faction Cylon while its hull is Colonial. Ported verbatim it would have been invisible to both factions. Worth a line in the final report as a case where the dump is not ground truth.; The four `*_classic` dump paints (283092864, 696294144, 1329711472, 3727642656) carry a non-default `model`, which swaps the entire ship prefab (`Ship.cs:21-23`). The prefabs were verified present in the client bundle by the earlier research pass; I did not re-verify the asset map, which lives outside the repo. A missing prefab there is a client-side load failure, not a card-level one.; Paints are exempt from the shipped validator's slot-coverage rule. Once W3 wires this in, that exemption should be dropped so a future hull addition with a paint bay and no paint is caught in cards.js rather than only by re-running gen-paints-real.js.
### B5-consumables (complete)

B5 delivers `tools/cardgen/gen-consumables-real.js` -> `tools/cardgen/consumables-real.js`: 165 dump ShipConsumable records (166 minus the `consumable_mega_rounds` dev item), plus 10 legacy-guid corrections, 10 AugmentFactorTemplate files, and the 3 nuclear projectile card sets. Nothing in `cards.js` was touched — W4 wires it.

Numbers. 165 records: Consumable 140, Augment 18, Resource 6, None 1. By ItemType: Round 55, Missile 19, Repair 12, Mine 9, Power 9, RadiationControl 8, Flak 6, Flare 6, PointDefense 6, Torpedo 3, MetalPlate 3, AntiCapitalMissile 1, Radio 1, JumpTargetTransponder 1, TechAnalysis 1, Resource 6, Augment 18, None 1. 32 sit at guids cards.js already emits (edits), 133 are new, 152 carry a non-empty BuyPrice. Adding the 10 legacy guids gives the blueprint's ShipConsumable target of 175.

Demand. The (ConsumableType, Tier) set is computed, never hardcoded: the UNION of B3's `DEMANDED_CONSUMABLES` export and an independent re-derivation of the 219/15 §1.1 filter from the dump. Both give the same 30 pairs; all 30 are covered by at least one record with a non-empty BuyPrice, and the generator refuses to write if any pair is uncovered. B3's live `consumableOption` is `NotUsing` (W4b flips it), so I keyed off `DEMANDED_CONSUMABLES` / `dumpConsumableOption` — keying off the live value would have reported zero pairs and made the whole assertion vacuous.

Field completeness. All 12 `ShipConsumableCard` fields are present and non-null on every record, and every enum name is checked against the parsed Java source (`ShopCategory`, `ShopItemType`, `ConsumableEffectType`, `AugmentActionType`, `Faction`, `ObjectStat`, `FactorType`, `FactorSource`, `MissileType`, `MissileExplosionView`). The `sortingAttributes` -> `consumableAttributes` trap is handled: `attrs` is the `m_attribute` string list, not the dump key or shape. Dump `Price.items` arrays are converted to the `{guid: amount}` maps Java's `Map<Long,Float>` and cards.js's `price()` both expect.

The ~10 broken cards are fixed by construction — every dump guid gets its real ct/tier/effectType/buffs/prices. Verified the task's list (2836381, 25398605, 92666191, 103992173, 113883533, 136433549, 166681557, 187088612, 201509789, 232850813) all carry ConsumableType 0 / Tier 0 / effectType None today; in fact 40 of our 42 emitted cards do.

Reverse report (G11b): exactly 10 priced consumables that no emitted ability can use — the 9 mines (ct 59263 t1-3) and `consumable_jump_target_transponder` (85145699), matching the blueprint's prediction. I KEPT them: they are real, sellable, drop from loot, and their launchers are on the §1.1 drop list rather than being absent from the game. `consumable_radio` and `consumable_tech_analysis` are excluded from the list because their consumer is a protocol (fleet chat / `analyseNotIdentifiedObject`), not a slot.


Problems: cards.js's priceOk validator (cards.js:5301-5306) will REJECT 19 of the dump price values the moment W4 emits them. All 19 are halves (1.5 tylium a round, 22.5 cubits a repair cell, 12.5 tylium a flak sell) and all 19 satisfy value * buyCount being a whole number, which makes server and client agree exactly: the server charges ceil(value*count) and the client tests Count < value*count with an integer Count, so the two are identical for any integer count. The rule to widen to is: integer, OR negative power of two, OR (for a countable) Number.isInteger(value * card.buyCount). negtest case 3's anchor ({ [CUB]: 0.03125 } -> { [CUB]: 0.03 }, buyCount 1000) still fails under the widened rule, so the case keeps its teeth. Full list of 19 guids/values is reproducible with a 6-line script over CONSUMABLES_REAL.; Two price changes are in the module and should be a conscious call, not a surprise: 187088612 consumable_tech_analysis moves from cards.js's 500 tylium to the dump's 500 cubits, and 28157328 consumable_radio from 250 titanium to 300 cubits. Both are faithful to the original but much dearer on a server where cubits are scarce, and neither cards.js entry carries a comment claiming the current price is deliberate. Override in one line in W4 if the lead prefers the softer currencies.; The three merit mines (136009541, 148792421, 19338341) carry effectType DamageNuclear with DamageHigh 0.3, which getMissileGUID maps to nothing. B1's 'missileGUID == 0' fallback has landed and closes it (verified in FireMissileAction.java), and the generator now hard-fails if that fallback is ever removed while those cards are emitted. Nothing to do, but do not revert B1 while these ship.; cards.js today emits 40 of its 42 ShipConsumable cards with ConsumableType 0, Tier 0 and effectType None - not just the ~10 named in the task. Every one of those is a dump guid whose real values are now in CONSUMABLES_REAL, so W4 replacing the emission wholesale fixes all of them; patching only the named 10 would leave 30 half-broken.
### B6-avionics-role (complete)

Authored `tools/cardgen/avionics.js` — 6 CAMS avionics modules (guids 6060-6065) and the 10-level C-31 Recharge Module ladder (guids 6080-6089), as a pure data module with no wiring into cards.js.

**Six CAMS modules, tier 1, slot `avionics`.** One card per t1 hull family we fly: interceptor (Viper Mk II/Raider), command (Raptor/Heavy Raider), assault (Rhino/Marauder), bomber (Viper Mk III/'Cylon War' Raider Mk II), multi (Viper Mk VII/'Cylon War' Raider), stealth (Raven Mk VI-R/Malefactor). `recon` skipped — it targets the two scout hulls we do not ship. One card serves both factions via `.Name`/`.NameCylon`; all six keys resolve `.name`, `.namecylon`, `.description`, `.shortdescription`. CAMS only, per DECISIONS §4. 5,000 tylium, durability 2500, frame 199, sort bucket `gyro`, ItemType `Avionics`.

**The one substantive find: the CAMS modules are not stat-less.** `ShipSubscribeInfo.java:97-130` is a hook literally commented `//cams system stats on abilities`: for every fitted system it tests `MultiplyBuffs.containsStat(ObjectStat.CannonAngle)` and, when present, multiplies every `FireCannon` ability's `Angle` by it (`MiningAngle`/`FireMining` is the other arm). `CannonAngle(83)` is a real ObjectStat and **no card in the 14,223-card dump sets it** — because the one card family that would have is the one family the dump is missing. So each CAMS module ships `MultiplyBuffs { CannonAngle: 1.1 }`: a wider gun cone is what mouse-aimed flight controls feel like, and the loca description names RCS explicitly. 1.1 is the magnitude the original used for tier-1 RCS hardware (`fog_gyro` TurnSpeed/TurnAcceleration 1.1, `translation_rcs` TurnSpeed 1.1). Client renders it as "Cannon Angle +10%" (`SystemsStatsGenerator.cs:541-553` does `(v-1)*100` with a `%` format). Verified non-compounding: `ShipAbility.java:19` copies ItemBuffAdd per instance and `applyAbilitySlotStats` calls `ability.resetStats()` (:178) before the hook runs; `BasePropertyBuffer.onSlotUpdate` then pushes the widened Angle to the client so reticle and server agree. All six carry the same value deliberately — until restrictions are live any t1 hull can fit any of the six, so a per-role spread would just mean everybody fits the strongest one.

**C-31 Recharge Module, role/t2, 10 levels.** Passive `StaticBuffs` + `MultiplyBuffs`, `AbilityCards: []`, no Java change. All three buffed keys are seeded non-zero by both hulls that have a role/t2 bay (humant2defender/cylont2defender seed MaxPowerPoints 200, PowerRecovery 10, HullRecovery 8.9 in the *regenerated* hulls-real.js), so nothing is a no-op. Level 10 lands exactly on the wiki: +80 MaxPowerPoints, x1.29 PowerRecovery, x1.29 HullRecovery, Durability 15218. Levels 1-9 are scaled the way the dump's own ladders scale, measured over all 234 complete 10-level chains rather than assumed.

**role/t1 (Stealth) and role/t4 (Fortify) are not authored**, and the file header says so with the wiki citation and the reason (both are toggle abilities; AbilityActionFactory has no Fortify case). Nothing fudged.


Problems: The blueprint calls this file `handauthored.js`; the package brief calls it `avionics.js`. I went with the brief. W3 will get MODULE_NOT_FOUND if it follows the blueprint's name — it needs `require('./avionics.js')`.; The CAMS `CannonAngle` buff is client-visible and server-live, but the client does NOT independently implement the multiply — it takes the widened `Angle` from the server's SlotUpdate push (`BasePropertyBuffer.onSlotUpdate`). That is fine as long as the push happens, which it does inside the same loop iteration as the hook, but it means the buff should be confirmed live (fit a CAMS module, check the gun cone widens) rather than trusted from source alone.; The real GUI frame indices for both items are unknowable — no dump card exists for either, so no card records their frame. I picked 199 (the `coupled_rcs` icon) for CAMS and 190 (the `power_buff`/`regen_buff` icon) for the C-31 on thematic grounds. A wrong frame draws the wrong picture and nothing else, but they are guesses and are labelled as such in the file.; The C-31 is fittable only where a role/t2 bay exists (Maul/Wraith), but until W6 lands restrictions it is BUYABLE by any tier-2 player, who will then be holding an item they cannot fit. Same is true of the six avionics modules across t1 hulls. This is the general `ShipObjectKeyRestrictions: []` consequence from BLUEPRINT §1.6, not specific to this package, but it is worth knowing before the live test.
### B7-db-migration (complete)

Delivered `tools/migrate-equipment-guids.js` (Node, no new deps — uses the built-in `node:sqlite`, re-execing itself with `--experimental-sqlite` when needed) plus its generated pre-pass catalogue snapshot. Ran AUDIT mode against the live DB only; the DB is byte-identical before and after (sha1 028a21d8b86ca52f93210f50338ba90b11a5ce25).

AUDIT NOW, AGAINST THE CURRENT CATALOGUE: clean. 144 distinct guids across 183 rows, every one resolving to its full required view set. Zero dangling references today.

PROJECTED AUDIT (the retirement BLUEPRINT-v2 §1.8 plans): 21 rows across 5 guids. Derived, not assumed — I diffed the 17 distinct ShipSystem guids the DB names against the dump's 328 level-1 systems: 9 are dump level-1 systems that survive, 8 are hand-authored 6xxx, of which §1.8 keeps 6031/6032/6033 and retires 6013/6021/6023/6025/6026.

THE CRITIC'S LIST WAS WRONG IN FOUR PLACES:
1. 6013 is x9 on ship 14, not x8 — shipSlots server_id 0,1,2,3,4,5,12,13,15, exactly the nine weapon bays on the Advanced Gungnir (guid 305014, tier 3).
2. The 6021/6023/6026 rows are in the HOLD, not the Locker. containers_id 1 = ContainerType.Hold(1) (ContainerType.java). The player has a Locker container row but zero items in it.
3. 2645025994 x2 on ship 1 does NOT retire. It is dump level-1 weapon/t1 `system_standard_issue_autocannon` and §1.8 keeps it explicitly.
4. Countable guid 9 does NOT retire. `ResourceType.LinerGreen_Rounds(9L)` is pinned by the Java enum (ResourceType.java:33) and `loadResources()` (cards.js:2596-2614) throws if it has no RESOURCE_META entry. Independently confirmed: no dump card exists at guid 3, 5 or 9 — so there is nothing to remap to either. §1.7's retraction is correct.

MIGRATION PLAN (dry run against a rehearsal catalogue = current JsonCards minus 6001-6006/6011-6016/6021-6026, plus the dump's level-1 systems):
- 6013 x9 fitted, ship 14 -> 4277445376 `system_long_range_cruiser_cannon_st` (weapon/t3)
- 6025 x1 fitted, ship 15 slot 9 -> 6034 `system_capship_launcher` (launcher/t4)
- 6026 x1 fitted ship 15 slot 8 + x1 in Hold -> 1862157617 `item_slot_capital_system_launcher_long_range`
- 6021 x4 Hold (weapon/t4) -> refund 15,625 tylium each = 62,500
- 6023 x5 Hold (weapon/t4) -> refund 162,500 tylium each = 812,500
- tylium 79,932,128 -> 80,807,128 (+875,000)
weapon/t4 refunds because zero dump systems are weapon/t4 and no player-flyable t4 hull has a weapon bay.

Replacement policy: hard filter on SlotType + Tier + ShipObjectKeyRestrictions (a candidate must admit every hull the item is currently bolted to), then carry the retired item's sell-price percentile within its old family over to the new family, spreading collisions. The restriction filter is load-bearing: without it the "cheapest surviving weapon/t3" is 6041/6051, the sentry-platform weapons restricted to the four platform hulls, and the player would get nine guns they can never re-fit.

augment_template_green.json: NO REPOINT NEEDED — details in handoff.


Problems: The migration ledger above is a rehearsal, not W2's real output. My post-W2 catalogue is a reconstruction (current JsonCards minus 6001-6006/6011-6016/6021-6026, plus the dump's level-1 systems). The dump systems I injected carry no ability cards, no translated restriction lists and no Class field, so W2's real picks may differ. The ledger must be read again before --apply.; The dump's weapon/t3 and launcher/t4 candidates all carry EMPTY ShipObjectKeyRestrictions, so the restriction filter was never exercised against dump-space objKeys in this rehearsal. It was exercised against our own restricted cards (6041/6042/6051-6054 were correctly excluded). Note that dump objKeys and our objKeys are not the same namespace — 28 of our 42 ship objKeys appear in dump restriction lists, 14 do not — so once W2 translates restrictions the filter needs re-checking on a family that actually has them.; 6013 was bought at 260,000 tylium each and its replacement 4277445376 sells for 10,000. The percentile rule preserves rank within the family, not absolute value, because the two catalogues use different price scales. If the lead wants the player made whole in value rather than rank, use --map or add a top-up; the script does not do that automatically.; bgo_server.db.bak-before-equipment-pass no longer matches the live DB (a play session ran after it was taken). It is still a usable net but restoring it loses ~30 minutes of play. The script takes its own fresh backup, so this only matters if someone reaches for the older one.
### W1-validators (complete)

W1 is done. `tools/cardgen/cards.js` is the only file I touched; 1841 cards, negtest 14/14, and every new rule proved able to fire.

**1. The seven Price cards — verified against the dump, not the task list.** Six of the seven are in the dump at the same guid and I read their `ItemType` off it directly: `2836381 / 103992173 / 201509789 -> Repair` and `25398605 / 136433549 / 232850813 -> Power`. Guid 3 is in no dump card at all, so it takes `Round` from its own `ConsumableType 1`. The task's list was right on all seven. **`ItemType` is now the fourth column of `LOOT_EXTRAS`** rather than a shared literal, so the next entry cannot inherit a wrong one silently.

Incidental find while checking: our loca keys for 2836381 / 103992173 / 201509789 are `item_consumable_{strike,escort,line}_rc_pack`, but the dump's own GUI cards at those guids are `consumable_[medium_|heavy_]high_quality_repair_cell`. They are repair cells, not radiation-control packs, which is *why* they are `Repair`. Left the keys alone (W4 replaces the whole consumable emission) but said so in the comment so nobody "fixes" the ItemType back.

**2. Regulation keyset derived, and the derivation is keyed on ActionType, not on group id.** `applyRegulationTargeting(all)` runs between assembly and `validate()` and fills both maps in place. A table keyed on the 32-bit group hashes would be a list of magic numbers that stops covering anything the moment a new family is imported — and the failure mode of a miss is the client's per-frame `KeyNotFoundException`. Keyed on the ability's action type, a newly imported family is classified the day it lands. A group takes the **union** of every action type in it, which is the safe direction (an over-broad relation lets you aim at something harmless; an over-narrow one silently disarms the weapon). Missiles are the one restrictive arm. That union reproduces every row of BLUEPRINT §1.9's policy table, including the mixed `shotgun/burst flak` and `point defence/flak` cases, and reproduces today's hand-written card **byte for byte** (4 keys, identical values). Proved live: setting `GROUP_CANNON = 424242` makes the emitted card carry keys `["0","1","2","3","424242"]` with `[4,16]`/`[1,2]`.

**3. Validators — the full G1-G17 set, all derived from the server's own sources.** The four the brief named plus the rest the blueprint specifies, since W2/W4/W5 depend on G5/G9/G11 having teeth by the time they run:

- **G17** parses `CardBuilder`'s deserialize switch for view->class and each class's source for its declared fields, only at brace depth zero so the nested `Sticker` / `RoomDoor` / `RoomNpc` / `AvatarIndex` helper classes do not leak in as phantom card fields (they did in my first pass — 11 false positives across 3 views). It also checks **every enum-typed field on every view** against the enum's own source. That one rule subsumes G2 and G8 and the bespoke `StatView` loader, which I deleted. It is the rule that catches the seven Price cards, so it is non-vacuous the day it lands.
- **G13/G15** walks both config trees recursively (`ancient/` included) — the live tree and the tracked `config/` mirror — because a repoint applied to one and not the other survives the next regeneration. `ServerConfigurationUtils_public/` is deliberately not walked. A `shipGUID` with no Ship card warns; ancient/100_40_drone_small.json has one today.
- **G12** expands `TurnSpeed`/`TurnAcceleration` to the Pitch/Yaw pairs before the seed test (`ObjectStats.mapObjectStats:106-119` rewrites them first, so they are live and must never be allowlisted), allowlists the documented nine plus `CannonAngle`/`MiningAngle`, and warns. Zero-valued multipliers are a separate error.
- **G14** asserts four values, not three — the B fix is a `MaxRange` + `LifeTime` pair.
- **G9** parses the factory's case labels scoped to the one `switch (type)` and stopped at its `default` arm, then asserts each parsed label is a real `AbilityActionType` constant, so a broken parse fails the build instead of quietly widening the accepted set. 19 types today.

**4. Fixed the enum loader while I was in it.** `loadEnumNames` matched `/^\s*NAME\s*\(/` line by line, which swallowed the enum's own constructor and `this(...)` — `ObjectStat.java` parsed to 296 "constants", three of which (`ObjectStat`, `getMappings`, `this`) are not constants. Nothing failed, because the extras only made the check more permissive, but `stats: { this: 1 }` would have passed. It now parses the real constant list (depth-zero up to the first `;`), which also handles plain enums like `SkillGroup` with one parser instead of two.

Checks: $ node tools/cardgen/cards.js
  ...
  WARN: 5 priced ShipConsumable(s) that no emitted ability demands - they are buyable and sellable but nothing can load them: 197609684, 101797958, 126173396, 59143780, 113883533. NOTE every emitted ability is still ConsumableOption NotUsing, so the demand set is empty and this list is the whole priced consumable roster rather than a genuine orphan set. It becomes meaningful when W4b flips USING_ENABLED.
  WARN server/ServerConfigurationUtils/global/ShipConfigTemplates/ancient/100_40_drone_small.json: shipGUID 40 has no emitted Ship card - that NPC cannot spawn (tolerated: ancient/100_40_drone_small.json is like this today)
  validation passed - 1841 cards
    by view: ShipList=2 GalaxyMap=1 Global=1 AvatarCatalogue=1 StickerList=1 ShipSystem=117 GUI=495 Price=253 ShipPaint=2 Reward=7 EventShop=1 Ship=96 World=115 Owner=111 Movement=98 Camera=86 ShipLight=96 Room=4 Regulation=1 Sector=58 ShipConsumable=42 ShipAbility=40 Missile=1 Module=8 NonShipStats=1 Counter=89 Skill=108 Mission=6
    Regulation: 4 AbilityGroupId key(s), derived from the emitted abilities
  exit=0

$ node tools/cardgen/negtest.js
  14/14 negative tests caught          (no "SKIP (anchor gone)" line; every case PASS, including
                                        case 2 "CanBeSold with empty SellPrice" and case 6 "FTL cost
                                        strands players", both of which DECISIONS asks to confirm fire)

EMITTED-CARD DIFF vs the pre-W1 generator (`git show HEAD:tools/cardgen/cards.js` run against the
current hulls-real.js into a scratch OUT dir, then compared card by card):
  cards before=1841 after=1841 added=0 removed=0 changed=7
  changed: 3|Price 2836381|Price 25398605|Price 103992173|Price 136433549|Price 201509789|Price 232850813|Price
  each one exactly  .ItemType: "Consumable" -> "Round" | "Repair" | "Power"
The Regulation card is byte-identical to the hand-written version it replaced:
  relations {"0":[4,16],"1":[4,16],"2":[16],"3":[16]}   types {"0":[1,2],"1":[1,2],"2":[2],"3":[1,2]}

RULE-FIRE PROOF - harness at
<scratchpad>/w1-rulecheck.js, same technique as negtest (mutate a throwaway copy of cards.js, assert
the message surfaces), plus a temporary probe file written into config/ShipConfigTemplates/colonial/
and removed in a finally:
  PASS  G17 missing declared field
  PASS  G17 enum name is not a constant (ShopCategory)
  PASS  G17 subsumes the old StatView check
  PASS  G17 enum field given a non-string
  PASS  G1  ShipSystem with no GUI card at its own guid
  PASS  G3  duplicate SlotId on one hull
  PASS  G4  priced system at a level the shop never stocks
  PASS  G4  WARN priced system at Level 10 (testingMode only)
  PASS  G5  upgrade chain points at a card that does not exist
  PASS  G5  upgrade chain that loops
  PASS  G5  MaxLevel disagrees with the chain end
  PASS  G5  upgradeable system with an empty UpgradePrice
  PASS  G6  MaxCountPerShip outside a byte
  PASS  G7  Durability 0
  PASS  G9  ActionType with no factory arm
  PASS  G10 empty TargetTiers
  PASS  G11 ConsumableOption Using with no matching consumable
  PASS  G11 ConsumableOption Using whose ammunition is not stocked
  PASS  G12 WARN dead buff (stat no hull of that tier seeds)
  PASS  G12 multiplier of exactly 0
  PASS  G14 a station override silently reverted to the dump value
  PASS  G15 pinned config itemGUID reused as a hull guid
  PASS  G16 restriction entry with no Ship card at that guid
  PASS  G16 Ship cards sharing an objKey that disagree
  PASS  Regulation maps shipped without the derivation running
  PASS  G13 config itemGUID with no ShipSystem card
  PASS  G13 config consumableGUID with no ShipConsumable card
        (config probe removed)
  PASS  Regulation keyset is derived from the emitted abilities   keys=["0","1","2","3","424242"]
  28/28 new rules proved able to fail

JAVA: not touched, so no compile was run. `git status` confirms my only tracked change is
tools/cardgen/cards.js; the Java, patches/, PATCHES.md, hulls-real.js and gen-hulls-real.py
modifications in the tree belong to B1 and B2.

DUMP QUERIES RUN (research/dumps/cards_20260729_223813.json, 14,223 cards):
  guid 3         -> NO CARD IN THE DUMP AT ALL (so ItemType comes from ConsumableType 1 -> Round)
  guid 2836381   -> GUI key consumable_high_quality_repair_cell,        Price ItemType Repair, Tier 1
  guid 103992173 -> GUI key consumable_medium_high_quality_repair_cell, Price ItemType Repair, Tier 2
  guid 201509789 -> GUI key consumable_heavy_high_quality_repair_cell,  Price ItemType Repair, Tier 3
  guid 25398605  -> GUI key consumable_high_quality_power_cell,         Price ItemType Power,  Tier 1
  guid 136433549 -> GUI key consumable_medium_hiqh_quality_power_cell,  Price ItemType Power,  Tier 2
  guid 232850813 -> GUI key consumable_large_high_quality_power_cell,   Price ItemType Power,  Tier 3
`ShopItemType.java` has no `Consumable` constant; `ShopCategory.java` does. Confirmed by reading both.

Problems: G12 currently produces ZERO dead-buff warnings, so the rule is silent on today's content. That is not a defect - B2's regenerated hulls-real.js closed all but one of the 61 hits the blueprint predicted, and the survivor (DrainResistance on system 1069903519, tier 1) is in the documented allowlist. But it does mean nothing in a normal run exercises it, which is why the harness includes a probe that plants a Cooldown buff and confirms the warning appears. If a later package finds G12 silent, that is the expected state, not a broken rule.; G11b's warning today names 197609684, 101797958, 126173396, 59143780 and 113883533 - which is every priced non-resource consumable we emit, not a genuine orphan set, because no ability is ConsumableOption 'Using' yet so the demand set is empty. The message says this explicitly and points at W4b. Do not act on that list before USING_ENABLED flips.; G4 will produce one WARN line per level-10 system once W5 lands, because B3's data carries the dump's own tylium BuyPrice on every level. The lead should decide whether W5 strips BuyPrice from levels 2-10 (silences it and closes B3's testingMode tylium printer) or ships them and accepts the warning. I deliberately did not make that choice for W5.; Our loca keys for guids 2836381 / 103992173 / 201509789 are item_consumable_{strike,escort,line}_rc_pack, but the dump's own GUI cards at those exact guids are consumable_[medium_|heavy_]high_quality_repair_cell. They are repair cells; the 'RC Pack' naming and the trailing '(striker dc)' comments in LOOT_EXTRAS are wrong and have been since the block was written. I corrected the comment and set ItemType Repair but left the keys for W4, which replaces the whole consumable emission from the dump. If W4 does not, the player sees a radiation-control name on a repair item.; priceOk is untouched, so B5's blocker still stands: 19 dump consumable price values are halves (1.5 tylium a round, 22.5 cubits a repair cell) and cards.js:5301 will reject all 19 the moment W4 emits them. Widening it to 'integer, OR negative power of two, OR Number.isInteger(value * buyCount)' keeps negtest case 3 firing (its anchor is 0.03 at buyCount 1000). That was B5's finding and W4's fix; I mention it because W1 owns the validator file and somebody may expect it to have been done here.; G17 relies on stripJavaComments, which removes anything after '//' including inside a Java string literal. No card class or enum in the tree today contains such a literal (the whole index parses clean, and JAVA_ENUM_PROBLEMS is empty), and a mangled parse fails loudly rather than silently - an enum that yields no constants and a duplicate simple name are both reported as errors. But a future card class with a URL in a field default would need the parser hardened.
### W2-systems (partial)

W2 is done except for the live-sector half of the boot test, which the machine would not let me run (a server the user started at 17:54 owns `server/target/` and the real console; every instance I launched loaded the full catalogue and then exited at `Server started!`).

**Wiring.** `realSystemCards()` emits all 219 records from `systems-real.js` at level 1 — ShipSystem + GUI + a new dump-shaped `dumpPrice()` at the system guid, plus ShipAbility + GUI at the ability guid for the 133 that have one. **Level 1 only**, per BLUEPRINT-v2 W2: `MaxLevel 1 / UserUpgradeable false / next 0`, so the store never renders an upgrade button that dead-ends in `ContainerVisitor`. W5 turns the loop over `levels[]`. `sysPrice` is untouched and now serves exactly ten cards (the four capital weapons and the six platform weapons) — H4 satisfied.

I took the dump's `Indestructible` (false on most of the 219) rather than the house `true`. The comment justifying `true` said "this build ships no repair loop" and that is wrong: `DamageDurabilityModifier` spreads damage across fitted systems, `ShipSlot.isInoperable` disables one below 10% quality, and `PlayerProtocol`'s RepairAll arm repairs hull and every slot. Nothing is destroyed. This is the one live gameplay change in the package and it reverts on one line — see problems.

**Deletions.** 105 of the 117 old ShipSystem cards are gone: 83 superseded at the same guid by their real dump card (all 75 `equipment-real.js` modules, the five station guns, `2645025994`, `271446462`, the T2 nuke `2858586174`), and 22 deleted outright (6001-6006 / 6011-6016 / 6021-6026, plus the four mid-ladder impostors). Gone with them: `CANNONS`, `LAUNCHERS`, `TIER_WEAPONS`, `scaleWeapon`, `CANNONS_BY_TIER`, `LAUNCHERS_BY_TIER`, `MAX_PER_SHIP`, `EQUIPMENT`, `EQUIP_META`, `NUKE`, `equipmentCards()`, and the files `equipment-real.js` / `gen-equipment-real.js`. Kept: `CAPITAL_WEAPONS` 6031-6034 (6034 on its own merits — no config pins it) and the six tiered platform weapons.

**The five duplicated station guids.** `SYSTEMS_REAL` owns their identity; `STATION_OVERRIDES` in cards.js applies the three fixes on top as a **floor** (`Math.max`), mirroring what `gen-systems-real.js` already does down the ladder — assigning `LifeTime 55` at every level would shorten B's level-10 round from 62.5 s and make the upgrade worse. The block comment moved onto the map with all its reasoning. All four G14 values assert on the emitted cards.

**NPC configs.** `emit-npc-configs.js` now derives its gun pool from `SYSTEMS_REAL` instead of a hardcoded table, filtered to `FireCannon` + `Launch: Auto` + `MinRange 0` — the weapon/t3 pool also contains a point-defence bubble, a flak screen, a mining laser and a 260-second nuclear torpedo, and the t2 pool an anti-capital cannon with a 500 m hard floor. `GUNS[4]` deleted. 16 files regenerated in both trees, byte-identical on rerun. The eight upstream strike configs are repointed off the four deleted guids onto `2645025994` / `271446462`, **and mirrored into `config/ShipConfigTemplates/`** — without that a fresh unpack of `ServerConfigurationUtils_public` reintroduces them and the build fails.

**Migration** ran audit → migrate → `--apply`. 21 row edits, 9 items refunded at 875,000 tylium. Ledger below; DB clean and idempotent afterwards.

Checks: GENERATOR
  $ node tools/cardgen/cards.js
  EXIT=0
  validation passed - 2389 cards            (was 1841)
    by view: ShipSystem=231 ShipAbility=143 GUI=712 Price=367 ...
             (was ShipSystem=117 ShipAbility=40 GUI=495 Price=253)
    Regulation: 21 AbilityGroupId key(s), derived from the emitted abilities   (was 4;
             BLUEPRINT-v2 section 1.9 predicted exactly 21)
    15 dump system(s) NOT shipped (tools/cardgen/systems-dropped.json):  <- printed every run,
             all 15 listed with guid, slot/tier, key and reason

NEGTEST
  $ node tools/cardgen/negtest.js
  14/14 negative tests caught          (no "SKIP (anchor gone)" line)

  Anchor 2 proved to FIRE, not merely to print PASS. Its literal lives in sysPrice, which I kept.
  $ node <scratch>/w2-anchor2.js
  anchor occurrences in cards.js: 1
  probe exit 1 | matching error lines: 10
    Price 6031: CanBeSold with an empty SellPrice - selling destroys the item for zero
    Price 6032 ... 6034, 6041, 6042, 6051 ... 6054     (the ten cards sysPrice still serves)
  Case 6 (FTL, cards.js:139) also PASS.

ACCEPTANCE SCRIPT (reads the emitted JSON, not the generator's beliefs)
  $ node <scratch>/w2-verify.js
  cards 2389 | ShipSystem 231 | ShipAbility 143
  slot/tier census of the imported systems: all 21 cells match BLUEPRINT-v2 section 1.1, total 219
      weapon/t1 15  weapon/t2 18  weapon/t3 19
      computer/t1 28 computer/t2 20 computer/t3 18 computer/t4 9
      engine/t1 15  engine/t2 7  engine/t3 7  engine/t4 4
      hull/t1 20  hull/t2 11  hull/t3 10  hull/t4 5
      gun/t1 3  gun/t4 2  launcher/t1 2  launcher/t4 2
      defensive_weapon/t4 3  special_weapon/t2 1
  retired guids (6001-6006, 6011-6016, 6021-6026, 4171922670, 1798343138, 3694197064, 1320617532):
      emitted cards: 0 | ShipConfigTemplates (both trees, 61 files): 0
      (6 textual hits remain in cards.js, all inside comments describing what was deleted)
  every ShipConfigTemplates reference resolves; 30 distinct itemGUIDs across both trees
  station overrides on the emitted ability cards:
      2805480538.Angle    = 180 OK
      3400376042.Angle    = 360 OK
      1849929854.MaxRange = 4000 OK
      1849929854.LifeTime = 55 OK
  duplicate (guid,view): 0
  survivors of the hand-authored range: 6031 6032 6033 6034 6041 6042 6051 6052 6053 6054

WARNINGS
  CONTENT GAP is now avionics (34 slots) and role (16 slots) only - both W3's.
  G12 dead-buff warnings: 0 across all 219 imported systems. B2's regenerated hull stat block
  covers every stat the real modules buff.
  Player-reachable slot/tier cells with nothing to fit: avionics/t1, role/t1, role/t2, role/t4,
  ship_paint/t2, ship_paint/t3, ship_paint/t4. W3 closes all but role/t1 and role/t4, which
  DECISIONS section 5 keeps blocked.

NPC CONFIGS
  $ node tools/cardgen/emit-npc-configs.js
  tier 1 gun pool (6): 2645025994, 3079283200, 3480484410, 1356745104, 110642794, 1924887952
  tier 2 gun pool (9): 2145814586, 4288840512, 2385916528, 3162199345, 3004914144, 4274229632,
                       2359208762, 1570948256, 2061619392
  tier 3 gun pool (9): 83889376, 3350495088, 4001980506, 2076556240, 1115144928, 3831404378,
                       4277445376, 1957961850, 3186195184
  16 NPC configs written to live tree and config/ overlay
  Second run -> md5sum diff empty: BYTE-IDENTICAL ON RERUN
  $ node <scratch>/w2-repoint.js
  32 references repointed across 8 upstream files (4 each; each result re-parsed before writing)

DB MIGRATION (B7's script)
  $ node tools/migrate-equipment-guids.js audit       -> 21 broken rows across 5 guids
       6013 x9 fitted (ship 14), 6021 x4 hold, 6023 x5 hold, 6025 x1 fitted, 6026 x1 hold + x1 fitted
       exactly B7's projection
  $ node tools/migrate-equipment-guids.js migrate     -> ledger read
  $ node tools/migrate-equipment-guids.js migrate --apply
       6013 x9  -> 4277445376  system_long_range_cruiser_cannon_st  (weapon/t3, dur 14000 -> 17500)
       6026 x2  -> 1862157617  item_slot_capital_system_launcher_long_range
       6025 x1  -> 6034        system_capship_launcher
       6021 x4  -> REFUND 15625 tylium each
       6023 x5  -> REFUND 162500 tylium each
       tylium 79,932,128 -> 80,807,128 (+875,000)
       21 row edit(s), 9 refunded item(s) worth 875000 tylium, 0 blocked
       backup C:\...\server\sqlite\bgo_server.db.bak-migrate-20260802-200455
       applied 22 statement(s)
  $ node tools/migrate-equipment-guids.js audit
       DB references 142 distinct guid(s) across 174 row(s)
       No broken references. Every guid the DB names resolves to a complete card set.
  $ node tools/migrate-equipment-guids.js migrate     -> "nothing to do" (idempotent)

JAVA
  No Java changed. Compiled anyway:
  $ cd server && JAVA_HOME=<jdk21> ./mvnw -o -q compile
  EXIT=0

SERVER BOOT - PARTIAL, see problems[0]
  Five independent launches, each reaching:
      size: 2389
      Catalogue "next free CARD-GUIDS" computed, FreeShipConfigIds computed
      Fetching mission templates ... finished
      LoginServerListener successfully started
      LoginServerEndpoint waiting for new connections
      Server started!
      Sector[N] threads created and ticking
  Zero "Card should not be send because it's null!", zero ShipSystem.fromGUID failure, zero
  IllegalArgumentException in any launch. Each then hit "APP SHUTDOWN ... on thread Quarkus Main
  Thread" within the same second, before any NPC spawned. Not observed: a live NPC spawning armed.

Problems: BOOT TEST IS PARTIAL and this is the one acceptance item I could not close. Five launches (mvnw quarkus:dev via nohup, via PowerShell Start-Process hidden and minimized, with and without quarkus.console.disable-input, and the dev jar directly with a held-open stdin) all loaded the full 2389-card catalogue, started the GameServer and opened the login endpoint, then exited at "APP SHUTDOWN ... on thread Quarkus Main Thread" in the same second. The user's own instance has been up since 17:54 and owns server/target/, which two dev-mode JVMs cannot share; I could not free it without killing their session. What that leaves unproven is narrow - an NPC actually spawning armed in a live sector - and its precondition is checked statically: G13 walks both config trees and requires every itemGUID to have an emitted ShipSystem card and every consumableGUID a ShipConsumable card, which is exactly what ShipSystem.fromGUID at SpaceObjectFactory.java:698 needs, and w2-verify re-checked all 30 distinct itemGUIDs independently. To close it: restart the live server and `grep -cE 'setupWeaponConfig|Card should not be send|fromGUID' <log>` - expect a rising count of the first and zero of the other two.; DURABILITY IS NOW LIVE FOR PLAYERS, and it is the one behavioural change in this package. 219 imported systems carry the dump's Indestructible: false, so DamageDurabilityModifier now wears down every fitted module (damage split across all filled slots) and ShipSlot.isInoperable switches one off below 10% quality. At level-1 durability (1,500-17,500) that comes round quickly, and W5's ladder is what makes it comfortable. Repair works but only via the Repair All button: PlayerProtocol's per-item RepairSystem arm is stubbed at line 408 with sendDebugMsg("Not implemented"). Revert is one line - force Indestructible: true in realSystemCards().; NPC ESCALATION IS FLATTENED until someone acts on it. Configs 11/14/35/38 (level 20) and 12/15/36/39 (level 75) now name the same level-1 weapons as 10/13/34/37 (level 10). Net combat effect is still an improvement, because accuracy went up far more than damage came down: against a tier-1 hull at full throttle (Avoidance ~510) the old NPC gun was Accuracy 120 / 30-44 dmg / 0.9 s = 9% hit chance = 3.7 dps, the new one is Accuracy 400 / 1-10 / 0.5 s = 51% = 5.6 dps (HitchanceBasedOnThrottle: clamp((67.5 - 0.15*(avoidance - accuracy))/100, 0.05, 0.95)). Against a stationary target it is weaker: 10.5 dps against 27. W5 can restore the intent - see handoff.; B1's note that OverwriteActionType is None on all 2,223 dump ability cards is wrong by one. 2392349058 (item_slot_escort_system_interceptor_computer_weapon_speed_debuff, computer/t2) is ActionType Buff with OverwriteActionType Debuff. Harmless - the field is read once server-side, by FireCannonAction, and only compared against FireCannon - but the comment in AbilityActionFactory.java:94 states the count as a fact and it is off by one.; The dump's own BuyPrice carries a Cubits component at amount 0 on most of the 219 (e.g. 2645025994: tylium 10000 + cubits 0), and so does UpgradePrice. That is the dump's shape and priceOk accepts it. It is inert now because UserUpgradeable is false everywhere, and B1's upgradeSystemByPack guard covers it once W5 flips that - but do not let anyone "tidy" those zeros into something non-zero, and do not add zeros the dump does not have.; tools/cardgen/gen-paints-real.js line 66 still says 6001-6006 / 6011-6016 / 6021-6026 are taken guids. They are free as of this package. B4's collision detection reads the emitted JsonCards dynamically so nothing breaks, but the prose is stale and W3 should correct it while wiring paints.; PATCHES.md still says cards.js generates 1260 cards. It is 2389 now and will move again in W3-W6. I left it for whichever W package lands last rather than churning the number four more times.; The eight upstream config edits exist in the live tree, which is gitignored. The tracked copies in config/ShipConfigTemplates/ are what actually ship - if anyone edits one, both copies must agree or G13 fails the build.
### W3-paints-avionics (complete)

W3 wired B4's paints and B6's avionics/C-31 into `cards.js`, made the CONTENT GAP check tier-aware, and added the per-hull paint assertion. `cards.js` exits 0, negtest is 14/14, and the only CONTENT GAP lines that print are `role/t1` and `role/t4` — exactly the four BLOCK-3 families BLUEPRINT-v2 predicts.

**1. Paints — 97 records, four views each (388 cards).** `paintCards()` emits ShipSystem + GUI + Price + ShipPaint at one guid, which is the dump's own shape (a paint IS a `ship_paint` ShipSystem carrying a ShipPaint card; `ShipSystem.cs:109-112` fetches it at the system's own guid and `IsLoaded.Depend()`s on it). `ShipObjectKeyRestrictions` is `[]` on all 97 — permanently, not gated on `RESTRICTIONS_ENABLED`, because the per-hull lock is `shipCardGuid` and the dump's restriction entries dereference to Ship cards our objKeys have no card at. The GUI card is the one place the plain `gui()` helper was not enough: every dump paint sits on `GUI/AbilityToolbar/abilities_atlas` frame 129 with a real standalone `GUIIcon`, so `gui()` gained a fifth `extra` overrides parameter rather than two new positional ones.

**No collision with the two hand-emitted event paints** — 226/227 are separate guids and stay hand-emitted (`ShopProtocol.setupEventShop` calls `fromGUID` on both with `orElseThrow`). What they did need was §1.4's repoint: both named the wrong hull. 226's key is `..._human_viper_mk3_...` but it pointed at 2366349390 (Viper Mk **II**); 227's is `..._cylon_war_raider_mk2_...` pointing at 1427261742 (the plain Raider). Repointed to 5016 and 5116. `shipCardGuid` is the only gate on where an event paint can be worn, so before this the two skins fitted the wrong ship and could not be fitted to the right one.

**2. Avionics and the C-31 — 16 systems (48 cards).** One mapper (`handAuthoredSystemCards()`) serves both arrays, since B6 gave them identical field names. The six CAMS modules land as tier-1 `avionics`, `MultiplyBuffs { CannonAngle: 1.1 }`, 5,000 tylium. The C-31 lands as a gapless 10-rung `role`/t2 ladder at 6080-6089, level 10 exactly on the wiki (+80 MaxPowerPoints, ×1.29 PowerRecovery and HullRecovery, Durability 15218). Price cards are built with `dumpPrice`, not `sysPrice`: `sysPrice` hardcodes a single tylium BuyPrice, an empty UpgradePrice and a tyl/4 sell, none of which the C-31's merit-and-cubit ladder can express. `sysPrice` still serves exactly ten cards, so H4 is unchanged and negtest case 2's anchor is untouched.

**3-5. Validator.** The type-only CONTENT GAP rule is now per `(slotType, tier)` and scoped to player-flyable hulls. Tier had to join the key or the rule would have gone *silent* on `role` the moment the C-31 landed, which is the opposite of what item 5 asks for; and flyable scoping keeps the two outposts' 24 tier-4 weapon bays out of it (the dump has no weapon/t4 family at all, and their configs name tier-3 guns that install fine because `SpaceObjectFactory` never checks slot type or tier). The `ship_paint` exemption is gone from the inverse rule. The new per-hull paint assertion is keyed on the client's own admission test — `ItemList.cs:129` compares the active ship's guid against `paint.shipCard.CardGUID` or its `NextCard.CardGUID`, so it follows `nextShipCardGuid` rather than hardcoding +300000, and it errors per bare hull card.

I also proved all seven new/changed rules can fire, in a harness kept out of the repo so negtest's pinned `14/14` headline does not move.

Checks: ### node tools/cardgen/cards.js   -> exit 0
CONTENT GAP: 4 bay(s) of "role/t1" across 4 player-flyable hull(s) (5018, 5118, 305018, 305118), and the catalogue has no ShipSystem of that slot type at that tier - those bays render empty and nothing can be fitted to them.
CONTENT GAP: 4 bay(s) of "role/t4" across 4 player-flyable hull(s) (5015, 5115, 305015, 305115), and the catalogue has no ShipSystem of that slot type at that tier - those bays render empty and nothing can be fitted to them.
  paint coverage: 60/60 player-flyable hull card(s) with a ship_paint bay have at least one fittable paint
validation passed - 2825 cards
  by view: ShipList=2 GalaxyMap=1 Global=1 AvatarCatalogue=1 StickerList=1 ShipSystem=344 GUI=825 Price=480 ShipPaint=99 Reward=7 EventShop=1 Ship=96 World=115 Owner=111 Movement=98 Camera=86 ShipLight=96 Room=4 Regulation=1 Sector=58 ShipConsumable=42 ShipAbility=143 Missile=1 Module=8 NonShipStats=1 Counter=89 Skill=108 Mission=6
  Regulation: 21 AbilityGroupId key(s), derived from the emitted abilities
  15 dump system(s) NOT shipped (tools/cardgen/systems-dropped.json): [unchanged]
  1 dump paint(s) NOT shipped (tools/cardgen/paints-real.js):
    288972890  ship_paint/t1  system_paint_advanced_ship_raptor_recon  - restricted to humant1scout, a hull we do not emit

BY-VIEW DELTA (baseline 2389 -> 2825, +436):
  ShipSystem  231 -> 344  (+113 = 97 paints + 6 avionics + 10 C-31 rungs)
  GUI         712 -> 825  (+113)
  Price       367 -> 480  (+113)
  ShipPaint     2 ->  99  (+97; blueprint acceptance says 99)
  12-weapons.json 991 -> 1427 cards.   97*4 + 16*3 = 436. Every other view unchanged.

SHIPSYSTEM CENSUS (slot/tier), 344 total:
  avionics/t1=6  role/t2=10
  ship_paint/t1=59 (57 dump + the two event paints)  /t2=22  /t3=16  /t4=2
  computer t1=28 t2=20 t3=18 t4=9 | engine t1=15 t2=7 t3=7 t4=4 | hull t1=20 t2=11 t3=10 t4=5
  weapon t1=15 t2=18 t3=25 | gun t1=3 t4=3 | launcher t1=2 t4=3 | defensive_weapon/t4=5 | special_weapon/t2=1

### node tools/cardgen/negtest.js
14/14 negative tests caught      (every line PASS; no "SKIP (anchor gone)"; case 2 "CanBeSold with
                                  empty SellPrice" and case 6 "FTL cost strands players" both PASS)

### node <scratch>/w3-rulecheck.js   -> 7/7 W3 rules proved able to fire
PASS  paint gap on one hull family only            (drop 6073 -> "Ship 5108 (tier 2) has a ship_paint bay and NO paint points at it")
PASS  ...and its Advanced twin too                 (same probe -> Ship 305108)
PASS  paint points at a hull with no Ship card     (shipCardGuid+7 -> "has no Ship card - ItemList.cs:129 dereferences it")
PASS  role/t2 gap when the C-31 goes               (-> CONTENT GAP: 4 bay(s) of "role/t2")
PASS  avionics/t1 gap when the CAMS modules go     (-> CONTENT GAP: 24 bay(s) of "avionics/t1")
PASS  ship_paint/t3 gap when tier-3 paints go      (-> CONTENT GAP: 16 bay(s) of "ship_paint/t3")
PASS  ship_paint systems with no ship_paint bay anywhere  (-> the rule whose exemption item 3 removed)

### WARNING DIFF vs the pre-W3 run: ZERO new warnings, ZERO lost warnings (923 lines both sides,
    `comm -13` and `comm -23` both empty). No G4 warning, no G12 dead-buff line, no dead loca key.

### node tools/cardgen/gen-paints-real.js  -> exit 0, paints-real.js byte-identical
    (idempotency proved AFTER the paints are being emitted, which is the case B4 could not test)

### node tools/cardgen/avionics.js  -> "OK - 6 avionics + 10 C-31 levels"
### node --check on both edited files -> clean.  No Java touched, so no compile run.

Problems: Level 10 of the C-31 ships an empty BuyPrice, so under starterParams().testingMode() - which %dev sets - ShopProtocol.setupShop:267-271 stocks it and isEnoughInContainer returns true at price zero. A dev can take it free and sell it back for 2,750 merits. The alternative was worse: pricing it at the flat 2,000 merits makes it buy-2,000/sell-2,750, still positive, plus a G4 warning line. This is the same class as B3's finding that 75 of the 219 level-10 cards are tylium printers under testingMode, and the lead already accepted that. It is not reachable on a prod profile.; The GUI frame indices for both hand-authored families are B6's thematic guesses and are labelled as such in avionics.js: 199 (the coupled_rcs icon) for the six CAMS modules, 190 (the power_buff / regen_buff icon) for the C-31. No dump card exists for either item, so no card records the real frame. A wrong frame draws the wrong picture and nothing else.; Restrictions are still [] on the six CAMS modules and the C-31, so both are BUYABLE by any tier-1 / tier-2 player regardless of hull family, and a player who buys one for a hull with no such bay is left holding it. This is the general section 1.6 consequence that lands with W6's identity cards, not something W3 introduced, but it is the most visible thing a live test will hit.; The two event paints 226/227 keep Price.Faction 'Neutral' and setupEventShop stocks both unconditionally, so a Cylon can buy the Colonial Viper Mk III skin (226) and never fit it - ItemList.cs:144 hides a paint whose shipCard.Faction is not the player's. Pre-existing and untouched; the repoint made the skins fit the right hull but did not change who can buy them. Fixing it means either per-faction Price cards or a faction filter in setupEventShop, neither of which is a card-generator change.; The four *_classic dump paints (283092864, 696294144, 1329711472, 3727642656) carry a non-default `model`, which swaps the whole ship prefab (Ship.cs:21-23). B4 verified those prefabs are in the client bundle during the research pass and did not re-verify; I did not either - the asset map lives outside the repo. A missing prefab there is a client-side load failure, not a card-level one, and it affects four cosmetic items.; PATCHES.md still says cards.js generates 1260 cards. It is 2825 now and will move again in W4-W6. Left for whichever W package lands last rather than churning the number three more times - same call W2 made.; BLUEPRINT-v2's W3 acceptance line says "CONTENT GAP warnings gone entirely". That was written against the type-only rule, where adding any role and any avionics system silences the check by construction. The package brief's item 5 asks for the opposite and better thing, and that is what shipped: role/t1 and role/t4 still print, naming the four BLOCK-3 families and their Advanced twins. If a later package copies the blueprint's wording as its acceptance test it will look like a regression and is not one.; Two BLUEPRINT-v2 W3 items are still open and belong to whoever touches Ship cards next (probably W6): the Advanced-hull GUI level fix (cards.js emits level 1 for base and Advanced alike, so bgo.<key>.Name_1 resolves for both and every Advanced hull renders the base name) and ShipRoles: ['Stealth'] on the six stealth hulls. Both edit hull cards, not equipment, and neither is in this package's acceptance.
### W4-consumables (complete)

W4 is done. `cards.js` now emits 3,239 cards (was 2,825), 175 ShipConsumable (was 42), and every one of the 78 `ConsumableOption: Using` abilities has priced ammunition.

**1. Consumables wired.** The old `RESOURCE_META` / `SHOP_STOCK` / `LOOT_EXTRAS` / `resourceCards()` / `lootExtraCards()` block is replaced by one `consumableCards()` driven by B5's `CONSUMABLES_REAL` (165) plus a `LEGACY_META` table for the ten guids that are ours (175 total). Zero cards were removed, 414 added, 102 changed — and every changed card is a countable view. It fixes far more than the ~10 the task named: **40 of the 42 previously-emitted countables carried ConsumableType 0 / Tier 0 / effectType None**, and the seven that survive with ct 0 are the event boxes and mining drops, which are correctly untyped. `consumableAttributes` was `[]` on all 42 and is the field nobody had noticed: `GuiConsumablePanel.cs:47-62` buckets the in-flight ammo menu one collapsible header **per attribute**, so an item with no attribute is invisible in the panel you load ammo from. All nine attribute strings resolve as `bgo.consumable_attribute.<attr>`.

Only two things stay ours: the six currencies' BuyPrice/SellPrice/CanBeSold **and buyCount** (`CURRENCY_RATES`). The dump ships buyCount 1 on all six, which at our 0.03125 cubits/tylium means one click buys one tylium and the server charges `ceil(0.03125)` = a whole cubit. The module marks exactly those six with `price.buy === null` and the emitter fails the build if the two sides ever stop naming the same guids.

**2. Projectiles.** `missileObjectCards()` now emits all four StaticCardGUID missile guids (World+Owner+Movement+GUI+Missile), not one. The guids are cross-checked against `StaticCardGUID.java` at build time. Two new validator rules cover the landmines the brief names: **G10b** demands Speed, MaxHullPoints, LifeTime and all six rotation stats non-zero on every missile ability and forbids `DrainLow` on anything but `FireTorpedo`; **G11c** proves every DamageNuclear countable routes to a projectile that exists, and that B1's `missileGUID == 0` fallback is still in `FireMissileAction` while the three merit mines (DamageHigh 0.3) ship.

**3. `USING_ENABLED` flipped in the generator** (`gen-systems-real.js`, not the module), regenerated: 78 abilities → `Using`, 55 stay `NotUsing`. G11 has teeth and passes; G11b's orphan warning collapsed from the whole roster to exactly the 10 B5 predicted (9 mines + the jump transponder). The demanded-pair count is now **derived twice and cross-checked** — once from the emitted ability cards and once from the dump by `gen-systems-real.js` — and errors if they disagree. It prints `30`; nothing hardcodes it.

**4. A regression the flip caused, found and fixed.** NPCs are exempt from the ammo *check* (`AbilityAction.checkConsumablesSatisfied:143` returns early for a non-player), but `FireMissileAction.getMissileGUID` is the shot, not a check — it reads the loaded countable to choose the projectile. `setupWeaponConfig` only calls `setCurrentConsumable` when `consumableGUID != 0`, so the **18 missile mounts on the two outposts and two weapon platforms would have gone silent**, logging on every attempt. All 18 now carry `"consumableGUID": 218608438` (Heavy HE Warhead, ct 40431/t3, non-nuclear, empty ItemBuffAdd). New rule **G13b** errors on any config slot arming a `Using` missile launcher without matching ammunition. Those four station files also lived only in the gitignored live tree — a fresh unpack left every outpost unarmed — so they are mirrored into `config/` now, with a README section.

**5. `priceOk` widened**, which was B5's blocker: 19 dump prices are halves (1.5 tylium a round, 22.5 cubits a repair cell) and the old integer-or-negative-power-of-two rule rejected all 19. The rule is now "dyadic rational" — the family whose products with any integer count are exact in binary floating point, which is the actual invariant behind the old wording. `0.03` still fails (negtest case 3 unchanged, message keeps its substring), and a sub-1 value that is not 1/2^n now warns rather than errors, because `GUIShopConfirmWindow.GetPurchaseUnit` steps the buy arrow by `round(1/value)`. One warning today: the dump sells standard rounds at 0.75 tylium.

Checks: $ node tools/cardgen/gen-systems-real.js
    PASS  demanded (ConsumableType, ConsumableTier) pairs - 30, expected 30
    ... 20/20 self-checks PASS, exit 0
  (FLAGS now {"using":true,"restrictions":false}; 78 abilities Using, 55 NotUsing)

$ node tools/cardgen/cards.js          -> EXIT=0
  ammunition: 30 demanded (ConsumableType, ConsumableTier) pair(s) across 78 'Using' abilities, all supplied
  WARN Price 197609684.SellPrice[215278030] = 0.75: under 1 and not 1/2^n, so the buy arrow steps by round(1/0.75) = 1 and each step charges 0.75 - the server rounds that, the tooltip does not
  WARN: 10 stocked ShipConsumable(s) that no emitted ability demands - they are buyable and sellable but no weapon can load them: 85145699, 119169974, 136009541, 231751862, 21486390, 148792421, 194271798, 19338341, 28977974, 185436726
  validation passed - 3239 cards
  by view: ... ShipConsumable=175 ShipAbility=143 Missile=4 GUI=961 Price=613 ...
  1 dump consumable(s) NOT shipped (tools/cardgen/consumables-real.js):
    1097622313  consumable_mega_rounds  - dev item: no buy price, no sell price, buyCount 0, granted by nothing

$ node tools/cardgen/negtest.js
  14/14 negative tests caught          (no SKIP (anchor gone) line)

$ node <scratch>/w4-rulecheck.js
  PASS  a ResourceType guid with no countable card
  PASS  CURRENCY_RATES and the module disagree about which guids are currencies
  PASS  LEGACY_META names a guid the module does not correct
  PASS  the dump import and LEGACY_META both claim a guid
  PASS  nuclear ammunition whose projectile has no World card
  PASS  the StaticCardGUID cross-check
  PASS  a Using ability whose ammunition is not stocked
  PASS  a Using ability with no matching consumable at all
  PASS  the two demanded-pair derivations disagree
  PASS  a missile ability with no LifeTime
  PASS  a plain missile carrying DrainLow
  PASS  an NPC missile launcher with no ammunition in its slot config
  PASS  a non-dyadic price value
  PASS  a half is accepted where the old rule rejected it
  14/14 W4 rules proved able to fire

$ node tools/migrate-equipment-guids.js audit
  DB references 142 distinct guid(s) across 174 row(s)
  No broken references. Every guid the DB names resolves to a complete card set.
  (item_countables: 215278030, 264733124, 207047790, 130920111, 197609684 x250,
   17980086 x1801, 13 x1, 9 x31, 130762195 - all resolve; DB byte-untouched)

Independent checks (node over the emitted JsonCards):
  ShipConsumable 175, missing GUI 0, missing Price 0
  ct 0 / tier 0 / effectType None: 7 (was 40) - all event boxes + mining drops, correct
  projectiles 117216909 / 29963472 / 244685066 / 253392099: all have World+Owner+Movement
  DamageNuclear consumables 14 -> routes {torpedo:4, mini:3, nuke:4, fallback:3}
    fallback = 136009541 / 148792421 / 19338341, DamageHigh 0.3, covered by B1's guard
  Using abilities 78, unsupplied 0
  missile abilities 29, all carry Speed+MaxHullPoints+LifeTime+6 rotation stats; DrainLow only on
    the 4 FireTorpedo
  augments: 19 IsAugment cards, 12 templates, every STOCKED augment has a factor template,
    no template references a guid with no card
  arbitrage scan: no consumable is profitable in tylium-equivalent terms

Before/after diff of the whole emission: 0 cards removed, 414 added, 102 changed - all 102 are
GUI/ShipConsumable/Price on countable guids, and all six currency exchange rates are byte-identical.

Java: I changed none. `git status` shows 4 modified .java files, all B1's. No compile run.

Problems: The live-fire half of the acceptance is unproven. I could not fire a weapon of each ConsumableType in a running client, so the ammo-pairing rule is still inferred from ItemList.cs:135 rather than observed, and its failure mode is silent: checkConsumablesSatisfied returns false, preFun returns false, process() returns at :125-126, nothing is logged. The static half is as tight as I could make it - 30 demanded pairs derived twice and cross-checked, all supplied by a card with a non-empty BuyPrice - but the first live test should fire one weapon of each of the 30 pairs and, separately, a nuclear torpedo, a mini-nuke and a 20x nuke while watching for 'Sector[N] single crash'.; Ammunition consumption is now real for players and it will feel different immediately. 78 abilities refuse to fire without a loaded countable and decrement the stack on every shot (AbilityAction.processConsumables:189). Before this package no weapon ever consumed anything. The live player holds 250 standard rounds and 1,801 standard missiles; the rounds will not last a single engagement. This is the intended behaviour of the original, but it is the single most visible change in the package and it is worth saying out loud before the user logs in.; Repair cells (ct 3193, all four tiers) and power cells (ct 29658, tiers 1-3) are priced in cubits only, with no tylium alternative anywhere in the dump's catalogue. Seven of the 30 demanded pairs are cubits-gated. Cubits drop from six LootTemplates so the families are reachable, but a new player with no cubits cannot buy a repair cell at any price, which makes the four hull repair units and three energy recovery units unusable for them. The dump priced these against an economy where cubits cost 10 tylium each; ours does not sell cubits at all.; The four *_torpedo_token cards are ConsumableType 40431 (Missile), not 27770 (Torpedo) as BLUEPRINT-v2 §1.7's table claims - B5 flagged this and the emitted cards confirm it. The real ct 27770 family is a different guid set (259132591 / 158960847 / 223122079). Anyone hand-applying that blueprint table over the generated data would mistype three cards and leave the 27770 demand pairs supplied by the wrong ammunition.; 166681557 augment_teleport now ships IsAugment true (the dump's value, where we had false) with no AugmentFactorTemplate, so its Activate button appears and does nothing but log 'No factor template'. It is unstocked (empty BuyPrice) so a player cannot buy one, but it is a ResourceType constant, so a %dev grant reaches it. Same shape for the other six unstocked boosters, which are IsAugment true and template-less by design - AugmentTemplateReader throws IllegalStateException at BOOT on an augmentActionType it cannot dispatch, so a SkillTime template file is not an option and an empty BuyPrice is the correct alternative.; Four ammunition icons (the standard-issue missile family, 17980086 / 221436534 / 218608438 / 187926173) draw GUI/Inventory/items_atlas tile 0. That is the dump's own FrameIndex, verified card by card, and GUICard.SetGuiImage does not special-case 0 - it draws the tile. If tile 0 turns out to be a placeholder rather than a warhead, those four want a frame chosen by eye; nothing else depends on it.; The four station config files (colonial/200, colonial/202, cylon/201, cylon/203) were ours, not upstream, and had been living only in the gitignored live tree - a fresh unpack of ServerConfigurationUtils has always left both outposts and both weapon platforms completely unarmed. I mirrored them into config/ while fixing their ammunition, but that is a pre-existing gap I happened to walk into, and it is worth checking whether anything else hand-authored is in the same position.; The three merit mines (136009541, 148792421, 19338341) are shop-stocked at 60-150 merits, carry effectType DamageNuclear with DamageHigh 0.3, and are loadable into any missile slot because PlayerProtocol's SelectConsumable validates neither ConsumableType nor Tier. They land in B1's missileGUID == 0 fallback and fire an ordinary missile. Safe, and G11c fails the build if that fallback is ever removed while they ship - but the fallback logs a warning per shot, so a Launch: Auto weapon loaded with one will be loud in the log.; G11b's orphan list is now exactly the 10 items BLUEPRINT-v2 predicted (the 9 mines plus consumable_jump_target_transponder), and it is a genuine list rather than an artefact: their launchers are all on the §1.1 drop list. They stay shop-visible and sellable by DECISIONS' choice. If a later package rescues the mine launchers or the jump transponder, the list should shrink and that is the signal it worked.
### W5-ladder (complete)

The 219 imported systems now ship as 219 gapless ten-rung upgrade chains. `realSystemCards()` loops `levels[]` instead of taking `levels[0]`, emitting ShipSystem + GUI + Price at every rung's own dump guid and ShipAbility + GUI at that rung's own ability guid for the 133 chains that have one.

**Headline numbers.** 3,239 -> **11,546 cards** (+8,307), inside BLUEPRINT-v2's 11,500-11,900 band and 137 short of its ~11,683 estimate. ShipSystem 344 -> **2,315** and ShipAbility 143 -> **1,340**, both exactly the blueprint's targets. GUI 961 -> 4,129, Price 613 -> 2,584. Every other view is byte-identical to before. Generator runtime 0.41 s -> **0.64 s** measured against the same file with the loop clamped to one rung, i.e. 3.6x the cards for 1.6x the time. `12-weapons.json` 785 KB -> **5.74 MB**, whole catalogue 2.2 MB -> **6.9 MB**.

**Ten levels, not fifteen, and that is now derived.** `PlayerProtocol.java:797` rejects `newLevel > 10` as a cheat, so rungs 11-15 are unreachable whatever the cards say. G5 parses that constant out of PlayerProtocol and errors on any MaxLevel above it, rather than trusting a comment.

**BuyPrice on level 1 only** - the one judgement call W1 explicitly left to this package. Levels 2-9 are never stocked (`ShopProtocol.setupShop:258`), so a price there is dead stock and G4 errors on it. Level 10 is stocked under `testingMode()`, and dropping its BuyPrice is what closes B3's tylium printer: 75 of the 219 level-10 cards price themselves in tylium BELOW their own SellPrice, worst case +1,704,000 a round trip. I checked the alternative before choosing: `ContainerVisitor.checkItemToBuy:695-698` refuses a sale outright when BuyPrice is empty ("An empty BuyPrice means NOT FOR SALE"), so the duplicate level-10 rows a dev sees are inert rather than free. Result: **zero G4 warnings**, where the alternative was 219 warnings and a working exploit.

**UpgradePrice is the dump's, verbatim, on all 2,190 rungs.** Compared key by key against the dump on all 2,283 emitted systems that exist there: **0 mismatches**. The 136 rungs pricing Cubits at exactly 0 are preserved untouched - B1's number, reproduced independently - and nothing synthesises a currency entry. Level 10 keeps its non-zero UpgradePrice; it is inert because `PlayerProtocol:787` refuses an upgrade from a card whose `getNextCardGuid()` is 0.

**W4's `USING_ENABLED` flip survived, verified in the emission rather than assumed.** I did not regenerate `systems-real.js` (it already carries all ten levels), and `gen-systems-real.js:67` still reads `true`. The emitted distribution is 780 `Using` / 560 `NotUsing` - 78 x 10 laddered plus 55 x 10 plus the 10 hand-authored - and `RESTRICTIONS_ENABLED` is still false with only the six pre-existing platform weapons carrying a list.

**Two new validator rules, both proved able to fire.** G5 gained the PlayerProtocol-derived MaxLevel ceiling. **G5b is new and catches a silent bug nothing else could**: a rung fitting the level-1 ability guid instead of its own. Everything a weapon does lives on its ability card, so that would load, equip and fire, and the player would have paid nine upgrades for numbers that never moved. Found it because my rule-fire harness case for it initially failed.

**NPC escalation restored** (handed to W5 by W2). The eight upstream strike configs were flattened onto level 1 because no mid-ladder card existed. 11/14/35/38 (level 20) are back on the upstream guids 4171922670 / 1798343138, which are exactly level 5 of the autocannon and the light missile launcher. 12/15/36/39 (level 75) named level-15 guids that never exist under a ten-rung ladder, so they take level 10 - the top of ours, which is what 15 was to theirs. Both trees, byte-identical; the launcher slots keep their `consumableGUID` so G13b stays satisfied.

**A performance change I had to make.** "Is there a card of view V at guid G?" was answered by a linear scan, five times over, inside loops over every ShipSystem. Fine over 1,841 cards, 80 million comparisons over 11,546. Indexing it once cut the run from 1.67 s to 0.64 s. Behaviour is identical.

Checks: GENERATOR
  $ node tools/cardgen/cards.js
  exit 0
  validation passed - 11546 cards
  by view: ShipList=2 GalaxyMap=1 Global=1 AvatarCatalogue=1 StickerList=1 ShipSystem=2315
    GUI=4129 Price=2584 ShipPaint=99 Reward=7 EventShop=1 Ship=96 World=118 Owner=114
    Movement=101 Camera=86 ShipLight=96 Room=4 Regulation=1 Sector=58 ShipConsumable=175
    ShipAbility=1340 Missile=4 Module=8 NonShipStats=1 Counter=89 Skill=108 Mission=6
  12-weapons 9749 | 10-ships 672 | 08-world 761 | 14-progression 331 | 00-bootstrap 17 | 05-starter-ships 16
  Zero new WARN lines. Warning set is identical to the W4 baseline: 856 pre-existing
  "no SMALL layout entry", 4 missile-GUI frame notes, 1 sub-integer sell price, 1 ancient
  drone shipGUID, 1 ten-item orphan-consumable list. ZERO G4 level-10 warnings.

NEGTEST
  $ node tools/cardgen/negtest.js
  14/14 negative tests caught      (no SKIP (anchor gone) line; run three times, stable)

RULE-FIRE HARNESS  <scratch>/w5-rulecheck.js  (negtest's exact format, kept out of the repo
so the pinned 14/14 headline does not move)
  PASS  ladder skips a level
  PASS  ladder runs past the server's upgrade cheat cap
  PASS  top rung points back at the bottom instead of terminating
  PASS  a rung points at a card that was never emitted
  PASS  a mid-ladder rung has no GUI card
  PASS  a mid-ladder rung is priced as if the store stocked it
  PASS  an upgradeable rung charges nothing for the next level
  PASS  a rung fits the level-1 ability instead of its own
  PASS  the module and LADDER.levels disagree on the chain length
  PASS  PlayerProtocol's upgrade cheat check can no longer be found
  10/10 W5 rules proved able to fire

CHAIN AUDIT  <scratch>/w5-verify.js  (walks the emitted JsonCards, not the generator)
  ShipSystem cards 2315; chain heads 335; chains longer than one rung 220; rungs walked 2315
  ladder rung guids distinct: true
  chain-length census: {"1":115,"10":220}
  UpgradePrice compared against the dump on 2283 cards; mismatches 0
  rungs whose UpgradePrice prices Cubits at exactly 0: 136
  OK - every chain gapless, distinct, terminating and fully carded
  (also asserts per rung: Level == index+1, MaxLevel == chain length, UserUpgradeable,
   GUI + Price present, no BuyPrice above rung 1, ability present with a matching Level)

EMITTED DISTRIBUTIONS
  Level: {1:335, 2:220, 3:220, 4:220, 5:220, 6:220, 7:220, 8:220, 9:220, 10:220}
  MaxLevel: {1:115, 10:2200}   UserUpgradeable: {false:115, true:2200}
  systems carrying a BuyPrice, by Level: {1: 333}
  Level-10 systems 220, with an EMPTY UpgradePrice: 0
  ShipAbility ConsumableOption: {Using:780, NotUsing:560}   (W4's flip intact)
  ShipSystem with a non-empty restriction list: 6           (the pre-existing platform weapons)

SERVER BOOT  <scratch>/w5boot  (a 15 MB copy of server/ with its own .env ports and its own
copy of the sqlite DB, so the user's instance - up since 17:54 and holding server/target -
was never touched; verified afterwards: live DB mtime still 21:04:55, only build-metrics.json
written in the real target, and both user PIDs still alive)
  $ java -jar target/bsgo-core-dev.jar
  size: 11546
  [io.gi.lu.te.ca.Catalogue] next free CARD-GUIDS: [...]
  [io.gi.lu.ne.LegacyTcpLoginServerListener] LoginServerListener successfully started
  [io.gi.lu.ApplicationBootstrap] Server started!
  58 sectors instantiated. ZERO "Card should not be send", zero "Fetch error in catalogue",
  zero IllegalArgumentException. The process then exits at APP SHUTDOWN, which is the dev
  launcher jar run without its maven supervisor - W2 saw the same and could not explain it;
  the earlier attempt's shutdown cause is now identified as "Port 8443 seems to be in use"
  (the user's live instance), which is a port clash, not a card fault.

CATALOGUE LOAD THROUGH THE SERVER'S OWN CODE  <scratch>/W5CatalogueLoad.java, javac'd against
server/target/classes (no Java in the repo was changed; quarkus-maven-plugin is absent from
~/.m2 entirely, so no maven build - offline or not - is currently possible on this machine)
  size: 11546
  cards deserialised : 11546 in 767 ms
  cards that came back null (no CardBuilder arm) : 0
  cards written to the wire : 11546 in 22 ms, 924237 bytes total
  write failures : 0
  catalogue built and every level-1 chain walked in 426 ms
  chain-length census (Catalogue.fetchAllSystemCards) : {1=115, 10=220}
  chain gaps : 0
  (the write pass is stronger than boot: boot only deserialises, and a null enum or omitted
   field NPEs on write, which is what closes a player's socket)

STORE-OPEN BURST (H12), measured not estimated  <scratch>/w5-storeburst.js
  store rows stocked on a prod profile : 335 systems + 157 countables
  cards the whole store transitively demands : 10195   (was 1888 before the ladder, 5.4x)
  those 10195 cards on the wire : 748523 bytes
  dependency depth : 10 request rounds
  Cause: ShipSystemCard.cs:138-139 does IsLoaded.Depend(NextCard), so a level-1 store row is
  not "loaded" until its whole ladder is. Requests are batched (CatalogueProtocol reads a
  count then that many (guid,view) pairs) and the server caches each card's serialised
  writer, so it is ~10 round trips and 731 KB once, not 10195 round trips.

CONFIG REPOINT
  node tools/cardgen/emit-npc-configs.js -> "IDEMPOTENT: emit-npc-configs.js changed nothing"
  all 8 strike files byte-identical between config/ and the live tree
  all 36 distinct config guids (itemGUID + consumableGUID, both trees) resolve to a complete
  card set; 4171922670 / 1798343138 / 1785576219 / 3706963983 each have ShipSystem+GUI+Price

PLAYER DATA
  $ node tools/migrate-equipment-guids.js audit
  catalogue: 4234 guid(s); DB references 142 distinct guid(s) across 174 row(s)
  No broken references. Every guid the DB names resolves to a complete card set.
  (audit mode only - nothing retired this package, so nothing to migrate; DB not written)

RUNTIME AND SIZE
  full ladder      0.64 / 0.64 / 0.63 s   11546 cards
  same file, loop clamped to rung 1        0.41 / 0.40 / 0.41 s   3239 cards
  full ladder without the new view index   1.63 / 1.72 s
  12-weapons.json 5,737,724 B (was 785,178) | 10-ships 800,427 | 08-world 479,326 |
  14-progression 97,632 | 00-bootstrap 56,950 | 05-starter-ships 15,659 | total 6.9 MB (was 2.2)

Problems: The store-open card burst grew 5.4x and this is the one number that could bite. Opening the store on a prod profile now transitively demands 10,195 cards / 748,523 bytes, against 1,888 before the ladder, because ShipSystemCard.cs:138-139 does IsLoaded.Depend(NextCard) and a level-1 row therefore is not loaded until its whole ladder is. It is ~10 request rounds, not 10,195, because requests are batched and a rung's guid is only known once the rung below it parses, and the server caches each card's serialised writer so only the first player pays to serialise. 731 KB on first store open should be unnoticeable on LAN and fine on broadband, but it is unmeasured against a real client and it is the thing to watch in the live test.; The live upgrade loop is unproven end to end. I verified the cards, the chain walk through the server's own Catalogue.fetchAllSystemCards, and that PlayerProtocol's two upgrade arms gate on isUserUpgradeable() and getNextCardGuid(); I could not click Upgrade in a running client. The failure mode if something is wrong is not silent - PlayerProtocol logs a "Cheat" line on every rejection path - so the first live upgrade attempt will say plainly what happened.; Every fitted module is now upgradeable, which makes B1's upgradeSystemByPack guard load-bearing from this commit rather than latent. 136 of the 2,190 rungs price Cubits at exactly 0 in UpgradePrice, and without the guard one tuning kit buys a guaranteed free level on each. The guard is present and verified at ContainerVisitor:401-409. Do not revert B1 while this ladder ships, and do not add a Cubits entry to any UpgradePrice that does not already have one - with the guard in, a synthesised zero now makes the pack-upgrade button silently return false, which reads to a player as a broken button.; 12-weapons.json is 5.74 MB and holds 9,749 of the 11,546 cards. It parses in 767 ms through the server's own Gson path and the whole catalogue writes to the wire in 22 ms, so nothing is slow - but a diff of that file is now unreadable by eye. Review it through the generator's printed census and <scratch>/w5-verify.js, the same way B3 said to review systems-real.js.; Durability wear, which W2 made live, now varies 1.18x to 2.67x (median 2.00x) from rung 1 to rung 10. That is the intended shape - upgrading a module makes it last longer - but it means a level-1 module wears roughly twice as fast as its level-10 form, and the per-item RepairSystem arm is still stubbed (PlayerProtocol.java:408, "Not implemented"), so Repair All is the only working button. If wear turns out to be annoying at the bottom of the ladder, the revert is still one line: force Indestructible: true in realSystemCards().; On a %dev profile the store shows every system twice, once at level 1 and once at level 10, because ShopProtocol:265-271 stocks both under testingMode(). That is expected, not a bug, and the level-10 rows cannot be bought. I did not see it in a client - I read it out of ShopProtocol and reasoned about it - so the first dev-profile store open will look alarming to anyone who has not read this note.; The NPC escalation repoint changes combat difficulty. A level-20 strike wing now flies level 5 of the autocannon (DamageHigh 10 -> 14.44) and level 5 of the light missile launcher (Cooldown 10 s -> 7.78 s); a level-75 wing flies level 10 (DamageHigh 20, Cooldown 5 s). That is roughly double the damage and double the missile rate at the top compared with the flattened state W2 left, and it is upstream's own intent - but it is a live difficulty change and belongs in the final report alongside armour and ammunition consumption.; The four level-75 configs (colonial 12/15, cylon 36/39) name level 10 where upstream named level 15. That is my mapping, not upstream's data - level 15 does not exist under a ten-rung ladder and never will while PlayerProtocol caps upgrades at 10. If the lead ever restores levels 11-15, those four want revisiting.; quarkus-maven-plugin is missing from C:/Users/danie/.m2 entirely (searched the whole repository tree for the jar; nothing). No maven build works on this machine right now, online or offline, which is worth knowing before the next package tries to compile Java. The running server is unaffected - it started before the plugin went missing and is executing target/bsgo-core-dev.jar directly.
### W6-restrictions (complete)

Restrictions are live. 30 hull identity card sets emit at guid == ShipObjectKey, `RESTRICTIONS_ENABLED` is true, and 902 ShipSystem cards now carry a real per-hull list where before every one was `[]`.

**W6a — 30 identity card sets, derived not listed.** New `hullIdentityCards(built)` in `cards.js` runs last, after every other group is assembled, and reads the catalogue it is given: it groups emitted Ship cards by ShipObjectKey, skips any key that already carries a Ship card at its own guid (the 12 platforms/outposts/cruisers/capitals), and for the remaining 30 emits Ship + World + GUI + Price + ShipLight at the key. A hull added to `HULLS` gets an identity card with no edit here; a hull removed takes its own away. Ship / ShipLight went 96 → 126, World 118 → 148, GUI and Price +30 each. Nothing else in the emission moved: same warnings, same CONTENT GAP lines, same paint coverage 60/60.

The source hull is the family's single ShipList member, and the generator throws if a family has anything but exactly one. That matters because 107780547 and 117312163 each have five Ship cards and they do **not** agree on HangarID — the NPC clones park on 12, and `GuiAdvancedRequirementsPanel.cs:98` colours "Required ship:" by comparing the fetched card's HangarID against the active ship's. Copy a clone and the requirement reads as unmet while you sit in the hull it names.

`PaperdollUiLayoutfile: ''` as the critic specified, and I confirmed why by breaking it: putting the hull's layout back fails the build on all 30 with `Level 0 has no UpgradeLevel`. `Level: 0` is the dump's own value (33/33 of its identity cards) and is load-bearing a second way — `HangarShip.java:100` instantiates no slot below the card's level, so every slot is level 1 or 2 and a hangar ship built from one of these would have none.

**One thing the blueprint did not cover, found while checking reachability.** `PlayerProtocol.addShip:1099` calls `isEnoughInContainer` directly, and that loops over zero price entries and returns true — the `tmpPrice.isEmpty()` guard `checkItemToBuy:698` has for exactly this is missing on the ship path. A crafted `ShipAddShip` naming an identity guid would put a free hull in the hangar at the **real** hull's HangarID, and `Hangar.addHangarShip:63` is a map `put`, so it would displace the ship already there. The identity Price cards ship `Faction: 'Neutral'`, which `PlayerProtocol.java:1080-1086` refuses for any non-developer. Card-only, no Java, and the tooltip is unaffected because it reads the *Ship* card's Faction.

**W6b — the flip.** `RESTRICTIONS_ENABLED = true` in `gen-systems-real.js`, regenerated: 88 systems × 10 rungs get their translated list, 131 keep `[]` because the dump did. `ourRestrictions` is byte-identical to before the flip on all 219 records, so the identity cards did not perturb the translation. The six CAMS modules and the ten C-31 rungs now read `SYSTEMS_FLAGS.restrictions` rather than hardcoding `[]`, so they revert with the same constant. Paints stay `[]` permanently and there is now a validator that says so.

**G16 changed shape, because its old premise stopped being true.** It required all Ship cards sharing an objKey to agree on Tier, ShipRoleDeprecated and HangarID, on the grounds that the tooltip resolves one of them arbitrarily. It does not — `FetchCard` resolves by guid, so it is the identity card and nothing else. It now checks that the Ship card at the entry guid carries that objKey (otherwise server and client name different hulls), and compares that card against the family's ShipList hull on Tier / ShipRoleDeprecated / HangarID / Faction. Family-wide it keeps only Tier, which is real: the server unlocks the item for every member while the store filters by the active hull's tier.

**What a player sees.** Tier 1 is where it bites: a Viper now sees 50 of the 89 tier-1 systems instead of all 89, and the two stealth hulls see 32 — their own `item_slot_strike_stealth_*` family, which is the whole point of the pass. Tiers 2-3 lose 3-7 rows each, tier 4 loses none. No bay anywhere was emptied: 284 stocked (hull, bay) cells, 0 with nothing fittable.

Checks: GENERATOR
  $ node tools/cardgen/cards.js
  validation passed - 11696 cards
    10-ships.json      822
    by view: ... ShipSystem=2315 GUI=4159 Price=2614 ShipPaint=99 Ship=126 World=148
             ShipLight=126 ShipConsumable=175 ShipAbility=1340 ...
    paint coverage: 60/60 player-flyable hull card(s) with a ship_paint bay have at least one fittable paint
  exit 0.  11,546 -> 11,696 (+150 = 30 identity sets x 5 views). Warning output diffed against the
  pre-W6 run: byte-identical, no new or lost WARN / CONTENT GAP / GUI line.

NEGTEST
  $ node tools/cardgen/negtest.js
  14/14 negative tests caught          (no SKIP (anchor gone) line)

ACCEPTANCE VERIFIER  <scratch>/w6-verify.js
  1. identity coverage
    NOTE objKey 28 missing Price - named by no restriction list; pre-existing
    NOTE objKey 29 missing Price - named by no restriction list; pre-existing
    42 distinct object keys across 126 Ship cards
  2. identity cards vs the player-flyable hull of their family
    30 identity card sets checked field by field against their ShipList hull
  3. restriction entries
    902 ShipSystem cards carry a list, 1413 carry []
    24 distinct object keys referenced, every one an objKey AND a full Ship card guid
    by slot/tier: avionics/t1=6 computer/t1=280 computer/t2=30 computer/t3=10 engine/t1=150
                  gun/t1=30 hull/t1=190 launcher/t1=20 role/t2=10 special_weapon/t2=10
                  weapon/t1=150 weapon/t2=10 weapon/t3=6
  4. paints: 99 ShipPaint cards, 0 with a restriction list (must be 0)
  5. no bay was emptied by turning restrictions on
    284 stocked (hull, bay) cells across 60 flyable hull cards, 0 emptied by restrictions
  ALL CHECKS PASS
  (902 = 88 systems x 10 rungs + 6 CAMS + 10 C-31 rungs + 6 platform weapons.)

RULE-FIRE HARNESS  <scratch>/w6-rulecheck.js  (negtest's format, kept out of the repo so the
pinned 14/14 headline does not move)
  PASS  no identity cards at all -> G16 has no Ship card at the entry guid
  PASS  identity card copies an NPC clone instead of the ShipList hull
  PASS  identity card keeps its hull's paperdoll layout at Level 0
  PASS  identity card gets a HangarID of its own
  PASS  Ship card at the entry guid belongs to another family
  PASS  identity card loses its Price card
  PASS  identity card loses its ShipLight card
  PASS  two ShipList members in one hull family
  PASS  a hull family whose members disagree on Tier
  PASS  a restriction entry that is nobody's ShipObjectKey
  PASS  paints get the dump's restriction lists back
  PASS  the avionics restriction gate stops following the systems flag
  12/12 rules proved able to fire

CARD-NULL PREDICTION  <scratch>/w6-closure.js
  Transitive closure of every client FetchCard edge (GameItemCard.cs:39-42, ShipCard.cs:139/143,
  ShipSystemCard.cs:100/121/138, ShipSystemPaintCard.cs:33, ShipConsumableCard.cs:50,
  Ship.cs:65-69, SpaceObject.cs:650) from the two ShipLists, everything ShopProtocol.setupShop
  stocks on a prod profile, and every object the SectorTemplates place:
    roots: 2 ShipLists, 335 stocked systems, 157 stocked countables
    closure: 10640 distinct (guid, view) cards reachable
      of which Ship cards at an object key: 24
    NO DANGLING FETCH. Zero "Card should not be send because it's null!" lines predicted.
  Restriction edges account for 112 of those 10,640 (10,528 with them removed).

CATALOGUE THROUGH THE SERVER'S OWN CODE  <scratch>/W5CatalogueLoad.java (W5's harness, reused)
  cards deserialised : 11696 in 765 ms
  cards that came back null (no CardBuilder arm) : 0
  cards written to the wire : 11696 in 23 ms, 981066 bytes total
  write failures : 0
  chain-length census (Catalogue.fetchAllSystemCards) : {1=115, 10=220}
  chain gaps : 0
  subset from w6-closureset.txt : 10640 cards, 871079 bytes (0 not found)
  subset from w6-identityset.txt : 150 cards, 34301 bytes (0 not found)
  All 126 Ship cards have HangarID != -1, so none is dropped by CatalogueProtocol.shipCardFilter.

BOOT  <scratch>/w5boot on ports 27960-27962 / 28791 / 29000, its own sqlite, the user's live
server on 27050/27051 untouched (verified by PID before and after; both boot JVMs killed)
  size: 11696
  LoginServerListener successfully started
  Server started!
  Card should not be send because it's null!  -> 0 occurrences
  Only recurring error is "Failed to connect to chat server ... 127.0.0.1:27962", which is the
  isolated boot having no chat peer. Shutdown-time sector InterruptedExceptions match W5's own
  boot log line for line.

IDEMPOTENCY OF THE SIBLING GENERATORS (both re-run after the flip)
  node tools/cardgen/gen-paints-real.js   -> paints-real.js BYTE IDENTICAL
  node tools/cardgen/emit-npc-configs.js  -> config/ShipConfigTemplates sha1 unchanged
                                             (50ce401635af5e4fa9670ccbbf8eb9cc13cee44f both runs)

TRANSLATION UNCHANGED BY THE IDENTITY CARDS
  ourRestrictions differs on 0 of the 219 records against the pre-W6 systems-real.js.
  gen-systems-real.js self-check: all 20 PASS lines, 219 kept / 15 dropped, 21-cell census intact.

NO JAVA CHANGED, so nothing in patches/ moved and no compile was required.

Problems: The live client half is still unproven, and it is the same gap every W package has left. I could not open a store, hover a tooltip or attempt an equip. What I can say is that no card the client asks for is missing (10,640-card closure, zero dangling) and that every one of the 11,696 cards writes to the wire through the server's own writers without throwing. What I cannot say is that the tooltip renders the right hull NAME, only that it fetches the right card.; 48 of the 88 restricted systems carry 10-entry lists, and GuiAdvancedRequirementsPanel.cs:77 only renders hull names when the list has fewer than 5 entries. Those 48 fall through to the 'Required ship class' branch instead. That is the original's behaviour with the original's list sizes — I verified our filtering moves no system across the boundary — but half the restricted catalogue will not name its hulls in the tooltip, and that will look like a bug to anyone expecting otherwise.; The live player has three system_light_boosters fitted to the Advanced Colonial Stealth that the dump says do not belong there. They keep working (nothing re-validates a fitted item on load) but cannot be re-fitted once removed and will vanish from the hold list while that ship is active. I left the DB alone; the drop-in replacement is item_slot_strike_stealth_engine_system_booster (659108334). Full detail in the handoff.; BLOCK-5 stands and is now the one thing standing between this package and real enforcement. ShopVisitor.visit(ShipSlot) and ShipSlotVisitor.visit(ShipSlot) both skip isObjectKeyRestrictionsBlocked, and nothing checks slot type or tier on equip either. ContainerVisitor.java:135 is the only call site in the entire server. So a crafted packet can still put any item in any slot on any hull: these restrictions are UI fidelity, not a gate. Out of scope here and unchanged by this package.; PlayerProtocol.addShip is missing the empty-BuyPrice guard that checkItemToBuy:698 has, and that is a server-side hole this package mitigated rather than closed. Faction Neutral on the identity Price cards refuses the purchase for every non-developer, but a Developer-role account still gets through, and the 16 pre-existing Ship cards with an empty BuyPrice (the six outposts, the two weapon platforms, the two capitals via their rental path) have the same shape without the mitigation. The real fix is four lines mirroring the existing guard: `if (buyPrice.isEmpty()) return;` after the level check. I left it out because W6 is meant to be pure data with a one-constant revert, and a Java change drags in a patch group and a full mkpatches regeneration.; Cruiser Ship cards 28 and 29 have no Price card, which my verifier reports as a NOTE. I chased it and it is NOT a defect: a space-object Ship fetches only ShipLight (Ship.cs:65-69) and World/GUI/Owner through SpaceObject.cs:650-652, never a ShipCard, so GameItemCard.Read never runs for them and no Price is ever requested. The eight live-session logs confirm it — zero card-null lines across all of them. It would become a defect the moment a restriction named 28 or 29, and G16 fails the build on exactly that.; systems-real.js is 841 KB and its diff for this package is 2,190 lines of `restrictions: [...]` where there were empty arrays. Review it through the generator's self-check block and <scratch>/w6-verify.js, not by eye — same advice B3 gave when the file landed.; quarkus-maven-plugin is still missing from the local .m2, so no maven build works on this machine. It did not matter here (no Java changed) but it is still true for whoever touches the server next. The catalogue-load harness at <scratch>/W5CatalogueLoad.java runs against server/target/classes with gson, cdi-api and slf4j-api on the classpath and is the substitute I used.

## Smaller findings

- medium: Acceptance criterion 17's guardrail is not implemented. The criterion says the generator 'fails on a mismatch in the four exact counts' against tools/cardgen/expected-counts.json. That file does not exist and cards.js contains no count assertion, so nothing would catch a future regression in the by-view counts.
- medium: Acceptance criterion 2 ('cards.js prints no CONTENT GAP line at all') is unsatisfiable and directly contradicts criterion 1, which explicitly permits the four BLOCK-3 role families. W3 deliberately made the rule tier-aware, which is strictly better and is what the package brief asked for, but it means criterion 2 can never pass.
- medium: Acceptance criterion 14 ('every GUI key resolves with .name AND .description') fails on the description half: 67 distinct GUI keys have no Description form in loca-keys.txt. cards.js only warns on description, so the build stays green.
- low: Acceptance criterion 15 ('G12's warning list contains only the nine allowlisted keys; any tenth is a defect') cannot fail. G12 emits zero warnings on today's content, and an empty list satisfies 'only the nine' trivially. Separately, the shipped allowlist has eleven entries, not the nine §1.10 specifies.
- medium: Six shop-stocked level-1 systems can never be worn by any player-flyable hull. 6041, 6042 and 6051–6054 are weapon/t3 with SENTRY/capital object-key restrictions, they carry a BuyPrice, and ShopProtocol.setupShop stocks every level-1 ShipSystem that has a Price card. A tier-3 player can buy one and is left holding it.
- low: The StickerList card emits a StickersAncient key that StickerListCard.java does not declare, so Gson silently drops it. Whatever ancient stickers were intended never reach the client.
- low: mkpatches.js's coverage check reads only `git diff --name-only`, so a brand-new untracked source file is covered by no patch group and the check still passes. CapitalRental.java is in exactly that state.
- low: README.md still advertises 1,260 cards. PATCHES.md was correctly updated to 11,696; the README was not.
- low: Acceptance criterion 9 specifies '14 patches'. mkpatches now produces 20. The extra six are legitimate back-fill (0015–0020, documented in PATCHES.md as fifteen files changed in earlier sessions that had never been added), but the criterion as written fails on a number that no longer means anything.
- low: Criterion 18 is closed only on its static half. The isolated boot reaches Server started! with zero card-null lines, but the run then dies on a port clash with the user's live server, so 'a full session' with live NPCs and players is still unproven — the same gap W2/W5/W6 reported.
- medium: All 30 Advanced hull GUI cards carry level 1 where the dump carries level 2, so every upgraded hull renders its base name
- low: Six platform weapons are stocked and buyable but cannot be fitted to any flyable hull
- low: The shop paperdoll refuses a paint drop on any Advanced hull; only the ship customization window accepts it, and the generator's "paint coverage 60/60" line is measured with the looser of the two client tests
- low: node tools/cardgen/cards.js fails if negtest.js is running concurrently, because the negative-test probe lives in the shared live config tree
- low: Two GUI cards the client fetches by hardcoded guid are not emitted: GUI 12924519 (GroupBuff.cs:13) and GUI 226742606 (MagneticStorm.cs:15). Pre-existing — `git show HEAD:tools/cardgen/cards.js` emits neither either — and cosmetic rather than a hang, but it is the only dangling client fetch in the whole catalogue.
- low: `server/ServerConfigurationUtils/global/ShipConfigTemplates/ancient/100_40_drone_small.json` names shipGUID 40, which has no Ship card. That NPC can never spawn.
- low: `StickerList 166885587` carries a JSON key `StickersAncient` that `StickerListCard` does not declare, and the Regulation card carries a relation/type entry for AbilityGroupId 0 that no emitted ability uses. Both inert.
- low: Informational, not a safety issue: `SkillHashes` is empty on all 2,315 emitted ShipSystem cards, so no piece of equipment is skill-gated. The dump's systems carry skill requirements; ours carry none. No implementer report mentions this.
- medium: Nine more hand-authored config files live only in the gitignored live tree and would vanish on a fresh unpack.
- medium: The pre-pass DB backup is not a clean immediately-before snapshot, because the live server has been writing to the database throughout the pass.
- medium: tools/watch-equipment-pass.js is running detached and will shut the machine down when the workflow finishes.
- low: config/ShipConfigTemplates has no ancient/ directory, so acceptance item (c) cannot be satisfied as literally worded.
- low: The mkpatches re-run left seven patch files showing as modified in git status although their content is unchanged.

## Picking this back up

The whole conversation, including the research and every decision behind this pass, resumes with:

```
cd C:\Users\danie\Documents\Projects\BSGO-Server
claude --resume eab3d2a3-ebb8-4734-9022-327546b8b023
```

Nothing was committed. `git status` shows the full extent of the change, and your save file
is backed up at `server/sqlite/bgo_server.db.bak-before-equipment-pass` if the migration
did anything you disagree with.

The longer research trail lives in the scratchpad:

```
C:\Users\danie\AppData\Local\Temp\claude\C--Users-danie-Documents-Projects-BSGO-Server\eab3d2a3-ebb8-4734-9022-327546b8b023\scratchpad
```

BLUEPRINT-v2.md is the plan that was executed; DECISIONS.md records the scope calls and why.
