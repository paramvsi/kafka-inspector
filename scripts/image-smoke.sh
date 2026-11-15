#!/usr/bin/env bash
# Image smoke test (CI "image" job; also runnable locally): the image, hardened exactly like the generated
# `docker run` line, starts, is healthy, runs as 10001, and reads snappy/zstd-compressed topics from real Kafka.
set -euo pipefail
IMAGE=${1:-ghcr.io/paramvsi/kafka-inspector:ci}
P=ki-smoke
cleanup() {
  docker logs ki-smoke-agent 2>/dev/null | tail -20 || true
  docker rm -f ki-smoke-agent >/dev/null 2>&1 || true
  docker compose -p $P -f deploy/docker-compose.dev.yml down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker compose -p $P -f deploy/docker-compose.dev.yml up -d --wait kafka
for c in snappy zstd; do
  docker compose -p $P -f deploy/docker-compose.dev.yml exec -T kafka sh -c \
    "printf 'a\nb\nc\n' | /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server localhost:9092 --topic comp-$c --compression-codec $c"
done
docker run -d --name ki-smoke-agent --network ${P}_default -p 18080:8080 \
  --read-only --tmpfs /tmp:exec --security-opt no-new-privileges --cap-drop ALL \
  -e KI_ADMIN_PASSWORD=smoke -e KAFKA_BOOTSTRAP=kafka:9092 -e KI_SAMPLE_INTERVAL=2s "$IMAGE" >/dev/null
ok=0
for i in $(seq 1 60); do curl -fs localhost:18080/api/health >/dev/null && { ok=1; break; }; sleep 1; done
[ $ok = 1 ] || { echo "FAIL: agent never became healthy"; exit 1; }
[ "$(docker inspect ki-smoke-agent --format '{{.Config.User}}')" = 10001 ] || { echo "FAIL: not running as 10001"; exit 1; }
J=$(mktemp)
curl -fs -c "$J" -b "$J" localhost:18080/api/info >/dev/null
T=$(awk '$6=="KI_CSRF"{print $7}' "$J")
curl -fs -c "$J" -b "$J" -H "X-KI-CSRF: $T" -H 'Content-Type: application/json' -d '{"username":"admin","password":"smoke"}' localhost:18080/api/auth/login
sleep 5 # first sample sees the topics
for c in snappy zstd; do
  body=$(curl -s -b "$J" "localhost:18080/api/clusters/default/topics/comp-$c/messages?limit=5")
  echo "$body" | grep -q '"offset"' || { echo "FAIL: comp-$c: $body"; exit 1; }
done
echo "PASS: hardened image healthy as 10001, reads snappy and zstd topics"
