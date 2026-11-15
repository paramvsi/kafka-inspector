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
                if (v.path("expect").path("forecast").has("seconds")) assertEquals(v.path("expect").path("forecast").path("seconds").asDouble(), f.seconds(), 1e-3);
            }));
        }
        return tests.stream();
    }
}
