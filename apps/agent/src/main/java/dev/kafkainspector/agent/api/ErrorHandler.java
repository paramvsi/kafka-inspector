package dev.kafkainspector.agent.api;

import dev.kafkainspector.agent.config.Clusters;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;
import java.time.format.DateTimeParseException;
import org.apache.kafka.common.KafkaException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Errors as { error: { code, message, details } } with a status that matches (AGENT_API). */
@RestControllerAdvice
public class ErrorHandler {
    private static final Logger log = LoggerFactory.getLogger(ErrorHandler.class);

    /** Malformed input from the client: always 400 in the API's own shape, never Boot's default body. */
    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class, MissingServletRequestParameterException.class, DateTimeParseException.class, NumberFormatException.class})
    ResponseEntity<Dto.ApiError> malformed(Exception e) {
        String msg = switch (e) {
            case MissingServletRequestParameterException m -> "Missing parameter " + m.getParameterName() + ".";
            case MethodArgumentTypeMismatchException m -> "Parameter " + m.getName() + " has an invalid value.";
            case HttpMessageNotReadableException m -> "The request body is missing or not valid JSON.";
            case DateTimeParseException m -> "That date and time can't be read. Use ISO 8601, e.g. 2026-11-16T10:00:00Z.";
            default -> "The request is missing a value or has one that can't be read.";
        };
        return ResponseEntity.status(400).body(Dto.ApiError.of("BAD_REQUEST", msg));
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<Dto.ApiError> method(HttpRequestMethodNotSupportedException e) {
        return ResponseEntity.status(405).body(Dto.ApiError.of("METHOD_NOT_ALLOWED", "This endpoint doesn't accept " + e.getMethod() + ". The agent is read-only in this version."));
    }

    @ExceptionHandler(org.springframework.dao.DataIntegrityViolationException.class)
    ResponseEntity<Dto.ApiError> invalidData(DataAccessException e) {
        log.warn("Rejected by the database: {}", e.getMostSpecificCause().getMessage());
        return ResponseEntity.status(400).body(Dto.ApiError.of("INVALID_DATA", "The agent couldn't store that: a value is missing or too long."));
    }

    /** The database itself failing (outage, lock timeout) is not the caller's mistake. */
    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<Dto.ApiError> storage(DataAccessException e) {
        log.warn("Storage error: {}", e.getMostSpecificCause().getMessage());
        return ResponseEntity.status(503).body(Dto.ApiError.of("STORAGE_UNAVAILABLE", "The agent's database didn't answer. Check the agent log and its KI_DB_URL, then try again."));
    }

    @ExceptionHandler({org.springframework.web.servlet.resource.NoResourceFoundException.class, org.springframework.web.servlet.NoHandlerFoundException.class})
    ResponseEntity<?> noRoute(Exception e, jakarta.servlet.http.HttpServletRequest req) throws java.io.IOException {
        if (req.getRequestURI().startsWith("/api/"))
            return ResponseEntity.status(404).body(Dto.ApiError.of("NOT_FOUND", "No such endpoint."));
        var page = new org.springframework.core.io.ClassPathResource("static/404.html");
        return page.exists()
                ? ResponseEntity.status(404).contentType(org.springframework.http.MediaType.TEXT_HTML).body(page.getContentAsByteArray())
                : ResponseEntity.status(404).build();
    }

    /** Anything else: a generic 500 without internals (the cause is logged, not returned). */
    @ExceptionHandler(Exception.class)
    ResponseEntity<Dto.ApiError> unexpected(Exception e) {
        // Spring MVC's own client errors (415, 406, missing header…) keep their status
        if (e instanceof org.springframework.web.ErrorResponse er && er.getStatusCode().is4xxClientError())
            return ResponseEntity.status(er.getStatusCode()).body(Dto.ApiError.of("BAD_REQUEST", er.getBody().getDetail() == null ? "The request can't be handled as sent." : er.getBody().getDetail()));
        log.error("Unexpected error", e);
        return ResponseEntity.status(500).body(Dto.ApiError.of("INTERNAL", "Something went wrong in the agent. Check its logs."));
    }

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
        return ResponseEntity.status(502).body(Dto.ApiError.of("KAFKA_UNAVAILABLE", "Kafka didn't answer: " + java.util.Objects.toString(t.getMessage(), t.getClass().getSimpleName()) + ". Check that the brokers are reachable from the agent."));
    }

    @ExceptionHandler(IllegalStateException.class)
    ResponseEntity<Dto.ApiError> unavailable(IllegalStateException e) {
        return ResponseEntity.status(503).body(Dto.ApiError.of("UNAVAILABLE", e.getMessage()));
    }
}
