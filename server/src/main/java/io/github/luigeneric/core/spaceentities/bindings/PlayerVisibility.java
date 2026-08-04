package io.github.luigeneric.core.spaceentities.bindings;


import io.github.luigeneric.binaryreaderwriter.BgoProtocolWriter;
import io.github.luigeneric.binaryreaderwriter.IProtocolWrite;
import io.github.luigeneric.core.sector.Tick;
import io.github.luigeneric.enums.ChangeVisibilityReason;
import lombok.extern.slf4j.Slf4j;

import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

@Slf4j
public class PlayerVisibility implements IProtocolWrite
{
    private boolean isVisible;
    private ChangeVisibilityReason changeVisibilityReason;
    private GhostJumpState ghostJumpState;

    private long lastChangeVisibility;
    private final AtomicBoolean visibilityChanged;
    private final AtomicLong anchoredObjectId;

    public PlayerVisibility(final boolean isVisible, final ChangeVisibilityReason changeVisibilityReason,
                            final GhostJumpState ghostJumpState)
    {
        this.isVisible = isVisible;
        this.changeVisibilityReason = Objects.requireNonNull(changeVisibilityReason);;
        this.ghostJumpState = ghostJumpState;
        this.anchoredObjectId = new AtomicLong();
        this.lastChangeVisibility = System.currentTimeMillis();
        this.visibilityChanged = new AtomicBoolean();

        this.changeVisibility(false, ChangeVisibilityReason.Default);
    }
    public PlayerVisibility(final boolean isVisible)
    {
        this(isVisible, ChangeVisibilityReason.Default, GhostJumpState.NOT_STARTED);
    }

    public void changeVisibility(final boolean isVisible, final ChangeVisibilityReason changeVisibilityReason,
                                 final long anchoredTarget)
            throws NullPointerException
    {
        this.changeVisibilityReason = Objects
                .requireNonNull(changeVisibilityReason, "Visibility change reason was null!");

        this.isVisible = isVisible;
        this.anchoredObjectId.set(anchoredTarget);


        this.lastChangeVisibility = System.currentTimeMillis();
        this.visibilityChanged.set(true);
    }

    public long getAnchoredObjectId()
    {
        return anchoredObjectId.get();
    }

    public void changeVisibility(final boolean isVisible, final ChangeVisibilityReason changeVisibilityReason)
            throws NullPointerException
    {
        changeVisibility(isVisible, changeVisibilityReason, 0);
    }

    @Override
    public void write(final BgoProtocolWriter bw)
    {
        bw.writeBoolean(this.isVisible);
    }

    public boolean isVisible()
    {
        return isVisible;
    }

    public ChangeVisibilityReason getChangeVisibilityReason()
    {
        return changeVisibilityReason;
    }

    /* Both this and finishGhostJumpInIfNotFinished used to demand state == STARTED, and STARTED
     * only ever came from the client's CompleteJump message via GameProtocol's flag. Every fresh
     * PlayerShip is born invisible with reason Default (constructor below), so ONE missed or
     * mistimed CompleteJump left a ship the state machine could never make visible again: the
     * 10-second timer refused, and so did the perform-any-action lift on the first maneuver -
     * the player sat under a stuck "perform any action to enter the sector" overlay, untouchable
     * and untargetable, forever. Invisible-by-Default has exactly one meaning in this codebase
     * (sector entry - the constructor and startGhostJump are its only writers), so both gates
     * now accept the never-started state too. FINISHED is still terminal. */
    public boolean requiredJumpIn(final Tick currentTick)
    {
        if (this.isVisible)
            return false;

        if (this.ghostJumpState == GhostJumpState.FINISHED)
            return false;

        final boolean isDefault = this.changeVisibilityReason == ChangeVisibilityReason.Default;
        if (!isDefault)
            return false;

        //current time must be higher than last time + 10 seconds must be lower
        return (this.lastChangeVisibility + 10_000) < currentTick.getTimeStamp();
    }

    public boolean checkVisibilityRequiresUpdate()
    {
        return visibilityChanged.compareAndSet(true, false);
    }

    /**
     * Starts the ghost jump in effect
     * @return true if start process was correct, false if GhostJump was already started before or is already started!
     */
    public boolean startGhostJump()
    {
        if (this.ghostJumpState != GhostJumpState.NOT_STARTED)
            return false;

        this.ghostJumpState = GhostJumpState.STARTED;
        this.changeVisibility(false, ChangeVisibilityReason.Default);
        return true;
    }
    public void finishGhostJumpInIfNotFinished()
    {
        if (this.ghostJumpState == GhostJumpState.FINISHED)
            return;

        if (this.changeVisibilityReason != ChangeVisibilityReason.Default)
        {
            return;
        }

        if (!this.isVisible && this.ghostJumpState == GhostJumpState.NOT_STARTED)
        {
            /* Lifting a ghost that was never started means the CompleteJump handshake was missed
             * for this ship - the lift is correct either way, but the miss is worth a trace so
             * the flaky link has a name the day someone wonders why this line is in their log. */
            log.info("ghost jump lifted from NOT_STARTED - the client's CompleteJump never took effect for this ship");
        }
        this.changeVisibility(true, ChangeVisibilityReason.Jump);
        this.ghostJumpState = GhostJumpState.FINISHED;
    }

    @Override
    public String toString()
    {
        return "PlayerVisibility{" +
                "isVisible=" + isVisible +
                ", changeVisibilityReason=" + changeVisibilityReason +
                ", ghostJumpState=" + ghostJumpState +
                ", lastChangeVisibility=" + lastChangeVisibility +
                ", visibilityChanged=" + visibilityChanged +
                '}';
    }

    public enum GhostJumpState
    {
        NOT_STARTED,
        STARTED,
        FINISHED
    }
}
