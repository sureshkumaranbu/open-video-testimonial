import Link from "next/link";
import { Icon } from "@/components/Icon";

const REPO = "https://github.com/sureshkumaranbu/open-video-testimonial";

// Bar heights for the decorative voice waveform in the hero.
const WAVE = [8, 14, 22, 12, 26, 18, 10, 20, 28, 16, 9, 18, 24, 12, 7, 15, 22, 11, 6, 13];

export default function Home() {
  return (
    <>
      <header className="container site-nav">
        <Link href="/" className="brand">
          <span className="brand-dot" aria-hidden />
          Plaudit
        </Link>
        <nav className="row" aria-label="Main">
          <a className="button ghost small" href={REPO}>
            <Icon name="github" />
            Source
          </a>
          <Link className="button small" href="/admin">
            Open dashboard
          </Link>
        </nav>
      </header>

      <main className="container" style={{ paddingTop: 0 }}>
        <section className="hero">
          <div>
            <h1>Let your customers say it for you.</h1>
            <p className="lede">
              Send one link. Customers record a short video or write a few lines. You approve the
              best and drop them onto your site with a single snippet.
            </p>
            <div className="row actions">
              <Link className="button lg" href="/admin">
                Open dashboard
              </Link>
              <a className="button secondary lg" href={REPO}>
                <Icon name="github" />
                View on GitHub
              </a>
            </div>
          </div>

          <figure className="stage" aria-label="Example of a recorded testimonial" style={{ margin: 0 }}>
            <span className="stage-frame" aria-hidden />
            <span className="rec-pill live">REC 00:24</span>
            <blockquote>Your customer&apos;s words land here, in their own voice.</blockquote>
            <figcaption className="caption">
              <span className="wave" aria-hidden>
                {WAVE.map((h, i) => (
                  <i key={i} style={{ height: h }} />
                ))}
              </span>
              Recorded in the browser. No app to install.
            </figcaption>
          </figure>
        </section>

        <ol className="steps" style={{ margin: 0, padding: 0 }} aria-label="How it works">
          <li>
            <span className="step-n">1</span>
            <h3>Ask</h3>
            <p className="muted">
              Share your collection link after a purchase, a call or a launch. It works on any phone.
            </p>
          </li>
          <li>
            <span className="step-n">2</span>
            <h3>Approve</h3>
            <p className="muted">
              New testimonials wait for you. Approve, tag or tidy up a name before anything goes live.
            </p>
          </li>
          <li>
            <span className="step-n">3</span>
            <h3>Show</h3>
            <p className="muted">
              Paste one snippet into your site, or link to your wall of love. Light and dark themes
              included.
            </p>
          </li>
        </ol>

        <section className="promise">
          <h2 style={{ fontSize: "var(--text-2xl)", maxWidth: "16ch" }}>Free, open source, and yours to run.</h2>
          <ul>
            <li>
              <Icon name="infinity" />
              <div>
                <strong>No limits</strong>
                <p className="muted">Collect as many testimonials as you like. Nothing is hidden behind a plan.</p>
              </div>
            </li>
            <li>
              <Icon name="eyeOff" />
              <div>
                <strong>No tracking</strong>
                <p className="muted">
                  Widgets load your testimonials and nothing else. No analytics beacons, no visitor IDs.
                </p>
              </div>
            </li>
            <li>
              <Icon name="server" />
              <div>
                <strong>Your server</strong>
                <p className="muted">
                  One Docker container with SQLite. Your videos and your customers&apos; details never
                  leave it.
                </p>
              </div>
            </li>
          </ul>
        </section>
      </main>

      <footer className="container site-foot row spread">
        <span>Plaudit is MIT licensed.</span>
        <a href={REPO}>Contribute on GitHub</a>
      </footer>
    </>
  );
}
