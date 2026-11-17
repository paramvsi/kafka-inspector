package dev.kafkainspector.agent.config;

import static org.junit.jupiter.api.Assertions.*;

import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

/** Settings that would fail every request (or silently replace a cluster) fail at startup instead. */
class ClustersTest {
    static KiProperties.Cluster c(String name, String security, String mech) {
        return new KiProperties.Cluster(name, "b:9092", security, mech, mech == null ? null : "u", mech == null ? null : "pw", null, null, null, null, null);
    }

    static KiProperties.Cluster c(String security, String mech, String user, String truststore) {
        return new KiProperties.Cluster("prod", "b:9092", security, mech, user, "pw", truststore, null, null, null, null);
    }

    static void refused(String part, org.junit.jupiter.api.function.Executable r) {
        IllegalStateException e = assertThrows(IllegalStateException.class, r);
        assertTrue(e.getMessage().contains(part), e.getMessage());
    }

    @Test
    void saslAndTruststoreMistakesFailAtStartupNamingTheVariable() {
        refused("KI_CLUSTERS_n_SASL_MECHANISM", () -> of(c("SASL_SSL", null, "u", null)));
        refused("KI_CLUSTERS_n_SASL_USERNAME", () -> of(c("SASL_SSL", "PLAIN", null, null)));
        refused("use SASL_SSL or SASL_PLAINTEXT", () -> of(c("SSL", "PLAIN", "u", null)));
        refused("KI_CLUSTERS_n_SSL_TRUSTSTORE_LOCATION", () -> of(c("SSL", null, null, "/no/such/ca.jks")));
        assertDoesNotThrow(() -> of(c("SASL_SSL", "SCRAM-SHA-512", "u", null)));
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

    @Test
    void aZeroSampleIntervalOrTinyWindowStopsStartup() {
        var c = c("a", "PLAINTEXT", null);
        assertTrue(assertThrows(IllegalStateException.class, () -> new Clusters(new KiProperties("pw", true, Duration.ofDays(7), Duration.ZERO, 30, List.of(c)), new MockEnvironment())).getMessage().contains("KI_SAMPLE_INTERVAL"));
        assertTrue(assertThrows(IllegalStateException.class, () -> new Clusters(new KiProperties("pw", true, Duration.ofDays(7), Duration.ofSeconds(10), 1, List.of(c)), new MockEnvironment())).getMessage().contains("KI_LAG_WINDOW"));
        assertTrue(assertThrows(IllegalStateException.class, () -> new Clusters(new KiProperties("pw", true, Duration.ZERO, Duration.ofSeconds(10), 30, List.of(c)), new MockEnvironment())).getMessage().contains("KI_HISTORY_RETENTION"));
    }

    @Test
    void aReadWriteConfigRefusesToStart() {
        refused("KI_READ_ONLY", () -> new Clusters(new KiProperties("pw", false, Duration.ofDays(7), Duration.ofSeconds(10), 30, List.of(c("a", "PLAINTEXT", null))), new MockEnvironment()));
    }

    @Test
    void aBlankClusterNameGetsTheDefaultIdNotAnEmptyOne() {
        Clusters cs = of(c("  ", "PLAINTEXT", null));
        assertDoesNotThrow(() -> cs.get("default"));
    }

    @Test
    void aMalformedRegistryUrlStopsStartupWithoutEchoingIt() {
        var bad = new KiProperties.Cluster("prod", "b:9092", "PLAINTEXT", null, null, null, null, null, "http://user:s3cret pw@reg:8081", null, null);
        String msg = assertThrows(IllegalStateException.class, () -> of(bad)).getMessage();
        assertTrue(msg.contains("KI_CLUSTERS_n_SCHEMA_REGISTRY"), msg);
        assertFalse(msg.contains("s3cret"), msg);
    }

    @Test
    void anAdminPasswordOverBcryptsLimitStopsStartupNamingTheVariable() {
        var c = c("a", "PLAINTEXT", null);
        String msg = assertThrows(IllegalStateException.class, () -> new Clusters(new KiProperties("p".repeat(80), true, Duration.ofDays(7), Duration.ofSeconds(10), 30, List.of(c)), new MockEnvironment())).getMessage();
        assertTrue(msg.contains("KI_ADMIN_PASSWORD"), msg);
    }

    @Test
    void aBareNumberRetentionAndAnOverlongNameFailAtStartup() {
        KiProperties.Cluster c = c("prod", "PLAINTEXT", null);
        // KI_HISTORY_RETENTION=7 binds as 7 ms: it passed "> 0" and every prune deleted all history
        assertTrue(assertThrows(IllegalStateException.class, () -> new Clusters(new KiProperties("pw", true, Duration.ofMillis(7), Duration.ofSeconds(10), 30, List.of(c)), new MockEnvironment())).getMessage().contains("KI_HISTORY_RETENTION"));
        // the id lands in VARCHAR(100) columns: a longer name started fine, then every history write failed
        assertTrue(assertThrows(IllegalStateException.class, () -> of(c("x".repeat(101), "PLAINTEXT", null))).getMessage().contains("KI_CLUSTERS_n_NAME"));
    }
}
