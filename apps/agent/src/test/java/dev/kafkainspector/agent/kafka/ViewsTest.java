package dev.kafkainspector.agent.kafka;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import org.junit.jupiter.api.Test;

class ViewsTest {
    static ClusterState.PartSnap part(int p, long size) {
        ClusterState.PartSnap ps = new ClusterState.PartSnap();
        ps.partition = p;
        ps.sizeBytes = size;
        return ps;
    }

    @Test
    void aTopicWhoseSizeWasNeverReportedHasNoSizeNotZero() {
        ClusterState s = new ClusterState();
        ClusterState.TopicSnap t = new ClusterState.TopicSnap();
        t.name = "orders";
        t.partitions.add(part(0, -1));
        t.partitions.add(part(1, -1));
        assertNull(Views.topic(s, t, List.of()).sizeBytes(), "no DescribeLogDirs: unknown, not 0 B");
        t.partitions.set(1, part(1, 2048));
        // one partition still unknown: 2048 is only a lower bound, so the size is unknown, not an exact 2 KB
        assertNull(Views.topic(s, t, List.of()).sizeBytes(), "a partly known size isn't the topic's size");
        t.partitions.set(0, part(0, 1024));
        assertEquals(3072L, Views.topic(s, t, List.of()).sizeBytes());
    }

    @Test
    void aBrokerWhoseLedPartitionsHaveNoSizeHasNoByteRateNotZero() {
        ClusterState s = new ClusterState();
        ClusterState.TopicSnap t = new ClusterState.TopicSnap();
        t.name = "orders";
        ClusterState.PartSnap p = part(0, -1); // DescribeLogDirs didn't answer for it
        p.leader = 1;
        p.high = 1000;
        p.low = 0;
        p.rate = 50;
        t.partitions.add(p);
        s.topics = java.util.Map.of("orders", t);
        assertNull(Views.bytesIn(s, 1), "traffic flows but its size is unknown: no rate, not 0 B/s");
        p.sizeBytes = 100_000; // 100 bytes per message × 50 messages/s
        assertEquals(5000.0, Views.bytesIn(s, 1), 0.001);
        assertEquals(0.0, Views.bytesIn(s, 2), 0.001); // leads nothing: a real 0
    }

    @Test
    void anAttentionItemKeepsTheTimeItFirstAppeared() {
        ClusterState s = new ClusterState();
        s.brokers = List.of(new ClusterState.BrokerSnap(2, "b2", 9092, null, false, null, null));
        s.ts = 1_000_000;
        String first = Views.attention(s, List.of(), 0, 0).get(0).since();
        s.ts = 1_030_000; // a later sample: the broker is still offline
        assertEquals(first, Views.attention(s, List.of(), 0, 0).get(0).since());
    }

    @Test
    void aStalledGroupsAttentionDetailNamesThePartitionAndHowLongAsTheDemoDoes() {
        ClusterState s = new ClusterState();
        s.ts = 10_000_000;
        ClusterState.GroupSnap g = new ClusterState.GroupSnap();
        g.groupId = "fraud-scorer";
        g.status = dev.kafkainspector.agent.lag.Lag.Status.stalled;
        g.partStatus.put("payments|7", dev.kafkainspector.agent.lag.Lag.Status.stalled);
        s.groups = new java.util.HashMap<>(java.util.Map.of("fraud-scorer", g));
        s.lastChange.put("fraud-scorer|payments|7", s.ts - 372_000);
        var sum = new dev.kafkainspector.agent.api.Dto.GroupSummary("fraud-scorer", "consumer", "Stable", 2, List.of("payments"), 812, null, "stalled",
                new dev.kafkainspector.agent.api.Dto.Forecast("never", null, null, null), List.of());
        assertEquals("Partition 7 · same offset for 6m 12s", Views.attention(s, List.of(sum), 0, 0).get(0).detail());
    }

    @Test
    void attentionItemsOfOneSeveritySortNewestFirstEvenWithinOneSecond() {
        ClusterState s = new ClusterState();
        s.brokers = List.of(new ClusterState.BrokerSnap(1, "b1", 9092, null, false, null, null));
        s.ts = 1_000_000; // a whole second: iso() prints no fraction
        Views.attention(s, List.of(), 0, 0);
        s.brokers = List.of(new ClusterState.BrokerSnap(1, "b1", 9092, null, false, null, null),
                new ClusterState.BrokerSnap(2, "b2", 9092, null, false, null, null));
        s.ts = 1_000_500; // half a second later, broker 2 goes too
        assertEquals("broker-2", Views.attention(s, List.of(), 0, 0).get(0).id());
    }

    @org.junit.jupiter.api.Test
    void etaMatchesCoreFormatEta() {
        // the vectors of packages/core/test/lag.test.ts (ARCHITECTURE "Forecast" format, rule 9)
        org.junit.jupiter.api.Assertions.assertEquals("under a minute", Views.eta(59));
        // unknown reads "—" as packages/core formatEta (was "~0 min" for NaN)
        org.junit.jupiter.api.Assertions.assertEquals("—", Views.eta(Double.NaN));
        org.junit.jupiter.api.Assertions.assertEquals("—", Views.eta(Double.POSITIVE_INFINITY));
        org.junit.jupiter.api.Assertions.assertEquals("~14 min", Views.eta(14 * 60 + 10));
        org.junit.jupiter.api.Assertions.assertEquals("~119 min", Views.eta(119 * 60));
        org.junit.jupiter.api.Assertions.assertEquals("~3 h", Views.eta(3 * 3600));
    }

    @Test
    void committedOffsetsForADeletedTopicAreNotListedAsLiveRows() {
        ClusterState s = new ClusterState();
        ClusterState.TopicSnap t = new ClusterState.TopicSnap();
        t.name = "orders";
        ClusterState.PartSnap p0 = part(0, 0);
        p0.high = 100;
        t.partitions.add(p0);
        s.topics = new java.util.HashMap<>(java.util.Map.of("orders", t));
        ClusterState.GroupSnap g = new ClusterState.GroupSnap();
        g.groupId = "old-reader";
        g.state = "Empty";
        g.committed.put("orders", new java.util.TreeMap<>(java.util.Map.of(0, 90L)));
        g.committed.put("gone", new java.util.TreeMap<>(java.util.Map.of(0, 48_210L))); // topic deleted since
        g.committed.get("orders").put(5, 7L); // partition that no longer exists
        var d = Views.groupDetail(s, g, List.of());
        assertEquals(List.of("orders|0"), d.partitions().stream().map(x -> x.topic() + "|" + x.partition()).toList());
        assertEquals(List.of("orders"), d.summary().topics());
    }

    @org.junit.jupiter.api.Test
    void aTopicWithACriticalFindingIsDrawnInTheCriticalColourNotAmber() {
        var crit = new dev.kafkainspector.agent.api.Dto.HealthFinding("offline", "crit", "1 partition offline", "x");
        var warn = new dev.kafkainspector.agent.api.Dto.HealthFinding("skew", "warn", "Skew", "x");
        org.junit.jupiter.api.Assertions.assertEquals("stalled", Views.topicNodeStatus(java.util.List.of(warn, crit)));
        org.junit.jupiter.api.Assertions.assertEquals("warn", Views.topicNodeStatus(java.util.List.of(warn)));
        org.junit.jupiter.api.Assertions.assertEquals("healthy", Views.topicNodeStatus(java.util.List.of()));
    }

    @Test
    void aGroupAssignedToATopicButWithNoCommitsHasUnknownLagNotZero() {
        ClusterState s = new ClusterState();
        ClusterState.TopicSnap t = new ClusterState.TopicSnap();
        t.name = "orders";
        ClusterState.PartSnap p = part(0, 1024);
        p.high = 500;
        t.partitions.add(p);
        s.topics = java.util.Map.of("orders", t);
        ClusterState.GroupSnap g = new ClusterState.GroupSnap();
        g.groupId = "billing";
        ClusterState.MemberSnap m = new ClusterState.MemberSnap();
        m.assignments.add(new String[] {"orders", "0"});
        g.members.add(m);
        s.groups = java.util.Map.of("billing", g);
        var c = Views.topicDetail(s, t, List.of(), java.util.Set.of()).consumers().get(0);
        assertNull(c.lag(), "no committed offset: lag unknown (the UI showed 0, which reads as caught up)");
    }

    @Test
    void aSkewedTopicsAttentionItemUsesTheDesignsWording() {
        ClusterState s = new ClusterState();
        ClusterState.TopicSnap t = new ClusterState.TopicSnap();
        t.name = "clickstream";
        for (int p = 0; p < 4; p++) {
            ClusterState.PartSnap ps = part(p, 1024);
            ps.rate = p == 3 ? 70 : 10; // partition 3 takes 70 of 100 msg/s
            ps.replicas.add(1);
            ps.isr.add(1);
            ps.leader = 1;
            t.partitions.add(ps);
        }
        s.topics = java.util.Map.of("clickstream", t);
        var item = Views.attention(s, List.of(), 0, 0).stream().filter(a -> a.id().equals("skew-clickstream")).findFirst().orElseThrow();
        assertEquals("clickstream partition 3 is hot", item.title());
        assertEquals("70% of topic traffic on 1 of 4 partitions", item.detail());
    }

    @Test
    void theTopologyNeverHasAnEdgeToATopicItLeftOut() {
        ClusterState s = new ClusterState();
        ClusterState.TopicSnap internal = new ClusterState.TopicSnap();
        internal.name = "_events"; // `_`-prefixed topics count as internal and get no node
        internal.internal = true;
        internal.partitions.add(part(0, 10));
        ClusterState.TopicSnap orders = new ClusterState.TopicSnap();
        orders.name = "orders";
        orders.partitions.add(part(0, 10));
        s.topics = java.util.Map.of("_events", internal, "orders", orders);
        ClusterState.GroupSnap g = new ClusterState.GroupSnap();
        g.groupId = "audit";
        g.committed.put("_events", new java.util.HashMap<>(java.util.Map.of(0, 5L)));
        g.committed.put("orders", new java.util.HashMap<>(java.util.Map.of(0, 5L)));
        s.groups = java.util.Map.of("audit", g);
        var t = Views.topology(s);
        java.util.Set<String> ids = new java.util.HashSet<>();
        t.nodes().forEach(n -> ids.add(n.id()));
        for (var e : t.edges()) {
            assertTrue(ids.contains(e.from()), "edge from a topic with no node: " + e.from());
            assertTrue(ids.contains(e.to()), "edge to a group with no node: " + e.to());
        }
        assertEquals(1, t.edges().size()); // orders → audit only
    }
}
