-- Saved message-browser filters (F-04: "agent DB in Self"). App data, not Kafka.
CREATE TABLE saved_filter (
  name VARCHAR(100)  PRIMARY KEY,
  expr VARCHAR(2000) NOT NULL
);
