-- Kafka puts no length limit on group ids (or registry subjects): keys and alert fields that embed them
-- must not overflow, or history for that group and every alert insert for it fail.
ALTER TABLE metric_sample ALTER COLUMN skey SET DATA TYPE VARCHAR(2000);
ALTER TABLE alert_rule ALTER COLUMN scope_target SET DATA TYPE VARCHAR(2000);
ALTER TABLE alert_event ALTER COLUMN target SET DATA TYPE VARCHAR(2000);
ALTER TABLE alert_event ALTER COLUMN title SET DATA TYPE VARCHAR(2000);
ALTER TABLE alert_event ALTER COLUMN href SET DATA TYPE VARCHAR(2000);
