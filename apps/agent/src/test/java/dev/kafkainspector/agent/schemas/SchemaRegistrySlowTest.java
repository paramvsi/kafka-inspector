package dev.kafkainspector.agent.schemas;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpServer;
import dev.kafkainspector.agent.config.Clusters;
import dev.kafkainspector.agent.config.KiProperties;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import tools.jackson.databind.json.JsonMapper;

/** A struggling registry fails the subject list as soon as one subject fails, not after every slow fetch finishes. */
class SchemaRegistrySlowTest {
    static void reply(com.sun.net.httpserver.HttpExchange x, int status, String body) throws java.io.IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        x.sendResponseHeaders(status, b.length);
        x.getResponseBody().write(b);
        x.close();
    }

    @Test
    void oneFailingSubjectEndsTheListingInsteadOfWaitingForEverySlowFetch() throws Exception {
        HttpServer reg = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        reg.setExecutor(Executors.newVirtualThreadPerTaskExecutor()); // many slow requests at once, like a busy registry
        StringBuilder names = new StringBuilder("[");
        for (int i = 0; i < 40; i++) names.append(i == 0 ? "" : ",").append("\"s").append(i).append("-value\"");
        names.append("]");
        reg.createContext("/config", x -> reply(x, 200, "{\"compatibilityLevel\":\"BACKWARD\"}"));
        reg.createContext("/subjects", x -> {
            String p = x.getRequestURI().getPath();
            if (p.equals("/subjects")) {
                reply(x, 200, names.toString());
            } else if (p.startsWith("/subjects/s0-value/")) {
                reply(x, 500, "{\"error_code\":50001}"); // the first subject fails at once
            } else {
                try {
                    Thread.sleep(3000); // every other fetch is slow
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                reply(x, 200, p.endsWith("/versions") ? "[1]" : "{\"version\":1,\"schemaType\":\"AVRO\"}");
            }
        });
        reg.start();
        try {
            var c = new KiProperties.Cluster("local", "b:9092", "PLAINTEXT", null, null, null, null, null, "http://127.0.0.1:" + reg.getAddress().getPort(), null, null);
            var clusters = new Clusters(new KiProperties("pw", true, Duration.ofDays(7), Duration.ofSeconds(10), 30, List.of(c)), new MockEnvironment());
            var registry = new SchemaRegistry(clusters, JsonMapper.builder().build());
            long t0 = System.nanoTime();
            assertThrows(RuntimeException.class, () -> registry.subjects("local"));
            long ms = (System.nanoTime() - t0) / 1_000_000;
            // 39 slow subjects, 16 at a time, 2–3 slow calls each: ~20 s if the listing waits for all of them
            assertTrue(ms < 6000, "the failed listing took " + ms + " ms");
        } finally {
            reg.stop(0);
        }
    }
}
