#!/bin/bash
# Steady demo traffic for the dev cluster: three topics, JSON values, two consumer groups (one slower than production).
set -u
B=kafka:9092
K=/opt/kafka/bin
for t in orders:6 payments:3 clickstream:6; do
  $K/kafka-topics.sh --bootstrap-server $B --create --if-not-exists --topic ${t%%:*} --partitions ${t##*:} --replication-factor 1 >/dev/null
done
mkdir -p /tmp/p
for i in $(seq 1 200); do echo "{\"orderId\":\"ord_$i\",\"total\":$((RANDOM % 900 + 10)).5,\"currency\":\"EUR\",\"status\":\"PAID\"}"; done > /tmp/p/orders
for i in $(seq 1 200); do echo "{\"paymentId\":\"pay_$i\",\"amount\":$((RANDOM % 500)),\"method\":\"card\"}"; done > /tmp/p/payments
for i in $(seq 1 200); do echo "{\"sessionId\":\"s_$i\",\"event\":\"view\",\"page\":\"/product\"}"; done > /tmp/p/clickstream
run() { while true; do $K/kafka-producer-perf-test.sh --topic "$1" --num-records 1000000 --throughput "$2" --payload-file "/tmp/p/$1" --producer-props bootstrap.servers=$B client.id="$3" >/dev/null 2>&1; done; }
run orders 200 web-checkout &
run payments 80 payment-gateway &
run clickstream 400 tracker-sdk &
sleep 3
# order-service keeps up; analytics-etl is slower and builds lag
while true; do $K/kafka-console-consumer.sh --bootstrap-server $B --topic orders --group order-service >/dev/null 2>&1; done &
while true; do timeout 20 $K/kafka-console-consumer.sh --bootstrap-server $B --include 'clickstream|payments' --group analytics-etl --max-messages 2000 >/dev/null 2>&1; sleep 10; done &
wait
