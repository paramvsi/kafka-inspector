package dev.kafkainspector.agent.alerts;

import static org.junit.jupiter.api.Assertions.assertEquals;

import dev.kafkainspector.agent.kafka.ClusterState;
import dev.kafkainspector.agent.lag.Lag;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedDeque;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** A group-status alert the user acknowledged survives an agent restart or a failed sample (the lag window starts empty). */
class AlertServiceTest {
    @Test
    void anAcknowledgedGroupStatusAlertIsNotResolvedAndRefiredWhileTheLagWindowWarmsUp() {
        var ds = new DriverManagerDataSource("jdbc:h2:mem:alerts;DB_CLOSE_DELAY=-1", "sa", "");
        Flyway.configure().dataSource(ds).load().migrate();
        var jdbc = new JdbcTemplate(ds);
        var alerts = new AlertService(jdbc);
        alerts.save(new AlertService.Rule(null, "stuck", "group-status", new AlertService.Scope("any", null), null, 0, "warn", List.of("in-app"), true, false, null));

        var s = new ClusterState();
        var g = new ClusterState.GroupSnap();
        g.groupId = "billing";
        g.status = Lag.Status.stalled;
        s.groups = Map.of("billing", g);
        var w = new ConcurrentLinkedDeque<Lag.Sample>();
        for (long t = 0; t < 3; t++) w.add(new Lag.Sample(t * 1000, 100L, 500L));
        s.windows.put("billing|orders|0", w);
        alerts.evaluate("local", s, 10_000);
        String id = jdbc.queryForObject("SELECT id FROM alert_event WHERE state = 'firing'", String.class);
        alerts.acknowledge(id);

        // restart / failed sample: the window is empty, then holds one sample, and the status can't say stalled yet
        s.windows.clear();
        g.status = Lag.Status.healthy;
        alerts.evaluate("local", s, 20_000);
        var one = new ConcurrentLinkedDeque<Lag.Sample>();
        one.add(new Lag.Sample(30_000, 100L, 500L));
        s.windows.put("billing|orders|0", one);
        alerts.evaluate("local", s, 30_000);
        // the window has two samples again and the group is still stalled
        one.add(new Lag.Sample(40_000, 100L, 500L));
        g.status = Lag.Status.stalled;
        alerts.evaluate("local", s, 40_000);

        List<Map<String, Object>> events = jdbc.queryForList("SELECT state, acknowledged FROM alert_event");
        assertEquals(1, events.size(), "one incident, not a resolved one plus a new un-acknowledged one: " + events);
        assertEquals("firing", events.get(0).get("STATE"));
        assertEquals(true, events.get(0).get("ACKNOWLEDGED"));
    }

    @Test
    void eachClustersAlertListShowsOnlyItsOwnAlerts() {
        var ds = new DriverManagerDataSource("jdbc:h2:mem:alerts-two;DB_CLOSE_DELAY=-1", "sa", "");
        Flyway.configure().dataSource(ds).load().migrate();
        var jdbc = new JdbcTemplate(ds);
        jdbc.update("INSERT INTO alert_event VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", "e-a", "a", "r1", "warn", "On A", "", "billing", "", "firing", 1000L, null, null, false);
        jdbc.update("INSERT INTO alert_event VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", "e-b", "b", "r1", "warn", "On B", "", "billing", "", "firing", 2000L, null, null, false);
        var alerts = new AlertService(jdbc);
        assertEquals(List.of("e-a"), alerts.events("a", "all", 50).stream().map(AlertService.Event::id).toList());
        assertEquals(List.of("e-b"), alerts.events("b", "firing", 50).stream().map(AlertService.Event::id).toList());
        // no cluster given (an older web app): every cluster, as before
        assertEquals(2, alerts.events(null, "all", 50).size());
    }

    @Test
    void aSpecificRuleWithNoTargetIsRefusedNotSavedToNeverFire() {
        var ds = new DriverManagerDataSource("jdbc:h2:mem:alerts-target;DB_CLOSE_DELAY=-1", "sa", "");
        Flyway.configure().dataSource(ds).load().migrate();
        var alerts = new AlertService(new JdbcTemplate(ds));
        for (String blank : new String[] {null, "", "  "}) {
            var e = org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class, () -> alerts.save(new AlertService.Rule(null, "lag", "lag", new AlertService.Scope("specific", blank), 100.0, 0, "warn", List.of("in-app"), true, false, null)));
            assertEquals("Pick the group, topic or broker this rule watches.", e.getMessage());
        }
    }
}
