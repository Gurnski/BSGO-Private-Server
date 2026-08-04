package io.github.luigeneric.core.sector.management.slots;



import io.github.luigeneric.binaryreaderwriter.BgoProtocolWriter;
import io.github.luigeneric.binaryreaderwriter.IProtocolWrite;
import io.github.luigeneric.enums.Faction;
import io.github.luigeneric.enums.SectorSlotCapType;

import java.util.HashMap;
import java.util.Map;

public class SectorSlotData implements IProtocolWrite
{
    private final FactionSectorSlots colonialSectorSlots;
    private final FactionSectorSlots cylonSectorSlots;
    private final Map<Long, ShipSectorSlots> shipSectorSlotsMap;

    public SectorSlotData(FactionSectorSlots colonialSectorSlots, FactionSectorSlots cylonSectorSlots,
                          Map<Long, ShipSectorSlots> shipSectorSlotsMap)
    {
        this.colonialSectorSlots = colonialSectorSlots;
        this.cylonSectorSlots = cylonSectorSlots;
        this.shipSectorSlotsMap = shipSectorSlotsMap;
    }
    public SectorSlotData()
    {
        this(true, true);
    }

    /**
     * Slot caps that tell the truth about who may jump here.
     *
     * The client gates its jump button on the max slots for the player's own faction: a faction
     * whose max is 0 gets no button and the "sector restricted" line instead. Sending everyone
     * 100/100 - which is what the no-arg constructor did for every sector in the galaxy - meant a
     * live jump button on systems the server then refused with a bare "sector not allowed", and
     * no way for the pilot to tell which systems those were until they tried.
     *
     * The counts are otherwise unused: nothing on this server consumes or increments the current
     * count, so 100 stands for "as many as want to come".
     */
    public static SectorSlotData forFactionAccess(final boolean colonialAllowed, final boolean cylonAllowed)
    {
        return new SectorSlotData(
                new FactionSectorSlots(colonialAllowed ? 100 : 0, 0, Faction.Colonial),
                new FactionSectorSlots(cylonAllowed ? 100 : 0, 0, Faction.Cylon),
                new HashMap<>());
    }
    private SectorSlotData(final boolean colonialAllowed, final boolean cylonAllowed)
    {
        this(new FactionSectorSlots(colonialAllowed ? 100 : 0, 0, Faction.Colonial),
                new FactionSectorSlots(cylonAllowed ? 100 : 0, 0, Faction.Cylon),
                new HashMap<>());
    }

    @Override
    public void write(BgoProtocolWriter bw)
    {
        //length num17
        //specific length + colonial slots + cylon slots + total slots
        int size = shipSectorSlotsMap.size() + 3;
        bw.writeLength(size);

        //start of the loop byte to identify if its shipSlotCap or SectorSlotCapType (Bigpoint what the fuck is wrong with you)
        for (ShipSectorSlots shipSectorSlots : this.shipSectorSlotsMap.values())
        {
            bw.writeByte((byte) 1);
            bw.writeGUID(shipSectorSlots.getGuid());
            bw.writeUInt32(shipSectorSlots.getCurrent());
            bw.writeUInt32(shipSectorSlots.getMax());
        }

        bw.writeByte((byte) 0);
        bw.writeByte(SectorSlotCapType.Colonial.getValue());
        bw.writeUInt32(this.colonialSectorSlots.getCurrent());
        bw.writeUInt32(this.colonialSectorSlots.getMax());

        bw.writeByte((byte) 0);
        bw.writeByte(SectorSlotCapType.Cylon.getValue());
        bw.writeUInt32(this.cylonSectorSlots.getCurrent());
        bw.writeUInt32(this.cylonSectorSlots.getMax());

        bw.writeByte((byte) 0);
        bw.writeByte(SectorSlotCapType.Total.getValue());
        bw.writeUInt32(this.colonialSectorSlots.getCurrent() + this.cylonSectorSlots.getCurrent());
        bw.writeUInt32(this.colonialSectorSlots.getMax() + this.cylonSectorSlots.getMax());
    }
}
