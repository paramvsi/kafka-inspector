package dev.kafkainspector.agent;

import static org.junit.jupiter.api.Assertions.*;

import dev.kafkainspector.agent.lag.Lag;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Rule 9: the Java port must give the same verdicts as packages/core on the shared vectors. */
class LagVectorsTest {
    @TestFactory
    Stream<DynamicTest> sharedVectors() throws Exception {
        Path file = Path.of(System.getProperty("ki.lagVectors", "../../packages/core/test/lag-vectors.json"));
        JsonNode vectors = JsonMapper.builder().build().readTree(Files.readString(file));
        assertTrue(vectors.size() >= 20, "at least 20 vectors");
        List<DynamicTest> tests = new ArrayList<>();
        for (JsonNode v : vectors) {
            tests.add(DynamicTest.dynamicTest(v.path("name").asString(), () -> {
                List<Lag.Sample> samples = new ArrayList<>();
                for (JsonNode s : v.path("samples")) samples.add(new Lag.Sample(s.path("t").asLong(), s.path("committed").isNull() ? null : s.path("committed").asLong(), s.path("end").asLong()));
                Long lastCommitAt = v.path("lastCommitAt").isNull() ? null : v.path("lastCommitAt").asLong();
                assertEquals(v.path("expect").path("status").asString(), Lag.evaluate(samples, lastCommitAt, v.path("now").asLong(), v.path("windowMs").asLong()).name());
                Lag.Forecast f = Lag.forecast(samples);
                assertEquals(v.path("expect").path("forecast").path("kind").asString(), f.kind());
                JsonNode ef = v.path("expect").path("forecast");
                if (ef.has("seconds")) assertEquals(ef.path("seconds").asDouble(), f.seconds(), 1e-3);
                if (ef.has("consumeRate")) assertEquals(ef.path("consumeRate").asDouble(), f.consumeRate(), 1e-6);
                if (ef.has("produceRate")) assertEquals(ef.path("produceRate").asDouble(), f.produceRate(), 1e-6);
            }));
        }
        // group roll-up and combined forecast (lag-group-vectors.json, next to the partition vectors)
        JsonNode group = JsonMapper.builder().build().readTree(Files.readString(file.resolveSibling("lag-group-vectors.json")));
        for (JsonNode r : group.path("rollup")) {
            tests.add(DynamicTest.dynamicTest("rollup " + r.path("statuses"), () -> {
                List<Lag.Status> st = new ArrayList<>();
                for (JsonNode s : r.path("statuses")) st.add(Lag.Status.valueOf(s.asString()));
                assertEquals(r.path("expect").asString(), Lag.rollup(st).name());
            }));
        }
        for (JsonNode c : group.path("combine")) {
            tests.add(DynamicTest.dynamicTest("combine: " + c.path("name").asString(), () -> {
                List<Lag.Part> parts = new ArrayList<>();
                for (JsonNode p : c.path("parts")) parts.add(new Lag.Part(p.path("lag").asLong(), forecastOf(p.path("forecast"))));
                Lag.Forecast got = Lag.combine(parts), want = forecastOf(c.path("expect"));
                assertEquals(want.kind(), got.kind());
                assertEquals(want.seconds(), got.seconds());
                assertEquals(want.consumeRate(), got.consumeRate());
                assertEquals(want.produceRate(), got.produceRate());
            }));
        }
        return tests.stream();
    }

    private static Lag.Forecast forecastOf(JsonNode f) {
        return new Lag.Forecast(f.path("kind").asString(), num(f, "seconds"), num(f, "consumeRate"), num(f, "produceRate"));
    }

    private static Double num(JsonNode f, String k) {
        return f.has(k) ? f.path(k).asDouble() : null;
    }
}
