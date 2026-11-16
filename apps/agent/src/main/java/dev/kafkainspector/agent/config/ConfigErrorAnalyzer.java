package dev.kafkainspector.agent.config;

import org.springframework.boot.diagnostics.AbstractFailureAnalyzer;
import org.springframework.boot.diagnostics.FailureAnalysis;

/**
 * A configuration mistake (the agent's own checks name the KI_ variable) is printed as Spring Boot's short
 * "APPLICATION FAILED TO START" description, instead of a "Caused by" deep in a long stack trace.
 */
public class ConfigErrorAnalyzer extends AbstractFailureAnalyzer<IllegalStateException> {
    @Override
    protected FailureAnalysis analyze(Throwable root, IllegalStateException cause) {
        String m = cause.getMessage();
        if (m == null || !m.contains("KI_")) return null; // not one of ours: Spring's default report
        return new FailureAnalysis(m, "Fix the variable named above and start the agent again.", cause);
    }
}
