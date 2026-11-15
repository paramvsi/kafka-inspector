package dev.kafkainspector.agent.history;

import java.util.ArrayList;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Metric history (F-72). Queries average into time buckets so long ranges stay small.
 * Retention/downsampling is DECISION-PENDING (docs/DECISIONS.md): until approved, samples are kept.
 */
@Repository
public class HistoryRepository {
    private final JdbcTemplate jdbc;

    public HistoryRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record Row(String cluster, String scope, String key, String metric, long ts, double value) {}

    public void insert(List<Row> rows) {
        jdbc.batchUpdate("INSERT INTO metric_sample (cluster, scope, skey, metric, ts, val) VALUES (?, ?, ?, ?, ?, ?)", rows, 500, (ps, r) -> {
            ps.setString(1, r.cluster());
            ps.setString(2, r.scope());
            ps.setString(3, r.key());
            ps.setString(4, r.metric());
            ps.setLong(5, r.ts());
            ps.setDouble(6, r.value());
        });
    }

    /** Points [epochMillis, value] from `from` to now, averaged into at most maxPoints buckets. */
    public List<double[]> series(String cluster, String scope, String key, String metric, long from, int maxPoints) {
        long now = System.currentTimeMillis();
        long bucket = Math.max(1000, (now - from) / maxPoints);
        List<double[]> out = new ArrayList<>();
        // bucket computed once in a subquery: portable across H2 and PostgreSQL
        jdbc.query(
                "SELECT bk, AVG(val) AS v, MAX(ts) AS t FROM (SELECT ts / ? AS bk, ts, val FROM metric_sample WHERE cluster = ? AND scope = ? AND skey = ? AND metric = ? AND ts >= ?) x GROUP BY bk ORDER BY bk",
                rs -> {
                    out.add(new double[] {rs.getLong("t"), rs.getDouble("v")});
                },
                bucket, cluster, scope, key == null ? "" : key, metric, from);
        return out;
    }
}
