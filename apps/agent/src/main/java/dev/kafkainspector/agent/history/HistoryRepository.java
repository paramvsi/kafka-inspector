package dev.kafkainspector.agent.history;

import dev.kafkainspector.agent.config.KiProperties;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Repository;

/**
 * Metric history (F-72). Queries average into time buckets so long ranges stay small. A job keeps the table bounded
 * (AGENT_API "History"): 1 sample per minute after 1 h, 1 per 10 min after 24 h, nothing older than KI_HISTORY_RETENTION;
 * resolved alert events go after 7 days. Approved by the owner on 2026-11-15 (docs/DECISIONS.md).
 */
@Repository
public class HistoryRepository {
    private static final Logger log = LoggerFactory.getLogger(HistoryRepository.class);
    private static final long HOUR = 3_600_000, DAY = 24 * HOUR;
    private final JdbcTemplate jdbc;
    private final KiProperties props;

    public HistoryRepository(JdbcTemplate jdbc, KiProperties props) {
        this.jdbc = jdbc;
        this.props = props;
    }

    @Scheduled(initialDelay = 60_000, fixedDelay = 600_000)
    public void pruneOnSchedule() {
        try {
            prune(System.currentTimeMillis());
        } catch (RuntimeException e) {
            log.warn("History pruning failed, will retry: {}", e.getMessage());
        }
    }

    /**
     * Returns rows removed: [expired, downsampled to 1/min, downsampled to 1/10 min, resolved alert events].
     * Downsampling keeps the sample landing in the first sample interval of each minute / 10 minutes.
     * ponytail: modulo on ts, not a per-bucket MIN(ts) — the sampler's fixed delay drifts, so the odd minute can end up
     * with no sample; queries bucket-average anyway. Use a MIN(ts) subquery if exact 1-per-bucket ever matters.
     */
    public int[] prune(long now) {
        long step = Math.max(1, props.sampleInterval().toMillis());
        int expired = jdbc.update("DELETE FROM metric_sample WHERE ts < ?", now - props.historyRetention().toMillis());
        int perMinute = step < 60_000 ? jdbc.update("DELETE FROM metric_sample WHERE ts < ? AND MOD(ts, 60000) >= ?", now - HOUR, step) : 0;
        int perTen = step < 600_000 ? jdbc.update("DELETE FROM metric_sample WHERE ts < ? AND MOD(ts, 600000) >= ?", now - DAY, step) : 0;
        // kept 7 days after it RESOLVED: an alert that fired 8 days ago and resolved just now stays in history
        int events = jdbc.update("DELETE FROM alert_event WHERE state = 'resolved' AND COALESCE(resolved_at, fired_at) < ?", now - 7 * DAY);
        if (expired + perMinute + perTen + events > 0) log.debug("History pruned: {} expired, {} + {} downsampled, {} alert events", expired, perMinute, perTen, events);
        return new int[] {expired, perMinute, perTen, events};
    }

    public record Row(String cluster, String scope, String key, String metric, long ts, double value) {}

    // one transaction: a sample spans several 500-row batches, and a failure part-way left half a tick in the charts
    @org.springframework.transaction.annotation.Transactional
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
        // span rounded to whole seconds: a pause between the caller's `from` and this `now` must not change the
        // bucket width, or the epoch-anchored buckets would regroup the samples and old points would jump
        long span = Math.round((now - from) / 1000.0) * 1000;
        long bucket = Math.max(1000, span / maxPoints);
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
