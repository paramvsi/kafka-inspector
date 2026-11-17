package dev.kafkainspector.agent.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import org.junit.jupiter.api.Test;

class ErrorHandlerTest {
    @Test
    void aTimeoutWithNoMessageSaysKafkaDidntAnswerInTimeNotAClassName() {
        var r = new ErrorHandler().kafka(new java.util.concurrent.TimeoutException());
        assertEquals(502, r.getStatusCode().value());
        String m = r.getBody().error().message();
        assertFalse(m.contains("TimeoutException"), m);
        assertEquals("Kafka didn't answer in time. Check that the brokers are reachable from the agent.", m);
    }
}
