import type { Metadata } from 'next';
import Link from 'next/link';
import { Reveal } from '../components/landing/Reveal';

export const metadata: Metadata = {
  title: { absolute: 'Kafka Inspector · A real-time UI for Apache Kafka' },
  description:
    'Lag history, catch-up forecasts, alerts and a live topology map for Apache Kafka. Try it in your browser on a simulated cluster, or run it read-only on your own Kafka with one Docker image.',
  openGraph: {
    title: 'Kafka Inspector',
    description: 'See what your Kafka is doing, and what it’s about to do.',
    images: ['/shots/og.png'],
    type: 'website',
  },
  twitter: { card: 'summary_large_image', images: ['/shots/og.png'] },
};

const GITHUB = 'https://github.com/paramvsi/kafka-inspector';

const Section = ({
  id,
  kicker,
  title,
  children,
  tint,
}: {
  id?: string;
  kicker: string;
  title: React.ReactNode;
  children: React.ReactNode;
  tint?: boolean;
}) => (
  <section id={id} className={`border-t border-line ${tint ? 'bg-bg-sidebar' : ''}`}>
    <Reveal className="mx-auto max-w-[1200px] px-6 py-24">
      <p className="m-0 text-[12px] font-medium uppercase tracking-[0.06em] text-copper">
        {kicker}
      </p>
      <h2 className="m-0 mt-3 max-w-[640px] text-[36px] font-semibold leading-[44px] tracking-[-0.01em]">
        {title}
      </h2>
      <div className="mt-10">{children}</div>
    </Reveal>
  </section>
);

const Badge = ({ tone, children }: { tone: 'ok' | 'warn' | 'crit'; children: React.ReactNode }) => (
  <span
    className={`inline-flex h-[22px] items-center gap-[6px] rounded-sm px-2 text-[12px] font-medium ${tone === 'ok' ? 'bg-ok-soft text-ok-text' : tone === 'warn' ? 'bg-warn-soft text-warn-text' : 'bg-crit-soft text-crit-text'}`}
  >
    <span aria-hidden="true" className="size-[6px] rounded-full bg-current" />
    {children}
  </span>
);

const FEATURES: Array<[string, string]> = [
  ['Multi-cluster', 'Switch between clusters from the sidebar.'],
  ['Schema diff', 'Compare versions and see compatibility per field.'],
  [
    'Offset reset with dry run',
    'Preview exactly what moves before you apply it (demo; real clusters are read-only in v1).',
  ],
  ['Health checks', 'Replication factor 1, skew, silent topics, with fixes.'],
  ['Data masking', 'Hide emails and card numbers in the browser.'],
  ['Kafka 4 ready', 'KRaft clusters and share groups (KIP-932).'],
  ['Keyboard first', '⌘K to jump to any topic, group or action.'],
  ['Dark and light', 'Accessible contrast in both themes.'],
];

const COMPARE: Array<[string, string, string]> = [
  ['Browse topics, messages, consumer groups', 'Yes', 'Yes'],
  ['Consumer lag', 'Current value only', 'History, health status and catch-up forecast'],
  [
    'Alerts',
    'Bring your own (Prometheus, Burrow)',
    'Built in: lag, stalled groups, silent topics, under-replicated partitions',
  ],
  ['Topology', 'Not shown', 'Live producer → topic → group map'],
  [
    'Try without a cluster',
    'Needs a running Kafka',
    'Simulated cluster in the browser, with a chaos panel',
  ],
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded-md focus:bg-surface focus:p-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
        <nav
          aria-label="Site"
          className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-6 text-[13px]"
        >
          <Link href="/" className="flex items-center gap-2 font-semibold text-ink no-underline">
            <img
              src="/brand/kafka-inspector-icon-dark.png"
              alt=""
              width={24}
              height={24}
              className="light:hidden"
            />
            <img
              src="/brand/kafka-inspector-icon-light.png"
              alt=""
              width={24}
              height={24}
              className="hidden light:block"
            />
            Kafka Inspector
          </Link>
          <a
            href="#features"
            className="hidden text-ink-muted no-underline hover:text-ink sm:inline"
          >
            Features
          </a>
          <a href="#how" className="hidden text-ink-muted no-underline hover:text-ink sm:inline">
            How it works
          </a>
          <a
            href="#self-host"
            className="hidden text-ink-muted no-underline hover:text-ink sm:inline"
          >
            Self-host
          </a>
          <a
            href={`${GITHUB}#readme`}
            className="hidden text-ink-muted no-underline hover:text-ink sm:inline"
          >
            Docs
          </a>
          <span className="grow" />
          <a href={GITHUB} className="text-ink-muted no-underline hover:text-ink">
            GitHub
          </a>
          <Link
            href="/app/"
            className="inline-flex h-control-md items-center rounded-md bg-copper px-4 font-semibold text-copper-on no-underline hover:bg-copper-strong"
          >
            Open live demo
          </Link>
        </nav>
      </header>

      <main id="main">
        <section className="mx-auto max-w-[1200px] px-6 pb-24 pt-20 text-center">
          <p
            className="ki-hero m-0 inline-block rounded-sm bg-surface-hover px-2 py-1 font-mono text-[11px] text-ink-muted"
            style={{ animationDelay: '0s' }}
          >
            Free and open source · Apache 2.0
          </p>
          <h1
            className="ki-hero m-0 mx-auto mt-6 max-w-[820px] text-[56px] font-semibold leading-[64px] tracking-[-0.02em] max-sm:text-[38px] max-sm:leading-[46px]"
            style={{ animationDelay: 'calc(var(--dur-slow) * 0.19)' }}
          >
            See what your Kafka is doing, and what it&apos;s about to do.
          </h1>
          <p
            className="ki-hero m-0 mx-auto mt-6 max-w-[640px] text-[17px] leading-7 text-ink-muted"
            style={{ animationDelay: 'calc(var(--dur-slow) * 0.38)' }}
          >
            A fast UI for Apache Kafka with lag history, catch-up forecasts, alerts and a live
            topology map. Try it in your browser on a simulated cluster, or run it on your own Kafka
            in one Docker container.
          </p>
          <div
            className="ki-hero mt-8 flex flex-wrap justify-center gap-3"
            style={{ animationDelay: 'calc(var(--dur-slow) * 0.56)' }}
          >
            <Link
              href="/app/"
              className="inline-flex h-control-lg items-center rounded-md bg-copper px-5 text-[15px] font-semibold text-copper-on no-underline hover:bg-copper-strong"
            >
              Open live demo
            </Link>
            <Link
              href="/app/self-host/"
              className="inline-flex h-control-lg items-center rounded-md border border-line bg-surface px-5 text-[15px] font-semibold text-ink no-underline hover:bg-surface-hover"
            >
              Run on your own Kafka
            </Link>
          </div>
          <p
            className="ki-hero m-0 mt-5 font-mono text-[11px] text-ink-muted"
            style={{ animationDelay: 'calc(var(--dur-slow) * 0.75)' }}
          >
            No sign-up · nothing to install for the demo · read-only on real clusters
          </p>
          <div className="ki-shot mx-auto mt-14 max-w-[1100px] overflow-hidden rounded-lg border border-line [box-shadow:var(--shadow-popover)]">
            <img
              src="/shots/overview-dark.png"
              alt="The Kafka Inspector overview on the simulated cluster: throughput chart, needs attention list with fraud-scorer stalled, and consumer groups with lag status."
              width={1280}
              height={800}
              className="block h-auto w-full light:hidden"
            />
            <img
              src="/shots/overview-light.png"
              alt="The Kafka Inspector overview in the light theme."
              width={1280}
              height={800}
              className="hidden h-auto w-full light:block"
              loading="lazy"
            />
          </div>
        </section>

        <Section
          id="features"
          kicker="What it does"
          title="Answers the three questions you open a Kafka UI for."
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <article className="rounded-lg border border-line bg-surface p-6">
              <p className="m-0 font-mono text-[12px] text-copper">
                01 · Is anything falling behind?
              </p>
              <h3 className="m-0 mt-3 text-[18px] font-semibold">Lag you can read at a glance</h3>
              <p className="m-0 mt-3 text-[14px] leading-6 text-ink-muted">
                Every consumer group gets a health status (Healthy, Warn, Stalled, Stopped) and a
                forecast like “catches up in ~14 min” or “won’t catch up at current rates”.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge tone="ok">Healthy</Badge>
                <Badge tone="warn">Warn</Badge>
                <Badge tone="crit">Stalled</Badge>
              </div>
            </article>
            <article className="rounded-lg border border-line bg-surface p-6">
              <p className="m-0 font-mono text-[12px] text-copper">
                02 · What&apos;s in this topic?
              </p>
              <h3 className="m-0 mt-3 text-[18px] font-semibold">Find any message, decoded</h3>
              <p className="m-0 mt-3 text-[14px] leading-6 text-ink-muted">
                Live tail, JavaScript filters, search across topics, and automatic decoding of JSON,
                Avro and JSON Schema through your Schema Registry. Bad messages show their raw bytes
                instead of disappearing.
              </p>
              <pre className="m-0 mt-4 whitespace-pre-wrap rounded-md bg-surface-sunken p-3 font-mono text-[12px] text-ink-muted">
                value.total &gt; 500 &amp;&amp; headers.region === &apos;eu&apos;
              </pre>
            </article>
            <article className="rounded-lg border border-line bg-surface p-6">
              <p className="m-0 font-mono text-[12px] text-copper">03 · How does data flow?</p>
              <h3 className="m-0 mt-3 text-[18px] font-semibold">The whole pipeline on one map</h3>
              <p className="m-0 mt-3 text-[14px] leading-6 text-ink-muted">
                Producers, topics and consumer groups drawn as a live graph. Line width is
                throughput; colour is health. A stalled consumer turns red before your users notice.
              </p>
              <div
                className="mt-4 flex flex-wrap items-center gap-1 font-mono text-[11px]"
                aria-label="web-checkout produces to orders, which payments-sink consumes"
              >
                <span className="rounded-sm border border-line px-2 py-1 text-ink-muted">
                  web-checkout
                </span>
                <span aria-hidden="true" className="ki-chip-flow h-[2px] w-6" />
                <span className="rounded-sm border border-copper px-2 py-1">orders</span>
                <span aria-hidden="true" className="ki-chip-flow h-[2px] w-6" />
                <span className="rounded-sm border border-warn px-2 py-1 text-warn-text">
                  payments-sink
                </span>
              </div>
            </article>
          </div>
        </Section>

        <Section
          id="how"
          tint
          kicker="Why another Kafka UI"
          title="Most free Kafka UIs show you right now. This one remembers."
        >
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full border-collapse text-left text-[14px]">
              <caption className="sr-only">
                Kafka Inspector compared with typical free Kafka UIs
              </caption>
              <thead>
                <tr className="bg-surface-sunken text-[12px] text-ink-muted">
                  <th scope="col" className="px-4 py-3 font-normal">
                    Capability
                  </th>
                  <th scope="col" className="px-4 py-3 font-normal">
                    Typical free Kafka UIs
                  </th>
                  <th scope="col" className="px-4 py-3 font-normal">
                    Kafka Inspector
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map(([a, b, c]) => (
                  <tr key={a} className="border-t border-line-subtle">
                    <th scope="row" className="px-4 py-3 font-normal">
                      {a}
                    </th>
                    <td className="px-4 py-3 text-ink-muted">{b}</td>
                    <td className="px-4 py-3">{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section
          id="self-host"
          kicker="Two ways to use it"
          title="Try it in your browser. Run it on your own cluster."
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <article className="flex flex-col rounded-lg border border-line bg-surface p-6">
              <span className="self-start rounded-sm bg-surface-hover px-2 py-1 text-[12px] text-ink-muted">
                In your browser
              </span>
              <h3 className="m-0 mt-4 text-[20px] font-semibold">
                Live demo on a simulated cluster
              </h3>
              <p className="m-0 mt-3 text-[14px] leading-6 text-ink-muted">
                A realistic cluster with 3 brokers, a dozen topics and live traffic runs inside your
                browser tab. Use the chaos panel to crash a consumer or spike traffic and watch
                every screen react.
              </p>
              <ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0 text-[14px]">
                {[
                  'Nothing to install, no account',
                  'Every feature works, including writes',
                  'Your data never leaves the tab',
                ].map((x) => (
                  <li key={x}>
                    <span aria-hidden="true" className="text-ok">
                      ✓{' '}
                    </span>
                    {x}
                  </li>
                ))}
              </ul>
              <div className="grow" />
              <Link
                href="/app/"
                className="mt-6 inline-flex h-control-md items-center self-start rounded-md bg-copper px-4 font-semibold text-copper-on no-underline hover:bg-copper-strong"
              >
                Open live demo
              </Link>
            </article>
            <article className="flex flex-col rounded-lg border border-copper bg-surface p-6">
              <span className="self-start rounded-sm bg-copper-soft px-2 py-1 text-[12px] text-copper-strong">
                On your server
              </span>
              <h3 className="m-0 mt-4 text-[20px] font-semibold">
                Self-host against your own Kafka
              </h3>
              <p className="m-0 mt-3 text-[14px] leading-6 text-ink-muted">
                One Docker container serves the app and talks to your brokers. Tested against Apache
                Kafka 4.1; presets for Amazon MSK, Confluent Cloud and Aiven are not verified yet.
                Read-only in version 1. The image isn&rsquo;t published yet: build it from the repo
                until the first release.
              </p>
              <pre
                tabIndex={0}
                className="m-0 mt-4 overflow-x-auto rounded-md bg-surface-sunken p-3 font-mono text-[12px] leading-5"
              >{`docker run -p 8080:8080 \\\n  -e KAFKA_BOOTSTRAP=broker:9092 \\\n  -e KI_ADMIN_PASSWORD=change-me \\\n  ghcr.io/paramvsi/kafka-inspector:1.0.0`}</pre>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/app/self-host/"
                  className="inline-flex h-control-md items-center rounded-md border border-line bg-surface px-4 font-semibold text-ink no-underline hover:bg-surface-hover"
                >
                  Generate docker-compose.yml
                </Link>
                <a
                  href={`${GITHUB}#self-hosting`}
                  className="inline-flex h-control-md items-center px-2 text-copper underline"
                >
                  Setup guide
                </a>
              </div>
              <p className="m-0 mt-4 text-[12px] text-ink-muted">
                Credentials stay on your server. The generated files contain variable names, never
                passwords.
              </p>
            </article>
          </div>
          <div className="mt-16 grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(([t, d]) => (
              <div key={t}>
                <h3 className="m-0 text-[15px] font-semibold">{t}</h3>
                <p className="m-0 mt-1 text-[14px] leading-6 text-ink-muted">{d}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section tint kicker="Who built this" title="Built by Paramveer Singh">
          <p className="m-0 max-w-[640px] text-[16px] leading-7 text-ink-muted">
            A senior full-stack engineer who builds real-time data platforms: React and Next.js on
            the front, Java, Spring Boot and Kafka behind it. Kafka Inspector is an independent
            open-source project.
          </p>
          <div className="mt-6 flex gap-3">
            <a
              href="https://github.com/paramvsi"
              className="inline-flex h-control-md items-center rounded-md border border-line bg-surface px-4 font-semibold text-ink no-underline hover:bg-surface-hover"
            >
              Portfolio
            </a>
            <a
              href={GITHUB}
              className="inline-flex h-control-md items-center rounded-md border border-line bg-surface px-4 font-semibold text-ink no-underline hover:bg-surface-hover"
            >
              Star on GitHub
            </a>
          </div>
        </Section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-start gap-6 px-6 py-10 text-[12px] text-ink-muted">
          <div className="max-w-[640px]">
            <div className="font-semibold text-ink">Kafka Inspector</div>
            <p className="m-0 mt-2">
              Apache Kafka and Kafka are trademarks of the Apache Software Foundation. Kafka
              Inspector is not affiliated with or endorsed by the ASF. Released under the Apache
              License 2.0.
            </p>
          </div>
          <span className="grow" />
          <a href={`${GITHUB}#readme`} className="text-ink-muted underline">
            Docs
          </a>
          <a href={GITHUB} className="text-ink-muted underline">
            GitHub
          </a>
          <a href={`${GITHUB}/releases`} className="text-ink-muted underline">
            Changelog
          </a>
        </div>
      </footer>
    </div>
  );
}
