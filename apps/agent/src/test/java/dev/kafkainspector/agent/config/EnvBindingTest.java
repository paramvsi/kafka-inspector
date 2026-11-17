package dev.kafkainspector.agent.config;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.env.SystemEnvironmentPropertySource;

/** The exact variable names apps/web/lib/selfhost.ts writes bind to the agent's settings (a typo there is silently ignored). */
class EnvBindingTest {
    @Test
    void everyVariableTheSelfHostGeneratorWritesBinds() {
        Map<String, Object> env = new HashMap<>();
        env.put("KI_ADMIN_PASSWORD", "pw");
        env.put("KI_READ_ONLY", "true");
        env.put("KI_CLUSTERS_0_NAME", "acme");
        env.put("KI_CLUSTERS_0_BOOTSTRAP", "b-1:9096");
        env.put("KI_CLUSTERS_0_SECURITY", "SASL_SSL");
        env.put("KI_CLUSTERS_0_SASL_MECHANISM", "SCRAM-SHA-512");
        env.put("KI_CLUSTERS_0_SASL_USERNAME", "u");
        env.put("KI_CLUSTERS_0_SASL_PASSWORD", "p");
        env.put("KI_CLUSTERS_0_SCHEMA_REGISTRY", "https://sr:8081");
        env.put("KI_CLUSTERS_0_SCHEMA_REGISTRY_USERNAME", "sru");
        env.put("KI_CLUSTERS_0_SCHEMA_REGISTRY_PASSWORD", "srp");
        var e = new StandardEnvironment();
        // under the real source name: Spring applies the KI_CLUSTERS_0_* mapping only to the system environment source
        e.getPropertySources().replace(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME,
                new SystemEnvironmentPropertySource(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME, env));
        KiProperties p = Binder.get(e).bind("ki", KiProperties.class).get();
        KiProperties.Cluster c = p.clusters().get(0);
        assertEquals("pw", p.adminPassword());
        assertEquals(List.of("acme", "b-1:9096", "SASL_SSL", "SCRAM-SHA-512", "u", "p", "https://sr:8081", "sru", "srp"),
                List.of(c.name(), c.bootstrap(), c.security(), c.saslMechanism(), c.saslUsername(), c.saslPassword(),
                        String.valueOf(c.schemaRegistry()), String.valueOf(c.schemaRegistryUsername()), String.valueOf(c.schemaRegistryPassword())));
    }
}
