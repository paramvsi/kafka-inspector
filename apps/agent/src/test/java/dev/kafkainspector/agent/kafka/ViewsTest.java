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
}
