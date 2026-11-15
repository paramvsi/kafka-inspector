package dev.kafkainspector.agent.prefs;

import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Saved message-browser filters (F-04). App data — allowed in read-only mode, like alert rules. */
@Repository
public class SavedFilters {
    private final JdbcTemplate jdbc;

    public SavedFilters(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record Filter(String name, String expr) {}

    public List<Filter> list() {
        return jdbc.query("SELECT name, expr FROM saved_filter ORDER BY name", (rs, i) -> new Filter(rs.getString("name"), rs.getString("expr")));
    }

    public void save(String name, String expr) {
        String n = name == null ? "" : name.trim();
        if (n.isEmpty() || n.length() > 100) throw new IllegalArgumentException("Give the filter a name of 1 to 100 characters.");
        if (expr == null || expr.isBlank() || expr.length() > 2000) throw new IllegalArgumentException("The filter expression must be 1 to 2,000 characters.");
        if (jdbc.update("UPDATE saved_filter SET expr = ? WHERE name = ?", expr, n) == 0) jdbc.update("INSERT INTO saved_filter (name, expr) VALUES (?, ?)", n, expr);
    }
}
