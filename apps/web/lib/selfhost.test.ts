import { describe, expect, test } from 'vitest';
import { compose, dockerRun, dotenv, secretNames, warnings, type SelfHostForm } from './selfhost';

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
    expect(c).toContain('KI_CLUSTERS_0_BOOTSTRAP: b-1.prod-us-2:9096,b-2.prod-us-2:9096');
    expect(c).toContain('KI_CLUSTERS_0_SASL_MECHANISM: SCRAM-SHA-512');
    expect(c).toContain('KI_READ_ONLY: "true"');
    expect(c).toContain('env_file: .env');
    expect(c).toContain('cap_drop:\n      - ALL');
    expect(c).toContain('no-new-privileges:true');
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
    expect(r).toContain('--read-only --tmpfs /tmp --security-opt no-new-privileges --cap-drop ALL');
  });
  test('warns about localhost and malformed bootstrap', () => {
    expect(warnings({ ...f, bootstrap: 'localhost:9092' })[0]).toContain('host.docker.internal');
    expect(warnings({ ...f, bootstrap: 'nope' }).join(' ')).toContain('host:port');
    expect(secretNames({ ...f, security: 'PLAINTEXT', schemaRegistry: '' })).toEqual([
      'KI_ADMIN_PASSWORD',
    ]);
  });
});
