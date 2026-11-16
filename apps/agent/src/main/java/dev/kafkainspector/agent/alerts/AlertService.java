package dev.kafkainspector.agent.alerts;

import dev.kafkainspector.agent.kafka.ClusterState;
import dev.kafkainspector.agent.kafka.Views;
import dev.kafkainspector.agent.lag.Lag;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Predicate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Alert rules and evaluator (F-80…F-83): the simulator's rule model and conditions. App data — allowed read-only. */
@Service
public class AlertService {
    private static final Set<String> METRICS = Set.of("lag", "group-status", "topic-silent", "under-replicated", "broker-offline", "dlq-receiving");
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(AlertService.class);
    private final JdbcTemplate jdbc;
    private final Map<String, Long> pending = new ConcurrentHashMap<>();

    public AlertService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record Scope(String kind, String target) {}

    public record Rule(String id, String name, String metric, Scope scope, Double threshold, int durationSec, String severity, List<String> channels, boolean enabled, Boolean muted, String state) {}

    public record Event(String id, String ruleId, String severity, String title, String evidence, String target, String href, String state, String firedAt, String resolvedAt, String mutedUntil, Boolean acknowledged) {}

    public List<Rule> rules() {
        return jdbc.query("SELECT * FROM alert_rule WHERE deleted = FALSE ORDER BY name, id", (rs, i) -> new Rule(rs.getString("id"), rs.getString("name"), rs.getString("metric"), new Scope(rs.getString("scope_kind"), rs.getString("scope_target")),
                rs.getObject("threshold") == null ? null : rs.getDouble("threshold"), rs.getInt("duration_sec"), rs.getString("severity"), java.util.Arrays.stream(rs.getString("channels").split(",")).filter(c -> !c.isBlank()).toList(), rs.getBoolean("enabled"), rs.getBoolean("muted"), stateOf(rs.getString("id"))));
    }

    private String stateOf(String ruleId) {
        Integer firing = jdbc.queryForObject("SELECT COUNT(*) FROM alert_event WHERE rule_id = ? AND state = 'firing'", Integer.class, ruleId);
        if (firing != null && firing > 0) return "firing";
        return pending.keySet().stream().anyMatch(k -> k.contains("|" + ruleId + "|")) ? "pending" : "ok";
    }

    public Rule save(Rule r) {
        if (r.name() == null || r.name().isBlank()) throw new IllegalArgumentException("Give the rule a name.");
        if (r.metric() == null) throw new IllegalArgumentException("Choose a metric.");
        if (r.severity() == null) throw new IllegalArgumentException("Choose a severity: info, warn or crit.");
        if (!METRICS.contains(r.metric())) throw new IllegalArgumentException("Unknown metric " + r.metric() + ". Use one of " + METRICS + ".");
        if (r.durationSec() < 0) throw new IllegalArgumentException("Duration can't be negative.");
        if (r.threshold() != null && (r.threshold().isNaN() || r.threshold().isInfinite() || r.threshold() < 0)) throw new IllegalArgumentException("The threshold must be a number of 0 or more.");
        if (r.name().length() > 200) throw new IllegalArgumentException("Rule names are limited to 200 characters.");
        if (!List.of("info", "warn", "crit").contains(r.severity())) throw new IllegalArgumentException("Severity must be info, warn or crit.");
        if (r.scope() != null && (r.scope().kind() == null || !List.of("any", "specific").contains(r.scope().kind()))) throw new IllegalArgumentException("Scope kind must be any or specific.");
        if (r.channels() != null && String.join(",", r.channels()).length() > 100) throw new IllegalArgumentException("Too many channels.");
        boolean create = r.id() == null || r.id().isBlank();
        String id = create ? "r_" + java.util.UUID.randomUUID().toString().substring(0, 12) : r.id();
        String scopeKind = r.scope() == null ? "any" : r.scope().kind();
        String scopeTarget = r.scope() == null ? null : r.scope().target();
        // omitted → in-app; an explicit empty list means "no notifications" (as the demo keeps it), not in-app
        String channels = String.join(",", r.channels() == null ? List.of("in-app") : r.channels());
        // a deleted rule stays deleted: PUT on its id is a 404, not a revival
        int updated = jdbc.update("UPDATE alert_rule SET name = ?, metric = ?, scope_kind = ?, scope_target = ?, threshold = ?, duration_sec = ?, severity = ?, channels = ?, enabled = ?, muted = ? WHERE id = ? AND deleted = FALSE",
                r.name(), r.metric(), scopeKind, scopeTarget, r.threshold(), r.durationSec(), r.severity(), channels, r.enabled(), Boolean.TRUE.equals(r.muted()), id);
        if (updated == 0 && !create) throw new dev.kafkainspector.agent.config.Clusters.NotFound("RULE_NOT_FOUND", "Alert rule " + id + " doesn't exist.");
        if (updated == 0) {
            jdbc.update("INSERT INTO alert_rule VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", id, r.name(), r.metric(), scopeKind, scopeTarget, r.threshold(), r.durationSec(), r.severity(), channels, r.enabled(), Boolean.TRUE.equals(r.muted()), false);
        }
        return rules().stream().filter(x -> x.id().equals(id)).findFirst().orElseThrow();
    }

    /** Soft delete: the rule disappears and its firing alerts resolve (rules are few; history pruning covers events). */
    public void remove(String id) {
        jdbc.update("UPDATE alert_rule SET deleted = TRUE, enabled = FALSE WHERE id = ?", id);
        jdbc.update("UPDATE alert_event SET state = 'resolved', resolved_at = ? WHERE rule_id = ? AND state = 'firing'", System.currentTimeMillis(), id);
        pending.keySet().removeIf(k -> k.contains("|" + id + "|")); // its timers go with it (evaluate only visits live rules)
    }

    public List<Event> events(String state, int limit) {
        String where = state == null || "all".equals(state) ? "" : "firing".equals(state) ? " WHERE state = 'firing'" : " WHERE state = 'resolved'";
        int n = Math.max(1, Math.min(limit, 500));
        // firing first: a long-running alert must not drop off the list behind newer resolved ones
        return jdbc.query("SELECT * FROM alert_event" + where + " ORDER BY CASE WHEN state = 'firing' THEN 0 ELSE 1 END, fired_at DESC LIMIT " + n, (rs, i) -> new Event(rs.getString("id"), rs.getString("rule_id"), rs.getString("severity"), rs.getString("title"), rs.getString("evidence"), rs.getString("target"), rs.getString("href"), rs.getString("state"),
                iso(rs.getLong("fired_at")), rs.getObject("resolved_at") == null ? null : iso(rs.getLong("resolved_at")), rs.getObject("muted_until") == null ? null : iso(rs.getLong("muted_until")), rs.getBoolean("acknowledged")));
    }

    public void mute(String id, String until) {
        if (until == null) throw new IllegalArgumentException("Give \"until\" as an ISO 8601 time.");
        long t;
        try {
            t = Instant.parse(until).toEpochMilli();
        } catch (ArithmeticException e) {
            throw new IllegalArgumentException("\"until\" is too far in the future.");
        }
        long now = System.currentTimeMillis();
        if (t <= now) throw new IllegalArgumentException("\"until\" must be in the future.");
        if (t > now + 365L * 24 * 3_600_000) throw new IllegalArgumentException("Mute for a year at most.");
        if (jdbc.update("UPDATE alert_event SET muted_until = ? WHERE id = ?", t, id) == 0) throw notFound(id);
    }

    public void acknowledge(String id) {
        if (jdbc.update("UPDATE alert_event SET acknowledged = TRUE WHERE id = ?", id) == 0) throw notFound(id);
    }

    private static RuntimeException notFound(String id) {
        return new dev.kafkainspector.agent.config.Clusters.NotFound("ALERT_NOT_FOUND", "Alert " + id + " doesn't exist.");
    }

    /** Active alerts of one cluster: its Overview tile and sidebar badge mustn't count another cluster's. */
    public int firingCount(String cid) {
        Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM alert_event WHERE cluster = ? AND state = 'firing' AND acknowledged = FALSE AND (muted_until IS NULL OR muted_until < ?)", Integer.class, cid, System.currentTimeMillis());
        return n == null ? 0 : n;
    }

    private static String iso(long t) {
        return Instant.ofEpochMilli(t).toString();
    }

    /**
     * Group ids come from anyone who can join a group on the cluster: values are cut to their columns (an
     * over-long one must not fail the insert and silence alerting) and names in links are URL-encoded.
     */
    private record Hit(String target, String title, String evidence, String href) {
        Hit {
            target = cut(target, 2000);
            title = cut(title, 2000);
            evidence = cut(evidence, 400);
            if (href.length() > 2000) href = "/app/";
        }
    }

    private static String cut(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max - 1) + "…";
    }

    private static String enc(String s) {
        return java.net.URLEncoder.encode(s, java.nio.charset.StandardCharsets.UTF_8);
    }

    private List<Hit> conditions(Rule r, ClusterState s, long now) {
        List<Hit> out = new ArrayList<>();
        Predicate<String> inScope = t -> r.scope() == null || !"specific".equals(r.scope().kind()) || t.equals(r.scope().target());
        double threshold = r.threshold() == null ? 0 : r.threshold();
        switch (r.metric()) {
            case "lag" -> s.groups.values().forEach(g -> {
                long lag = Views.groupLag(s, g);
                if (!g.type.equals("share") && !g.members.isEmpty() && inScope.test(g.groupId) && lag > threshold) {
                    out.add(new Hit(g.groupId, g.groupId + " lag above " + String.format("%,d", (long) threshold), String.format("%,d behind", lag), "/app/groups/view/?id=" + enc(g.groupId)));
                }
            });
            case "group-status" -> s.groups.values().forEach(g -> {
                if (inScope.test(g.groupId) && (g.status == Lag.Status.stalled || g.status == Lag.Status.stopped)) {
                    out.add(new Hit(g.groupId, g.groupId + " " + g.status, String.format("%,d behind", Views.groupLag(s, g)), "/app/groups/view/?id=" + enc(g.groupId)));
                }
            });
            case "under-replicated" -> {
                long urp = s.topics.values().stream().flatMap(t -> t.partitions.stream()).filter(p -> p.isr.size() < p.replicas.size()).count();
                if (urp > threshold) out.add(new Hit("cluster", urp + (urp == 1 ? " partition" : " partitions") + " under-replicated", "ISR smaller than the replica set", "/app/topics/?view=attention"));
            }
            case "broker-offline" -> s.brokers.forEach(b -> {
                if (!b.online() && inScope.test("broker-" + b.id())) out.add(new Hit("broker-" + b.id(), "Broker " + b.id() + " offline", "Not reachable by the controller", "/app/brokers/"));
            });
            case "topic-silent" -> s.topics.values().forEach(t -> {
                long last = t.partitions.stream().mapToLong(p -> p.lastMessageAt).max().orElse(0);
                boolean consumed = s.groups.values().stream().anyMatch(g -> g.committed.containsKey(t.name));
                if (!t.internal && consumed && inScope.test(t.name) && last > 0 && now - last > r.durationSec() * 1000L) {
                    out.add(new Hit(t.name, t.name + " is silent", "No messages for " + ((now - last) / 60000) + " min", "/app/topics/view/?name=" + enc(t.name)));
                }
            });
            case "dlq-receiving" -> s.topics.values().forEach(t -> {
                if ((t.name.endsWith(".dlq") || t.name.endsWith("-dlq")) && inScope.test(t.name) && t.rate() > threshold) {
                    out.add(new Hit(t.name, t.name + " is receiving messages", String.format("%.1f/s", t.rate()), "/app/topics/view/?name=" + enc(t.name) + "&tab=messages"));
                }
            });
            default -> {
                // unknown metric: nothing to evaluate
            }
        }
        return out;
    }

    /** The cluster couldn't be sampled: pending durations restart once it can. */
    public void forgetPending(String cid) {
        pending.keySet().removeIf(k -> k.startsWith(cid + "|"));
    }

    /** Clusters no longer configured can't resolve their own alerts: resolve them at startup. */
    public void resolveOrphans(Collection<String> configured, long now) {
        for (String c : jdbc.queryForList("SELECT DISTINCT cluster FROM alert_event WHERE state = 'firing'", String.class))
            if (!configured.contains(c)) jdbc.update("UPDATE alert_event SET state = 'resolved', resolved_at = ? WHERE cluster = ? AND state = 'firing'", now, c);
    }

    /** Runs after each sampler pass. */
    public synchronized void evaluate(String cid, ClusterState s, long now) {
        for (Rule r : rules()) {
            if (!r.enabled()) {
                // a rule switched off stops firing now, and starts its duration afresh when switched back on
                jdbc.update("UPDATE alert_event SET state = 'resolved', resolved_at = ? WHERE cluster = ? AND rule_id = ? AND state = 'firing'", now, cid, r.id());
                pending.keySet().removeIf(k -> k.startsWith(cid + "|" + r.id() + "|"));
                continue;
            }
            Set<String> active = new HashSet<>();
            for (Hit h : conditions(r, s, now)) {
                String k = cid + "|" + r.id() + "|" + h.target();
                active.add(k);
                pending.putIfAbsent(k, now);
                try { // one hit that can't be stored must not stop the other hits and rules
                    List<String> firing = jdbc.queryForList("SELECT id FROM alert_event WHERE cluster = ? AND rule_id = ? AND target = ? AND state = 'firing'", String.class, cid, r.id(), h.target());
                    if (!firing.isEmpty()) {
                        jdbc.update("UPDATE alert_event SET title = ?, evidence = ? WHERE id = ?", h.title(), h.evidence(), firing.get(0));
                    } else if (!Boolean.TRUE.equals(r.muted()) && ("topic-silent".equals(r.metric()) || now - pending.get(k) >= r.durationSec() * 1000L)) {
                        String id = "al_" + Long.toString(now, 36) + Integer.toString(Math.abs(k.hashCode()), 36);
                        jdbc.update("INSERT INTO alert_event VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", id, cid, r.id(), r.severity(), h.title(), h.evidence(), h.target(), h.href(), "firing", now, null, null, false);
                    }
                } catch (RuntimeException e) {
                    log.warn("Alert rule {}: couldn't record {}: {}", r.id(), h.target(), e.getMessage());
                }
            }
            for (String target : jdbc.queryForList("SELECT target FROM alert_event WHERE cluster = ? AND rule_id = ? AND state = 'firing'", String.class, cid, r.id())) {
                if (!active.contains(cid + "|" + r.id() + "|" + target)) {
                    jdbc.update("UPDATE alert_event SET state = 'resolved', resolved_at = ? WHERE cluster = ? AND rule_id = ? AND target = ? AND state = 'firing'", now, cid, r.id(), target);
                }
            }
            pending.keySet().removeIf(k -> k.startsWith(cid + "|" + r.id() + "|") && !active.contains(k));
        }
    }
}
