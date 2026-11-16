package dev.kafkainspector.agent.kafka;

import dev.kafkainspector.agent.api.Dto;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.function.Consumer;
import java.util.regex.Pattern;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.consumer.OffsetAndTimestamp;
import org.apache.kafka.common.PartitionInfo;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.header.Header;
import org.springframework.stereotype.Service;

/**
 * Browsing raw bytes (AGENT_API "Messages"). A dedicated consumer per request: no group.id, assign + seek,
 * auto-commit off — it never commits offsets. Bounded by limit (≤ 500) and a time budget.
 */
@Service
public class MessageService {
    private static final Duration BUDGET = Duration.ofSeconds(4);
    /** Bytes of keys + values + headers read for one page: large records end the page early (the cursor continues). */
    static final long PAGE_BYTES = 16L * 1024 * 1024;
    private static final Base64.Encoder B64 = Base64.getEncoder();
    private final KafkaService kafka;

    public MessageService(KafkaService kafka) {
        this.kafka = kafka;
    }

    public static Dto.RawMessage dto(ConsumerRecord<byte[], byte[]> r) {
        List<Dto.Header> headers = new ArrayList<>();
        int size = (r.key() == null ? 0 : r.key().length) + (r.value() == null ? 0 : r.value().length);
        for (Header h : r.headers()) {
            headers.add(new Dto.Header(h.key(), h.value() == null ? "" : B64.encodeToString(h.value())));
            size += h.key().getBytes(StandardCharsets.UTF_8).length + (h.value() == null ? 0 : h.value().length);
        }
        return new Dto.RawMessage(r.topic(), r.partition(), r.offset(), Instant.ofEpochMilli(r.timestamp()).toString(), r.key() == null ? null : B64.encodeToString(r.key()), r.value() == null ? null : B64.encodeToString(r.value()), headers, size);
    }

    /** from: newest | oldest | offset | timestamp | group. Cursor = "p:o,p:o" next offsets. */
    public Dto.RawMessagePage browse(String cid, String topic, String partition, String from, Long offset, String timestamp, Map<Integer, Long> groupOffsets, int limit, String cursor) {
        int max = Math.max(1, Math.min(limit, 500));
        if (cursor != null && cursor.isBlank()) cursor = null; // "cursor=" is the first page, as the controller treats it
        try (KafkaConsumer<byte[], byte[]> c = kafka.consumer(cid, max)) {
            List<PartitionInfo> infos = c.partitionsFor(topic, Duration.ofSeconds(10));
            if (infos == null || infos.isEmpty()) throw new dev.kafkainspector.agent.config.Clusters.NotFound("TOPIC_NOT_FOUND", "Topic " + topic + " not found.");
            List<TopicPartition> tps = infos.stream().map(i -> new TopicPartition(topic, i.partition())).filter(tp -> "all".equals(partition) || String.valueOf(tp.partition()).equals(partition)).sorted(Comparator.comparingInt(TopicPartition::partition)).toList();
            if (tps.isEmpty()) throw new dev.kafkainspector.agent.config.Clusters.NotFound("PARTITION_NOT_FOUND", "Topic " + topic + " has partitions 0–" + (infos.size() - 1) + "; there is no partition " + partition + ".");
            Map<TopicPartition, Long> begin = c.beginningOffsets(tps, Duration.ofSeconds(10));
            Map<TopicPartition, Long> end = c.endOffsets(tps, Duration.ofSeconds(10));
            Map<Integer, Long> cur = parseCursor(cursor);
            if (!cur.keySet().stream().allMatch(p -> tps.stream().anyMatch(tp -> tp.partition() == p)))
                throw new IllegalArgumentException("The cursor isn't valid for this topic and partition. Start again without it.");
            boolean desc = "newest".equals(from);
            // newest: up to `max` from every partition, then the newest `max` overall (a quiet partition must not fill
            // the page with old records while the hot one's newest wait for Load more); the cursor keeps the rest
            int per = max;
            Map<TopicPartition, long[]> ranges = new HashMap<>(); // [start, stopExclusive]
            Map<TopicPartition, OffsetAndTimestamp> byTime = "timestamp".equals(from) && timestamp != null ? c.offsetsForTimes(tpsMap(tps, Instant.parse(timestamp).toEpochMilli()), Duration.ofSeconds(10)) : Map.of();
            for (TopicPartition tp : tps) {
                long lo = begin.get(tp), hi = end.get(tp);
                long start;
                if (cursor != null && !cur.containsKey(tp.partition())) continue; // finished on an earlier page
                if (cur.containsKey(tp.partition())) start = cur.get(tp.partition());
                else start = switch (from) {
                    case "newest" -> hi - 1;
                    case "oldest" -> lo;
                    case "offset" -> Math.max(lo, Math.min(hi, offset == null ? lo : offset));
                    case "timestamp" -> byTime.get(tp) == null ? hi : byTime.get(tp).offset();
                    case "group" -> groupOffsets.getOrDefault(tp.partition(), hi);
                    default -> hi - 1;
                };
                // inside the log: a committed offset or cursor below the log start (retention) or past the end must
                // not seek out of range (auto.offset.reset=none would throw)
                start = desc ? Math.min(hi - 1, start) : Math.max(lo, Math.min(hi, start));
                long a = desc ? Math.max(lo, start - per + 1) : start;
                long b = desc ? start + 1 : Math.min(hi, start + max);
                if (b > a) ranges.put(tp, new long[] {a, b});
            }
            // assign only partitions with something to read: an assigned partition without a position would throw
            c.assign(ranges.keySet());
            ranges.forEach((tp, rg) -> c.seek(tp, rg[0]));
            List<ConsumerRecord<byte[], byte[]>> got = new ArrayList<>();
            long deadline = System.nanoTime() + BUDGET.toNanos();
            Set<TopicPartition> done = new HashSet<>(tps);
            done.removeAll(ranges.keySet());
            int scanned = 0;
            long bytes = 0;
            while (done.size() < tps.size() && System.nanoTime() < deadline) {
                if (bytes >= PAGE_BYTES) {
                    // oldest-first: stop, the cursor continues after the last record kept. Newest-first reads each
                    // range upward, so a cut-off range is missing its newest records and would be retried forever:
                    // halve each unfinished range towards its newest end, drop what was read of it, read again.
                    if (!desc) break;
                    boolean shrunk = false;
                    for (var e : ranges.entrySet()) {
                        TopicPartition tp = e.getKey();
                        long[] rg = e.getValue();
                        if (done.contains(tp) || rg[1] - rg[0] <= 1) continue;
                        rg[0] = rg[1] - Math.max(1, (rg[1] - rg[0]) / 2);
                        got.removeIf(r -> r.partition() == tp.partition());
                        c.seek(tp, rg[0]);
                        shrunk = true;
                    }
                    if (!shrunk) break;
                    bytes = got.stream().mapToLong(r -> Math.max(0, r.serializedKeySize()) + Math.max(0, r.serializedValueSize())).sum();
                }
                for (ConsumerRecord<byte[], byte[]> r : c.poll(Duration.ofMillis(200))) {
                    TopicPartition tp = new TopicPartition(r.topic(), r.partition());
                    long[] rg = ranges.get(tp);
                    scanned++;
                    if (rg != null && r.offset() < rg[1]) {
                        got.add(r);
                        bytes += Math.max(0, r.serializedKeySize()) + Math.max(0, r.serializedValueSize());
                    }
                    if (rg == null || r.offset() >= rg[1] - 1) {
                        done.add(tp);
                        c.pause(List.of(tp));
                    }
                }
                // past the range without a record at its last offset: compaction gaps or a transaction marker
                for (var e : ranges.entrySet())
                    if (!done.contains(e.getKey()) && c.position(e.getKey()) >= e.getValue()[1]) {
                        done.add(e.getKey());
                        c.pause(List.of(e.getKey()));
                    }
            }
            got.sort(desc ? Comparator.comparingLong((ConsumerRecord<byte[], byte[]> r) -> r.timestamp()).thenComparingLong(ConsumerRecord::offset).reversed() : Comparator.comparingLong((ConsumerRecord<byte[], byte[]> r) -> r.timestamp()).thenComparingLong(ConsumerRecord::offset));
            List<ConsumerRecord<byte[], byte[]>> cut = got.subList(0, Math.min(max, got.size()));
            Set<ConsumerRecord<byte[], byte[]>> inCut = Collections.newSetFromMap(new IdentityHashMap<>());
            inCut.addAll(cut);
            // Per partition, keep only the unbroken run from where reading started (asc: from a upward; desc: from
            // b-1 downward) and point the cursor at the first record not kept. The timestamp sort can cut records out
            // of offset order, and a range the 4 s budget didn't finish must not be skipped — so nothing is lost or
            // shown twice.
            Set<ConsumerRecord<byte[], byte[]>> keep = Collections.newSetFromMap(new IdentityHashMap<>());
            Map<Integer, Long> next = new TreeMap<>();
            for (var e : ranges.entrySet()) {
                TopicPartition tp = e.getKey();
                long a = e.getValue()[0], b = e.getValue()[1];
                boolean finished = done.contains(tp);
                List<ConsumerRecord<byte[], byte[]>> recs = got.stream().filter(r -> r.partition() == tp.partition())
                        .sorted(desc ? Comparator.comparingLong(ConsumerRecord<byte[], byte[]>::offset).reversed() : Comparator.comparingLong(ConsumerRecord<byte[], byte[]>::offset)).toList();
                int k = 0;
                // desc reads upward from a: an unfinished range is missing its newest records, so keep none of it
                if (!(desc && !finished)) while (k < recs.size() && inCut.contains(recs.get(k))) keep.add(recs.get(k++));
                long n;
                if (desc && !finished) n = b - 1; // try the whole range again
                else if (k < recs.size()) n = recs.get(k).offset(); // first record not shown: start there next time
                else if (!finished) n = desc ? b - 1 : (k == 0 ? a : recs.get(k - 1).offset() + 1);
                else n = desc ? a - 1 : b; // range fully read (gaps/markers included): move past it
                if (desc ? n >= begin.get(tp) : n < end.get(tp)) next.put(tp.partition(), n);
            }
            List<ConsumerRecord<byte[], byte[]>> page = cut.stream().filter(keep::contains).toList();
            if (page.isEmpty() && !got.isEmpty()) {
                // the timestamp cut left every partition's run empty (e.g. future-dated heads): show one record in
                // offset order so the cursor always moves and Load more can't repeat an empty page forever
                for (var e : ranges.entrySet()) {
                    TopicPartition tp = e.getKey();
                    if (desc && !done.contains(tp)) continue;
                    List<ConsumerRecord<byte[], byte[]>> recs = got.stream().filter(r -> r.partition() == tp.partition())
                            .sorted(desc ? Comparator.comparingLong(ConsumerRecord<byte[], byte[]>::offset).reversed() : Comparator.comparingLong(ConsumerRecord<byte[], byte[]>::offset)).toList();
                    if (recs.isEmpty()) continue;
                    ConsumerRecord<byte[], byte[]> r0 = recs.get(0);
                    page = List.of(r0);
                    long n = recs.size() > 1 ? recs.get(1).offset() : desc ? r0.offset() - 1 : r0.offset() + 1;
                    if (desc ? n >= begin.get(tp) : n < end.get(tp)) next.put(tp.partition(), n);
                    else next.remove(tp.partition());
                    break;
                }
            }
            String nextCursor = next.isEmpty() ? null : cursorOf(next);
            return new Dto.RawMessagePage(page.stream().map(MessageService::dto).toList(), nextCursor, Math.max(scanned, page.size()));
        }
    }

    public Dto.RawMessagePage search(String cid, String topicRegex, String from, int limit, boolean sample, Map<String, ClusterState.TopicSnap> topics) {
        Pattern p = dev.kafkainspector.agent.api.SafeRegex.compile(topicRegex, 0);
        List<String> matched = topics.keySet().stream().filter(t -> !t.startsWith("_") && dev.kafkainspector.agent.api.SafeRegex.find(p, t, 50)).limit(20).toList();
        int max = Math.max(1, Math.min(limit, 500));
        List<Dto.RawMessage> out = new ArrayList<>();
        int scanned = 0;
        // ponytail: sequential browses, bounded by a 10 s budget (partial results); parallelise if search gets slow
        long deadline = System.currentTimeMillis() + 10_000;
        for (String t : matched) {
            if (System.currentTimeMillis() > deadline) break;
            try {
                // sample spreads reads across every partition; otherwise the busiest partition (same as the simulator, F-43)
                ClusterState.TopicSnap snap = topics.get(t);
                String part = sample || snap == null || snap.partitions.isEmpty() ? "all"
                        : String.valueOf(snap.partitions.stream().max(Comparator.comparingDouble((ClusterState.PartSnap x) -> x.rate).thenComparingLong(x -> x.high)).get().partition);
                Dto.RawMessagePage page = browse(cid, t, part, "oldest".equals(from) ? "oldest" : "newest", null, null, Map.of(), Math.max(1, (int) Math.ceil((double) max / matched.size())), null); // ceil, as the simulator: 3 topics × 34 → the full 100 after the cut
                out.addAll(page.messages());
                scanned += page.scanned();
            } catch (dev.kafkainspector.agent.config.Clusters.NotFound e) {
                // deleted since it matched: the other topics' results still count
            }
        }
        // by time (not the ISO string: "…:00Z" sorts after "…:00.500Z"), then a stable tie-break
        out.sort(Comparator.comparing((Dto.RawMessage r) -> Instant.parse(r.timestamp())).reversed()
                .thenComparing(Dto.RawMessage::topic).thenComparingInt(Dto.RawMessage::partition).thenComparingLong(Dto.RawMessage::offset));
        return new Dto.RawMessagePage(out.subList(0, Math.min(max, out.size())), null, scanned);
    }

    /** Live tail: polls from the end on a virtual thread, samples to maxRate per second; errors go to onError. */
    public Runnable tail(String cid, String topic, String partition, int maxRate, Consumer<List<Dto.RawMessage>> onBatch, Consumer<String> onError) {
        Thread t = Thread.ofVirtual().name("tail-" + topic).start(() -> {
            try (KafkaConsumer<byte[], byte[]> c = kafka.consumer(cid, 2000)) {
                List<TopicPartition> tps = new ArrayList<>(partitionsOf(c, topic, partition));
                if (tps.isEmpty()) {
                    onError.accept("Topic " + topic + ("all".equals(partition) ? "" : " partition " + partition) + " doesn't exist.");
                    return;
                }
                c.assign(tps);
                c.seekToEnd(tps);
                tps.forEach(c::position);
                List<ConsumerRecord<byte[], byte[]>> buf = new ArrayList<>();
                long next = System.currentTimeMillis() + 1000;
                long recheck = System.currentTimeMillis() + 30_000;
                while (!Thread.currentThread().isInterrupted()) {
                    // partitions added while tailing join from their end
                    if (System.currentTimeMillis() >= recheck) {
                        recheck += 30_000;
                        List<TopicPartition> now;
                        try {
                            now = partitionsOf(c, topic, partition);
                        } catch (org.apache.kafka.common.errors.RetriableException e) {
                            now = tps; // broker restarting: poll copes, check again next time
                        }
                        if (now.isEmpty()) { // with assign() a deleted topic doesn't make poll fail: say so
                            onError.accept("Topic " + topic + " was deleted. The live tail stopped.");
                            return;
                        }
                        List<TopicPartition> added = now.stream().filter(tp -> !tps.contains(tp)).toList();
                        if (!added.isEmpty()) {
                            tps.addAll(added);
                            c.assign(tps);
                            c.seekToEnd(added);
                            added.forEach(c::position);
                        }
                    }
                    c.poll(Duration.ofMillis(250)).forEach(buf::add);
                    if (System.currentTimeMillis() >= next) {
                        if (!buf.isEmpty()) {
                            double keep = Math.min(1.0, (double) maxRate / buf.size());
                            List<Dto.RawMessage> batch = new ArrayList<>();
                            double acc = 0;
                            for (ConsumerRecord<byte[], byte[]> r : buf) {
                                acc += keep;
                                if (acc >= 1) {
                                    acc -= 1;
                                    batch.add(dto(r));
                                }
                            }
                            onBatch.accept(batch);
                            buf.clear();
                        }
                        next += 1000;
                    }
                }
            } catch (org.apache.kafka.common.errors.InterruptException e) {
                // stopped
            } catch (org.apache.kafka.clients.consumer.OffsetOutOfRangeException e) {
                // the offsets being read are gone: the topic was deleted and re-created, or retention removed them
                onError.accept("Topic " + topic + " was deleted and re-created, or retention removed the messages being read. The live tail stopped; start it again.");
            } catch (RuntimeException e) {
                Throwable r = e;
                while (r.getCause() != null) r = r.getCause();
                onError.accept("Live tail stopped: " + r.getMessage());
            }
        });
        return t::interrupt;
    }

    private static List<TopicPartition> partitionsOf(KafkaConsumer<byte[], byte[]> c, String topic, String partition) {
        List<PartitionInfo> infos = c.partitionsFor(topic, Duration.ofSeconds(10));
        if (infos == null) return List.of();
        return infos.stream().map(i -> new TopicPartition(topic, i.partition())).filter(tp -> "all".equals(partition) || String.valueOf(tp.partition()).equals(partition)).toList();
    }

    private static Map<TopicPartition, Long> tpsMap(List<TopicPartition> tps, long ts) {
        Map<TopicPartition, Long> m = new HashMap<>();
        tps.forEach(tp -> m.put(tp, ts));
        return m;
    }

    static Map<Integer, Long> parseCursor(String cursor) {
        Map<Integer, Long> m = new HashMap<>();
        if (cursor == null || cursor.isBlank()) return m;
        for (String part : cursor.split(",")) {
            String[] kv = part.split(":");
            try {
                if (kv.length != 2) throw new NumberFormatException();
                m.put(Integer.parseInt(kv[0].trim()), Long.parseLong(kv[1].trim()));
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException("The cursor isn't valid. Start again without it.");
            }
        }
        return m;
    }

    static String cursorOf(Map<Integer, Long> next) {
        StringJoiner j = new StringJoiner(",");
        next.forEach((p, o) -> j.add(p + ":" + o));
        return j.toString();
    }
}
