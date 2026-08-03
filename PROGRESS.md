# Progress

Where this server actually is. Anything under **Works** has been watched working in a real client,
not merely implemented and validated.

Baseline: BSGOCore `23bad98a` + 23 patches + a 12,204-card generated catalogue.
Client: Unity 5.1.5f1 BSGO, protocol revision 4578.

## Works

**Login and account lifecycle.** Repeat logins, reconnects and clean shutdown all preserve the
character. That took patches 0002/0004 for sessions and 0007 for persistence; before them you could
log in exactly once, and a clean shutdown threw away everyone's session.

**Character creation.** Faction select, avatar, first spawn.

**Space.** Undock, fly, boost, FTL, dock. Every one of those was separately broken at some point.

**Rooms.** Both CICs and both outpost hangars, with all four characters per room clickable. Adama
and Number One authorise flagships; Starbuck, Number Six and the outpost quartermasters exchange
water for cubits at 5 water to 1 cubit, uncapped.

**Catalogue.** 12,204 cards stream with no `Card should not be send because it's null!` lines and
no infinite loads.

**Galaxy.** All 58 accessible systems, one sector template per star, 26 outposts at boot ringed by
faction-matched platforms, 31 contested systems capturable. The two fleet bases carry no outpost:
Alpha Ceti is the Galactica and Appolid is the Basestar, and neither can be attacked.

**Sector content.** 45,849 placed objects across the 55 generated systems, against roughly 3,000
before. Gaussian asteroid belts built to Tannhauser's own density signature, dense clusters, ship
graveyards, scavenger stations, debris fields, and boss lairs with a gold vein at the centre.

**Combat.** Verified end to end. Weapons fire, NPCs return fire, ships die, loot and XP arrive.
Armour and ammunition are live: every shot consumes a round, and armour value reduces damage
instead of being decorative.

**Equipment.** The original's full catalogue — 219 ship systems as ten-level upgrade ladders, 175
consumables, 97 paints — imported from a live-server dump. Buying, fitting and upgrading work.

**NPCs.** Wings spawn by system threat and fight. They carry the original's own rank names, drawn
from the client's locale ladders: Talented Vipers, Seasoned Glaives, Apotheon Jormungs.

**Bosses.** Deep-space lairs hold a level-120 flagship-class boss with 50,000 hull and a permanent
guard wing. Killed in a live client, jackpot paid. Six themed loot templates rotate between lairs,
and the two lairs in a contested system never share one.

**Capital ships.** Four, rented by the hour from the CIC and arriving fully armed: the Pegasus and
Basestar, plus the Galactica and Guardian Basestar, neither of which was ever flyable in the
original game. Colonial and Cylon counterparts share one stat block, so their performance cannot
drift apart; the build fails if it ever does.

**Mining.** Asteroids carry resources and respawn, and XP scales with asteroid size.

## Partly working

**Missile interception.** Enemy missiles are shootable in principle — every gun, flak and
point-defence group carries the `Missile` target flag — and warheads carry their own hull points.
In practice a player cannot yet click a missile to select it, and flak rarely destroys one. Current
suspicion is that the client only draws a target bracket inside detection range, and an undrawn
bracket cannot be clicked. Unverified.

**Flagship rentals across a relog.** The hour is enforced while you stay connected. Log out and the
hull is removed at the next login regardless of time remaining, because expiry lives in a counter
and counters are dropped at load unless a Counter card backs the guid.

**Missions.** Templates load and objectives count. Full completion is untested.

## Not started

Guilds beyond what upstream ships, tournaments, ship scrapping (`ScrapShip` is a logged no-op
upstream), and the timed auto-return that would fly an expired rental home. The auto-return is
written and reviewed but deliberately switched off; its own header records the three defects that
keep it that way.

## The roster

Fourteen hulls per faction, tier 1 through the tier-4 carriers, plus four rental capitals shared
between the two factions as matched pairs. Full table in `tools/cardgen/cards.js`; the hangar
grid is a fixed 3×5 of tier by role, which is why the capitals appear as variant buttons on the
carrier's cell rather than cells of their own.
