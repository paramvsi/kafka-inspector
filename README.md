# Kafka Inspector

A real-time UI for Apache Kafka: metric history, lag health, catch-up forecasts, alerts and a topology map. Try it in the browser on a simulated cluster, or run it read-only on your own Kafka with one Docker image.

> Work in progress. The build plan lives in [`docs/`](docs/) — start with [`docs/HANDOVER.md`](docs/HANDOVER.md).

## Develop

```bash
pnpm install
pnpm dev        # http://localhost:3000/app (simulated cluster)
pnpm test
pnpm build      # static export to apps/web/out
```

## Licence

Apache-2.0. "Kafka" is a trademark of the Apache Software Foundation. This project is not affiliated with or endorsed by the ASF.
