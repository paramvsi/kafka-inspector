package dev.kafkainspector.agent.kafka;

import dev.kafkainspector.agent.alerts.AlertService;
import dev.kafkainspector.agent.api.Dto;
import dev.kafkainspector.agent.config.Clusters;
import dev.kafkainspector.agent.config.KiProperties;
import dev.kafkainspector.agent.history.HistoryRepository;
import dev.kafkainspector.agent.lag.Lag;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.admin.*;
import org.apache.kafka.clients.consumer.OffsetAndMetadata;
import org.apache.kafka.common.GroupType;
import org.apache.kafka.common.Node;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.TopicPartitionInfo;
import org.apache.kafka.common.config.ConfigResource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Samples every cluster on KI_SAMPLE_INTERVAL: metadata, watermarks, group offsets. Keeps the lag windows,
 * evaluates the shared lag rules, records history and runs the alert evaluator.
 * Kafka's Admin API has no commit timestamps: a frozen offset in a group with members counts as "still committing"
 * (→ Stalled); in an Empty group it counts as no commits (→ Stopped). Documented in AGENT_API.md.
 */
@Component
public class Sampler {
    private static final Logger log = LoggerFactory.getLogger(Sampler.class);
    private final Clusters clusters;
    private final KafkaService kafka;
    private final HistoryRepository history;
    private final AlertService alerts;
    private final KiProperties props;
    private final Map<String, ClusterState> states = new ConcurrentHashMap<>();
    /** cid|topic|partition|committed|end → whether only transaction markers lie between them (cached: offsets only grow) */
    private final Map<String, Boolean> markerOnly = new ConcurrentHashMap<>();
    /** cid|group|topic|partition → "committed:end" at the previous sample: only a gap that holds still is probed (pruned with the windows) */
    private final Map<String, String> lastGap = new ConcurrentHashMap<>();
    private final List<java.util.function.BiConsumer<String, ClusterState>> listeners = new java.util.concurrent.CopyOnWriteArrayList<>();
    private int tick;

    public Sampler(Clusters clusters, KafkaService kafka, HistoryRepository history, AlertService alerts, KiProperties props) {
        this.clusters = clusters;
        this.kafka = kafka;
        this.history = history;
        this.alerts = alerts;
        this.props = props;
        clusters.all().keySet().forEach(id -> states.put(id, new ClusterState()));
        try {
            alerts.resolveOrphans(clusters.all().keySet(), System.currentTimeMillis());
        } catch (RuntimeException e) {
            log.warn("Couldn't resolve alerts of removed clusters: {}", rootMessage(e));
        }
    }

    public ClusterState state(String cid) {
        clusters.get(cid);
        return states.get(cid);
    }

    public void onSample(java.util.function.BiConsumer<String, ClusterState> l) {
        listeners.add(l);
    }

    @Scheduled(fixedDelayString = "${ki.sample-interval:10s}", initialDelay = 0)
    public void sampleAll() {
        tick++;
        for (String cid : clusters.all().keySet()) {
            ClusterState s = states.get(cid);
            try {
                sample(cid, s);
                s.connected = true;
                s.error = null;
            } catch (Exception e) {
                if (s.connected || s.error == null) log.warn("Cluster {} unreachable: {}", cid, rootMessage(e));
                s.connected = false;
                s.error = rootMessage(e);
                kafka.reset(cid);
                alerts.forgetPending(cid); // a condition must hold through samples we actually saw, not across an outage
            }
            for (var l : listeners) {
                // a failing listener (e.g. a DB error while pushing) must not skip the other clusters this tick
                try {
                    l.accept(cid, s);
                } catch (RuntimeException e) {
                    log.warn("Cluster {}: live update failed: {}", cid, rootMessage(e));
                }
            }
        }
    }

    static String rootMessage(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null) t = t.getCause();
        return t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage();
    }

    private void sample(String cid, ClusterState s) throws Exception {
        Admin admin = kafka.admin(cid);
        long now = System.currentTimeMillis();
        long dtMs = s.ts == 0 ? 0 : now - s.ts;

        DescribeClusterResult dc = admin.describeCluster();
        Collection<Node> nodes = dc.nodes().get(20, TimeUnit.SECONDS);
        Node controller = dc.controller().get(20, TimeUnit.SECONDS);
        Set<Integer> online = new HashSet<>();
        nodes.forEach(n -> online.add(n.id()));

        Set<String> names = admin.listTopics(new ListTopicsOptions().listInternal(true)).names().get(20, TimeUnit.SECONDS);
        Map<String, TopicDescription> desc = names.isEmpty() ? Map.of() : admin.describeTopics(names).allTopicNames().get(30, TimeUnit.SECONDS);
        Map<TopicPartition, OffsetSpec> latest = new HashMap<>(), earliest = new HashMap<>();
        desc.values().forEach(d -> d.partitions().forEach(p -> {
            // a leaderless partition can't answer ListOffsets: asking would time the whole sample out and freeze
            // the view exactly when a broker is down — it keeps its last offsets instead
            if (p.leader() == null || p.leader().isEmpty()) return;
            TopicPartition tp = new TopicPartition(d.name(), p.partition());
            latest.put(tp, OffsetSpec.latest());
            earliest.put(tp, OffsetSpec.earliest());
        }));
        Map<TopicPartition, ListOffsetsResult.ListOffsetsResultInfo> hi = latest.isEmpty() ? Map.of() : admin.listOffsets(latest).all().get(30, TimeUnit.SECONDS);
        Map<TopicPartition, ListOffsetsResult.ListOffsetsResultInfo> lo = earliest.isEmpty() ? Map.of() : admin.listOffsets(earliest).all().get(30, TimeUnit.SECONDS);
        // freshness for partitions we haven't seen yet (first sample, new topic): the newest record's timestamp;
        // the "latest" spec only returns an offset (timestamp -1)
        Map<TopicPartition, Long> newestTs = new HashMap<>();
        Map<TopicPartition, OffsetSpec> unseen = new HashMap<>();
        latest.keySet().forEach(tp -> {
            ClusterState.TopicSnap known = s.topics.get(tp.topic());
            if (known == null || known.partitions.stream().noneMatch(x -> x.partition == tp.partition())) unseen.put(tp, OffsetSpec.maxTimestamp());
        });
        if (!unseen.isEmpty()) {
            try {
                admin.listOffsets(unseen).all().get(30, TimeUnit.SECONDS).forEach((tp, r) -> { if (r.timestamp() > 0) newestTs.put(tp, r.timestamp()); });
            } catch (Exception e) {
                log.debug("max-timestamp offsets failed: {}", rootMessage(e));
            }
        }

        // broker disks + partition sizes every 6th sample (describeLogDirs is heavy)
        Map<Integer, long[]> disks = new HashMap<>();
        Map<TopicPartition, Long> sizes = new HashMap<>();
        if (tick % 6 == 1 || s.ts == 0) {
            try {
                Map<Integer, Map<String, LogDirDescription>> dirs = admin.describeLogDirs(online).allDescriptions().get(30, TimeUnit.SECONDS);
                dirs.forEach((b, m) -> {
                    long used = 0, total = 0;
                    for (LogDirDescription ld : m.values()) {
                        for (var e : ld.replicaInfos().entrySet()) {
                            used += e.getValue().size();
                            sizes.merge(e.getKey(), e.getValue().size(), Math::max);
                        }
                        total += ld.totalBytes().orElse(0);
                    }
                    disks.put(b, new long[] {used, total});
                });
            } catch (Exception e) {
                log.debug("describeLogDirs failed: {}", e.getMessage());
            }
        }
        Map<String, Map<String, String>> configs = new HashMap<>();
        // all topics every 30th sample; a topic that appeared since gets its config right away (min ISR etc.)
        boolean full = tick % 30 == 1 || s.ts == 0;
        List<String> wanted = full ? List.copyOf(names) : names.stream().filter(n -> !s.topics.containsKey(n)).toList();
        if (!wanted.isEmpty()) {
            List<ConfigResource> rs = wanted.stream().map(n -> new ConfigResource(ConfigResource.Type.TOPIC, n)).toList();
            // best effort, like describeLogDirs: without DescribeConfigs the cluster still connects (defaults apply)
            try {
                admin.describeConfigs(rs).all().get(30, TimeUnit.SECONDS).forEach((r, cfg) -> {
                    Map<String, String> m = new HashMap<>();
                    cfg.entries().forEach(e -> { if (!e.isDefault() || Set.of("retention.ms", "min.insync.replicas", "cleanup.policy").contains(e.name())) m.put(e.name(), e.value()); });
                    configs.put(r.name(), m);
                });
            } catch (Exception e) {
                log.debug("describeConfigs failed: {}", rootMessage(e));
            }
        }

        // ── topics ──
        Map<String, ClusterState.TopicSnap> topics = new TreeMap<>();
        double msgsIn = 0;
        for (TopicDescription d : desc.values()) {
            ClusterState.TopicSnap prev = s.topics.get(d.name());
            ClusterState.TopicSnap t = new ClusterState.TopicSnap();
            t.name = d.name();
            t.internal = d.isInternal() || d.name().startsWith("_");
            t.configs = configs.getOrDefault(d.name(), prev == null ? Map.of() : prev.configs);
            for (TopicPartitionInfo p : d.partitions()) {
                TopicPartition tp = new TopicPartition(d.name(), p.partition());
                ClusterState.PartSnap ps = new ClusterState.PartSnap();
                ps.partition = p.partition();
                ps.leader = p.leader() == null || p.leader().isEmpty() ? null : p.leader().id();
                p.replicas().forEach(r -> ps.replicas.add(r.id()));
                p.isr().forEach(r -> ps.isr.add(r.id()));
                ClusterState.PartSnap pp = prev == null ? null : prev.partitions.stream().filter(x -> x.partition == p.partition()).findFirst().orElse(null);
                ps.high = hi.containsKey(tp) ? hi.get(tp).offset() : pp != null ? pp.high : 0;
                ps.low = lo.containsKey(tp) ? lo.get(tp).offset() : pp != null ? pp.low : 0;
                ps.rate = pp != null && dtMs > 0 ? Math.max(0, (ps.high - pp.high) * 1000.0 / dtMs) : 0;
                // any change counts as activity: a deleted and re-created topic restarts below the old end
                ps.lastMessageAt = pp == null ? newestTs.getOrDefault(tp, 0L) : ps.high != pp.high ? now : pp.lastMessageAt;
                ps.sizeBytes = sizes.getOrDefault(tp, pp == null ? -1 : pp.sizeBytes);
                if (pp != null && pp.isr.size() != ps.isr.size()) {
                    boolean shrink = ps.isr.size() < pp.isr.size();
                    event(s, now, shrink ? "isr-shrink" : "isr-expand", shrink ? "warn" : "info", (shrink ? "ISR shrank on " : "ISR expanded on ") + d.name() + "-" + p.partition(), "ISR " + ps.isr);
                }
                t.partitions.add(ps);
            }
            t.partitions.sort(Comparator.comparingInt(x -> x.partition));
            if (!t.internal) msgsIn += t.rate();
            topics.put(t.name, t);
        }

        // ── brokers ──
        List<ClusterState.BrokerSnap> brokers = new ArrayList<>();
        // online brokers, plus offline ones that partitions still name: a decommissioned broker drops out
        // ponytail: an offline broker hosting no replicas drops out too (no "down" event for it)
        Set<Integer> known = new TreeSet<>(online);
        topics.values().forEach(t -> t.partitions.forEach(p -> known.addAll(p.replicas)));
        for (int id : known) {
            Node n = nodes.stream().filter(x -> x.id() == id).findFirst().orElse(null);
            ClusterState.BrokerSnap prev = s.brokers.stream().filter(b -> b.id() == id).findFirst().orElse(null);
            long[] disk = disks.get(id);
            brokers.add(new ClusterState.BrokerSnap(id, n != null ? n.host() : prev != null ? prev.host() : "broker-" + id, n != null ? n.port() : prev != null ? prev.port() : 9092, n != null ? n.rack() : prev != null ? prev.rack() : null, online.contains(id),
                    disk != null ? disk[0] : prev != null ? prev.diskUsed() : null, disk != null && disk[1] > 0 ? disk[1] : prev != null ? prev.diskTotal() : null));
            if (prev != null && prev.online() != online.contains(id)) event(s, now, online.contains(id) ? "broker-up" : "broker-down", online.contains(id) ? "info" : "crit", "Broker " + id + (online.contains(id) ? " is back" : " is down"), null);
        }

        // ── groups ──
        Map<String, ClusterState.GroupSnap> groups = new TreeMap<>();
        Set<String> carried = new HashSet<>(); // groups whose offsets this pass are the previous ones (read failed)
        Collection<GroupListing> listings = admin.listGroups(new ListGroupsOptions()).all().get(20, TimeUnit.SECONDS);
        List<String> consumerIds = new ArrayList<>(), shareIds = new ArrayList<>();
        for (GroupListing g : listings) {
            String type = g.type().map(x -> x.toString().toLowerCase()).orElse("unknown");
            if (g.groupId().startsWith("kafka-inspector")) continue;
            // classic groups also carry Schema Registry ("sr") and Connect ("connect") coordination: not consumer groups
            if (g.type().orElse(null) == GroupType.CLASSIC && !g.protocol().isEmpty() && !"consumer".equals(g.protocol())) continue;
            ClusterState.GroupSnap gs = new ClusterState.GroupSnap();
            gs.groupId = g.groupId();
            gs.type = type;
            gs.state = g.groupState().map(Sampler::stateName).orElse("Unknown");
            groups.put(gs.groupId, gs);
            if (g.type().isEmpty() || g.type().get() == GroupType.CLASSIC || g.type().get() == GroupType.CONSUMER) consumerIds.add(gs.groupId);
            else if (g.type().get() == GroupType.SHARE) shareIds.add(gs.groupId);
        }
        if (!consumerIds.isEmpty()) {
            Map<String, ConsumerGroupDescription> described = new HashMap<>();
            // one deadline for the batch, not 20 s per group: a hung coordinator must not stretch a sample into hours
            long describeBy = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
            admin.describeConsumerGroups(consumerIds).describedGroups().forEach((id, f) -> {
                try {
                    described.put(id, f.get(left(describeBy), TimeUnit.NANOSECONDS));
                } catch (Exception e) {
                    groups.remove(id); // one odd group must not fail the whole sample
                    log.debug("describe {} failed: {}", id, e.getMessage());
                }
            });
            consumerIds.retainAll(described.keySet());
            described.forEach((id, d) -> {
                ClusterState.GroupSnap gs = groups.get(id);
                gs.state = stateName(d.groupState());
                if (d.type() != null) gs.type = d.type().toString().toLowerCase();
                d.members().forEach(m -> {
                    ClusterState.MemberSnap ms = new ClusterState.MemberSnap();
                    ms.memberId = m.consumerId();
                    ms.clientId = m.clientId();
                    ms.host = m.host().replaceFirst("^/", "");
                    m.assignment().topicPartitions().forEach(tp -> ms.assignments.add(new String[] {tp.topic(), String.valueOf(tp.partition())}));
                    gs.members.add(ms);
                });
            });
            Map<String, ListConsumerGroupOffsetsSpec> spec = new HashMap<>();
            consumerIds.forEach(id -> spec.put(id, new ListConsumerGroupOffsetsSpec()));
            ListConsumerGroupOffsetsResult offs = admin.listConsumerGroupOffsets(spec);
            long offsetsBy = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
            for (String id : consumerIds) {
                // per group: one group without Describe ACL, or deleted mid-sample, must not fail the cluster
                try {
                    Map<TopicPartition, OffsetAndMetadata> m = offs.partitionsToOffsetAndMetadata(id).get(left(offsetsBy), TimeUnit.NANOSECONDS);
                    ClusterState.GroupSnap gs = groups.get(id);
                    // a group that stopped reading a topic keeps its commits there until offsets.retention (7 days):
                    // with members assigned, those topics aren't lag (frozen offsets would read Stalled for days)
                    Set<String> assigned = new HashSet<>();
                    gs.members.forEach(mm -> mm.assignments.forEach(a -> assigned.add(a[0])));
                    m.forEach((tp, om) -> {
                        if (om != null && (assigned.isEmpty() || assigned.contains(tp.topic())))
                            gs.committed.computeIfAbsent(tp.topic(), k -> new TreeMap<>()).put(tp.partition(), om.offset());
                    });
                } catch (Exception e) {
                    log.debug("offsets for group {} failed: {}", id, rootMessage(e));
                    // one failed read must not wipe the group's lag windows: keep the previous offsets this sample
                    ClusterState.GroupSnap prev = s.groups.get(id);
                    if (prev != null) prev.committed.forEach((topic, m) -> groups.get(id).committed.put(topic, new TreeMap<>(m)));
                    carried.add(id);
                }
            }
        }
        if (!shareIds.isEmpty()) {
            var shareResult = admin.describeShareGroups(shareIds).describedGroups();
            Map<String, org.apache.kafka.clients.admin.ShareGroupDescription> shares = new HashMap<>();
            long sharesBy = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
            shareResult.forEach((id, f) -> {
                try {
                    shares.put(id, f.get(left(sharesBy), TimeUnit.NANOSECONDS));
                } catch (Exception e) {
                    log.debug("share group {} failed: {}", id, rootMessage(e));
                }
            });
            shares.forEach((id, d) -> {
                ClusterState.GroupSnap gs = groups.get(id);
                gs.state = stateName(d.groupState());
                d.members().forEach(m -> {
                    ClusterState.MemberSnap ms = new ClusterState.MemberSnap();
                    ms.memberId = m.consumerId();
                    ms.clientId = m.clientId();
                    ms.host = m.host().replaceFirst("^/", "");
                    m.assignment().topicPartitions().forEach(tp -> ms.assignments.add(new String[] {tp.topic(), String.valueOf(tp.partition())}));
                    gs.members.add(ms);
                });
            });
        }

        // ── lag windows and rules ──
        double msgsOut = 0;
        long windowMs = props.sampleInterval().toMillis() * props.lagWindow();
        Set<String> live = new HashSet<>();
        for (ClusterState.GroupSnap gs : groups.values()) {
            ClusterState.GroupSnap prev = s.groups.get(gs.groupId);
            if (prev != null && !Objects.equals(prev.state, gs.state) && gs.state.contains("Rebalance")) event(s, now, "rebalance", "info", gs.groupId + " rebalancing", gs.members.size() + " members");
            List<Lag.Status> statuses = new ArrayList<>();
            List<Lag.Part> parts = new ArrayList<>();
            long lastCommit = 0;
            for (var te : gs.committed.entrySet()) {
                ClusterState.TopicSnap t = topics.get(te.getKey());
                if (t == null) continue;
                for (var pe : te.getValue().entrySet()) {
                    ClusterState.PartSnap ps = t.partitions.stream().filter(x -> x.partition == pe.getKey()).findFirst().orElse(null);
                    if (ps == null) continue;
                    String key = gs.groupId + "|" + te.getKey() + "|" + pe.getKey();
                    live.add(key);
                    // a read_committed consumer that commits lastRecord+1 sits behind a trailing commit/abort marker,
                    // which no application ever reads: that gap is caught up, not frozen lag (else: Stalled forever)
                    long gap = ps.high - pe.getValue();
                    // a busy topic's end moves every sample: probing it would build a consumer per partition per tick.
                    // The marker case is an idle one (nothing new, nothing committed), so it's probed once it holds still
                    String gapNow = pe.getValue() + ":" + ps.high;
                    boolean still = gapNow.equals(lastGap.put(cid + "|" + key, gapNow));
                    if (gap > 0 && gap <= 5 && still && onlyMarkers(cid, te.getKey(), pe.getKey(), pe.getValue(), ps.high)) {
                        gs.reportedCommitted.put(te.getKey() + "|" + pe.getKey(), pe.getValue()); // shown as Kafka has it
                        pe.setValue(ps.high); // lag and status: caught up
                    }
                    Deque<Lag.Sample> w = s.windows.computeIfAbsent(key, k -> new java.util.concurrent.ConcurrentLinkedDeque<>());
                    // the topic was deleted and re-created: samples from the old one would run the lag rules backwards
                    if (w.peekLast() != null && w.peekLast().end() > ps.high) w.clear();
                    Lag.Sample last = w.peekLast();
                    if (!carried.contains(gs.groupId)) { // a carried-over read adds no sample: it would fake a stall, then a 2× spike
                        if (last == null || !Objects.equals(last.committed(), pe.getValue())) s.lastChange.put(key, now);
                        if (last != null && now > last.t() && last.committed() != null) msgsOut += Math.max(0, pe.getValue() - last.committed()) * 1000.0 / (now - last.t());
                        w.addLast(new Lag.Sample(now, pe.getValue(), ps.high));
                    }
                    while (w.size() > props.lagWindow()) w.removeFirst();
                    long changed = s.lastChange.getOrDefault(key, now);
                    long lastCommitAt = gs.members.isEmpty() ? changed : now;
                    // displayed "last commit": when an offset last moved (a frozen consumer must not read "just now");
                    lastCommit = Math.max(lastCommit, changed);
                    Lag.Status st = Lag.evaluate(List.copyOf(w), lastCommitAt, now, windowMs);
                    gs.partStatus.put(te.getKey() + "|" + pe.getKey(), st);
                    statuses.add(st);
                    parts.add(new Lag.Part(Math.max(0, ps.high - pe.getValue()), Lag.forecast(List.copyOf(w))));
                }
            }
            gs.lastCommitAt = lastCommit;
            gs.status = Lag.rollup(statuses);
            gs.forecast = gs.type.equals("share") ? Lag.Forecast.of("unknown") : Lag.combine(parts);
            if (prev != null && Lag.becameStuck(prev.status, gs.status)) event(s, now, "group-stalled", "crit", gs.groupId + " " + gs.status, null);
        }

        // deleted groups/topics/partitions drop their windows
        s.windows.keySet().retainAll(live);
        s.lastChange.keySet().retainAll(live);
        lastGap.keySet().removeIf(k -> k.startsWith(cid + "|") && !live.contains(k.substring(cid.length() + 1)));
        s.ts = now;
        s.controller = controller == null ? null : controller.id();
        s.brokers = brokers;
        s.topics = topics;
        s.groups = groups;
        s.messagesIn = msgsIn;
        s.messagesOut = msgsOut;
        s.bytesIn = topics.values().stream().filter(t -> !t.internal).flatMap(t -> t.partitions.stream()).mapToDouble(p -> p.rate * (p.high > p.low && p.sizeBytes > 0 ? (double) p.sizeBytes / (p.high - p.low) : 0)).sum();
        record(cid, s, now);
    }

    private void record(String cid, ClusterState s, long now) {
        List<HistoryRepository.Row> rows = new ArrayList<>();
        rows.add(new HistoryRepository.Row(cid, "cluster", "", "messagesIn", now, s.messagesIn));
        rows.add(new HistoryRepository.Row(cid, "cluster", "", "messagesOut", now, s.messagesOut));
        rows.add(new HistoryRepository.Row(cid, "cluster", "", "bytesIn", now, s.bytesIn));
        long total = 0;
        int urp = 0;
        for (ClusterState.TopicSnap t : s.topics.values()) {
            rows.add(new HistoryRepository.Row(cid, "topic", t.name, "messagesIn", now, t.rate()));
            for (ClusterState.PartSnap p : t.partitions) {
                rows.add(new HistoryRepository.Row(cid, "partition", t.name + "-" + p.partition, "endOffset", now, p.high));
                if (p.isr.size() < p.replicas.size()) urp++;
            }
        }
        for (ClusterState.GroupSnap g : s.groups.values()) {
            long lag = Views.groupLag(s, g);
            rows.add(new HistoryRepository.Row(cid, "group", g.groupId, "lag", now, lag));
            if (!g.type.equals("share") && !g.members.isEmpty()) total += lag;
        }
        rows.add(new HistoryRepository.Row(cid, "cluster", "", "lag", now, total));
        rows.add(new HistoryRepository.Row(cid, "cluster", "", "underReplicated", now, urp));
        s.totalLagPrev = s.totalLagNow; // the sample before this one
        s.totalLagNow = total;
        // storage or alert problems are not Kafka problems: keep the cluster connected, log, retry next sample
        try {
            history.insert(rows);
        } catch (RuntimeException e) {
            log.warn("Cluster {}: couldn't store history: {}", cid, rootMessage(e));
        }
        try {
            alerts.evaluate(cid, s, now);
        } catch (RuntimeException e) {
            log.warn("Cluster {}: couldn't evaluate alerts: {}", cid, rootMessage(e));
        }
    }

    private static String stateName(Object st) {
        if (st == null) return "Unknown";
        String n = st.toString().toLowerCase();
        return switch (n) {
            case "stable" -> "Stable";
            case "empty" -> "Empty";
            case "dead" -> "Dead";
            case "preparing_rebalance", "preparingrebalance" -> "PreparingRebalance";
            case "completing_rebalance", "completingrebalance" -> "CompletingRebalance";
            case "assigning" -> "Assigning";
            case "reconciling" -> "Reconciling";
            default -> "Unknown";
        };
    }

    static void event(ClusterState s, long now, String kind, String severity, String title, String detail) {
        synchronized (s.events) {
            s.events.addFirst(new Dto.ClusterEvent("ev_" + Long.toString(now, 36) + "_" + Integer.toString(Math.abs(title.hashCode()), 36), Instant.ofEpochMilli(now).toString(), kind, severity, title, detail));
            while (s.events.size() > 200) s.events.removeLast();
        }
    }

    /** Time left until a deadline (System.nanoTime); 0 once passed, so finished futures still return. */
    static long left(long deadlineNanos) {
        return Math.max(0, deadlineNanos - System.nanoTime());
    }

    /** True when a read_committed read from `from` reaches `to` without one record: the gap is only control records. */
    private boolean onlyMarkers(String cid, String topic, int partition, long from, long to) {
        String k = cid + "|" + topic + "|" + partition + "|" + from + "|" + to;
        Boolean hit = markerOnly.get(k);
        if (hit != null) return hit;
        boolean only = false;
        try (var c = kafka.consumer(cid, 5, true)) {
            TopicPartition tp = new TopicPartition(topic, partition);
            c.assign(List.of(tp));
            c.seek(tp, from);
            boolean saw = false;
            for (int i = 0; i < 4 && !saw && c.position(tp) < to; i++) saw = !c.poll(Duration.ofMillis(250)).isEmpty();
            if (!saw && c.position(tp) < to) return false; // ran out of time (cold fetch): undecided, not cached
            only = !saw;
        } catch (RuntimeException e) {
            log.debug("marker check for {}-{} failed: {}", topic, partition, e.toString());
            return false; // not cached: a passing error mustn't fix this gap as lag for good
        }
        if (markerOnly.size() > 10_000) markerOnly.clear();
        markerOnly.put(k, only);
        return only;
    }
}
