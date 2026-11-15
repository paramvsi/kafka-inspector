package dev.kafkainspector.agent.security;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * At most 5 failed sign-in attempts per minute per IP (AGENT_API "Auth"), and 30 per minute in total: the client
 * address can be forged through X-Forwarded-For when the agent sits behind Docker's port mapping, so the global cap
 * is what bounds guessing. A successful sign-in clears that IP's count.
 */
@Component
public class LoginRateLimiter {
    private static final int MAX = 5;
    private static final int MAX_TOTAL = 30;
    private static final long WINDOW_MS = 60_000;
    private final Deque<Long> all = new ArrayDeque<>();
    private final Map<String, Deque<Long>> failures = new ConcurrentHashMap<>();

    /**
     * Reserves an attempt (counted as a failure until {@link #succeeded}) and returns 0, or the seconds to wait.
     * Check-and-record is one atomic step, so parallel requests can't all slip past the limit.
     */
    public synchronized long acquire(String ip) {
        long now = System.currentTimeMillis();
        if (failures.size() > 10_000) failures.values().removeIf(q -> q.isEmpty() || now - q.peekLast() > WINDOW_MS);
        Deque<Long> q = failures.computeIfAbsent(ip, k -> new ArrayDeque<>());
        while (!q.isEmpty() && now - q.peekFirst() > WINDOW_MS) q.removeFirst();
        while (!all.isEmpty() && now - all.peekFirst() > WINDOW_MS) all.removeFirst();
        if (q.size() >= MAX) return Math.max(1, (WINDOW_MS - (now - q.peekFirst())) / 1000);
        if (all.size() >= MAX_TOTAL) return Math.max(1, (WINDOW_MS - (now - all.peekFirst())) / 1000);
        q.addLast(now);
        all.addLast(now);
        return 0;
    }

    public synchronized void succeeded(String ip) {
        failures.remove(ip);
        all.pollLast(); // the reserved slot was not a failure
    }
}
