package dev.kafkainspector.agent.config;

import static org.junit.jupiter.api.Assertions.*;

import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

/** Settings that would fail every request (or silently replace a cluster) fail at startup instead. */
class ClustersTest {
    static KiProperties.Cluster c(String name, String security, String mech) {
        return new KiProperties.Cluster(name, "b:9092", security, mech, null, null, null, null, null, null, null);
    }

    static Clusters of(KiProperties.Cluster... cs) {
        return new Clusters(new KiProperties("pw", true, Duration.ofDays(7), Duration.ofSeconds(10), 30, List.of(cs)), new MockEnvironment());
    }

    @Test
    void duplicateIdsSecurityAndMechanismAreRejected() {
        assertTrue(assertThrows(IllegalStateException.class, () -> of(c("Prod", "PLAINTEXT", null), c("prod", "PLAINTEXT", null))).getMessage().contains("distinct"));
        assertThrows(IllegalStateException.class, () -> of(c("a", "sasl_ssl", null)));
        assertThrows(IllegalStateException.class, () -> of(c("a", "SASL_SSL", "plain")));
        assertTrue(assertThrows(IllegalStateException.class, () -> of(c("a", "SASL_SSL", "OAUTHBEARER"))).getMessage().contains("token endpoint"));
        assertDoesNotThrow(() -> of(c("a", "SASL_SSL", "SCRAM-SHA-512"), c("b", "SSL", null)));
    }
}
