import Link from "next/link";
import { Fragment } from "react";
import { Icon } from "@/components/Icon";
import { Stars } from "@/components/TestimonialCard";
import { Face } from "./_home/Face";
import { HeroDemo } from "./_home/HeroDemo";
import { HomeMotion, MOTION_BOOT } from "./_home/HomeMotion";
import { SampleVideo } from "./_home/SampleVideo";
import {
  byId,
  CREDITS_URL,
  PEOPLE,
  SAMPLE_DISCLAIMER,
  SAMPLE_QUOTES,
  type SamplePerson,
  type SampleVideoTestimonial,
} from "./_home/samples";
import { StickySteps } from "./_home/StickySteps";
import { WidgetShowcase } from "./_home/WidgetShowcase";
import "./home.css";

const REPO = "https://github.com/sureshkumaranbu/open-video-testimonial";

const HEADLINE = "Let your customers say it for you.";

const PLATFORMS = ["WordPress", "Webflow", "Framer", "Shopify", "Ghost", "Squarespace", "Wix", "Next.js", "Plain HTML"];

// Fictional quotes paired with stock faces, always shown with a visible
// "Sample" label and caption (see samples.ts).
const VOICES = SAMPLE_QUOTES;

// The wall near the top: video cards with short text cards between them,
// in three columns that collapse on small screens.
type WallItem = { video: SampleVideoTestimonial } | { person: SamplePerson; rating: number; text: string };
const WALL: WallItem[][] = [
  [
    { video: byId("maya") },
    { person: PEOPLE.theo, rating: 5, text: "Clients see real faces before they book a call. That changed everything." },
  ],
  [
    { person: PEOPLE.ken, rating: 5, text: "Our first video testimonial was live twenty minutes after install." },
    { video: byId("daniel") },
    { person: PEOPLE.leila, rating: 4, text: "Two of my students recorded straight from their phones the same evening." },
  ],
  [
    { video: byId("grace") },
    { person: PEOPLE.jordan, rating: 5, text: "Short, honest clips from members do more than any ad I've run." },
  ],
];

const FEATURES = [
  {
    key: "record",
    title: "Record in the browser",
    body: "Camera, mic, preview, re-take. Or upload a file. Works on phones and laptops.",
    size: "wide",
  },
  { key: "queue", title: "A real moderation queue", body: "Approve, reject, rename and tag before anything goes live." },
  { key: "wall", title: "Wall of love", body: "A shareable page of your approved testimonials." },
  { key: "embed", title: "Embed anywhere", body: "Script or iframe. Light, dark or follow the visitor." },
  { key: "track", title: "No tracking", body: "Widgets fetch your testimonials. Nothing else, nobody else." },
  { key: "docker", title: "Self-hosted with Docker", body: "One container, one volume, SQLite inside.", size: "wide" },
  { key: "unlimited", title: "Unlimited testimonials", body: "No caps, and nothing hidden behind a plan." },
] as const;

const COMPARE = [
  ["Testimonials you can collect", "Unlimited", "Often capped on free plans"],
  ["Remove vendor branding", "Always, it's your app", "Usually a paid tier"],
  ["Where videos and emails live", "Your server", "The vendor's cloud"],
  ["Visitor tracking in widgets", "None", "Often includes analytics beacons"],
  ["Source code", "MIT licensed", "Closed"],
  ["Price", "Free (you pay for hosting)", "Monthly subscription"],
  ["Server to maintain", "Yes, one container", "No, it's hosted for you"],
] as const;

const FAQ = [
  {
    q: "Is it really free?",
    a: "Yes. Plaudit is MIT licensed. You can run it, change it and ship it with your product. Your only cost is the server you run it on.",
  },
  {
    q: "What do I need to run it?",
    a: "Docker, or Node.js 22. `docker compose up` starts the app with SQLite and stores everything in a single volume you can back up.",
  },
  {
    q: "Where are videos stored?",
    a: "On your server's disk, inside the data volume. An S3-compatible storage option is on the roadmap.",
  },
  {
    q: "Does the widget track my visitors?",
    a: "No. The widget asks your Plaudit server for approved testimonials and renders them. There are no analytics beacons or visitor IDs.",
  },
  {
    q: "Will the widget clash with my site's styles?",
    a: "No. The script widget renders inside a Shadow DOM, so your CSS can't break it and its CSS can't leak out. Prefer an iframe? That's included too.",
  },
  {
    q: "Can customers record on their phone?",
    a: "Yes. Modern mobile browsers can record directly on the collection page, and anyone can upload a video file instead.",
  },
] as const;

function Wave({ live }: { live?: boolean }) {
  return (
    <span className={live ? "wave live" : "wave"} aria-hidden>
      {[8, 16, 24, 12, 20, 28, 14, 22, 10, 18].map((h, i) => (
        <i key={i} style={{ height: h, animationDelay: `${i * 70}ms` }} />
      ))}
    </span>
  );
}

function Author({ person }: { person: SamplePerson }) {
  return (
    <div className="sample-author">
      <Face person={person} />
      <span>
        <strong>{person.name}</strong>
        <span>
          {person.role}, {person.company}
        </span>
      </span>
    </div>
  );
}

function VideoCard({ v, d }: { v: SampleVideoTestimonial; d: number }) {
  return (
    <article className="video-card" data-sample-card data-reveal style={{ ["--d" as string]: d }}>
      <SampleVideo sample={v} label={`sample video testimonial from ${v.name} (fictional)`} />
      <div className="video-card-body">
        <div className="row spread">
          <Stars rating={v.rating} />
          <span className="voice-tag">Sample</span>
        </div>
        <p className="quote">{v.quote}</p>
        <Author person={v} />
      </div>
    </article>
  );
}

function FeatureArt({ k }: { k: (typeof FEATURES)[number]["key"] }) {
  switch (k) {
    case "record":
      return (
        <div className="art art-record">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="art-poster" src={byId("maya").poster} alt="" width={960} height={600} loading="lazy" decoding="async" />
          <span className="rec-pill live">REC 00:18</span>
          <Wave live />
        </div>
      );
    case "queue":
      return (
        <div className="art art-queue">
          {(
            [
              [PEOPLE.grace, "approved"],
              [PEOPLE.ken, "pending"],
              [PEOPLE.jordan, "rejected"],
            ] as const
          ).map(([p, s], i) => (
            <span key={s} className="art-row" style={{ ["--i" as string]: i }}>
              <Face person={p} size={22} />
              <i />
              <span className={`demo-badge ${s}`}>{s[0].toUpperCase() + s.slice(1)}</span>
            </span>
          ))}
        </div>
      );
    case "wall":
      return (
        <div className="art art-wall">
          {[PEOPLE.maya, PEOPLE.daniel, PEOPLE.grace, PEOPLE.theo, PEOPLE.leila, PEOPLE.ken].map((p, i) => (
            <span key={p.id} style={{ ["--i" as string]: i }}>
              <Face person={p} size={44} />
            </span>
          ))}
        </div>
      );
    case "embed":
      return (
        <div className="art art-embed">
          <span className="sw light" />
          <span className="sw dark" />
        </div>
      );
    case "docker":
      return (
        <div className="art art-docker">
          <code style={{ ["--i" as string]: 0 }}>$ docker compose up -d</code>
          <code style={{ ["--i" as string]: 1 }}>✔ plaudit  Healthy</code>
          <code style={{ ["--i" as string]: 2 }}>→ http://localhost:3000</code>
        </div>
      );
    case "track":
      return (
        <div className="art art-icon">
          <Icon name="eyeOff" />
        </div>
      );
    case "unlimited":
      return (
        <div className="art art-icon">
          <Icon name="infinity" />
        </div>
      );
  }
}

export default function Home() {
  const words = HEADLINE.split(" ");
  return (
    <div className="home" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: MOTION_BOOT }} />
      <HomeMotion />

      <div className="scroll-progress" aria-hidden />
      <header className="home-nav" data-testid="home-nav">
        <div className="home-nav-inner">
          <Link href="/" className="brand">
            <span className="brand-dot" aria-hidden />
            Plaudit
          </Link>
          <nav aria-label="Main" className="home-nav-links">
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#compare">Compare</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="row home-nav-actions">
            <a className="button ghost small" href={REPO}>
              <Icon name="github" />
              <span className="hide-sm">Source</span>
            </a>
            <Link className="button small" href="/admin">
              Open dashboard
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="home-hero container" data-testid="section-hero">
          <div className="home-hero-copy">
            <span className="eyebrow">
              <span className="brand-dot" aria-hidden />
              Free · Open source · Self-hosted
            </span>
            <h1 aria-label={HEADLINE}>
              {words.map((w, i) => (
                <Fragment key={i}>
                  <span className="word" aria-hidden style={{ ["--i" as string]: i }}>
                    {w}
                  </span>
                  {i < words.length - 1 ? " " : null}
                </Fragment>
              ))}
            </h1>
            <p className="lede">
              Send one link. Customers record a short video or write a few lines. You approve the best and
              drop them onto your site with a single snippet.
            </p>
            <div className="row actions">
              <Link className="button lg" href="/admin">
                Start collecting
                <Icon name="arrowRight" />
              </Link>
              <a className="button secondary lg" href={REPO}>
                <Icon name="github" />
                View on GitHub
              </a>
            </div>
            <ul className="hero-points">
              <li>
                <Icon name="check" /> MIT licensed
              </li>
              <li>
                <Icon name="check" /> One Docker container
              </li>
              <li>
                <Icon name="check" /> No visitor tracking
              </li>
            </ul>
          </div>

          <div className="home-hero-demo">
            <div className="float-chip chip-stars" data-parallax="0.06" aria-hidden>
              <span className="bob">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Icon key={n} name="star" />
                ))}
              </span>
            </div>
            <div className="float-chip chip-approved" data-parallax="0.11" aria-hidden>
              <span className="bob">
                <Icon name="check" /> Approved
              </span>
            </div>
            <HeroDemo />
            <p className="demo-note">Illustrative demo. Stock footage; the name and quote are fictional.</p>
          </div>
        </section>

        <section
          id="videos"
          className="container section video-wall"
          data-testid="section-videos"
          aria-labelledby="videos-title"
        >
          <div className="section-head" data-reveal>
            <span className="kicker">Video testimonials</span>
            <h2 id="videos-title">Faces and voices, not just five stars.</h2>
            <p className="muted">
              Customers record a short clip from their phone or laptop. You get a wall like this for your site.
            </p>
          </div>
          <div className="wall-mosaic">
            {WALL.map((col, c) => (
              <div key={c} className="wall-col">
                {col.map((item, i) =>
                  "video" in item ? (
                    <VideoCard key={item.video.id} v={item.video} d={c + i} />
                  ) : (
                    <article
                      key={item.person.id}
                      className="wall-quote"
                      data-sample-card
                      data-reveal
                      style={{ ["--d" as string]: c + i }}
                    >
                      <div className="row spread">
                        <Stars rating={item.rating} />
                        <span className="voice-tag">Sample</span>
                      </div>
                      <p className="quote">{item.text}</p>
                      <Author person={item.person} />
                    </article>
                  ),
                )}
              </div>
            ))}
          </div>
          <p className="voices-caption muted xsmall" data-testid="video-sample-caption">
            {SAMPLE_DISCLAIMER} <a href={CREDITS_URL}>Credits</a>
          </p>
        </section>

        <section className="band platforms" data-testid="section-platforms" aria-labelledby="platforms-title">
          <p id="platforms-title" className="band-title" data-reveal>
            Works wherever you can paste HTML
          </p>
          <div className="marquee" data-testid="platform-marquee">
            <div className="marquee-track">
              {[0, 1].map((copy) => (
                <ul key={copy} className="marquee-set" aria-hidden={copy === 1 ? true : undefined}>
                  {PLATFORMS.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ))}
            </div>
          </div>
        </section>

        <section className="voices" data-testid="section-voices" aria-labelledby="voices-title">
          <div className="container section-head" data-reveal>
            <span className="kicker">Social proof, on autopilot</span>
            <h2 id="voices-title">Real voices sell better than any headline.</h2>
            <p className="muted">
              Your best quotes, scrolling quietly across your page. Hover or focus to pause.
            </p>
          </div>
          {[VOICES.slice(0, 4), VOICES.slice(4)].map((row, r) => (
            <div
              key={r}
              className={`marquee voices-row${r === 1 ? " reverse" : ""}`}
              tabIndex={0}
              aria-label={`Sample testimonials, row ${r + 1}`}
              data-testid="voices-marquee"
            >
              <div className="marquee-track">
                {[0, 1].map((copy) => (
                  <ul key={copy} className="marquee-set" aria-hidden={copy === 1 ? true : undefined}>
                    {row.map((v) => (
                      <li key={v.id} className="voice" data-sample-card={copy === 0 ? "" : undefined}>
                        <span className="voice-tag">Sample</span>
                        <p className="quote">{v.text}</p>
                        <Author person={v} />
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
            </div>
          ))}
          <p className="container voices-caption muted xsmall" data-testid="sample-caption">
            {SAMPLE_DISCLAIMER}
          </p>
        </section>

        <section id="how" className="container section" data-testid="section-how" aria-labelledby="how-title">
          <div className="section-head" data-reveal>
            <span className="kicker">How it works</span>
            <h2 id="how-title">Ask. Approve. Show.</h2>
          </div>
          <StickySteps />
        </section>

        <section id="features" className="container section" data-testid="section-features" aria-labelledby="features-title">
          <div className="section-head" data-reveal>
            <span className="kicker">Everything you need, nothing you don&apos;t</span>
            <h2 id="features-title">Built for the whole loop.</h2>
          </div>
          <div className="bento">
            {FEATURES.map((f, i) => (
              <article
                key={f.key}
                className={`bento-tile tile-${f.key}${"size" in f ? ` ${f.size}` : ""}`}
                data-reveal
                style={{ ["--d" as string]: i % 3 }}
              >
                <FeatureArt k={f.key} />
                <h3>{f.title}</h3>
                <p className="muted">{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section
          id="showcase"
          className="container section"
          data-testid="section-showcase"
          aria-labelledby="showcase-title"
        >
          <div className="section-head" data-reveal>
            <span className="kicker">The widget</span>
            <h2 id="showcase-title">This is what your visitors see.</h2>
            <p className="muted">The same card that ships in the embed. Flip the theme and layout.</p>
          </div>
          <div data-reveal>
            <WidgetShowcase />
          </div>
        </section>

        <section id="compare" className="container section" data-testid="section-compare" aria-labelledby="compare-title">
          <div className="section-head" data-reveal>
            <span className="kicker">An honest comparison</span>
            <h2 id="compare-title">Free vs typical paid testimonial tools.</h2>
            <p className="muted">Hosted tools are convenient. Here&apos;s the trade-off.</p>
          </div>
          <div className="compare-wrap" data-reveal>
            <table className="compare">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="visually-hidden">Feature</span>
                  </th>
                  <th scope="col" className="ours">
                    Plaudit
                  </th>
                  <th scope="col">Typical paid tools</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map(([label, ours, theirs]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td className="ours">{ours}</td>
                    <td>{theirs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="faq" className="container section faq-section" data-testid="section-faq" aria-labelledby="faq-title">
          <div className="section-head" data-reveal>
            <span className="kicker">FAQ</span>
            <h2 id="faq-title">Questions, answered.</h2>
          </div>
          <div className="faq" data-reveal>
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>
                  {f.q}
                  <Icon name="plus" />
                </summary>
                <div className="faq-body">
                  <p className="muted">{f.a}</p>
                </div>
              </details>
            ))}
          </div>
        </section>

        <section className="cta-band" data-testid="section-cta" aria-labelledby="cta-title">
          <div className="container cta-inner" data-reveal>
            <span className="rec-pill live">REC</span>
            <h2 id="cta-title">Your happiest customers are one link away.</h2>
            <p>Spin it up in minutes. Keep it forever.</p>
            <div className="row actions">
              <Link className="button lg light" href="/admin">
                Open dashboard
                <Icon name="arrowRight" />
              </Link>
              <a className="button lg outline-light" href={REPO}>
                <Icon name="github" />
                Star on GitHub
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="container site-foot home-foot" data-testid="section-footer">
        <div className="row spread">
          <Link href="/" className="brand">
            <span className="brand-dot" aria-hidden />
            Plaudit
          </Link>
          <nav className="row" aria-label="Footer">
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#faq">FAQ</a>
            <a href={REPO}>GitHub</a>
          </nav>
        </div>
        <p>Free and open source under the MIT licence. Self-hosted, no tracking.</p>
      </footer>
    </div>
  );
}
