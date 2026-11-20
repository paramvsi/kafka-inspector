package dev.kafkainspector.agent.kafka;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.kafkainspector.agent.alerts.AlertService;
import dev.kafkainspector.agent.config.Clusters;
import dev.kafkainspector.agent.config.KiProperties;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.apache.kafka.clients.admin.Admin;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;

/** One unreachable cluster mustn't delay sampling of the others: they're sampled side by side, not in turn. */
class SamplerParallelTest {
    @Test
    void slowClustersAreSampledSideBySide() {
        List<KiProperties.Cluster> cs = new ArrayList<>();
        for (String n : List.of("a", "b", "c")) cs.add(new KiProperties.Cluster(n, "b:9092", "PLAINTEXT", null, null, null, null, null, null, null, null));
        var clusters = new Clusters(new KiProperties("pw", true, Duration.ofDays(7), Duration.ofSeconds(10), 30, cs), new MockEnvironment());
        var slow = new KafkaService(clusters) {
            @Override
            public Admin admin(String cid) {
                try {
                    Thread.sleep(1500); // a cluster that doesn't answer (the real wait is up to 20 s)
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                throw new IllegalStateException("unreachable");
            }

            @Override
            public void reset(String cid) {}
        };
        var sampler = new Sampler(clusters, slow, null, new AlertService(new JdbcTemplate()), null);
        List<String> seen = new java.util.concurrent.CopyOnWriteArrayList<>();
        sampler.onSample((cid, s) -> seen.add(cid));
        long t0 = System.nanoTime();
        sampler.sampleAll();
        long ms = (System.nanoTime() - t0) / 1_000_000;
        assertTrue(ms < 3000, "3 slow clusters took " + ms + " ms — sampled one after another");
        assertEquals(List.copyOf(clusters.all().keySet()), seen, "listeners still run once per cluster, in order");
        assertEquals("unreachable", sampler.state("b").error);
    }
}
