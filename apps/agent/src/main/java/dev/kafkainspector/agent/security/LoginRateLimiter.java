package dev.kafkainspector.agent.security;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/** At most 5 failed sign-in attempts per minute per IP (AGENT_API "Auth"); a successful sign-in clears the count. */
@Component
public class LoginRateLimiter {
    private static final int MAX = 5;
    private static final long WINDOW_MS = 60_000;
    private final Map<String, Deque<Long>> failures = new ConcurrentHashMap<>();

    /** Seconds to wait before another attempt, or 0 if allowed. */
    public synchronized long check(String ip) {
        long now = System.currentTimeMillis();
        Deque<Long> q = failures.computeIfAbsent(ip, k -> new ArrayDeque<>());
        while (!q.isEmpty() && now - q.peekFirst() > WINDOW_MS) q.removeFirst();
        return q.size() >= MAX ? Math.max(1, (WINDOW_MS - (now - q.peekFirst())) / 1000) : 0;
    }

    public synchronized void failed(String ip) {
        failures.computeIfAbsent(ip, k -> new ArrayDeque<>()).addLast(System.currentTimeMillis());
    }

    public synchronized void succeeded(String ip) {
        failures.remove(ip);
    }
}
