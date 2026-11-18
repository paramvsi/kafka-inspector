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
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
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

    @Test
    @ExtendWith(OutputCaptureExtension.class)
    void anUnreachableRegistryErrorNeverCarriesTheUrlCredentials(CapturedOutput out) throws Exception {
        int port;
        try (var probe = new java.net.ServerSocket(0)) {
            port = probe.getLocalPort(); // closed again: nothing listens there
        }
        var c = new KiProperties.Cluster("local", "b:9092", "PLAINTEXT", null, null, null, null, null, "http://127.0.0.1:" + port /* userinfo in the URL is refused at startup (ClustersTest) */, "reg-user", "reg-pw-sentinel");
        var clusters = new Clusters(new KiProperties("pw", true, Duration.ofDays(7), Duration.ofSeconds(10), 30, List.of(c)), new MockEnvironment());
        Exception e = org.junit.jupiter.api.Assertions.assertThrows(Exception.class,
                () -> new SchemaRegistry(clusters, JsonMapper.builder().build()).compatibility("local", "x-value", "{}", null));
        assertTrue(!e.getMessage().contains("s3cret") && !e.getMessage().contains("admin:"), e.getMessage());
        // the warning the agent logs (SchemaRegistry: "unreachable at …") is captured and carries no credential
        assertTrue(out.getAll().contains("unreachable at"), "nothing captured: " + out.getAll());
        for (String secret : List.of("s3cret", "admin:", "reg-pw-sentinel"))
            assertTrue(!out.getAll().contains(secret) && !e.getMessage().contains(secret), secret + " leaked: " + out.getAll());
    }

    private static SchemaRegistry against(HttpServer reg) {
        var c = new KiProperties.Cluster("local", "b:9092", "PLAINTEXT", null, null, null, null, null, "http://127.0.0.1:" + reg.getAddress().getPort(), null, null);
        var clusters = new Clusters(new KiProperties("pw", true, Duration.ofDays(7), Duration.ofSeconds(10), 30, List.of(c)), new MockEnvironment());
        return new SchemaRegistry(clusters, JsonMapper.builder().build());
    }

    private static void answer(com.sun.net.httpserver.HttpExchange x, int status, String body) throws java.io.IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        x.sendResponseHeaders(status, b.length);
        x.getResponseBody().write(b);
        x.close();
    }

    @Test
    void spacesAreEncodedAsSpacesAndRegistryBodiesStayOutOfErrors() throws Exception {
        AtomicReference<String> asked = new AtomicReference<>();
        HttpServer reg = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        reg.createContext("/subjects/", x -> {
            asked.set(x.getRequestURI().getRawPath());
            if (x.getRequestURI().getRawPath().contains("locked")) answer(x, 401, "<html>login at internal-proxy.corp:8443</html>");
            else if (x.getRequestURI().getRawPath().contains("proxy")) answer(x, 200, "<html>not json</html>");
            else answer(x, 200, "{\"subject\":\"my subject\",\"version\":1,\"id\":3,\"schemaType\":\"JSON\",\"schema\":\"{}\"}");
        });
        reg.start();
        try {
            SchemaRegistry r = against(reg);
            r.get("local", "my subject", "latest");
            assertTrue(asked.get().contains("my%20subject"), asked.get());
            Exception refused = org.junit.jupiter.api.Assertions.assertThrows(Exception.class, () -> r.get("local", "locked", "latest"));
            assertTrue(refused.getMessage().contains("credentials") && !refused.getMessage().contains("internal-proxy"), refused.getMessage());
            Exception html = org.junit.jupiter.api.Assertions.assertThrows(Exception.class, () -> r.get("local", "proxy", "latest"));
            assertTrue(html.getMessage().contains("isn't JSON"), html.getMessage());
        } finally {
            reg.stop(0);
        }
    }

    @Test
    void registryCompatibilityMessagesReadAsSentences() {
        String raw = "{errorType:'TYPE_MISMATCH', description:'The type (path '/fields/0/type') of a field in the new schema does not match with the old schema', additionalInfo:'reader type: STRING not compatible with writer type: INT'}";
        org.junit.jupiter.api.Assertions.assertEquals(
                "The type (path '/fields/0/type') of a field in the new schema does not match with the old schema (reader type: STRING not compatible with writer type: INT).",
                SchemaRegistry.readable(raw));
        org.junit.jupiter.api.Assertions.assertEquals("plain text stays as it is", SchemaRegistry.readable("plain text stays as it is"));
    }
}
