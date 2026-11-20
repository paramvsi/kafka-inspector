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
    void browseRequestsThatCantMeanAnythingAreRefusedNotAnsweredWithAnEmptyPage() throws Exception {
        signIn();
        String base = "/api/clusters/local/topics/orders/messages?";
        Map<String, Integer> cases = new LinkedHashMap<>();
        cases.put("partition=999", 404);
        cases.put("partition=abc", 400);
        cases.put("from=bogus", 400);
        cases.put("from=group", 400);
        cases.put("from=group&group=no-such-group", 404);
        cases.put("from=offset", 400);
        cases.put("from=offset&offset=-3", 400);
        cases.put("from=timestamp", 400);
        cases.put("cursor=garbage", 400);
        cases.put("cursor=999:5", 400);
        cases.put("limit=0", 400);
        for (var e : cases.entrySet())
            assertEquals(e.getValue(), send("GET", base + e.getKey() + (e.getKey().startsWith("limit") ? "" : "&limit=5"), null).statusCode(), e.getKey());
        // a next page needs only its cursor, whatever the first page started from
        for (String from : List.of("offset", "timestamp", "group"))
            assertEquals(200, send("GET", base + "from=" + from + "&limit=5&cursor=0:1", null).statusCode(), "Load more from=" + from);
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
        expect.accept(send("POST", "/api/alerts/events/nope/mute", "{\"until\":\"" + java.time.Instant.now().plusSeconds(7200) + "\"}"), 404);
        expect.accept(send("POST", "/api/alerts/events/nope/ack", null), 404);
        expect.accept(send("POST", "/api/alerts/rules", "{\"name\":\"a\",\"metric\":\"lag\"}"), 400);
        expect.accept(send("GET", "/api/clusters/local/history?metric=bytesOut&scope=topic&key=orders", null), 400);
        expect.accept(send("GET", "/api/clusters/local/history?metric=lag&scope=group&key=x&range=2y", null), 400);
        expect.accept(send("GET", "/api/clusters/local/brokers/999/config", null), 404);
        HttpRequest.Builder plain = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/alerts/rules")).header("Content-Type", "text/plain")
                .header("X-KI-CSRF", cookies.getCookieStore().getCookies().stream().filter(x -> x.getName().equals("KI_CSRF")).findFirst().orElseThrow().getValue())
                .POST(HttpRequest.BodyPublishers.ofString("hello"));
        assertEquals(415, http.send(plain.build(), HttpResponse.BodyHandlers.ofString()).statusCode(), "wrong content type is the client's mistake");
        HttpResponse<String> page = send("GET", "/nope.js", null);
        assertEquals(404, page.statusCode());
    }

    @Test
    @Order(17)
    void browsePagesThroughEverythingOnceEndsQuicklyOnTxMarkersAndSurvivesRetention() throws Exception {
        signIn();
        // 1. newest-first pagination over all partitions: every message exactly once
        Set<String> seen = new HashSet<>();
        String cursor = null;
        for (int i = 0; i < 40; i++) {
            JsonNode page = get("/api/clusters/local/topics/orders/messages?limit=50" + (cursor == null ? "" : "&cursor=" + java.net.URLEncoder.encode(cursor, java.nio.charset.StandardCharsets.UTF_8)));
            for (JsonNode m : page.path("messages")) assertTrue(seen.add(m.path("partition").asInt() + ":" + m.path("offset").asLong()), "duplicate " + m);
            cursor = page.path("nextCursor").isNull() || page.path("nextCursor").isMissingNode() ? null : page.path("nextCursor").asString();
            if (cursor == null) break;
        }
        assertEquals(300, seen.size(), "messages reached by paging");

        // 2. a topic that ends with a transaction marker answers without waiting out the 4 s budget
        try (Admin admin = Admin.create(Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            admin.createTopics(List.of(new NewTopic("tx", 1, (short) 1), new NewTopic("retained", 1, (short) 1))).all().get(30, TimeUnit.SECONDS);
        }
        try (KafkaProducer<String, String> p = new KafkaProducer<>(Map.of("bootstrap.servers", KAFKA.getBootstrapServers(), "transactional.id", "it-tx", "key.serializer", StringSerializer.class.getName(), "value.serializer", StringSerializer.class.getName()))) {
            p.initTransactions();
            p.beginTransaction();
            for (int i = 0; i < 5; i++) p.send(new ProducerRecord<>("tx", "k" + i, "{\"n\":" + i + "}"));
            p.commitTransaction();
        }
        Thread.sleep(2500); // sampler sees the new topics
        long t0 = System.currentTimeMillis();
        JsonNode tx = get("/api/clusters/local/topics/tx/messages?limit=10");
        assertEquals(5, tx.path("messages").size());
        assertTrue(System.currentTimeMillis() - t0 < 2500, "took " + (System.currentTimeMillis() - t0) + " ms");

        // 3. a group committed below the log start (retention) is browsed from the log start, not a 500
        try (KafkaProducer<String, String> p = new KafkaProducer<>(Map.of("bootstrap.servers", KAFKA.getBootstrapServers(), "key.serializer", StringSerializer.class.getName(), "value.serializer", StringSerializer.class.getName()))) {
            for (int i = 0; i < 10; i++) p.send(new ProducerRecord<>("retained", "k" + i, "{}"));
            p.flush();
        }
        try (KafkaConsumer<String, String> c = new KafkaConsumer<>(Map.of("bootstrap.servers", KAFKA.getBootstrapServers(), "group.id", "old-reader", "key.deserializer", StringDeserializer.class.getName(), "value.deserializer", StringDeserializer.class.getName()))) {
            c.commitSync(Map.of(new TopicPartition("retained", 0), new OffsetAndMetadata(2)));
        }
        try (Admin admin = Admin.create(Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            admin.deleteRecords(Map.of(new TopicPartition("retained", 0), org.apache.kafka.clients.admin.RecordsToDelete.beforeOffset(6))).all().get(10, TimeUnit.SECONDS);
        }
        Thread.sleep(2500);
        HttpResponse<String> r = send("GET", "/api/clusters/local/topics/retained/messages?from=group&group=old-reader&limit=10", null);
        assertEquals(200, r.statusCode(), r::body);
        assertEquals(6, JSON.readTree(r.body()).path("messages").get(0).path("offset").asLong());
    }

    @Test
    @Order(18)
    void assignedPartitionsWithoutCommitsAreListedNotDropped() throws Exception {
        signIn();
        try (KafkaConsumer<String, String> c = new KafkaConsumer<>(Map.of("bootstrap.servers", KAFKA.getBootstrapServers(), "group.id", "fresh-reader", "key.deserializer", StringDeserializer.class.getName(), "value.deserializer", StringDeserializer.class.getName(), ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false"))) {
            c.subscribe(List.of("payments"));
            long until = System.currentTimeMillis() + 15_000;
            JsonNode parts = null;
            while (System.currentTimeMillis() < until) {
                c.poll(Duration.ofMillis(300)); // stays a live member, never commits
                HttpResponse<String> r = send("GET", "/api/clusters/local/groups/fresh-reader", null);
                if (r.statusCode() == 200) {
                    parts = JSON.readTree(r.body()).path("partitions");
                    if (parts.size() == 2) break;
                }
            }
            assertNotNull(parts);
            assertEquals(2, parts.size(), String.valueOf(parts));
            for (JsonNode p : parts) {
                assertTrue(p.path("committedOffset").isNull() || p.path("committedOffset").isMissingNode(), p::toString);
                assertEquals("unknown", p.path("status").asString());
            }
        }
    }

    @Test
    @Order(19)
    void pagingOverOutOfOrderTimestampsReachesEveryRecordOnce() throws Exception {
        signIn();
        try (Admin admin = Admin.create(Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            admin.createTopics(List.of(new NewTopic("ooo", 2, (short) 1))).all().get(30, TimeUnit.SECONDS);
        }
        long base = System.currentTimeMillis() - 3_600_000;
        try (KafkaProducer<String, String> p = new KafkaProducer<>(Map.of("bootstrap.servers", KAFKA.getBootstrapServers(), "key.serializer", StringSerializer.class.getName(), "value.serializer", StringSerializer.class.getName()))) {
            for (int i = 0; i < 10; i++) {
                p.send(new ProducerRecord<>("ooo", 0, base + (10 - i) * 1000L, "k" + i, "{}")); // p0: CreateTime runs backwards
                p.send(new ProducerRecord<>("ooo", 1, base + i * 1000L, "k" + i, "{}"));
            }
            p.flush();
        }
        Thread.sleep(2500);
        for (String from : List.of("oldest", "newest")) {
            Set<String> seen = new HashSet<>();
            String cursor = null;
            for (int i = 0; i < 30; i++) {
                JsonNode page = get("/api/clusters/local/topics/ooo/messages?limit=3&from=" + from + (cursor == null ? "" : "&cursor=" + java.net.URLEncoder.encode(cursor, java.nio.charset.StandardCharsets.UTF_8)));
                for (JsonNode m : page.path("messages")) assertTrue(seen.add(m.path("partition").asInt() + ":" + m.path("offset").asLong()), from + " duplicate " + m);
                cursor = page.path("nextCursor").isNull() || page.path("nextCursor").isMissingNode() ? null : page.path("nextCursor").asString();
                if (cursor == null) break;
            }
            assertEquals(20, seen.size(), from + ": records reached");
        }
    }

    @org.springframework.beans.factory.annotation.Autowired
    dev.kafkainspector.agent.kafka.KafkaService kafka;

    @org.springframework.beans.factory.annotation.Autowired
    dev.kafkainspector.agent.history.HistoryRepository history;

    @org.springframework.beans.factory.annotation.Autowired
    org.springframework.jdbc.core.JdbcTemplate jdbc;

    @org.springframework.beans.factory.annotation.Autowired
    @org.springframework.beans.factory.annotation.Qualifier("requestMappingHandlerMapping")
    org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping mappings;

    @org.springframework.beans.factory.annotation.Autowired
    dev.kafkainspector.agent.alerts.AlertService alertService;

    @org.springframework.beans.factory.annotation.Autowired
    dev.kafkainspector.agent.kafka.Sampler sampler;

    // runs last (in-memory database for this run only); leaves one switched-off rule and two resolved events
    @Test
    @Order(30)
    void aSwitchedOffRuleAndARemovedClusterStopFiring() {
        long now = System.currentTimeMillis();
        jdbc.update("INSERT INTO alert_rule VALUES ('r-off', 'off', 'lag', 'any', NULL, 0, 0, 'warn', 'in-app', FALSE, FALSE, FALSE)");
        String ev = "INSERT INTO alert_event VALUES (?, ?, ?, 'warn', 't', 'e', 'x', '/', 'firing', ?, NULL, NULL, FALSE)";
        jdbc.update(ev, "ev-off", "local", "r-off", now - 60_000);
        jdbc.update(ev, "ev-gone", "gone-cluster", "r-lag-5k", now - 60_000);
        alertService.evaluate("local", sampler.state("local"), now);
        alertService.resolveOrphans(List.of("local"), now);
        assertEquals(List.of("resolved", "resolved"), jdbc.queryForList("SELECT state FROM alert_event WHERE id IN ('ev-off', 'ev-gone') ORDER BY id", String.class));
    }

    @Test
    @Order(32)
    void aGroupIdLongerThanTheAlertColumnsStillGetsItsAlert() throws Exception {
        String longId = "g".repeat(500);
        try (KafkaConsumer<String, String> c = new KafkaConsumer<>(Map.of("bootstrap.servers", KAFKA.getBootstrapServers(), "group.id", longId, "key.deserializer", StringDeserializer.class.getName(), "value.deserializer", StringDeserializer.class.getName(), ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false"))) {
            c.commitSync(Map.of(new org.apache.kafka.common.TopicPartition("orders", 0), new OffsetAndMetadata(0)));
        }
        jdbc.update("INSERT INTO alert_rule VALUES ('r-long', 'long ids', 'group-status', 'any', NULL, NULL, 0, 'warn', 'in-app', TRUE, FALSE, FALSE)");
        long until = System.currentTimeMillis() + 45_000;
        Integer n = 0;
        while (System.currentTimeMillis() < until && (n = jdbc.queryForObject("SELECT COUNT(*) FROM alert_event WHERE rule_id = 'r-long' AND target LIKE 'ggggg%' AND state = 'firing'", Integer.class)) == 0) Thread.sleep(1000);
        assertEquals(1, n, "no alert for the group with a 500-character id");
        // its history is stored, and a rule can be scoped to it
        until = System.currentTimeMillis() + 15_000;
        Integer h = 0;
        while (System.currentTimeMillis() < until && (h = jdbc.queryForObject("SELECT COUNT(*) FROM metric_sample WHERE skey LIKE 'ggggg%'", Integer.class)) == 0) Thread.sleep(1000);
        assertTrue(h > 0, "no history for the group with a 500-character id");
        signIn();
        String rule = "{\"name\":\"long\",\"metric\":\"lag\",\"scope\":{\"kind\":\"specific\",\"target\":\"" + longId + "\"},\"threshold\":1,\"durationSec\":0,\"severity\":\"warn\",\"channels\":[\"in-app\"],\"enabled\":false}";
        HttpResponse<String> r = send("POST", "/api/alerts/rules", rule);
        assertEquals(200, r.statusCode(), r::body);
    }

    @Test
    @Order(37)
    void attentionLinksEncodeGroupIds() throws Exception {
        signIn();
        try (KafkaConsumer<String, String> c = new KafkaConsumer<>(Map.of("bootstrap.servers", KAFKA.getBootstrapServers(), "group.id", "q&a+b", "key.deserializer", StringDeserializer.class.getName(), "value.deserializer", StringDeserializer.class.getName(), ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false"))) {
            c.commitSync(Map.of(new org.apache.kafka.common.TopicPartition("orders", 0), new OffsetAndMetadata(0)));
        }
        long until = System.currentTimeMillis() + 40_000;
        String href = null;
        while (System.currentTimeMillis() < until && href == null) {
            for (JsonNode a : get("/api/clusters/local/overview").path("attention"))
                if (a.path("id").asString().equals("group-q&a+b")) href = a.path("href").asString();
            if (href == null) Thread.sleep(1000);
        }
        assertEquals("/app/groups/view/?id=q%26a%2Bb", href);
    }

    @Test
    @Order(33)
    void futureDatedHeadsCantStallPagingAndSearchOrdersByRealTime() throws Exception {
        signIn();
        long now = System.currentTimeMillis(), second = now / 1000 * 1000;
        try (Admin admin = Admin.create(Map.of("bootstrap.servers", KAFKA.getBootstrapServers()));
             KafkaProducer<String, String> p = new KafkaProducer<>(Map.of("bootstrap.servers", KAFKA.getBootstrapServers(), "key.serializer", StringSerializer.class.getName(), "value.serializer", StringSerializer.class.getName()))) {
            admin.createTopics(List.of(new NewTopic("future", 2, (short) 1), new NewTopic("tsz", 1, (short) 1))).all().get(30, TimeUnit.SECONDS);
            for (int part = 0; part < 2; part++) {
                p.send(new ProducerRecord<>("future", part, now + 50 * 60_000, "k", "head")); // CreateTime ahead (the broker refuses more than 1 h)
                for (int i = 0; i < 5; i++) p.send(new ProducerRecord<>("future", part, now - 60_000 + i, "k", "v" + i));
            }
            p.send(new ProducerRecord<>("tsz", 0, second, "k", "whole-second"));
            p.send(new ProducerRecord<>("tsz", 0, second + 500, "k", "half-past"));
            p.flush();
        }
        long until = System.currentTimeMillis() + 20_000;
        while (System.currentTimeMillis() < until && get("/api/clusters/local/topics").toString().indexOf("\"tsz\"") < 0) Thread.sleep(500);

        Set<String> seen = new HashSet<>(), cursors = new HashSet<>();
        String cursor = null;
        for (int i = 0; i < 30; i++) {
            JsonNode page = get("/api/clusters/local/topics/future/messages?from=oldest&limit=2" + (cursor == null ? "" : "&cursor=" + java.net.URLEncoder.encode(cursor, java.nio.charset.StandardCharsets.UTF_8)));
            page.path("messages").forEach(m -> seen.add(m.path("partition").asInt() + ":" + m.path("offset").asLong()));
            cursor = page.path("nextCursor").isNull() || page.path("nextCursor").isMissingNode() ? null : page.path("nextCursor").asString();
            if (cursor == null) break;
            assertTrue(cursors.add(cursor), "the same cursor came back: paging is stuck at " + cursor);
        }
        assertEquals(12, seen.size(), () -> "records reached: " + seen);

        HttpResponse<String> r = send("POST", "/api/clusters/local/messages/search", "{\"topicRegex\":\"^tsz$\",\"from\":\"newest\",\"limit\":10}");
        assertEquals(200, r.statusCode(), r::body);
        JsonNode first = JSON.readTree(r.body()).path("messages").get(0);
        assertEquals(1, first.path("offset").asLong(), "newest first: the record half a second later must lead");
    }

    @Test
    @Order(34)
    void namesWithASlashReachTheControllerDecoded() throws Exception {
        signIn();
        HttpResponse<String> g = send("GET", "/api/clusters/local/groups/svc%2Fa", null);
        assertEquals(404, g.statusCode(), () -> "group svc/a → " + g.body());
        assertTrue(g.body().contains("GROUP_NOT_FOUND") && g.body().contains("svc/a"), g::body);
        HttpResponse<String> f = send("PUT", "/api/filters/a%2Fb", "{\"expr\":\"true\"}");
        assertEquals(204, f.statusCode(), () -> "saved filter a/b → " + f.body());
        assertTrue(get("/api/filters").toString().contains("\"a/b\""), "the filter is stored as a/b");
        assertEquals(200, send("GET", "/api/clusters/local/groups/order-service", null).statusCode());
        assertEquals(400, send("GET", "/api/clusters/local/groups/svc%252Fa", null).statusCode(), "double encoding stays refused");
    }

    @Test
    @Order(35)
    void searchSampleSpreadsAcrossPartitionsOtherwiseReadsTheBusiestOne() throws Exception {
        signIn();
        try (Admin admin = Admin.create(Map.of("bootstrap.servers", KAFKA.getBootstrapServers()));
             KafkaProducer<String, String> p = new KafkaProducer<>(Map.of("bootstrap.servers", KAFKA.getBootstrapServers(), "key.serializer", StringSerializer.class.getName(), "value.serializer", StringSerializer.class.getName()))) {
            admin.createTopics(List.of(new NewTopic("spread", 3, (short) 1))).all().get(30, TimeUnit.SECONDS);
            // partition 0 is a minute older: a sample must still reach it (it used to keep only the newest across partitions, flaky on a fast produce)
            long now = System.currentTimeMillis();
            for (int part = 0; part < 3; part++) for (int i = 0; i < 10 + part * 5; i++) p.send(new ProducerRecord<>("spread", part, part == 0 ? now - 60_000 : now, "k", "v" + i));
            p.flush();
        }
        long until = System.currentTimeMillis() + 20_000;
        // wait until the sampler has seen the produced records (all 3 partitions non-empty), not a fixed sleep
        for (long end = System.currentTimeMillis() + 20_000; System.currentTimeMillis() < end; Thread.sleep(500)) {
            HttpResponse<String> t = send("GET", "/api/clusters/local/topics/spread", null);
            if (t.statusCode() != 200) continue;
            JsonNode ps = JSON.readTree(t.body()).path("partitions");
            boolean filled = ps.size() == 3;
            for (JsonNode pn : ps) filled &= pn.path("highWatermark").asLong() > 0;
            if (filled) break;
        }
        Thread.sleep(1500); // rates need a second sample
        java.util.function.Function<Boolean, Set<Integer>> parts = sample -> {
            try {
                HttpResponse<String> r = send("POST", "/api/clusters/local/messages/search", "{\"topicRegex\":\"^spread$\",\"from\":\"newest\",\"limit\":30,\"sample\":" + sample + "}");
                Set<Integer> out = new TreeSet<>();
                JSON.readTree(r.body()).path("messages").forEach(m -> out.add(m.path("partition").asInt()));
                return out;
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        };
        assertEquals(1, parts.apply(false).size(), "without sample: one (the busiest) partition");
        assertEquals(Set.of(0, 1, 2), parts.apply(true), "sample: every partition");
    }

    @Test
    @Order(36)
    void aStoppedGroupsTopologyEdgeShowsWhatItReadsNotWhatTheTopicReceives() throws Exception {
        signIn();
        try (Admin admin = Admin.create(Map.of("bootstrap.servers", KAFKA.getBootstrapServers()));
             KafkaProducer<String, String> p = new KafkaProducer<>(Map.of("bootstrap.servers", KAFKA.getBootstrapServers(), "key.serializer", StringSerializer.class.getName(), "value.serializer", StringSerializer.class.getName()))) {
            admin.createTopics(List.of(new NewTopic("flow", 1, (short) 1))).all().get(30, TimeUnit.SECONDS);
            p.send(new ProducerRecord<>("flow", "k", "first")).get();
            try (KafkaConsumer<String, String> c = new KafkaConsumer<>(Map.of("bootstrap.servers", KAFKA.getBootstrapServers(), "group.id", "flow-reader", "key.deserializer", StringDeserializer.class.getName(), "value.deserializer", StringDeserializer.class.getName(), ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false"))) {
                c.commitSync(Map.of(new org.apache.kafka.common.TopicPartition("flow", 0), new OffsetAndMetadata(1)));
            }
            long until = System.currentTimeMillis() + 8_000;
            while (System.currentTimeMillis() < until) { // the topic keeps receiving; the group reads nothing
                for (int i = 0; i < 50; i++) p.send(new ProducerRecord<>("flow", "k", "v"));
                p.flush();
                Thread.sleep(200);
            }
        }
        JsonNode t = get("/api/clusters/local/topology");
        double topicRate = 0, edgeRate = -1;
        for (JsonNode n : t.path("nodes")) if (n.path("id").asString().equals("topic:flow")) topicRate = n.path("rate").asDouble();
        for (JsonNode e : t.path("edges")) if (e.path("to").asString().equals("group:flow-reader")) edgeRate = e.path("rate").asDouble();
        assertTrue(topicRate > 10, "the topic is busy: " + topicRate);
        assertEquals(0.0, edgeRate, 0.01, "the stopped group reads nothing");
    }

    @Test
    @Order(38)
    void longFiringAlertsStayListedMuteIsValidatedAndPruneCountsFromResolution() throws Exception {
        signIn();
        long now = System.currentTimeMillis(), day = 24 * 3_600_000L;
        String ev = "INSERT INTO alert_event VALUES (?, 'local', 'r-lag-5k', 'warn', 't', 'e', ?, '/', ?, ?, ?, NULL, FALSE)";
        jdbc.update(ev, "old-firing-x", "old-x", "firing", now - 5 * day, null);
        for (int i = 0; i < 30; i++) jdbc.update(ev, "newer-res-" + i, "t" + i, "resolved", now - i * 1000, now - i * 1000);
        JsonNode list = get("/api/alerts/events?state=all&limit=10");
        assertTrue(list.toString().contains("old-firing-x"), "a long-firing alert fell off the list behind newer resolved ones");

        assertEquals(400, send("POST", "/api/alerts/events/old-firing-x/mute", "{\"until\":\"+1000000000-01-01T00:00:00Z\"}").statusCode());
        assertEquals(400, send("POST", "/api/alerts/events/old-firing-x/mute", "{\"until\":\"2000-01-01T00:00:00Z\"}").statusCode());

        jdbc.update(ev, "long-then-resolved", "lr", "resolved", now - 8 * day, now - 3_600_000L);
        history.prune(now);
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM alert_event WHERE id = 'long-then-resolved'", Integer.class), "pruned right after resolving");
    }

    @Test
    @Order(42)
    void newestPagesOfLargeRecordsStillMoveForward() throws Exception {
        signIn();
        String big = "x".repeat(900_000);
        try (Admin admin = Admin.create(Map.of("bootstrap.servers", KAFKA.getBootstrapServers()));
                KafkaProducer<String, String> p = new KafkaProducer<>(Map.of("bootstrap.servers", KAFKA.getBootstrapServers(), "key.serializer", StringSerializer.class.getName(), "value.serializer", StringSerializer.class.getName()))) {
            admin.createTopics(List.of(new NewTopic("bulky", 1, (short) 1))).all().get(30, TimeUnit.SECONDS);
            for (int i = 0; i < 40; i++) p.send(new ProducerRecord<>("bulky", 0, "k" + i, big)).get(30, TimeUnit.SECONDS);
        }
        // 40 × 0.9 MB is over the 16 MB page budget: the page must still show the newest records and move on
        JsonNode page = null;
        for (long end = System.currentTimeMillis() + 20_000; System.currentTimeMillis() < end; Thread.sleep(500)) {
            HttpResponse<String> r = send("GET", "/api/clusters/local/topics/bulky/messages?partition=0&from=newest&limit=40", null);
            if (r.statusCode() == 200) { page = JSON.readTree(r.body()); if (page.path("messages").size() > 0) break; }
        }
        final JsonNode got = page;
        assertTrue(got != null && got.path("messages").size() > 0, () -> "empty page: " + (got == null ? null : got.path("nextCursor")));
        assertEquals(39, got.path("messages").get(0).path("offset").asLong(), "newest first");
    }

    @Test
    @Order(41)
    void newestAcrossPartitionsIsTheGlobalNewestAndABlankCursorIsTheFirstPage() throws Exception {
        signIn();
        try (Admin admin = Admin.create(Map.of("bootstrap.servers", KAFKA.getBootstrapServers()));
                KafkaProducer<String, String> p = new KafkaProducer<>(Map.of("bootstrap.servers", KAFKA.getBootstrapServers(), "key.serializer", StringSerializer.class.getName(), "value.serializer", StringSerializer.class.getName()))) {
            admin.createTopics(List.of(new NewTopic("skewed", 3, (short) 1))).all().get(30, TimeUnit.SECONDS);
            long old = System.currentTimeMillis() - 3_600_000;
            for (int part = 1; part < 3; part++) for (int i = 0; i < 5; i++) p.send(new ProducerRecord<>("skewed", part, old + i, "k", "old" + i));
            for (int i = 0; i < 30; i++) p.send(new ProducerRecord<>("skewed", 0, System.currentTimeMillis(), "k", "new" + i));
            p.flush();
        }
        // newest 10 over all partitions: all from the hot partition 0, not 4 from it plus old ones from the quiet ones
        JsonNode page = null;
        for (long end = System.currentTimeMillis() + 20_000; System.currentTimeMillis() < end; Thread.sleep(500)) {
            HttpResponse<String> r = send("GET", "/api/clusters/local/topics/skewed/messages?partition=all&from=newest&limit=10", null);
            if (r.statusCode() == 200 && JSON.readTree(r.body()).path("messages").size() == 10) { page = JSON.readTree(r.body()); break; }
        }
        assertTrue(page != null, "no page");
        for (JsonNode m : page.path("messages")) assertEquals(0, m.path("partition").asInt(), () -> "an old record from a quiet partition on the newest page");
        // an empty cursor parameter is the first page, not an empty one
        HttpResponse<String> blank = send("GET", "/api/clusters/local/topics/skewed/messages?partition=all&from=newest&limit=10&cursor=", null);
        assertEquals(10, JSON.readTree(blank.body()).path("messages").size(), blank::body);
    }

    @Test
    @Order(40)
    void pruneAndAlertLookupsHaveIndexes() {
        List<String> idx = jdbc.queryForList("SELECT LOWER(INDEX_NAME) FROM INFORMATION_SCHEMA.INDEXES WHERE LOWER(TABLE_NAME) IN ('metric_sample', 'alert_event')", String.class);
        assertTrue(idx.contains("metric_sample_ts") && idx.contains("alert_event_firing"), () -> idx.toString());
    }

    @Test
    @Order(39)
    void groupsListWorstFirstAndConfigOfADeletedTopicIs404() throws Exception {
        signIn();
        List<String> order = List.of("stalled", "stopped", "warn", "unknown");
        int last = -1;
        JsonNode groups = get("/api/clusters/local/groups");
        assertTrue(groups.size() > 1, "need several groups");
        boolean sawUnsortedNames = false;
        for (JsonNode g : groups) {
            String st = g.path("status").asString();
            int r = order.contains(st) ? order.indexOf(st) : 4;
            assertTrue(r >= last, () -> "not worst first: " + groups);
            last = r;
        }
        try (Admin admin = Admin.create(Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            admin.createTopics(List.of(new NewTopic("gone-soon", 1, (short) 1))).all().get(30, TimeUnit.SECONDS);
            long until = System.currentTimeMillis() + 20_000;
            while (System.currentTimeMillis() < until && get("/api/clusters/local/topics?size=500").toString().indexOf("\"gone-soon\"") < 0) Thread.sleep(500);
            admin.deleteTopics(List.of("gone-soon")).all().get(30, TimeUnit.SECONDS);
        }
        // within the sample interval the snapshot still has it; the live config call must say "not found"
        // the broker's metadata can trail the delete acknowledgement on a slow runner: allow a few seconds
        int status = 0;
        String body = "";
        for (long end = System.currentTimeMillis() + 5_000; System.currentTimeMillis() < end && status != 404; Thread.sleep(250)) {
            HttpResponse<String> r = send("GET", "/api/clusters/local/topics/gone-soon/config", null);
            status = r.statusCode();
            body = r.body();
        }
        final int st = status;
        final String b = body;
        assertTrue(st == 404, () -> st + " " + b);
    }

    @Test
    @Order(31)
    void aDeletedAndRecreatedTopicThatReceivesMessagesIsNotSilent() throws Exception {
        signIn();
        try (Admin admin = Admin.create(Map.of("bootstrap.servers", KAFKA.getBootstrapServers()));
             KafkaProducer<String, String> p = new KafkaProducer<>(Map.of("bootstrap.servers", KAFKA.getBootstrapServers(), "key.serializer", StringSerializer.class.getName(), "value.serializer", StringSerializer.class.getName()))) {
            admin.createTopics(List.of(new NewTopic("again", 1, (short) 1))).all().get(30, TimeUnit.SECONDS);
            for (int i = 0; i < 50; i++) p.send(new ProducerRecord<>("again", "k", "v" + i));
            p.flush();
            long until = System.currentTimeMillis() + 20_000;
            while (System.currentTimeMillis() < until && get("/api/clusters/local/topics").toString().indexOf("\"again\"") < 0) Thread.sleep(500);
            Thread.sleep(2500); // a few samples with high = 50
            admin.deleteTopics(List.of("again")).all().get(30, TimeUnit.SECONDS);
            until = System.currentTimeMillis() + 30_000;
            while (true) {
                try {
                    admin.createTopics(List.of(new NewTopic("again", 1, (short) 1))).all().get(30, TimeUnit.SECONDS);
                    break;
                } catch (Exception e) {
                    if (System.currentTimeMillis() > until) throw e;
                    Thread.sleep(500); // deletion still in progress
                }
            }
            long produced = System.currentTimeMillis();
            for (int i = 0; i < 5; i++) p.send(new ProducerRecord<>("again", "k", "w" + i));
            p.flush();
            Thread.sleep(4000);
            HttpResponse<String> r = send("GET", "/api/clusters/local/topics/again", null);
            assertEquals(200, r.statusCode(), r::body);
            String last = JSON.readTree(r.body()).path("partitions").get(0).path("lastMessageAt").asString();
            assertTrue(java.time.Instant.parse(last).toEpochMilli() >= produced - 1000, () -> "lastMessageAt " + last + " is from the old topic");
        }
    }

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
    @Order(11)
    void aBadStreamMessageGetsAnErrorAndTheConnectionStaysUp() throws Exception {
        signIn();
        var closed = new java.util.concurrent.CountDownLatch(1);
        List<String> got = java.util.Collections.synchronizedList(new ArrayList<>());
        var ws = openStream(http, "http://localhost:" + port, got, closed);
        ws.sendText("{\"op\":\"sub\",\"id\":\"gone\",\"cluster\":\"nope\",\"channel\":\"metrics\"}", true).get(5, TimeUnit.SECONDS);
        ws.sendText("not json", true).get(5, TimeUnit.SECONDS);
        ws.sendText("{\"op\":\"sub\",\"id\":\"m\",\"cluster\":\"local\",\"channel\":\"metrics\"}", true).get(5, TimeUnit.SECONDS);
        long until = System.currentTimeMillis() + 15_000;
        while (System.currentTimeMillis() < until && got.stream().noneMatch(x -> x.contains("\"id\":\"m\"") && x.contains("\"data\""))) Thread.sleep(200);
        assertEquals(1, closed.getCount(), "the socket was closed by a bad message");
        assertTrue(got.stream().anyMatch(x -> x.contains("\"id\":\"gone\"") && x.contains("error")), () -> "no error for the bad sub: " + got);
        assertTrue(got.stream().anyMatch(x -> x.contains("\"id\":\"m\"") && x.contains("\"data\"")), () -> "good sub got nothing: " + got);
        ws.abort();
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
    @Order(49)
    void aConsumerBehindOnlyATransactionMarkerIsCaughtUp() throws Exception {
        signIn();
        try (Admin admin = Admin.create(Map.of("bootstrap.servers", KAFKA.getBootstrapServers()));
                KafkaProducer<String, String> p = new KafkaProducer<>(Map.of("bootstrap.servers", KAFKA.getBootstrapServers(), "transactional.id", "it-marker", "key.serializer", StringSerializer.class.getName(), "value.serializer", StringSerializer.class.getName()))) {
            admin.createTopics(List.of(new NewTopic("txmark", 1, (short) 1))).all().get(30, TimeUnit.SECONDS);
            p.initTransactions();
            p.beginTransaction();
            for (int i = 0; i < 3; i++) p.send(new ProducerRecord<>("txmark", 0, "k", "v" + i));
            p.commitTransaction(); // offsets 0-2 are records, 3 is the commit marker: end offset 4
        }
        Map<String, Object> cfg = Map.of("bootstrap.servers", KAFKA.getBootstrapServers(), "group.id", "eos-app", "isolation.level", "read_committed", "enable.auto.commit", "false", "auto.offset.reset", "earliest",
                "key.deserializer", org.apache.kafka.common.serialization.StringDeserializer.class.getName(), "value.deserializer", org.apache.kafka.common.serialization.StringDeserializer.class.getName());
        try (var c = new org.apache.kafka.clients.consumer.KafkaConsumer<String, String>(cfg)) {
            c.subscribe(List.of("txmark"));
            JsonNode lag = null;
            for (long end = System.currentTimeMillis() + 25_000; System.currentTimeMillis() < end; ) {
                c.poll(Duration.ofMillis(300));
                // commit lastRecord+1, as Kafka Streams and per-record acks do: one marker behind the end offset
                if (!c.assignment().isEmpty()) c.commitSync(Map.of(new org.apache.kafka.common.TopicPartition("txmark", 0), new org.apache.kafka.clients.consumer.OffsetAndMetadata(3)));
                HttpResponse<String> r = send("GET", "/api/clusters/local/groups/eos-app", null);
                if (r.statusCode() == 200 && JSON.readTree(r.body()).path("partitions").size() > 0) {
                    Thread.sleep(2500);
                    lag = JSON.readTree(send("GET", "/api/clusters/local/groups/eos-app", null).body()).path("partitions").get(0);
                    break;
                }
            }
            final JsonNode l = lag;
            assertTrue(l != null, "group never appeared");
            assertEquals(0, l.path("lag").asLong(), () -> "a marker counted as lag: " + l);
            assertEquals(3, l.path("committedOffset").asLong(), () -> "the committed offset is shown as Kafka holds it: " + l);
        }
    }

    @Test
    @Order(48)
    void aTopicTheGroupNoLongerReadsIsntLag() throws Exception {
        signIn();
        try (Admin admin = Admin.create(Map.of("bootstrap.servers", KAFKA.getBootstrapServers()));
                KafkaProducer<String, String> p = new KafkaProducer<>(Map.of("bootstrap.servers", KAFKA.getBootstrapServers(), "key.serializer", StringSerializer.class.getName(), "value.serializer", StringSerializer.class.getName()))) {
            admin.createTopics(List.of(new NewTopic("keep-a", 1, (short) 1), new NewTopic("drop-b", 1, (short) 1))).all().get(30, TimeUnit.SECONDS);
            for (int i = 0; i < 20; i++) { p.send(new ProducerRecord<>("keep-a", "k", "v")); p.send(new ProducerRecord<>("drop-b", "k", "v")); }
            p.flush();
        }
        Map<String, Object> cfg = Map.of("bootstrap.servers", KAFKA.getBootstrapServers(), "group.id", "switcher", "auto.offset.reset", "earliest", "enable.auto.commit", "false",
                "key.deserializer", org.apache.kafka.common.serialization.StringDeserializer.class.getName(), "value.deserializer", org.apache.kafka.common.serialization.StringDeserializer.class.getName());
        try (var c = new org.apache.kafka.clients.consumer.KafkaConsumer<String, String>(cfg)) {
            // commit behind on drop-b, then stop reading it while staying in the group
            c.subscribe(List.of("keep-a", "drop-b"));
            for (long end = System.currentTimeMillis() + 15_000; System.currentTimeMillis() < end && c.assignment().size() < 2; ) c.poll(Duration.ofMillis(200));
            c.commitSync(Map.of(new org.apache.kafka.common.TopicPartition("drop-b", 0), new org.apache.kafka.clients.consumer.OffsetAndMetadata(1)));
            c.subscribe(List.of("keep-a"));
            JsonNode detail = null;
            for (long end = System.currentTimeMillis() + 25_000; System.currentTimeMillis() < end; ) {
                c.poll(Duration.ofMillis(300));
                c.commitSync();
                HttpResponse<String> r = send("GET", "/api/clusters/local/groups/switcher", null);
                if (r.statusCode() == 200) {
                    detail = JSON.readTree(r.body());
                    if (detail.toString().contains("keep-a") && detail.path("summary").path("members").asInt() > 0) {
                        Thread.sleep(2500); // another sample with the member assigned only keep-a
                        detail = JSON.readTree(send("GET", "/api/clusters/local/groups/switcher", null).body());
                        break;
                    }
                }
            }
            final JsonNode d = detail;
            assertTrue(d != null && d.toString().contains("keep-a"), () -> String.valueOf(d));
            assertFalse(d.path("partitions").toString().contains("drop-b"), () -> "stale commits counted: " + d.path("partitions"));
        }
    }

    @Test
    @Order(47)
    void aRuleWithNoChannelsKeepsNone() throws Exception {
        signIn();
        HttpResponse<String> made = send("POST", "/api/alerts/rules", "{\"name\":\"quiet\",\"metric\":\"lag\",\"scope\":{\"kind\":\"any\"},\"threshold\":1000000,\"durationSec\":60,\"severity\":\"info\",\"channels\":[],\"enabled\":true}");
        assertTrue(made.statusCode() < 300, made::body);
        JsonNode rule = JSON.readTree(made.body());
        assertEquals(0, rule.path("channels").size(), made::body);
        boolean listed = false;
        for (JsonNode r : get("/api/alerts/rules")) if (r.path("name").asString().equals("quiet")) { listed = true; assertEquals(0, r.path("channels").size(), r::toString); }
        assertTrue(listed);
    }

    @Test
    @Order(46)
    void oddRequestsGetTheEnvelope() throws Exception {
        signIn();
        // a year that overflows epoch millis: 400, not 500
        HttpResponse<String> far = send("GET", "/api/clusters/local/topics/orders/messages?from=timestamp&timestamp=%2B999999999-12-31T23:59:59Z", null);
        assertEquals(400, far.statusCode(), far::body);
        assertTrue(far.body().contains("\"code\":\"BAD_REQUEST\""), far::body);
        // the firewall's refusal answers in the API envelope (the web client reads error.code)
        HttpResponse<String> pct = send("GET", "/api/clusters/local/groups/a%25b", null);
        assertEquals(400, pct.statusCode(), pct::body);
        assertTrue(pct.body().contains("\"code\":\"BAD_REQUEST\""), pct::body);
        // an oversized body is refused before it's read, even on the open sign-in endpoint
        HttpResponse<String> big = send("POST", "/api/auth/login", "{\"password\":\"" + "x".repeat(1_100_000) + "\"}");
        assertEquals(413, big.statusCode(), () -> big.statusCode() + " " + big.body().substring(0, Math.min(200, big.body().length())));
    }

    @Test
    @Order(45)
    void theLagStreamMatchesTheGroupsEndpointAndAnUnknownChannelIsAnError() throws Exception {
        signIn();
        var closed = new java.util.concurrent.CountDownLatch(1);
        List<String> got = java.util.Collections.synchronizedList(new ArrayList<>());
        var ws = openStream(http, "http://localhost:" + port, got, closed);
        ws.sendText("{\"op\":\"sub\",\"id\":\"bogus\",\"cluster\":\"local\",\"channel\":\"bogus\"}", true).get(5, TimeUnit.SECONDS);
        ws.sendText("{\"op\":\"sub\",\"id\":\"l\",\"cluster\":\"local\",\"channel\":\"lag\"}", true).get(5, TimeUnit.SECONDS);
        long until = System.currentTimeMillis() + 15_000;
        while (System.currentTimeMillis() < until && got.stream().noneMatch(x -> x.contains("\"id\":\"l\"") && x.contains("\"data\""))) Thread.sleep(200);
        assertTrue(got.stream().anyMatch(x -> x.contains("\"id\":\"bogus\"") && x.contains("Unknown channel")), () -> "no error for an unknown channel: " + got);
        String frame = got.stream().filter(x -> x.contains("\"id\":\"l\"") && x.contains("\"data\"")).reduce((a, b) -> b).orElseThrow();
        JsonNode streamed = JSON.readTree(frame).path("data");
        JsonNode rest = get("/api/clusters/local/groups");
        List<String> a = new ArrayList<>(), b = new ArrayList<>();
        streamed.forEach(g -> a.add(g.path("status").asString()));
        rest.forEach(g -> b.add(g.path("status").asString()));
        assertEquals(b, a, "the stream must list groups in the same (worst-first) order as GET /groups");
        for (JsonNode g : streamed) assertTrue(g.has("trend"), () -> "no trend in the stream: " + g);
        ws.abort();
    }

    @Test
    @Order(43)
    void everyNonGetRouteIsOnTheAllowlistNoneReachesKafkaWrites() {
        // rule 5: a new write route must be a deliberate change to this list, not a silent addition
        Set<String> allowed = Set.of(
                "POST /api/auth/login", "POST /api/auth/logout",
                "POST /api/clusters/{c}/messages/search", "POST /api/clusters/{c}/schemas/subjects/{s}/compatibility",
                "PUT /api/filters/{name}",
                "POST /api/alerts/rules", "PUT /api/alerts/rules/{id}", "DELETE /api/alerts/rules/{id}",
                "POST /api/alerts/events/{id}/mute", "POST /api/alerts/events/{id}/ack");
        Set<String> found = new java.util.TreeSet<>();
        mappings.getHandlerMethods().forEach((info, h) -> {
            var methods = info.getMethodsCondition().getMethods();
            for (String path : info.getPatternValues())
                for (var m : methods.isEmpty() ? Set.of(org.springframework.web.bind.annotation.RequestMethod.values()) : methods)
                    if (m != org.springframework.web.bind.annotation.RequestMethod.GET && m != org.springframework.web.bind.annotation.RequestMethod.HEAD && m != org.springframework.web.bind.annotation.RequestMethod.OPTIONS)
                        found.add(m + " " + path);
        });
        found.removeIf(r -> r.endsWith(" /error"));
        assertEquals(new java.util.TreeSet<>(allowed), found);
    }

    @Test
    @Order(44)
    void sensitiveConfigIsMaskedAndWritesNeedTheCsrfHeader() throws Exception {
        signIn();
        for (String path : List.of("/api/clusters/local/brokers/1/config", "/api/clusters/local/topics/orders/config"))
            for (JsonNode e : get(path))
                if (e.path("name").asString().matches("(?i).*(password|secret|token|jaas|credential).*") || e.path("isSensitive").asBoolean()) {
                    assertTrue(e.path("isSensitive").asBoolean(), () -> path + " " + e);
                    assertEquals("******", e.path("value").asString(), () -> path + " " + e);
                }
        // signed in, but no X-KI-CSRF header: a state change is refused
        HttpResponse<String> r = HttpClient.newBuilder().cookieHandler(cookies).build().send(
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/alerts/rules/nope")).DELETE().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(403, r.statusCode(), r::body);
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
        assertFalse(page.contains("ws:") || page.contains("wss:"), "WebSockets to any host: " + page);
    }

    @Test
    @Order(11)
    void servesTheWebAppAndRedirectsRoot() throws Exception {
        HttpResponse<String> root = HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/")).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(302, root.statusCode());
        assertEquals("/app/", URI.create(root.headers().firstValue("location").orElseThrow()).getPath());
    }

    @Test
    @Order(50)
    void incompleteBodiesAndLaterPagesGetA400NotA500() throws Exception {
        signIn();
        HttpResponse<String> noSchema = send("POST", "/api/clusters/local/schemas/subjects/orders-value/compatibility", "{\"schemaType\":\"AVRO\"}");
        assertEquals(400, noSchema.statusCode(), noSchema::body);
        HttpResponse<String> noKind = send("POST", "/api/alerts/rules", "{\"name\":\"x\",\"metric\":\"lag\",\"scope\":{},\"threshold\":1,\"durationSec\":60,\"severity\":\"info\",\"channels\":[],\"enabled\":true}");
        assertEquals(400, noKind.statusCode(), noKind::body);
        HttpResponse<String> far = send("GET", "/api/clusters/local/topics/orders/messages?from=timestamp&timestamp=%2B999999999-12-31T23:59:59Z&cursor=0:1", null);
        assertTrue(far.statusCode() < 500, () -> far.statusCode() + " " + far.body());
    }

    @Test
    @Order(51)
    void aPartitionAddedDuringATailIsReadFromItsStart() throws Exception {
        signIn();
        try (Admin admin = Admin.create(Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            admin.createTopics(List.of(new NewTopic("grow", 1, (short) 1))).all().get(30, TimeUnit.SECONDS);
            List<String> got = java.util.Collections.synchronizedList(new ArrayList<>());
            var ws = openStream(http, "http://localhost:" + port, got, new java.util.concurrent.CountDownLatch(1));
            ws.sendText("{\"op\":\"tail\",\"id\":\"g\",\"cluster\":\"local\",\"topic\":\"grow\",\"partition\":\"all\",\"maxRate\":50}", true).get(5, TimeUnit.SECONDS);
            Thread.sleep(2000);
            admin.createPartitions(Map.of("grow", org.apache.kafka.clients.admin.NewPartitions.increaseTo(2))).all().get(30, TimeUnit.SECONDS);
            try (KafkaProducer<String, String> p = new KafkaProducer<>(Map.of("bootstrap.servers", KAFKA.getBootstrapServers(), "key.serializer", StringSerializer.class.getName(), "value.serializer", StringSerializer.class.getName()))) {
                p.send(new ProducerRecord<>("grow", 1, "k", "early-on-p1")).get(10, TimeUnit.SECONDS);
            }
            long end = System.currentTimeMillis() + 50_000;
            while (System.currentTimeMillis() < end && got.stream().noneMatch(x -> x.contains("\"channel\":\"tail\"") && x.contains("\"partition\":1"))) Thread.sleep(500);
            ws.abort();
            assertTrue(got.stream().anyMatch(x -> x.contains("\"channel\":\"tail\"") && x.contains("\"partition\":1")), () -> "the new partition's first record was skipped: " + got);
        }
    }

    @Test
    @Order(52)
    void controlCharactersBadVersionsAndPageCaching() throws Exception {
        signIn();
        HttpResponse<String> nul = send("PUT", "/api/filters/a%0Ab", "{\"expr\":\"value.x > 1\"}");
        assertEquals(400, nul.statusCode(), nul::body);
        HttpResponse<String> ctl = send("PUT", "/api/filters/ok", "{\"expr\":\"value.x\\u0000 > 1\"}");
        assertEquals(400, ctl.statusCode(), ctl::body);
        for (String v : List.of("-1", "abc", "0")) {
            HttpResponse<String> r = send("GET", "/api/clusters/local/schemas/subjects/orders-value/versions/" + v, null);
            assertEquals(400, r.statusCode(), () -> v + " → " + r.statusCode() + " " + r.body());
        }
        HttpResponse<String> page = HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/app/")).build(), HttpResponse.BodyHandlers.ofString());
        // no-store, not just no-cache: Back after sign-out must not restore a page that still shows cluster data
        assertTrue(page.headers().firstValue("cache-control").orElse("").contains("no-store"), () -> "index.html cache-control: " + page.headers().map());
    }

    @Test
    @Order(53)
    void signingOutClosesThatSessionsOpenStream() throws Exception {
        signIn();
        String cookie = cookies.getCookieStore().getCookies().stream().map(HttpCookie::toString).reduce((a, b) -> a + "; " + b).orElseThrow();
        var closed = new java.util.concurrent.CompletableFuture<String>();
        java.net.http.WebSocket ws = http.newWebSocketBuilder()
                .header("Cookie", cookie)
                .buildAsync(URI.create("ws://localhost:" + port + "/api/stream"), new java.net.http.WebSocket.Listener() {
                    @Override
                    public java.util.concurrent.CompletionStage<?> onClose(java.net.http.WebSocket w, int code, String reason) {
                        closed.complete(code + " " + reason);
                        return null;
                    }
                })
                .get(10, TimeUnit.SECONDS);
        assertFalse(closed.isDone(), "the stream should be open while signed in");
        assertEquals(204, send("POST", "/api/auth/logout", null).statusCode());
        // a stream that kept pushing cluster data after sign-out would outlive the session it was opened with
        // the web app branches on the code (1008: go to sign-in, no reconnect); the reason text may be Spring or ours
        assertTrue(closed.get(5, TimeUnit.SECONDS).startsWith("1008 "), () -> "closed with " + closed.getNow("nothing"));
        ws.abort();
    }

}
