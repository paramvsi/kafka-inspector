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
    public Dto.RawMessagePage browse(String cid, String topic, String partition, String from, Long offset, String timestamp, Long groupOffsetsFor, Map<Integer, Long> groupOffsets, int limit, String cursor) {
        int max = Math.max(1, Math.min(limit, 500));
        try (KafkaConsumer<byte[], byte[]> c = kafka.consumer(cid, max)) {
            List<PartitionInfo> infos = c.partitionsFor(topic, Duration.ofSeconds(10));
            if (infos == null || infos.isEmpty()) throw new dev.kafkainspector.agent.config.Clusters.NotFound("TOPIC_NOT_FOUND", "Topic " + topic + " not found.");
            List<TopicPartition> tps = infos.stream().map(i -> new TopicPartition(topic, i.partition())).filter(tp -> "all".equals(partition) || String.valueOf(tp.partition()).equals(partition)).sorted(Comparator.comparingInt(TopicPartition::partition)).toList();
            Map<TopicPartition, Long> begin = c.beginningOffsets(tps, Duration.ofSeconds(10));
            Map<TopicPartition, Long> end = c.endOffsets(tps, Duration.ofSeconds(10));
            Map<Integer, Long> cur = parseCursor(cursor);
            boolean desc = "newest".equals(from);
            int per = desc ? Math.max(1, (int) Math.ceil((double) max / tps.size())) : max;
            Map<TopicPartition, long[]> ranges = new HashMap<>(); // [start, stopExclusive]
            Map<TopicPartition, OffsetAndTimestamp> byTime = "timestamp".equals(from) && timestamp != null ? c.offsetsForTimes(tpsMap(tps, Instant.parse(timestamp).toEpochMilli()), Duration.ofSeconds(10)) : Map.of();
            for (TopicPartition tp : tps) {
                long lo = begin.get(tp), hi = end.get(tp);
                long start;
                if (cur.containsKey(tp.partition())) start = cur.get(tp.partition());
                else start = switch (from) {
                    case "newest" -> hi - 1;
                    case "oldest" -> lo;
                    case "offset" -> Math.max(lo, Math.min(hi, offset == null ? lo : offset));
                    case "timestamp" -> byTime.get(tp) == null ? hi : byTime.get(tp).offset();
                    case "group" -> groupOffsets.getOrDefault(tp.partition(), hi);
                    default -> hi - 1;
                };
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
            while (done.size() < tps.size() && System.nanoTime() < deadline) {
                for (ConsumerRecord<byte[], byte[]> r : c.poll(Duration.ofMillis(200))) {
                    TopicPartition tp = new TopicPartition(r.topic(), r.partition());
                    long[] rg = ranges.get(tp);
                    scanned++;
                    if (rg != null && r.offset() < rg[1]) got.add(r);
                    if (rg == null || r.offset() >= rg[1] - 1) {
                        done.add(tp);
                        c.pause(List.of(tp));
                    }
                }
            }
            got.sort(desc ? Comparator.comparingLong((ConsumerRecord<byte[], byte[]> r) -> r.timestamp()).thenComparingLong(ConsumerRecord::offset).reversed() : Comparator.comparingLong((ConsumerRecord<byte[], byte[]> r) -> r.timestamp()).thenComparingLong(ConsumerRecord::offset));
            List<ConsumerRecord<byte[], byte[]>> page = got.subList(0, Math.min(max, got.size()));
            Map<Integer, Long> next = new TreeMap<>();
            for (TopicPartition tp : tps) {
                OptionalLong o = desc ? page.stream().filter(r -> r.partition() == tp.partition()).mapToLong(ConsumerRecord::offset).min() : page.stream().filter(r -> r.partition() == tp.partition()).mapToLong(ConsumerRecord::offset).max();
                if (o.isPresent()) next.put(tp.partition(), desc ? o.getAsLong() - 1 : o.getAsLong() + 1);
            }
            String nextCursor = page.size() == max ? cursorOf(next) : null;
            return new Dto.RawMessagePage(page.stream().map(MessageService::dto).toList(), nextCursor, Math.max(scanned, page.size()));
        }
    }

    public Dto.RawMessagePage search(String cid, String topicRegex, String from, int limit, boolean sample, Collection<String> topics) {
        Pattern p = dev.kafkainspector.agent.api.SafeRegex.compile(topicRegex, 0);
        List<String> matched = topics.stream().filter(t -> !t.startsWith("_") && dev.kafkainspector.agent.api.SafeRegex.find(p, t, 50)).limit(20).toList();
        int max = Math.max(1, Math.min(limit, 500));
        List<Dto.RawMessage> out = new ArrayList<>();
        int scanned = 0;
        // ponytail: sequential browses, bounded by a 10 s budget (partial results); parallelise if search gets slow
        long deadline = System.currentTimeMillis() + 10_000;
        for (String t : matched) {
            if (System.currentTimeMillis() > deadline) break;
            Dto.RawMessagePage page = browse(cid, t, "all", "oldest".equals(from) ? "oldest" : "newest", null, null, null, Map.of(), Math.max(1, max / matched.size()), null);
            out.addAll(page.messages());
            scanned += page.scanned();
        }
        out.sort(Comparator.comparing(Dto.RawMessage::timestamp).reversed());
        return new Dto.RawMessagePage(out.subList(0, Math.min(max, out.size())), null, scanned);
    }

    /** Live tail: polls from the end on a virtual thread, samples down to maxRate per second, until stopped. */
    public Runnable tail(String cid, String topic, String partition, int maxRate, Consumer<List<Dto.RawMessage>> onBatch) {
        Thread t = Thread.ofVirtual().name("tail-" + topic).start(() -> {
            try (KafkaConsumer<byte[], byte[]> c = kafka.consumer(cid, 2000)) {
                List<TopicPartition> tps = c.partitionsFor(topic, Duration.ofSeconds(10)).stream().map(i -> new TopicPartition(topic, i.partition())).filter(tp -> "all".equals(partition) || String.valueOf(tp.partition()).equals(partition)).toList();
                c.assign(tps);
                c.seekToEnd(tps);
                tps.forEach(c::position);
                List<ConsumerRecord<byte[], byte[]>> buf = new ArrayList<>();
                long next = System.currentTimeMillis() + 1000;
                while (!Thread.currentThread().isInterrupted()) {
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
            }
        });
        return t::interrupt;
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
            if (kv.length == 2) m.put(Integer.parseInt(kv[0].trim()), Long.parseLong(kv[1].trim()));
        }
        return m;
    }

    static String cursorOf(Map<Integer, Long> next) {
        StringJoiner j = new StringJoiner(",");
        next.forEach((p, o) -> j.add(p + ":" + o));
        return j.toString();
    }
}
