package dev.kafkainspector.agent.config;

import java.sql.SQLException;
import org.springframework.boot.diagnostics.FailureAnalysis;
import org.springframework.boot.diagnostics.FailureAnalyzer;

/**
 * Startup mistakes a user can fix are printed as Spring Boot's short "APPLICATION FAILED TO START" description,
 * instead of a "Caused by" deep in a long stack trace: the agent's own config checks (they name the KI_ variable),
 * and a /data the agent's user can't write (a root-owned bind mount: H2 only says "IO Exception").
 */
public class ConfigErrorAnalyzer implements FailureAnalyzer {
    @Override
    public FailureAnalysis analyze(Throwable failure) {
        for (Throwable t = failure; t != null; t = t.getCause()) {
            if (t instanceof IllegalStateException e && e.getMessage() != null && e.getMessage().contains("KI_"))
                return new FailureAnalysis(e.getMessage(), "Fix the variable named above and start the agent again.", e);
            if (t instanceof SQLException e && e.getErrorCode() == 90028) // H2 IO_EXCEPTION_1: the database file can't be created or opened
                return new FailureAnalysis(
                        "The agent couldn't open its history database: " + e.getMessage(),
                        "Make /data writable by the agent's user (UID 10001). For a host folder, run chown 10001:10001 <folder>, or use the named volume from the generated compose file.",
                        e);
        }
        return null; // not one of ours: Spring's default report
    }
}
