package io.github.luigeneric.core.sector.management;


import io.github.luigeneric.core.gameplayalgorithms.*;
import lombok.Getter;

import java.util.Objects;

@Getter
public final class SectorAlgorithms
{
    private final IHitchanceCalculator hitchanceCalculator;
    private final IArmorAlgorithm armorAlgorithm;
    private final ICritchanceAlgorithm critchanceAlgorithm;
    private final IFlareChanceAlgorithm flareChanceAlgorithm;
    private final IEWDurationAlgorithm ewDurationAlgorithm;

    public SectorAlgorithms(final IHitchanceCalculator hitchanceCalculator, final IArmorAlgorithm armorAlgorithm,
                            final ICritchanceAlgorithm critchanceAlgorithm, final IFlareChanceAlgorithm flareChanceAlgorithm,
                            final IEWDurationAlgorithm ewDurationAlgorithm)
    {
        this.hitchanceCalculator = Objects.requireNonNull(hitchanceCalculator);
        this.armorAlgorithm = Objects.requireNonNull(armorAlgorithm);
        this.critchanceAlgorithm = Objects.requireNonNull(critchanceAlgorithm);
        this.flareChanceAlgorithm = Objects.requireNonNull(flareChanceAlgorithm);
        this.ewDurationAlgorithm = Objects.requireNonNull(ewDurationAlgorithm);
    }

    /* Armour. V0 returns a constant 1, i.e. armour is discarded and ArmorPiercing does nothing, so
     * every armour-plating module and every ArmorValue on a hull is decorative. V1 is the original's
     * own curve, (100 - clamp(armor - armorPiercing, 0, 99.9)) / 100. THIS CHANGES DAMAGE NUMBERS
     * FOR EVERY PLAYER AND EVERY NPC IN EVERY SECTOR. This is not confined to new content: 97 of
     * the stat blocks the card generator already emits carry a non-zero ArmorValue, and only 40
     * abilities answer with any ArmorPiercing at all, so most existing targets get harder to kill
     * the moment this flips. To revert, put ArmorAlgorithmV0 back on the line below and change
     * nothing else. */
    private static final IArmorAlgorithm ARMOR_ALGORITHM = new ArmorAlgorithmV1();

    public static SectorAlgorithms defaultAlgorithms()
    {
        return new SectorAlgorithms(
                new HitchanceBasedOnThrottle(),
                ARMOR_ALGORITHM,
                new CritchanceAlgorithmV1(),
                new FlareChanceAlgorithmV1(),
                new HackDurationAlgorithmV1()
        );
    }
}
