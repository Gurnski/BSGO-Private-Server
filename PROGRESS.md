# Progress

Where this server actually is. Anything under **Works** has been watched working in a real client,
not merely implemented and validated.

Baseline: BSGOCore `23bad98a` + 26 patches + a 12,250-card generated catalogue.
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

**Catalogue.** 12,250 cards stream with no `Card should not be send because it's null!` lines and
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

**Missile targeting.** Enemy warheads show the client's own missile bracket with a live hull-point
bar, can be clicked or Z-selected, and can be shot down. The whole feature was waiting in the
client behind one card flag our projectile World cards had set wrong. The rest of the missile
work â€” flak screens sweeping warheads on both sides, and interception gated to strike and escort
guns â€” deployed 4 Aug and sits on the next flight's checklist in TODO.md.

**Equipment.** The original's full catalogue â€” 219 ship systems as ten-level upgrade ladders, 175
consumables, 97 paints â€” imported from a live-server dump. Buying, fitting and upgrading work.

**NPCs.** Wings spawn by system threat and fight. They carry the original's own rank names, drawn
from the client's locale ladders: Talented Vipers, Seasoned Glaives, Apotheon Jormungs.

**Bosses.** Deep-space lairs hold a level-120 flagship-class boss with 50,000 hull and a permanent
guard wing. Killed in a live client, jackpot paid. Six themed loot templates rotate between lairs,
and the two lairs in a contested system never share one.

**Capital ships.** Four, rented by the hour from the CIC and arriving fully armed: the Pegasus and
Basestar, plus the Galactica and Guardian Basestar, neither of which was ever flyable in the
original game. Colonial and Cylon counterparts share one stat block, so their performance cannot
drift apart; the build fails if it ever does.

**The operator console.** `spawn <ship>` puts any hull in the catalogue into space as an armed,
fighting NPC â€” watched live as a spawned Pegasus held station against a Cylon outpost and traded
missile volleys with its platform ring. The capitals arm from six dedicated ShipConfigTemplates;
other player hulls spawn unarmed and say so. Alongside it: `spawn_wing`, `list_ships`, god mode,
teleports, and the resource and experience taps the GameBridge panel expects.

**Mining.** Asteroids carry resources and respawn, and XP scales with asteroid size.

## Partly working

**Flagship rentals across a relog.** The hour is enforced while you stay connected. The relog bug
â€” counters dropped at load unless a Counter card backs the guid, deleting the hull regardless of
time remaining â€” was fixed 4 Aug by emitting Counter cards for the four rental guids. Awaiting the
relog that proves it.

**Missions.** Templates load and objectives count. Full completion is untested.

## Not started

Guilds beyond what upstream ships, tournaments, ship scrapping (`ScrapShip` is a logged no-op
upstream), and the timed auto-return that would fly an expired rental home. The auto-return is
written and reviewed but deliberately switched off; its own header records the three defects that
keep it that way.

## The roster

Fourteen hulls per faction, tier 1 through the tier-4 carriers, plus four rental capitals shared
between the two factions as matched pairs. Full table in `tools/cardgen/cards.js`; the hangar
grid is a fixed 3Ã—5 of tier by role, which is why the capitals appear as variant buttons on the
carrier's cell rather than cells of their own.
