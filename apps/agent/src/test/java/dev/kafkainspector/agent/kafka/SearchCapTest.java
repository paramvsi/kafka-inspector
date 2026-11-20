package dev.kafkainspector.agent.kafka;

import static org.junit.jupiter.api.Assertions.assertEquals;

import dev.kafkainspector.agent.api.Dto;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** A multi-topic search keeps at most `limit` messages AND at most one page of bytes (20 topics × 16 MB otherwise). */
class SearchCapTest {
    @Test
    void theMergedResultStopsAtOnePageOfBytes() {
        List<Dto.RawMessage> newestFirst = new ArrayList<>();
        for (int i = 0; i < 100; i++) newestFirst.add(new Dto.RawMessage("t" + (i % 20), 0, i, "2026-01-01T00:00:00Z", null, "", List.of(), 1_000_000));
        List<Dto.RawMessage> kept = MessageService.firstFitting(newestFirst, 500, MessageService.PAGE_BYTES);
        assertEquals(16, kept.size(), "16 × 1 MB fit in 16 MiB, the 17th doesn't");
        assertEquals(0, kept.get(0).offset(), "the newest are kept");
        // one message bigger than the whole budget still comes back (as browse does), alone
        assertEquals(1, MessageService.firstFitting(List.of(new Dto.RawMessage("t", 0, 0, "2026-01-01T00:00:00Z", null, "", List.of(), 40_000_000)), 500, MessageService.PAGE_BYTES).size());
    }

    @Test
    void aSearchThatSkipsTopicsSaysSo() {
        assertEquals("Searched the first 20 of 42 matching topics, by name. Narrow the pattern to search the rest.", MessageService.searchNote(42, 20, false));
        assertEquals("Stopped after 10 s: searched 3 of 20 matching topics. Narrow the pattern to search the rest.", MessageService.searchNote(20, 3, true));
        assertEquals(null, MessageService.searchNote(5, 5, false));
    }

    @Test
    void anUnknownSearchStartIsRefusedNotReadAsNewest() {
        // validated before Kafka is touched, so no client is needed; browse refuses the same way
        var e = org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class,
                () -> new MessageService(null).search("local", ".*", "sideways", 10, false, java.util.Map.of()));
        assertEquals("from must be newest or oldest.", e.getMessage());
    }
}
