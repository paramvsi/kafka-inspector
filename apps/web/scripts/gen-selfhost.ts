// Writes the files the "Run on your own Kafka" page generates, using the page's own code (lib/selfhost.ts).
// Usage: node apps/web/scripts/gen-selfhost.ts <out-dir> <bootstrap> <port>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compose, dotenv } from '../lib/selfhost.ts';

const [out = 'selfhost-out', bootstrap = 'host.docker.internal:29093', port = '8090'] =
  process.argv.slice(2);
const form = {
  name: 'gate',
  bootstrap,
  security: 'PLAINTEXT',
  mechanism: 'PLAIN',
  schemaRegistry: '',
  registryAuth: false,
  port: Number(port),
} as const;
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'docker-compose.yml'), compose(form));
writeFileSync(join(out, '.env'), dotenv(form));
process.stdout.write(`wrote ${out}/docker-compose.yml and .env\n`);
