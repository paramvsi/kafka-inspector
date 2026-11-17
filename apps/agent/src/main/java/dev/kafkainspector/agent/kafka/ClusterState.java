package dev.kafkainspector.agent.kafka;

import dev.kafkainspector.agent.lag.Lag;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** The latest snapshot of one cluster plus the rolling windows the lag rules need. Owned by the sampler. */
public class ClusterState {
    public volatile long ts;
    public volatile boolean connected;
    public volatile String error;
    public volatile String kafkaVersion = "unknown";
    public volatile Integer controller;
    public volatile List<BrokerSnap> brokers = List.of();
    public volatile Map<String, TopicSnap> topics = Map.of();
    public volatile Map<String, GroupSnap> groups = Map.of();
    /** group|topic|partition → samples (bounded). Written by the sampler, read by REST/WS threads: concurrent types. */
    public final Map<String, Deque<Lag.Sample>> windows = new java.util.concurrent.ConcurrentHashMap<>();
    public final Map<String, Long> lastChange = new java.util.concurrent.ConcurrentHashMap<>();
    /** attention item id → when it first appeared (sample time): "since" mustn't move forward every sample */
    public final Map<String, Long> attentionSince = new java.util.concurrent.ConcurrentHashMap<>();
    public final Deque<dev.kafkainspector.agent.api.Dto.ClusterEvent> events = new ArrayDeque<>();
    public volatile double messagesIn, messagesOut, bytesIn;
    /** total lag of the previous sample (the overview's trend word compares against it) */
    public volatile long totalLagPrev = -1;
    public volatile long totalLagNow = -1;

    public record BrokerSnap(int id, String host, int port, String rack, boolean online, Long diskUsed, Long diskTotal) {}

    public static class PartSnap {
        public int partition;
        public Integer leader;
        public List<Integer> replicas = new ArrayList<>();
        public List<Integer> isr = new ArrayList<>();
        public long low, high;
        public double rate;
        /** high/low were read this sample (false: leaderless, the previous values carried over) */
        public boolean read;
        public long lastMessageAt;
        /** -1: never reported (DescribeLogDirs refused or failed) — shown as unknown, not 0 B */
        public long sizeBytes = -1;
    }

    public static class TopicSnap {
        public String name;
        public boolean internal;
        public List<PartSnap> partitions = new ArrayList<>();
        public Map<String, String> configs = new HashMap<>();
        public double rate() {
            return partitions.stream().mapToDouble(p -> p.rate).sum();
        }
    }

    public static class MemberSnap {
        public String memberId, clientId, host;
        public List<String[]> assignments = new ArrayList<>(); // [topic, partition]
    }

    public static class GroupSnap {
        public String groupId, type = "unknown", state = "Unknown";
        public List<MemberSnap> members = new ArrayList<>();
        /** topic → partition → committed */
        public Map<String, Map<Integer, Long>> committed = new HashMap<>();
        /** topic|partition → the offset Kafka holds, where `committed` was moved past trailing transaction markers */
        public Map<String, Long> reportedCommitted = new HashMap<>();
        public Lag.Status status = Lag.Status.unknown;
        public Lag.Forecast forecast = Lag.Forecast.of("unknown");
        public Map<String, Lag.Status> partStatus = new HashMap<>();
        public long lastCommitAt;
    }
}
