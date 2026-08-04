package io.github.luigeneric.core.spaceentities.statsinfo.buffer.propertyupdates;


import io.github.luigeneric.binaryreaderwriter.BgoProtocolWriter;
import io.github.luigeneric.core.spaceentities.statsinfo.buffer.SpaceUpdateType;

/**
 * Tells a client that a toggle ability turned on or off. The client keys its toolbar state off
 * this and nothing else: SpaceSubscribeInfo.Read routes AddToggleBuff(14)/RemoveToggleBuff(15) to
 * OnAddToggleBuff/OnRemoveToggleBuff, and MyShipStats sets slot.Ability.ToggleAbilityActivated
 * from there - which is what lights (or unlights) the button. Without this update a toggled
 * ability works server-side while the button stays dark, and the player cannot tell it is on.
 *
 * Wire shape is the client's: type byte, slot id as ONE byte, ability guid as a uint32.
 */
public class ToggleBuffUpdate extends PropertyUpdate
{
    private final int slotID;
    private final long abilityGuid;

    public ToggleBuffUpdate(final SpaceUpdateType spaceUpdateType, final int slotID, final long abilityGuid)
    {
        super(spaceUpdateType);
        this.slotID = slotID;
        this.abilityGuid = abilityGuid;
    }

    @Override
    public void write(final BgoProtocolWriter bw)
    {
        super.write(bw);
        bw.writeByte((byte) this.slotID);
        bw.writeGUID(this.abilityGuid);
    }

    /* Equality is (type, slot, guid) so an on and a subsequent off never collapse into one
     * update: BasePropertyBuffer keeps a Set and drops duplicates, and the pair must both
     * survive a tick that carries them together. */
    @Override
    public boolean equals(final Object o)
    {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        if (!super.equals(o)) return false;

        final ToggleBuffUpdate that = (ToggleBuffUpdate) o;
        return slotID == that.slotID && abilityGuid == that.abilityGuid;
    }

    @Override
    public int hashCode()
    {
        int result = super.hashCode();
        result = 31 * result + slotID;
        result = 31 * result + (int) (abilityGuid ^ (abilityGuid >>> 32));
        return result;
    }

    @Override
    public String toString()
    {
        return "ToggleBuffUpdate{" +
                "slotID=" + slotID +
                ", abilityGuid=" + abilityGuid +
                ", spaceUpdateType=" + spaceUpdateType +
                '}';
    }
}
