import { describe, expect, test } from 'vitest';
import {
  compose,
  dockerRun,
  dotenv,
  PRESETS,
  secretNames,
  warnings,
  type SelfHostForm,
} from './selfhost';

const f: SelfHostForm = {
  name: 'prod-us-2',
  bootstrap: 'b-1.prod-us-2:9096,b-2.prod-us-2:9096',
  security: 'SASL_SSL',
  mechanism: 'SCRAM-SHA-512',
  schemaRegistry: 'https://schema-registry.prod-us-2.internal',
  registryAuth: true,
  port: 8080,
};

describe('Run on your own Kafka generator', () => {
  test('compose has settings and read-only, never secret values', () => {
    const c = compose(f);
    expect(c).toContain('KI_CLUSTERS_0_BOOTSTRAP: "b-1.prod-us-2:9096,b-2.prod-us-2:9096"');
    expect(c).toContain('KI_CLUSTERS_0_SASL_MECHANISM: "SCRAM-SHA-512"');
    expect(c).toContain('KI_READ_ONLY: "true"');
    expect(c).toContain('env_file: .env');
    expect(c).toContain('cap_drop:\n      - ALL');
    expect(c).toContain('no-new-privileges:true');
    expect(c).toContain('- /tmp:exec'); // compressed (snappy/zstd) topics need exec on /tmp
    expect(c).not.toMatch(/PASSWORD/);
  });
  test('.env lists variable names only, with empty values', () => {
    const e = dotenv(f);
    for (const n of secretNames(f)) expect(e).toContain(`${n}=\n`);
    expect(
      e
        .split('\n')
        .filter((l) => l && !l.startsWith('#'))
        .every((l) => l.endsWith('=')),
    ).toBe(true);
  });
  test('docker run quotes odd values and uses the env file', () => {
    const r = dockerRun({ ...f, name: "team's cluster" });
    expect(r).toContain("-e KI_CLUSTERS_0_NAME='team'\\''s cluster'");
    expect(r).toContain('--env-file .env');
    expect(r).toContain(
      '--read-only --tmpfs /tmp:exec --security-opt no-new-privileges --cap-drop ALL',
    );
  });
  test('warns about localhost and malformed bootstrap', () => {
    expect(warnings({ ...f, bootstrap: 'localhost:9092' })[0]).toContain('host.docker.internal');
    expect(warnings({ ...f, bootstrap: 'nope' }).join(' ')).toContain('host:port');
    expect(secretNames({ ...f, security: 'PLAINTEXT', schemaRegistry: '' })).toEqual([
      'KI_ADMIN_PASSWORD',
    ]);
  });
});

test('credentials in a registry URL never reach the files; YAML-ish values stay strings', () => {
  const g = {
    ...f,
    name: 'yes',
    schemaRegistry: 'https://svc-user:s3cret@registry.example:8081',
  };
  const all = compose(g) + dockerRun(g) + dotenv(g);
  expect(all).not.toContain('s3cret');
  expect(all).not.toContain('svc-user');
  expect(compose(g)).toContain('KI_CLUSTERS_0_SCHEMA_REGISTRY: "https://registry.example:8081"');
  expect(compose(g)).toContain('KI_CLUSTERS_0_NAME: "yes"');
  expect(warnings(g).join(' ')).toContain('left out of the files');
});

test('registry credentials never leak, even with @ in the password or no scheme; $ is escaped for Compose', () => {
  const base = {
    name: 'prod$HOME',
    bootstrap: 'b:9092',
    security: 'PLAINTEXT',
    mechanism: 'PLAIN',
    registryAuth: false,
    port: 8080,
  } as const;
  for (const url of ['https://user:p@ss@reg:8081', 'user:secret@reg:8081']) {
    const f = { ...base, schemaRegistry: url };
    for (const out of [compose(f), dockerRun(f)]) {
      expect(out).not.toMatch(/ss@reg|secret@|user:p|user:secret/);
      expect(out).toContain('reg:8081');
    }
  }
  expect(compose({ ...base, schemaRegistry: '' })).toContain('"prod$$HOME"');
});

describe('generator edge cases', () => {
  test('an empty cluster name is warned about', () => {
    expect(warnings({ ...f, name: '  ' }).join(' ')).toMatch(/Give the cluster a name/);
  });
  test('docker run restarts like compose does', () => {
    expect(dockerRun(f)).toContain('--restart unless-stopped');
  });
  test('a registry URL with a query-string token never reaches a generated file', () => {
    const g = { ...f, schemaRegistry: 'https://sr.example.com/api?api_key=s3cret' };
    expect(compose(g)).not.toContain('s3cret');
    expect(dockerRun(g)).not.toContain('s3cret');
    expect(warnings(g).join(' ')).toMatch(/query/i);
  });
  test('the .env says how compose reads a $ in a value: single quotes keep it literal', () => {
    expect(dotenv(f)).toMatch(/single quotes/);
    expect(dotenv(f)).toMatch(/\$ as a variable/);
  });
  test('the .env says to quote a value containing # (compose cuts it off as a comment)', () => {
    expect(dotenv(f)).toMatch(/#.*quote|quote.*#/i);
  });
  test('the Aiven note names the truststore password and the mount, not just the location', () => {
    expect(PRESETS.Aiven!.note).toContain('KI_CLUSTERS_0_SSL_TRUSTSTORE_PASSWORD');
    expect(PRESETS.Aiven!.note).toMatch(/mount/i);
  });
});

test('the generated compose and docker run cap their logs (a restart loop must not fill the disk)', () => {
  const c = compose(f);
  expect(c).toContain('logging:');
  expect(c).toContain('max-size: "10m"');
  expect(c).toContain('max-file: "3"');
  const r = dockerRun(f);
  expect(r).toContain('--log-opt max-size=10m');
  expect(r).toContain('--log-opt max-file=3');
});

test('a registry password containing / or # never reaches a generated file, and the user is told', () => {
  for (const url of ['http://u:pa/ss@reg:8081', 'http://u:pa#ss@reg:8081', 'u:p?w@reg:8081']) {
    const g = { ...f, schemaRegistry: url };
    for (const out of [compose(g), dockerRun(g)]) {
      expect(out).not.toMatch(/u:pa|u:p\?|pa\/ss|pa#ss/);
      expect(out).toContain('reg:8081');
    }
    expect(warnings(g).join(' ')).toMatch(/username or password/);
  }
});
