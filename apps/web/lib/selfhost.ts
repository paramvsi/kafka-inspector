// "Run on your own Kafka" generator (F-96). Pure functions: tested, and nothing leaves the browser.
export interface SelfHostForm {
  name: string;
  bootstrap: string;
  security: 'PLAINTEXT' | 'SSL' | 'SASL_PLAINTEXT' | 'SASL_SSL';
  mechanism: 'PLAIN' | 'SCRAM-SHA-256' | 'SCRAM-SHA-512' | 'OAUTHBEARER';
  schemaRegistry: string;
  registryAuth: boolean;
  port: number;
}

export const IMAGE = 'ghcr.io/paramvsi/kafka-inspector:1.0.0';

const sasl = (f: SelfHostForm) => f.security.startsWith('SASL');
const yamlStr = (s: string) => (/^[\w./:,-]+$/.test(s) ? s : JSON.stringify(s));

/** Non-secret settings, shared by compose and docker run. */
export function envSettings(f: SelfHostForm): Array<[string, string]> {
  const out: Array<[string, string]> = [
    ['KI_CLUSTERS_0_NAME', f.name],
    ['KI_CLUSTERS_0_BOOTSTRAP', f.bootstrap],
    ['KI_CLUSTERS_0_SECURITY', f.security],
  ];
  if (sasl(f)) out.push(['KI_CLUSTERS_0_SASL_MECHANISM', f.mechanism]);
  if (f.schemaRegistry) out.push(['KI_CLUSTERS_0_SCHEMA_REGISTRY', f.schemaRegistry]);
  out.push(['KI_READ_ONLY', 'true']);
  return out;
}

/** Secret variable NAMES only — values are filled in on the server (rule 6). */
export function secretNames(f: SelfHostForm): string[] {
  const out = ['KI_ADMIN_PASSWORD'];
  if (sasl(f)) out.push('KI_CLUSTERS_0_SASL_USERNAME', 'KI_CLUSTERS_0_SASL_PASSWORD');
  if (f.schemaRegistry && f.registryAuth)
    out.push('KI_CLUSTERS_0_SCHEMA_REGISTRY_USERNAME', 'KI_CLUSTERS_0_SCHEMA_REGISTRY_PASSWORD');
  return out;
}

export function compose(f: SelfHostForm): string {
  return [
    'services:',
    '  kafka-inspector:',
    `    image: ${IMAGE}`,
    '    restart: unless-stopped',
    '    read_only: true          # only /data is writable',
    '    tmpfs:',
    '      - /tmp',
    '    ports:',
    `      - "${f.port}:8080"`,
    '    env_file: .env          # secrets: fill in on your server',
    '    environment:',
    ...envSettings(f).map(
      ([k, v]) => `      ${k}: ${k === 'KI_READ_ONLY' ? '"true"' : yamlStr(v)}`,
    ),
    '    volumes:',
    '      - ki-data:/data       # metric history and alert rules',
    'volumes:',
    '  ki-data:',
    '',
  ].join('\n');
}

export function dotenv(f: SelfHostForm): string {
  return [
    '# Fill these in on your server. Never commit this file.',
    ...secretNames(f).map((n) => `${n}=`),
    '',
  ].join('\n');
}

export function dockerRun(f: SelfHostForm): string {
  return [
    `docker run -d --name kafka-inspector -p ${f.port}:8080 \\`,
    '  --env-file .env \\',
    ...envSettings(f).map(
      ([k, v]) => `  -e ${k}=${/^[\w./:,-]+$/.test(v) ? v : `'${v.replace(/'/g, "'\\''")}'`} \\`,
    ),
    '  -v ki-data:/data \\',
    `  ${IMAGE}`,
    '',
  ].join('\n');
}

export function warnings(f: SelfHostForm): string[] {
  const w: string[] = [];
  if (/(^|,)\s*(localhost|127\.0\.0\.1)(:|$)/.test(f.bootstrap))
    w.push(
      'Inside the container, localhost is the container itself. Use host.docker.internal (Docker Desktop) or the broker’s network address.',
    );
  if (!/^[^,\s]+:\d+(,\s*[^,\s]+:\d+)*$/.test(f.bootstrap.trim()))
    w.push('Bootstrap servers are host:port pairs separated by commas.');
  if (f.security === 'SASL_PLAINTEXT' || f.security === 'PLAINTEXT')
    w.push('Credentials and data travel unencrypted with this security setting.');
  return w;
}

export const PRESETS: Record<string, Partial<SelfHostForm> & { note: string }> = {
  'Amazon MSK (SASL/SCRAM)': {
    security: 'SASL_SSL',
    mechanism: 'SCRAM-SHA-512',
    note: 'Port 9096. IAM auth is not supported in this version — use SCRAM. Not verified against MSK.',
  },
  'Confluent Cloud': {
    security: 'SASL_SSL',
    mechanism: 'PLAIN',
    registryAuth: true,
    note: 'Use an API key as the SASL username and its secret as the password. Port 9092. Not verified against Confluent Cloud.',
  },
  Aiven: {
    security: 'SASL_SSL',
    mechanism: 'SCRAM-SHA-256',
    note: 'Enable SASL on the service; port is shown in the console. A custom CA needs KI_CLUSTERS_0_SSL_TRUSTSTORE_LOCATION. Not verified against Aiven.',
  },
};
