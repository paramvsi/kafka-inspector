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
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(SchemaRegistry.class);
    private final Clusters clusters;
    private final JsonMapper json;
    // one client per cluster: an HTTPS registry signed by a private CA trusts the cluster's truststore too
    private final java.util.Map<String, HttpClient> http = new java.util.concurrent.ConcurrentHashMap<>();

    private HttpClient client(String cid, KiProperties.Cluster c) {
        return http.computeIfAbsent(cid, k -> {
            HttpClient.Builder b = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5));
            if (c.sslTruststoreLocation() != null && !c.sslTruststoreLocation().isBlank()) b.sslContext(Clusters.trusting(c));
            return b.build();
        });
    }

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
            HttpResponse<String> r = client(cid, c).send(b.build(), HttpResponse.BodyHandlers.ofString());
            if (r.statusCode() == 404) throw new Clusters.NotFound("SCHEMA_NOT_FOUND", "The registry has no " + path + ".");
            if (r.statusCode() >= 400) {
                // the body can be a proxy page or a stack trace with internal names: log it, don't send it
                log.warn("Schema Registry for cluster {} answered {} to {} {}: {}", cid, r.statusCode(), method, path, r.body().length() > 500 ? r.body().substring(0, 500) + "…" : r.body());
                throw failure(r.statusCode());
            }
            try {
                return json.readTree(r.body());
            } catch (RuntimeException notJson) {
                log.warn("Schema Registry for cluster {} answered {} {} with something that isn't JSON (a proxy page?)", cid, method, path);
                throw new IllegalStateException("The Schema Registry answered something that isn't JSON. Check KI_CLUSTERS_n_SCHEMA_REGISTRY points at the registry itself, not a proxy page.");
            }
        } catch (java.io.IOException e) {
            // the URL may carry credentials (user:pass@): it goes to the log without them, never to the browser
            log.warn("Schema Registry for cluster {} unreachable at {}: {}", cid, c.schemaRegistry().replaceFirst("//[^/@]*@", "//"), e.toString());
            throw new IllegalStateException("Couldn't reach the Schema Registry for cluster " + cid + ". Check that it's running and KI_CLUSTERS_n_SCHEMA_REGISTRY is right; the agent log has the detail.");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted");
        }
    }

    private static String enc(String s) {
        // form encoding writes a space as "+", which a URL path reads as a literal plus
        return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20");
    }

    private final Map<String, Map.Entry<Long, Set<String>>> namesCache = new java.util.concurrent.ConcurrentHashMap<>();

    /** Subject names for linking topics to schemas, cached 30 s (failures too): a slow registry must not stall every topic page. */
    public Set<String> subjectNames(String cid) {
        var hit = namesCache.get(cid);
        if (hit != null && System.currentTimeMillis() - hit.getKey() < 30_000) return hit.getValue();
        Set<String> out = new TreeSet<>();
        try {
            call(cid, "GET", "/subjects", null).forEach(n -> out.add(n.asString()));
        } catch (RuntimeException e) {
            // no registry or unreachable: topics simply have no linked subject
        }
        namesCache.put(cid, Map.entry(System.currentTimeMillis(), java.util.Collections.unmodifiableSet(out)));
        return out;
    }

    private final Map<String, Map.Entry<Long, List<Dto.SubjectSummary>>> subjectCache = new java.util.concurrent.ConcurrentHashMap<>();

    /** Cached 30 s; per-subject calls run in parallel (≤ 16 at once), so 500 subjects isn't 1,500 sequential calls. */
    public List<Dto.SubjectSummary> subjects(String cid) {
        var hit = subjectCache.get(cid);
        if (hit != null && System.currentTimeMillis() - hit.getKey() < 30_000) return hit.getValue();
        List<Dto.SubjectSummary> fresh = loadSubjects(cid);
        subjectCache.put(cid, Map.entry(System.currentTimeMillis(), fresh));
        return fresh;
    }

    private List<Dto.SubjectSummary> loadSubjects(String cid) {
        String global = "BACKWARD";
        try {
            global = call(cid, "GET", "/config", null).path("compatibilityLevel").asString("BACKWARD");
        } catch (RuntimeException ignored) {
            // keep default
        }
        final String globalCompat = global;
        List<String> names = new ArrayList<>();
        call(cid, "GET", "/subjects", null).forEach(n -> names.add(n.asString()));
        java.util.concurrent.Semaphore slots = new java.util.concurrent.Semaphore(16);
        try (var pool = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            List<java.util.concurrent.Future<Dto.SubjectSummary>> futures = names.stream().map(s -> pool.submit(() -> {
                slots.acquire();
                try {
                    List<Integer> versions = new ArrayList<>();
                    call(cid, "GET", "/subjects/" + enc(s) + "/versions", null).forEach(v -> versions.add(v.asInt()));
                    JsonNode latest = call(cid, "GET", "/subjects/" + enc(s) + "/versions/latest", null);
                    String compat = globalCompat;
                    try {
                        compat = call(cid, "GET", "/config/" + enc(s) + "?defaultToGlobal=true", null).path("compatibilityLevel").asString(globalCompat);
                    } catch (RuntimeException ignored) {
                        // global applies
                    }
                    return new Dto.SubjectSummary(s, latest.path("version").asInt(), latest.path("schemaType").asString("AVRO"), compat, versions);
                } catch (dev.kafkainspector.agent.config.Clusters.NotFound gone) {
                    return null; // deleted while we listed: skip it, don't fail the list
                } finally {
                    slots.release();
                }
            })).toList();
            List<Dto.SubjectSummary> out = new ArrayList<>();
            for (var f : futures) {
                try {
                    Dto.SubjectSummary x = f.get();
                    if (x != null) out.add(x);
                } catch (java.util.concurrent.ExecutionException e) {
                    // the list fails now: stop the other fetches (closing the pool would wait for every slow one —
                    // minutes against a struggling registry with hundreds of subjects)
                    pool.shutdownNow();
                    throw e.getCause() instanceof RuntimeException r ? r : new IllegalStateException(e.getCause());
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("Interrupted while listing subjects.");
                }
            }
            return out;
        }
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
        if (schema == null || schema.isBlank()) throw new IllegalArgumentException("Send the candidate schema.");
        // a candidate is checked as the subject's own type (JSON, PROTOBUF), not assumed Avro
        if (type == null || type.isBlank()) type = get(cid, subject, "latest").type();
        String body = json.writeValueAsString(Map.of("schema", schema, "schemaType", type == null ? "AVRO" : type));
        JsonNode r = call(cid, "POST", "/compatibility/subjects/" + enc(subject) + "/versions/latest?verbose=true", body);
        List<String> msgs = new ArrayList<>();
        r.path("messages").forEach(m -> msgs.add(readable(m.asString())));
        return new Dto.CompatibilityResult(r.path("is_compatible").asBoolean(false), msgs);
    }

    private static final java.util.regex.Pattern VERBOSE =
            java.util.regex.Pattern.compile("^\\{.*?description:'(.*?)'(?:, additionalInfo:'(.*?)')?\\}$", java.util.regex.Pattern.DOTALL);

    /** A registry message as the user reads it: its description sentence (and detail), not the raw
     * `{errorType:'…', description:'…', additionalInfo:'…'}` record — the demo writes plain sentences too.
     * Anything else is passed through unchanged. */
    static String readable(String m) {
        if (m == null) return "";
        var x = VERBOSE.matcher(m.trim());
        if (!x.matches()) return m;
        String info = x.group(2);
        return x.group(1) + (info == null || info.isBlank() ? "." : " (" + info + ").");
    }

    /** A registry error the user can act on: a rejected schema is theirs to fix (400), anything else a retry (503). */
    static RuntimeException failure(int status) {
        if (status == 422)
            return new IllegalArgumentException("The Schema Registry rejected that schema as invalid. Check the schema text and its type (Avro, JSON or Protobuf).");
        return new IllegalStateException(status == 401 || status == 403
                ? "The Schema Registry refused the agent's credentials (" + status + "). Check the registry username and password in the agent config."
                : "The Schema Registry answered " + status + ". Try again; the agent log has the detail.");
    }
}
