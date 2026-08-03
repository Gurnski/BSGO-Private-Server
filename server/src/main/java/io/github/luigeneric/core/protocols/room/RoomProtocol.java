package io.github.luigeneric.core.protocols.room;


import io.github.luigeneric.binaryreaderwriter.BgoProtocolReader;
import io.github.luigeneric.binaryreaderwriter.BgoProtocolWriter;
import io.github.luigeneric.core.ProtocolContext;
import io.github.luigeneric.core.player.location.Location;
import io.github.luigeneric.core.player.location.SpaceLocation;
import io.github.luigeneric.core.protocols.BgoProtocol;
import io.github.luigeneric.core.protocols.ProtocolID;
import io.github.luigeneric.core.protocols.dialog.DialogProtocol;
import io.github.luigeneric.core.protocols.dialog.Remark;
import io.github.luigeneric.core.protocols.scene.SceneProtocol;
import io.github.luigeneric.enums.GameLocation;
import io.github.luigeneric.templates.startupconfig.GameServerParamsConfig;
import lombok.extern.slf4j.Slf4j;

import java.io.IOException;
import java.util.Objects;
import java.util.Set;

@Slf4j
public class RoomProtocol extends BgoProtocol
{
    private static final Set<String> ACTIVE_NPCS =
            Set.of("Apollo", "Adama", "Tyrol", "Starbuck",     // scene_human_cic
                   "Leoben", "No1", "No6", "Sharon",           // scene_cylon_cic (Sharon also cylon outpost)
                   "Officer");                                 // scene_human_outpost

    public RoomProtocol(final ProtocolContext ctx)
    {
        super(ProtocolID.Room, ctx);
    }

    @Override
    public void parseMessage(final int msgType, final BgoProtocolReader br) throws IOException
    {
        final ClientMessage clientMessage =
                Objects.requireNonNull(ClientMessage.valueOf(msgType), "ClientMessage was " + msgType);

        final SceneProtocol sceneProtocol = user().getProtocol(ProtocolID.Scene);
        switch (clientMessage)
        {
            case Talk ->
            {
                final String npc = br.readString();
                log.info("User requested talk to npc {}", npc);
                /* Every character the room scenes actually offer, not just the two the CIC cards
                 * used to list. The names come from each bundle's camerabox_<name> objects, which
                 * are what DialogCharacterInfo resolves against, so this set matches the Room
                 * cards exactly: the CICs hold Apollo/Adama/Tyrol/Starbuck and
                 * Leoben/No1/No6/Sharon, and the outpost hangars hold Officer (Colonial
                 * quartermaster) and Sharon. Anything else is a crafted packet: the client can
                 * only click an NPCArea built from the Room card we sent it. */
                final boolean npcActivated = ACTIVE_NPCS.contains(npc);
                if (!npcActivated)
                    return;

                //Log.infoIn("Talk: " + npc);
                user().send(writeTalk(npc));
                /* Hand the dialogue its speaker before the greeting goes out: which options the
                 * player is offered depends on who is being talked to, and only the flagship
                 * officer (Adama / Number One) may authorise a capital. */
                final DialogProtocol dialogProtocol = user().getProtocol(ProtocolID.Dialog);
                dialogProtocol.beginDialog(npc);
                user().send(dialogProtocol.writeNpcRemark(
                        new Remark((byte) 1, dialogProtocol.greetingFor(npc), "")));
            }
            case Quit ->
            {
                if (user().getPlayer().getLocation().getGameLocation() != GameLocation.Room)
                {
                    log.error("RoomProtocol, quit while not in room! " + user().getPlayer().getLocation().getGameLocation() + " " +
                            user().getPlayer().getPlayerLog());
                    return;
                }

                log.info("User requested RoomProtocol quit");
                try
                {
                    var ship = user().getPlayer().getHangar().getActiveShip();
                    if (ship.getShipStats().getHp() == 0)
                        ship.getShipStats().setHp(1);
                }
                catch (Exception exception)
                {
                    log.error("Uncaught exception", exception);
                }

                final Location location = user().getPlayer().getLocation();
                location.changeState(new SpaceLocation(location));
                sceneProtocol.sendLoadNextScene();
            }
            case Enter ->
            {
                //Log.infoIn("ENTERING ROOM");
            }
            default -> log.warn("RoomProtocol not implemented: " + msgType);
        }
    }

    public BgoProtocolWriter writeTalk(final String npc)
    {
        final BgoProtocolWriter bw = newMessage();
        bw.writeMsgType(ServerMessage.Talk.value);

        bw.writeString(npc);

        return bw;
    }

}
