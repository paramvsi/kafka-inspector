package dev.kafkainspector.agent.config;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** Agent configuration (docs/AGENT_API.md "Configuration"): KI_* environment variables or kafka-inspector.yml. */
@ConfigurationProperties("ki")
public record KiProperties(
        String adminPassword,
        @DefaultValue("true") boolean readOnly,
        @DefaultValue("7d") Duration historyRetention,
        @DefaultValue("10s") Duration sampleInterval,
        @DefaultValue("30") int lagWindow,
        List<Cluster> clusters) {

    public record Cluster(
            String name,
            String bootstrap,
            @DefaultValue("PLAINTEXT") String security,
            String saslMechanism,
            String saslUsername,
            String saslPassword,
            String sslTruststoreLocation,
            String sslTruststorePassword,
            String schemaRegistry,
            String schemaRegistryUsername,
            String schemaRegistryPassword) {

        /** Never print credentials (rule 6). */
        @Override
        public String toString() {
            return name + " (" + security + (saslMechanism != null ? ", " + saslMechanism : "") + ")";
        }
    }
}
