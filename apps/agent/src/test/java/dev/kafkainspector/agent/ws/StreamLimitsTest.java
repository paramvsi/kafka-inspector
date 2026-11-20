package dev.kafkainspector.agent.ws;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** One session can't make the agent open unbounded Kafka consumers by spreading tails over many connections. */
class StreamLimitsTest {
    static Set<String> tails(int connections, int each) {
        Set<String> keys = new HashSet<>();
        for (int c = 0; c < connections; c++) for (int i = 0; i < each; i++) keys.add("conn" + c + "|t" + i);
        return keys;
    }

    @Test
    void tailsAreCappedPerConnectionAndInTotal() {
        assertNull(StreamHandler.tailRefusal(tails(1, 7), "conn0|", "conn0|new"));
        assertEquals("Too many live tails on this connection (8).", StreamHandler.tailRefusal(tails(1, 8), "conn0|", "conn0|new"));
        // 4 connections × 8 = 32 tails: a fifth connection's first tail is refused, though it has none yet
        assertEquals("Too many live tails on this agent (32). Close a live tail elsewhere and try again.",
                StreamHandler.tailRefusal(tails(4, 8), "conn4|", "conn4|t0"));
        // a re-sent id replaces its own tail, so it never counts against either limit
        assertNull(StreamHandler.tailRefusal(tails(4, 8), "conn0|", "conn0|t3"));
    }
}
