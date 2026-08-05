package io.github.luigeneric.core.database;

import io.github.luigeneric.enums.Faction;

/**
 * One faction's grip on one system, as it sits in the database.
 * <p>
 * The pair is the identity: a sector holds a separate contest for each faction, and either, both or
 * neither may be persisted. dieTimeStamp travels with the points because the two only mean anything
 * together - 0 points with a recent death is a system locked out of recapture for an hour, while 0
 * points with no death is a system anyone can take right now, and the row cannot tell them apart
 * without it.
 *
 * @param sectorId      the sector this contest belongs to
 * @param faction       whose points these are
 * @param opPoints      control points, 0..3000 (the clamp lives in OutpostState.increasePoints)
 * @param dieTimeStamp  epoch millis of the last outpost death here, 0 if it has never died
 */
public record OutpostStateRecord(long sectorId, Faction faction, int opPoints, long dieTimeStamp)
{
}
