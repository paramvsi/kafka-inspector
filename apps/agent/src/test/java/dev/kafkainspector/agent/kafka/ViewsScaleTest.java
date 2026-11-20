package dev.kafkainspector.agent.kafka;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** The topic list and topic detail are polled every 2 s: at a real cluster's size they must stay well under it. */
class ViewsScaleTest {
    @Test
    void summarisingEveryTopicDoesNotScanEveryGroupPerTopic() {
        ClusterState s = new ClusterState();
        Map<String, ClusterState.TopicSnap> topics = new HashMap<>();
        for (int i = 0; i < 2000; i++) {
            var t = new ClusterState.TopicSnap();
            t.name = "t" + i;
            t.partitions.add(new ClusterState.PartSnap());
            topics.put(t.name, t);
        }
        Map<String, ClusterState.GroupSnap> groups = new HashMap<>();
        for (int g = 0; g < 400; g++) {
            var gs = new ClusterState.GroupSnap();
            gs.groupId = "g" + g;
            for (int m = 0; m < 5; m++) {
                var ms = new ClusterState.MemberSnap();
                for (int a = 0; a < 80; a++) ms.assignments.add(new String[] {"t" + ((g * 100 + m * 20 + a) % 2000), "0"});
                gs.members.add(ms);
            }
            groups.put(gs.groupId, gs);
        }
        s.topics = topics;
        s.groups = groups;
        long start = System.nanoTime();
        for (var t : topics.values()) Views.topic(s, t, List.of());
        long ms = (System.nanoTime() - start) / 1_000_000;
        // the count is still right: groups whose members are assigned t7, checked by brute force
        long expected = groups.values().stream().filter(g -> g.members.stream().anyMatch(m -> m.assignments.stream().anyMatch(a -> a[0].equals("t7")))).count();
        assertEquals((int) expected, Views.topic(s, topics.get("t7"), List.of()).consumerGroups());
        assertTrue(ms < 1000, "2,000 topics × 400 groups took " + ms + " ms");
    }

    @Test
    void aWidePartitionedTopicReadByManyGroupsBuildsItsDetailQuickly() {
        ClusterState s = new ClusterState();
        var t = new ClusterState.TopicSnap();
        t.name = "wide";
        for (int p = 0; p < 2000; p++) {
            var ps = new ClusterState.PartSnap();
            ps.partition = p;
            ps.high = 100;
            t.partitions.add(ps);
        }
        s.topics = Map.of("wide", t);
        Map<String, ClusterState.GroupSnap> groups = new HashMap<>();
        for (int g = 0; g < 400; g++) {
            var gs = new ClusterState.GroupSnap();
            gs.groupId = "g" + g;
            Map<Integer, Long> c = new HashMap<>();
            for (int p = 0; p < 2000; p++) c.put(p, 90L);
            gs.committed.put("wide", c);
            groups.put(gs.groupId, gs);
        }
        s.groups = groups;
        long start = System.nanoTime();
        var d = Views.topicDetail(s, t, List.of(), Set.of());
        long ms = (System.nanoTime() - start) / 1_000_000;
        assertEquals(20_000L, d.consumers().get(0).lag()); // 2,000 partitions × 10 behind
        assertTrue(ms < 1000, "a 2,000-partition topic × 400 groups took " + ms + " ms");
    }
}
