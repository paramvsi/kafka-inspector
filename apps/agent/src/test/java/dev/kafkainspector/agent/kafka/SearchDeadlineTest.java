package dev.kafkainspector.agent.kafka;

import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.kafkainspector.agent.api.Dto;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** A sampled search over one topic with many partitions stops at the 10 s budget, as a many-topic search does. */
class SearchDeadlineTest {
    @Test
    void theBudgetHoldsInsideATopicsPartitions() {
        var slow = new MessageService(null) {
            @Override
            public Dto.RawMessagePage browse(String cid, String topic, String partition, String from, Long offset, String timestamp, Map<Integer, Long> groupOffsets, int limit, String cursor) {
                try {
                    Thread.sleep(500); // each partition's read (a real one can take its 4 s budget)
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                return new Dto.RawMessagePage(List.of(), null, 0, null);
            }
        };
        var snap = new ClusterState.TopicSnap();
        snap.name = "wide";
        for (int i = 0; i < 40; i++) {
            var p = new ClusterState.PartSnap();
            p.partition = i;
            snap.partitions.add(p);
        }
        long t0 = System.nanoTime();
        Dto.RawMessagePage page = slow.search("c", "wide", "newest", 100, true, Map.of("wide", snap));
        long ms = (System.nanoTime() - t0) / 1_000_000;
        // 40 partitions × 0.5 s = 20 s if the budget is only checked between topics
        assertTrue(ms < 13_000, "the search ran " + ms + " ms");
        assertTrue(page.note() != null && page.note().startsWith("Stopped after 10 s"), "note: " + page.note());
    }
}
