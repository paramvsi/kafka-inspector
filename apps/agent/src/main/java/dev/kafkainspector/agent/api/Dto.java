package dev.kafkainspector.agent.api;

import java.util.List;
import java.util.Map;

/** JSON shapes shared with packages/core/src/types.ts (field names match the TypeScript types). */
public final class Dto {
    private Dto() {}

    public record Capabilities(boolean writes, boolean chaos, boolean history, boolean auth, boolean schemaRegistry) {}
    public record ClusterSummary(String id, String name, String color, String status, int brokers, String kafkaVersion, boolean schemaRegistry) {}
    public record User(String name) {}
    public record AppInfo(String mode, String version, boolean readOnly, Capabilities capabilities, List<ClusterSummary> clusters, User user) {}
    public record AnonymousInfo(String mode, String version, boolean auth, boolean signedIn) {}

    public record Broker(int id, String host, int port, String rack, boolean isController, boolean online, int partitions, int leaders, Double bytesInPerSec, Long diskUsedBytes, Long diskTotalBytes) {}
    public record ConfigEntry(String name, String value, String source, boolean isDefault, boolean isSensitive, boolean readOnly) {}

    public record HealthFinding(String id, String severity, String message, String fix) {}
    public record TopicSummary(String name, boolean internal, int partitions, int replicationFactor, Long sizeBytes, double messagesInPerSec, int consumerGroups, String lastMessageAt, int underReplicated, List<HealthFinding> health, List<Double> trend) {}
    public record PartitionInfo(int partition, Integer leader, List<Integer> replicas, List<Integer> isr, long lowWatermark, long highWatermark, Double sharePct, String lastMessageAt) {}
    public record TopicConsumer(String groupId, String type, Long lag, String status, String state) {} // lag null: assigned, nothing committed
    public record SchemaLink(String keySubject, String valueSubject) {}
    public record TopicDetail(TopicSummary summary, List<PartitionInfo> partitions, List<TopicConsumer> consumers, SchemaLink schema) {}
    public record Page<T>(List<T> items, int total, int page, int size) {}

    public record Header(String key, String value) {}
    public record RawMessage(String topic, int partition, long offset, String timestamp, String key, String value, List<Header> headers, int sizeBytes) {}
    public record RawMessagePage(List<RawMessage> messages, String nextCursor, int scanned, String note) {} // note: what a search skipped (null for browse)

    public record Forecast(String kind, Double seconds, Double consumeRate, Double produceRate) {}
    public record GroupSummary(String groupId, String type, String state, int members, List<String> topics, long totalLag, String lastCommitAt, String status, Forecast forecast, List<Double> trend) {}
    public record GroupPartitionLag(String topic, int partition, Long committedOffset, long endOffset, long lag, String memberId, String clientId, String host, String status) {}
    public record Assignment(String topic, int partition) {}
    public record GroupMember(String memberId, String clientId, String host, List<Assignment> assignments) {}
    public record GroupDetail(GroupSummary summary, List<GroupPartitionLag> partitions, List<GroupMember> members, Map<String, Object> share) {}

    public record Series(String key, List<double[]> points) {}

    public record ClusterEvent(String id, String ts, String kind, String severity, String title, String detail) {}
    public record Kpis(double messagesInPerSec, double messagesOutPerSec, double bytesInPerSec, long totalLag, String lagTrend, int underReplicated, int totalPartitions, int brokersOnline, int brokersTotal, int offlinePartitions, int underMinIsr, Integer activeController, int activeAlerts, int topics, int groups) {}
    public record AttentionItem(String id, String severity, String title, String detail, String since, String href, String action) {}
    public record Overview(ClusterSummary cluster, Kpis kpis, List<AttentionItem> attention, List<GroupSummary> groups, List<ClusterEvent> events) {}

    public record SubjectSummary(String subject, int latestVersion, String type, String compatibility, List<Integer> versions) {}
    public record SchemaVersion(String subject, int version, int id, String type, String schema, Object references) {}
    public record CompatibilityResult(boolean compatible, List<String> messages) {}

    public record TopologyNode(String id, String kind, String label, String status, double rate, String note) {}
    public record TopologyEdge(String from, String to, double rate, String kind) {}
    public record Topology(List<TopologyNode> nodes, List<TopologyEdge> edges) {}

    public record ApiError(Body error) {
        public record Body(String code, String message, Map<String, Object> details) {}

        public static ApiError of(String code, String message) {
            return new ApiError(new Body(code, message, Map.of()));
        }

        private static final tools.jackson.databind.json.JsonMapper JSON = tools.jackson.databind.json.JsonMapper.builder().build();

        /** For filters that answer before Spring MVC (security, body size): the same envelope, properly escaped. */
        public static void write(jakarta.servlet.http.HttpServletResponse res, int status, String code, String message) throws java.io.IOException {
            res.setStatus(status);
            res.setContentType("application/json");
            res.getWriter().write(JSON.writeValueAsString(of(code, message)));
        }
    }
}
