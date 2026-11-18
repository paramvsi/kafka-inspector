// "Run on your own Kafka" generator (F-96). Pure functions: tested, and nothing leaves the browser.
export interface SelfHostForm {
  name: string;
  bootstrap: string;
  security: 'PLAINTEXT' | 'SSL' | 'SASL_PLAINTEXT' | 'SASL_SSL';
  mechanism: 'PLAIN' | 'SCRAM-SHA-256' | 'SCRAM-SHA-512'; // OAUTHBEARER needs token settings v1 doesn't have
  schemaRegistry: string;
  registryAuth: boolean;
  port: number;
}

export const IMAGE = 'ghcr.io/paramvsi/kafka-inspector:1.0.0';

const sasl = (f: SelfHostForm) => f.security.startsWith('SASL');
// always double-quoted: YAML would turn yes/no/on/null/123 into booleans, null or numbers;
// `$` doubled so Compose doesn't interpolate it
const yamlStr = (s: string) => JSON.stringify(s).replace(/\$/g, '$$$$');

/** Rule 6: credentials typed into a URL never reach a generated file. Everything up to the last `@` is
 * userinfo, with or without a scheme: a pasted password may hold `@`, `/`, `?` or `#` unencoded, and a
 * registry URL has no `@` in its path. */
export const USERINFO = /^([a-z][a-z0-9+.-]*:\/\/)?[^\s]*@/i;
export const withoutUserinfo = (url: string) =>
  url.replace(USERINFO, (_, scheme?: string) => scheme ?? '');
/** A query string or fragment (e.g. ?api_key=…) can carry a token too: it's left out as well. */
const QUERY = /[?#].*$/;
const registryUrl = (url: string) => withoutUserinfo(url).replace(QUERY, '');

/** Non-secret settings, shared by compose and docker run. */
function envSettings(f: SelfHostForm): Array<[string, string]> {
  const out: Array<[string, string]> = [
    ['KI_CLUSTERS_0_NAME', f.name],
    ['KI_CLUSTERS_0_BOOTSTRAP', f.bootstrap],
    ['KI_CLUSTERS_0_SECURITY', f.security],
  ];
  if (sasl(f)) out.push(['KI_CLUSTERS_0_SASL_MECHANISM', f.mechanism]);
  if (f.schemaRegistry) out.push(['KI_CLUSTERS_0_SCHEMA_REGISTRY', registryUrl(f.schemaRegistry)]);
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
    '    logging:                 # capped: a restart loop or a warning every sample must not fill the disk',
    '      driver: json-file',
    '      options:',
    '        max-size: "10m"',
    '        max-file: "3"',
    '    read_only: true          # only /data is writable',
    '    security_opt:',
    '      - no-new-privileges:true',
    '    cap_drop:',
    '      - ALL',
    '    tmpfs:',
    '      - /tmp:exec          # snappy/zstd native libraries are unpacked here',
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
    "# With docker compose, wrap each value in single quotes (KEY='p@ss $word #1'): compose then reads",
    "# $, #, spaces and backslashes literally (a value can't contain ' itself). Unquoted or in double",
    '# quotes, compose reads $ as a variable and cuts an unquoted value at " #".',
    '# docker run --env-file keeps quotes as part of the value: there, write the value bare.',
    ...secretNames(f).map((n) => `${n}=`),
    '',
  ].join('\n');
}

export function dockerRun(f: SelfHostForm): string {
  return [
    `docker run -d --name kafka-inspector --restart unless-stopped -p ${f.port}:8080 \\`,
    '  --log-opt max-size=10m --log-opt max-file=3 \\',
    '  --read-only --tmpfs /tmp:exec --security-opt no-new-privileges --cap-drop ALL \\',
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
  if (!f.name.trim())
    w.push('Give the cluster a name: it labels the cluster in the app and in its URLs.');
  if (QUERY.test(withoutUserinfo(f.schemaRegistry)))
    w.push(
      'The Schema Registry URL had a query string or fragment, which can carry a token; it was left out of the files. Use registry authentication and put the values in .env.',
    );
  if (USERINFO.test(f.schemaRegistry))
    w.push(
      'The Schema Registry URL contained a username or password; it was left out of the files. Turn on registry authentication and put the values in .env.',
    );
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
    note: 'Enable SASL on the service; port is shown in the console. A custom CA: mount the truststore file into the container, then set KI_CLUSTERS_0_SSL_TRUSTSTORE_LOCATION to its path inside and KI_CLUSTERS_0_SSL_TRUSTSTORE_PASSWORD. Not verified against Aiven.',
  },
};
