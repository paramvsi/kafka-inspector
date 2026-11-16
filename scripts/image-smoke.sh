#!/usr/bin/env bash
# Image smoke test (CI "image" job; also runnable locally): the image, hardened exactly like the generated
# `docker run` line, starts, is healthy, runs as 10001, and reads snappy/zstd-compressed topics from real Kafka.
set -euo pipefail
cd "$(dirname "$0")/.."
IMAGE=${1:-ghcr.io/paramvsi/kafka-inspector:ci}
PORT=${SMOKE_PORT:-18080}
P=ki-smoke
J=$(mktemp)
cleanup() {
  rm -f "$J"
  # the root cause sits above the stack frames: show exception and "Caused by" lines, then the tail
  docker logs ki-smoke-agent 2>&1 | grep -E 'Exception|Error|Caused by' | grep -v '^\s*at ' | tail -15 || true
  docker logs ki-smoke-agent 2>/dev/null | tail -20 || true
  docker rm -f ki-smoke-agent >/dev/null 2>&1 || true
  docker compose -p $P -f deploy/docker-compose.dev.yml down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker rm -f ki-smoke-agent >/dev/null 2>&1 || true # left over from a killed run
docker compose -p $P -f deploy/docker-compose.dev.yml up -d --wait kafka
for c in snappy zstd lz4 gzip; do
  docker compose -p $P -f deploy/docker-compose.dev.yml exec -T kafka sh -c \
    "printf 'a\nb\nc\n' | /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server localhost:9092 --topic comp-$c --compression-codec $c"
done
docker run -d --name ki-smoke-agent --network ${P}_default -p 127.0.0.1:$PORT:8080 \
  --read-only --tmpfs /tmp:exec --security-opt no-new-privileges --cap-drop ALL \
  -e KI_ADMIN_PASSWORD=smoke -e KAFKA_BOOTSTRAP=kafka:9092 -e KI_SAMPLE_INTERVAL=2s "$IMAGE" >/dev/null
ok=0
for i in $(seq 1 60); do curl -fs localhost:$PORT/api/health >/dev/null && { ok=1; break; }; sleep 1; done
[ $ok = 1 ] || { echo "FAIL: agent never became healthy"; exit 1; }
[ "$(docker exec ki-smoke-agent id -u)" = 10001 ] || { echo "FAIL: the process does not run as 10001"; exit 1; }
# the image's own HEALTHCHECK (wget + ${KI_PORT:-8080}), not just the endpoint
health=starting
for i in $(seq 1 30); do health=$(docker inspect ki-smoke-agent --format '{{.State.Health.Status}}'); [ "$health" = healthy ] && break; sleep 3; done
[ "$health" = healthy ] || { echo "FAIL: HEALTHCHECK says $health"; exit 1; }
# the web app is in the image (a jar built without the export would serve no UI)
curl -fs localhost:$PORT/app/ | grep -q '<html' || { echo "FAIL: /app/ doesn't serve the web app"; exit 1; }
curl -fs -c "$J" -b "$J" localhost:$PORT/api/info >/dev/null
T=$(awk '$6=="KI_CSRF"{print $7}' "$J")
curl -fs -c "$J" -b "$J" -H "X-KI-CSRF: $T" -H 'Content-Type: application/json' -d '{"username":"admin","password":"smoke"}' localhost:$PORT/api/auth/login
sleep 5 # first sample sees the topics
for c in snappy zstd lz4 gzip; do
  body=$(curl -s -b "$J" "localhost:$PORT/api/clusters/default/topics/comp-$c/messages?limit=5")
  echo "$body" | grep -q '"offset"' || { echo "FAIL: comp-$c: $body"; exit 1; }
done
echo "PASS: hardened image healthy as 10001, serves the web app, reads snappy, zstd, lz4 and gzip topics"
