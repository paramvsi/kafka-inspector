package dev.kafkainspector.agent.schemas;

import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpServer;
import dev.kafkainspector.agent.config.Clusters;
import dev.kafkainspector.agent.config.KiProperties;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import tools.jackson.databind.json.JsonMapper;

/** A compatibility check without a type uses the subject's own type, not Avro (JSON Schema subjects were checked as Avro). */
class SchemaRegistryTest {
    @Test
    void aCheckWithoutATypeUsesTheSubjectsType() throws Exception {
        AtomicReference<String> sent = new AtomicReference<>();
        HttpServer reg = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        reg.createContext("/subjects/free-value/versions/latest", x -> {
            byte[] b = "{\"subject\":\"free-value\",\"version\":1,\"id\":7,\"schemaType\":\"JSON\",\"schema\":\"{}\"}".getBytes(StandardCharsets.UTF_8);
            x.sendResponseHeaders(200, b.length);
            x.getResponseBody().write(b);
            x.close();
        });
        reg.createContext("/compatibility/", x -> {
            sent.set(new String(x.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] b = "{\"is_compatible\":true,\"messages\":[]}".getBytes(StandardCharsets.UTF_8);
            x.sendResponseHeaders(200, b.length);
            x.getResponseBody().write(b);
            x.close();
        });
        reg.start();
        try {
            var c = new KiProperties.Cluster("local", "b:9092", "PLAINTEXT", null, null, null, null, null, "http://127.0.0.1:" + reg.getAddress().getPort(), null, null);
            var clusters = new Clusters(new KiProperties("pw", true, Duration.ofDays(7), Duration.ofSeconds(10), 30, List.of(c)), new MockEnvironment());
            new SchemaRegistry(clusters, JsonMapper.builder().build()).compatibility("local", "free-value", "{\"type\":\"object\"}", null);
            assertTrue(sent.get().contains("\"schemaType\":\"JSON\""), sent.get());
        } finally {
            reg.stop(0);
        }
    }
}
