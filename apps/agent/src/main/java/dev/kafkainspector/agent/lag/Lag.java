package dev.kafkainspector.agent.lag;

import java.util.ArrayList;
import java.util.List;

/**
 * Lag status and catch-up forecast — a line-for-line port of packages/core/src/lag.ts (rule 9).
 * The JUnit test runs packages/core/test/lag-vectors.json through this class.
 */
public final class Lag {
    private Lag() {}

    public enum Status { healthy, warn, stalled, stopped, unknown }

    /** committed may be null (no committed offset). t in epoch ms. */
    public record Sample(long t, Long committed, long end) {}

    public record Forecast(String kind, Double seconds, Double consumeRate, Double produceRate) {
        public static Forecast of(String kind) {
            return new Forecast(kind, null, null, null);
        }
    }

    private static Long lagOf(Sample s) {
        return s.committed() == null ? null : Math.max(0, s.end() - s.committed());
    }

    private static double slope(List<double[]> pts) {
        int n = pts.size();
        if (n < 2) return 0;
        double sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (double[] p : pts) {
            sx += p[0]; sy += p[1]; sxx += p[0] * p[0]; sxy += p[0] * p[1];
        }
        double d = n * sxx - sx * sx;
        return d == 0 ? 0 : (n * sxy - sx * sy) / d;
    }

    public static Status evaluate(List<Sample> samples, Long lastCommitAt, long now, long windowMs) {
        List<Sample> known = samples.stream().filter(s -> s.committed() != null).toList();
        if (known.isEmpty()) return Status.unknown;
        Sample first = known.get(0), last = known.get(known.size() - 1);
        List<Long> lags = known.stream().map(Lag::lagOf).toList();
        long firstLag = lags.get(0), lastLag = lags.get(lags.size() - 1);
        double commitAge = lastCommitAt == null ? Double.POSITIVE_INFINITY : now - lastCommitAt;

        if (commitAge > windowMs && lastLag > 0) return Status.stopped;
        boolean frozen = known.size() > 1 && known.stream().allMatch(s -> s.committed().equals(first.committed()));
        if (frozen && lastLag > 0 && commitAge <= windowMs) return Status.stalled;
        if (lags.stream().anyMatch(l -> l == 0) || lastLag < firstLag) return Status.healthy;

        boolean advanced = last.committed() > first.committed();
        boolean strictly = lags.size() > 1;
        for (int i = 1; i < lags.size(); i++) if (lags.get(i) <= lags.get(i - 1)) strictly = false;
        List<double[]> pts = new ArrayList<>();
        for (int i = 0; i < known.size(); i++) pts.add(new double[] {known.get(i).t() - first.t(), lags.get(i)});
        boolean netUp = lastLag > firstLag && slope(pts) > 0;
        if (advanced && (strictly || netUp)) return Status.warn;
        return Status.healthy;
    }

    /** A group event is raised when a group turns stalled or stopped — not when it moves between the two (recovery). Same as lag.ts. */
    public static boolean becameStuck(Status prev, Status next) {
        return prev != null && stuck(next) && !stuck(prev);
    }

    private static boolean stuck(Status s) {
        return s == Status.stalled || s == Status.stopped;
    }

    public static Status rollup(List<Status> statuses) {
        for (Status s : List.of(Status.stopped, Status.stalled, Status.warn, Status.healthy)) if (statuses.contains(s)) return s;
        return Status.unknown;
    }

    public static Forecast forecast(List<Sample> samples) {
        List<Sample> known = samples.stream().filter(s -> s.committed() != null).toList();
        if (known.isEmpty()) return Forecast.of("unknown");
        Sample first = known.get(0), last = known.get(known.size() - 1);
        long lag = lagOf(last);
        double dt = (last.t() - first.t()) / 1000.0;
        // rates kept for caught-up partitions too (same as lag.ts), so group totals include every partition
        if (lag == 0) return dt > 0 ? new Forecast("caught-up", null, Math.max(0, last.committed() - first.committed()) / dt, Math.max(0, last.end() - first.end()) / dt) : Forecast.of("caught-up");
        if (dt <= 0) return Forecast.of("unknown");
        double consume = Math.max(0, last.committed() - first.committed()) / dt;
        double produce = Math.max(0, last.end() - first.end()) / dt;
        if (consume > produce) return new Forecast("eta", lag / (consume - produce), consume, produce);
        return new Forecast("never", null, consume, produce);
    }

    public record Part(long lag, Forecast forecast) {}

    public static Forecast combine(List<Part> parts) {
        List<Part> known = parts.stream().filter(p -> !p.forecast().kind().equals("unknown")).toList();
        if (known.isEmpty()) return Forecast.of("unknown");
        long lag = known.stream().mapToLong(Part::lag).sum();
        double c = known.stream().mapToDouble(p -> p.forecast().consumeRate() == null ? 0 : p.forecast().consumeRate()).sum();
        double pr = known.stream().mapToDouble(p -> p.forecast().produceRate() == null ? 0 : p.forecast().produceRate()).sum();
        // a partition with no forecast that is still behind: the group can't be called caught up (same as lag.ts)
        boolean behindUnknown = parts.stream().anyMatch(p -> p.forecast().kind().equals("unknown") && p.lag() > 0);
        if (lag == 0) return behindUnknown ? Forecast.of("unknown") : new Forecast("caught-up", null, c, pr);
        if (known.stream().anyMatch(p -> p.forecast().kind().equals("never") && p.lag() > 0)) return new Forecast("never", null, c, pr);
        double seconds = known.stream().mapToDouble(p -> p.forecast().seconds() == null ? 0 : p.forecast().seconds()).max().orElse(0);
        return new Forecast("eta", seconds, c, pr);
    }
}
