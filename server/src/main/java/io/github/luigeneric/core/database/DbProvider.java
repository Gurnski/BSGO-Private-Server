package io.github.luigeneric.core.database;


import io.github.luigeneric.core.community.guild.GuildRegistry;
import io.github.luigeneric.core.player.AvatarDescription;
import io.github.luigeneric.core.player.Player;

import java.util.Collection;
import java.util.List;
import java.util.Map;

public interface DbProvider
{
    @Deprecated
    String databaseUrl = "jdbc:sqlite:./sqlite/bgo_server.db";
    AvatarDescription fetchAvatarDescription(long userId);
    Player fetchPlayer(long userId);

    boolean checkIfUserExists(long userId);

    //REGION INSERT/UPDATE
    void updateAvatarDescription(long userId, AvatarDescription avatarDescription);

    boolean checkNameAlreadyPresent(final String name);
    boolean checkNameAlreadyPresentNoCase(final String name);

    /**
     * Replaces the character if exists or creates first new entry
     * @param player the character of the user
     */
    void writePlayerToDb(final Player player);
    void bulkWritePlayerToDb(final Collection<Player> players);
    void writeGuilds(final GuildRegistry guildRegistry);
    void fetchGuilds(final GuildRegistry guildRegistry);

    Map<Long, CounterRecord> fetchAllCounters();

    /**
     * Every persisted outpost contest, keyed by sector id. Sectors absent from the map have never
     * been saved and fall back to the star-flag seeding in SectorFactory, which is what the whole
     * galaxy did before this table existed.
     */
    Map<Long, List<OutpostStateRecord>> fetchOutpostStates();
    void writeOutpostStates(final Collection<OutpostStateRecord> records);
}
