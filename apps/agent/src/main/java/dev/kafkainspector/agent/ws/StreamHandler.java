package dev.kafkainspector.agent.ws;

import dev.kafkainspector.agent.alerts.AlertService;
import dev.kafkainspector.agent.api.Dto;
import dev.kafkainspector.agent.config.Clusters;
import dev.kafkainspector.agent.kafka.ClusterState;
import dev.kafkainspector.agent.kafka.MessageService;
import dev.kafkainspector.agent.kafka.Sampler;
import dev.kafkainspector.agent.kafka.Views;
import java.io.IOException;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.EventListener;
import org.springframework.security.web.session.HttpSessionDestroyedEvent;
import org.springframework.security.web.session.HttpSessionEventPublisher;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.socket.server.support.HttpSessionHandshakeInterceptor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Live stream (AGENT_API "Live stream"): {op:"sub", id, cluster, channel}, {op:"tail", id, cluster, topic, partition, maxRate},
 * {op:"unsub", id}. Server sends {id, channel, ts, data} at most once per second per subscription, and {op:"ping"} every 20 s.
 * Slow clients: the send buffer is bounded; when it overflows the oldest data is dropped (ConcurrentWebSocketSessionDecorator).
 */
@Configuration
@EnableWebSocket
public class StreamHandler extends TextWebSocketHandler implements WebSocketConfigurer {
    private final JsonMapper json;
    private final Sampler sampler;
    private final MessageService messages;
    private final AlertService alerts;
    private final Clusters clusters;
    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
    private final Map<String, Map<String, String[]>> subs = new ConcurrentHashMap<>(); // session → id → [cluster, channel]
    private final Map<String, Runnable> tails = new ConcurrentHashMap<>(); // session|id → stop
    private static final int MAX_TAILS = 8;
    private final ScheduledExecutorService pinger = Executors.newSingleThreadScheduledExecutor(Thread.ofVirtual().factory());

    public StreamHandler(JsonMapper json, Sampler sampler, MessageService messages, AlertService alerts, Clusters clusters) {
        this.json = json;
        this.sampler = sampler;
        this.messages = messages;
        this.alerts = alerts;
        this.clusters = clusters;
        sampler.onSample(this::broadcast);
        pinger.scheduleAtFixedRate(() -> sessions.values().forEach(s -> send(s, Map.of("op", "ping"))), 20, 20, TimeUnit.SECONDS);
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry r) {
        // Default origin policy = same origin only. SameSite ignores ports, so another service on this host could
        // otherwise open a socket with the session cookie. The HTTP session id is kept to close sockets on logout.
        r.addHandler(this, "/api/stream").addInterceptors(new HttpSessionHandshakeInterceptor());
    }

    /** Lets Spring publish session-destroyed events (logout, 12 h expiry). */
    @Bean
    public static HttpSessionEventPublisher httpSessionEventPublisher() {
        return new HttpSessionEventPublisher();
    }

    /** A signed-out or expired session ends its live streams too. */
    @EventListener
    public void onSessionEnd(HttpSessionDestroyedEvent e) {
        for (WebSocketSession s : sessions.values()) {
            if (!e.getId().equals(s.getAttributes().get(HttpSessionHandshakeInterceptor.HTTP_SESSION_ID_ATTR_NAME))) continue;
            try {
                s.close(CloseStatus.POLICY_VIOLATION.withReason("Signed out"));
            } catch (IOException ignored) {
                // already closing
            }
        }
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession s) {
        sessions.put(s.getId(), new ConcurrentWebSocketSessionDecorator(s, 10_000, 4 * 1024 * 1024, ConcurrentWebSocketSessionDecorator.OverflowStrategy.DROP));
        subs.put(s.getId(), new ConcurrentHashMap<>());
    }

    @Override
    public void afterConnectionClosed(WebSocketSession s, CloseStatus status) {
        sessions.remove(s.getId());
        subs.remove(s.getId());
        tails.entrySet().removeIf(e -> {
            if (!e.getKey().startsWith(s.getId() + "|")) return false;
            e.getValue().run();
            return true;
        });
    }

    @Override
    protected void handleTextMessage(WebSocketSession raw, TextMessage msg) {
        WebSocketSession s = sessions.get(raw.getId());
        JsonNode m = json.readTree(msg.getPayload());
        String op = m.path("op").asString(""), id = m.path("id").asString(UUID.randomUUID().toString()), cid = m.path("cluster").asString("");
        switch (op) {
            case "sub" -> {
                clusters.get(cid);
                String channel = m.path("channel").asString("metrics");
                subs.get(raw.getId()).put(id, new String[] {cid, channel});
                ClusterState st = sampler.state(cid);
                if (st.ts > 0) push(s, id, cid, channel, st);
            }
            case "tail" -> {
                clusters.get(cid);
                int maxRate = Math.max(1, Math.min(500, m.path("maxRate").asInt(50)));
                String prefix = raw.getId() + "|";
                if (tails.keySet().stream().filter(k -> k.startsWith(prefix)).count() >= MAX_TAILS) {
                    send(s, Map.of("id", id, "channel", "tail", "ts", Instant.now().toString(), "error", "Too many live tails on this connection (" + MAX_TAILS + ")."));
                    return;
                }
                Runnable stop = messages.tail(cid, m.path("topic").asString(), m.path("partition").asString("all"), maxRate, batch -> send(s, Map.of("id", id, "channel", "tail", "ts", Instant.now().toString(), "data", batch)),
                        err -> {
                            tails.remove(prefix + id); // ended: frees its slot under MAX_TAILS
                            send(s, Map.of("id", id, "channel", "tail", "ts", Instant.now().toString(), "error", err));
                        });
                Runnable old = tails.put(prefix + id, stop);
                if (old != null) old.run(); // same id re-sent: replace, don't leak the old consumer
                if (!raw.isOpen() && tails.remove(prefix + id) != null) stop.run(); // closed while we registered
            }
            case "unsub" -> {
                subs.getOrDefault(raw.getId(), Map.of()).remove(id);
                Runnable stop = tails.remove(raw.getId() + "|" + id);
                if (stop != null) stop.run();
            }
            default -> {
                // pong or unknown: ignore
            }
        }
    }

    private void broadcast(String cid, ClusterState st) {
        subs.forEach((sid, m) -> m.forEach((id, sub) -> {
            if (sub[0].equals(cid)) push(sessions.get(sid), id, cid, sub[1], st);
        }));
    }

    private void push(WebSocketSession s, String id, String cid, String channel, ClusterState st) {
        if (s == null) return;
        Object data = switch (channel) {
            case "metrics" -> Views.overview(cid, clusters.get(cid), st, alerts.firingCount(), Map.of());
            case "lag" -> st.groups.values().stream().map(g -> Views.group(st, g, List.of())).toList();
            case "events" -> {
                synchronized (st.events) {
                    yield new ArrayList<>(st.events).subList(0, Math.min(30, st.events.size()));
                }
            }
            case "alerts" -> alerts.events("firing", 100);
            default -> null;
        };
        if (data != null) send(s, Map.of("id", id, "channel", channel, "ts", Instant.now().toString(), "data", data));
    }

    private void send(WebSocketSession s, Object payload) {
        if (s == null || !s.isOpen()) return;
        try {
            s.sendMessage(new TextMessage(json.writeValueAsString(payload)));
        } catch (IOException | IllegalStateException e) {
            // client went away; cleanup happens in afterConnectionClosed
        } catch (RuntimeException e) {
            // e.g. SessionLimitExceededException (send stuck > 10 s): drop this client, never the pinger or broadcast
            try {
                s.close(CloseStatus.SESSION_NOT_RELIABLE);
            } catch (IOException ignored) {
                // already closed
            }
        }
    }

    static List<Dto.ClusterEvent> none() {
        return List.of();
    }
}
