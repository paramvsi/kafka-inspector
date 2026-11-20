package dev.kafkainspector.agent.kafka;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;
import org.apache.kafka.common.errors.SaslAuthenticationException;
import org.junit.jupiter.api.Test;

class SamplerReasonTest {
    @Test
    void anUnreachableClusterAndBadCredentialsSayWhatFailedAndWhatToDo() {
        // describeCluster().get(20 s) on a down cluster: a TimeoutException with no message, shown as "TimeoutException"
        assertEquals("No broker answered within 20 s. Check the bootstrap address and the network.",
                Sampler.reason(new TimeoutException()));
        assertEquals("Authentication failed: bad password. Check the cluster's SASL credentials.",
                Sampler.reason(new ExecutionException(new SaslAuthenticationException("bad password"))));
        // describeCluster denied to a least-privilege principal: Kafka only says "Cluster authorization failed."
        assertEquals("The agent's Kafka user isn't allowed to describe the cluster. Grant it DESCRIBE on CLUSTER (and DESCRIBE on the topics and groups to show).",
                Sampler.reason(new ExecutionException(new org.apache.kafka.common.errors.ClusterAuthorizationException("Cluster authorization failed."))));
        assertEquals("boom", Sampler.reason(new RuntimeException(new IllegalStateException("boom"))));
    }
}
