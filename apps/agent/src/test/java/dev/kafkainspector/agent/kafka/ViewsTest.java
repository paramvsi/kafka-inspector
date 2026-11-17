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
        assertEquals(2048L, Views.topic(s, t, List.of()).sizeBytes());
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
}
