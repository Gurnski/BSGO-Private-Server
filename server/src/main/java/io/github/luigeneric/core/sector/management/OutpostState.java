package io.github.luigeneric.core.sector.management;


import io.github.luigeneric.core.sector.Tick;
import io.github.luigeneric.enums.Faction;
import io.github.luigeneric.linearalgebra.utility.Mathf;
import lombok.Getter;

public class OutpostState
{
    private final Faction faction;
    @Getter
    private int opPoints;
    private final float secondsBlocked;
    @Getter
    private long dieTimeStamp;
    /** Whether this faction may hold this system at all, straight off the galaxy star flags. False
     *  makes getDelta return 0 no matter how many points are set, so anything driving points from
     *  outside - persistence, admin commands - has to read this to explain why nothing happened. */
    @Getter
    private final boolean canOutpost;
    private boolean isOutPostCached;
    private final Tick tick;


    public OutpostState(
            final Faction faction, final int opPoints, final float secondsBlocked, final boolean canOutpost,
            final Tick tick
    )
    {
        this.faction = faction;
        this.opPoints = opPoints;
        this.secondsBlocked = secondsBlocked;
        this.dieTimeStamp = 0;
        this.canOutpost = canOutpost;
        this.tick = tick;
    }

    public void opDied(final long dieTimeStamp)
    {
        this.dieTimeStamp = dieTimeStamp;
        this.opPoints = 0;
    }
    public void opDied(final Tick tick)
    {
        this.opDied(tick.getTimeStamp());
    }

    public boolean increasePoints(final long deltaIncrease)
    {
        if (this.isBlocked())
        {
            return true;
        }
        this.opPoints += deltaIncrease;
        this.opPoints = Mathf.clampSafe(this.opPoints, 0, 3000);
        return false;
    }
    public boolean decreasePoints(final long deltaDecrease)
    {
        if (this.isBlocked())
            return true;

        this.opPoints -= deltaDecrease;
        this.opPoints = Math.max(this.opPoints, 0);
        return false;
    }

    /**
     * Put this contest exactly where it is told, ignoring the capture rules.
     * <p>
     * Every other mutator here is a move in the game - increasePoints refuses while blocked,
     * decreasePoints floors at zero, opDied starts the lockout - which is right for the things
     * players do and wrong for the two things that are not gameplay at all: restoring the snapshot
     * a previous run left behind, and an operator saying "this system is held now". Both need to
     * reproduce a state, not earn it, so both come through here.
     * <p>
     * canOutpost is deliberately NOT consulted. A faction barred from holding this system reads
     * back exactly what it was given and still spawns nothing, because getDelta returns 0 for it -
     * so a bad restore or a mistyped command is inert rather than silently rewritten, and the row
     * that goes back to disk is the row that came off it.
     *
     * @param opPoints     control points; clamped to the same 0..3000 the game clamps to
     * @param dieTimeStamp epoch millis of the last death, or 0 for "never died, take it freely"
     */
    public void restore(final int opPoints, final long dieTimeStamp)
    {
        this.opPoints = Mathf.clampSafe(opPoints, 0, 3000);
        this.dieTimeStamp = dieTimeStamp;
    }

    public boolean isBlocked()
    {
        return this.isBlocked(tick.getTimeStamp());
    }
    public boolean isBlocked(final long currentTimeStamp)
    {
        final long delta = this.getDeltaBlockTime(currentTimeStamp);
        return delta < 0;
    }

    private long getDeltaBlockTime(final long currentTimeStamp)
    {
        final long targetTimeStamp = this.dieTimeStamp + (long)this.secondsBlocked * 1000;
        return currentTimeStamp - targetTimeStamp;
    }

    public float getDelta()
    {
        if (!this.canOutpost)
        {
            return 0f;
        }
        final float rawDelta = this.getDeltaBlockTime(tick.getTimeStamp()) * 0.001f;
        if (rawDelta > 0)
        {
            return this.opPoints >= 900 ? 1 : rawDelta;
        }
        return rawDelta;
    }

    public boolean isOutPost()
    {
        final float currentDelta = this.getDelta();
        this.isOutPostCached = currentDelta == 1f;
        return this.isOutPostCached;
    }

    public boolean isOutPostCached()
    {
        return isOutPostCached;
    }
}
