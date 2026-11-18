package dev.kafkainspector.agent.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.apache.kafka.common.config.SaslConfigs;
import org.apache.kafka.common.config.types.Password;
import org.apache.kafka.common.security.JaasContext;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

/** Whatever a SASL password holds, Kafka's own JAAS parser reads back exactly that password and no extra option. */
class JaasEscapeTest {
    static Map<String, ?> parsed(String password) {
        var c = new KiProperties.Cluster("prod", "b:9092", "SASL_SSL", "SCRAM-SHA-512", "svc", password, null, null, null, null, null);
        var clusters = new Clusters(new KiProperties("pw", true, Duration.ofDays(7), Duration.ofSeconds(10), 30, List.of(c)), new MockEnvironment());
        String jaas = clusters.clientProps(c).getProperty(SaslConfigs.SASL_JAAS_CONFIG);
        return JaasContext.loadClientContext(Map.of(SaslConfigs.SASL_JAAS_CONFIG, new Password(jaas))).configurationEntries().get(0).getOptions();
    }

    @Test
    void quotesBackslashesSemicolonsAndNewlinesSurviveTheJaasString() {
        for (String pw : List.of("p\"a;ss\\", "x\" useKeyTab=\"true", "line1\nline2", "tab\there\r")) {
            var opts = parsed(pw);
            assertEquals(pw, opts.get("password"), "password round-trips: " + pw.replace("\n", "\\n"));
            assertFalse(opts.containsKey("useKeyTab"), "no option injected");
        }
    }
}
