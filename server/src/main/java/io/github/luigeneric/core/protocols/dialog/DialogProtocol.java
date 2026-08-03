package io.github.luigeneric.core.protocols.dialog;

import io.github.luigeneric.binaryreaderwriter.BgoProtocolReader;
import io.github.luigeneric.binaryreaderwriter.BgoProtocolWriter;
import io.github.luigeneric.core.ProtocolContext;
import io.github.luigeneric.core.User;
import io.github.luigeneric.core.galaxy.Galaxy;
import io.github.luigeneric.core.player.Player;
import io.github.luigeneric.core.protocols.BgoProtocol;
import io.github.luigeneric.core.protocols.ProtocolID;
import io.github.luigeneric.core.protocols.ProtocolRegistryWriteOnly;
import io.github.luigeneric.core.player.container.visitors.ContainerVisitor;
import io.github.luigeneric.core.player.container.visitors.ShopVisitor;
import io.github.luigeneric.templates.utils.Price;
import io.github.luigeneric.enums.ResourceType;
import io.github.luigeneric.templates.shipitems.ItemCountable;
import io.github.luigeneric.core.protocols.player.CapitalRental;
import io.github.luigeneric.core.protocols.player.PlayerProtocol;
import io.github.luigeneric.core.protocols.player.PlayerProtocolWriteOnly;
import io.github.luigeneric.enums.Faction;
import io.github.luigeneric.templates.cards.CardView;
import io.github.luigeneric.templates.cards.ShipCard;
import io.github.luigeneric.templates.catalogue.Catalogue;
import jakarta.enterprise.inject.spi.CDI;
import io.github.luigeneric.utils.BgoRandom;
import lombok.extern.slf4j.Slf4j;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Set;
import java.util.List;

@Slf4j
public class DialogProtocol extends BgoProtocol
{
    /* Phrase ids from the original game's own dialogue, which is still in the client's locale
     * bundle. The client resolves "%$bgo.<key>.Phrase__<uuid>__<n>%" and substitutes
     * %CapShipCost% from the conquest price the galaxy update carries (Gui/Tools.cs:118), so the
     * merit cost in these lines is the live rental price without the server formatting anything.
     *
     * Colonial: Admiral Adama authorises the Pegasus. Cylon: Number One authorises the Basestar.
     * Both trees are the same shape - a root menu, a grant-or-refuse line, then a confirm - which
     * is why one state machine drives both from a small table. */
    private static final String ADAMA = "%$bgo.npc_adama.Phrase__";
    private static final String NO1 = "%$bgo.npc_no1.Phrase__";
    // greeting, "get assignments", "request the flagship", "nothing right now"
    private static final String[] COL_ROOT = {
            ADAMA + "5d4a7e64-abb7-4093-9fd4-149ee54b1237__0%",
            ADAMA + "35a28c51-21f0-4ade-b97e-c01f6d85cbce__0%",
            ADAMA + "35a28c51-21f0-4ade-b97e-c01f6d85cbce__1%",
            ADAMA + "35a28c51-21f0-4ade-b97e-c01f6d85cbce__3%",
    };
    private static final String[] CYL_ROOT = {
            NO1 + "e4896283-ffab-4f79-855e-62375d3c7381__0%",
            NO1 + "03500444-5ae8-473f-a6e8-c8cc14a6ec37__0%",
            NO1 + "03500444-5ae8-473f-a6e8-c8cc14a6ec37__1%",
            NO1 + "03500444-5ae8-473f-a6e8-c8cc14a6ec37__3%",
    };
    // the officer's answer to the request, then confirm / cancel / cannot-afford
    private static final String[] COL_RENT = {
            ADAMA + "cc0d3112-1e80-4db8-b9f8-74efa760fa6d__2%",
            ADAMA + "a5d4cc23-3544-4cfc-bf2d-fdb45dcddf8b__0%",
            ADAMA + "a5d4cc23-3544-4cfc-bf2d-fdb45dcddf8b__1%",
            ADAMA + "ac043882-f184-4036-a8f4-2a0abc98d4db__0%",
    };
    private static final String[] CYL_RENT = {
            NO1 + "17772a8a-7a05-44c4-aad5-70f5178f7c35__2%",
            NO1 + "ea96bd28-35c9-4f72-8da6-119651e68906__0%",
            NO1 + "ea96bd28-35c9-4f72-8da6-119651e68906__1%",
            NO1 + "7cad2019-637f-4880-b0ed-8fb629c7890d__0%",
    };
    /* Everyone else keeps the assignments-only menu the room dialogue had before. The phrase is
     * Number Two's, but it is faction-neutral text ("Request objectives update.") and the client
     * renders whatever we hand it under the NPC's own name. */
    private static final String GENERIC_GREETING = "%$bgo.npc_no8.Phrase__2382939f-71b5-4822-8549-a64bd9f47a6d__0%";
    private static final String GENERIC_ASSIGNMENTS = "%$bgo.npc_no2.Phrase__04a77746-d78a-4e4e-98bf-68f988d63b0e__0%";

    /* Which figure in the room may authorise a flagship. In the original the Pegasus was Adama's
     * to give and the Basestar was Cavil's, so the outpost quartermasters deliberately do not
     * offer it - the trip to the home CIC is the point. */
    private static final String COLONIAL_CAPITAL_NPC = "Adama";
    private static final String CYLON_CAPITAL_NPC = "No1";

    /* Water for cubits, on exactly the four the original used (research/bsgo_wiki/Water.txt:8-17):
     * Starbuck aboard the Galactica and any outpost Quartermaster for the Colonials, Number Six
     * aboard the Basestar and any outpost Number Eight for the Cylons. Mining is the only source
     * of water and this is the only sink, so it is also the only cubit faucet a pilot controls.
     * One phrase set per faction rather than per NPC: the text is written for a quartermaster
     * ("the fleet stores" / "Basestar reserves") and reads correctly under any of the four, and
     * the client renders it beneath whichever NPC is speaking. */
    private static final Set<String> WATER_NPCS = Set.of("Starbuck", "Officer", "No6", "Sharon");
    private static final String HOUTP = "%$bgo.npc_humanoutpost.Phrase__";
    private static final String COUTP = "%$bgo.npc_no8outpost.Phrase__";
    // offer, status, confirm, decline, receipt
    private static final String[] COL_WATER = {
            HOUTP + "03a56dc5-4957-4edc-a10c-b6c0523f0812__2%",
            HOUTP + "e8a0b80c-519a-49d9-9e13-2092811c9962__0%",
            HOUTP + "d0ce0e14-9911-4829-8337-5d16b8b7ca38__0%",
            HOUTP + "d0ce0e14-9911-4829-8337-5d16b8b7ca38__1%",
            HOUTP + "4397dd12-e774-4c64-87c1-e8948e9de08f__0%",
    };
    private static final String[] CYL_WATER = {
            COUTP + "35611029-6746-4055-ab2e-5790355e4833__2%",
            COUTP + "f3344f17-0f77-4c81-95ea-7ecf47f9602c__0%",
            COUTP + "63ea0e17-65b0-4a60-b8de-bf042c9ca655__0%",
            COUTP + "63ea0e17-65b0-4a60-b8de-bf042c9ca655__1%",
            COUTP + "6e7d86ec-a2c3-4b9a-8f60-b531149feb50__0%",
    };
    /* 5 water buys 1 cubit, the original's rate (research/bsgo_wiki/Water.txt:6).
     * The original also capped the exchange at 280,000 water a week (:18) - a throttle on the
     * live game's only cubit faucet, aimed at an economy with a cash shop behind it. This is a
     * private server with neither, so the cap is deliberately NOT implemented: mine as much ice
     * as you like. Keeping it uncapped also keeps the exchange stateless, which matters more than
     * it sounds - a weekly ledger would need a persisted counter, and counters are dropped at
     * load unless a Counter card backs the guid (Counters.injectOldCounters), the same trap that
     * made the first capital rental evaporate on every relog. */
    public static final int WATER_PER_CUBIT = 5;

    private static final byte SAY_ASSIGNMENTS = 1;
    private static final byte SAY_REQUEST_CAPITAL = 2;
    private static final byte SAY_LEAVE = 3;
    private static final byte SAY_CONFIRM_CAPITAL = 4;
    private static final byte SAY_WATER = 5;
    private static final byte SAY_CONFIRM_WATER = 6;
    private static final byte SAY_REQUEST_FLAGSHIP = 7;

    /* The flagship request has no line of its own: the original never let anyone fly the
     * Galactica or the Guardian, so no phrase for them was ever written. The ship NAME does
     * exist, and the client resolves %$bgo.<key>.Name% tokens anywhere inside a phrase (the
     * shipped lines interpolate %Rank% and %CapShipCost% the same way), so the menu entry is
     * built around the client's own name for the hull rather than a string we invented. */
    private static final String COL_FLAGSHIP_REQUEST =
            "Requesting temporary command of the %$bgo.cruiser_galactica.Name%, sir. [Command Battlestar]";
    private static final String CYL_FLAGSHIP_REQUEST =
            "Request %$bgo.ship_basestar_guardian.Name% command access [Command Basestar]";

    /** Which capital the pilot asked for, so the confirmation rents the one they chose. */
    private long pendingCapital;

    private enum Stage { ROOT, CONFIRM_CAPITAL, CONFIRM_WATER }

    private long pendingWater;
    private long pendingCubits;

    private MissionDistributor missionDistributor;
    /** The room NPC this dialogue is with; RoomProtocol sets it when the talk request lands. */
    private String currentNpc = "";
    private Stage stage = Stage.ROOT;

    public DialogProtocol(ProtocolContext ctx)
    {
        super(ProtocolID.Dialog, ctx);
    }

    @Override
    public void injectUser(User user)
    {
        super.injectUser(user);
        this.missionDistributor = new MissionDistributor(user().getPlayer(), ctx.galaxy(), ctx.rng());
    }

    /** Called by RoomProtocol when the player clicks an NPC, before the greeting goes out. */
    public void beginDialog(final String npc)
    {
        this.currentNpc = npc == null ? "" : npc;
        this.stage = Stage.ROOT;
    }

    private boolean isColonial()
    {
        return user().getPlayer().getFaction() == Faction.Colonial;
    }

    /** True when the NPC in front of the player is the one who authorises their faction's capital. */
    private boolean npcGrantsCapital()
    {
        return currentNpc.equals(isColonial() ? COLONIAL_CAPITAL_NPC : CYLON_CAPITAL_NPC);
    }

    private long capitalPrice()
    {
        return CapitalRental.priceFor(user().getPlayer().getFaction(), CDI.current().select(Galaxy.class).get());
    }

    private boolean canAffordCapital()
    {
        return ContainerVisitor.isEnoughInContainer(
                new Price(ResourceType.Token, capitalPrice()), user().getPlayer().getHold(), 1);
    }

    public String greetingFor(final String npc)
    {
        if (npc.equals(COLONIAL_CAPITAL_NPC)) return COL_ROOT[0];
        if (npc.equals(CYLON_CAPITAL_NPC)) return CYL_ROOT[0];
        return GENERIC_GREETING;
    }

    @Override
    public void parseMessage(final int msgType, final BgoProtocolReader br) throws IOException
    {
        final ClientMessage clientMessage = ClientMessage.forValue(msgType);
        if (clientMessage == null)
            return;

        switch (clientMessage)
        {
            case Say ->
            {
                final byte index = br.readByte();
                log.debug(user().getUserLog() + "Dialog say " + index);
                switch (index)
                {
                    case SAY_ASSIGNMENTS -> { sendAssignments(); user().send(writeStopped()); }
                    /* The request. The officer answers with the grant line either way - the
                     * refusal in the original data is about the ship being deployed elsewhere,
                     * which cannot happen here - and the affordable case gets the confirm pair
                     * while the broke case gets a single acknowledgement. Nothing is charged
                     * until the confirmation comes back. */
                    case SAY_REQUEST_CAPITAL ->
                    {
                        if (!npcGrantsCapital())
                        {
                            log.warn(user().getUserLog() + "capital request to " + currentNpc + ", who cannot grant it");
                            user().send(writeStopped());
                            return;
                        }
                        pendingCapital = CapitalRental.forFaction(user().getPlayer().getFaction(), false);
                        stage = Stage.CONFIRM_CAPITAL;
                        user().send(writeNpcRemark(new Remark((byte) 1, (isColonial() ? COL_RENT : CYL_RENT)[0], "")));
                    }
                    case SAY_REQUEST_FLAGSHIP ->
                    {
                        if (!npcGrantsCapital())
                        {
                            user().send(writeStopped());
                            return;
                        }
                        pendingCapital = CapitalRental.forFaction(user().getPlayer().getFaction(), true);
                        stage = Stage.CONFIRM_CAPITAL;
                        user().send(writeNpcRemark(new Remark((byte) 1, (isColonial() ? COL_RENT : CYL_RENT)[0], "")));
                    }
                    case SAY_CONFIRM_CAPITAL ->
                    {
                        final Player player = user().getPlayer();
                        final PlayerProtocol playerProtocol = user().getProtocol(ProtocolID.Player);
                        final long capitalGuid = pendingCapital != 0 ? pendingCapital
                                : CapitalRental.forFaction(player.getFaction(), false);
                        CDI.current().select(Catalogue.class).get()
                                .fetchCard(capitalGuid, CardView.Ship)
                                .ifPresent(card -> playerProtocol.rentCapital((ShipCard) card));
                        log.info("{} confirmed capital rental of {} at {} tokens",
                                user().getUserLog(), capitalGuid, capitalPrice());
                        stage = Stage.ROOT;
                        user().send(writeStopped());
                    }
                    /* Quote the trade before charging for it. The four numbers go out as
                     * WaterExchangeValues, which is where the client's %WaterAmountExchange% and
                     * friends come from - the phrases below are written around those
                     * placeholders, so the officer states the exact amounts. */
                    case SAY_WATER ->
                    {
                        if (!WATER_NPCS.contains(currentNpc))
                        {
                            user().send(writeStopped());
                            return;
                        }
                        quoteWaterExchange();
                        stage = Stage.CONFIRM_WATER;
                        user().send(writeNpcRemark(new Remark((byte) 1, (isColonial() ? COL_WATER : CYL_WATER)[1], "")));
                    }
                    case SAY_CONFIRM_WATER ->
                    {
                        applyWaterExchange();
                        stage = Stage.ROOT;
                        user().send(writeNpcRemark(new Remark((byte) 1, (isColonial() ? COL_WATER : CYL_WATER)[4], "")));
                        user().send(writeStopped());
                    }
                    case SAY_LEAVE -> { stage = Stage.ROOT; user().send(writeStopped()); }
                    default ->
                    {
                        log.warn(user().getUserLog() + "Wrong index given " + index);
                        user().send(writeStopped());
                    }
                }
            }
            /* The client asks for the answer list once the NPC's line has been read, so this is
             * where the menu is built - and it is rebuilt per advance, which is what lets the
             * confirm step replace the root menu rather than append to it. */
            case Advance ->
            {
                final List<Remark> remarks = new ArrayList<>();
                if (stage == Stage.CONFIRM_WATER)
                {
                    final String[] w = isColonial() ? COL_WATER : CYL_WATER;
                    if (pendingWater > 0) remarks.add(new Remark(SAY_CONFIRM_WATER, w[2], ""));
                    remarks.add(new Remark(SAY_LEAVE, w[3], ""));
                }
                else if (stage == Stage.CONFIRM_CAPITAL)
                {
                    final String[] rent = isColonial() ? COL_RENT : CYL_RENT;
                    if (canAffordCapital())
                    {
                        remarks.add(new Remark(SAY_CONFIRM_CAPITAL, rent[1], ""));
                        remarks.add(new Remark(SAY_LEAVE, rent[2], ""));
                    }
                    else
                    {
                        remarks.add(new Remark(SAY_LEAVE, rent[3], ""));
                    }
                }
                else
                {
                    final String[] root = isColonial() ? COL_ROOT : CYL_ROOT;
                    final boolean capitalNpc = npcGrantsCapital();
                    remarks.add(new Remark(SAY_ASSIGNMENTS, capitalNpc ? root[1] : GENERIC_ASSIGNMENTS, ""));
                    if (capitalNpc)
                    {
                        remarks.add(new Remark(SAY_REQUEST_CAPITAL, root[2], ""));
                        remarks.add(new Remark(SAY_REQUEST_FLAGSHIP,
                                isColonial() ? COL_FLAGSHIP_REQUEST : CYL_FLAGSHIP_REQUEST, ""));
                    }
                    if (WATER_NPCS.contains(currentNpc))
                    {
                        remarks.add(new Remark(SAY_WATER, (isColonial() ? COL_WATER : CYL_WATER)[0], ""));
                    }
                    if (capitalNpc || WATER_NPCS.contains(currentNpc))
                    {
                        remarks.add(new Remark(SAY_LEAVE, root[3], ""));
                    }
                }
                user().send(writePcRemarks(remarks));
            }
            case Stop ->
            {
                user().send(writeStopped());
            }

            default ->
            {
                log.warn(user().getUserLog() + "DialogProtocol not implemented for version: " + msgType);
            }
        }
    }
    private long waterInHold()
    {
        return user().getPlayer().getHold().getByGUID(ResourceType.Water.guid)
                .filter(i -> i instanceof ItemCountable)
                .map(i -> ((ItemCountable) i).getCount()).orElse(0L);
    }

    /** Work out what the pilot may trade right now and tell the client, so the phrases can
     *  quote it. Deliberately quotes the WHOLE hold - the original exchanged everything in one
     *  transaction rather than metering it out. */
    private void quoteWaterExchange()
    {
        final long inHold = waterInHold();
        // Only whole cubits are paid, so never take the remainder the pilot would not be paid for.
        pendingWater = (inHold / WATER_PER_CUBIT) * WATER_PER_CUBIT;
        pendingCubits = pendingWater / WATER_PER_CUBIT;
        user().send(ProtocolRegistryWriteOnly.<PlayerProtocolWriteOnly>getProtocol(ProtocolID.Player)
                .writeWaterExchangeValues(pendingWater, inHold, pendingWater, pendingCubits, WATER_PER_CUBIT));
    }

    private void applyWaterExchange()
    {
        if (pendingWater <= 0)
            return;
        // Re-read the hold: the quote was taken before the player confirmed, and mining or a
        // hold transfer in between must not let the trade pay out more than is actually there.
        final long water = Math.min(pendingWater, (waterInHold() / WATER_PER_CUBIT) * WATER_PER_CUBIT);
        if (water <= 0)
            return;
        final long cubits = water / WATER_PER_CUBIT;
        final Player player = user().getPlayer();
        final ContainerVisitor visitor = new ShopVisitor(user(), null, ctx.rng());
        visitor.removeBuyResources(new Price(ResourceType.Water, water), player.getHold(), 1);
        visitor.addShipItem(ItemCountable.fromGUID(ResourceType.Cubits.guid, cubits), player.getHold());
        pendingWater = 0;
        pendingCubits = 0;
        log.info("{} exchanged {} water for {} cubits", user().getUserLog(), water, cubits);
    }

    private void sendAssignments()
    {
        final Player player = user().getPlayer();
        final boolean updated = missionDistributor.updateMissionBook();
        log.debug("User updated missions ? {} {}", updated, player.getCounterFacade().missionBook());
        if (updated)
        {
            PlayerProtocolWriteOnly playerProtocolWriteOnly = ProtocolRegistryWriteOnly.getProtocol(ProtocolID.Player);
            user().send(playerProtocolWriteOnly.writeMissions(player.getCounterFacade().missionBook()));
        }
    }

    public BgoProtocolWriter writeStopped()
    {
        final BgoProtocolWriter bw = newMessage();
        bw.writeMsgType(ServerMessage.Stopped.getValue());
        return bw;
    }
    public BgoProtocolWriter writeNpcRemark(final Remark remark)
    {
        final BgoProtocolWriter bw = newMessage();
        bw.writeMsgType(ServerMessage.NpcRemark.getValue());
        bw.writeDesc(remark);
        return bw;
    }
    public BgoProtocolWriter writePcRemarks(final List<Remark> remarks)
    {
        final BgoProtocolWriter bw = newMessage();
        bw.writeMsgType(ServerMessage.PcRemarks.getValue());

        bw.writeDescCollection(remarks);

        return bw;
    }

    public enum ServerMessage
    {
        NpcRemark,
        PcRemarks,
        Stopped,
        Action;

        public static final int SIZE = Short.SIZE;

        public short getValue()
        {
            return (short) this.ordinal();
        }

        public static ServerMessage forValue(final short value)
        {
            return values()[value];
        }
    }

    enum ClientMessage
    {
        Say,
        Advance,
        Stop;

        public static final int SIZE = Short.SIZE;

        public short getValue()
        {
            return (short) this.ordinal();
        }

        public static ClientMessage forValue(final int value)
        {
            final ClientMessage[] _values = values();
            if (value < 0 || value > 2)
                return null;
            return _values[value];
        }
    }

}
