package dev.kafkainspector.agent.config;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import org.apache.kafka.clients.CommonClientConfigs;
import org.apache.kafka.common.config.SaslConfigs;
import org.apache.kafka.common.config.SslConfigs;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/** Resolves configured clusters (incl. the KAFKA_BOOTSTRAP shortcut) and builds client properties. Fails fast. */
@Component
public class Clusters {
    private static final Logger log = LoggerFactory.getLogger(Clusters.class);
    private final Map<String, KiProperties.Cluster> byId = new LinkedHashMap<>();

    public Clusters(KiProperties props, Environment env) {
        if (props.adminPassword() == null || props.adminPassword().isBlank()) {
            throw new IllegalStateException("KI_ADMIN_PASSWORD is required. Set it to the password you will use to sign in as admin.");
        }
        checkPasswordLength(props.adminPassword());
        if (!props.readOnly()) {
            throw new IllegalStateException("KI_READ_ONLY=false is not supported in this version: the agent is read-only. Remove the variable to start.");
        }
        // 0 s would sample the user's cluster in a tight loop; a window under 2 samples can't judge lag
        if (props.sampleInterval().compareTo(java.time.Duration.ofSeconds(1)) < 0)
            throw new IllegalStateException("KI_SAMPLE_INTERVAL must be at least 1s (it is " + props.sampleInterval() + "). Set it to 10s, the default, or more.");
        if (props.lagWindow() < 2)
            throw new IllegalStateException("KI_LAG_WINDOW must be at least 2 samples (it is " + props.lagWindow() + "). Remove it to use 30.");
        // a bare number is milliseconds to Spring (KI_HISTORY_RETENTION=7 is 7 ms): every prune would delete all history
        if (props.historyRetention().compareTo(java.time.Duration.ofHours(1)) < 0)
            throw new IllegalStateException("KI_HISTORY_RETENTION must be at least 1h (it is " + props.historyRetention() + "). Give a unit, like 7d or 48h, or remove it to keep 7d.");
        List<KiProperties.Cluster> list = new ArrayList<>(props.clusters() == null ? List.of() : props.clusters());
        String shortcut = env.getProperty("KAFKA_BOOTSTRAP");
        if (list.isEmpty() && shortcut != null && !shortcut.isBlank()) {
            list.add(new KiProperties.Cluster("default", shortcut, "PLAINTEXT", null, null, null, null, null, env.getProperty("SCHEMA_REGISTRY_URL"), null, null));
        }
        if (list.isEmpty()) {
            throw new IllegalStateException("No Kafka cluster configured. Set KAFKA_BOOTSTRAP=host:9092, or KI_CLUSTERS_0_NAME and KI_CLUSTERS_0_BOOTSTRAP.");
        }
        for (KiProperties.Cluster c : list) {
            if (c.bootstrap() == null || c.bootstrap().isBlank()) throw new IllegalStateException("Cluster " + c.name() + " has no bootstrap servers (KI_CLUSTERS_n_BOOTSTRAP).");
            if (c.schemaRegistry() != null && !c.schemaRegistry().isBlank()) {
                try {
                    java.net.URI u = java.net.URI.create(c.schemaRegistry());
                    if (u.getScheme() == null || u.getHost() == null) throw new IllegalArgumentException();
                } catch (IllegalArgumentException e) {
                    // never echo the URL: it may carry credentials (rule 6)
                    throw new IllegalStateException("Cluster " + c.name() + ": the Schema Registry URL isn't a valid http(s) URL (KI_CLUSTERS_n_SCHEMA_REGISTRY). Put credentials in KI_CLUSTERS_n_SCHEMA_REGISTRY_USERNAME and _PASSWORD, not in the URL.");
                }
            }
            if (c.name() != null && c.name().length() > 100) // the id is stored in VARCHAR(100) history and alert columns
                throw new IllegalStateException("A cluster name is " + c.name().length() + " characters; at most 100 fit (KI_CLUSTERS_n_NAME).");
            String id = c.name() == null || c.name().isBlank() ? "default" : c.name().toLowerCase().replaceAll("[^a-z0-9._-]", "-");
            // fail fast on settings that would otherwise fail every request (or silently replace a cluster)
            if (byId.containsKey(id))
                throw new IllegalStateException("Two clusters resolve to the id \"" + id + "\" (" + byId.get(id).name() + ", " + c.name() + "). Give each cluster a distinct KI_CLUSTERS_n_NAME.");
            if (!List.of("PLAINTEXT", "SSL", "SASL_PLAINTEXT", "SASL_SSL").contains(c.security()))
                throw new IllegalStateException("Cluster " + c.name() + ": security " + c.security() + " is not one of PLAINTEXT, SSL, SASL_PLAINTEXT, SASL_SSL (upper case).");
            if ("OAUTHBEARER".equals(c.saslMechanism()))
                throw new IllegalStateException("Cluster " + c.name() + ": OAUTHBEARER needs a token endpoint and client credentials, which this version doesn't configure. Use PLAIN or SCRAM.");
            if (c.saslMechanism() != null && !c.saslMechanism().isBlank() && !List.of("PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512").contains(c.saslMechanism()))
                throw new IllegalStateException("Cluster " + c.name() + ": SASL mechanism " + c.saslMechanism() + " is not one of PLAIN, SCRAM-SHA-256, SCRAM-SHA-512.");
            // combinations that would otherwise fail every request with an obscure Kafka error
            boolean sasl = c.security().startsWith("SASL");
            boolean hasMech = c.saslMechanism() != null && !c.saslMechanism().isBlank();
            if (sasl && !hasMech)
                throw new IllegalStateException("Cluster " + c.name() + ": security " + c.security() + " needs KI_CLUSTERS_n_SASL_MECHANISM (PLAIN, SCRAM-SHA-256 or SCRAM-SHA-512).");
            if (sasl && (c.saslUsername() == null || c.saslUsername().isBlank()))
                throw new IllegalStateException("Cluster " + c.name() + ": security " + c.security() + " needs KI_CLUSTERS_n_SASL_USERNAME and KI_CLUSTERS_n_SASL_PASSWORD.");
            if (!sasl && hasMech)
                throw new IllegalStateException("Cluster " + c.name() + ": KI_CLUSTERS_n_SASL_MECHANISM is set but security is " + c.security() + "; use SASL_SSL or SASL_PLAINTEXT.");
            boolean hasUser = c.saslUsername() != null && !c.saslUsername().isBlank();
            boolean hasPassword = c.saslPassword() != null && !c.saslPassword().isBlank();
            // a username alone would send password="" and fail every call at authentication
            if (sasl && !hasPassword)
                throw new IllegalStateException("Cluster " + c.name() + ": security " + c.security() + " needs KI_CLUSTERS_n_SASL_PASSWORD as well as the username.");
            // credentials on a non-SASL protocol would be ignored and the agent would connect unauthenticated
            if (!sasl && (hasUser || hasPassword))
                throw new IllegalStateException("Cluster " + c.name() + ": SASL credentials are set but security is " + c.security() + "; use SASL_SSL or SASL_PLAINTEXT, or remove KI_CLUSTERS_n_SASL_USERNAME and _PASSWORD.");
            if (c.sslTruststoreLocation() != null && !c.sslTruststoreLocation().isBlank() && !java.nio.file.Files.isReadable(java.nio.file.Path.of(c.sslTruststoreLocation())))
                throw new IllegalStateException("Cluster " + c.name() + ": KI_CLUSTERS_n_SSL_TRUSTSTORE_LOCATION " + c.sslTruststoreLocation() + " doesn't exist or can't be read. Mount the file into the container.");
            byId.put(id, c);
        }
        // startup log lists clusters and security protocol only (AGENT_API security checklist)
        log.info("Kafka Inspector agent · read-only · clusters: {}", byId.values());
        log.info("History retention: {} (1 sample/min after 1 h, 1/10 min after 24 h)", props.historyRetention());
    }

    public Map<String, KiProperties.Cluster> all() {
        return byId;
    }

    public KiProperties.Cluster get(String id) {
        KiProperties.Cluster c = byId.get(id);
        if (c == null) throw new NotFound("CLUSTER_NOT_FOUND", "No cluster with id " + id + ". GET /api/clusters lists them.");
        return c;
    }

    public Properties clientProps(KiProperties.Cluster c) {
        Properties p = new Properties();
        p.put(CommonClientConfigs.BOOTSTRAP_SERVERS_CONFIG, c.bootstrap());
        p.put(CommonClientConfigs.SECURITY_PROTOCOL_CONFIG, c.security());
        p.put(CommonClientConfigs.CLIENT_ID_CONFIG, "kafka-inspector");
        p.put(CommonClientConfigs.REQUEST_TIMEOUT_MS_CONFIG, 15000);
        p.put(CommonClientConfigs.DEFAULT_API_TIMEOUT_MS_CONFIG, 20000);
        if (c.saslMechanism() != null && !c.saslMechanism().isBlank()) {
            p.put(SaslConfigs.SASL_MECHANISM, c.saslMechanism());
            String module = switch (c.saslMechanism()) {
                case "PLAIN" -> "org.apache.kafka.common.security.plain.PlainLoginModule";
                default -> "org.apache.kafka.common.security.scram.ScramLoginModule";
            };
            if (c.saslUsername() != null) {
                p.put(SaslConfigs.SASL_JAAS_CONFIG, module + " required username=\"" + esc(c.saslUsername()) + "\" password=\"" + esc(c.saslPassword()) + "\";");
            }
        }
        if (c.sslTruststoreLocation() != null && !c.sslTruststoreLocation().isBlank()) {
            p.put(SslConfigs.SSL_TRUSTSTORE_LOCATION_CONFIG, c.sslTruststoreLocation());
            if (c.sslTruststorePassword() != null) p.put(SslConfigs.SSL_TRUSTSTORE_PASSWORD_CONFIG, c.sslTruststorePassword());
        }
        return p;
    }

    /** An SSLContext trusting the cluster's truststore (JKS or PKCS12, detected by the JDK). */
    public static javax.net.ssl.SSLContext trusting(KiProperties.Cluster c) {
        try {
            char[] pw = c.sslTruststorePassword() == null ? null : c.sslTruststorePassword().toCharArray();
            java.security.KeyStore ks = java.security.KeyStore.getInstance(new java.io.File(c.sslTruststoreLocation()), pw);
            var tmf = javax.net.ssl.TrustManagerFactory.getInstance(javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm());
            tmf.init(ks);
            var ctx = javax.net.ssl.SSLContext.getInstance("TLS");
            ctx.init(null, tmf.getTrustManagers(), null);
            return ctx;
        } catch (Exception e) {
            throw new IllegalStateException("Cluster " + c.name() + ": couldn't load KI_CLUSTERS_n_SSL_TRUSTSTORE_LOCATION for the Schema Registry: " + e.getMessage());
        }
    }

    private static String esc(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    public static class NotFound extends RuntimeException {
        public final String code;

        public NotFound(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    /** bcrypt hashes at most 72 bytes and Spring Security refuses longer input: say so by name, not with a stack trace. */
    public static void checkPasswordLength(String password) {
        if (password != null && password.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 72)
            throw new IllegalStateException("KI_ADMIN_PASSWORD is longer than 72 bytes, which bcrypt can't hash. Use a shorter password (72 bytes; fewer characters if it has non-ASCII ones).");
    }
}
