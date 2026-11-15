package dev.kafkainspector.agent;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Kafka Inspector agent: serves the web app at /app and a read-only REST + WebSocket API at /api. */
@SpringBootApplication
@EnableScheduling
@ConfigurationPropertiesScan
public class AgentApplication {
    public static void main(String[] args) {
        SpringApplication.run(AgentApplication.class, args);
    }
}
