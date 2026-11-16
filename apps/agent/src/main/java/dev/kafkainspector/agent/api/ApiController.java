package dev.kafkainspector.agent.api;

import dev.kafkainspector.agent.alerts.AlertService;
import dev.kafkainspector.agent.config.Clusters;
import dev.kafkainspector.agent.config.KiProperties;
import dev.kafkainspector.agent.history.HistoryRepository;
import dev.kafkainspector.agent.kafka.ClusterState;
import dev.kafkainspector.agent.kafka.KafkaService;
import dev.kafkainspector.agent.kafka.MessageService;
import dev.kafkainspector.agent.kafka.Sampler;
import dev.kafkainspector.agent.kafka.Views;
import dev.kafkainspector.agent.prefs.SavedFilters;
import dev.kafkainspector.agent.schemas.SchemaRegistry;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import org.apache.kafka.clients.admin.Config;
import org.apache.kafka.common.config.ConfigResource;
import org.springframework.boot.info.BuildProperties;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

/** The read-only API (docs/AGENT_API.md). There are no write endpoints in v1 (D-02). */
@RestController
@RequestMapping("/api")
public class ApiController {
    private final Clusters clusters;
    private final Sampler sampler;
    private final KafkaService kafka;
    private final MessageService messages;
    private final HistoryRepository history;
    private final SchemaRegistry registry;
    private final AlertService alerts;
    private final SavedFilters filters;
    private final String version;
    private final dev.kafkainspector.agent.history.Trends trends;

    public ApiController(Clusters clusters, Sampler sampler, KafkaService kafka, MessageService messages, HistoryRepository history, SchemaRegistry registry, AlertService alerts, SavedFilters filters, dev.kafkainspector.agent.history.Trends trends, Optional<BuildProperties> build) {
        this.clusters = clusters;
        this.sampler = sampler;
        this.kafka = kafka;
        this.messages = messages;
        this.history = history;
        this.registry = registry;
        this.alerts = alerts;
        this.filters = filters;
        this.trends = trends;
        this.version = build.map(BuildProperties::getVersion).orElse("0.1.0");
    }

    // ── meta ──

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "UP");
    }

    @GetMapping("/info")
    public Object info(Authentication auth) {
        if (auth == null || !auth.isAuthenticated() || "anonymousUser".equals(auth.getPrincipal())) return new Dto.AnonymousInfo("agent", version, true, false);
        boolean sr = clusters.all().values().stream().anyMatch(c -> c.schemaRegistry() != null && !c.schemaRegistry().isBlank());
        return new Dto.AppInfo("agent", version, true, new Dto.Capabilities(false, false, true, true, sr), clusterList(), new Dto.User("admin"));
    }

    @GetMapping("/clusters")
    public List<Dto.ClusterSummary> clusterList() {
        List<Dto.ClusterSummary> out = new ArrayList<>();
        clusters.all().forEach((id, c) -> out.add(Views.summary(id, c, sampler.state(id))));
        return out;
    }

    private ClusterState state(String cid) {
        ClusterState s = sampler.state(cid);
        if (s.ts == 0 && !s.connected) throw new IllegalStateException("Still connecting to " + clusters.get(cid).name() + (s.error != null ? ": " + s.error : "") + ". Retry in a few seconds.");
        return s;
    }

    // ── cluster ──

    @GetMapping("/clusters/{c}/overview")
    public Dto.Overview overview(@PathVariable String c) {
        ClusterState s = state(c);

        return Views.overview(c, clusters.get(c), s, alerts.firingCount(c), trends.groups(c, s));
    }

    @GetMapping("/clusters/{c}/brokers")
    public List<Dto.Broker> brokers(@PathVariable String c) {
        ClusterState s = state(c);
        List<Dto.Broker> out = new ArrayList<>();
        for (ClusterState.BrokerSnap b : s.brokers) {
            int partitions = 0, leaders = 0;
            double bytesIn = 0;
            for (ClusterState.TopicSnap t : s.topics.values()) {
                for (ClusterState.PartSnap p : t.partitions) {
                    if (p.replicas.contains(b.id())) partitions++;
                    if (Objects.equals(p.leader, b.id())) {
                        leaders++;
                        bytesIn += p.high > p.low && p.sizeBytes > 0 ? p.rate * p.sizeBytes / (p.high - p.low) : 0;
                    }
                }
            }
            out.add(new Dto.Broker(b.id(), b.host(), b.port(), b.rack(), Objects.equals(s.controller, b.id()), b.online(), partitions, leaders, bytesIn, b.diskUsed(), b.diskTotal()));
        }
        return out;
    }

    private static final Pattern SENSITIVE = Pattern.compile("(?i)password|secret|token|key|jaas|credential");

    private List<Dto.ConfigEntry> configs(String c, ConfigResource r) throws Exception {
        Config cfg;
        try {
            cfg = kafka.admin(c).describeConfigs(List.of(r)).all().get(20, TimeUnit.SECONDS).get(r);
        } catch (java.util.concurrent.ExecutionException e) {
            // deleted since the last sample: that's "not found", not "Kafka didn't answer"
            if (e.getCause() instanceof org.apache.kafka.common.errors.UnknownTopicOrPartitionException)
                throw new Clusters.NotFound("TOPIC_NOT_FOUND", "Topic " + r.name() + " not found on this cluster.");
            throw e;
        }
        List<Dto.ConfigEntry> out = new ArrayList<>();
        cfg.entries().forEach(e -> {
            boolean sensitive = e.isSensitive() || SENSITIVE.matcher(e.name()).find() && !e.name().endsWith(".type") && !e.name().contains("algorithm");
            out.add(new Dto.ConfigEntry(e.name(), sensitive ? "******" : e.value(), sourceOf(e.source()), e.isDefault(), sensitive, true));
        });
        out.sort(Comparator.comparing(Dto.ConfigEntry::name));
        return out;
    }

    private static String sourceOf(org.apache.kafka.clients.admin.ConfigEntry.ConfigSource s) {
        return switch (s) {
            case DEFAULT_CONFIG -> "default";
            case DYNAMIC_TOPIC_CONFIG -> "dynamic-topic";
            case DYNAMIC_BROKER_CONFIG, DYNAMIC_DEFAULT_BROKER_CONFIG -> "dynamic-broker";
            case STATIC_BROKER_CONFIG -> "static-broker";
            default -> "unknown";
        };
    }

    @GetMapping("/clusters/{c}/brokers/{id}/config")
    public List<Dto.ConfigEntry> brokerConfig(@PathVariable String c, @PathVariable int id) throws Exception {
        ClusterState s = state(c);
        if (s.ts > 0 && s.brokers.stream().noneMatch(b -> b.id() == id)) throw new Clusters.NotFound("BROKER_NOT_FOUND", "Broker " + id + " isn't part of " + c + ".");
        return configs(c, new ConfigResource(ConfigResource.Type.BROKER, String.valueOf(id)));
    }

    // ── topics ──

    @GetMapping("/clusters/{c}/topics")
    public Dto.Page<Dto.TopicSummary> topics(@PathVariable String c, @RequestParam(defaultValue = "") String query, @RequestParam(defaultValue = "false") boolean regex, @RequestParam(defaultValue = "false") boolean internal,
            @RequestParam(defaultValue = "all") String view, @RequestParam(defaultValue = "") String starred, @RequestParam(defaultValue = "issues") String sort, @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "50") int size) {
        ClusterState s = state(c);
        Pattern re = null;
        if (regex && !query.isBlank()) {
            re = SafeRegex.compile(query, Pattern.CASE_INSENSITIVE);
        }
        Set<String> stars = new HashSet<>(Arrays.asList(starred.split(",")));
        List<Dto.TopicSummary> items = new ArrayList<>();
        for (ClusterState.TopicSnap t : s.topics.values()) {
            if (!internal && t.internal) continue;
            if (!query.isBlank() && (re != null ? !SafeRegex.find(re, t.name, 50) : !t.name.toLowerCase().contains(query.toLowerCase()))) continue;
            Dto.TopicSummary ts = Views.topic(s, t, List.of()); // trends only for the page returned (one history query each)
            if ("attention".equals(view) && !Views.needsAttention(ts)) continue;
            if ("starred".equals(view) && !stars.contains(t.name)) continue;
            items.add(ts);
        }
        Comparator<Dto.TopicSummary> cmp = switch (sort) {
            case "name" -> Comparator.comparing(Dto.TopicSummary::name);
            case "size" -> Comparator.comparingLong((Dto.TopicSummary t) -> t.sizeBytes() == null ? -1 : t.sizeBytes()).reversed().thenComparing(Dto.TopicSummary::name); // unknown last
            case "rate" -> Comparator.comparingDouble(Dto.TopicSummary::messagesInPerSec).reversed().thenComparing(Dto.TopicSummary::name);
            default -> Comparator.comparingInt((Dto.TopicSummary t) -> -(t.health().stream().anyMatch(h -> h.severity().equals("crit")) ? 3 : t.health().stream().anyMatch(h -> h.severity().equals("warn")) ? 2 : Views.needsAttention(t) ? 1 : 0))
                    .thenComparing(Dto.TopicSummary::name); // not the live rate: rows mustn't swap on every refresh
        };
        items.sort(cmp);
        int sz = Math.max(1, Math.min(size, 500)), pg = Math.max(1, page);
        long from = (long) (pg - 1) * sz, to = (long) pg * sz; // long: page=2147483647 must not overflow
        List<Dto.TopicSummary> slice = items.subList((int) Math.min(items.size(), from), (int) Math.min(items.size(), to)).stream()
                .map(t -> Views.topic(s, s.topics.get(t.name()), trends.of(c, "topic", t.name(), "messagesIn"))).toList();
        return new Dto.Page<>(slice, items.size(), pg, sz);
    }

    private ClusterState.TopicSnap topicSnap(ClusterState s, String name) {
        ClusterState.TopicSnap t = s.topics.get(name);
        if (t == null) throw new Clusters.NotFound("TOPIC_NOT_FOUND", "Topic " + name + " not found on this cluster.");
        return t;
    }

    @GetMapping("/clusters/{c}/topics/{name}")
    public Dto.TopicDetail topic(@PathVariable String c, @PathVariable String name) {
        ClusterState s = state(c);
        return Views.topicDetail(s, topicSnap(s, name), trends.of(c, "topic", name, "messagesIn"), registry.subjectNames(c));
    }

    @GetMapping("/clusters/{c}/topics/{name}/config")
    public List<Dto.ConfigEntry> topicConfig(@PathVariable String c, @PathVariable String name) throws Exception {
        topicSnap(state(c), name);
        return configs(c, new ConfigResource(ConfigResource.Type.TOPIC, name));
    }

    @GetMapping("/clusters/{c}/topics/{name}/messages")
    public Dto.RawMessagePage browse(@PathVariable String c, @PathVariable String name, @RequestParam(defaultValue = "all") String partition, @RequestParam(defaultValue = "newest") String from, @RequestParam(required = false) Long offset,
            @RequestParam(required = false) String timestamp, @RequestParam(required = false) String group, @RequestParam(defaultValue = "100") int limit, @RequestParam(required = false) String cursor) {
        ClusterState st = state(c);
        if (st.ts > 0 && !st.topics.containsKey(name)) throw new Clusters.NotFound("TOPIC_NOT_FOUND", "Topic " + name + " doesn't exist on " + c + ".");
        // a request that can't mean anything gets a 400/404 that says why, never an empty page that looks like "no data"
        if (!List.of("newest", "oldest", "offset", "timestamp", "group").contains(from))
            throw new IllegalArgumentException("from must be newest, oldest, offset, timestamp or group.");
        if (!"all".equals(partition) && !partition.matches("\\d+"))
            throw new IllegalArgumentException("partition must be all or a partition number.");
        if (limit < 1) throw new IllegalArgumentException("limit must be 1 or more (at most 500).");
        // a next page continues from its cursor: where the first page started no longer matters
        boolean first = cursor == null || cursor.isBlank();
        if (first && "offset".equals(from) && (offset == null || offset < 0)) throw new IllegalArgumentException("Enter an offset of 0 or more to read from.");
        if (first && "timestamp".equals(from) && (timestamp == null || timestamp.isBlank())) throw new IllegalArgumentException("Pick a date and time to read from.");
        if (first && "timestamp".equals(from)) {
            // checked here, before any Kafka call: a bad value is a 400 even while Kafka is down, and a year like
            // +999999999 (which overflows epoch millis) isn't a 500
            try {
                java.time.Instant.parse(timestamp).toEpochMilli();
            } catch (java.time.format.DateTimeParseException | ArithmeticException e) {
                throw new IllegalArgumentException("Pick a date and time as an ISO instant, e.g. 2026-11-16T12:00:00Z.");
            }
        }
        Map<Integer, Long> groupOffsets = new HashMap<>();
        if (first && "group".equals(from)) {
            if (group == null || group.isBlank()) throw new IllegalArgumentException("Pick a consumer group to read from.");
            ClusterState.GroupSnap g = st.groups.get(group);
            if (g == null && st.ts > 0) throw new Clusters.NotFound("GROUP_NOT_FOUND", "Consumer group " + group + " doesn't exist on " + c + ".");
            if (g != null && g.committed.containsKey(name)) groupOffsets.putAll(g.committed.get(name));
        }
        return messages.browse(c, name, partition, from, offset, timestamp, groupOffsets, limit, cursor);
    }

    public record SearchRequest(String topicRegex, String from, Integer limit, Boolean sample) {}

    @PostMapping("/clusters/{c}/messages/search")
    public Dto.RawMessagePage search(@PathVariable String c, @RequestBody SearchRequest r) {
        return messages.search(c, r.topicRegex() == null ? ".*" : r.topicRegex(), r.from(), r.limit() == null ? 100 : r.limit(), Boolean.TRUE.equals(r.sample()), state(c).topics);
    }

    // ── groups ──

    @GetMapping("/clusters/{c}/groups")
    public List<Dto.GroupSummary> groups(@PathVariable String c, @RequestParam(required = false) String type, @RequestParam(required = false) String query) {
        ClusterState s = state(c);
        // worst first, as the overview and the simulator list them (the web list doesn't re-sort)
        return s.groups.values().stream().filter(g -> type == null || type.isBlank() || g.type.equals(type)).filter(g -> query == null || g.groupId.contains(query)).map(g -> Views.group(s, g, trends.of(c, "group", g.groupId, "lag")))
                .sorted(Views.WORST_FIRST).toList();
    }

    @GetMapping("/clusters/{c}/groups/{id}")
    public Dto.GroupDetail group(@PathVariable String c, @PathVariable String id) {
        ClusterState s = state(c);
        ClusterState.GroupSnap g = s.groups.get(id);
        if (g == null) throw new Clusters.NotFound("GROUP_NOT_FOUND", "Consumer group " + id + " not found.");
        return Views.groupDetail(s, g, trends.of(c, "group", id, "lag"));
    }

    // ── history ──

    private static final Map<String, Set<String>> SAMPLED = Map.of(
            "cluster", Set.of("messagesIn", "messagesOut", "bytesIn", "lag", "underReplicated"),
            "topic", Set.of("messagesIn"),
            "partition", Set.of("endOffset"),
            "group", Set.of("lag"));
    private static final Map<String, Long> RANGES = Map.of("15m", 900_000L, "1h", 3_600_000L, "24h", 86_400_000L, "7d", 604_800_000L);

    @GetMapping("/clusters/{c}/history")
    public List<Dto.Series> history(@PathVariable String c, @RequestParam String metric, @RequestParam String scope, @RequestParam(required = false) String key, @RequestParam(defaultValue = "1h") String range) {
        clusters.get(c);
        if (!RANGES.containsKey(range)) throw new IllegalArgumentException("Range must be one of 15m, 1h, 24h, 7d.");
        // only what the sampler records (Sampler.record): anything else would be an empty or mislabelled series
        Set<String> recorded = SAMPLED.get(scope);
        if (recorded == null || !recorded.contains(metric))
            throw new IllegalArgumentException("The agent doesn't record " + metric + " for scope " + scope + ". Recorded: " + SAMPLED + ".");
        long from = System.currentTimeMillis() - RANGES.get(range);
        String dbScope = scope, dbKey = key == null ? "" : key, dbMetric = metric;
        if ("cluster".equals(scope)) dbKey = "";
        return List.of(new Dto.Series(key == null ? scope : key, history.series(c, dbScope, dbKey, dbMetric, from, 240)));
    }

    // ── schemas ──

    @GetMapping("/clusters/{c}/schemas/subjects")
    public List<Dto.SubjectSummary> subjects(@PathVariable String c) {
        return registry.subjects(c);
    }

    @GetMapping("/clusters/{c}/schemas/subjects/{s}/versions/{v}")
    public Dto.SchemaVersion schema(@PathVariable String c, @PathVariable String s, @PathVariable String v) {
        // the registry answers 422 to these, which would read as "unavailable, try again"
        if (!v.equals("latest") && !v.matches("[1-9]\\d{0,9}")) throw new IllegalArgumentException("A schema version is latest or a number from 1.");
        return registry.get(c, s, v);
    }

    @GetMapping("/clusters/{c}/schemas/ids/{id}")
    public Dto.SchemaVersion schemaById(@PathVariable String c, @PathVariable int id) {
        return registry.byId(c, id);
    }

    public record CompatRequest(String schema, String schemaType) {}

    @PostMapping("/clusters/{c}/schemas/subjects/{s}/compatibility")
    public Dto.CompatibilityResult compatibility(@PathVariable String c, @PathVariable String s, @RequestBody CompatRequest r) {
        return registry.compatibility(c, s, r.schema(), r.schemaType());
    }

    // ── topology ──

    @GetMapping("/clusters/{c}/topology")
    public Dto.Topology topology(@PathVariable String c) {
        return Views.topology(state(c));
    }

    // ── saved filters (F-04, app data) ──

    @GetMapping("/filters")
    public List<SavedFilters.Filter> savedFilters() {
        return filters.list();
    }

    public record FilterBody(String expr) {}

    @PutMapping("/filters/{name}")
    public ResponseEntity<Void> saveFilter(@PathVariable String name, @RequestBody FilterBody body) {
        filters.save(name, body.expr());
        return ResponseEntity.noContent().build();
    }

    // ── alerts (app data — allowed in read-only mode) ──

    @GetMapping("/alerts/rules")
    public List<AlertService.Rule> rules() {
        return alerts.rules();
    }

    @PostMapping("/alerts/rules")
    public AlertService.Rule createRule(@RequestBody AlertService.Rule r) {
        return alerts.save(r);
    }

    @PutMapping("/alerts/rules/{id}")
    public AlertService.Rule updateRule(@PathVariable String id, @RequestBody AlertService.Rule r) {
        return alerts.save(new AlertService.Rule(id, r.name(), r.metric(), r.scope(), r.threshold(), r.durationSec(), r.severity(), r.channels(), r.enabled(), r.muted(), null));
    }

    @DeleteMapping("/alerts/rules/{id}")
    public ResponseEntity<Void> removeRule(@PathVariable String id) {
        alerts.remove(id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/alerts/events")
    public List<AlertService.Event> events(@RequestParam(defaultValue = "all") String state, @RequestParam(defaultValue = "200") int limit) {
        return alerts.events(state, limit);
    }

    public record Mute(String until) {}

    @PostMapping("/alerts/events/{id}/mute")
    public ResponseEntity<Void> mute(@PathVariable String id, @RequestBody Mute m) {
        alerts.mute(id, m.until());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/alerts/events/{id}/ack")
    public ResponseEntity<Void> ack(@PathVariable String id) {
        alerts.acknowledge(id);
        return ResponseEntity.noContent().build();
    }
}
