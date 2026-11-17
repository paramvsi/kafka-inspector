package dev.kafkainspector.agent.kafka;

import dev.kafkainspector.agent.api.Dto;
import dev.kafkainspector.agent.config.KiProperties;
import dev.kafkainspector.agent.lag.Lag;
import java.time.Instant;
import java.util.*;

/** Builds API shapes from cluster snapshots — same rules as the simulator so both modes read the same. */
public final class Views {
    private Views() {}

    static String iso(long t) {
        return t <= 0 ? null : Instant.ofEpochMilli(t).toString();
    }

    public static long groupLag(ClusterState s, ClusterState.GroupSnap g) {
        long lag = 0;
        for (var te : g.committed.entrySet()) {
            ClusterState.TopicSnap t = s.topics.get(te.getKey());
            if (t == null) continue;
            for (var pe : te.getValue().entrySet()) {
                for (ClusterState.PartSnap p : t.partitions) if (p.partition == pe.getKey()) lag += Math.max(0, p.high - pe.getValue());
            }
        }
        return lag;
    }

    public static String status(ClusterState s) {
        if (!s.connected) return "disconnected";
        boolean down = s.brokers.stream().anyMatch(b -> !b.online());
        boolean offline = s.topics.values().stream().flatMap(t -> t.partitions.stream()).anyMatch(p -> p.leader == null);
        return down || offline ? "degraded" : "connected";
    }

    public static Dto.ClusterSummary summary(String cid, KiProperties.Cluster c, ClusterState s) {
        return new Dto.ClusterSummary(cid, c.name(), null, status(s), s.brokers.size(), s.kafkaVersion, c.schemaRegistry() != null && !c.schemaRegistry().isBlank());
    }

    // ── topics ──

    private static int consumersOf(ClusterState s, String topic) {
        // committed offsets, or a member assigned to it (share groups don't commit offsets)
        return (int) s.groups.values().stream()
                .filter(g -> g.committed.containsKey(topic) || g.members.stream().anyMatch(m -> m.assignments.stream().anyMatch(a -> a[0].equals(topic))))
                .count();
    }

    private static String offlineLabel(long n) {
        return n + (n == 1 ? " partition" : " partitions") + " offline";
    }

    public static List<Dto.HealthFinding> health(ClusterState s, ClusterState.TopicSnap t) {
        List<Dto.HealthFinding> out = new ArrayList<>();
        long offline = t.partitions.stream().filter(p -> p.leader == null).count();
        if (offline > 0) out.add(new Dto.HealthFinding("offline", "crit", offlineLabel(offline), "Bring the brokers holding its replicas back; until then nothing can be produced to or read from those partitions."));
        if (t.internal) return out;
        int rf = t.partitions.isEmpty() ? 0 : t.partitions.get(0).replicas.size();
        int minIsr = parseInt(t.configs.get("min.insync.replicas"), 1);
        if (rf == 1) out.add(new Dto.HealthFinding("rf1", "warn", "RF 1", "Increase the replication factor to 3 so a single broker failure does not lose data."));
        if (rf >= 3 && minIsr < 2) out.add(new Dto.HealthFinding("low-min-isr", "warn", "min.insync.replicas " + minIsr, "Set min.insync.replicas to 2 with acks=all."));
        if (consumersOf(s, t.name) == 0 && !t.name.endsWith(".dlq")) out.add(new Dto.HealthFinding("no-consumers", "info", "No consumers", "Nothing reads this topic. Delete it or lower its retention to save disk."));
        if ("-1".equals(t.configs.get("retention.ms")) && !"compact".equals(t.configs.get("cleanup.policy"))) out.add(new Dto.HealthFinding("infinite-retention", "info", "Infinite retention", "Set retention.ms or use compaction so the topic stops growing."));
        double total = t.rate();
        if (t.partitions.size() > 2 && total > 1) {
            ClusterState.PartSnap hot = t.partitions.stream().max(Comparator.comparingDouble(p -> p.rate)).orElseThrow();
            double share = hot.rate / total;
            if (share > 2.0 / t.partitions.size()) out.add(new Dto.HealthFinding("skew", "warn", "Skew " + Math.round(share * 100) + "%", "Partition " + hot.partition + " takes " + Math.round(share * 100) + "% of the traffic. Use a key with more distinct values."));
        }
        return out;
    }

    static int parseInt(String v, int def) {
        try {
            return v == null ? def : Integer.parseInt(v);
        } catch (NumberFormatException e) {
            return def;
        }
    }

    /**
     * Bytes in per second for the partitions a broker leads, from each one's message rate × average message size.
     * Unknown (null, shown "—") when a led partition takes traffic but its size was never reported: 0 would read as idle.
     */
    public static Double bytesIn(ClusterState s, int broker) {
        double bytesIn = 0;
        for (ClusterState.TopicSnap t : s.topics.values())
            for (ClusterState.PartSnap p : t.partitions) {
                if (!java.util.Objects.equals(p.leader, broker) || p.rate <= 0) continue;
                if (p.sizeBytes < 0) return null;
                bytesIn += p.high > p.low && p.sizeBytes > 0 ? p.rate * p.sizeBytes / (p.high - p.low) : 0;
            }
        return bytesIn;
    }

    public static Dto.TopicSummary topic(ClusterState s, ClusterState.TopicSnap t, List<Double> trend) {
        int rf = t.partitions.isEmpty() ? 0 : t.partitions.get(0).replicas.size();
        // unknown unless every partition's size was reported (the UI shows "—"): a partial sum would read as exact
        Long size = !t.partitions.isEmpty() && t.partitions.stream().allMatch(p -> p.sizeBytes >= 0) ? t.partitions.stream().mapToLong(p -> p.sizeBytes).sum() : null;
        long last = t.partitions.stream().mapToLong(p -> p.lastMessageAt).max().orElse(0);
        int urp = (int) t.partitions.stream().filter(p -> p.isr.size() < p.replicas.size()).count();
        return new Dto.TopicSummary(t.name, t.internal, t.partitions.size(), rf, size, t.rate(), consumersOf(s, t.name), iso(last), urp, health(s, t), trend);
    }

    public static Dto.TopicDetail topicDetail(ClusterState s, ClusterState.TopicSnap t, List<Double> trend, Set<String> subjects) {
        double total = t.rate();
        List<Dto.PartitionInfo> parts = t.partitions.stream().map(p -> new Dto.PartitionInfo(p.partition, p.leader, p.replicas, p.isr, p.low, p.high, total > 0 ? Double.valueOf(p.rate / total * 100) : null /* idle: no share to show */, iso(p.lastMessageAt))).toList();
        List<Dto.TopicConsumer> consumers = new ArrayList<>();
        for (ClusterState.GroupSnap g : s.groups.values()) {
            Map<Integer, Long> c = g.committed.get(t.name);
            if (c == null) {
                // assigned but no commits (or a share group): listed like consumersOf counts it, lag unknown
                boolean assigned = g.members.stream().anyMatch(m -> m.assignments.stream().anyMatch(a -> a[0].equals(t.name)));
                if (assigned) consumers.add(new Dto.TopicConsumer(g.groupId, g.type, null, Lag.Status.unknown.name(), g.state));
                continue;
            }
            long lag = 0;
            List<Lag.Status> st = new ArrayList<>();
            for (var e : c.entrySet()) {
                for (ClusterState.PartSnap p : t.partitions) if (p.partition == e.getKey()) lag += Math.max(0, p.high - e.getValue());
                st.add(g.partStatus.getOrDefault(t.name + "|" + e.getKey(), Lag.Status.unknown));
            }
            consumers.add(new Dto.TopicConsumer(g.groupId, g.type, lag, Lag.rollup(st).name(), g.state));
        }
        Dto.SchemaLink link = subjects.contains(t.name + "-value") || subjects.contains(t.name + "-key") ? new Dto.SchemaLink(subjects.contains(t.name + "-key") ? t.name + "-key" : null, subjects.contains(t.name + "-value") ? t.name + "-value" : null) : null;
        return new Dto.TopicDetail(topic(s, t, trend), parts, consumers, link);
    }

    public static boolean needsAttention(Dto.TopicSummary t) {
        return t.underReplicated() > 0 || t.health().stream().anyMatch(h -> !h.severity().equals("info") || h.id().equals("no-consumers"));
    }

    // ── groups ──

    public static Dto.Forecast forecast(Lag.Forecast f) {
        return new Dto.Forecast(f.kind(), f.seconds(), f.consumeRate(), f.produceRate());
    }

    public static Dto.GroupSummary group(ClusterState s, ClusterState.GroupSnap g, List<Double> trend) {
        // a topic deleted since the group last committed isn't one it reads: Kafka keeps the offsets, the UI shouldn't list them
        List<String> topics = new ArrayList<>(g.committed.keySet().stream().filter(s.topics::containsKey).toList());
        if (topics.isEmpty()) g.members.forEach(m -> m.assignments.forEach(a -> { if (!topics.contains(a[0])) topics.add(a[0]); }));
        Collections.sort(topics);
        return new Dto.GroupSummary(g.groupId, g.type, g.state, g.members.size(), topics, groupLag(s, g), iso(g.lastCommitAt), g.status.name(), forecast(g.forecast), trend);
    }

    public static Dto.GroupDetail groupDetail(ClusterState s, ClusterState.GroupSnap g, List<Double> trend) {
        Map<String, ClusterState.MemberSnap> owner = new HashMap<>();
        g.members.forEach(m -> m.assignments.forEach(a -> owner.put(a[0] + "|" + a[1], m)));
        List<Dto.GroupPartitionLag> parts = new ArrayList<>();
        for (var te : g.committed.entrySet()) {
            ClusterState.TopicSnap t = s.topics.get(te.getKey());
            if (t == null) continue; // topic deleted: its old offsets aren't live rows (committed 48,210 · end 0 · lag 0)
            for (var pe : te.getValue().entrySet()) {
                ClusterState.PartSnap ps = null;
                for (ClusterState.PartSnap p : t.partitions) if (p.partition == pe.getKey()) ps = p;
                if (ps == null) continue; // a partition the topic no longer has (shrunk or re-created)
                long end = ps.high;
                ClusterState.MemberSnap m = owner.get(te.getKey() + "|" + pe.getKey());
                parts.add(new Dto.GroupPartitionLag(te.getKey(), pe.getKey(), g.reportedCommitted.getOrDefault(te.getKey() + "|" + pe.getKey(), pe.getValue()), end, Math.max(0, end - pe.getValue()), m == null ? null : m.memberId, m == null ? null : m.clientId, m == null ? null : m.host,
                        g.partStatus.getOrDefault(te.getKey() + "|" + pe.getKey(), Lag.Status.unknown).name()));
            }
        }
        // assigned but never committed: listed with no committed offset and unknown status (like kafka-consumer-groups' "-")
        owner.forEach((k, m) -> {
            String[] tp = k.split("\\|");
            int part = Integer.parseInt(tp[1]);
            if (g.committed.getOrDefault(tp[0], Map.of()).containsKey(part)) return;
            long end = 0;
            ClusterState.TopicSnap t = s.topics.get(tp[0]);
            if (t != null) for (ClusterState.PartSnap p : t.partitions) if (p.partition == part) end = p.high;
            parts.add(new Dto.GroupPartitionLag(tp[0], part, null, end, 0, m.memberId, m.clientId, m.host, Lag.Status.unknown.name()));
        });
        parts.sort(Comparator.comparingLong(Dto.GroupPartitionLag::lag).reversed());
        List<Dto.GroupMember> members = g.members.stream().map(m -> new Dto.GroupMember(m.memberId, m.clientId, m.host, m.assignments.stream().map(a -> new Dto.Assignment(a[0], Integer.parseInt(a[1]))).toList())).toList();
        // rule 7: the Admin API doesn't report in-flight records or delivery counts, so nothing is invented here
        Map<String, Object> share = null;
        return new Dto.GroupDetail(group(s, g, trend), parts, members, share);
    }

    // ── overview ──

    public static Dto.Overview overview(String cid, KiProperties.Cluster c, ClusterState s, int activeAlerts, Map<String, List<Double>> groupTrends) {
        int urp = 0, offline = 0, total = 0, underMin = 0;
        for (ClusterState.TopicSnap t : s.topics.values()) {
            int minIsr = parseInt(t.configs.get("min.insync.replicas"), 1);
            for (ClusterState.PartSnap p : t.partitions) {
                total++;
                if (p.isr.size() < p.replicas.size()) urp++;
                if (p.leader == null) offline++;
                if (p.replicas.size() > 1 && p.isr.size() < minIsr) underMin++;
            }
        }
        long lag = 0;
        for (ClusterState.GroupSnap g : s.groups.values()) if (!g.type.equals("share") && !g.members.isEmpty()) lag += groupLag(s, g);
        String trend = s.totalLagPrev < 0 ? "steady" : lag > s.totalLagPrev * 1.02 + 10 ? "rising" : lag < s.totalLagPrev * 0.98 - 10 ? "falling" : "steady";
        List<Dto.GroupSummary> groups = s.groups.values().stream().map(g -> group(s, g, groupTrends.getOrDefault(g.groupId, List.of()))).sorted(WORST_FIRST).toList();
        int online = (int) s.brokers.stream().filter(ClusterState.BrokerSnap::online).count();
        Dto.Kpis k = new Dto.Kpis(s.messagesIn, s.messagesOut, s.bytesIn, lag, trend, urp, total, online, s.brokers.size(), offline, underMin, s.controller, activeAlerts, s.topics.size(), s.groups.size());
        List<Dto.ClusterEvent> events;
        synchronized (s.events) {
            events = new ArrayList<>(s.events).subList(0, Math.min(30, s.events.size()));
        }
        return new Dto.Overview(summary(cid, c, s), k, attention(s, groups, urp, offline), groups, events);
    }

    /** Groups worst first: stalled, stopped, warn, unknown, healthy; then by lag (overview and the groups list). */
    public static final Comparator<Dto.GroupSummary> WORST_FIRST =
            Comparator.comparingInt((Dto.GroupSummary g) -> rank(g.status())).thenComparing(Comparator.comparingLong(Dto.GroupSummary::totalLag).reversed());

    private static int rank(String status) {
        return switch (status) {
            case "stalled" -> 0;
            case "stopped" -> 1;
            case "warn" -> 2;
            case "unknown" -> 3;
            default -> 4;
        };
    }

    /** When the problem started, as the simulator reports it: a stall since its partition froze, a stop since the last commit. */
    private static String since(ClusterState s, String groupId, String status, String now) {
        ClusterState.GroupSnap g = s.groups.get(groupId);
        if (g == null) return now;
        // the onset is when the partitions with that status last moved (another partition may still be moving)
        if (status.equals("stalled") || status.equals("stopped")) {
            long frozen = stuckSince(s, g, Lag.Status.valueOf(status));
            if (frozen > 0) return iso(frozen);
        }
        return now;
    }

    /** Port of core's formatEta (ARCHITECTURE "Forecast" format, rule 9): "under a minute" · "~14 min" · "~3 h". */
    static String eta(double seconds) {
        if (!Double.isFinite(seconds)) return "—"; // unknown, as packages/core formatEta
        if (seconds < 60) return "under a minute";
        long min = Math.round(seconds / 60);
        if (min < 120) return "~" + min + " min";
        return "~" + Math.round(seconds / 3600) + " h";
    }

    /** 6m 12s · 45s · 2h 5m · 3d 4h — packages/core formatDuration, so agent and demo text read alike. */
    public static String duration(long ms) {
        long s = Math.max(0, Math.round(ms / 1000.0));
        if (s < 60) return s + "s";
        long m = s / 60;
        if (m < 60) return m + "m " + (s % 60) + "s";
        long h = m / 60;
        if (h < 48) return h + "h " + (m % 60) + "m";
        return (h / 24) + "d " + (h % 24) + "h";
    }

    /** When the earliest of a group's partitions in `status` last moved (0 = unknown). */
    static long stuckSince(ClusterState s, ClusterState.GroupSnap g, Lag.Status status) {
        return g.partStatus.entrySet().stream().filter(e -> e.getValue() == status)
                .mapToLong(e -> s.lastChange.getOrDefault(g.groupId + "|" + e.getKey(), 0L)).filter(x -> x > 0).min().orElse(0);
    }

    /** The demo's line for a stalled or stopped group (sim.ts groupDetailLine); null for any other status.
     * A stop reads from the last commit of any partition ("no commits at all"), while its "since" is the onset. */
    public static String stuckLine(ClusterState s, ClusterState.GroupSnap g, long lag) {
        if (g.status == Lag.Status.stalled) {
            List<String> stuck = g.partStatus.entrySet().stream().filter(e -> e.getValue() == Lag.Status.stalled).map(Map.Entry::getKey).sorted().toList();
            if (stuck.isEmpty()) return null;
            String where = stuck.size() == 1 ? "Partition " + stuck.get(0).substring(stuck.get(0).lastIndexOf('|') + 1) : stuck.size() + " partitions";
            long first = stuckSince(s, g, Lag.Status.stalled);
            return first > 0 ? where + " · same offset for " + duration(s.ts - first) : where + " · same offset";
        }
        if (g.status == Lag.Status.stopped && g.lastCommitAt > 0)
            return "No commits for " + duration(s.ts - g.lastCommitAt) + " · " + String.format("%,d behind", lag);
        return null;
    }

    static List<Dto.AttentionItem> attention(ClusterState s, List<Dto.GroupSummary> groups, int urp, int offline) {
        // first-seen per item, like the demo: an offline broker reads "since 03:12", not "just now" every sample
        java.util.function.Function<String, String> firstSeen = id -> iso(s.attentionSince.computeIfAbsent(id, k -> s.ts));
        List<Dto.AttentionItem> items = new ArrayList<>();
        s.brokers.stream().filter(b -> !b.online()).forEach(b -> items.add(new Dto.AttentionItem("broker-" + b.id(), "crit", "Broker " + b.id() + " is offline", b.host() + ":" + b.port() + " · leaders moved to other brokers", firstSeen.apply("broker-" + b.id()), "/app/brokers/", "Investigate broker " + b.id())));
        if (offline > 0) items.add(new Dto.AttentionItem("offline", "crit", offlineLabel(offline), offline == 1 ? "No in-sync replica can lead it" : "No in-sync replica can lead them", firstSeen.apply("offline"), "/app/topics/?view=attention", null));
        if (urp > 0) items.add(new Dto.AttentionItem("urp", "warn", urp + (urp == 1 ? " partition" : " partitions") + " under-replicated", "ISR is smaller than the replica set", firstSeen.apply("urp"), "/app/topics/?view=attention", null));
        for (Dto.GroupSummary g : groups) {
            if (!Set.of("stalled", "stopped", "warn").contains(g.status())) continue;
            ClusterState.GroupSnap gs = s.groups.get(g.groupId());
            String stuck = gs == null ? null : stuckLine(s, gs, g.totalLag());
            String detail = stuck != null ? stuck : String.format("%,d behind", g.totalLag()) + (g.forecast().kind().equals("eta") ? " · catch-up in " + eta(g.forecast().seconds()) : g.status().equals("warn") ? " · won’t catch up at current rates" : "");
            items.add(new Dto.AttentionItem("group-" + g.groupId(), g.status().equals("warn") ? "warn" : "crit", g.groupId() + (g.status().equals("warn") ? " lag rising" : " " + g.status()), detail, since(s, g.groupId(), g.status(), firstSeen.apply("group-" + g.groupId())), "/app/groups/view/?id=" + java.net.URLEncoder.encode(g.groupId(), java.nio.charset.StandardCharsets.UTF_8), "Investigate " + g.groupId()));
        }
        for (ClusterState.TopicSnap t : s.topics.values()) {
            if (t.internal) continue;
            health(s, t).stream().filter(h -> h.id().equals("skew")).findFirst().ifPresent(h -> items.add(new Dto.AttentionItem("skew-" + t.name, "info", t.name + " is skewed", h.fix(), firstSeen.apply("skew-" + t.name), "/app/topics/view/?name=" + t.name + "&tab=partitions", "Open " + t.name)));
        }
        // severity, then newest first within it (the demo's order)
        items.sort(Comparator.<Dto.AttentionItem>comparingInt(i -> switch (i.severity()) { case "crit" -> 0; case "warn" -> 1; default -> 2; })
                // by time, not by the ISO text: a whole second prints without ".000" and would sort after later times
                .thenComparing((Dto.AttentionItem i) -> Instant.parse(i.since()), Comparator.reverseOrder()));
        // forget items that cleared, so a later recurrence starts its own clock
        s.attentionSince.keySet().removeIf(id -> items.stream().noneMatch(i -> i.id().equals(id)));
        return items;
    }

    // ── topology (producers aren't visible to the Admin API: topics → groups only) ──

    private static final Set<String> NEUTRAL_STATES = Set.of("Empty", "PreparingRebalance", "CompletingRebalance", "Assigning", "Reconciling", "Dead");

    /** Messages per second the group committed on one topic over its last two samples. */
    static double consumeRate(ClusterState s, ClusterState.GroupSnap g, String topic) {
        double rate = 0;
        for (Integer p : g.committed.getOrDefault(topic, Map.of()).keySet()) {
            Deque<Lag.Sample> w = s.windows.get(g.groupId + "|" + topic + "|" + p);
            if (w == null || w.size() < 2) continue;
            Iterator<Lag.Sample> it = w.descendingIterator();
            // the sampler may clear w (topic re-created) between the size check and these reads
            Lag.Sample last = it.hasNext() ? it.next() : null, prev = it.hasNext() ? it.next() : null;
            if (prev == null) continue;
            if (last.committed() != null && prev.committed() != null && last.t() > prev.t())
                rate += Math.max(0, last.committed() - prev.committed()) * 1000.0 / (last.t() - prev.t());
        }
        return rate;
    }

    /** A topic node's colour (as the simulator's topicNodeStatus): a crit finding (offline partitions) gets the map's critical colour, warn amber. */
    static String topicNodeStatus(List<Dto.HealthFinding> h) {
        if (h.stream().anyMatch(x -> x.severity().equals("crit"))) return "stalled";
        return h.stream().anyMatch(x -> x.severity().equals("warn")) ? "warn" : "healthy";
    }

    public static Dto.Topology topology(ClusterState s) {
        List<Dto.TopologyNode> nodes = new ArrayList<>();
        List<Dto.TopologyEdge> edges = new ArrayList<>();
        Set<String> used = new HashSet<>();
        for (ClusterState.GroupSnap g : s.groups.values()) used.addAll(g.committed.keySet());
        for (ClusterState.TopicSnap t : s.topics.values()) {
            if (t.internal || (!used.contains(t.name) && t.rate() == 0)) continue;
            List<Dto.HealthFinding> h = health(s, t);
            Dto.HealthFinding f = h.stream().filter(x -> !x.severity().equals("info")).findFirst().orElse(null);
            nodes.add(new Dto.TopologyNode("topic:" + t.name, "topic", t.name, topicNodeStatus(h), t.rate(), f == null ? null : f.message().replace("Skew", "skew")));
        }
        for (ClusterState.GroupSnap g : s.groups.values()) {
            long lag = groupLag(s, g);
            String note = g.status == Lag.Status.stalled || g.status == Lag.Status.stopped ? g.status.name() : g.type.equals("share") ? "share" : g.status == Lag.Status.warn ? String.format("%,d behind", lag) : null;
            // same as the simulator's isNeutralState: a group between assignments isn't healthy or failing
            boolean neutral = NEUTRAL_STATES.contains(g.state) && g.status == Lag.Status.healthy;
            double groupRate = 0;
            List<Dto.TopologyEdge> mine = new ArrayList<>();
            for (String topic : g.committed.keySet()) {
                if (!s.topics.containsKey(topic)) continue;
                double r = consumeRate(s, g, topic); // what the group reads, not what the topic receives
                groupRate += r;
                mine.add(new Dto.TopologyEdge("topic:" + topic, "group:" + g.groupId, r, "consume"));
            }
            nodes.add(new Dto.TopologyNode("group:" + g.groupId, "group", g.groupId, neutral ? "neutral" : g.status.name(), groupRate, note));
            edges.addAll(mine);
        }
        return new Dto.Topology(nodes, edges);
    }
}
