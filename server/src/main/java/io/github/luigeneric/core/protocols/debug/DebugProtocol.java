package io.github.luigeneric.core.protocols.debug;

import io.github.luigeneric.ApplicationBootstrap;
import io.github.luigeneric.binaryreaderwriter.BgoProtocolReader;
import io.github.luigeneric.binaryreaderwriter.BgoProtocolWriter;
import io.github.luigeneric.core.*;
import io.github.luigeneric.core.movement.maneuver.PulseManeuver;
import io.github.luigeneric.core.movement.maneuver.TargetLaunchManeuver;
import io.github.luigeneric.core.movement.maneuver.TeleportManeuver;
import io.github.luigeneric.core.sector.npcbehaviour.PatrolObjective;
import io.github.luigeneric.linearalgebra.collidershapes.AABB;
import io.github.luigeneric.linearalgebra.utility.Algorithm3D;
import io.github.luigeneric.templates.cards.CardView;
import io.github.luigeneric.templates.cards.GuiCard;
import io.github.luigeneric.templates.cards.ShipCard;
import io.github.luigeneric.templates.cards.WorldCard;
import io.github.luigeneric.templates.npcbehaviour.NpcBehaviourTemplate;
import io.github.luigeneric.templates.npcbehaviour.NpcBehaviourTemplates;
import io.github.luigeneric.templates.utils.SpotDesc;
import io.github.luigeneric.core.player.AdminRoles;
import io.github.luigeneric.core.player.HangarShip;
import io.github.luigeneric.core.player.MailBox;
import io.github.luigeneric.core.player.Player;
import io.github.luigeneric.core.player.container.Hold;
import io.github.luigeneric.core.player.container.Mail;
import io.github.luigeneric.core.player.container.visitors.HoldVisitor;
import io.github.luigeneric.core.player.container.visitors.ShopVisitor;
import io.github.luigeneric.core.player.counters.Mission;
import io.github.luigeneric.core.player.counters.MissionBook;
import io.github.luigeneric.core.player.factors.Factor;
import io.github.luigeneric.core.player.factors.Factors;
import io.github.luigeneric.core.player.settings.UserSetting;
import io.github.luigeneric.core.player.settings.values.UserSettingFloat;
import io.github.luigeneric.core.protocols.BgoProtocol;
import io.github.luigeneric.core.protocols.ProtocolID;
import io.github.luigeneric.core.protocols.ProtocolRegistryWriteOnly;
import io.github.luigeneric.core.protocols.game.GameProtocol;
import io.github.luigeneric.core.protocols.notification.NotificationProtocol;
import io.github.luigeneric.core.protocols.notification.NotificationProtocolWriteOnly;
import io.github.luigeneric.core.protocols.player.PlayerProtocol;
import io.github.luigeneric.core.protocols.player.PlayerProtocolWriteOnly;
import io.github.luigeneric.core.protocols.setting.SettingProtocol;
import io.github.luigeneric.core.protocols.story.StoryProtocol;
import io.github.luigeneric.core.protocols.story.StoryProtocolWriteOnly;
import io.github.luigeneric.core.protocols.zone.ZoneDesc;
import io.github.luigeneric.core.protocols.zone.ZoneProtocol;
import io.github.luigeneric.core.sector.Sector;
import io.github.luigeneric.core.sector.SectorUtils;
import io.github.luigeneric.core.sector.creation.TentacleCluster;
import io.github.luigeneric.core.sector.management.OutpostState;
import io.github.luigeneric.core.sector.management.SectorRegistry;
import io.github.luigeneric.core.sector.management.SectorUsers;
import io.github.luigeneric.core.sector.management.abilities.actions.ResourceScanAction;
import io.github.luigeneric.core.sector.management.damage.DamageRecord;
import io.github.luigeneric.core.sector.management.lootsystem.loot.AsteroidLoot;
import io.github.luigeneric.core.sector.management.spawn.AsteroidResourceDistributionRecord;
import io.github.luigeneric.core.sector.management.spawn.SpawnController;
import io.github.luigeneric.core.spaceentities.*;
import io.github.luigeneric.enums.*;
import io.github.luigeneric.linearalgebra.base.Euler3;
import io.github.luigeneric.linearalgebra.base.Quaternion;
import io.github.luigeneric.linearalgebra.base.Transform;
import io.github.luigeneric.linearalgebra.base.Vector3;
import io.github.luigeneric.templates.cards.ShipSystemCard;
import io.github.luigeneric.templates.catalogue.Catalogue;
import io.github.luigeneric.templates.shipitems.ItemCountable;
import io.github.luigeneric.templates.shipitems.ItemType;
import io.github.luigeneric.templates.shipitems.ShipItem;
import io.github.luigeneric.templates.shipitems.ShipSystem;
import io.github.luigeneric.templates.startupconfig.GameServerParamsConfig;
import io.github.luigeneric.templates.utils.ShipSlotType;
import io.github.luigeneric.utils.BgoRandom;
import io.github.luigeneric.utils.Utils;
import jakarta.enterprise.inject.spi.CDI;
import io.github.luigeneric.templates.utils.ObjectStat;
import io.github.luigeneric.core.spaceentities.SpaceObject;
import java.util.TreeMap;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;

import java.io.IOException;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;

@Slf4j
public class DebugProtocol extends BgoProtocol
{
    private final SectorRegistry sectorRegistry;
    private final UsersContainer usersContainer;
    private final DebugProtocolWriteOnly writer;
    private final Catalogue catalogue;
    private final ApplicationBootstrap applicationBootstrap;
    private final ChatAccessBlocker chatAccessBlocker;
    private final RefundProcessor refundProcessor;

    public DebugProtocol(final ProtocolContext ctx, 
                         final SectorRegistry sectorRegistry,
                         final UsersContainer usersContainer,
                         final ChatAccessBlocker chatAccessBlocker,
                         final RefundProcessor refundProcessor
    )
    {
        super(ProtocolID.Debug, ctx);
        this.applicationBootstrap = CDI.current().select(ApplicationBootstrap.class).get();
        this.refundProcessor = refundProcessor;
        this.catalogue = CDI.current().select(Catalogue.class).get();
        this.sectorRegistry = sectorRegistry;
        this.usersContainer = usersContainer;
        this.writer = new DebugProtocolWriteOnly();
        this.chatAccessBlocker = chatAccessBlocker;
    }

    public DebugProtocolWriteOnly writer()
    {
        return writer;
    }

    public void parseDevMessages(final BgoProtocolReader br, final String command) throws IOException
    {
        switch (command)
        {
            case "show_zones" ->
            {
                try
                {
                    ZoneProtocol zoneProtocol = ctx.user().getProtocol(ProtocolID.Zone);
                    var bw = zoneProtocol.getWriter().writeActiveZones(List.of(
                            ZoneDesc.createZoneInfiniteTime(463726137)
                    ));
                    ctx.user().send(List.of(bw));
                }
                catch (Exception e)
                {
                    log.error("show_zones error: {}", Utils.getExceptionStackTrace(e));
                }
            }
            case "update_role" ->
            {
                final AdminRoles roles = ctx.user().getPlayer().getBgoAdminRoles();

                if (roles.hasRole(BgoAdminRoles.Console) &&
                        ctx.user().getPlayer().getUserID() == 1 || ctx.user().getPlayer().getUserID() == 2)
                {
                    try
                    {
                        final String rawPlayerId = br.readString();
                        final String rawRoleBit = br.readString();

                        final long playerID = Long.parseLong(rawPlayerId);
                        final long roleBits = Long.parseLong(rawRoleBit);
                        final Optional<User> optUserForPermissions = usersContainer.get(playerID);
                        if (optUserForPermissions.isEmpty())
                            return;
                        final User userForPermissions = optUserForPermissions.get();
                        userForPermissions.getPlayer().getBgoAdminRoles().setOr(roleBits);
                        userForPermissions.send(writer.writeUpdateRoles(roleBits));
                    }
                    catch (final NumberFormatException numberFormatException)
                    {
                        sendEzMsg(numberFormatException.getMessage());
                    }
                }
            }
            case "update_role_name" ->
            {
                final AdminRoles roles = ctx.user().getPlayer().getBgoAdminRoles();
                if (roles.hasRole(BgoAdminRoles.Console) &&
                        ctx.user().getPlayer().getUserID() == 1 || ctx.user().getPlayer().getUserID() == 2)
                {
                    try
                    {
                        final String rawPlayerName = br.readString();
                        final String rawRoleBit = br.readString();

                        final long roleBits = Long.parseLong(rawRoleBit);
                        final Optional<User> optUserForPermissions = usersContainer.get(rawPlayerName);
                        if (optUserForPermissions.isEmpty())
                        {
                            log.error("Could not find update role name " + rawPlayerName);
                            return;
                        }
                        final User userForPermissions = optUserForPermissions.get();
                        userForPermissions.getPlayer().getBgoAdminRoles().setOr(roleBits);
                        userForPermissions.send(writer.writeUpdateRoles(roleBits));
                    }
                    catch (final NumberFormatException numberFormatException)
                    {
                        sendEzMsg(numberFormatException.getMessage());
                    }
                }
            }
            case "shutdown_server" ->
            {
                applicationBootstrap.onShutdown();
            }
            case "activate_loot" ->
            {
                try
                {
                    final String rawPlayerName = br.readString();
                    final int times = (int) parseStringAsLong(br);
                    final int customTimeHours = (int) parseStringAsLong(br);

                    final Optional<User> optUser = usersContainer.get(rawPlayerName);
                    if (optUser.isEmpty())
                    {
                        log.warn("Username was not valid! {}", rawPlayerName);
                        return;
                    }

                    final User userForDI = optUser.get();
                    final Factors factors = userForDI.getPlayer().getFactors();
                    final LocalDateTime now = LocalDateTime.now(Clock.systemUTC());

                    for (int i = 0; i < times; i++)
                    {
                        factors.addFactor(Factor.fromStartTime(FactorType.Loot, FactorSource.Marketing, 1, now, customTimeHours));
                    }
                }
                catch (final Exception exception)
                {
                    sendEzMsg(exception.getMessage());
                }
            }
            case "activate_di" ->
            {
                final AdminRoles roles = ctx.user().getPlayer().getBgoAdminRoles();
                if (roles.hasRole(BgoAdminRoles.Console) &&
                        ctx.user().getPlayer().getUserID() == 1 || ctx.user().getPlayer().getUserID() == 2)
                {
                    try
                    {
                        final long augmentGUID = ResourceType.DivineInspiration.guid;
                        final String rawPlayerName = br.readString();
                        final int times = (int) parseStringAsLong(br);
                        final int customTimeHours = (int) parseStringAsLong(br);

                        final Optional<User> optUser = usersContainer.get(rawPlayerName);
                        if (optUser.isEmpty())
                        {
                            log.warn("Username was not valid! {}", rawPlayerName);
                            return;
                        }

                        for (int i = 0; i < times; i++)
                        {
                            final User userForDI = optUser.get();
                            final PlayerProtocol playerProtocol = userForDI.getProtocol(ProtocolID.Player);
                            playerProtocol.activateAugment(augmentGUID, customTimeHours);
                        }
                    }
                    catch (final Exception exception)
                    {
                        sendEzMsg(exception.getMessage());
                    }
                }
            }
            case "check_for_multi_login" ->
            {
                final Set<User> ipAddresses = new HashSet<>();
                StringBuilder sb = new StringBuilder();
                sb
                        .append("MultiIpDetection:")
                        .append('\n');

                for (final User usr : usersContainer.values())
                {
                    if (usr.isConnected())
                    {
                        final boolean contained = !ipAddresses.add(usr);
                        if (contained)
                        {
                            sb
                                    .append("SameIP: ")
                                    .append(usr.getPlayer())
                                    .append('\n');
                        }
                    }
                }
                sendEzMsg(sb);
            }
            case "avg_equip_level" ->
            {
                StringBuilder sb = new StringBuilder();
                for (User value : usersContainer.values())
                {
                    if (!value.isConnected())
                        continue;
                    try
                    {
                        final HangarShip activeShip = value.getPlayer().getHangar().getActiveShip();
                        final OptionalDouble avgLvl = activeShip.getShipSlots().values().stream()
                                .filter(shipSlot -> shipSlot.getShipSystem() != null)
                                .filter(shipSlot -> shipSlot.getShipSystem().getShipSystemCard() != null)
                                .filter(shipSlot -> shipSlot.getShipSystem().getShipSystemCard().getShipSlotType() != ShipSlotType.avionics)
                                .map(shipSlot -> shipSlot.getShipSystem().getShipSystemCard())
                                .mapToDouble(ShipSystemCard::getLevel)
                                .average();
                        if (avgLvl.isEmpty())
                            continue;
                        final double avgDoubleLevel = avgLvl.getAsDouble();
                        sb
                                .append("User ")
                                .append(value.getPlayer().getName())
                                .append(" level: ")
                                .append(String.format("%.2f", avgDoubleLevel))
                                .append('\n');
                    }
                    catch (Exception ignored) {}
                }
                sendEzMsg(sb);
            }
            case "avg_equip_faction" ->
            {
                StringBuilder sb = new StringBuilder();
                Map<Faction, Double> rv2 = usersContainer.values()
                        .stream()
                        .filter(User::isConnected)
                        .collect(Collectors.groupingBy(usr -> usr.getPlayer().getFaction(),
                                Collectors.averagingDouble(value ->
                                {
                                    var hangar = value.getPlayer().getHangar();
                                    var activeShip = hangar.getActiveShip();
                                    return activeShip.getShipSlots()
                                            .values()
                                            .stream()
                                            .filter(slot -> slot.getShipSystem() != null && slot.getShipSystem().getCardGuid() != 0)
                                            .filter(shipSlot -> shipSlot.getShipSystem().getShipSystemCard().getShipSlotType() != ShipSlotType.avionics)
                                            .map(shipSlot -> shipSlot.getShipSystem().getShipSystemCard())
                                            .mapToDouble(ShipSystemCard::getLevel)
                                            .average().orElse(1);
                                })));
                for (Map.Entry<Faction, Double> factionDoubleEntry : rv2.entrySet())
                {
                    sb.append("Faction ")
                            .append(factionDoubleEntry.getKey())
                            .append(" avg ")
                            .append(factionDoubleEntry.getValue())
                            .append("\n");
                }
                sendEzMsg(sb);
            }
            case "purge_all_missions" ->
            {
                for (final User usr : usersContainer.values())
                {
                    MissionBook usrMissionBook = usr.getPlayer().getCounterFacade().missionBook();
                    final List<Integer> allMisions = usrMissionBook.findAll(mission -> true)
                            .stream()
                            .map(Mission::getServerID)
                            .toList();
                    usrMissionBook.reset();
                    PlayerProtocolWriteOnly playerProtocolWriteOnly = ProtocolRegistryWriteOnly.getProtocol(ProtocolID.Player);
                    usr.send(playerProtocolWriteOnly.writeRemoveMissions(allMisions));
                }
            }
            case "purge_missions_name" ->
            {
                final String name = br.readString();

                final Optional<User> optUsr = usersContainer.get(name);
                if (optUsr.isEmpty())
                {
                    sendEzMsg("Can not find user! " + name);
                    return;
                }
                final User usr = optUsr.get();

                final MissionBook usrMissionBook = usr.getPlayer().getCounterFacade().missionBook();
                final List<Integer> allMisions = usrMissionBook.findAll(mission -> true)
                        .stream()
                        .map(Mission::getServerID)
                        .toList();
                usrMissionBook.reset();
                PlayerProtocolWriteOnly playerProtocolWriteOnly = ProtocolRegistryWriteOnly.getProtocol(ProtocolID.Player);
                usr.send(playerProtocolWriteOnly.writeRemoveMissions(allMisions));
            }
            case "purge_broken_mission" ->
            {
                final String username = br.readString();
                final Optional<User> optUsr = usersContainer.get(username);
                if (optUsr.isEmpty())
                    return;
                final User usr = optUsr.get();

                final Set<Integer> idsToDelete = new HashSet<>();
                idsToDelete.add(1031);
                idsToDelete.add(2031);
                usr.getPlayer().getCounterFacade().missionBook().removeItem(1031);
                usr.getPlayer().getCounterFacade().missionBook().removeItem(2031);
                PlayerProtocolWriteOnly playerProtocolWriteOnly = new PlayerProtocolWriteOnly();
                usr.send(playerProtocolWriteOnly.writeRemoveMissions(idsToDelete));
            }
            case "getAllShipCountsByObjectKey" ->
            {
                final boolean isTestingMode = ctx.gameServerParams().starterParams().testingMode();

                final Map<Long, Long> result = usersContainer.values().stream()
                        .filter(usr -> isTestingMode || !usr.getPlayer().getBgoAdminRoles().hasOneRole(BgoAdminRoles.Developer))
                        .filter(usr -> isTestingMode || !usr.getPlayer().getBgoAdminRoles().hasOneRole(BgoAdminRoles.CommunityManager))
                        .filter(User::isConnected)
                        .collect(Collectors.groupingBy(usr -> usr.getPlayer().getHangar().getActiveShip().getShipCard().getShipObjectKey(),
                                Collectors.counting()));
                StringBuilder sb = new StringBuilder();

                for (final Map.Entry<Long, Long> longLongEntry : result.entrySet())
                {
                    if (longLongEntry.getValue() == null || longLongEntry.getValue() == 0)
                        continue;
                    sb
                            .append("ObjectKey ")
                            .append(longLongEntry.getKey())
                            .append(" ")
                            .append(longLongEntry.getValue())
                            .append('\n');

                }
                sendEzMsg(sb);
            }
            case "listObjectKeys" ->
            {
                try
                {
                    final boolean isTestingMode = ctx.gameServerParams().starterParams().testingMode();
                    final Map<Long, Long> fullObjKeyMap = usersContainer.values().stream()
                            .filter(usr -> isTestingMode || !usr.getPlayer().getBgoAdminRoles().hasOneRole(BgoAdminRoles.Developer))
                            .filter(usr -> isTestingMode || !usr.getPlayer().getBgoAdminRoles().hasOneRole(BgoAdminRoles.CommunityManager))
                            .filter(User::isConnected)
                            .filter(usr -> usr.getPlayer().getHangar().hasActiveShip())
                            .collect(Collectors.groupingBy(usr -> usr.getPlayer().getHangar().getActiveShip().getShipCard().getShipObjectKey(),
                                    Collectors.counting()));
                    StringBuilder sb = new StringBuilder();
                    sb
                            .append("gungnir/nidhogg: ")
                            .append(fullObjKeyMap.getOrDefault(154919763L, 0L) + fullObjKeyMap.getOrDefault(57013176L, 0L))
                            .append('\n')
                            .append("aesir/fenrir: ")
                            .append(fullObjKeyMap.getOrDefault(154840275L, 0L) + fullObjKeyMap.getOrDefault(6704946L, 0L))
                            .append('\n')
                            .append("jotunn/jormung: ")
                            .append(fullObjKeyMap.getOrDefault(220899717L, 0L) + fullObjKeyMap.getOrDefault(61514333L, 0L))
                            .append('\n')
                            .append("vanir/hel: ")
                            .append(fullObjKeyMap.getOrDefault(218435475L, 0L) + fullObjKeyMap.getOrDefault(24730942L, 0L));
                    sendEzMsg(sb);
                }
                catch (Exception exception)
                {
                    sendEzMsg("ERROR:" + exception.getMessage());
                }
            }
            /* push <speed> [seconds]
             * Shove the ship you are flying up to <speed> and let it bleed off. The stat is
             * raised so the server's own clamp allows it (GameProtocol clamps every client speed
             * report to the ship's max), the throttle is opened to match, and after [seconds]
             * (default 5) the stat drops back - from there the movement sim decelerates the hull
             * at its own acceleration, which is the drag you feel on the way down.
             * Only touches the live ship in the sector, never the hangar card, so nothing about
             * it persists: die, dock or relog and the ship is stock again. */
            case "push" ->
            {
                try
                {
                    final float speed = Float.parseFloat(br.readString());
                    float seconds;
                    try { seconds = Float.parseFloat(br.readString()); }
                    catch (final Exception noSecondArg) { seconds = 5f; }
                    if (speed <= 0 || speed > 20000)
                    {
                        sendEzMsg("push: speed must be 1..20000");
                        return;
                    }
                    final Player pusher = ctx.user().getPlayer();
                    final Optional<Sector> optSector = sectorRegistry.getSectorById(pusher.getSectorId());
                    if (optSector.isEmpty())
                    {
                        sendEzMsg("push: you are not in a sector");
                        return;
                    }
                    final Optional<PlayerShip> optShip =
                            optSector.get().getCtx().users().getPlayerShipByUserID(pusher.getUserID());
                    if (optShip.isEmpty())
                    {
                        sendEzMsg("push: no ship in space - undock first");
                        return;
                    }
                    final PlayerShip ship = optShip.get();
                    final var stats = ship.getSpaceSubscribeInfo();
                    final float baseSpeed = stats.getStatOrDefault(ObjectStat.Speed);
                    final float baseBoost = stats.getStatOrDefault(ObjectStat.BoostSpeed);
                    stats.setStat(ObjectStat.Speed, speed);
                    stats.setStat(ObjectStat.BoostSpeed, speed);
                    final var opts = ship.getMovementController().getMovementOptions();
                    opts.setSpeed(speed);
                    opts.setThrottleSpeed(speed);
                    sendEzMsg(String.format("push: %.0f for %.1fs (was %.0f)", speed, seconds, baseSpeed));

                    final long restoreAtMillis = System.currentTimeMillis() + (long) (seconds * 1000f);
                    Thread.ofVirtual().start(() ->
                    {
                        try
                        {
                            final long sleepFor = restoreAtMillis - System.currentTimeMillis();
                            if (sleepFor > 0) Thread.sleep(sleepFor);
                            stats.setStat(ObjectStat.Speed, baseSpeed);
                            stats.setStat(ObjectStat.BoostSpeed, baseBoost);
                            // Throttle stays where it is: the sim now sees a speed above the
                            // ship's maximum and walks it down, which is the point.
                        }
                        catch (final InterruptedException interrupted)
                        {
                            Thread.currentThread().interrupt();
                        }
                    });
                }
                catch (final Exception ex)
                {
                    sendEzMsg("push <speed> [seconds] - " + ex);
                }
            }
            /* heal - hull and power back to full on the ship you are flying. */
            case "heal" ->
            {
                final Player healed = ctx.user().getPlayer();
                sectorRegistry.getSectorById(healed.getSectorId())
                        .flatMap(sec -> sec.getCtx().users().getPlayerShipByUserID(healed.getUserID()))
                        .ifPresentOrElse(ship ->
                        {
                            final var stats = ship.getSpaceSubscribeInfo();
                            stats.setHp(stats.getStatOrDefault(ObjectStat.MaxHullPoints));
                            stats.setPp(stats.getStatOrDefault(ObjectStat.MaxPowerPoints));
                            sendEzMsg("heal: hull and power restored");
                        }, () -> sendEzMsg("heal: no ship in space"));
            }
            /* where - sector id, position and current speed. The fastest way to answer
             * "is the server simulating me where I think I am". */
            case "where" ->
            {
                final Player who = ctx.user().getPlayer();
                sectorRegistry.getSectorById(who.getSectorId())
                        .flatMap(sec -> sec.getCtx().users().getPlayerShipByUserID(who.getUserID()))
                        .ifPresentOrElse(ship ->
                        {
                            final var pos = ship.getMovementController().getPosition();
                            sendEzMsg(String.format("sector %d  pos %.0f/%.0f/%.0f  speed %.1f  hp %.0f",
                                    who.getSectorId(), pos.getX(), pos.getY(), pos.getZ(),
                                    ship.getMovementController().getMovementOptions().getSpeed(),
                                    ship.getSpaceSubscribeInfo().getHp()));
                        }, () -> sendEzMsg("where: room, sector " + who.getSectorId()));
            }
            /* npcs - what is alive in this sector, by type. Answers "did my wing spawn". */
            case "npcs" ->
            {
                sectorRegistry.getSectorById(ctx.user().getPlayer().getSectorId()).ifPresentOrElse(sector ->
                {
                    final Map<String, Integer> byType = new TreeMap<>();
                    for (final SpaceObject so : sector.getCtx().spaceObjects().values())
                    {
                        byType.merge(so.getSpaceEntityType().name(), 1, Integer::sum);
                    }
                    final StringBuilder sb = new StringBuilder("sector ")
                            .append(sector.getId()).append(": ");
                    byType.forEach((k, v) -> sb.append(k).append('=').append(v).append(' '));
                    sendEzMsg(sb.toString());
                }, () -> sendEzMsg("npcs: not in a sector"));
            }
            case "set_counter_by" ->
            {
                try
                {
                    final String name = br.readString();
                    final long counterGuid = parseStringAsLong(br);
                    final long newValue = parseStringAsLong(br);

                    final Optional<User> optUsr = usersContainer.get(name);
                    if (optUsr.isEmpty())
                    {
                        sendEzMsg("User " + name + " not present!");
                        return;
                    }
                    final User usr = optUsr.get();
                    usr.getPlayer().getCounterFacade().setCounter(counterGuid, newValue);
                }
                catch (Exception ex)
                {
                    sendEzMsg(ex.getMessage());
                }
            }
            case "increase_counter_by" ->
            {
                final String name = br.readString();
                final String rawCounterGuid = br.readString();
                final String rawSectorCardGuid = br.readString();
                final String rawByValue = br.readString();

                try
                {
                    final long counterGuid = Long.parseLong(rawCounterGuid);
                    final long sectorCardGuid = Long.parseLong(rawSectorCardGuid);
                    final long byValue = Long.parseLong(rawByValue);

                    final Optional<User> optUsr = usersContainer.get(name);
                    if (optUsr.isEmpty())
                    {
                        sendEzMsg("User " + name + " not present!");
                        return;
                    }
                    final User usr = optUsr.get();
                    usr.getPlayer().getCounterFacade().incrementCounter(counterGuid, sectorCardGuid, byValue);
                }
                catch (Exception ex)
                {
                    sendEzMsg(ex.getMessage());
                }
            }
            /* spawn <ship> [x] [y] [z] - an NPC of any hull in the catalogue, next to you.
             * <ship> is a guid or a piece of a GUI key (raider, viper, dreadnought, brimir...);
             * list_ships prints what matches. Offsets are in YOUR ship's frame: x right, y forward,
             * z up. All blank = parked in front of your nose at a polite distance. */
            case "spawn" -> spawnNpcCommand(br);
            // spawn_wing <ship> <count> - the same, as a ring around you. Capped at 12.
            case "spawn_wing" ->
            {
                final String shipToken = br.readString();
                final int count = (int) Math.min(12, Math.max(1, parseStringAsLong(br)));
                spawnWing(shipToken, count);
            }
            case "list_ships" -> listShips(tryReadString(br).orElse(""));
            /* god_mode true|false - live-ship max hull/power to a billion and full heal; off
             * recomputes the real stats from the hangar card (applyStats), so nothing persists.
             * Same non-persistence contract as push: die, dock or relog and the ship is stock. */
            case "god_mode" -> godMode(Boolean.parseBoolean(br.readString()));
            /* Panel buttons. kill_em_all and reset_mobs are the same act on this server: dead
             * NPCs pay nothing without damage claims, and the sector timers respawn their waves
             * on their own schedule. */
            case "kill_em_all", "reset_mobs" -> killAllNpcs();
            case "tp" ->
            {
                final float x = Float.parseFloat(br.readString());
                final float y = Float.parseFloat(br.readString());
                final float z = Float.parseFloat(br.readString());
                teleportTo(new Vector3(x, y, z));
            }
            case "tp_target" -> teleportToTarget();
            /* spawn_missile - your current TARGET fires one standard missile at YOU. The one
             * honest way to conjure an interceptable warhead on demand: a missile needs a hostile
             * caster, and the ship you have selected is the hostile thing at hand. */
            case "spawn_missile" -> spawnMissileFromTarget();
            // hp <value> - set your live hull. For testing kill thresholds and damage math.
            case "hp" ->
            {
                final float value = Float.parseFloat(br.readString());
                withOwnShip(ship ->
                {
                    final var stats = ship.getSpaceSubscribeInfo();
                    stats.setHp(Math.min(value, stats.getStatOrDefault(ObjectStat.MaxHullPoints)));
                    sendEzMsg(String.format("hp: %.0f", stats.getHp()));
                });
            }
            /* The admin panel has buttons for these; answer honestly instead of silently. */
            case "spawn_mine", "spawn_flare" ->
                    sendEzMsg(command + ": not implemented - no server-side factory for this object yet");
            case "to_zone" ->
                    sendEzMsg("to_zone: not implemented - zone/arena transfer never worked upstream");
            case "map_part" ->
                    sendEzMsg("map_part: not implemented - wheel-of-fortune map parts have no server side yet");
            case "restart_sector" ->
                    sendEzMsg("restart_sector: not implemented - restart the server instead, sectors rebuild at boot");
            case "loot_target_x10" ->
                    sendEzMsg("loot_target_x10: not implemented - loot rolls once per kill; use loot_target");
        }
    }

    /**
     * The console is a typing surface, so its arguments are whatever the operator managed to type:
     * a missing argument leaves the reader empty and readString runs off the end, a word where a
     * number belongs throws NumberFormatException, an unknown command id switches on null. None of
     * those reach ProtocolUpdater as anything it recognises, so its catch-all closes the socket -
     * a typo in the console drops the player out of the game.
     *
     * Nothing in here reads from the socket (the reader is a byte array of the one message), so
     * swallowing everything costs no stream sync: the command is abandoned, the operator is told
     * why, and the connection stays up.
     */
    @Override
    public void parseMessage(final int msgType, final BgoProtocolReader br)
    {
        try
        {
            dispatchMessage(msgType, br);
        }
        catch (final Exception exception)
        {
            log.warn("DebugProtocol msgType={} from {} failed: {}",
                    msgType, ctx.user().getUserLogSimple(), Utils.getExceptionStackTrace(exception));
            try
            {
                final String reason = exception.getMessage() == null
                        ? exception.getClass().getSimpleName()
                        : exception.getMessage();
                sendEzMsg("command failed: " + reason);
            }
            catch (final Exception ignored)
            {
                // the player is already gone; the log above is all we owe them
            }
        }
    }

    private void dispatchMessage(final int msgType, final BgoProtocolReader br) throws IOException
    {
        final ClientMessage clientMessage = ClientMessage.forValue(msgType);
        log.info("DebugProtocol: " + clientMessage);
        if (clientMessage == null)
        {
            log.warn("DebugProtocol unknown msgType={} from {}", msgType, ctx.user().getUserLogSimple());
            return;
        }

        final Player player = this.ctx.user().getPlayer();
        final AdminRoles roles = player.getBgoAdminRoles();
        final boolean isConsole = roles.hasRole(BgoAdminRoles.Console);
        final boolean isModerator = roles.hasRole(BgoAdminRoles.Mod);
        if (!isConsole || isModerator)
        {
            String additionalStr = "";
            if (clientMessage == ClientMessage.Command)
            {
                additionalStr = br.readString();
            }
            log.warn("User has too low permissions but used DebugProtocol={} otherMsg={}", ctx.user().getUserLog(), additionalStr);
            return;
        }

        switch (clientMessage)
        {
            case Activity ->
            {
                log.error("Report activity used but it's not implemented in client anymore! " + ctx.user().getUserLog());
            }
            case ProcessState ->
            {
                ctx.user().send(writer.writeProcessState("State not set"));
            }
            case UpgradeSystem ->
            {
                sendEzMsg("Not implemented!");
            }
            case Command ->
            {
                final String command = br.readString();
                log.warn(ctx.user().getUserLog() + " Command call " + command + " from " + player.getName());

                final PlayerProtocol playerProtocol = ctx.user().getProtocol(ProtocolID.Player);

                if (roles.hasRole(BgoAdminRoles.Developer))
                {
                    parseDevMessages(br, command);
                }

                switch (command)
                {
                    case "check_ip" ->
                    {
                        final Map<String, List<User>> grouped = this.usersContainer.userStream(User::isConnected)
                                .collect(Collectors.groupingBy(user ->
                                {
                                    final Optional<AbstractConnection> optConnection = ctx.user().getConnection();
                                    if (optConnection.isEmpty())
                                        return "";
                                    return optConnection.get().addressPrettyPrint();
                                }));
                        grouped.entrySet().removeIf(entry -> entry.getValue().size() < 2);
                        Map<String, List<String>> namesLst = new HashMap<>();
                        for (Map.Entry<String, List<User>> entry : grouped.entrySet())
                        {
                            List<String> lst = entry.getValue().stream().map(usr -> usr.getPlayer().getName() +
                                    " / " + usr.getPlayer().getLocation().getSectorID()).toList();
                            namesLst.put(entry.getKey(), lst);
                        }
                        sendEzMsg("MultiIps " + namesLst);
                    }
                    case "change_name" ->
                    {
                        sendEzMsg("send name not implemented");
                    }
                    case "destroy_paints_hold" ->
                    {
                        final String playerName = br.readString();
                        final Optional<User> optPlayer = usersContainer.get(playerName);
                        if (optPlayer.isEmpty())
                        {
                            sendEzMsg("cannot find username");
                            return;
                        }
                        final User userToRemovePaintFrom = optPlayer.get();

                        final Hold hold = userToRemovePaintFrom.getPlayer().getHold();
                        final List<Integer> paintIds = hold.getAllShipItems().stream()
                                .filter(item -> item.getItemType() == ItemType.System)
                                .map(item -> (ShipSystem)item)
                                .filter(item -> item.getShipSystemCard().getShipSlotType() == ShipSlotType.ship_paint)
                                .map(ShipItem::getServerID).toList();
                        paintIds.forEach(hold::removeShipItem);
                        for (Integer toRemoveId : paintIds)
                        {
                            final BgoProtocolWriter bw = playerProtocol.writeRemoveItem(hold, toRemoveId);
                            userToRemovePaintFrom.send(bw);
                        }
                    }
                    case "switch_faction" ->
                    {
                        final String userName = br.readString();
                        final String rawUseCubits = br.readString();
                        final String rawPrice = br.readString();
                        try
                        {
                            final float priceValue = Float.parseFloat(rawPrice);
                            final boolean useCubits = Boolean.parseBoolean(rawUseCubits);
                            final Optional<User> optUser = usersContainer.get(userName);

                            if (optUser.isEmpty())
                            {
                                log.info("Admin switch but user not found {}", userName);
                                return;
                            }
                            final User userToSwitch = optUser.get();
                            final PlayerProtocol playerProtocolFromSwitchUser = userToSwitch.getProtocol(ProtocolID.Player);
                            playerProtocolFromSwitchUser.factionSwitchProcess(useCubits, priceValue);
                        }
                        catch (Exception ex)
                        {
                            log.error("error in switch faction", ex);
                        }
                    }
                    case "kick_player" ->
                    {
                        try
                        {
                            final String rawPlayerID = br.readString();
                            final long playerID = Long.parseLong(rawPlayerID);

                            final Optional<User> optUser = usersContainer.get(playerID);
                            optUser
                                    .flatMap(User::getConnection)
                                    .ifPresent(connection -> connection.closeConnection("kick command executed by " + player.getPlayerLog()));
                        }
                        catch (final NumberFormatException numberFormatException)
                        {
                            sendEzMsg(numberFormatException.getMessage());
                        }
                    }
                    case "add_player_to_block_chat" ->
                    {
                        try
                        {
                            final String rawPlayerName = br.readString();
                            final long durationHours = parseStringAsLong(br);

                            final Optional<User> optPlayer = usersContainer.get(rawPlayerName);
                            if (optPlayer.isEmpty())
                            {
                                sendEzMsg("not found");
                                return;
                            }
                            final User playerToChatBan = optPlayer.get();
                            this.chatAccessBlocker.addUser(playerToChatBan.getPlayer().getUserID(), durationHours, TimeUnit.HOURS);
                        }
                        catch (Exception ex)
                        {
                            sendEzMsg(ex.getMessage());
                        }
                    }
                    case "kick_player_name" ->
                    {
                        try
                        {
                            final String playerName = br.readString();

                            final Optional<User> optUser = usersContainer.get(playerName);
                            optUser
                                    .flatMap(User::getConnection)
                                    .ifPresent(connection -> connection.closeConnection("kick command executed by " + player.getPlayerLog()));
                        }
                        catch (final NumberFormatException numberFormatException)
                        {
                            sendEzMsg(numberFormatException.getMessage());
                        }
                    }
                    case "highlight_object" ->
                    {
                        try
                        {
                            final String rawIsHighlighted = br.readString(); // 1 or 0
                            final boolean isHighlighted = rawIsHighlighted.equals("1");

                            final Optional<Sector> optCurrentSector = sectorRegistry.getSectorById(player.getSectorId());
                            if (optCurrentSector.isEmpty())
                                return;
                            final Sector currentSector = optCurrentSector.get();

                            final SectorUsers users = currentSector.getCtx().users();
                            final Optional<PlayerShip> optPlayerShip = users.getPlayerShipByUserID(ctx.user().getPlayer().getUserID());
                            if (optPlayerShip.isEmpty())
                                return;
                            final PlayerShip playerShip = optPlayerShip.get();
                            final var optTarget = playerShip.getSpaceSubscribeInfo().getTargetObjectID();
                            optTarget.ifPresent(targetID ->
                            {
                                final StoryProtocol storyProtocol = ctx.user().getProtocol(ProtocolID.Story);
                                final BgoProtocolWriter highlightBw = storyProtocol.writer().writeHighlightObject(targetID.get(), isHighlighted);
                                currentSector.getCtx().sender().sendToAllClients(highlightBw);
                            });
                            if (optTarget.isEmpty())
                            {
                                sendEzMsg("Target was not present!");
                            }


                        }
                        catch (Exception ex)
                        {
                            log.error("in highlight object", ex);
                        }
                    }
                    case "send_mail" ->
                    {
                        try
                        {
                            final String name = br.readString();
                            final Optional<User> optUser = usersContainer.get(name);
                            if (optUser.isEmpty())
                            {
                                log.error("SendMail: Cannot find user " + name);
                                return;
                            }
                            final User other = optUser.get();

                            final List<ShipItem> mailItems = new ArrayList<>();
                            mailItems.add(ItemCountable.fromGUID(ResourceType.Cubits.guid, 1_000_000));
                            mailItems.add(ItemCountable.fromGUID(ResourceType.Tylium.guid, 1_000_000));
                            mailItems.add(ItemCountable.fromGUID(ResourceType.Titanium.guid, 1_000_000));
                            mailItems.add(ItemCountable.fromGUID(ResourceType.Token.guid, 1_000_000));

                            Mail mail = new Mail(6, mailItems, other.getPlayer().getUserID());
                            MailBox mailBox = other.getPlayer().getMailBox();
                            mailBox.addItem(mail);
                            PlayerProtocol pp = other.getProtocol(ProtocolID.Player);

                            other.send(pp.writer().writeMailBox(mailBox));
                        }
                        catch (Exception ex)
                        {
                            log.error("in send mail", ex);
                        }
                    }
                    case "send_mail_specific" ->
                    {
                        try
                        {
                            final String name = br.readString();

                            final String rawCubits = br.readString();
                            final String rawTylium = br.readString();
                            final String rawTitanium = br.readString();
                            final String rawToken = br.readString();

                            final long cubits = Long.parseLong(rawCubits);
                            final long tylium = Long.parseLong(rawTylium);
                            final long titanium = Long.parseLong(rawTitanium);
                            final long token = Long.parseLong(rawToken);

                            final Optional<User> optUser = usersContainer.get(name);
                            if (optUser.isEmpty())
                            {
                                log.error("Cannot find user " + name);
                                return;
                            }
                            final User other = optUser.get();

                            final List<ShipItem> mailItems = new ArrayList<>();
                            mailItems.add(ItemCountable.fromGUID(ResourceType.Cubits.guid, cubits));
                            mailItems.add(ItemCountable.fromGUID(ResourceType.Tylium.guid, tylium));
                            mailItems.add(ItemCountable.fromGUID(ResourceType.Titanium.guid, titanium));
                            mailItems.add(ItemCountable.fromGUID(ResourceType.Token.guid, token));

                            Mail mail = new Mail(6, mailItems, other.getPlayer().getUserID());
                            MailBox mailBox = other.getPlayer().getMailBox();
                            mailBox.addItem(mail);
                            PlayerProtocol pp = other.getProtocol(ProtocolID.Player);
                            other.send(pp.writer().writeMailBox(mailBox));
                        }
                        catch (Exception ex)
                        {
                            log.error("send specific mail", ex);
                        }
                    }
                    case "print" ->
                    {
                        final var optSector = sectorRegistry.getSectorById(player.getSectorId());
                        if (optSector.isEmpty())
                            return;
                        final var sector = optSector.get();
                        sector.getCtx().users().getPlayerShipByUserID(player.getUserID()).ifPresent(da -> sendEzMsg("ObjectID " + da.getObjectID()));
                    }
                    case "print_target" ->
                    {
                        final var optSector = sectorRegistry.getSectorById(player.getSectorId());
                        if (optSector.isEmpty())
                            return;
                        final var sector = optSector.get();
                        var optPlayerShip = sector.getCtx().users().getPlayerShipByUserID(ctx.user().getPlayer().getUserID());
                        if (optPlayerShip.isEmpty())
                            return;
                        var playerShip = optPlayerShip.get();
                        var targetID = playerShip.getSpaceSubscribeInfo().getTargetObjectID().orElse(new AtomicLong(-1)).get();
                        var optTarget = sector.getCtx().spaceObjects().get(targetID);
                        if (optTarget.isEmpty())
                            return;
                        SpaceObject target = optTarget.get();
                        log.info("print_target: " + target);
                    }
                    case "self_buff" ->
                    {
                        final String type = br.readString();
                        selfBuff(type, player);
                    }
                    case "sector_op_all_max" ->
                    {
                        for (final Sector sector : sectorRegistry.getSectors())
                        {
                            sector.getCylonOpState().opDied(0);
                            sector.getCylonOpState().increasePoints(3000);

                            sector.getColonialOpState().opDied(0);
                            sector.getColonialOpState().increasePoints(3000);
                        }
                    }
                    case "sector_op" ->
                    {
                        final String rawFaction = br.readString();
                        final String rawPts = br.readString();

                        try
                        {
                            final Faction faction = rawFaction.equals("colonial") ? Faction.Colonial : Faction.Cylon;
                            final int pts = Integer.parseInt(rawPts);

                            final Optional<Sector> optCurrentSector = sectorRegistry.getSectorById(player.getSectorId());
                            if (optCurrentSector.isEmpty())
                                return;
                            final Sector currentSector = optCurrentSector.get();
                            final OutpostState currentState = faction == Faction.Colonial ?
                                    currentSector.getColonialOpState() : currentSector.getCylonOpState();
                            if (pts > 0)
                            {
                                if (currentState.isBlocked())
                                {
                                    currentState.opDied(0);
                                }
                                currentState.increasePoints(pts);
                            }
                            else if(pts < 0)
                            {
                                currentState.decreasePoints(Math.abs(pts));
                            }
                            else
                            {
                                //do nothing, or rather this should never happen!
                                log.error("DebugProtocol: outpost inc/dec value is 0");
                            }
                        }
                        catch (Exception ex)
                        {
                            log.error("sectorop", ex);
                        }
                    }
                    case "total_players" ->
                    {
                        sendTotalPlayers();
                    }
                    case "sector_distr" ->
                    {
                        sendTotalSectorDistr();
                    }
                    case "all_names" ->
                    {
                        sendTotalPlayersNames();
                    }
                    case "experience" ->
                    {
                        final String expValue = br.readString();
                        final long exp = Long.parseLong(expValue, 10);
                        addExperience(exp, playerProtocol);
                    }
                    case "experience_player" ->
                    {
                        try
                        {
                            final String playerName = br.readString();
                            final String rawExp = br.readString();
                            final long exp = Long.parseLong(rawExp, 10);
                            final var optUser = usersContainer.get(playerName);
                            if (optUser.isEmpty())
                                return;
                            final var usr = optUser.get();
                            final PlayerProtocol tmpPlayerProt = usr.getProtocol(ProtocolID.Player);
                            tmpPlayerProt.addExperience(exp);
                        }
                        catch (Exception ex)
                        {
                            log.error("experience player call wrong " + ex.getMessage());
                        }
                    }
                    case "set_exp_player" ->
                    {
                        try
                        {
                            final String playerName = br.readString();
                            final String rawExp = br.readString();
                            final long exp = Long.parseLong(rawExp, 10);
                            final var optUser = usersContainer.get(playerName);
                            if (optUser.isEmpty())
                                return;
                            final var usr = optUser.get();
                            final PlayerProtocol tmpPlayerProt = usr.getProtocol(ProtocolID.Player);
                            usr.getPlayer().getSkillBook().setExperience(0);
                            tmpPlayerProt.addExperience(exp);
                        }
                        catch (Exception ex)
                        {
                            log.error("experience player call wrong " + ex.getMessage());
                        }
                    }
                    case "visibility" ->
                    {
                        try
                        {
                            final String rawIsVisible = br.readString();
                            final boolean isVisible = Boolean.parseBoolean(rawIsVisible);
                            final String rawChangeVisibilityReason = br.readString();
                            final ChangeVisibilityReason changeVisibilityReason = ChangeVisibilityReason.valueOf(rawChangeVisibilityReason);


                            final Optional<Sector> optCurrentSector = this.sectorRegistry.getSectorById(player.getSectorId());
                            if (optCurrentSector.isEmpty()) return;
                            final Sector currentSector = optCurrentSector.get();
                            final GameProtocol gameProtocol = ctx.user().getProtocol(ProtocolID.Game);
                            final Optional<PlayerShip> optPlayerShip = currentSector.getCtx().users().getPlayerShipByUserID(player.getUserID());
                            if (optPlayerShip.isEmpty()) return;
                            final PlayerShip playerShip = optPlayerShip.get();
                            final BgoProtocolWriter bw = gameProtocol.writer()
                                    .writeChangeVisibility(playerShip.getObjectID(), isVisible, changeVisibilityReason);
                            ctx.user().send(bw);
                        }
                        catch (Exception e)
                        {
                            log.error("visibility change issue", e);
                        }
                    }
                    case "scan_all" ->
                    {
                        scanAll(user());
                    }
                    case "remove_factors" ->
                    {
                        ctx.user().getPlayer().getFactors().removeAll();
                        PlayerProtocolWriteOnly playerProtocolWriteOnly = ProtocolRegistryWriteOnly.getProtocol(ProtocolID.Player);
                        ctx.user().send(playerProtocolWriteOnly.writeFactors(ctx.user().getPlayer().getFactors()));
                        sendEzMsg("factor-map cleared");
                    }
                    //not working
                    case "send_banner_box" ->
                    {
                        StoryProtocolWriteOnly storyProtocolWriteOnly = ProtocolRegistryWriteOnly.getProtocol(ProtocolID.Story);
                        this.ctx.user().send(storyProtocolWriteOnly.writeBannerBox(230));
                    }
                    case "dump_factors" ->
                    {
                        var factors = ctx.user().getPlayer().getFactors();
                        sendEzMsg("factors " + factors.values().size());
                        factors.values().forEach(factor -> sendEzMsg(factor.toString()));
                    }
                    //not working
                    case "mission_log" ->
                    {
                        StoryProtocolWriteOnly storyProtocolWriteOnly = ProtocolRegistryWriteOnly.getProtocol(ProtocolID.Story);
                        this.ctx.user().send(storyProtocolWriteOnly.writeMissionLog("testtext"));
                    }
                    case "scan_all_playername" ->
                    {
                        final String playerName = br.readString();
                        final Optional<User> optUsr = usersContainer.get(playerName);
                        if (optUsr.isEmpty())
                            return;
                        final User usr = optUsr.get();
                        scanAll(usr);
                    }

                    case "resource" ->
                    {
                        addResources(br);
                    }
                    case "augmentItemTest" ->
                    {
                        List<ShipItem> augmentItems = new ArrayList<>();
                        ItemCountable d = ItemCountable.fromGUID(ResourceType.Cubits.guid, 10000);
                        ShipSystem s = ShipSystem.fromGUID(2347342124L);

                        augmentItems.add(d);
                        augmentItems.add(s);

                        final NotificationProtocol notificationProtocol = ctx.user().getProtocol(ProtocolID.Notification);
                        notificationProtocol.sendAugmentItemsAndAdd(augmentItems);
                    }
                    case "set_settings" ->
                    {
                        final float volume = 0.3f;
                        player.getSettings().getServerSavedUserSettings().put(UserSetting.MusicVolume, new UserSettingFloat(volume));
                        SettingProtocol settingProtocol = ctx.user().getProtocol(ProtocolID.Setting);
                        settingProtocol.sendSettings();
                    }
                    case "room" ->
                    {
                        final String room = br.readString();
                        //door
                        br.readString();
                        if (room.equals("cic"))
                        {
                            final GameProtocol gameProtocol = ctx.user().getProtocol(ProtocolID.Game);
                            gameProtocol.dockProcedure(false, true);
                        } else
                        {
                            log.error("room not implemented");
                        }
                    }
                    case "teleport0" ->
                    {
                        if (sectorRegistry.getSectorById(player.getSectorId()).isPresent())
                        {
                            final Sector sector = sectorRegistry.getSectorById(player.getSectorId()).get();
                            TeleportManeuver teleportManeuver = new TeleportManeuver(Vector3.zero());
                            sector.getCtx().users().getPlayerShipByUserID(player.getUserID())
                                    .ifPresent(ps -> ps.getMovementController().setNextManeuver(teleportManeuver));
                        }
                    }
                    case "kill_target" ->
                    {
                        final var optSector = this.sectorRegistry.getSectorById(player.getSectorId());
                        if (optSector.isEmpty())
                            return;
                        final var sector = optSector.get();
                        final var optShip = sector.getCtx().users().getPlayerShipByUserID(player.getUserID());
                        if (optShip.isEmpty())
                            return;
                        final var ship = optShip.get();
                        final Optional<AtomicLong> target = ship.getSpaceSubscribeInfo().getTargetObjectID();
                        if (target.isEmpty())
                            return;
                        final var targetObj = sector.getCtx().spaceObjects().get(target.get().get());
                        targetObj.ifPresent(obj -> sector.getSpaceObjectRemover().notifyRemovingCauseAdded(obj, RemovingCause.Death));
                    }
                    case "skill_learn" ->
                    {
                        final String skillIDStr = br.readString();
                        final int skillID = Integer.parseInt(skillIDStr);
                        playerProtocol.upgradeSkill(skillID);
                    }
                    case "skill_unlearn" ->
                    {
                        try
                        {
                            final String sillIDStr = br.readString();
                            final int skillID = Integer.parseInt(sillIDStr);
                            playerProtocol.resetSkill(skillID);
                        }
                        catch (Exception ex)
                        {
                            log.error("skillunlearn", ex);
                        }
                    }
                    case "set_speed" ->
                    {
                        final String speedStr = br.readString();
                        final float newSpeed = Float.parseFloat(speedStr);

                        final Optional<Sector> optCurrentSector = sectorRegistry.getSectorById(player.getSectorId());
                        if (optCurrentSector.isEmpty()) return;

                        final Sector currentSector = optCurrentSector.get();

                        final Optional<PlayerShip> optCurrentPlayerShip = currentSector.getCtx().users().getPlayerShipByUserID(player.getUserID());

                        if (optCurrentPlayerShip.isEmpty()) return;
                        final var currentPlayerShip = optCurrentPlayerShip.get();
                        currentPlayerShip.getMovementController().getMovementOptions().setSpeed(newSpeed);
                    }
                    case "emergency_server_shutdown" ->
                    {
                        try
                        {
                            final String rawTimeInMinutes = br.readString();
                            final int timeInMinutes = Integer.parseInt(rawTimeInMinutes);
                            final NotificationProtocol notificationProtocol = ctx.user().getProtocol(ProtocolID.Notification);
                            final BgoProtocolWriter bw = notificationProtocol.writer().writeEmergencyMessage("Shutdown", timeInMinutes);
                            for (User user1 : usersContainer.userList())
                            {
                                user1.send(bw);
                            }
                        }
                        catch (NumberFormatException numberFormatException)
                        {
                            log.error("emergency_server_shutdown", numberFormatException);
                        }
                    }
                    case "jumpNotification" ->
                    {
                        final String rawErrorSec = br.readString();
                        final String rawReason = br.readString();
                        final int errInt = Integer.parseInt(rawErrorSec);
                        final int reasonInt = Integer.parseInt(rawReason);

                        final JumpErrorSeverity jumpErrorSeverity = JumpErrorSeverity.forValue((byte) errInt);
                        final JumpErrorReason jumpErrorReason = JumpErrorReason.forValue((byte) reasonInt);
                        NotificationProtocol notificationProtocol = this.ctx.user().getProtocol(ProtocolID.Notification);
                        final BgoProtocolWriter bw = notificationProtocol.writer().writeJumpNotification(jumpErrorSeverity, jumpErrorReason);
                        ctx.user().send(bw);
                    }
                    case "stats_debug_dump" ->
                    {
                        final var optCurrentSector = sectorRegistry.getSectorById(player.getSectorId());
                        if (optCurrentSector.isEmpty()) return;
                        final var currentSector = optCurrentSector.get();
                        final var optShip = currentSector.getCtx().users().getPlayerShipByUserID(player.getUserID());
                        if (optShip.isEmpty()) return;
                        final PlayerShip currentShip = optShip.get();
                        log.warn("stats_debug_dump-> " + currentShip.getMovementController().getFrame());
                    }
                    case "remove_non_players" ->
                    {
                        final var optCurrentSector = sectorRegistry.getSectorById(player.getSectorId());
                        if (optCurrentSector.isEmpty()) return;

                        final Sector currentSector = optCurrentSector.get();
                        SectorUtils.removeAllNonPlayerObjects(currentSector);
                    }
                    case "update_my_group" ->
                    {
                        final String rawInt = br.readString();
                        final FactionGroup factionGroup = rawInt.equals("0") ? FactionGroup.Group0 : FactionGroup.Group1;
                        final var optSector = sectorRegistry.getSectorById(player.getSectorId());
                        if (optSector.isEmpty())return;
                        final var sector = optSector.get();
                        final var optShip = sector.getCtx().users().getPlayerShipByUserID(player.getUserID());
                        if (optShip.isEmpty())return;
                        final var ship = optShip.get();
                        GameProtocol gameProtocol = ctx.user().getProtocol(ProtocolID.Game);
                        ctx.user().send(gameProtocol.writer().writeUpdateFactionGroup(ship.getObjectID(), factionGroup));
                    }
                    case "randomTentacle" ->
                    {
                        final String rawSeed = br.readString();
                        final String rawrndFromCenter = br.readString();
                        final String rawasteroidCount = br.readString();
                        final String rawTentacleCount = br.readString();
                        final String rawAngleOffset = br.readString();

                        final long seed = Long.parseLong(rawSeed);
                        final long rndFromCenter = Long.parseLong(rawrndFromCenter);
                        final long asteroidCount = Long.parseLong(rawasteroidCount);
                        final long tentacleCount = Long.parseLong(rawTentacleCount);
                        final float angleOffset = Long.parseLong(rawAngleOffset);

                        final Optional<Sector> optionalSector = this.sectorRegistry.getSectorById(player.getSectorId());
                        if (optionalSector.isEmpty()) return;
                        final Sector sector = optionalSector.get();
                        final var generationUtils = this.sectorRegistry.getSectorRandomGenerationUtils();
                        TentacleCluster tentacleCluster = new TentacleCluster(
                                sector, new BgoRandom(seed),
                                rndFromCenter, asteroidCount, tentacleCount, angleOffset
                        );
                        generationUtils.buildRandomCreatable(sector, tentacleCluster);
                    }
                    case "randomRing" ->
                    {
                        try
                        {
                            final String rawSeed = br.readString();
                            final String rawrndFromCenter = br.readString();
                            final String rawasteroidCount = br.readString();
                            final String rawminDistance = br.readString();
                            final String rawmaxDistance = br.readString();
                            final String rawAngleOffset = br.readString();

                            final long seed = Long.parseLong(rawSeed);
                            final long rndFromCenter = Long.parseLong(rawrndFromCenter);
                            final long asteroidCount = Long.parseLong(rawasteroidCount);
                            final float minDistance = Long.parseLong(rawminDistance);
                            final float maxDistance = Long.parseLong(rawmaxDistance);
                            final float angleOffset = Long.parseLong(rawAngleOffset);

                            final Optional<Sector> optionalSector = this.sectorRegistry.getSectorById(player.getSectorId());
                            if (optionalSector.isEmpty()) return;
                            final Sector sector = optionalSector.get();
                            final var generationUtils = this.sectorRegistry.getSectorRandomGenerationUtils();
                            generationUtils.buildRandomRing(sector, new BgoRandom(seed),
                                    rndFromCenter, asteroidCount,
                                    minDistance, maxDistance, angleOffset);
                        }
                        catch (Exception ex)
                        {
                            log.error("random ring issue", ex);
                        }
                    }
                    case "randomSektor" ->
                    {
                        final String rawSeed = br.readString();
                        final String rawCountAsteroids = br.readString();
                        final String rawCountPlanetoids = br.readString();
                        final String rawCountFields = br.readString();
                        final String rawCountPerField = br.readString();
                        final String rawSizeField = br.readString();
                        final String rawLoopCount = br.readString();
                        final String rawLoopSize = br.readString();
                        final String rawLoopAsteroidCount = br.readString();

                        final long seed = Long.parseLong(rawSeed);
                        final long countAsteroids = Long.parseLong(rawCountAsteroids);
                        final long countPlanetoids = Long.parseLong(rawCountPlanetoids);
                        final long countFields = Long.parseLong(rawCountFields);
                        final long countAsteroidsPerField = Long.parseLong(rawCountPerField);
                        final long sizeField = Long.parseLong(rawSizeField);
                        final long loopCount = Long.parseLong(rawLoopCount);
                        final long loopSize = Long.parseLong(rawLoopSize);
                        final long loopAsteroidCount = Long.parseLong(rawLoopAsteroidCount);

                        BgoRandom rnd = new BgoRandom(seed);
                        final Optional<Sector> optionalSector = this.sectorRegistry.getSectorById(player.getSectorId());
                        if (optionalSector.isEmpty()) return;
                        final Sector sector = optionalSector.get();
                        final var generationUtils = this.sectorRegistry.getSectorRandomGenerationUtils();
                        generationUtils.buildRandomSectorSpaceObjects(sector, rnd,
                                countAsteroids, countPlanetoids,
                                countFields, countAsteroidsPerField, sizeField,
                                loopCount, loopSize, loopAsteroidCount);
                    }
                    case "remove_collisions" ->
                    {
                        final Optional<Sector> optionalSector = this.sectorRegistry.getSectorById(player.getSectorId());
                        if (optionalSector.isEmpty()) return;
                        final Sector sector = optionalSector.get();
                        SectorUtils.removeCollidingAsteroids2(sector);
                    }
                    case "loot_target" ->
                    {
                        var optSector = sectorRegistry.getSectorById(player.getSectorId());
                        if (optSector.isEmpty())return;
                        var sector = optSector.get();
                        var optShip = sector.getCtx().users().getPlayerShipByUserID(player.getUserID());
                        if (optShip.isEmpty())return;
                        var ship = optShip.get();
                        var targetID = ship.getSpaceSubscribeInfo().getTargetObjectID();
                        targetID.ifPresent(targetid ->
                                {
                                    var optTarget = sector.getCtx().spaceObjects().get(targetID.get().get());
                                    if (optTarget.isEmpty()) return;
                                    var target = optTarget.get();
                                    sector.getDamageMediator().dealDamage(new DamageRecord(ship, target, 999_999, false, sector.getCtx().tick().getTimeStamp()));
                                }
                        );
                    }
                    case "kill_all_water" ->
                    {
                        var optSector = sectorRegistry.getSectorById(player.getSectorId());
                        if (optSector.isEmpty())
                            return;
                        var sector = optSector.get();
                        var optShip = sector.getCtx().users().getPlayerShipByUserID(player.getUserID());
                        if (optShip.isEmpty())return;
                        var ship = optShip.get();
                        final List<Asteroid> asteroids = sector.getCtx().spaceObjects().getSpaceObjectsOfEntityType(SpaceEntityType.Asteroid);
                        for (Asteroid asteroid : asteroids)
                        {
                            final var optLoot = sector.getLootAssociations().get(asteroid);
                            if (optLoot.isEmpty())
                                continue;
                            final AsteroidLoot asteroidLoot = (AsteroidLoot) optLoot.get();
                            if (asteroidLoot.getRessource().getCardGuid() == ResourceType.Water.guid)
                            {
                                sector.getDamageMediator().dealDamage(new DamageRecord(ship, asteroid, 999_999, false, sector.getCtx().tick().getTimeStamp()));
                            }
                        }
                    }
                    case "kill_all_asteroids" ->
                    {
                        var optSector = sectorRegistry.getSectorById(player.getSectorId());
                        if (optSector.isEmpty())
                            return;
                        var sector = optSector.get();
                        var optShip = sector.getCtx().users().getPlayerShipByUserID(player.getUserID());
                        if (optShip.isEmpty())return;
                        var ship = optShip.get();
                        final List<Asteroid> asteroids = sector.getCtx().spaceObjects().getSpaceObjectsOfEntityType(SpaceEntityType.Asteroid);
                        for (Asteroid asteroid : asteroids)
                        {
                            final var optLoot = sector.getLootAssociations().get(asteroid);
                            if (optLoot.isEmpty())
                                continue;
                            sector.getDamageMediator().dealDamage(new DamageRecord(ship, asteroid, 999_999, false, sector.getCtx().tick().getTimeStamp()));
                        }
                    }
                    case "dump_resource_distribution" ->
                    {
                        var optSector = sectorRegistry.getSectorById(player.getSectorId());
                        if (optSector.isEmpty())
                            return;
                        final Sector sector = optSector.get();
                        final Optional<PlayerShip> optShip = sector.getCtx().users().getPlayerShipByUserID(player.getUserID());
                        if (optShip.isEmpty())
                            return;
                        final SpawnController spawnController = sector.getSpawnController();
                        final AsteroidResourceDistributionRecord currentDistribution = spawnController.getAsteroidDistribution();
                        final String formatedStr = String.format("resourceDump[%d] %s", sector.getId(), currentDistribution);
                        log.info(formatedStr);
                        sendEzMsg(formatedStr);
                    }
                    case "set_ancient_miningship" ->
                    {
                        var optSector = sectorRegistry.getSectorById(player.getSectorId());
                        if (optSector.isEmpty())
                            return;
                        final Sector sector = optSector.get();
                        final Optional<PlayerShip> optShip = sector.getCtx().users().getPlayerShipByUserID(player.getUserID());
                        if (optShip.isEmpty())
                            return;
                        var ship = optShip.get();
                        var optTargetId = ship.getSpaceSubscribeInfo().getTargetObjectID();
                        if (optTargetId.isEmpty())
                            return;
                        AtomicLong targetId = optTargetId.get();
                        Optional<SpaceObject> optTarget = sector.getCtx().spaceObjects().get(targetId.get());
                        if (optTarget.isEmpty())
                            return;
                        var target = optTarget.get();
                        final boolean isPlanetoid = target.getSpaceEntityType() == SpaceEntityType.Planetoid;
                        if (!isPlanetoid)
                            return;
                        sector.getCtx().spaceObjectFactory().createMiningShip(user(), (Planetoid) target);
                    }
                    case "template_from_sector" ->
                    {
                        final long sectorId = ctx.user().getPlayer().getLocation().getSectorID();
                        final Optional<Sector> optSector = sectorRegistry.getSectorById(sectorId);
                        if (optSector.isEmpty())
                        {
                            sendEzMsg("Cannot find sector!");
                        }
                    }
                    case "sector" ->
                    {
                        final String rawSectorID = br.readString();
                        final long targetSectorID = Long.parseLong(rawSectorID);

                        final Optional<Sector> optCurrentSector = this.sectorRegistry.getSectorById(player.getSectorId());
                        final Optional<Sector> optTargetSector = this.sectorRegistry.getSectorById(targetSectorID);
                        if (optCurrentSector.isEmpty() || optTargetSector.isEmpty())
                        {
                            log.error("sector is null");
                            return;
                        }

                        GameProtocol gameProtocol = ctx.user().getProtocol(ProtocolID.Game);
                        gameProtocol.jumpProcedure(optCurrentSector.get().getJumpRegistry(), optTargetSector.get().getId(), 1, false);
                    }

                    case "play_ship" ->
                    {
                        final String rawGUID = br.readString();
                        final long guid = Long.parseLong(rawGUID);
                        playerProtocol.addShip(guid);
                        for (HangarShip allHangarShip : player.getHangar().getAllHangarShips())
                        {
                            if (allHangarShip.getCardGuid() == guid)
                            {
                                playerProtocol.selectShip(allHangarShip.getServerId());
                            }
                        }
                    }
                    case "play_ship_remote" ->
                    {
                        try
                        {
                            final String playerName = br.readString();
                            final long guid = Long.parseLong(br.readString());

                            final var optUser = usersContainer.get(playerName);
                            if (optUser.isEmpty())
                            {
                                sendEzMsg("could not find playername");
                                return;
                            }
                            var otherUser = optUser.get();
                            PlayerProtocol otherPp = otherUser.getProtocol(ProtocolID.Player);
                            otherPp.addShip(guid);
                            for (HangarShip allHangarShip : otherUser.getPlayer().getHangar().getAllHangarShips())
                            {
                                if (allHangarShip.getCardGuid() == guid)
                                {
                                    otherPp.selectShip(allHangarShip.getServerId());
                                }
                            }
                        }
                        catch (Exception exception)
                        {
                            sendEzMsg(exception.getMessage());
                        }
                    }
                    case "spawn_comet" ->
                    {
                        if (!roles.hasRole(BgoAdminRoles.Developer))
                        {
                            return;
                        }
                        final Optional<Sector> optSector = this.sectorRegistry.getSectorById(this.ctx.user().getPlayer().getSectorId());
                        if (optSector.isEmpty()) return;
                        final Sector sector = optSector.get();
                        final Comet comet = sector.getCtx().spaceObjectFactory().createComet(23);
                        sector.getSectorJoinQueue().addSpaceObject(comet);
                    }
                    case "spawn_fog" ->
                    {
                        final Optional<Sector> optSector = this.sectorRegistry.getSectorById(this.ctx.user().getPlayer().getSectorId());
                        if (optSector.isEmpty()) return;
                        final Sector sector = optSector.get();
                        final DebrisPile debrisPile = sector.getCtx().spaceObjectFactory().createDebrisPile(16);
                        sector.getSectorJoinQueue().addSpaceObject(debrisPile);
                    }
                    case "spawn_guid_as_deb" ->
                    {
                        try
                        {
                            final long guid = parseStringAsLong(br);
                            final long yAxis = parseStringAsLong(br);
                            final Optional<Sector> optSector = this.sectorRegistry.getSectorById(this.ctx.user().getPlayer().getSectorId());
                            if (optSector.isEmpty()) return;
                            final Sector sector = optSector.get();

                            Vector3 pos = new Vector3(0, yAxis, 0);
                            Quaternion rot = new Euler3(0, 0, 0).quaternion();


                            var debris = sector.getCtx().spaceObjectFactory().createDebrisPile(guid, new Transform(pos, rot));
                            sector.getSectorJoinQueue().addSpaceObject(debris);
                        }catch (Exception ex)
                        {
                            sendEzMsg(ex.getMessage());
                        }
                    }
                    case "spawn_guid_as_planet" ->
                    {
                        try
                        {

                            final long guid = this.parseStringAsLong(br);

                            final long xAxis = this.parseStringAsLong(br);
                            final long yAxis = this.parseStringAsLong(br);
                            final long zAxis = this.parseStringAsLong(br);

                            final long pitch = this.parseStringAsLong(br);
                            final long yaw = this.parseStringAsLong(br);
                            final long roll = this.parseStringAsLong(br);

                            final Optional<Sector> optSector = this.sectorRegistry.getSectorById(this.ctx.user().getPlayer().getSectorId());
                            if (optSector.isEmpty()) return;
                            final Sector sector = optSector.get();

                            Vector3 pos = new Vector3(xAxis, yAxis, zAxis);
                            Quaternion rot = new Euler3(pitch, yaw, roll).quaternion();
                            var planet = sector.getCtx().spaceObjectFactory().createPlanet(guid, new Transform(pos, rot));
                            sector.getSectorJoinQueue().addSpaceObject(planet);
                        }catch (Exception ex)
                        {
                            sendEzMsg(ex.getMessage());
                        }
                    }
                    case "spawn_guid_as_comet" ->
                    {
                        try
                        {
                            final String rawGuid = br.readString();
                            final long guid = Long.parseLong(rawGuid);
                            final Optional<Sector> optSector = this.sectorRegistry.getSectorById(this.ctx.user().getPlayer().getSectorId());
                            if (optSector.isEmpty()) return;
                            final Sector sector = optSector.get();

                            var debris = sector.getCtx().spaceObjectFactory().createComet(guid, Transform.identity());
                            sector.getSectorJoinQueue().addSpaceObject(debris);
                        }catch (Exception ex)
                        {
                            sendEzMsg(ex.getMessage());
                        }
                    }
                    case "kill_all_debris" ->
                    {
                        final Optional<Sector> optSector = this.sectorRegistry.getSectorById(this.ctx.user().getPlayer().getSectorId());
                        if (optSector.isEmpty()) return;
                        final Sector sector = optSector.get();
                        for (SpaceObject debris : sector.getCtx().spaceObjects().getSpaceObjectsOfEntityType(SpaceEntityType.Debris))
                        {
                            sector.getSpaceObjectRemover().notifyRemovingCauseAdded(debris, RemovingCause.Death);
                        }
                    }
                    case "kill_all_planets" ->
                    {
                        final Optional<Sector> optSector = this.sectorRegistry.getSectorById(this.ctx.user().getPlayer().getSectorId());
                        if (optSector.isEmpty()) return;
                        final Sector sector = optSector.get();
                        for (SpaceObject debris : sector.getCtx().spaceObjects().getSpaceObjectsOfEntityType(SpaceEntityType.Planet))
                        {
                            sector.getSpaceObjectRemover().notifyRemovingCauseAdded(debris, RemovingCause.Death);
                        }
                    }
                    case "Reward_test" ->
                    {
                        List<ShipItem> shipItems = new ArrayList<>();
                        shipItems.add(ItemCountable.fromGUID(ResourceType.Cubits.guid, 100));
                        NotificationProtocolWriteOnly notificationProtocol = ProtocolRegistryWriteOnly.getProtocol(ProtocolID.Notification);
                        var bw = notificationProtocol.writeMissionReward(676816152L, shipItems);
                        ctx.user().send(bw);
                    }
                    case "messageAllRestart" ->
                    {
                        final BgoProtocolWriter serverRestartBw = writer.writeMessage("Server restart in a few minutes!");
                        for (final User usr : usersContainer.userList())
                        {
                            usr.send(serverRestartBw);
                        }
                    }

                    case "messageToAll" ->
                    {
                        final String msg = br.readString();
                        final BgoProtocolWriter serverRestartBw = writer.writeMessage(msg);
                        for (final User usr : usersContainer.userList())
                        {
                            usr.send(serverRestartBw);
                        }
                    }
                    case "system_by_guid" ->
                    {
                        try
                        {
                            final String playerName = br.readString();
                            final long itemGUID = this.parseStringAsLong(br);

                            final Optional<User> optUser = this.usersContainer.get(playerName);
                            if (optUser.isEmpty())
                            {
                                log.warn("Could not find user " + playerName);
                                return;
                            }
                            final User tmp = optUser.get();


                            final ShipSystem shipSystem = ShipSystem.fromGUID(itemGUID);

                            final Hold hold = tmp.getPlayer().getHold();
                            final HoldVisitor holdVisitor = new HoldVisitor(tmp, ctx.rng());
                            holdVisitor.addShipItem(shipSystem, hold);
                        } catch (Exception ex)
                        {
                            sendEzMsg(ex.getMessage());
                        }
                    }
                    case "system" ->
                    {
                        try
                        {
                            final String playerName = br.readString();
                            final long itemGUID = this.parseStringAsLong(br);
                            final long itemLevel = this.parseStringAsLong(br);

                            final Optional<User> optUser = this.usersContainer.get(playerName);
                            if (optUser.isEmpty())
                            {
                                log.warn("Could not find user " + playerName);
                                return;
                            }
                            final User tmp = optUser.get();

                            final Map<Byte, ShipSystemCard> allSystemCards = catalogue.fetchAllSystemCards(itemGUID);
                            final ShipSystemCard toFetchItem = allSystemCards.get((byte)itemLevel);
                            if (toFetchItem == null)
                            {
                                sendEzMsg("Error, toFetchItem was null!");
                                return;
                            }
                            final ShipSystem shipSystem = ShipSystem.fromGUID(toFetchItem.getCardGuid());

                            final Hold hold = tmp.getPlayer().getHold();
                            final HoldVisitor holdVisitor = new HoldVisitor(tmp, ctx.rng());
                            holdVisitor.addShipItem(shipSystem, hold);
                        } catch (Exception ex)
                        {
                            sendEzMsg(ex.getMessage());
                        }
                    }
                    case "consumable" ->
                    {
                        try
                        {
                            final String playerName = br.readString();
                            final long itemGUID = this.parseStringAsLong(br);
                            final long count = this.parseStringAsLong(br);


                            final Optional<User> optUser = this.usersContainer.get(playerName);
                            if (optUser.isEmpty())
                            {
                                log.warn("Could not find user " + playerName);
                                return;
                            }
                            final User tmp = optUser.get();

                            final ItemCountable countable = ItemCountable.fromGUID(itemGUID, count);

                            final Hold hold = tmp.getPlayer().getHold();
                            HoldVisitor holdVisitor = new HoldVisitor(tmp, ctx.rng());
                            holdVisitor.addShipItem(countable, hold);
                        } catch (Exception ex)
                        {
                            sendEzMsg(ex.getMessage());
                        }
                    }
                    case "refund_all_player" ->
                    {
                        final String rawLvl1Guid = br.readString();
                        try
                        {
                            final long lvl1Guid = Long.parseLong(rawLvl1Guid);
                            Map<Byte, Float> refund = refundProcessor.getSummedPriceForLevels(lvl1Guid);
                            sendEzMsg(refund.toString());


                            //final Map<Byte, Float> priceMapForEachLevelSummedToTheLevel = refundProcessor.overallProcess(lvl1Guid);

                        }
                        catch (Exception ex)
                        {
                            sendEzMsg(ex.getMessage());
                        }
                    }
                }
            }
            default -> log.error("DebugProtocol not implemented for type " + clientMessage);
        }
    }







    /** readString past the end of the console message throws; an Optional is the honest shape. */
    private Optional<String> tryReadString(final BgoProtocolReader br)
    {
        try
        {
            return Optional.of(br.readString());
        }
        catch (final Exception endOfMessage)
        {
            return Optional.empty();
        }
    }

    /** Run an action with the ship the operator is flying, or say why not. */
    private void withOwnShip(final java.util.function.Consumer<PlayerShip> action)
    {
        final Player player = ctx.user().getPlayer();
        sectorRegistry.getSectorById(player.getSectorId())
                .flatMap(sec -> sec.getCtx().users().getPlayerShipByUserID(player.getUserID()))
                .ifPresentOrElse(action, () -> sendEzMsg("no ship in space - undock first"));
    }

    /**
     * <ship> to guid. A number is taken as a guid directly; anything else is matched
     * case-insensitively against the GUI key of every Ship card (underscores and spaces
     * interchangeable). Hits on DIFFERENT keys are ambiguity the operator has to resolve, and
     * the candidates are printed. Hits sharing ONE key collapse by pickFromKeyFamily below.
     */
    private OptionalLong resolveShipToken(final String token)
    {
        try
        {
            final long guid = Long.parseLong(token);
            if (catalogue.fetchCard(guid, CardView.Ship).isPresent())
                return OptionalLong.of(guid);
            sendEzMsg("no Ship card at guid " + guid);
            return OptionalLong.empty();
        }
        catch (final NumberFormatException notANumber)
        {
            // fall through to name matching
        }
        final String needle = token.toLowerCase(Locale.ROOT).replace(' ', '_');
        final Map<String, List<Long>> keyToGuids = new TreeMap<>();
        for (final ShipCard shipCard : catalogue.<ShipCard>getAllCardsOfView(CardView.Ship))
        {
            final Optional<GuiCard> optGui = catalogue.fetchCard(shipCard.getCardGuid(), CardView.GUI);
            if (optGui.isEmpty())
                continue;
            final String key = optGui.get().getKey().toLowerCase(Locale.ROOT);
            if (!key.contains(needle))
                continue;
            keyToGuids.computeIfAbsent(key, k -> new ArrayList<>()).add(shipCard.getCardGuid());
        }
        if (keyToGuids.isEmpty())
        {
            sendEzMsg("no ship matches '" + token + "' - try list_ships " + token);
            return OptionalLong.empty();
        }
        if (keyToGuids.size() > 1)
        {
            final StringBuilder sb = new StringBuilder("ambiguous, matches:");
            keyToGuids.forEach((k, guids) -> sb.append('\n').append("  ").append(k)
                    .append(" (").append(pickFromKeyFamily(guids)).append(')'));
            sendEzMsg(sb);
            return OptionalLong.empty();
        }
        return OptionalLong.of(pickFromKeyFamily(keyToGuids.values().iterator().next()));
    }

    /**
     * One GUI key can cover several Ship guids, and they are not equals: 'cruiser_galactica' is
     * BOTH the flyable flagship (5019, armed via its ShipConfigTemplate) and the decorative gate
     * cruiser (29, no config, no drive) - the plain lowest-guid rule this replaced spawned the
     * statue. Prefer a guid a ShipConfigTemplate can arm; lowest guid only breaks the remaining
     * tie (grade families like enemy_cylon_raider pick their lowest CONFIGURED grade).
     */
    private static long pickFromKeyFamily(final List<Long> guids)
    {
        return guids.stream()
                .filter(g -> io.github.luigeneric.templates.shipconfigs.ShipConfigs.getFirstBestConfigForGUID(g).isPresent())
                .min(Long::compare)
                .orElseGet(() -> guids.stream().min(Long::compare).orElseThrow());
    }

    private void spawnNpcCommand(final BgoProtocolReader br) throws IOException
    {
        final String token = br.readString();
        final Optional<String> rawX = tryReadString(br);
        final Optional<String> rawY = tryReadString(br);
        final Optional<String> rawZ = tryReadString(br);
        final OptionalLong optGuid = resolveShipToken(token);
        if (optGuid.isEmpty())
            return;
        withOwnShip(ship ->
        {
            try
            {
                final float x = rawX.map(Float::parseFloat).orElse(0f);
                final float y = rawY.map(Float::parseFloat).orElse(0f);
                final float z = rawZ.map(Float::parseFloat).orElse(0f);
                spawnNpcAtOffset(ship, optGuid.getAsLong(), x, y, z, rawX.isEmpty() && rawY.isEmpty());
            }
            catch (final NumberFormatException nan)
            {
                sendEzMsg("spawn <ship> [x] [y] [z] - offsets must be numbers");
            }
        });
    }

    /**
     * Offsets are in the OPERATOR's ship frame - x right, y forward, z up - because "500 to my
     * left" is what a pilot means, not a world axis nobody can see. No offsets parks the NPC dead
     * ahead with both hulls' World-card radii of clearance, so a spawned capital cannot be born
     * inside your own collider.
     */
    private void spawnNpcAtOffset(final PlayerShip ship, final long guid,
                                  final float x, final float y, final float z, final boolean noOffsetsGiven)
    {
        final Optional<Sector> optSector = sectorRegistry.getSectorById(ctx.user().getPlayer().getSectorId());
        if (optSector.isEmpty())
            return;
        final Sector sector = optSector.get();

        final Optional<ShipCard> optShipCard = catalogue.fetchCard(guid, CardView.Ship);
        final Optional<WorldCard> optWorldCard = catalogue.fetchCard(guid, CardView.World);
        final Optional<GuiCard> optGuiCard = catalogue.fetchCard(guid, CardView.GUI);
        if (optShipCard.isEmpty() || optWorldCard.isEmpty())
        {
            sendEzMsg("guid " + guid + " is missing its Ship or World card");
            return;
        }
        final ShipCard shipCard = optShipCard.get();

        final Vector3 ownPos = ship.getMovementController().getPosition();
        final float clearance = ship.getWorldCard().getRadius() + optWorldCard.get().getRadius() + 200f;
        final Vector3 local = noOffsetsGiven ? new Vector3(0, 0, clearance) : new Vector3(x, z, y);
        final Vector3 spawnPos = Algorithm3D.getPointPositionRelativeTo(local,
                ownPos, ship.getMovementController().getRotation());
        // Nose towards the operator: if it is hostile it should already be committed to you.
        final Quaternion facing = Euler3.direction(Vector3.sub(ownPos, spawnPos)).quaternion();

        /* The same recipe DynamicNpcSpawn cooks for a wave bot: tier behaviour, a patrol box
         * around the spawn so it does not wander off, and the by-tier loot the sector waves pay.
         * One deliberate difference: no lifetime jump-out - a spawned sparring partner that
         * despawns mid-fight is a bug report waiting to happen. */
        /* speedZeroDistance is CENTER-to-center and the wave value (400) is sized for strikes -
         * a capital's own collider is bigger than that, so two spawned capitals drove into each
         * other before their hulls even counted as apart. Twice the bounding radius holds a
         * flagship pair around 1.8 km, inside the capital guns' 4.1 km envelope and under the
         * tier-4 auto-aggro of 2.5 km; strikes still get their 400 floor. */
        final float standoff = Math.max(400f, Math.min(2200f, optWorldCard.get().getRadius() * 2f));
        // Ten years of lifetime, not MAX_VALUE: a timer multiplying by 1000 must never overflow.
        final NpcBehaviourTemplate behaviour =
                NpcBehaviourTemplates.createTemplateForTier(shipCard.getTier(), 315_360_000L, false, standoff);
        final Vector3 boxHalf = new Vector3(2500, 2500, 2500);
        final PatrolObjective patrol = new PatrolObjective(0,
                new AABB(Vector3.sub(spawnPos, boxHalf), Vector3.add(spawnPos, boxHalf)));
        final long lootId = switch (shipCard.getTier())
        {
            case 2 -> 114L;
            case 3, 4 -> 116L;
            default -> 111L;
        };
        final BotFighterMoving bot = sector.getCtx().spaceObjectFactory().createBotFighter(
                guid, List.of(), List.of(), List.of(patrol),
                new Transform(spawnPos, facing), behaviour, lootId);
        sector.getSectorJoinQueue().addSpaceObject(bot);

        final String label = optGuiCard.map(GuiCard::getKey).orElse("guid " + guid);
        // The no-config path inside setupWeaponConfig is silent; the operator should not be.
        final boolean armed = io.github.luigeneric.templates.shipconfigs.ShipConfigs
                .getFirstBestConfigForGUID(guid).isPresent();
        sendEzMsg(String.format("spawned %s (%d, %s, t%d) at %.0f/%.0f/%.0f%s",
                label, guid, shipCard.getFaction(), shipCard.getTier(),
                spawnPos.getX(), spawnPos.getY(), spawnPos.getZ(),
                armed ? "" : " - UNARMED: no ShipConfigTemplate for this hull"));
    }

    private void spawnWing(final String token, final int count)
    {
        final OptionalLong optGuid = resolveShipToken(token);
        if (optGuid.isEmpty())
            return;
        withOwnShip(ship ->
        {
            final Optional<WorldCard> optWorldCard = catalogue.fetchCard(optGuid.getAsLong(), CardView.World);
            final float ring = ship.getWorldCard().getRadius()
                    + optWorldCard.map(WorldCard::getRadius).orElse(50f) + 400f;
            for (int i = 0; i < count; i++)
            {
                final double angle = (2 * Math.PI * i) / count;
                spawnNpcAtOffset(ship, optGuid.getAsLong(),
                        (float) (Math.sin(angle) * ring), (float) (Math.cos(angle) * ring), 0f, false);
            }
        });
    }

    private void listShips(final String filter)
    {
        final String needle = filter.toLowerCase(Locale.ROOT).replace(' ', '_');
        final Map<String, List<Long>> keyToGuids = new TreeMap<>();
        for (final ShipCard shipCard : catalogue.<ShipCard>getAllCardsOfView(CardView.Ship))
        {
            catalogue.<GuiCard>fetchCard(shipCard.getCardGuid(), CardView.GUI).ifPresent(g ->
            {
                final String key = g.getKey().toLowerCase(Locale.ROOT);
                if (key.contains(needle))
                    keyToGuids.computeIfAbsent(key, k -> new ArrayList<>()).add(shipCard.getCardGuid());
            });
        }
        final StringBuilder sb = new StringBuilder("spawnable (" + keyToGuids.size() + "):");
        int shown = 0;
        for (final Map.Entry<String, List<Long>> e : keyToGuids.entrySet())
        {
            if (++shown > 40)
            {
                sb.append("\n  ... +").append(keyToGuids.size() - 40).append(" more, narrow the filter");
                break;
            }
            final long pick = pickFromKeyFamily(e.getValue());
            final boolean armed = io.github.luigeneric.templates.shipconfigs.ShipConfigs
                    .getFirstBestConfigForGUID(pick).isPresent();
            sb.append('\n').append("  ").append(e.getKey()).append(" (").append(pick)
                    .append(armed ? ", armed)" : ", UNARMED)");
        }
        sendEzMsg(sb);
    }

    private void godMode(final boolean enable)
    {
        withOwnShip(ship ->
        {
            final var stats = ship.getSpaceSubscribeInfo();
            if (enable)
            {
                stats.setStat(ObjectStat.MaxHullPoints, 1_000_000_000f);
                stats.setStat(ObjectStat.MaxPowerPoints, 1_000_000_000f);
                stats.setHp(1_000_000_000f);
                stats.setPp(1_000_000_000f);
                sendEzMsg("god mode ON (live ship only - dock or relog and it is gone)");
            }
            else
            {
                /* The live SpaceSubscribeInfo IS the hangar ship's stats object, so recomputing
                 * from the cards puts every buffed stat back exactly - the same call the rental
                 * arm path leans on. */
                ctx.user().getPlayer().getHangar().getActiveShip().getShipStats().applyStats();
                final float maxHp = stats.getStatOrDefault(ObjectStat.MaxHullPoints);
                final float maxPp = stats.getStatOrDefault(ObjectStat.MaxPowerPoints);
                stats.setHp(Math.min(stats.getHp(), maxHp));
                stats.setPp(Math.min(stats.getPp(), maxPp));
                sendEzMsg("god mode OFF - stats recomputed from the hangar card");
            }
        });
    }

    private void killAllNpcs()
    {
        final Optional<Sector> optSector = sectorRegistry.getSectorById(ctx.user().getPlayer().getSectorId());
        if (optSector.isEmpty())
            return;
        final Sector sector = optSector.get();
        int removed = 0;
        for (final SpaceObject npc : sector.getCtx().spaceObjects()
                .getSpaceObjectsOfEntityType(SpaceEntityType.BotFighter))
        {
            sector.getSpaceObjectRemover().notifyRemovingCauseAdded(npc, RemovingCause.Death);
            removed++;
        }
        sendEzMsg("removed " + removed + " NPC fighter(s) - the sector's own timers will respawn their waves");
    }

    private void teleportTo(final Vector3 destination)
    {
        withOwnShip(ship ->
        {
            ship.getMovementController().setNextManeuver(new TeleportManeuver(destination));
            sendEzMsg(String.format("teleport to %.0f/%.0f/%.0f",
                    destination.getX(), destination.getY(), destination.getZ()));
        });
    }

    private void teleportToTarget()
    {
        final Optional<Sector> optSector = sectorRegistry.getSectorById(ctx.user().getPlayer().getSectorId());
        if (optSector.isEmpty())
            return;
        final Sector sector = optSector.get();
        withOwnShip(ship ->
        {
            final Optional<AtomicLong> optTargetId = ship.getSpaceSubscribeInfo().getTargetObjectID();
            if (optTargetId.isEmpty())
            {
                sendEzMsg("tp_target: select a target first");
                return;
            }
            final Optional<SpaceObject> optTarget = sector.getCtx().spaceObjects().get(optTargetId.get().get());
            if (optTarget.isEmpty())
            {
                sendEzMsg("tp_target: target is gone");
                return;
            }
            final SpaceObject target = optTarget.get();
            final Vector3 targetPos = target.getMovementController().getPosition();
            final Vector3 ownPos = ship.getMovementController().getPosition();
            final Vector3 back = Vector3.sub(ownPos, targetPos);
            final float distance = back.magnitude();
            final float keep = ship.getWorldCard().getRadius() + target.getWorldCard().getRadius() + 300f;
            // Arrive on your current bearing, radii + 300 short of the hull - not inside it.
            final Vector3 destination = distance < 1f
                    ? Vector3.add(targetPos, new Vector3(0, 0, keep))
                    : Vector3.add(targetPos, Vector3.mult(back, keep / distance));
            ship.getMovementController().setNextManeuver(new TeleportManeuver(destination));
            sendEzMsg("teleported to target " + target.getObjectID());
        });
    }

    private void spawnMissileFromTarget()
    {
        final Optional<Sector> optSector = sectorRegistry.getSectorById(ctx.user().getPlayer().getSectorId());
        if (optSector.isEmpty())
            return;
        final Sector sector = optSector.get();
        withOwnShip(ship ->
        {
            final Optional<AtomicLong> optTargetId = ship.getSpaceSubscribeInfo().getTargetObjectID();
            final Optional<SpaceObject> optTarget = optTargetId
                    .flatMap(id -> sector.getCtx().spaceObjects().get(id.get()));
            if (optTarget.isEmpty() || !(optTarget.get() instanceof Ship caster))
            {
                sendEzMsg("spawn_missile: select the SHIP that should fire at you");
                return;
            }
            final SpotDesc[] spots = caster.getWorldCard().getSpots();
            if (spots.length == 0)
            {
                sendEzMsg("spawn_missile: that hull has no spots to launch from");
                return;
            }
            final SpaceObject missile = sector.getCtx().spaceObjectFactory().createMissile(
                    caster, ship, spots[0], StaticCardGUID.MissileCard.getValue(),
                    sector.getCtx().tick().getTimeStamp());
            /* The stats a launcher's ItemBuffAdd would have contributed, at the values the
             * outpost round flies with post-retune - this exists to give flak and the missile
             * bracket something honest to intercept. */
            final var stats = missile.getSpaceSubscribeInfo().getStats();
            stats.setStat(ObjectStat.Speed, 120f);
            stats.setStat(ObjectStat.MaxHullPoints, 200f);
            stats.setStat(ObjectStat.LifeTime, 90f);
            stats.setStat(ObjectStat.DamageLow, 55f);
            stats.setStat(ObjectStat.DamageHigh, 150f);
            stats.setStat(ObjectStat.Avoidance, 650f);
            missile.getMovementController().getMovementOptions().setGear(Gear.Regular);
            missile.getMovementController().getMovementOptions().setThrottleSpeed(120f);
            missile.getSpaceSubscribeInfo().setMaxHpPp();
            missile.getMovementController().setNextManeuver(
                    new TargetLaunchManeuver(caster, spots[0], 0f, ship));
            sector.getSectorJoinQueue().addSpaceObject(missile);
            sendEzMsg("missile away from " + caster.getObjectID() + " - it is homing on YOU");
        });
    }

    private void selfBuff(final String type, final Player player)
    {
        final Optional<Sector> optSector = sectorRegistry.getSectorById(player.getSectorId());
        if (optSector.isEmpty())
            return;
        final Sector currentSector = optSector.get();
        final var optShip = currentSector.getCtx().users().getPlayerShipByUserID(player.getUserID());
        if (optShip.isEmpty())
            return;
        final var ship = optShip.get();

        switch (type)
        {
            case "speed" ->
            {
                final Vector3 direction = ship.getMovementController().getRotation().direction();
                direction.mult(400);
                ship.getMovementController().setNextManeuver(new PulseManeuver(direction));
            }
            // The panel's Heal button sends self_buff heal, the console's own heal is the same act.
            case "heal" ->
            {
                final var stats = ship.getSpaceSubscribeInfo();
                stats.setHp(stats.getStatOrDefault(ObjectStat.MaxHullPoints));
                stats.setPp(stats.getStatOrDefault(ObjectStat.MaxPowerPoints));
                this.sendEzMsg("healed");
            }
            /* Live-ship only, like push and god_mode: the doubled maximum vanishes on dock/relog
             * because the hangar recomputes stats from the cards. */
            case "hp" ->
            {
                final var stats = ship.getSpaceSubscribeInfo();
                final float doubled = stats.getStatOrDefault(ObjectStat.MaxHullPoints) * 2f;
                stats.setStat(ObjectStat.MaxHullPoints, doubled);
                stats.setHp(doubled);
                this.sendEzMsg(String.format("max hull doubled to %.0f", doubled));
            }
            case "dmg" -> this.sendEzMsg(
                    "self_buff dmg: not implemented - damage lives on the ability cards, and those are " +
                    "shared templates a buff would poison for every ship that fires the same weapon");
            default -> this.sendEzMsg("Dev Buf " + type + " not implemented!");
        }
    }

    /**
     * Two shapes reach this handler and both have to work:
     *   resource <type> <amount> [...]        - the console and the panel's self buttons; the
     *                                           panel appends two "false" strings nothing reads.
     *   resource <player> <typeOrGuid> <amount> - the panel's Give Resource button, which the old
     *                                           two-read parser silently misread as (type, amount)
     *                                           and dropped on the floor.
     * A first argument that names a connected player selects the targeted shape; everything else
     * is the classic self shape.
     */
    private void addResources(final BgoProtocolReader br) throws IOException
    {
        final String first = br.readString();
        final Optional<User> optTargetUser = usersContainer.get(first);
        final User receiver;
        final String rawType;
        if (optTargetUser.isPresent())
        {
            receiver = optTargetUser.get();
            rawType = br.readString();
        }
        else
        {
            receiver = user();
            rawType = first;
        }
        final String rawAmount = br.readString();
        try
        {
            final long amount = Long.parseLong(rawAmount);
            final long guid = switch (rawType)
            {
                case "resource_cubits", "cubits" -> ResourceType.Cubits.guid;
                case "resource_tylium", "tylium" -> ResourceType.Tylium.guid;
                case "resource_titanium", "titanium" -> ResourceType.Titanium.guid;
                case "resource_water", "water" -> ResourceType.Water.guid;
                case "resource_token", "token" -> ResourceType.Token.guid;
                // The panel's Give Resource sends a raw guid, not a keyword.
                default -> Long.parseLong(rawType);
            };
            final ShopVisitor shopVisitor = new ShopVisitor(receiver, null, ctx.rng());
            shopVisitor.addShipItem(ItemCountable.fromGUID(guid, amount), receiver.getPlayer().getHold());
            sendEzMsg("gave " + amount + " of " + rawType + " to " + receiver.getPlayer().getName());
        }
        catch (final NumberFormatException e)
        {
            sendEzMsg("resource <type|guid> <amount>  or  resource <player> <type|guid> <amount>");
        }
    }

    private void scanAll(final User usr)
    {
        final Player player = usr.getPlayer();
        final Optional<Sector> optCurrentSector = this.sectorRegistry.getSectorById(player.getSectorId());
        if (optCurrentSector.isEmpty()) return;
        final Sector currentSector = optCurrentSector.get();
        final GameProtocol gameProtocol = usr.getProtocol(ProtocolID.Game);
        final Optional<PlayerShip> optPlayerShip = currentSector.getCtx().users().getPlayerShipByUserID(player.getUserID());
        if (optPlayerShip.isEmpty()) return;
        final List<SpaceObject> allAsteroids = currentSector
                .getCtx().spaceObjects().getSpaceObjectsOfEntityTypes(SpaceEntityType.Planetoid, SpaceEntityType.Asteroid);
        for (SpaceObject astro : allAsteroids)
        {
            ResourceScanAction.scanProcess(
                    usr,
                    gameProtocol,
                    astro,
                    currentSector.getLootAssociations(),
                    0,
                    currentSector.getCtx().sender(),
                    currentSector.getCtx().blueprint().sectorCards().sectorCard(),
                    currentSector.getId()
            )
            ;
        }
    }

    private void addExperience(final long exp, final PlayerProtocol playerProtocol)
    {
        playerProtocol.addExperience(exp);
    }

    private void sendTotalPlayersNames()
    {
        final List<String> colonials = this.usersContainer.userList()
                .stream()
                .filter(usr -> usr.getConnection().isPresent())
                .filter(usr -> usr.getPlayer().getFaction() == Faction.Colonial)
                .map(usr -> usr.getPlayer().getName() + "/" + usr.getPlayer().getLocation().getSectorID())
                .toList();

        final List<String> cylons = this.usersContainer.userList()
                .stream()
                .filter(usr -> usr.getConnection().isPresent())
                .filter(usr -> usr.getPlayer().getFaction() == Faction.Cylon)
                .map(usr -> usr.getPlayer().getName() + "/" + usr.getPlayer().getLocation().getSectorID())
                .toList();
        final StringBuilder sb = new StringBuilder();
        sb
                .append('\n')
                .append("Colonials: ")
                .append(colonials)
                .append('\n')
                .append("Cylons: ")
                .append(cylons);
        ctx.user().send(writer.writeCommand(sb));
    }
    private void sendTotalSectorDistr()
    {
        StringBuilder sb = new StringBuilder("SectorTotalDistribution");
        for (Sector sector : sectorRegistry.getSectors())
        {
            final Map<Faction, List<User>> usersInSector = sector.getCtx().users().getUsersCollection()
                    .stream()
                    .filter(User::isConnected)
                    .collect(Collectors.groupingBy((user1 -> user1.getPlayer().getFaction())));
            int coloSize = usersInSector.get(Faction.Colonial) == null ? 0 : usersInSector.get(Faction.Colonial).size();
            int cyloSoze = usersInSector.get(Faction.Cylon) == null ? 0 : usersInSector.get(Faction.Cylon).size();
            sb
                    .append('\n')
                    .append("SectorID ").append(sector.getId())
                    .append(" colonials ").append(coloSize)
                    .append(" cylons ").append(cyloSoze);
        }
        ctx.user().send(writer.writeCommand(sb));
    }

    private long parseStringAsLong(final BgoProtocolReader br) throws IOException, NumberFormatException
    {
        final String raw = br.readString();
        return Long.parseLong(raw);
    }
    private void sendTotalPlayers()
    {
        final long connectedCount = this.usersContainer.userList()
                .stream()
                .filter(usr -> usr.getConnection().isPresent())
                .count();
        final long connectedColonials = this.usersContainer.userList()
                .stream()
                .filter(usr -> usr.getConnection().isPresent())
                .filter(usr -> usr.getPlayer().getFaction() == Faction.Colonial)
                .count();
        final long connectedCylons = this.usersContainer.userList()
                .stream()
                .filter(usr -> usr.getConnection().isPresent())
                .filter(usr -> usr.getPlayer().getFaction() == Faction.Cylon)
                .count();
        final String msg = "current playerCount: " + connectedCount + " colonial: " + connectedColonials + " cylons: " + connectedCylons;
        ctx.user().send(writer.writeCommand(msg));
    }


    public void sendEzMsg(final CharSequence charSequence)
    {
        this.ctx.user().send(writer.writeMessage(charSequence));
    }

    enum ClientMessage
    {
        Command(1),
        Activity(12),
        ProcessState(14),
        UpgradeSystem(17);

        private final int intValue;

        private static final class MappingsHolder
        {
            private static final Map<Integer, ClientMessage> mappings = new HashMap<>();
        }

        private static Map<Integer, ClientMessage> getMappings()
        {
            return MappingsHolder.mappings;
        }

        ClientMessage(final int value)
        {
            intValue = value;
            getMappings().put(value, this);
        }

        public int getValue()
        {
            return intValue;
        }

        public static ClientMessage forValue(int value)
        {
            return getMappings().get(value);
        }
    }


}
