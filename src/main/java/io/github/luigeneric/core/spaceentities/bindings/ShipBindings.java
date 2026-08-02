package io.github.luigeneric.core.spaceentities.bindings;

import com.google.gson.annotations.SerializedName;
import io.github.luigeneric.binaryreaderwriter.BgoProtocolWriter;
import io.github.luigeneric.binaryreaderwriter.IProtocolWrite;
import io.github.luigeneric.core.player.ShipAbility;
import io.github.luigeneric.core.player.container.ShipSlot;
import io.github.luigeneric.core.player.container.ShipSlots;
import io.github.luigeneric.templates.cards.ShipSystemCard;
import io.github.luigeneric.templates.cards.ShipSystemPaintCard;
import io.github.luigeneric.templates.utils.ShipSlotType;
import lombok.extern.slf4j.Slf4j;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

@Slf4j
public class ShipBindings implements IProtocolWrite
{

    @SerializedName("ModuleBindings")
    private final List<ShipModuleBinding> moduleBindingList;
    @SerializedName("StickerBindings")
    private final List<StickerBinding> stickerBindingList;
    private final boolean isSyFy;
    private ShipSystemPaintCard shipSystemPaintCard;

    public ShipBindings(List<ShipModuleBinding> moduleBindingList, List<StickerBinding> stickerBindingList,
                        boolean isSyFy, ShipSystemPaintCard shipSystemPaintCard)
    {
        Objects.requireNonNull(moduleBindingList, "module binding list cannot be null");
        Objects.requireNonNull(stickerBindingList, "sticker binding list cannot be null");

        this.moduleBindingList = moduleBindingList;
        this.stickerBindingList = stickerBindingList;
        this.isSyFy = isSyFy;
        this.shipSystemPaintCard = shipSystemPaintCard;
    }
    public ShipBindings()
    {
        this.moduleBindingList = new ArrayList<>();
        this.stickerBindingList = new ArrayList<>();
        this.isSyFy = false;
        //TODO FIX SHIP SYSTEM PAINT CARD
        //this.shipSystemPaintCard = new ShipSystemPaintCard(2562237565L, "default", "", 2366349390L);
        //this.shipSystemPaintCard = new ShipSystemPaintCard(0, "default", "", 0);
        this.shipSystemPaintCard = null;
    }

    public void setSlots(final ShipSlots shipSlots, final byte tier)
    {
        if (tier < 1 || tier > 4)
        {
            log.warn("WRONG TIER: " + tier);
            return;
        }

        for (final ShipSlot slot : shipSlots.values())
        {
            final ShipSystemCard systemCard = slot.getShipSystem().getShipSystemCard();
            if (systemCard == null) continue;
            /* EVERY weapon-bearing slot type, not just weapon+launcher. The FireMissle/FireCannon
             * branches below sit INSIDE this guard, so a slot type missing from it can never emit a
             * turret or missile-pod binding - the model simply never appears, silently.
             *   launcher          - the client's own data and every shipped ShipConfigTemplate treat
             *                       slot 2 as a launcher; without it no missile pod rendered.
             *   gun / defensive_  - the capital-ship types. The live game's own cards use them: the
             *   weapon              dumped capital families item_slot_capital_system_gun_long_range_cc
             *                       and the flak/point-defence batteries are SlotType gun and
             *                       defensive_weapon respectively, and Update 53.5 describes the
             *                       Pegasus's visible cannon, flak and PD turrets. Our Pegasus (5017)
             *                       and Basestar (5117) carry 6 gun + 2 defensive_weapon mounts, so
             *                       eight of their twelve hardpoints rendered nothing at all.
             *   special_weapon    - listed for completeness; nothing ships one yet.
             * This guard is belt-and-braces anyway: the switch below leaves moduleGUID at 0 for any
             * non-firing ability, so a hull/engine/computer module could not produce a binding even
             * if it reached here. Widening it cannot bind a non-weapon. */
            final ShipSlotType slotType = systemCard.getShipSlotType();
            if (slotType == ShipSlotType.weapon || slotType == ShipSlotType.launcher
                    || slotType == ShipSlotType.gun || slotType == ShipSlotType.defensive_weapon
                    || slotType == ShipSlotType.special_weapon)
            {
                final ShipAbility ability = slot.getShipAbility();
                if (ability != null)
                {
                    long moduleGUID = 0;
                    switch (ability.getShipAbilityCard().getAbilityActionType())
                    {

                        case Flak,PointDefence,FireMining,FireCannon,FireKillCannon,FireShotgun,FireMachineGun ->
                        {
                            moduleGUID = ModuleBindingGUID.turret_tier1.getValue() + tier - 1;
                        }
                        case FireMissle,FireHeavyMissile,FireLightMissile,FireTorpedo ->
                        {
                            moduleGUID = ModuleBindingGUID.missile_tier1.getValue() + tier - 1;
                        }
                    }
                    if (moduleGUID == 0) continue;
                    final int hash = slot.getShipSlotCard().getObjectPointServerHash();
                    ShipModuleBinding shipModuleBinding = new ShipModuleBinding(hash, moduleGUID);
                    this.addModuleBinding(shipModuleBinding);
                }
            }
        }
    }

    public void setShipSystemPaintCard(final ShipSystemPaintCard shipSystemPaintCard)
    {
        this.shipSystemPaintCard = shipSystemPaintCard;
    }

    public void addModuleBinding(final ShipModuleBinding moduleBinding)
    {
        Objects.requireNonNull(moduleBinding, "ShipModuleBinding was null");
        this.moduleBindingList.add(moduleBinding);
    }

    @Override
    public void write(final BgoProtocolWriter bw)
    {
        int sumLen = moduleBindingList.size() + stickerBindingList.size();
        if (isSyFy)
        {
            sumLen++;
        }
        if (shipSystemPaintCard != null)
        {
            sumLen++;
        }


        bw.writeLength(sumLen);
        for(StickerBinding stickerBinding : stickerBindingList)
        {
            bw.writeByte((byte) 1); //case 1
            bw.writeDesc(stickerBinding);
        }
        for (ShipModuleBinding shipModuleBinding : moduleBindingList)
        {
            bw.writeByte((byte) 2); //case 2
            bw.writeDesc(shipModuleBinding);
        }
        if (isSyFy)
        {
            bw.writeByte((byte) 3); //case 3
        }
        if (shipSystemPaintCard != null)
        {
            bw.writeByte((byte) 4);
            bw.writeGUID(shipSystemPaintCard.getCardGuid());
        }
    }

    public List<ShipModuleBinding> getModuleBindingList()
    {
        return moduleBindingList;
    }

    public List<StickerBinding> getStickerBindingList()
    {
        return stickerBindingList;
    }

    public boolean isSyFy()
    {
        return isSyFy;
    }

    public ShipSystemPaintCard getShipSystemPaintCard()
    {
        return shipSystemPaintCard;
    }
}
