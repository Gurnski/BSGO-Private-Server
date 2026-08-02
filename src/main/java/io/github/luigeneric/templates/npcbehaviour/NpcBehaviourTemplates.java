package io.github.luigeneric.templates.npcbehaviour;


import io.github.luigeneric.templates.sectortemplates.spaceobjectttemplates.WeaponPlatformTemplate;

public class NpcBehaviourTemplates
{
    private NpcBehaviourTemplates(){}

    public static NpcBehaviourTemplate createTemplateForTier(final byte tier, final long lifeTimeSeconds, final boolean jumpOutIfInCombat,
                                                   final float speedZeroDistance) throws IllegalArgumentException
    {
        switch (tier)
        {
            case 1 ->
            {
                return new NpcBehaviourTemplate(1, 1000, 4000, lifeTimeSeconds, jumpOutIfInCombat, speedZeroDistance);
            }
            case 2 ->
            {
                return new NpcBehaviourTemplate(2, 1500, 4000, lifeTimeSeconds, jumpOutIfInCombat, speedZeroDistance);
            }
            case 3 ->
            {
                return new NpcBehaviourTemplate(3, 2000, 4000, lifeTimeSeconds, jumpOutIfInCombat, speedZeroDistance);
            }
            // The event capitals (C5-07 Poseidon / Kraken) fly tier-4 hulls. Longer reach than
            // the lines: a boss that ignores you until 2 km is a piniata, not an event.
            case 4 ->
            {
                return new NpcBehaviourTemplate(4, 2500, 5000, lifeTimeSeconds, jumpOutIfInCombat, speedZeroDistance);
            }
            default -> throw new IllegalArgumentException("Tier " + tier + " not implemented");
        }
    }

    /* 3500 acquire / 4000 leash. A station engages anything hostile that comes near it - enemy
     * players and enemy-faction bots alike, which getPotentialEnemyObjects already handles by
     * RELATION rather than by type, so no extra work is needed to make bots valid targets.
     * autoAggroDistance is the range at which it picks a target up unprovoked; maximumAggroDistance
     * is how far it keeps shooting at something that has already damaged it, so the leash is
     * deliberately the longer of the two. Both were 3300, which meant anything that opened fire from
     * just outside acquisition range got dropped the moment it drifted one metre further out.
     * These exceed the longest station weapon (2000 m) on purpose, exactly as the live game had it -
     * Platforms.txt:1 shows aggro decoupled from weapon range there too. Acquiring early is harmless
     * (getNextTarget always returns the CLOSEST valid target) and it means the station is already
     * tracking you as you close, instead of spending a 5-second timer tick waking up. */
    public static NpcBehaviourTemplate createOutpostTemplate()
    {
        return new NpcBehaviourTemplate(1, 3500, 4000, Float.MAX_VALUE, false, 0);
    }

    public static NpcBehaviourTemplate createPlatFormTemplate(final byte tier, WeaponPlatformTemplate weaponPlatformTemplate)
    {
        if (weaponPlatformTemplate.getMaximumAggroDistance() > 0)
        {
            return new NpcBehaviourTemplate(0, weaponPlatformTemplate.getAutoAggroDistance(), weaponPlatformTemplate.getMaximumAggroDistance(),
                    Float.MAX_VALUE, false, 0);
        }

        switch (tier)
        {
            case 1,2 ->
            {
                return new NpcBehaviourTemplate(1, 500, 2000,
                        Float.MAX_VALUE, false, 0);
            }
            case 3 ->
            {
                return new NpcBehaviourTemplate(1, 1000, 3000,
                        Float.MAX_VALUE, false, 0);
            }
        }
        throw new IllegalArgumentException("Tier not implemented for behaviour constructor: weaponPlatformTier " + tier);
    }
}
