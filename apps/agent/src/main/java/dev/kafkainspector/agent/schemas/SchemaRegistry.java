package dev.kafkainspector.agent.schemas;

import dev.kafkainspector.agent.api.Dto;
import dev.kafkainspector.agent.config.Clusters;
import dev.kafkainspector.agent.config.KiProperties;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Read-only Schema Registry proxy with server-side credentials (AGENT_API "Schemas"). */
@Service
public class SchemaRegistry {
    private final Clusters clusters;
    private final JsonMapper json;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    public SchemaRegistry(Clusters clusters, JsonMapper json) {
        this.clusters = clusters;
        this.json = json;
    }

    private KiProperties.Cluster cluster(String cid) {
        KiProperties.Cluster c = clusters.get(cid);
        if (c.schemaRegistry() == null || c.schemaRegistry().isBlank()) throw new Clusters.NotFound("NO_SCHEMA_REGISTRY", "No Schema Registry is configured for " + c.name() + ". Set KI_CLUSTERS_n_SCHEMA_REGISTRY.");
        return c;
    }

    private JsonNode call(String cid, String method, String path, String body) {
        KiProperties.Cluster c = cluster(cid);
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(c.schemaRegistry().replaceAll("/$", "") + path)).timeout(Duration.ofSeconds(10)).header("Accept", "application/vnd.schemaregistry.v1+json, application/json");
        if (c.schemaRegistryUsername() != null && !c.schemaRegistryUsername().isBlank()) {
            String token = Base64.getEncoder().encodeToString((c.schemaRegistryUsername() + ":" + Objects.toString(c.schemaRegistryPassword(), "")).getBytes(StandardCharsets.UTF_8));
            b.header("Authorization", "Basic " + token);
        }
        b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        if (body != null) b.header("Content-Type", "application/vnd.schemaregistry.v1+json");
        try {
            HttpResponse<String> r = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
            if (r.statusCode() == 404) throw new Clusters.NotFound("SCHEMA_NOT_FOUND", "The registry has no " + path + ".");
            if (r.statusCode() >= 400) throw new IllegalStateException("Schema Registry answered " + r.statusCode() + ": " + r.body());
            return json.readTree(r.body());
        } catch (java.io.IOException e) {
            throw new IllegalStateException("Couldn't reach the Schema Registry at " + c.schemaRegistry() + ": " + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted");
        }
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }

    public Set<String> subjectNames(String cid) {
        Set<String> out = new TreeSet<>();
        try {
            call(cid, "GET", "/subjects", null).forEach(n -> out.add(n.asString()));
        } catch (RuntimeException e) {
            // no registry or unreachable: topics simply have no linked subject
        }
        return out;
    }

    public List<Dto.SubjectSummary> subjects(String cid) {
        String global = "BACKWARD";
        try {
            global = call(cid, "GET", "/config", null).path("compatibilityLevel").asString("BACKWARD");
        } catch (RuntimeException ignored) {
            // keep default
        }
        List<Dto.SubjectSummary> out = new ArrayList<>();
        for (JsonNode n : call(cid, "GET", "/subjects", null)) {
            String s = n.asString();
            List<Integer> versions = new ArrayList<>();
            call(cid, "GET", "/subjects/" + enc(s) + "/versions", null).forEach(v -> versions.add(v.asInt()));
            JsonNode latest = call(cid, "GET", "/subjects/" + enc(s) + "/versions/latest", null);
            String compat = global;
            try {
                compat = call(cid, "GET", "/config/" + enc(s) + "?defaultToGlobal=true", null).path("compatibilityLevel").asString(global);
            } catch (RuntimeException ignored) {
                // global applies
            }
            out.add(new Dto.SubjectSummary(s, latest.path("version").asInt(), latest.path("schemaType").asString("AVRO"), compat, versions));
        }
        return out;
    }

    private Dto.SchemaVersion version(JsonNode n, String subject) {
        return new Dto.SchemaVersion(n.path("subject").asString(subject), n.path("version").asInt(), n.path("id").asInt(), n.path("schemaType").asString("AVRO"), n.path("schema").asString(), n.has("references") ? n.get("references") : List.of());
    }

    public Dto.SchemaVersion get(String cid, String subject, String v) {
        return version(call(cid, "GET", "/subjects/" + enc(subject) + "/versions/" + enc(v), null), subject);
    }

    public Dto.SchemaVersion byId(String cid, int id) {
        JsonNode n = call(cid, "GET", "/schemas/ids/" + id, null);
        String subject = "";
        int ver = 0;
        try {
            JsonNode sv = call(cid, "GET", "/schemas/ids/" + id + "/versions", null);
            if (sv.size() > 0) {
                subject = sv.get(0).path("subject").asString();
                ver = sv.get(0).path("version").asInt();
            }
        } catch (RuntimeException ignored) {
            // older registries
        }
        return new Dto.SchemaVersion(subject, ver, id, n.path("schemaType").asString("AVRO"), n.path("schema").asString(), List.of());
    }

    public Dto.CompatibilityResult compatibility(String cid, String subject, String schema, String type) {
        String body = json.writeValueAsString(Map.of("schema", schema, "schemaType", type == null ? "AVRO" : type));
        JsonNode r = call(cid, "POST", "/compatibility/subjects/" + enc(subject) + "/versions/latest?verbose=true", body);
        List<String> msgs = new ArrayList<>();
        r.path("messages").forEach(m -> msgs.add(m.asString()));
        return new Dto.CompatibilityResult(r.path("is_compatible").asBoolean(false), msgs);
    }
}
