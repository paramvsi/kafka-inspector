-- Kafka Inspector agent storage (ARCHITECTURE "Storage"). H2 by default, PostgreSQL via KI_DB_URL.
CREATE TABLE metric_sample (
  cluster VARCHAR(100) NOT NULL,
  scope   VARCHAR(20)  NOT NULL,
  skey    VARCHAR(300) NOT NULL,
  metric  VARCHAR(40)  NOT NULL,
  ts      BIGINT       NOT NULL,
  val     DOUBLE PRECISION NOT NULL
);
CREATE INDEX metric_sample_lookup ON metric_sample (cluster, scope, skey, metric, ts);

CREATE TABLE alert_rule (
  id           VARCHAR(64)  PRIMARY KEY,
  name         VARCHAR(200) NOT NULL,
  metric       VARCHAR(40)  NOT NULL,
  scope_kind   VARCHAR(20)  NOT NULL,
  scope_target VARCHAR(300),
  threshold    DOUBLE PRECISION,
  duration_sec INT          NOT NULL,
  severity     VARCHAR(10)  NOT NULL,
  channels     VARCHAR(100) NOT NULL,
  enabled      BOOLEAN      NOT NULL,
  muted        BOOLEAN      NOT NULL,
  deleted      BOOLEAN      NOT NULL
);

CREATE TABLE alert_event (
  id           VARCHAR(64)  PRIMARY KEY,
  cluster      VARCHAR(100) NOT NULL,
  rule_id      VARCHAR(64)  NOT NULL,
  severity     VARCHAR(10)  NOT NULL,
  title        VARCHAR(400) NOT NULL,
  evidence     VARCHAR(400) NOT NULL,
  target       VARCHAR(300) NOT NULL,
  href         VARCHAR(400) NOT NULL,
  state        VARCHAR(10)  NOT NULL,
  fired_at     BIGINT       NOT NULL,
  resolved_at  BIGINT,
  muted_until  BIGINT,
  acknowledged BOOLEAN      NOT NULL
);
CREATE INDEX alert_event_fired ON alert_event (fired_at);

-- Ready-made rules (F-83)
INSERT INTO alert_rule VALUES ('r-group-stalled', 'Consumer group stalled or stopped', 'group-status', 'any', NULL, NULL, 60, 'crit', 'in-app,browser', TRUE, FALSE, FALSE);
INSERT INTO alert_rule VALUES ('r-lag-5k', 'Lag above 5,000 for 5 min', 'lag', 'any', NULL, 5000, 300, 'warn', 'in-app', TRUE, FALSE, FALSE);
INSERT INTO alert_rule VALUES ('r-urp', 'Under-replicated partitions', 'under-replicated', 'any', NULL, 0, 30, 'crit', 'in-app,browser', TRUE, FALSE, FALSE);
INSERT INTO alert_rule VALUES ('r-broker-offline', 'Broker offline', 'broker-offline', 'any', NULL, NULL, 10, 'crit', 'in-app,browser', TRUE, FALSE, FALSE);
INSERT INTO alert_rule VALUES ('r-topic-silent', 'Topic silent for 10 min', 'topic-silent', 'any', NULL, NULL, 600, 'warn', 'in-app', TRUE, FALSE, FALSE);
INSERT INTO alert_rule VALUES ('r-dlq', 'DLQ receiving messages', 'dlq-receiving', 'any', NULL, 0, 60, 'info', 'in-app', TRUE, TRUE, FALSE);
