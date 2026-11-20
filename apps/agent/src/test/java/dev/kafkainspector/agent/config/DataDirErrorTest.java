package dev.kafkainspector.agent.config;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeFalse;

import java.nio.file.Files;
import java.nio.file.attribute.PosixFilePermissions;
import java.sql.DriverManager;
import org.junit.jupiter.api.Test;

/** A /data the agent's user can't write (a root-owned bind mount) starts with a one-line fix, not a stack trace. */
class DataDirErrorTest {
    @Test
    void anUnwritableDataFolderNamesTheChownFix() throws Exception {
        assumeFalse("root".equals(System.getProperty("user.name")), "root can write anywhere");
        var dir = Files.createTempDirectory("ki-data");
        Files.setPosixFilePermissions(dir, PosixFilePermissions.fromString("r-xr-xr-x"));
        try {
            // the exception H2 really throws, wrapped the way Spring wraps it at startup
            var h2 = assertThrows(Exception.class, () -> DriverManager.getConnection("jdbc:h2:file:" + dir + "/ki", "sa", ""));
            var r = new ConfigErrorAnalyzer().analyze(new RuntimeException("Error creating bean 'flyway'", h2));
            assertNotNull(r, "an unwritable data folder fell through to Spring's stack trace: " + h2);
            assertTrue(r.getAction().contains("chown 10001:10001"), r.getAction());
        } finally {
            Files.setPosixFilePermissions(dir, PosixFilePermissions.fromString("rwxr-xr-x"));
            Files.deleteIfExists(dir);
        }
    }
}
