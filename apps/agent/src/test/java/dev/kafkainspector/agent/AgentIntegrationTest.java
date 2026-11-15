package dev.kafkainspector.agent;

import static org.junit.jupiter.api.Assertions.*;

import java.net.CookieManager;
import java.net.HttpCookie;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.admin.Admin;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.consumer.OffsetAndMetadata;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.apache.kafka.common.serialization.StringSerializer;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.kafka.KafkaContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Every endpoint against a real Kafka 4.1 (KRaft) in Testcontainers; security and read-only guarantees. */
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ExtendWith(OutputCaptureExtension.class)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class AgentIntegrationTest {
    static final String PASSWORD = "correct horse battery staple";
    static final String SASL_SECRET = "do-not-log-this-sasl-secret";

    @Container
    static final KafkaContainer KAFKA = new KafkaContainer("apache/kafka:4.1.0");

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("ki.admin-password", () -> PASSWORD);
        r.add("ki.sample-interval", () -> "1s");
        r.add("ki.lag-window", () -> "5");
        r.add("ki.clusters[0].name", () -> "local");
        r.add("ki.clusters[0].bootstrap", KAFKA::getBootstrapServers);
        r.add("ki.clusters[0].security", () -> "PLAINTEXT");
        // a password is configured on purpose: it must never appear in logs or responses
        r.add("ki.clusters[0].schema-registry-password", () -> SASL_SECRET);
        r.add("spring.datasource.url", () -> "jdbc:h2:mem:ki;DB_CLOSE_DELAY=-1");
    }

    @LocalServerPort
    int port;

    static final JsonMapper JSON = JsonMapper.builder().build();
    final CookieManager cookies = new CookieManager();
    final HttpClient http = HttpClient.newBuilder().cookieHandler(cookies).build();

    @BeforeAll
    static void seed() throws Exception {
        try (Admin admin = Admin.create(Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            admin.createTopics(List.of(new NewTopic("orders", 3, (short) 1), new NewTopic("payments", 2, (short) 1))).all().get(30, TimeUnit.SECONDS);
        }
        try (KafkaProducer<String, String> p = new KafkaProducer<>(Map.of("bootstrap.servers", KAFKA.getBootstrapServers(), "key.serializer", StringSerializer.class.getName(), "value.serializer", StringSerializer.class.getName()))) {
            for (int i = 0; i < 300; i++) p.send(new ProducerRecord<>("orders", "ord_" + i, "{\"orderId\":\"ord_" + i + "\",\"total\":" + i + "}"));
            p.flush();
        }
        // a consumer group that reads half of orders and commits
        try (KafkaConsumer<String, String> c = new KafkaConsumer<>(Map.of("bootstrap.servers", KAFKA.getBootstrapServers(), "group.id", "order-service", "key.deserializer", StringDeserializer.class.getName(), "value.deserializer", StringDeserializer.class.getName(), ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest", ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false", ConsumerConfig.MAX_POLL_RECORDS_CONFIG, "150"))) {
            c.subscribe(List.of("orders"));
            int n = 0;
            long until = System.currentTimeMillis() + 20_000;
            while (n < 150 && System.currentTimeMillis() < until) n += c.poll(Duration.ofMillis(500)).count();
            c.commitSync();
        }
    }

    HttpResponse<String> send(String method, String path, String body) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).timeout(Duration.ofSeconds(20)).header("Accept", "application/json");
        String csrf = cookies.getCookieStore().getCookies().stream().filter(c -> c.getName().equals("KI_CSRF")).map(HttpCookie::getValue).findFirst().orElse(null);
        if (csrf != null) b.header("X-KI-CSRF", csrf);
        if (body != null) b.header("Content-Type", "application/json");
        b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        return http.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    JsonNode get(String path) throws Exception {
        HttpResponse<String> r = send("GET", path, null);
        assertEquals(200, r.statusCode(), () -> path + " → " + r.body());
        return JSON.readTree(r.body());
    }

    void signIn() throws Exception {
        send("GET", "/api/info", null); // sets KI_CSRF
        HttpResponse<String> r = send("POST", "/api/auth/login", "{\"username\":\"admin\",\"password\":\"" + PASSWORD + "\"}");
        assertEquals(204, r.statusCode(), r::body);
    }

    @Test
    @Order(1)
    void unauthenticatedCallsGet401ButHealthAndInfoAreOpen() throws Exception {
        assertEquals(200, send("GET", "/api/health", null).statusCode());
        JsonNode info = JSON.readTree(send("GET", "/api/info", null).body());
        assertEquals("agent", info.path("mode").asString());
        assertFalse(info.path("signedIn").asBoolean(true));
        HttpResponse<String> r = send("GET", "/api/clusters", null);
        assertEquals(401, r.statusCode());
        assertEquals("UNAUTHENTICATED", JSON.readTree(r.body()).path("error").path("code").asString());
    }

    @Test
    @Order(2)
    void loginNeedsCsrfAndTheRightPasswordAndSetsAStrictSessionCookie() throws Exception {
        assertEquals(403, send("POST", "/api/auth/login", "{\"username\":\"admin\",\"password\":\"x\"}").statusCode(), "no CSRF header yet");
        send("GET", "/api/info", null);
        assertEquals(401, send("POST", "/api/auth/login", "{\"username\":\"admin\",\"password\":\"wrong\"}").statusCode());
        HttpResponse<String> ok = send("POST", "/api/auth/login", "{\"username\":\"admin\",\"password\":\"" + PASSWORD + "\"}");
        assertEquals(204, ok.statusCode());
        String setCookie = String.join(";", ok.headers().allValues("set-cookie"));
        assertTrue(setCookie.contains("KI_SESSION"), setCookie);
        assertTrue(setCookie.contains("HttpOnly"), setCookie);
        assertTrue(setCookie.toLowerCase().contains("samesite=strict"), setCookie);
        assertTrue(get("/api/info").path("readOnly").asBoolean());
        assertFalse(get("/api/info").path("capabilities").path("writes").asBoolean(true));
    }

    @Test
    @Order(99)
    void loginIsRateLimitedTo5PerMinuteEvenInAParallelBurstWithSpoofedForwardedFor() throws Exception {
        CookieManager cm = new CookieManager();
        HttpClient c = HttpClient.newBuilder().cookieHandler(cm).build();
        c.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/info")).build(), HttpResponse.BodyHandlers.ofString());
        String csrf = cm.getCookieStore().getCookies().stream().filter(x -> x.getName().equals("KI_CSRF")).findFirst().orElseThrow().getValue();
        java.util.function.IntFunction<Long> burst = spoof -> {
            List<java.util.concurrent.CompletableFuture<HttpResponse<String>>> rs = new ArrayList<>();
            for (int i = 0; i < 40; i++) {
                HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/auth/login"))
                        .header("X-KI-CSRF", csrf).header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString("{\"username\":\"admin\",\"password\":\"nope\"}"));
                if (spoof == 1) b.header("X-Forwarded-For", "203.0.113." + i); // a client inventing addresses
                rs.add(c.sendAsync(b.build(), HttpResponse.BodyHandlers.ofString()));
            }
            return rs.stream().map(java.util.concurrent.CompletableFuture::join).filter(r -> r.statusCode() == 401).count();
        };
        assertEquals(5, burst.apply(0), "parallel attempts from one address: only 5 password checks");
        long spoofed = burst.apply(1);
        assertTrue(spoofed <= 25, "forged X-Forwarded-For got " + spoofed + " password checks; the global cap is 30/min");
    }

    @Test
    @Order(13)
    void catastrophicRegexesFailFastAndDeletedRulesStayDeleted() throws Exception {
        signIn();
        long t0 = System.currentTimeMillis();
        // (.*){1,20}y takes ~1.6 s against a 26-character name on Java 21 without the budget
        assertThrows(IllegalArgumentException.class, () -> dev.kafkainspector.agent.api.SafeRegex.find(java.util.regex.Pattern.compile("(.*){1,20}y"), "x".repeat(26), 50));
        assertEquals(400, send("GET", "/api/clusters/local/topics?regex=true&query=" + "a".repeat(201), null).statusCode());
        assertTrue(System.currentTimeMillis() - t0 < 5_000, "regex checks took too long");

        String body = "{\"name\":\"temp\",\"metric\":\"lag\",\"scope\":{\"kind\":\"any\"},\"threshold\":1,\"durationSec\":0,\"severity\":\"warn\",\"channels\":[\"in-app\"],\"enabled\":true}";
        String id = JSON.readTree(send("POST", "/api/alerts/rules", body).body()).path("id").asString();
        assertEquals(204, send("DELETE", "/api/alerts/rules/" + id, null).statusCode());
        assertEquals(404, send("PUT", "/api/alerts/rules/" + id, body).statusCode());
        assertTrue(get("/api/alerts/rules").findValuesAsString("id").stream().noneMatch(id::equals));
    }

    @Test
    @Order(15)
    void browsingAMisspelledTopicIs404AndNeverCreatesIt() throws Exception {
        signIn();
        assertEquals(404, send("GET", "/api/clusters/local/topics/ordrs-typo/messages?limit=5", null).statusCode());
        // also through the consumer directly (bypassing the API check), as the live tail does
        try (var c = kafka.consumer("local", 5)) {
            c.partitionsFor("ordrs-typo-2", Duration.ofSeconds(5));
        } catch (Exception ignored) {
            // unknown topic: fine
        }
        Thread.sleep(1000);
        try (Admin admin = Admin.create(Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            var names = admin.listTopics().names().get(10, TimeUnit.SECONDS);
            assertFalse(names.contains("ordrs-typo"), names::toString);
            assertFalse(names.contains("ordrs-typo-2"), names::toString);
        }
    }

    @Test
    @Order(16)
    void malformedRequestsGet4xxInTheApiErrorShapeNever500() throws Exception {
        signIn();
        java.util.function.BiConsumer<HttpResponse<String>, Integer> expect = (r, status) -> {
            assertEquals(status, r.statusCode(), r::body);
            if (r.uri().getPath().startsWith("/api/")) assertFalse(JSON.readTree(r.body()).path("error").path("code").asString("").isEmpty(), r::body);
        };
        expect.accept(send("POST", "/api/auth/login", null), 400);
        expect.accept(send("GET", "/api/clusters/local/topics?page=abc", null), 400);
        assertEquals(200, send("GET", "/api/clusters/local/topics?page=2147483647", null).statusCode());
        expect.accept(send("POST", "/api/alerts/events/nope/mute", "{}"), 400);
        expect.accept(send("POST", "/api/alerts/events/nope/mute", "{\"until\":\"2030-01-01T00:00:00Z\"}"), 404);
        expect.accept(send("POST", "/api/alerts/events/nope/ack", null), 404);
        expect.accept(send("POST", "/api/alerts/rules", "{\"name\":\"a\",\"metric\":\"lag\"}"), 400);
        expect.accept(send("GET", "/api/clusters/local/history?metric=bytesOut&scope=topic&key=orders", null), 400);
        expect.accept(send("GET", "/api/clusters/local/history?metric=lag&scope=group&key=x&range=2y", null), 400);
        expect.accept(send("GET", "/api/clusters/local/brokers/999/config", null), 404);
        HttpResponse<String> page = send("GET", "/nope.js", null);
        assertEquals(404, page.statusCode());
    }

    @org.springframework.beans.factory.annotation.Autowired
    dev.kafkainspector.agent.kafka.KafkaService kafka;

    @org.springframework.beans.factory.annotation.Autowired
    dev.kafkainspector.agent.history.HistoryRepository history;

    @org.springframework.beans.factory.annotation.Autowired
    org.springframework.jdbc.core.JdbcTemplate jdbc;

    @Test
    @Order(14)
    void retentionExpiresDownsamplesAndPrunesResolvedAlertEvents() {
        long now = System.currentTimeMillis(), hour = 3_600_000, day = 24 * hour;
        long tenMin = 600_000, oneMin = 60_000;
        long old2d = (now - 2 * day) / tenMin * tenMin, old2h = (now - 2 * hour) / oneMin * oneMin;
        history.insert(List.of(
                new dev.kafkainspector.agent.history.HistoryRepository.Row("prune", "cluster", "", "lag", now - 8 * day, 1), // past 7 d retention
                new dev.kafkainspector.agent.history.HistoryRepository.Row("prune", "cluster", "", "lag", old2d, 2), // 10-min boundary: kept
                new dev.kafkainspector.agent.history.HistoryRepository.Row("prune", "cluster", "", "lag", old2d + 5 * oneMin, 3), // > 24 h, mid-10-min
                new dev.kafkainspector.agent.history.HistoryRepository.Row("prune", "cluster", "", "lag", old2h, 4), // minute boundary: kept
                new dev.kafkainspector.agent.history.HistoryRepository.Row("prune", "cluster", "", "lag", old2h + 30_000, 5), // > 1 h, mid-minute
                new dev.kafkainspector.agent.history.HistoryRepository.Row("prune", "cluster", "", "lag", now - 600_000 + 30_000, 6))); // last hour: kept
        String ev = "INSERT INTO alert_event VALUES (?, 'prune', 'r', 'warn', 't', 'e', 'x', '/', ?, ?, NULL, NULL, FALSE)";
        jdbc.update(ev, "old-resolved", "resolved", now - 8 * day);
        jdbc.update(ev, "old-firing", "firing", now - 8 * day);
        jdbc.update(ev, "new-resolved", "resolved", now - day);

        history.prune(now);

        assertEquals(List.of(2.0, 4.0, 6.0), jdbc.queryForList("SELECT val FROM metric_sample WHERE cluster = 'prune' ORDER BY ts", Double.class));
        assertEquals(List.of("new-resolved", "old-firing"), jdbc.queryForList("SELECT id FROM alert_event WHERE cluster = 'prune' ORDER BY id", String.class));
    }

    java.net.http.WebSocket openStream(HttpClient client, String origin, List<String> received, java.util.concurrent.CountDownLatch closed) throws Exception {
        return client.newWebSocketBuilder().header("Origin", origin).buildAsync(URI.create("ws://localhost:" + port + "/api/stream"), new java.net.http.WebSocket.Listener() {
            @Override
            public java.util.concurrent.CompletionStage<?> onText(java.net.http.WebSocket ws, CharSequence data, boolean last) {
                received.add(data.toString());
                ws.request(1);
                return null;
            }

            @Override
            public java.util.concurrent.CompletionStage<?> onClose(java.net.http.WebSocket ws, int code, String reason) {
                closed.countDown();
                return null;
            }
        }).get(10, TimeUnit.SECONDS);
    }

    @Test
    @Order(12)
    void liveStreamRefusesOtherOriginsAndClosesOnSignOut() throws Exception {
        signIn();
        var none = new java.util.concurrent.CountDownLatch(1);
        Exception refused = assertThrows(Exception.class, () -> openStream(http, "http://localhost:8081", new ArrayList<>(), none));
        assertEquals(403, ((java.net.http.WebSocketHandshakeException) refused.getCause()).getResponse().statusCode());

        var closed = new java.util.concurrent.CountDownLatch(1);
        var ws = openStream(http, "http://localhost:" + port, java.util.Collections.synchronizedList(new ArrayList<>()), closed);
        ws.sendText("{\"op\":\"sub\",\"id\":\"m\",\"cluster\":\"local\",\"channel\":\"metrics\"}", true);
        assertEquals(204, send("POST", "/api/auth/logout", null).statusCode());
        assertTrue(closed.await(10, TimeUnit.SECONDS), "socket still open after sign-out");
    }

    @Test
    @Order(4)
    void topicsGroupsLagAndHistory() throws Exception {
        signIn();
        JsonNode clusters = get("/api/clusters");
        assertEquals("local", clusters.get(0).path("id").asString());
        // wait for a few sampler passes
        long until = System.currentTimeMillis() + 30_000;
        JsonNode groups;
        do {
            Thread.sleep(1000);
            groups = get("/api/clusters/local/groups");
        } while ((groups.size() == 0 || groups.get(0).path("status").asString().equals("unknown")) && System.currentTimeMillis() < until);
        JsonNode g = groups.get(0);
        assertEquals("order-service", g.path("groupId").asString());
        assertEquals(150, g.path("totalLag").asLong());
        assertTrue(Set.of("stopped", "stalled", "warn", "healthy").contains(g.path("status").asString()), g.toString());

        JsonNode topics = get("/api/clusters/local/topics?internal=false");
        assertTrue(topics.path("total").asInt() >= 2);
        JsonNode orders = get("/api/clusters/local/topics/orders");
        assertEquals(3, orders.path("partitions").size());
        assertEquals(300, sum(orders.path("partitions"), "highWatermark"));
        assertEquals("order-service", orders.path("consumers").get(0).path("groupId").asString());
        assertFalse(get("/api/clusters/local/topics/orders/config").isEmpty());
        assertEquals(404, send("GET", "/api/clusters/local/topics/nope", null).statusCode());

        JsonNode detail = get("/api/clusters/local/groups/order-service");
        assertEquals(3, detail.path("partitions").size());
        assertTrue(get("/api/clusters/local/history?metric=lag&scope=group&key=order-service&range=15m").get(0).path("points").size() > 0);
        assertTrue(get("/api/clusters/local/overview").path("kpis").path("totalPartitions").asInt() >= 5);
        assertFalse(get("/api/clusters/local/brokers").isEmpty());
        assertTrue(get("/api/clusters/local/topology").path("edges").size() >= 1);
        assertTrue(get("/api/alerts/rules").size() >= 6);
    }

    static long sum(JsonNode arr, String field) {
        long s = 0;
        for (JsonNode n : arr) s += n.path(field).asLong();
        return s;
    }

    @Test
    @Order(5)
    void browsingNeverChangesCommittedOffsets() throws Exception {
        signIn();
        Map<TopicPartition, OffsetAndMetadata> before;
        try (Admin admin = Admin.create(Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            before = admin.listConsumerGroupOffsets("order-service").partitionsToOffsetAndMetadata().get(20, TimeUnit.SECONDS);
        }
        JsonNode newest = get("/api/clusters/local/topics/orders/messages?from=newest&limit=50");
        assertEquals(50, newest.path("messages").size());
        String value = new String(Base64.getDecoder().decode(newest.path("messages").get(0).path("value").asString()));
        assertTrue(value.startsWith("{\"orderId\""), value);
        JsonNode oldest = get("/api/clusters/local/topics/orders/messages?from=oldest&partition=0&limit=10");
        assertEquals(0, oldest.path("messages").get(0).path("offset").asLong());
        assertNotNull(oldest.path("nextCursor").asString(null));
        get("/api/clusters/local/topics/orders/messages?from=group&group=order-service&limit=20");
        get("/api/clusters/local/topics/orders/messages?from=offset&offset=5&partition=1&limit=5");
        JsonNode search = JSON.readTree(send("POST", "/api/clusters/local/messages/search", "{\"topicRegex\":\"ord.*\",\"from\":\"newest\",\"limit\":20}").body());
        assertTrue(search.path("messages").size() > 0);
        try (Admin admin = Admin.create(Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            assertEquals(before, admin.listConsumerGroupOffsets("order-service").partitionsToOffsetAndMetadata().get(20, TimeUnit.SECONDS));
            assertTrue(admin.listGroups().all().get(20, TimeUnit.SECONDS).stream().noneMatch(l -> l.groupId().startsWith("kafka-inspector")), "browsing must not create consumer groups");
        }
    }

    @Test
    @Order(6)
    void thereAreNoWriteRoutes() throws Exception {
        signIn();
        assertTrue(Set.of(404, 405).contains(send("POST", "/api/clusters/local/topics", "{\"name\":\"x\"}").statusCode()));
        assertTrue(Set.of(404, 405).contains(send("DELETE", "/api/clusters/local/topics/orders", null).statusCode()));
        assertTrue(Set.of(404, 405).contains(send("POST", "/api/clusters/local/topics/orders/messages", "{}").statusCode()));
        assertTrue(Set.of(404, 405).contains(send("POST", "/api/clusters/local/groups/order-service/offsets", "{}").statusCode()));
        assertTrue(Set.of(404, 405).contains(send("DELETE", "/api/clusters/local/groups/order-service", null).statusCode()));
    }

    @Test
    @Order(7)
    void secretsNeverReachLogsOrResponses(CapturedOutput out) throws Exception {
        signIn();
        assertFalse(out.getAll().contains(PASSWORD), "admin password logged");
        assertFalse(out.getAll().contains(SASL_SECRET), "registry password logged");
        assertFalse(get("/api/clusters").toString().contains(SASL_SECRET));
        assertFalse(get("/api/info").toString().contains(SASL_SECRET));
    }

    @Test
    @Order(8)
    void schemaRoutesExplainWhenNoRegistryIsConfiguredAndAlertRulesAreAppData() throws Exception {
        signIn();
        HttpResponse<String> r = send("GET", "/api/clusters/local/schemas/subjects", null);
        assertEquals(404, r.statusCode());
        assertEquals("NO_SCHEMA_REGISTRY", JSON.readTree(r.body()).path("error").path("code").asString());
        HttpResponse<String> saved = send("POST", "/api/alerts/rules", "{\"name\":\"e2e\",\"metric\":\"lag\",\"scope\":{\"kind\":\"any\"},\"threshold\":10,\"durationSec\":0,\"severity\":\"warn\",\"channels\":[\"in-app\"],\"enabled\":true}");
        assertEquals(200, saved.statusCode(), saved::body);
        String id = JSON.readTree(saved.body()).path("id").asString();
        assertEquals(204, send("DELETE", "/api/alerts/rules/" + id, null).statusCode());
        assertTrue(get("/api/alerts/rules").findValuesAsString("id").stream().noneMatch(id::equals));
    }

    @Test
    @Order(9)
    void savedFiltersLiveInTheAgentDbAndAreValidated() throws Exception {
        signIn();
        assertEquals(204, send("PUT", "/api/filters/big%20orders", "{\"expr\":\"value.total > 100\"}").statusCode());
        assertEquals(204, send("PUT", "/api/filters/big%20orders", "{\"expr\":\"value.total > 500\"}").statusCode());
        var list = get("/api/filters");
        assertEquals(1, list.size());
        assertEquals("big orders", list.get(0).path("name").asString());
        assertEquals("value.total > 500", list.get(0).path("expr").asString());
        HttpResponse<String> bad = send("PUT", "/api/filters/x", "{\"expr\":\"\"}");
        assertEquals(400, bad.statusCode());
    }

    @Test
    @Order(10)
    void workerScriptsMayEvalButHaveNoNetworkWhilePagesMayNotEval() throws Exception {
        String worker = send("GET", "/_next/static/chunks/turbopack-worker-test.js", null).headers().firstValue("content-security-policy").orElseThrow();
        assertTrue(worker.contains("'unsafe-eval'"), worker);
        assertTrue(worker.contains("connect-src 'none'"), worker);
        String page = send("GET", "/app/", null).headers().firstValue("content-security-policy").orElseThrow();
        assertFalse(page.contains("'unsafe-eval'"), page);
    }

    @Test
    @Order(11)
    void servesTheWebAppAndRedirectsRoot() throws Exception {
        HttpResponse<String> root = HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/")).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(302, root.statusCode());
        assertEquals("/app/", URI.create(root.headers().firstValue("location").orElseThrow()).getPath());
    }
}
