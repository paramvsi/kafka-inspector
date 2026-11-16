package dev.kafkainspector.agent.history;

import dev.kafkainspector.agent.kafka.ClusterState;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/** The 1 h sparkline series (24 points), cached 30 s: shared by REST and the live stream so both send the same data. */
@Component
public class Trends {
    private final HistoryRepository history;
    private final Map<String, List<Double>[]> cache = new ConcurrentHashMap<>();

    public Trends(HistoryRepository history) {
        this.history = history;
    }

    @SuppressWarnings("unchecked")
    public List<Double> of(String cid, String scope, String key, String metric) {
        String k = cid + "|" + scope + "|" + key + "|" + metric;
        long now = System.currentTimeMillis();
        List<Double>[] hit = cache.get(k);
        if (hit != null && hit[1] != null && !hit[1].isEmpty() && now - hit[1].get(0).longValue() < 30_000) return hit[0];
        List<Double> pts = history.series(cid, scope, key, metric, now - 3_600_000L, 24).stream().map(p -> p[1]).toList();
        cache.put(k, new List[] {pts, List.of((double) now)});
        return pts;
    }

    public Map<String, List<Double>> groups(String cid, ClusterState s) {
        Map<String, List<Double>> out = new HashMap<>();
        s.groups.keySet().forEach(g -> out.put(g, of(cid, "group", g, "lag")));
        return out;
    }
}
