package dev.kafkainspector.agent.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;

class ConfigErrorAnalyzerTest {
    @Test
    void ourConfigErrorsBecomeTheStartupDescription() {
        var a = new ConfigErrorAnalyzer();
        String msg = "Cluster a: security SASL_SSL needs KI_CLUSTERS_n_SASL_MECHANISM (PLAIN, SCRAM-SHA-256 or SCRAM-SHA-512).";
        var r = a.analyze(new RuntimeException("Error creating bean", new IllegalStateException(msg)));
        assertEquals(msg, r.getDescription());
        assertNull(a.analyze(new IllegalStateException("unrelated")));
    }
}
