package dev.kafkainspector.agent.schemas;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import org.junit.jupiter.api.Test;

class SchemaRegistryFailureTest {
    @Test
    void anInvalidCandidateSchemaIsTheUsersToFixNotARetry() {
        // 422 = the registry parsed the request and rejected the schema: retrying never helps
        RuntimeException e = SchemaRegistry.failure(422);
        assertInstanceOf(IllegalArgumentException.class, e); // → 400, not 503 "Try again"
        assertEquals("The Schema Registry rejected that schema as invalid. Check the schema text and its type (Avro, JSON or Protobuf).", e.getMessage());
        assertInstanceOf(IllegalStateException.class, SchemaRegistry.failure(500)); // a registry fault stays a 503
    }
}
