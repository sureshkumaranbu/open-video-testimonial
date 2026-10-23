import { cookies } from "next/headers";
import Link from "next/link";
import { LINK_COOKIE, LINK_PROBLEMS, peekLoginToken } from "@/lib/login-links";
import { ConfirmLink } from "./ConfirmLink";

export const metadata = { title: "Sign in" };

/**
 * Where emailed links land. Opening it changes nothing (mail scanners open
 * links too); the button signs in.
 */
export default async function LinkPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const token = (await searchParams).token;
  const raw = typeof token === "string" ? token : "";
  const result = peekLoginToken(raw, (await cookies()).get(LINK_COOKIE)?.value);
  return (
    <div className="signin">
      <section className="signin-art" aria-hidden>
        <Link href="/" className="brand" tabIndex={-1}>
          <span className="brand-dot" />
          Plaudit
        </Link>
        <blockquote>The best line on your homepage is one you didn&apos;t write.</blockquote>
        <span className="rec-pill">Team sign-in</span>
      </section>
      <main className="signin-main">
        <div className="signin-form">
          {"problem" in result ? (
            <>
              <h1 style={{ fontSize: "var(--text-2xl)" }}>This link can&apos;t be used</h1>
              <p className="error" role="alert">
                {LINK_PROBLEMS[result.problem!]}
              </p>
              <Link className="button lg block" href="/admin/login">
                Go to sign-in
              </Link>
            </>
          ) : (
            <>
              <div className="stack" style={{ gap: "var(--space-2)" }}>
                <h1 style={{ fontSize: "var(--text-2xl)" }}>{result.purpose === "invite" ? "Accept your invitation" : "Sign in to Plaudit"}</h1>
                <p className="muted">
                  as <strong>{result.email}</strong>
                </p>
              </div>
              <ConfirmLink token={raw} label={result.purpose === "invite" ? "Accept and sign in" : "Sign in"} />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
