package io.github.luigeneric.core.player.login;

import io.github.luigeneric.templates.startupconfig.GameServerParamsConfig;
import jakarta.enterprise.context.ApplicationScoped;
import lombok.extern.slf4j.Slf4j;

import java.util.*;
import java.util.concurrent.locks.ReadWriteLock;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import java.util.function.Predicate;
import java.util.stream.Collectors;

@Slf4j
@ApplicationScoped
public class SessionRegistry
{
    public static final boolean DEBUG = true;
    /**
     * int in minutes
     * <p>
     * Upstream ships 3, which suits a real login server handing out short-lived one-shot codes.
     * With the preconfigured sessions in application.properties there is no login server: the
     * codes are minted once at boot and never reissued, so a 3-minute window means you can only
     * log in during the first 3 minutes of server uptime. After that every attempt fails with
     * "could not find: preconfigured-session" and the client hangs on "Loading... please wait",
     * which looks exactly like a missing card. 7 days keeps a private server usable.
     */
    public static final int TIME_SESSION_VALID = 60 * 24 * 7;
    /**
     * SessionCode, SessionObject
     */
    private final Map<String, Session> sessions;
    private final ReadWriteLock readWriteLock;
    private final GameServerParamsConfig gameServerParamsConfig;

    public SessionRegistry(final GameServerParamsConfig gameServerParamsConfig)
    {
        this.gameServerParamsConfig = gameServerParamsConfig;
        this.sessions = new HashMap<>();
        this.readWriteLock = new ReentrantReadWriteLock();
        setupDebugParams();
    }

    private void setupDebugParams()
    {
        if (!gameServerParamsConfig.sessionSettings().ignoreSession())
        {
            return;
        }

        var debugSessions = gameServerParamsConfig.sessionSettings().sessions();
        for (String debugSession : debugSessions)
        {
            var splitRes = debugSession.split("@");
            var userId = splitRes[0];
            var sessionStr = splitRes[1];
            // reusable=true: these codes are minted once at boot and never reissued, so they must
            // survive both disconnect and the age-based reaper. Otherwise the first logout locks
            // that account out until the server restarts.
            this.addSession(new Session(Long.parseLong(userId), sessionStr, true));
        }
    }

    private void readLock()
    {
        this.readWriteLock.readLock().lock();
    }
    private void writeLock()
    {
        this.readWriteLock.writeLock().lock();
    }
    private void readUnlock()
    {
        this.readWriteLock.readLock().unlock();;
    }
    private void writeUnlock()
    {
        this.readWriteLock.writeLock().unlock();
    }

    public void addSession(final Session session)
    {
        writeLock();
        try
        {
            this.sessions.put(session.getSessionCode(), session);
        }
        finally
        {
            writeUnlock();
        }
    }

    public Optional<Session> getSession(final String sessionCode)
    {
        readLock();
        try
        {
            return Optional.ofNullable(this.sessions.get(sessionCode));
        }
        finally
        {
            readUnlock();
        }
    }
    public Set<Session> getSessions(final long userID)
    {
        readLock();
        try
        {
            return this.sessions.values()
                    .stream()
                    .filter(session -> session.getUserId() == userID)
                    .collect(Collectors.toSet());
        }
        finally
        {
            readUnlock();
        }
    }
    public Collection<Session> getAllSessions(final Predicate<Session> predicate)
    {
        readLock();
        try
        {
            return this.sessions.values()
                    .stream()
                    .filter(predicate)
                    .toList();
        }
        finally
        {
            readUnlock();
        }
    }

    public boolean checkUserAlreadyLoggedIn(final Session newSession)
    {
        writeLock();
        try
        {
            if (DEBUG)
            {
                final StringBuilder sb = new StringBuilder();
                for (final Session value : this.sessions.values())
                {
                    sb.append(value);
                }
                log.info("session:\n" + sb);
                removeExpiredSessions();
                final StringBuilder sb2 = new StringBuilder();
                for (final Session value : this.sessions.values())
                {
                    sb2.append(value);
                }
                log.info("after clean:\n"+sb2);
            }
            removeExpiredSessions();

            return this.sessions.values().stream()
                    .anyMatch(session -> session.getUserId() == newSession.getUserId() &&
                            session.getSessionState().equals(Session.SessionState.InUse));
        }
        finally
        {
            writeUnlock();
        }
    }

    private void removeExpiredSessions()
    {
        final List<Session> sessionsToRemove = new ArrayList<>();
        for (final Session session : this.sessions.values())
        {
            final boolean isValid = !session.invalidateIfTimeUP();

            if (!isValid)
                sessionsToRemove.add(session);
        }
        for (final Session session : sessionsToRemove)
        {
            sessions.remove(session.getSessionCode());
        }
    }

    public void createSession(final long userId, final String sessionCode)
    {
        this.addSession(new Session(userId, sessionCode));
    }
}
