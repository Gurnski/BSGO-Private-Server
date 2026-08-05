-- Who holds each system, across restarts.
--
-- Outpost control was the one piece of world state the server rebuilt from scratch every boot:
-- SectorFactory.setupOutpostStates seeded points from the star's eligibility flags, so a map that
-- players had spent a session fighting over came back up in its factory state. This table is the
-- snapshot that survives, written at shutdown and whenever an admin command changes it.
--
-- One row per sector per faction. faction_id is the Faction enum value, not a name, to match how
-- every other faction column in this schema is stored. die_time_stamp is the epoch-millis of the
-- last outpost death and is what OutpostState.isBlocked measures the 60-minute lockout against -
-- persisting the points without it would resurrect an outpost that was destroyed seconds before
-- the server went down.
CREATE TABLE IF NOT EXISTS sector_outpost_states
(
    sector_id      INTEGER NOT NULL,
    faction_id     INTEGER NOT NULL, --byte
    op_points      INTEGER NOT NULL,
    die_time_stamp INTEGER NOT NULL,
    PRIMARY KEY (sector_id, faction_id)
);
