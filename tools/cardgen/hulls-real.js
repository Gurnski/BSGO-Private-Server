/* ============================================ REAL HULL DATA, FROM A LIVE SERVER
 *
 * GENERATED FILE - do not hand-edit. Regenerate with the card dumper (Fulgar's GameDev tab)
 * plus tools/cardgen/gen-hulls-real.py against a fresh dump.
 *
 * Source: a 14,223-card dump of a running BSGO private server, every card fully resolved.
 * Stats are already de-obfuscated - the client stores each value minus a per-instance random
 * constant, so the raw numbers are meaningless without that pass. These are the LEVEL 1 cards,
 * i.e. the ship as bought; level 2 is the "Advanced" upgrade and is not modelled here.
 *
 * WHY THIS EXISTS. Everything in it replaced something we had generated from a formula:
 *   - flight stats were per-ROLE, so every tier-1 fighter flew identically. Real ones vary per
 *     hull, and are far slower and heavier: a Viper Mk II tops out at 55 m/s, not 115, and
 *     accelerates at 13.5, not 69. Ships that hit top speed instantly is what "the physics feel
 *     horrendous" was.
 *   - StrafeMaxSpeed and StrafeAcceleration are ZERO on every strike hull in the dump. We shipped
 *     40 and 80. Strike craft in this game do not strafe. Safe to zero: the movement sim only
 *     ever MULTIPLIES by them (MovementSimulation.java:203-208), never divides, and Strafe is
 *     not in the FLIGHT_REQUIRED set.
 *   - RollMaxSpeed and RollAcceleration were far too LOW - a real Viper rolls at 182 with 748
 *     acceleration against our 126/253. Slow forward, fast roll, is the shape of the real thing.
 *   - slot id -> hardpoint mapping was wrong, which is why weapons pointed the wrong way: each
 *     hardpoint carries its own rotation quaternion, so a weapon in the wrong slot renders at
 *     the wrong place AND the wrong angle.
 *   - the "launcher" slot type we put on all 30 hulls exists on exactly FOUR prefabs in the
 *     whole dump: the two stealth hulls and the two carriers. Nothing else has one.
 *   - hull / computer / engine / ship_paint / avionics slots were missing entirely, so no module
 *     could be fitted to anything.
 *
 * THE STAT BLOCK IS THE WHOLE BLOCK, NOT JUST FLIGHT, and that is load-bearing rather than tidy.
 * ShipSubscribeInfo.applySlotSystemStats:65-84 runs every fitted module's StaticBuffs through
 * ObjectStats.applyStatsAddTo and its MultiplyBuffs through applyStatsMultTo, and both write a
 * key ONLY if the target map already holds it (ObjectStats.java:159, :174). The target is seeded
 * once from this block and never gains a key afterwards. So a module buffing a stat the hull does
 * not seed does nothing at all - no error, no log line, just an item with no effect. While this
 * file carried 18 flight keys, every ArmorValue, FirewallRating, PenetrationStrength, Avoidance
 * and DecayResistance module in the catalogue was decorative. It now carries all 41 keys the
 * dump's Ship cards seed, less the seven cards.js owns: 34 in the file, 32 or 33 on any one hull.
 *
 * SEVEN DUMP KEYS ARE DELIBERATELY ABSENT: FtlRange, FtlCharge, FtlCooldown, FtlCost,
 * DetectionVisualRadius, DetectionInnerRadius, DetectionOuterRadius. shipCards() merges this
 * file's stats LAST, so emitting them here would silently beat cards.js, and cards.js is right
 * about all seven - our galaxy geometry is not the original's (cards.js:124-139) and the three
 * radii are already set per hull by the DETECTION table. negtest case 6 anchors on the literal
 * "FtlCooldown: 35, FtlCost: 1," at cards.js:139 and would go vacuous while still printing PASS.
 *
 * NINE BUFF KEYS CAN NEVER BE SEEDED - not by us, not by the original. Cross-joining the dump
 * modules' buff keys against the union of all 95 dump Ship stat blocks leaves these unseeded on
 * every hull the original ever shipped:
 *     DrainResistance  PowerPointRestore  ToggleSystemCooldown
 *     MissileCooldown        MissilePowerPointCost
 *     LightMissileCooldown   LightMissilePowerPointCost
 *     HeavyMissileCooldown   HeavyMissilePowerPointCost
 * No extraction can fix that, because there is nothing to extract. Two of them are inert by
 * design rather than by omission: SkillBook.java:261 maps MissileCooldown onto Cooldown for
 * SKILLS only, never for ship stats, and RestoreBuffAction.java:37-39 reads PowerPointRestore off
 * the casting ABILITY's ItemBuffAdd, never off the ship. The dead-buff validator treats exactly
 * this list as a known-inert allowlist and warns instead of failing - a module buffing one of
 * these is as inert here as it was on the live server, which is as close to correct as the data
 * allows. TurnSpeed and TurnAcceleration look unseeded by the same test (345 and 90 dump modules
 * buff them) but are NOT dead and must never be added to that allowlist: applySlotSystemStats
 * passes every buff through ObjectStats.mapObjectStats first, and :106-119 rewrites TurnSpeed to
 * Pitch/YawMaxSpeed and TurnAcceleration to Pitch/YawAcceleration, all four of which are seeded.
 *
 * THREE OF THE ADDED KEYS CHANGE COMBAT MATH FOR EVERY SHIP. All three are intended, and the
 * first two only make sense next to the dump's own weapons:
 *   - Avoidance / AvoidanceFading. WeaponAction.java:95-99 feeds them to
 *     HitchanceBasedOnThrottle, where the base hit chance is
 *     clamp(0.675 - 0.0015*(avoidance - accuracy), 0.05, 0.95). At the Avoidance 0 we shipped,
 *     Accuracy 100 hit 82.5% of the time and anything above 150 hit the 95% ceiling - there was no
 *     such thing as a miss. The real numbers are TIER-MATCHED: hulls carry 490-520 at tier 1,
 *     250-290 at tier 2, 30-70 at tier 3, 20 at tier 4, and the dump answers them with weapons at
 *     Accuracy 400 (tier 1), 335 (tier 2) and 125 (tier 3). Dump on dump is 51% at tier 1 and
 *     76-80% at tier 3, which is the curve the game was tuned around. Our CURRENT tier-1 weapons
 *     carry Accuracy 100-150, and against Avoidance 510 that is a 6-13% hit chance at full
 *     throttle: hulls and weapons are one balance system and have to land in the same wave.
 *     AvoidanceFading is 0.75 on tiers 1-2 and ABSENT on tiers 3-4. Absent reads as 0, and
 *     HitchanceBasedOnThrottle.java:62 short-circuits on 0 and returns the full avoidance - no
 *     divide, no NaN. So a tier-1/2 hull fades to 25% avoidance when stationary and a tier-3/4
 *     hull never fades at all.
 *   - ArmorValue: 0-10 at tier 1, 25-30 at tier 2, 40-45 at tier 3. Inert while SectorAlgorithms
 *     installs ArmorAlgorithmV0, whose getMultiplicator() returns a constant 1. Under V1 these
 *     change damage taken for every ship and NPC in the game.
 *   - CriticalDefense, 60-150. cards.js seeds 0 on every hull so that crit-defence buffs have
 *     something to apply to; the dump's real values win because this file merges last.
 *     CritchanceAlgorithmV1 gives clamp01((5 + 0.15*(critOffense - critDefense))/100), so a weapon
 *     needs CriticalOffense above critDefense - 33 to crit at all. Our tier-1 weapons carry 20-45
 *     against the new 60-120, so tier 1 crits stop entirely until the dump weapons (100-200) land.
 *     Tiers 3 and 4 are unaffected - ours already carry 90-405.
 * None of this reaches the ten stations, platforms and motherships or the two capitals, which have
 * no dump prefab and so no entry here. They keep Avoidance 0 (a 95% hit ceiling against them) and
 * whatever cards.js gives them, which for the Pegasus and the Basestar is CAPITAL_FLIGHT's
 * ArmorValue 60 / CriticalDefense 200.
 *
 * SLOT ROW: [slotId, slotType, objectPoint, objectPointServerHash, level]
 * objectPoint is "undefined" and the hash 44673 for every non-weapon slot - those do not attach
 * to a transform on the model, so they share one sentinel.
 */
'use strict';

const HULLS_REAL = {
  cylont1command: {
    stats: { Speed: 52.5, BoostSpeed: 77.5, Acceleration: 10, AccelerationMultiplierOnBoost: 3, PitchMaxSpeed: 47.5, YawMaxSpeed: 47.5, RollMaxSpeed: 130.625, StrafeMaxSpeed: 0, PitchAcceleration: 47.5, YawAcceleration: 47.5, RollAcceleration: 598.5, StrafeAcceleration: 0, InertiaCompensation: 100, BoostCost: 0.6, MaxHullPoints: 500, MaxPowerPoints: 150, HullRecovery: 3, PowerRecovery: 5.5, ArmorValue: 5, Avoidance: 500, AvoidanceFading: 0.75, CriticalDefense: 100, FirewallRating: 200, PenetrationStrength: 200, DecayDamageFactor: 50, DecayResistance: 0, MaxVitalPoints: 130, VitalRecovery: 0.8, CargoHoldVolume: 6, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2, JumpTargetTransponderPowerPointCost: -25 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet02', 50321, 1],
      [2, 'weapon', 'bullet03', 19778, 1],
      [3, 'hull', 'undefined', 44673, 1],
      [4, 'hull', 'undefined', 44673, 1],
      [5, 'computer', 'undefined', 44673, 1],
      [6, 'computer', 'undefined', 44673, 1],
      [7, 'engine', 'undefined', 44673, 1],
      [8, 'engine', 'undefined', 44673, 1],
      [9, 'weapon', 'elitebullet04', 27288, 2],
      [10, 'computer', 'undefined', 44673, 1],
      [11, 'computer', 'undefined', 44673, 1],
      [12, 'computer', 'undefined', 44673, 2],
      [13, 'ship_paint', 'undefined', 44673, 1],
      [14, 'avionics', 'undefined', 44673, 1],
    ],
  },
  cylont1defender: {
    stats: { Speed: 50, BoostSpeed: 75, Acceleration: 8, AccelerationMultiplierOnBoost: 7, PitchMaxSpeed: 45, YawMaxSpeed: 45, RollMaxSpeed: 101.25, StrafeMaxSpeed: 0, PitchAcceleration: 45, YawAcceleration: 45, RollAcceleration: 450, StrafeAcceleration: 0, InertiaCompensation: 100, BoostCost: 0.7, MaxHullPoints: 715, MaxPowerPoints: 150, HullRecovery: 5.5, PowerRecovery: 5, ArmorValue: 10, Avoidance: 490, AvoidanceFading: 0.75, CriticalDefense: 120, FirewallRating: 150, PenetrationStrength: 150, DecayDamageFactor: 50, DecayResistance: 0, MaxVitalPoints: 130, VitalRecovery: 0.8, CargoHoldVolume: 7, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet02', 50321, 1],
      [2, 'weapon', 'bullet03', 19778, 1],
      [3, 'hull', 'undefined', 44673, 1],
      [4, 'hull', 'undefined', 44673, 1],
      [5, 'hull', 'undefined', 44673, 1],
      [6, 'hull', 'undefined', 44673, 1],
      [7, 'computer', 'undefined', 44673, 1],
      [8, 'hull', 'undefined', 44673, 1],
      [9, 'computer', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'weapon', 'elitebullet04', 27288, 1],
      [13, 'weapon', 'elitebullet05', 2575, 2],
      [14, 'ship_paint', 'undefined', 44673, 1],
      [15, 'avionics', 'undefined', 44673, 1],
    ],
  },
  cylont1fighter: {
    stats: { Speed: 55, BoostSpeed: 90, Acceleration: 13.5, AccelerationMultiplierOnBoost: 1.5, PitchMaxSpeed: 52, YawMaxSpeed: 52, RollMaxSpeed: 182, StrafeMaxSpeed: 0, PitchAcceleration: 55, YawAcceleration: 55, RollAcceleration: 748, StrafeAcceleration: 0, InertiaCompensation: 175, BoostCost: 0.5, MaxHullPoints: 450, MaxPowerPoints: 100, HullRecovery: 2.5, PowerRecovery: 5, ArmorValue: 5, Avoidance: 510, AvoidanceFading: 0.75, CriticalDefense: 80, FirewallRating: 100, PenetrationStrength: 100, DecayDamageFactor: 50, DecayResistance: 0, MaxVitalPoints: 80, VitalRecovery: 0.5, CargoHoldVolume: 4, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet02', 50321, 1],
      [2, 'weapon', 'bullet03', 19778, 1],
      [3, 'engine', 'undefined', 44673, 1],
      [4, 'engine', 'undefined', 44673, 1],
      [5, 'hull', 'undefined', 44673, 1],
      [6, 'hull', 'undefined', 44673, 1],
      [7, 'computer', 'undefined', 44673, 1],
      [8, 'computer', 'undefined', 44673, 1],
      [9, 'engine', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 2],
      [12, 'weapon', 'elitebullet04', 27288, 2],
      [13, 'ship_paint', 'undefined', 44673, 1],
      [14, 'avionics', 'undefined', 44673, 1],
    ],
  },
  cylont1merit: {
    stats: { Speed: 55, BoostSpeed: 85, Acceleration: 12, AccelerationMultiplierOnBoost: 4, PitchMaxSpeed: 50, YawMaxSpeed: 50, RollMaxSpeed: 200, StrafeMaxSpeed: 0, PitchAcceleration: 55, YawAcceleration: 55, RollAcceleration: 748, StrafeAcceleration: 0, InertiaCompensation: 100, BoostCost: 0.75, MaxHullPoints: 585, MaxPowerPoints: 150, HullRecovery: 4.5, PowerRecovery: 5, ArmorValue: 5, Avoidance: 510, AvoidanceFading: 0.75, CriticalDefense: 80, FirewallRating: 100, PenetrationStrength: 100, DecayDamageFactor: 50, DecayResistance: 0, MaxVitalPoints: 100, VitalRecovery: 0.6, CargoHoldVolume: 4, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet02', 50321, 2],
      [2, 'weapon', 'bullet03', 19778, 1],
      [3, 'weapon', 'bullet04', 50370, 1],
      [4, 'weapon', 'bullet05', 21514, 1],
      [5, 'hull', 'undefined', 44673, 1],
      [6, 'hull', 'undefined', 44673, 1],
      [7, 'engine', 'undefined', 44673, 1],
      [8, 'engine', 'undefined', 44673, 1],
      [9, 'engine', 'undefined', 44673, 1],
      [10, 'hull', 'undefined', 44673, 1],
      [11, 'computer', 'undefined', 44673, 1],
      [12, 'computer', 'undefined', 44673, 1],
      [13, 'computer', 'undefined', 44673, 1],
      [14, 'ship_paint', 'undefined', 44673, 1],
      [15, 'avionics', 'undefined', 44673, 1],
    ],
  },
  cylont1multi2: {
    stats: { Speed: 55, BoostSpeed: 100, Acceleration: 14, AccelerationMultiplierOnBoost: 4.5, PitchMaxSpeed: 51, YawMaxSpeed: 51, RollMaxSpeed: 175, StrafeMaxSpeed: 0, PitchAcceleration: 55, YawAcceleration: 55, RollAcceleration: 748, StrafeAcceleration: 0, InertiaCompensation: 100, BoostCost: 0.5, MaxHullPoints: 515, MaxPowerPoints: 100, HullRecovery: 3.5, PowerRecovery: 5.2, ArmorValue: 5, Avoidance: 510, AvoidanceFading: 0.75, CriticalDefense: 80, FirewallRating: 100, PenetrationStrength: 100, DecayDamageFactor: 50, DecayResistance: 0, MaxVitalPoints: 80, VitalRecovery: 0.5, CargoHoldVolume: 5, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet02', 50321, 1],
      [2, 'weapon', 'bullet03', 19778, 1],
      [3, 'engine', 'undefined', 44673, 1],
      [4, 'hull', 'undefined', 44673, 1],
      [5, 'hull', 'undefined', 44673, 1],
      [6, 'hull', 'undefined', 44673, 1],
      [7, 'computer', 'undefined', 44673, 1],
      [8, 'computer', 'undefined', 44673, 1],
      [9, 'engine', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 2],
      [12, 'weapon', 'elitebullet04', 27288, 2],
      [13, 'ship_paint', 'undefined', 44673, 1],
      [14, 'avionics', 'undefined', 44673, 1],
    ],
  },
  cylont1scout: {
    stats: { Speed: 52.5, BoostSpeed: 77.5, Acceleration: 10, AccelerationMultiplierOnBoost: 4, PitchMaxSpeed: 47.5, YawMaxSpeed: 47.5, RollMaxSpeed: 130.625, StrafeMaxSpeed: 0, PitchAcceleration: 47.5, YawAcceleration: 47.5, RollAcceleration: 598.5, StrafeAcceleration: 0, InertiaCompensation: 100, BoostCost: 0.6, MaxHullPoints: 650, MaxPowerPoints: 200, HullRecovery: 5, PowerRecovery: 6, ArmorValue: 5, Avoidance: 500, AvoidanceFading: 0.75, CriticalDefense: 100, FirewallRating: 200, PenetrationStrength: 200, DecayDamageFactor: 50, DecayResistance: 0, MaxVitalPoints: 130, VitalRecovery: 0.8, CargoHoldVolume: 5, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2, JumpTargetTransponderPowerPointCost: -75 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet02', 50321, 1],
      [2, 'weapon', 'bullet03', 19778, 1],
      [3, 'engine', 'undefined', 44673, 1],
      [4, 'engine', 'undefined', 44673, 1],
      [5, 'computer', 'undefined', 44673, 1],
      [6, 'computer', 'undefined', 44673, 1],
      [7, 'engine', 'undefined', 44673, 1],
      [8, 'engine', 'undefined', 44673, 1],
      [9, 'hull', 'undefined', 44673, 1],
      [10, 'computer', 'undefined', 44673, 1],
      [11, 'computer', 'undefined', 44673, 1],
      [12, 'computer', 'undefined', 44673, 1],
      [13, 'ship_paint', 'undefined', 44673, 1],
      [14, 'avionics', 'undefined', 44673, 1],
    ],
  },
  cylont1stealth: {
    stats: { Speed: 70, BoostSpeed: 90, Acceleration: 13, AccelerationMultiplierOnBoost: 1.25, PitchMaxSpeed: 52, YawMaxSpeed: 50, RollMaxSpeed: 90, StrafeMaxSpeed: 30, PitchAcceleration: 75, YawAcceleration: 90, RollAcceleration: 750, StrafeAcceleration: 80, InertiaCompensation: 175, BoostCost: 0.5, MaxHullPoints: 350, MaxPowerPoints: 120, HullRecovery: 3, PowerRecovery: 3, ArmorValue: 0, Avoidance: 520, AvoidanceFading: 0.75, CriticalDefense: 60, FirewallRating: 100, PenetrationStrength: 100, DecayDamageFactor: 50, DecayResistance: 0, MaxVitalPoints: 70, VitalRecovery: 0.4, CargoHoldVolume: 3, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'gun', 'bullet01', 49813, 1],
      [1, 'computer', 'undefined', 44673, 2],
      [2, 'gun', 'bullet02', 50321, 1],
      [3, 'engine', 'undefined', 44673, 2],
      [4, 'launcher', 'bullet03', 19778, 1],
      [6, 'hull', 'undefined', 44673, 1],
      [7, 'hull', 'undefined', 44673, 1],
      [8, 'computer', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [13, 'ship_paint', 'undefined', 44673, 1],
      [14, 'avionics', 'undefined', 44673, 1],
      [16, 'engine', 'undefined', 44673, 1],
      [17, 'role', 'undefined', 44673, 1],
    ],
  },
  cylont2command: {
    stats: { Speed: 37.5, BoostSpeed: 57.5, Acceleration: 5, AccelerationMultiplierOnBoost: 1.5, PitchMaxSpeed: 22.5, YawMaxSpeed: 22.5, RollMaxSpeed: 39.375, StrafeMaxSpeed: 0, PitchAcceleration: 22.5, YawAcceleration: 22.5, RollAcceleration: 39.375, StrafeAcceleration: 0, InertiaCompensation: 50, BoostCost: 1.8, MaxHullPoints: 1700, MaxPowerPoints: 330, HullRecovery: 15, PowerRecovery: 12, ArmorValue: 25, Avoidance: 270, AvoidanceFading: 0.75, CriticalDefense: 100, FirewallRating: 200, PenetrationStrength: 200, DecayDamageFactor: 150, DecayResistance: 0, MaxVitalPoints: 160, VitalRecovery: 1, CargoHoldVolume: 9, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2, JumpTargetTransponderPowerPointCost: -50 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet03', 19778, 1],
      [2, 'weapon', 'bullet02', 50321, 1],
      [3, 'weapon', 'bullet04', 50370, 1],
      [4, 'hull', 'undefined', 44673, 1],
      [5, 'hull', 'undefined', 44673, 1],
      [6, 'computer', 'undefined', 44673, 1],
      [7, 'computer', 'undefined', 44673, 1],
      [8, 'computer', 'undefined', 44673, 1],
      [9, 'computer', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'weapon', 'elitebullet05', 2575, 1],
      [13, 'weapon', 'elitebullet06', 34993, 1],
      [14, 'computer', 'undefined', 44673, 1],
      [15, 'hull', 'undefined', 44673, 2],
      [16, 'ship_paint', 'undefined', 44673, 1],
    ],
  },
  cylont2defender: {
    stats: { Speed: 35, BoostSpeed: 55, Acceleration: 4, AccelerationMultiplierOnBoost: 1.5, PitchMaxSpeed: 20, YawMaxSpeed: 20, RollMaxSpeed: 30, StrafeMaxSpeed: 0, PitchAcceleration: 20, YawAcceleration: 20, RollAcceleration: 30, StrafeAcceleration: 0, InertiaCompensation: 50, BoostCost: 2.1, MaxHullPoints: 2000, MaxPowerPoints: 200, HullRecovery: 8.9, PowerRecovery: 10, ArmorValue: 30, Avoidance: 250, AvoidanceFading: 0.75, CriticalDefense: 120, FirewallRating: 150, PenetrationStrength: 150, DecayDamageFactor: 150, DecayResistance: 0, MaxVitalPoints: 170, VitalRecovery: 1.1, CargoHoldVolume: 10, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet03', 19778, 1],
      [2, 'weapon', 'bullet02', 50321, 1],
      [3, 'weapon', 'bullet04', 50370, 1],
      [4, 'hull', 'undefined', 44673, 1],
      [5, 'hull', 'undefined', 44673, 1],
      [6, 'hull', 'undefined', 44673, 2],
      [7, 'hull', 'undefined', 44673, 1],
      [8, 'computer', 'undefined', 44673, 1],
      [9, 'computer', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'weapon', 'elitebullet05', 2575, 2],
      [13, 'weapon', 'elitebullet06', 34993, 2],
      [14, 'hull', 'undefined', 44673, 1],
      [15, 'ship_paint', 'undefined', 44673, 1],
      [16, 'special_weapon', 'bullet07', 64555, 1],
      [17, 'role', 'undefined', 44673, 1],
    ],
  },
  cylont2fighter: {
    stats: { Speed: 40, BoostSpeed: 60, Acceleration: 5, AccelerationMultiplierOnBoost: 1.5, PitchMaxSpeed: 25, YawMaxSpeed: 25, RollMaxSpeed: 50, StrafeMaxSpeed: 0, PitchAcceleration: 25, YawAcceleration: 25, RollAcceleration: 50, StrafeAcceleration: 0, InertiaCompensation: 50, BoostCost: 1.5, MaxHullPoints: 1400, MaxPowerPoints: 200, HullRecovery: 7.8, PowerRecovery: 10, ArmorValue: 25, Avoidance: 290, AvoidanceFading: 0.75, CriticalDefense: 80, FirewallRating: 100, PenetrationStrength: 100, DecayDamageFactor: 150, DecayResistance: 0, MaxVitalPoints: 140, VitalRecovery: 0.9, CargoHoldVolume: 7, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet03', 19778, 1],
      [2, 'weapon', 'bullet02', 50321, 1],
      [3, 'weapon', 'bullet04', 50370, 1],
      [4, 'engine', 'undefined', 44673, 1],
      [5, 'hull', 'undefined', 44673, 1],
      [6, 'hull', 'undefined', 44673, 1],
      [7, 'computer', 'undefined', 44673, 1],
      [8, 'computer', 'undefined', 44673, 1],
      [9, 'engine', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'weapon', 'elitebullet05', 2575, 2],
      [13, 'weapon', 'elitebullet06', 34993, 2],
      [14, 'engine', 'undefined', 44673, 2],
      [15, 'ship_paint', 'undefined', 44673, 1],
    ],
  },
  cylont2merit: {
    stats: { Speed: 40, BoostSpeed: 60, Acceleration: 5, AccelerationMultiplierOnBoost: 1.5, PitchMaxSpeed: 25, YawMaxSpeed: 25, RollMaxSpeed: 43.75, StrafeMaxSpeed: 0, PitchAcceleration: 25, YawAcceleration: 25, RollAcceleration: 43.75, StrafeAcceleration: 0, InertiaCompensation: 50, BoostCost: 2.7, MaxHullPoints: 1950, MaxPowerPoints: 300, HullRecovery: 15, PowerRecovery: 10, ArmorValue: 25, Avoidance: 260, AvoidanceFading: 0.75, CriticalDefense: 100, FirewallRating: 150, PenetrationStrength: 150, DecayDamageFactor: 150, DecayResistance: 0, MaxVitalPoints: 140, VitalRecovery: 0.9, CargoHoldVolume: 6, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet02', 50321, 1],
      [2, 'weapon', 'bullet03', 19778, 1],
      [3, 'weapon', 'bullet07', 64555, 2],
      [4, 'weapon', 'bullet04', 50370, 1],
      [5, 'weapon', 'bullet06', 64121, 1],
      [6, 'weapon', 'bullet05', 21514, 1],
      [7, 'hull', 'undefined', 44673, 1],
      [8, 'hull', 'undefined', 44673, 1],
      [9, 'hull', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'engine', 'undefined', 44673, 1],
      [13, 'computer', 'undefined', 44673, 1],
      [14, 'computer', 'undefined', 44673, 1],
      [15, 'computer', 'undefined', 44673, 1],
      [16, 'ship_paint', 'undefined', 44673, 1],
    ],
  },
  cylont3command: {
    stats: { Speed: 27.5, BoostSpeed: 42.5, Acceleration: 2, AccelerationMultiplierOnBoost: 1.5, PitchMaxSpeed: 9, YawMaxSpeed: 9, RollMaxSpeed: 9, StrafeMaxSpeed: 0, PitchAcceleration: 9, YawAcceleration: 9, RollAcceleration: 9, StrafeAcceleration: 0, InertiaCompensation: 50, BoostCost: 5.4, MaxHullPoints: 3500, MaxPowerPoints: 650, HullRecovery: 19.4, PowerRecovery: 28, ArmorValue: 40, Avoidance: 50, CriticalDefense: 100, FirewallRating: 200, PenetrationStrength: 200, DecayDamageFactor: 350, DecayResistance: 0, MaxVitalPoints: 220, VitalRecovery: 1.4, DurabilityBonus: 0.4, CargoHoldVolume: 13, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2, JumpTargetTransponderPowerPointCost: -150 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet02', 50321, 1],
      [2, 'weapon', 'bullet03', 19778, 1],
      [3, 'weapon', 'bullet04', 50370, 1],
      [4, 'weapon', 'bullet05', 21514, 1],
      [5, 'weapon', 'bullet06', 64121, 1],
      [6, 'hull', 'undefined', 44673, 1],
      [7, 'computer', 'undefined', 44673, 1],
      [8, 'computer', 'undefined', 44673, 1],
      [9, 'computer', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'weapon', 'elitebullet07', 7123, 2],
      [13, 'weapon', 'elitebullet08', 40453, 2],
      [14, 'hull', 'undefined', 44673, 1],
      [15, 'computer', 'undefined', 44673, 1],
      [16, 'computer', 'undefined', 44673, 2],
      [17, 'ship_paint', 'undefined', 44673, 1],
    ],
  },
  cylont3defender: {
    stats: { Speed: 25, BoostSpeed: 40, Acceleration: 1.5, AccelerationMultiplierOnBoost: 1.5, PitchMaxSpeed: 8, YawMaxSpeed: 8, RollMaxSpeed: 8, StrafeMaxSpeed: 0, PitchAcceleration: 8, YawAcceleration: 8, RollAcceleration: 8, StrafeAcceleration: 0, InertiaCompensation: 50, BoostCost: 6.3, MaxHullPoints: 4500, MaxPowerPoints: 500, HullRecovery: 20.6, PowerRecovery: 25, ArmorValue: 45, Avoidance: 30, CriticalDefense: 120, FirewallRating: 150, PenetrationStrength: 150, DecayDamageFactor: 350, DecayResistance: 0, MaxVitalPoints: 240, VitalRecovery: 1.5, DurabilityBonus: 0.4, CargoHoldVolume: 15, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet02', 50321, 1],
      [2, 'weapon', 'bullet03', 19778, 1],
      [3, 'weapon', 'bullet04', 50370, 1],
      [4, 'weapon', 'bullet05', 21514, 1],
      [5, 'weapon', 'bullet06', 64121, 1],
      [6, 'hull', 'undefined', 44673, 1],
      [7, 'hull', 'undefined', 44673, 1],
      [8, 'computer', 'undefined', 44673, 1],
      [9, 'computer', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'weapon', 'elitebullet07', 7123, 2],
      [13, 'weapon', 'elitebullet08', 40453, 2],
      [14, 'hull', 'undefined', 44673, 1],
      [15, 'hull', 'undefined', 44673, 1],
      [16, 'hull', 'undefined', 44673, 2],
      [17, 'ship_paint', 'undefined', 44673, 1],
    ],
  },
  cylont3fighter: {
    stats: { Speed: 30, BoostSpeed: 45, Acceleration: 2.5, AccelerationMultiplierOnBoost: 1.5, PitchMaxSpeed: 10, YawMaxSpeed: 10, RollMaxSpeed: 10, StrafeMaxSpeed: 0, PitchAcceleration: 10, YawAcceleration: 10, RollAcceleration: 10, StrafeAcceleration: 0, InertiaCompensation: 50, BoostCost: 4.5, MaxHullPoints: 4290, MaxPowerPoints: 750, HullRecovery: 33, PowerRecovery: 25, ArmorValue: 40, Avoidance: 70, CriticalDefense: 80, FirewallRating: 100, PenetrationStrength: 100, DecayDamageFactor: 350, DecayResistance: 0, MaxVitalPoints: 180, VitalRecovery: 1.1, DurabilityBonus: 0.4, CargoHoldVolume: 12, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet02', 50321, 1],
      [2, 'weapon', 'bullet03', 19778, 1],
      [3, 'weapon', 'bullet04', 50370, 1],
      [4, 'weapon', 'bullet05', 21514, 1],
      [5, 'weapon', 'bullet06', 64121, 1],
      [6, 'hull', 'undefined', 44673, 1],
      [7, 'computer', 'undefined', 44673, 1],
      [8, 'computer', 'undefined', 44673, 1],
      [9, 'engine', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'weapon', 'elitebullet07', 7123, 1],
      [13, 'weapon', 'elitebullet08', 40453, 1],
      [14, 'hull', 'undefined', 44673, 1],
      [15, 'engine', 'undefined', 44673, 1],
      [16, 'engine', 'undefined', 44673, 1],
      [17, 'hull', 'undefined', 44673, 2],
      [18, 'computer', 'undefined', 44673, 2],
      [19, 'ship_paint', 'undefined', 44673, 1],
    ],
  },
  cylont3merit: {
    stats: { Speed: 30, BoostSpeed: 45, Acceleration: 2, AccelerationMultiplierOnBoost: 1.5, PitchMaxSpeed: 10, YawMaxSpeed: 10, RollMaxSpeed: 10, StrafeMaxSpeed: 0, PitchAcceleration: 10, YawAcceleration: 10, RollAcceleration: 10, StrafeAcceleration: 0, InertiaCompensation: 50, BoostCost: 8.1, MaxHullPoints: 4550, MaxPowerPoints: 750, HullRecovery: 35, PowerRecovery: 25, ArmorValue: 40, Avoidance: 50, CriticalDefense: 100, FirewallRating: 150, PenetrationStrength: 150, DecayDamageFactor: 350, DecayResistance: 0, MaxVitalPoints: 180, VitalRecovery: 1.1, DurabilityBonus: 0.4, CargoHoldVolume: 10, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'weapon', 'bullet02', 50321, 1],
      [1, 'weapon', 'bullet01', 49813, 1],
      [2, 'weapon', 'bullet04', 50370, 1],
      [3, 'weapon', 'bullet06', 64121, 1],
      [4, 'weapon', 'bullet03', 19778, 1],
      [5, 'weapon', 'bullet07', 64555, 1],
      [6, 'hull', 'undefined', 44673, 1],
      [7, 'computer', 'undefined', 44673, 1],
      [8, 'computer', 'undefined', 44673, 1],
      [9, 'engine', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'weapon', 'bullet08', 18078, 1],
      [12, 'weapon', 'bullet09', 21539, 1],
      [13, 'hull', 'undefined', 44673, 1],
      [14, 'hull', 'undefined', 44673, 1],
      [15, 'weapon', 'bullet05', 21514, 2],
      [16, 'engine', 'undefined', 44673, 1],
      [17, 'computer', 'undefined', 44673, 1],
      [18, 'ship_paint', 'undefined', 44673, 1],
    ],
  },
  cylont4carrier: {
    stats: { Speed: 18, BoostSpeed: 30, Acceleration: 3, AccelerationMultiplierOnBoost: 1.5, PitchMaxSpeed: 8, YawMaxSpeed: 8, RollMaxSpeed: 8, StrafeMaxSpeed: 0, PitchAcceleration: 9, YawAcceleration: 9, RollAcceleration: 9, StrafeAcceleration: 0, InertiaCompensation: 44, BoostCost: 18, MaxHullPoints: 8000, MaxPowerPoints: 1000, HullRecovery: 40, PowerRecovery: 40, ArmorValue: 40, Avoidance: 20, CriticalDefense: 150, FirewallRating: 240, PenetrationStrength: 240, DecayDamageFactor: 800, DecayResistance: 0, MaxVitalPoints: 240, VitalRecovery: 1.5, DurabilityBonus: 0.5, CargoHoldVolume: 16, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'gun', 'bullet06_cannon', 28932, 1],
      [1, 'gun', 'bullet01_cannon', 28205, 1],
      [2, 'gun', 'bullet05_cannon', 50525, 1],
      [3, 'gun', 'bullet02_cannon', 64547, 1],
      [4, 'defensive_weapon', 'bullet07_defensive', 19020, 1],
      [5, 'defensive_weapon', 'bullet09_defensive', 55041, 1],
      [6, 'defensive_weapon', 'bullet13_defensive', 41896, 1],
      [7, 'defensive_weapon', 'bullet14_defensive', 60692, 1],
      [8, 'launcher', 'bullet12_launcher', 9558, 1],
      [9, 'launcher', 'bullet11_launcher', 18846, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'engine', 'undefined', 44673, 1],
      [13, 'computer', 'undefined', 44673, 1],
      [14, 'computer', 'bullet01', 49813, 1],
      [15, 'computer', 'bullet01', 49813, 1],
      [16, 'hull', 'bullet01', 49813, 1],
      [17, 'hull', 'bullet01', 49813, 1],
      [18, 'ship_paint', 'bullet01', 49813, 1],
      [19, 'role', 'undefined', 44673, 1],
      [20, 'gun', 'bullet04_cannon', 51107, 2],
      [21, 'gun', 'bullet03_cannon', 33935, 2],
      [22, 'engine', 'bullet01', 49813, 2],
      [23, 'computer', 'bullet01', 49813, 2],
      [24, 'computer', 'undefined', 44673, 2],
      [25, 'hull', 'undefined', 44673, 2],
      [26, 'hull', 'undefined', 44673, 2],
    ],
  },
  humant1command: {
    stats: { Speed: 52.5, BoostSpeed: 77.5, Acceleration: 10, AccelerationMultiplierOnBoost: 3, PitchMaxSpeed: 47.5, YawMaxSpeed: 47.5, RollMaxSpeed: 130.625, StrafeMaxSpeed: 0, PitchAcceleration: 47.5, YawAcceleration: 47.5, RollAcceleration: 598.5, StrafeAcceleration: 0, InertiaCompensation: 100, BoostCost: 0.6, MaxHullPoints: 500, MaxPowerPoints: 150, HullRecovery: 3, PowerRecovery: 5.5, ArmorValue: 5, Avoidance: 500, AvoidanceFading: 0.75, CriticalDefense: 100, FirewallRating: 200, PenetrationStrength: 200, DecayDamageFactor: 50, DecayResistance: 0, MaxVitalPoints: 130, VitalRecovery: 0.8, CargoHoldVolume: 6, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2, JumpTargetTransponderPowerPointCost: -25 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet02', 50321, 1],
      [2, 'weapon', 'bullet03', 19778, 1],
      [3, 'hull', 'undefined', 44673, 1],
      [4, 'hull', 'undefined', 44673, 1],
      [5, 'computer', 'undefined', 44673, 2],
      [6, 'computer', 'undefined', 44673, 1],
      [7, 'computer', 'undefined', 44673, 1],
      [8, 'computer', 'undefined', 44673, 1],
      [9, 'computer', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'weapon', 'elitebullet04', 27288, 2],
      [13, 'ship_paint', 'undefined', 44673, 1],
      [14, 'avionics', 'undefined', 44673, 1],
    ],
  },
  humant1defender: {
    stats: { Speed: 50, BoostSpeed: 75, Acceleration: 8, AccelerationMultiplierOnBoost: 7, PitchMaxSpeed: 45, YawMaxSpeed: 45, RollMaxSpeed: 101.25, StrafeMaxSpeed: 0, PitchAcceleration: 45, YawAcceleration: 45, RollAcceleration: 450, StrafeAcceleration: 0, InertiaCompensation: 100, BoostCost: 0.7, MaxHullPoints: 715, MaxPowerPoints: 150, HullRecovery: 5.5, PowerRecovery: 5, ArmorValue: 10, Avoidance: 490, AvoidanceFading: 0.75, CriticalDefense: 120, FirewallRating: 150, PenetrationStrength: 150, DecayDamageFactor: 50, DecayResistance: 0, MaxVitalPoints: 130, VitalRecovery: 0.8, CargoHoldVolume: 7, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet02', 50321, 1],
      [2, 'weapon', 'bullet03', 19778, 1],
      [3, 'hull', 'undefined', 44673, 1],
      [4, 'hull', 'undefined', 44673, 1],
      [5, 'hull', 'undefined', 44673, 1],
      [6, 'hull', 'undefined', 44673, 1],
      [7, 'hull', 'undefined', 44673, 1],
      [8, 'computer', 'undefined', 44673, 1],
      [9, 'computer', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'weapon', 'elitebullet04', 27288, 1],
      [13, 'weapon', 'elitebullet05', 2575, 2],
      [14, 'ship_paint', 'undefined', 44673, 1],
      [15, 'avionics', 'undefined', 44673, 1],
    ],
  },
  humant1fighter: {
    stats: { Speed: 55, BoostSpeed: 90, Acceleration: 13.5, AccelerationMultiplierOnBoost: 1.5, PitchMaxSpeed: 52, YawMaxSpeed: 52, RollMaxSpeed: 182, StrafeMaxSpeed: 0, PitchAcceleration: 55, YawAcceleration: 55, RollAcceleration: 748, StrafeAcceleration: 0, InertiaCompensation: 175, BoostCost: 0.5, MaxHullPoints: 450, MaxPowerPoints: 100, HullRecovery: 2.5, PowerRecovery: 5, ArmorValue: 5, Avoidance: 510, AvoidanceFading: 0.75, CriticalDefense: 80, FirewallRating: 100, PenetrationStrength: 100, DecayDamageFactor: 50, DecayResistance: 0, MaxVitalPoints: 80, VitalRecovery: 0.5, CargoHoldVolume: 4, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet02', 50321, 1],
      [2, 'weapon', 'bullet03', 19778, 1],
      [3, 'hull', 'undefined', 44673, 1],
      [4, 'hull', 'undefined', 44673, 1],
      [5, 'computer', 'undefined', 44673, 1],
      [6, 'computer', 'undefined', 44673, 1],
      [7, 'engine', 'undefined', 44673, 1],
      [8, 'engine', 'undefined', 44673, 1],
      [9, 'engine', 'undefined', 44673, 2],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'weapon', 'elitebullet04', 27288, 2],
      [13, 'ship_paint', 'undefined', 44673, 1],
      [14, 'avionics', 'undefined', 44673, 1],
    ],
  },
  humant1merit: {
    stats: { Speed: 55, BoostSpeed: 85, Acceleration: 12, AccelerationMultiplierOnBoost: 4, PitchMaxSpeed: 50, YawMaxSpeed: 50, RollMaxSpeed: 200, StrafeMaxSpeed: 0, PitchAcceleration: 55, YawAcceleration: 55, RollAcceleration: 748, StrafeAcceleration: 0, InertiaCompensation: 100, BoostCost: 0.75, MaxHullPoints: 585, MaxPowerPoints: 150, HullRecovery: 4.5, PowerRecovery: 5, ArmorValue: 5, Avoidance: 510, AvoidanceFading: 0.75, CriticalDefense: 80, FirewallRating: 100, PenetrationStrength: 100, DecayDamageFactor: 50, DecayResistance: 0, MaxVitalPoints: 100, VitalRecovery: 0.6, CargoHoldVolume: 4, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet02', 50321, 2],
      [2, 'weapon', 'bullet03', 19778, 1],
      [3, 'weapon', 'bullet04', 50370, 1],
      [4, 'weapon', 'bullet05', 21514, 1],
      [5, 'hull', 'undefined', 44673, 1],
      [6, 'computer', 'undefined', 44673, 1],
      [7, 'hull', 'undefined', 44673, 1],
      [8, 'hull', 'undefined', 44673, 1],
      [9, 'engine', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'computer', 'undefined', 44673, 1],
      [13, 'computer', 'undefined', 44673, 1],
      [14, 'ship_paint', 'undefined', 44673, 1],
      [15, 'avionics', 'undefined', 44673, 1],
    ],
  },
  humant1multi2: {
    stats: { Speed: 55, BoostSpeed: 100, Acceleration: 14, AccelerationMultiplierOnBoost: 4.5, PitchMaxSpeed: 51, YawMaxSpeed: 51, RollMaxSpeed: 180, StrafeMaxSpeed: 0, PitchAcceleration: 55, YawAcceleration: 55, RollAcceleration: 748, StrafeAcceleration: 0, InertiaCompensation: 100, BoostCost: 0.5, MaxHullPoints: 515, MaxPowerPoints: 100, HullRecovery: 3.5, PowerRecovery: 5.2, ArmorValue: 5, Avoidance: 510, AvoidanceFading: 0.75, CriticalDefense: 80, FirewallRating: 100, PenetrationStrength: 100, DecayDamageFactor: 50, DecayResistance: 0, MaxVitalPoints: 80, VitalRecovery: 0.5, CargoHoldVolume: 5, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet02', 50321, 1],
      [2, 'weapon', 'bullet03', 19778, 1],
      [3, 'hull', 'undefined', 44673, 1],
      [4, 'hull', 'undefined', 44673, 1],
      [5, 'computer', 'undefined', 44673, 1],
      [6, 'computer', 'undefined', 44673, 1],
      [7, 'engine', 'undefined', 44673, 1],
      [8, 'hull', 'undefined', 44673, 1],
      [9, 'engine', 'undefined', 44673, 2],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'weapon', 'elitebullet04', 27288, 2],
      [13, 'ship_paint', 'undefined', 44673, 1],
      [14, 'avionics', 'undefined', 44673, 1],
    ],
  },
  humant1scout: {
    stats: { Speed: 52.5, BoostSpeed: 77.5, Acceleration: 10, AccelerationMultiplierOnBoost: 4, PitchMaxSpeed: 47.5, YawMaxSpeed: 47.5, RollMaxSpeed: 130.625, StrafeMaxSpeed: 0, PitchAcceleration: 47.5, YawAcceleration: 47.5, RollAcceleration: 598.5, StrafeAcceleration: 0, InertiaCompensation: 100, BoostCost: 0.6, MaxHullPoints: 650, MaxPowerPoints: 200, HullRecovery: 5, PowerRecovery: 6, ArmorValue: 5, Avoidance: 500, AvoidanceFading: 0.75, CriticalDefense: 100, FirewallRating: 200, PenetrationStrength: 200, DecayDamageFactor: 50, DecayResistance: 0, MaxVitalPoints: 130, VitalRecovery: 0.8, CargoHoldVolume: 5, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2, JumpTargetTransponderPowerPointCost: -75 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet02', 50321, 1],
      [2, 'weapon', 'bullet03', 19778, 1],
      [3, 'hull', 'undefined', 44673, 1],
      [4, 'engine', 'undefined', 44673, 1],
      [5, 'computer', 'undefined', 44673, 1],
      [6, 'computer', 'undefined', 44673, 1],
      [7, 'computer', 'undefined', 44673, 1],
      [8, 'computer', 'undefined', 44673, 1],
      [9, 'computer', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'engine', 'undefined', 44673, 1],
      [13, 'ship_paint', 'undefined', 44673, 1],
      [14, 'avionics', 'undefined', 44673, 1],
    ],
  },
  humant1stealth: {
    stats: { Speed: 70, BoostSpeed: 90, Acceleration: 13, AccelerationMultiplierOnBoost: 1.25, PitchMaxSpeed: 52, YawMaxSpeed: 50, RollMaxSpeed: 90, StrafeMaxSpeed: 30, PitchAcceleration: 75, YawAcceleration: 90, RollAcceleration: 750, StrafeAcceleration: 80, InertiaCompensation: 175, BoostCost: 0.5, MaxHullPoints: 350, MaxPowerPoints: 120, HullRecovery: 3, PowerRecovery: 3, ArmorValue: 0, Avoidance: 520, AvoidanceFading: 0.75, CriticalDefense: 60, FirewallRating: 100, PenetrationStrength: 100, DecayDamageFactor: 50, DecayResistance: 0, MaxVitalPoints: 70, VitalRecovery: 0.4, CargoHoldVolume: 3, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'gun', 'bullet01', 49813, 1],
      [1, 'engine', 'undefined', 44673, 2],
      [2, 'gun', 'bullet03', 19778, 1],
      [3, 'hull', 'undefined', 44673, 1],
      [4, 'hull', 'undefined', 44673, 1],
      [5, 'computer', 'undefined', 44673, 1],
      [6, 'launcher', 'bullet02', 50321, 1],
      [8, 'computer', 'undefined', 44673, 2],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [13, 'ship_paint', 'undefined', 44673, 1],
      [14, 'avionics', 'undefined', 44673, 1],
      [16, 'role', 'undefined', 44673, 1],
    ],
  },
  humant2command: {
    stats: { Speed: 37.5, BoostSpeed: 57.5, Acceleration: 5, AccelerationMultiplierOnBoost: 1.5, PitchMaxSpeed: 22.5, YawMaxSpeed: 22.5, RollMaxSpeed: 39.375, StrafeMaxSpeed: 0, PitchAcceleration: 22.5, YawAcceleration: 22.5, RollAcceleration: 39.375, StrafeAcceleration: 0, InertiaCompensation: 50, BoostCost: 1.8, MaxHullPoints: 1700, MaxPowerPoints: 330, HullRecovery: 15, PowerRecovery: 12, ArmorValue: 25, Avoidance: 270, AvoidanceFading: 0.75, CriticalDefense: 100, FirewallRating: 200, PenetrationStrength: 200, DecayDamageFactor: 150, DecayResistance: 0, MaxVitalPoints: 160, VitalRecovery: 1, CargoHoldVolume: 9, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2, JumpTargetTransponderPowerPointCost: -50 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet03', 19778, 1],
      [2, 'weapon', 'bullet02', 50321, 1],
      [3, 'hull', 'undefined', 44673, 1],
      [4, 'hull', 'undefined', 44673, 1],
      [5, 'weapon', 'bullet04', 50370, 1],
      [6, 'computer', 'undefined', 44673, 1],
      [7, 'computer', 'undefined', 44673, 1],
      [8, 'computer', 'undefined', 44673, 1],
      [9, 'computer', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'weapon', 'elitebullet05', 2575, 1],
      [13, 'weapon', 'elitebullet06', 34993, 1],
      [14, 'computer', 'undefined', 44673, 1],
      [15, 'hull', 'undefined', 44673, 2],
      [16, 'ship_paint', 'undefined', 44673, 1],
    ],
  },
  humant2defender: {
    stats: { Speed: 35, BoostSpeed: 55, Acceleration: 4, AccelerationMultiplierOnBoost: 1.5, PitchMaxSpeed: 20, YawMaxSpeed: 20, RollMaxSpeed: 30, StrafeMaxSpeed: 0, PitchAcceleration: 20, YawAcceleration: 20, RollAcceleration: 30, StrafeAcceleration: 0, InertiaCompensation: 50, BoostCost: 2.1, MaxHullPoints: 2000, MaxPowerPoints: 200, HullRecovery: 8.9, PowerRecovery: 10, ArmorValue: 30, Avoidance: 250, AvoidanceFading: 0.75, CriticalDefense: 120, FirewallRating: 150, PenetrationStrength: 150, DecayDamageFactor: 150, DecayResistance: 0, MaxVitalPoints: 170, VitalRecovery: 1.1, CargoHoldVolume: 10, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet03', 19778, 1],
      [2, 'weapon', 'bullet02', 50321, 1],
      [3, 'weapon', 'bullet04', 50370, 1],
      [4, 'hull', 'undefined', 44673, 1],
      [5, 'hull', 'undefined', 44673, 1],
      [6, 'hull', 'undefined', 44673, 1],
      [7, 'hull', 'undefined', 44673, 1],
      [8, 'computer', 'undefined', 44673, 1],
      [9, 'computer', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'weapon', 'elitebullet05', 2575, 2],
      [13, 'weapon', 'elitebullet06', 34993, 2],
      [14, 'hull', 'undefined', 44673, 2],
      [15, 'ship_paint', 'undefined', 44673, 1],
      [16, 'special_weapon', 'bullet07', 64555, 1],
      [17, 'role', 'undefined', 44673, 1],
    ],
  },
  humant2fighter: {
    stats: { Speed: 40, BoostSpeed: 60, Acceleration: 5, AccelerationMultiplierOnBoost: 1.5, PitchMaxSpeed: 25, YawMaxSpeed: 25, RollMaxSpeed: 50, StrafeMaxSpeed: 0, PitchAcceleration: 25, YawAcceleration: 25, RollAcceleration: 50, StrafeAcceleration: 0, InertiaCompensation: 50, BoostCost: 1.5, MaxHullPoints: 1400, MaxPowerPoints: 200, HullRecovery: 7.8, PowerRecovery: 10, ArmorValue: 25, Avoidance: 290, AvoidanceFading: 0.75, CriticalDefense: 80, FirewallRating: 100, PenetrationStrength: 100, DecayDamageFactor: 150, DecayResistance: 0, MaxVitalPoints: 140, VitalRecovery: 0.9, CargoHoldVolume: 7, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet03', 19778, 1],
      [2, 'weapon', 'bullet02', 50321, 1],
      [3, 'weapon', 'bullet04', 50370, 1],
      [4, 'engine', 'undefined', 44673, 1],
      [5, 'hull', 'undefined', 44673, 1],
      [6, 'hull', 'undefined', 44673, 1],
      [7, 'computer', 'undefined', 44673, 1],
      [8, 'computer', 'undefined', 44673, 1],
      [9, 'engine', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'weapon', 'elitebullet05', 2575, 2],
      [13, 'weapon', 'elitebullet06', 34993, 2],
      [14, 'engine', 'undefined', 44673, 2],
      [15, 'ship_paint', 'undefined', 44673, 1],
    ],
  },
  humant2merit: {
    stats: { Speed: 40, BoostSpeed: 60, Acceleration: 5, AccelerationMultiplierOnBoost: 1.5, PitchMaxSpeed: 25, YawMaxSpeed: 25, RollMaxSpeed: 43.75, StrafeMaxSpeed: 0, PitchAcceleration: 25, YawAcceleration: 25, RollAcceleration: 43.75, StrafeAcceleration: 0, InertiaCompensation: 50, BoostCost: 2.7, MaxHullPoints: 1950, MaxPowerPoints: 300, HullRecovery: 15, PowerRecovery: 10, ArmorValue: 25, Avoidance: 260, AvoidanceFading: 0.75, CriticalDefense: 100, FirewallRating: 150, PenetrationStrength: 150, DecayDamageFactor: 150, DecayResistance: 0, MaxVitalPoints: 140, VitalRecovery: 0.9, CargoHoldVolume: 6, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet02', 50321, 1],
      [2, 'weapon', 'bullet03', 19778, 1],
      [3, 'weapon', 'bullet07', 64555, 2],
      [4, 'weapon', 'bullet05', 21514, 1],
      [5, 'weapon', 'bullet06', 64121, 1],
      [6, 'weapon', 'bullet04', 50370, 1],
      [7, 'hull', 'undefined', 44673, 1],
      [8, 'hull', 'undefined', 44673, 1],
      [9, 'hull', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'engine', 'undefined', 44673, 1],
      [13, 'computer', 'undefined', 44673, 1],
      [14, 'computer', 'undefined', 44673, 1],
      [15, 'computer', 'undefined', 44673, 1],
      [16, 'ship_paint', 'undefined', 44673, 1],
    ],
  },
  humant3command: {
    stats: { Speed: 27.5, BoostSpeed: 42.5, Acceleration: 2, AccelerationMultiplierOnBoost: 1.5, PitchMaxSpeed: 9, YawMaxSpeed: 9, RollMaxSpeed: 9, StrafeMaxSpeed: 0, PitchAcceleration: 9, YawAcceleration: 9, RollAcceleration: 9, StrafeAcceleration: 0, InertiaCompensation: 50, BoostCost: 5.4, MaxHullPoints: 3500, MaxPowerPoints: 650, HullRecovery: 19.4, PowerRecovery: 28, ArmorValue: 40, Avoidance: 50, CriticalDefense: 100, FirewallRating: 200, PenetrationStrength: 200, DecayDamageFactor: 350, DecayResistance: 0, MaxVitalPoints: 220, VitalRecovery: 1.4, DurabilityBonus: 0.4, CargoHoldVolume: 13, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2, JumpTargetTransponderPowerPointCost: -150 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet02', 50321, 1],
      [2, 'weapon', 'bullet03', 19778, 1],
      [3, 'weapon', 'bullet04', 50370, 1],
      [4, 'weapon', 'bullet05', 21514, 1],
      [5, 'weapon', 'bullet06', 64121, 1],
      [6, 'computer', 'undefined', 44673, 1],
      [7, 'computer', 'undefined', 44673, 1],
      [8, 'computer', 'undefined', 44673, 1],
      [9, 'computer', 'undefined', 44673, 1],
      [10, 'hull', 'undefined', 44673, 1],
      [11, 'hull', 'undefined', 44673, 1],
      [12, 'engine', 'undefined', 44673, 1],
      [13, 'engine', 'undefined', 44673, 1],
      [14, 'weapon', 'elitebullet07', 7123, 2],
      [15, 'weapon', 'elitebullet08', 40453, 2],
      [16, 'computer', 'undefined', 44673, 2],
      [17, 'ship_paint', 'undefined', 44673, 1],
    ],
  },
  humant3defender: {
    stats: { Speed: 25, BoostSpeed: 40, Acceleration: 1.5, AccelerationMultiplierOnBoost: 1.5, PitchMaxSpeed: 8, YawMaxSpeed: 8, RollMaxSpeed: 8, StrafeMaxSpeed: 0, PitchAcceleration: 8, YawAcceleration: 8, RollAcceleration: 8, StrafeAcceleration: 0, InertiaCompensation: 50, BoostCost: 6.3, MaxHullPoints: 4500, MaxPowerPoints: 500, HullRecovery: 20.6, PowerRecovery: 25, ArmorValue: 45, Avoidance: 30, CriticalDefense: 120, FirewallRating: 150, PenetrationStrength: 150, DecayDamageFactor: 350, DecayResistance: 0, MaxVitalPoints: 240, VitalRecovery: 1.5, DurabilityBonus: 0.4, CargoHoldVolume: 15, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet02', 50321, 1],
      [2, 'weapon', 'bullet03', 19778, 1],
      [3, 'weapon', 'bullet04', 50370, 1],
      [4, 'weapon', 'bullet05', 21514, 1],
      [5, 'weapon', 'bullet06', 64121, 1],
      [6, 'hull', 'undefined', 44673, 1],
      [7, 'hull', 'undefined', 44673, 1],
      [8, 'computer', 'undefined', 44673, 1],
      [9, 'computer', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'weapon', 'elitebullet07', 7123, 2],
      [13, 'weapon', 'elitebullet08', 40453, 2],
      [14, 'hull', 'undefined', 44673, 1],
      [15, 'hull', 'undefined', 44673, 1],
      [16, 'hull', 'undefined', 44673, 2],
      [17, 'ship_paint', 'undefined', 44673, 1],
    ],
  },
  humant3fighter: {
    stats: { Speed: 30, BoostSpeed: 45, Acceleration: 2.5, AccelerationMultiplierOnBoost: 1.5, PitchMaxSpeed: 10, YawMaxSpeed: 10, RollMaxSpeed: 10, StrafeMaxSpeed: 0, PitchAcceleration: 10, YawAcceleration: 10, RollAcceleration: 10, StrafeAcceleration: 0, InertiaCompensation: 50, BoostCost: 4.5, MaxHullPoints: 4290, MaxPowerPoints: 750, HullRecovery: 33, PowerRecovery: 25, ArmorValue: 40, Avoidance: 70, CriticalDefense: 80, FirewallRating: 100, PenetrationStrength: 100, DecayDamageFactor: 350, DecayResistance: 0, MaxVitalPoints: 180, VitalRecovery: 1.1, DurabilityBonus: 0.4, CargoHoldVolume: 12, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'weapon', 'elitebullet07', 7123, 1],
      [1, 'weapon', 'bullet02', 50321, 1],
      [2, 'weapon', 'bullet03', 19778, 1],
      [3, 'weapon', 'bullet04', 50370, 1],
      [4, 'weapon', 'bullet05', 21514, 1],
      [5, 'weapon', 'elitebullet08', 40453, 1],
      [6, 'hull', 'undefined', 44673, 1],
      [7, 'computer', 'undefined', 44673, 1],
      [8, 'computer', 'undefined', 44673, 1],
      [9, 'engine', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'weapon', 'bullet01', 49813, 1],
      [13, 'weapon', 'bullet06', 64121, 1],
      [14, 'hull', 'undefined', 44673, 1],
      [15, 'engine', 'undefined', 44673, 1],
      [16, 'engine', 'undefined', 44673, 1],
      [17, 'computer', 'undefined', 44673, 2],
      [18, 'hull', 'undefined', 44673, 2],
      [19, 'ship_paint', 'undefined', 44673, 1],
    ],
  },
  humant3merit: {
    stats: { Speed: 30, BoostSpeed: 45, Acceleration: 2, AccelerationMultiplierOnBoost: 1.5, PitchMaxSpeed: 10, YawMaxSpeed: 10, RollMaxSpeed: 10, StrafeMaxSpeed: 0, PitchAcceleration: 10, YawAcceleration: 10, RollAcceleration: 10, StrafeAcceleration: 0, InertiaCompensation: 50, BoostCost: 8.1, MaxHullPoints: 4550, MaxPowerPoints: 750, HullRecovery: 35, PowerRecovery: 25, ArmorValue: 40, Avoidance: 50, CriticalDefense: 100, FirewallRating: 150, PenetrationStrength: 150, DecayDamageFactor: 350, DecayResistance: 0, MaxVitalPoints: 180, VitalRecovery: 1.1, DurabilityBonus: 0.4, CargoHoldVolume: 10, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'weapon', 'bullet01', 49813, 1],
      [1, 'weapon', 'bullet02', 50321, 1],
      [2, 'weapon', 'bullet04', 50370, 1],
      [3, 'weapon', 'bullet06', 64121, 1],
      [4, 'weapon', 'bullet08', 18078, 1],
      [5, 'weapon', 'bullet09', 21539, 1],
      [6, 'hull', 'undefined', 44673, 1],
      [7, 'hull', 'undefined', 44673, 1],
      [8, 'computer', 'undefined', 44673, 1],
      [9, 'computer', 'undefined', 44673, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'weapon', 'bullet03', 19778, 1],
      [13, 'weapon', 'bullet07', 64555, 1],
      [14, 'hull', 'undefined', 44673, 1],
      [15, 'weapon', 'bullet05', 21514, 2],
      [16, 'engine', 'undefined', 44673, 1],
      [17, 'computer', 'undefined', 44673, 1],
      [18, 'ship_paint', 'undefined', 44673, 1],
    ],
  },
  humant4carrier: {
    stats: { Speed: 18, BoostSpeed: 30, Acceleration: 3, AccelerationMultiplierOnBoost: 1.5, PitchMaxSpeed: 8, YawMaxSpeed: 8, RollMaxSpeed: 8, StrafeMaxSpeed: 0, PitchAcceleration: 9, YawAcceleration: 9, RollAcceleration: 9, StrafeAcceleration: 0, InertiaCompensation: 44, BoostCost: 18, MaxHullPoints: 8000, MaxPowerPoints: 1000, HullRecovery: 40, PowerRecovery: 40, ArmorValue: 40, Avoidance: 20, CriticalDefense: 150, FirewallRating: 240, PenetrationStrength: 240, DecayDamageFactor: 800, DecayResistance: 0, MaxVitalPoints: 240, VitalRecovery: 1.5, DurabilityBonus: 0.5, CargoHoldVolume: 16, CargoPickupDelay: 4, CargoDropoffDelay: 2, CargoLootDelay: 2 },
    slots: [
      [0, 'gun', 'bullet06_cannon', 28932, 1],
      [1, 'gun', 'bullet01_cannon', 28205, 1],
      [2, 'gun', 'bullet05_cannon', 50525, 1],
      [3, 'gun', 'bullet02_cannon', 64547, 1],
      [4, 'defensive_weapon', 'bullet07_defensive', 19020, 1],
      [5, 'defensive_weapon', 'bullet09_defensive', 55041, 1],
      [6, 'defensive_weapon', 'bullet13_defensive', 41896, 1],
      [7, 'defensive_weapon', 'bullet14_defensive', 60692, 1],
      [8, 'launcher', 'bullet12_launcher', 9558, 1],
      [9, 'launcher', 'bullet11_launcher', 18846, 1],
      [10, 'engine', 'undefined', 44673, 1],
      [11, 'engine', 'undefined', 44673, 1],
      [12, 'engine', 'undefined', 44673, 1],
      [13, 'computer', 'undefined', 44673, 1],
      [14, 'computer', 'bullet01', 49813, 1],
      [15, 'computer', 'bullet01', 49813, 1],
      [16, 'hull', 'bullet01', 49813, 1],
      [17, 'hull', 'bullet01', 49813, 1],
      [18, 'ship_paint', 'bullet01', 49813, 1],
      [19, 'role', 'undefined', 44673, 1],
      [20, 'gun', 'bullet04_cannon', 51107, 2],
      [21, 'gun', 'bullet03_cannon', 33935, 2],
      [22, 'engine', 'bullet01', 49813, 2],
      [23, 'computer', 'bullet01', 49813, 2],
      [24, 'computer', 'undefined', 44673, 2],
      [25, 'hull', 'undefined', 44673, 2],
      [26, 'hull', 'undefined', 44673, 2],
    ],
  },
};

/* Paperdoll slot-id sets per level, read off the dump's own PaperdollLayoutBig/Small rather
 * than re-extracted from the client. A slot with no BIG entry at its level is an NRE in the
 * shop paperdoll; a slot with no SMALL entry merely has no in-flight control. */
const LAYOUTS_REAL = {
  ship_avenger_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,16], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16] }, small: { 1: [0,1,2,5,12,13], 2: [0,1,2,5,12,13] } },
  ship_banshee_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,7,8,9,10,11,14,15,16,17], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17] }, small: { 1: [0,1,2,3,16], 2: [0,1,2,3,12,13,16] } },
  ship_berserker_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,9,10,11,15], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] }, small: { 1: [0,1,2,3], 2: [0,1,2,3,12,13] } },
  ship_brimir_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26] }, small: { 1: [0,1,2,3,4,5,6,7,8,9], 2: [0,1,2,3,4,5,6,7,8,9,20,21] } },
  ship_colonial_strike_stealth_paperdoll_layouts: { big: { 1: [0,2,3,4,5,6,10,11,13,14,16], 2: [0,1,2,3,4,5,6,8,10,11,13,14,16] }, small: { 1: [0,2,6], 2: [0,2,6] } },
  ship_cruiser_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,17], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17] }, small: { 1: [0,1,2,3,4,5], 2: [0,1,2,3,4,5,14,15] } },
  ship_cylon_strike_stealth_paperdoll_layouts: { big: { 1: [0,2,4,6,7,8,10,13,14,16,17], 2: [0,1,2,3,4,6,7,8,10,13,14,16,17] }, small: { 1: [0,2,4], 2: [0,2,4] } },
  ship_dominator_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,9,10,11,15,16,17], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17] }, small: { 1: [0,1,2,3,16], 2: [0,1,2,3,12,13,16] } },
  ship_dreadnought_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,9,10,11,14,15,17], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17] }, small: { 1: [0,1,2,3,4,5], 2: [0,1,2,3,4,5,12,13] } },
  ship_gungnir_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,16,17,18], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18] }, small: { 1: [0,1,2,3,4,5,12,13], 2: [0,1,2,3,4,5,12,13,15] } },
  ship_gunstar_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,19], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19] }, small: { 1: [0,1,2,3,4,5,12,13], 2: [0,1,2,3,4,5,12,13] } },
  ship_halberd_paperdoll_layouts: { big: { 1: [0,1,2,4,5,6,7,8,9,10,11,12,13,14,15,16], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16] }, small: { 1: [0,1,2,4,5,6], 2: [0,1,2,3,4,5,6] } },
  ship_heavy_raider_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,10,11,13,14], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14] }, small: { 1: [0,1,2], 2: [0,1,2,9] } },
  ship_heavy_raider_recon_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13] }, small: { 1: [0,1,2], 2: [0,1,2,9] } },
  ship_liche_paperdoll_layouts: { big: { 1: [0,1,2,4,5,6,7,8,9,10,11,12,13,14,15,16], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16] }, small: { 1: [0,1,2,4,5,6], 2: [0,1,2,3,4,5,6] } },
  ship_nidhogg_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,16,17,18], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18] }, small: { 1: [0,1,2,3,4,5,11,12], 2: [0,1,2,3,4,5,11,12,15] } },
  ship_nova_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,19], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19] }, small: { 1: [0,1,2,3,4,5,12,13], 2: [0,1,2,3,4,5,12,13] } },
  ship_phantom_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,9,10,11,14,15,17], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17] }, small: { 1: [0,1,2,3,4,5], 2: [0,1,2,3,4,5,12,13] } },
  ship_raider_1b_paperdoll_layouts: { big: { 1: [0,2,3,4,5,6,7,8,9,10,11,12,13,14,15], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] }, small: { 1: [0,2,3,4], 2: [0,1,2,3,4] } },
  ship_raider_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,9,10,13,14], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14] }, small: { 1: [0,1,2], 2: [0,1,2,12] } },
  ship_raptor_paperdoll_layouts: { big: { 1: [0,1,2,3,4,6,7,8,9,10,11,13,14], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14] }, small: { 1: [0,1,2], 2: [0,1,2,12] } },
  ship_raptor_recon_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13] }, small: { 1: [0,1,2], 2: [0,1,2,12] } },
  ship_rhino_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,14,15], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] }, small: { 1: [0,1,2,12], 2: [0,1,2,12,13] } },
  ship_scout_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,14,15], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] }, small: { 1: [0,1,2,12], 2: [0,1,2,12,13] } },
  ship_sentinel_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,9,10,11,14,15,17], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17] }, small: { 1: [0,1,2,3,4,5], 2: [0,1,2,3,4,5,12,13] } },
  ship_spectre_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,16], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16] }, small: { 1: [0,1,2,3,12,13], 2: [0,1,2,3,12,13] } },
  ship_surtur_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26] }, small: { 1: [0,1,2,3,4,5,6,7,8,9], 2: [0,1,2,3,4,5,6,7,8,9,20,21] } },
  ship_viper_mk3_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,10,11,13,14], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14] }, small: { 1: [0,1,2], 2: [0,1,2,12] } },
  ship_viper_mk7_paperdoll_layouts: { big: { 1: [0,2,3,4,5,6,7,8,9,10,11,12,13,14,15], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] }, small: { 1: [0,2,3,4], 2: [0,1,2,3,4] } },
  ship_viper_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,10,11,13,14], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14] }, small: { 1: [0,1,2], 2: [0,1,2,12] } },
  ship_war_raider_mk2_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,9,10,13,14], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14] }, small: { 1: [0,1,2], 2: [0,1,2,12] } },
  ship_wrath_paperdoll_layouts: { big: { 1: [0,1,2,3,4,5,6,7,8,9,10,11,15], 2: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] }, small: { 1: [0,1,2,3], 2: [0,1,2,3,12,13] } },
};

module.exports = { HULLS_REAL, LAYOUTS_REAL };
