package dev.kafkainspector.agent.api;

import dev.kafkainspector.agent.config.Clusters;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;
import org.apache.kafka.common.KafkaException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Errors as { error: { code, message, details } } with a status that matches (AGENT_API). */
@RestControllerAdvice
public class ErrorHandler {
    @ExceptionHandler(Clusters.NotFound.class)
    ResponseEntity<Dto.ApiError> notFound(Clusters.NotFound e) {
        return ResponseEntity.status(404).body(Dto.ApiError.of(e.code, e.getMessage()));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<Dto.ApiError> bad(IllegalArgumentException e) {
        return ResponseEntity.status(400).body(Dto.ApiError.of("BAD_REQUEST", e.getMessage()));
    }

    @ExceptionHandler({KafkaException.class, ExecutionException.class, TimeoutException.class})
    ResponseEntity<Dto.ApiError> kafka(Exception e) {
        Throwable t = e;
        while (t.getCause() != null) t = t.getCause();
        return ResponseEntity.status(502).body(Dto.ApiError.of("KAFKA_UNAVAILABLE", "Kafka didn't answer: " + t.getMessage() + ". Check that the brokers are reachable from the agent."));
    }

    @ExceptionHandler(IllegalStateException.class)
    ResponseEntity<Dto.ApiError> unavailable(IllegalStateException e) {
        return ResponseEntity.status(503).body(Dto.ApiError.of("UNAVAILABLE", e.getMessage()));
    }
}
