import Link from "next/link";

export default function Home() {
  return (
    <main className="container narrow stack">
      <h1>Plaudit</h1>
      <p className="muted">
        Collect video and text testimonials from your customers, approve the best ones, and show
        them on your site with a single embed snippet. Open source and self-hosted.
      </p>
      <div className="row">
        <Link className="button" href="/admin">
          Open dashboard
        </Link>
        <a className="button secondary" href="https://github.com/sureshkumaranbu/open-video-testimonial">
          Source code
        </a>
      </div>
    </main>
  );
}
