package dev.kafkainspector.agent.kafka;

import dev.kafkainspector.agent.config.Clusters;
import dev.kafkainspector.agent.config.KiProperties;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.ConcurrentHashMap;
import org.apache.kafka.clients.admin.Admin;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.common.serialization.ByteArrayDeserializer;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.stereotype.Service;

/** Kafka clients per cluster: one shared Admin, and short-lived consumers that never commit (D-02). */
@Service
public class KafkaService implements DisposableBean {
    private final Clusters clusters;
    private final Map<String, Admin> admins = new ConcurrentHashMap<>();

    public KafkaService(Clusters clusters) {
        this.clusters = clusters;
    }

    public Admin admin(String cid) {
        return admins.computeIfAbsent(cid, id -> Admin.create(clusters.clientProps(clusters.get(id))));
    }

    /** Drop a broken Admin so the next call reconnects. */
    public void reset(String cid) {
        Admin a = admins.remove(cid);
        if (a != null) a.close(java.time.Duration.ofSeconds(1));
    }

    /** A consumer with no group.id: assign + seek only, auto-commit off — it can never commit offsets. */
    public KafkaConsumer<byte[], byte[]> consumer(String cid, int maxPoll) {
        KiProperties.Cluster c = clusters.get(cid);
        Properties p = clusters.clientProps(c);
        p.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, ByteArrayDeserializer.class.getName());
        p.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, ByteArrayDeserializer.class.getName());
        p.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);
        p.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, maxPoll);
        p.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "none");
        p.put(ConsumerConfig.CLIENT_ID_CONFIG, "kafka-inspector-browse");
        p.remove(ConsumerConfig.GROUP_ID_CONFIG);
        return new KafkaConsumer<>(p);
    }

    @Override
    public void destroy() {
        admins.values().forEach(a -> a.close(java.time.Duration.ofSeconds(2)));
    }
}
