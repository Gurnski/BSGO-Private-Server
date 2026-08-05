package io.github.luigeneric.core;

import io.github.luigeneric.Configuration;
import io.github.luigeneric.MicrometerRegistry;
import io.github.luigeneric.ScheduledService;
import io.github.luigeneric.binaryreaderwriter.BgoProtocolWriter;
import io.github.luigeneric.core.community.guild.GuildRegistry;
import io.github.luigeneric.core.community.party.PartyRegistry;
import io.github.luigeneric.core.database.DbProvider;
import io.github.luigeneric.core.database.OutpostStateRecord;
import io.github.luigeneric.core.galaxy.Galaxy;
import io.github.luigeneric.core.gameplayalgorithms.ExperienceToLevelAlgo;
import io.github.luigeneric.core.player.Player;
import io.github.luigeneric.core.player.login.SessionRegistry;
import io.github.luigeneric.core.protocols.ProtocolID;
import io.github.luigeneric.core.protocols.debug.RefundProcessor;
import io.github.luigeneric.core.protocols.scene.SceneProtocol;
import io.github.luigeneric.core.sector.management.SectorRegistry;
import io.github.luigeneric.templates.catalogue.Catalogue;
import io.github.luigeneric.templates.startupconfig.GameServerParamsConfig;
import io.github.luigeneric.utils.BgoRandom;
import io.quarkus.virtual.threads.VirtualThreads;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.spi.CDI;
import lombok.extern.slf4j.Slf4j;

import java.util.ArrayList;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

@Slf4j
@ApplicationScoped
public class GameServer implements IServerListenerSubscriber, UserDisconnectedSubscriber
{
    private final ExecutorService executorService;
    private final GameServerParamsConfig gameServerParams;
    private final Galaxy galaxy;
    private final ScheduledExecutorService scheduledExecutorService;
    private final DbProvider dbProviderProvider;
    private final SessionRegistry sessionRegistry;
    private final PartyRegistry partyRegistry;
    private final GuildRegistry guildRegistry;
    private final IServerListener serverListener;
    private final SectorRegistry sectorRegistry;
    private final UsersContainer usersContainer;
    private final ExperienceToLevelAlgo experienceToLevelAlgo;
    private final MicrometerRegistry micrometerRegistry;
    private final ChatAccessBlocker chatAccessBlocker;
    private final MissionUpdater missionUpdater;
    private final Catalogue catalogue;
    private final Configuration configuration;


    public GameServer(@VirtualThreads final ExecutorService executorService,
                      final GameServerParamsConfig gameServerParams,
                      final Galaxy galaxy,
                      final DbProvider dbProviderProvider,
                      final SessionRegistry sessionRegistry,
                      final PartyRegistry partyRegistry,
                      final GuildRegistry guildRegistry,
                      final IServerListener serverListener,
                      final UsersContainer usersContainer,
                      final SectorRegistry sectorRegistry,
                      final ExperienceToLevelAlgo experienceToLevelAlgo,
                      final ScheduledExecutorService scheduledExecutorService,
                      final MicrometerRegistry micrometerRegistry,
                      final ChatAccessBlocker chatAccessBlocker,
                      final MissionUpdater missionUpdater,
                      final Catalogue catalogue,
                      final Configuration configuration
    )
    {
        this.executorService = executorService;
        this.scheduledExecutorService = scheduledExecutorService;
        this.gameServerParams = gameServerParams;
        this.galaxy = galaxy;
        this.dbProviderProvider = dbProviderProvider;
        this.sessionRegistry = sessionRegistry;
        this.partyRegistry = partyRegistry;
        this.guildRegistry = guildRegistry;
        this.serverListener = serverListener;
        this.sectorRegistry = sectorRegistry;
        this.serverListener.setServerListenerSubscriber(this);
        this.usersContainer = usersContainer;
        this.experienceToLevelAlgo = experienceToLevelAlgo;
        this.micrometerRegistry = micrometerRegistry;
        this.chatAccessBlocker = chatAccessBlocker;
        this.missionUpdater = missionUpdater;
        this.catalogue = catalogue;
        this.configuration = configuration;
    }


    @Override
    public void notifyNewConnection(final AbstractConnection newConnection)
    {
        final ProtocolContext ctx = new ProtocolContext(
                newConnection,
                catalogue,
                gameServerParams,
                scheduledExecutorService,
                micrometerRegistry,
                new BgoRandom(),
                galaxy,
                null
        );

        final ProtocolRegistry protocolRegistry = new ProtocolRegistry(
                ctx,
                this.sectorRegistry,
                this.dbProviderProvider,
                this.sessionRegistry,
                this.partyRegistry,
                this.guildRegistry,
                this.usersContainer,
                this.experienceToLevelAlgo,
                this,
                configuration.characterServices(),
                chatAccessBlocker,
                missionUpdater,
                new RefundProcessor(catalogue)
        );
        final ProtocolUpdater protocolUpdater = new ProtocolUpdater(newConnection, protocolRegistry);
        this.executorService.execute(protocolUpdater);
    }

    public void start()
    {
        executorService.execute(serverListener);
    }

    public void shutdownProcess()
    {
        log.warn("ServerListener stopping...");
        serverListener.shutdown();
        log.warn("ServerListener stopped");

        log.warn("Disconnecting all online users...");
        final Set<User> allOnlineUsers = this.usersContainer.userSet(User::isConnected);
        for (final User user : allOnlineUsers)
        {
            try
            {
                final SceneProtocol sceneProtocol = user.getProtocol(ProtocolID.Scene);
                final BgoProtocolWriter disconnectBw = sceneProtocol.writeDisconnect();
                user.send(disconnectBw);
            }
            catch (final Exception ex)
            {
                // was: NoSuchElementException only, so any other exception aborted the loop and
                // every remaining user went undisconnected and unsaved
                log.warn("Could not send Disconnect to a user: {}", ex.toString());
            }
        }

        final Set<User> stillOnline = this.usersContainer.userSet(User::isConnected);
        for (final User onlineUser : stillOnline)
        {
            try
            {
                onlineUser.getConnection().ifPresent(connection -> connection.closeConnection("Shutdown process, user was still online"));
            }
            catch (final Exception ex)
            {
                log.warn("Could not close a connection during shutdown: {}", ex.toString());
            }
        }
        log.warn("All onlineusers disconnected");

        // Before the sectors stop, not after: the outpost states are read off live sectors, and
        // taking the snapshot first means the numbers written are the ones the last tick produced.
        try
        {
            final List<OutpostStateRecord> outpostStates = this.sectorRegistry.snapshotOutpostStates();
            log.warn("Writing outpost control for {} sector-factions...", outpostStates.size());
            this.dbProviderProvider.writeOutpostStates(outpostStates);
            log.warn("Outpost control save finished");
        }
        catch (final Exception ex)
        {
            log.error("Outpost control save FAILED - the galaxy will come back seeded, not as it was", ex);
        }

        log.warn("SectorRegistry stopping...");
        this.sectorRegistry.shutdown();
        log.warn("SectorRegistry stopped");

        // THE actual save. This method previously wrote guilds and nothing else - players were only
        // ever persisted as a side effect of closeConnection() -> onDisconnect(), which loses every
        // user whose client closed the socket first, and everything since the last periodic
        // snapshot. That is the main reason characters kept disappearing across restarts.
        // Snapshot EVERY cached user, not just connected ones: a user who dropped inside the
        // inactive-kicker window is still in the map and may have missed its disconnect write.
        try
        {
            final List<User> allCached = this.usersContainer.userList(user -> true);
            final List<Player> toWrite = new ArrayList<>();
            for (final User u : allCached)
            {
                try { toWrite.add(u.getPlayer()); }
                catch (final Exception ex) { log.warn("Skipping a user during shutdown save: {}", ex.toString()); }
            }
            log.warn("Writing {} players to db before shutdown...", toWrite.size());
            this.dbProviderProvider.bulkWritePlayerToDb(toWrite);
            log.warn("Player shutdown save finished");
        }
        catch (final Exception ex)
        {
            log.error("Player shutdown save FAILED - progress may be lost", ex);
        }

        log.info("Writing guilds....");
        this.dbProviderProvider.writeGuilds(guildRegistry);
        log.info("Writing guilds finished");

        log.info("shutting down now");
        this.executorService.shutdownNow();
        boolean terminated = false;
        try
        {
            terminated = this.executorService.awaitTermination(5, TimeUnit.SECONDS);
        } catch (InterruptedException e)
        {
            log.info("shutdown error", e);
        }
        log.info("shutdown finished {}", terminated);
    }


    @Override
    public void onDisconnect(final User user)
    {
        final Optional<User> optUser = this.usersContainer.get(user.getPlayer().getUserID());
        if (optUser.isPresent())
        {
            user.getProtocolRegistry().onDisconnect();
            this.dbProviderProvider.writePlayerToDb(user.getPlayer());
        }
    }
}
