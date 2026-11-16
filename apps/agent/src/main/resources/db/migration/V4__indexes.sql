-- the prune job deletes by ts alone (the lookup index has ts last, so it scanned the table)
CREATE INDEX metric_sample_ts ON metric_sample (ts);
-- alert evaluation looks up firing events by cluster and rule every sample
CREATE INDEX alert_event_firing ON alert_event (state, cluster, rule_id);
