package io.github.luigeneric.core.player.login;

import io.github.luigeneric.binaryreaderwriter.BgoTimeStamp;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;

import java.time.LocalDateTime;
import java.util.Objects;
import java.util.concurrent.locks.Lock;
import java.util.concurrent.locks.ReentrantLock;

@Slf4j
public class Session implements ISessionClosedNotifier
{
    @Getter
    private final long userId;
    @Getter
    private final String sessionCode;
    private final BgoTimeStamp createDateTime;
    private final Lock lock;
    @Getter
    private SessionState sessionState;
    /**
     * A reusable session survives disconnect and never times out.
     * <p>
     * Sessions normally model one-shot codes issued by a login server: notifyClosed() expires
     * them and the registry reaps them, because the login server would mint a fresh code next
     * time. The preconfigured sessions in application.properties have no such issuer - they are
     * created once at boot and never reissued - so expiring one permanently locks that account
     * out until the server restarts. The symptom is "User session is not present for registry"
     * server-side and a client stuck on "Loading... please wait".
     */
    @Getter
    private final boolean reusable;


    protected Session(final long userId, final String sessionCode)
    {
        this(userId, sessionCode, false);
    }

    protected Session(final long userId, final String sessionCode, final boolean reusable)
    {
        Objects.requireNonNull(sessionCode, "SessionCode cannot be null!");
        if (userId < 0) throw new IllegalArgumentException("userid cannot be less than 0!");

        this.lock = new ReentrantLock();
        this.userId = userId;
        this.sessionCode = sessionCode;
        this.createDateTime = new BgoTimeStamp(LocalDateTime.now());
        this.sessionState = SessionState.Created;
        this.reusable = reusable;
    }

    /**
     * Invalidates this session if the time is up and it's not in usage
     * @return true if the session is invalid
     */
    protected boolean invalidateIfTimeUP()
    {
        lock.lock();
        try
        {
            //fast out
            if (sessionState == SessionState.Expired)
                return true;

            // Preconfigured sessions have no issuer to mint a replacement, so they must never be
            // reaped on age either.
            if (reusable)
                return false;

            if (this.sessionState != SessionState.InUse && !this.isValid(SessionRegistry.TIME_SESSION_VALID))
            {
                this.setSessionState(SessionState.Expired);
                return true;
            }

            return false;
        }
        finally
        {
            lock.unlock();
        }
    }
    public void useSession()
    {
        lock.lock();
        try
        {
            if (!this.isValid(SessionRegistry.TIME_SESSION_VALID))
            {
                this.sessionState = SessionState.Expired;
                throw new IllegalStateException("Session not valid");
            }

            this.sessionState = SessionState.InUse;
        }
        finally
        {
            lock.unlock();
        }
    }

    public boolean isValid(int timeInMinutesCanPass)
    {
        lock.lock();
        try
        {
            final LocalDateTime expired = this.createDateTime.getLocalDate().plusMinutes(timeInMinutesCanPass);
            return LocalDateTime.now().isBefore(expired);
        }
        finally
        {
            lock.unlock();
        }
    }

    public void setSessionState(final SessionState sessionState)
    {
        lock.lock();
        try
        {
            this.sessionState = sessionState;
        }
        finally
        {
            lock.unlock();
        }
    }

    @Override
    public boolean equals(Object o)
    {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;

        Session session = (Session) o;

        return sessionCode.equals(session.sessionCode);
    }

    @Override
    public int hashCode()
    {
        return sessionCode.hashCode();
    }

    @Override
    public String toString()
    {
        return "Session{" +
                "userId=" + userId +
                ", sessionCode='" + sessionCode + '\'' +
                ", createDateTime=" + createDateTime +
                ", sessionState=" + sessionState +
                '}';
    }

    @Override
    public void notifyClosed()
    {
        log.info("Session for userId={} closing onNotifyClosed, oldState={}", userId, sessionState);
        // A reusable (preconfigured) session goes back to Created so the same code can be used
        // again next login. Expiring it would be a one-way door: nothing reissues these codes,
        // so the account could never log in again until the server restarted.
        this.setSessionState(reusable ? SessionState.Created : SessionState.Expired);
    }


    public enum SessionState
    {
        Created,
        Expired,
        InUse
    }
}
