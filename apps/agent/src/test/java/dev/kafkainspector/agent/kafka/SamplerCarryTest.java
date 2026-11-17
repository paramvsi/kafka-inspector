package dev.kafkainspector.agent.kafka;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Map;
import java.util.TreeMap;
import org.junit.jupiter.api.Test;

/** A group whose describe failed this pass keeps its last snapshot instead of vanishing (its lag windows were pruned). */
class SamplerCarryTest {
    @Test
    void aFailedDescribeCarriesTheGroupForward() {
        var prev = new ClusterState.GroupSnap();
        prev.groupId = "billing";
        prev.type = "classic";
        prev.state = "Stable";
        var m = new ClusterState.MemberSnap();
        m.memberId = "c-1";
        prev.members.add(m);
        prev.committed.put("orders", new TreeMap<>(Map.of(0, 100L)));
        var fresh = new ClusterState.GroupSnap();
        fresh.groupId = "billing";
        fresh.state = "Unknown";
        Sampler.carryOver(fresh, prev);
        assertEquals("Stable", fresh.state);
        assertEquals(1, fresh.members.size());
        assertEquals(100L, fresh.committed.get("orders").get(0));
        prev.committed.get("orders").put(0, 999L); // a copy, not the published snapshot's map
        assertEquals(100L, fresh.committed.get("orders").get(0));
    }
}
