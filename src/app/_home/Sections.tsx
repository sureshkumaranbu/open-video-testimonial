import { ArrowRightIcon, CheckIcon, MinusIcon } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { GitHubMark, Rich, Wordmark } from "./bits";
import { COMPARE, DASHBOARD, FAQ, NAV, QUICK_START, REPO, SETUP } from "./content";
import { CopyButton } from "./CopyButton";
import { ModePicker } from "./Header";
import { CREDITS_URL } from "./samples";

const H2 = "font-display text-[clamp(2.25rem,1.6rem+2.6vw,3.5rem)] leading-[1] font-extrabold tracking-display text-balance";

export function SelfHost() {
  return (
    <section id="self-host" data-testid="section-selfhost" aria-labelledby="selfhost-title" className="px-3 sm:px-5">
      <div className="mx-auto grid max-w-[82.5rem] gap-10 rounded-2xl bg-foreground px-5 py-14 text-background sm:px-10 md:py-20 lg:grid-cols-2 lg:items-center lg:gap-16 lg:px-16">
        <div>
          <h2 id="selfhost-title" className={H2}>
            Your server. Your data.
          </h2>
          <p className="mt-5 max-w-[48ch] text-lg opacity-85">
            One container and one volume, with SQLite inside. Videos and emails stay on your own disk, or in any
            S3-compatible bucket you choose.
          </p>
          <ul className="mt-7 grid gap-3">
            {["MIT licensed: run it, change it, ship it", "Docker, or Node.js 22", "Database changes apply themselves at start-up"].map((t) => (
              <li key={t} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                  <CheckIcon aria-hidden className="size-3.5" strokeWidth={3} />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0">
          <div className="overflow-hidden rounded-xl bg-background text-foreground shadow-lift" data-testid="setup-box">
            <div className="flex items-center justify-between gap-3 border-b border-border py-2 pr-2 pl-5">
              <span className="text-sm font-semibold">Quick start</span>
              <CopyButton text={SETUP.join("\n")} label="Copy commands" testId="copy-setup" />
            </div>
            <pre tabIndex={0} role="region" aria-label="Quick start commands" className="overflow-x-auto p-5 font-mono text-[0.8125rem] leading-[1.9] focus-visible:-outline-offset-3">
              {SETUP.map((line) => (
                <span key={line} className="block whitespace-pre">
                  <span className="text-muted-foreground select-none" aria-hidden>
                    ${" "}
                  </span>
                  {line}
                </span>
              ))}
            </pre>
          </div>
          <p className="mt-4 text-sm opacity-85">
            Set your admin email, password and address in <code className="font-mono">.env</code> first.{" "}
            <a href={QUICK_START} className="link-grow font-semibold opacity-100">
              Read the setup guide
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}

export function Compare() {
  return (
    <section id="compare" data-testid="section-compare" aria-labelledby="compare-title" className="mx-auto max-w-[62rem] px-4 py-20 sm:px-5 md:py-28">
      <h2 id="compare-title" className={H2}>
        Free, compared with typical paid tools.
      </h2>
      <p className="mt-5 max-w-[52ch] text-lg text-muted-foreground">Hosted tools are convenient. Here&apos;s the trade-off.</p>

      <table className="mt-10 hidden w-full border-separate border-spacing-0 text-left md:table" data-testid="compare-table">
        <thead>
          <tr>
            <th scope="col" className="w-[38%] pb-4">
              <span className="sr-only">Feature</span>
            </th>
            <th scope="col" className="rounded-t-lg bg-primary px-5 py-4 font-display text-lg font-bold text-primary-foreground">
              Plaudit
            </th>
            <th scope="col" className="px-5 py-4 font-display text-lg font-bold text-muted-foreground">
              Typical paid tools
            </th>
          </tr>
        </thead>
        <tbody>
          {COMPARE.map(([label, ours, theirs], i) => (
            <tr key={label}>
              <th scope="row" className="border-b border-border py-4 pr-4 font-semibold">
                {label}
              </th>
              <td className={`border-b border-border bg-primary/8 px-5 py-4 font-semibold ${i === COMPARE.length - 1 ? "rounded-b-lg" : ""}`}>{ours}</td>
              <td className="border-b border-border px-5 py-4 text-muted-foreground">{theirs}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="mt-10 grid gap-3 md:hidden" data-testid="compare-list">
        {COMPARE.map(([label, ours, theirs]) => (
          <li key={label} className="rounded-lg bg-card p-5 ring-1 ring-border">
            <h3 className="font-bold">{label}</h3>
            <dl className="mt-3 grid gap-2 text-sm">
              <div className="flex gap-2.5">
                <dt className="flex shrink-0 items-center gap-1.5 font-semibold text-primary">
                  <CheckIcon aria-hidden className="size-4" strokeWidth={3} />
                  Plaudit:
                </dt>
                <dd className="font-semibold">{ours}</dd>
              </div>
              <div className="flex gap-2.5 text-muted-foreground">
                <dt className="flex shrink-0 items-center gap-1.5">
                  <MinusIcon aria-hidden className="size-4" />
                  Paid tools:
                </dt>
                <dd>{theirs}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Faq() {
  return (
    <section id="faq" data-testid="section-faq" aria-labelledby="faq-title" className="mx-auto grid max-w-[82.5rem] gap-10 px-4 pb-20 sm:px-5 md:pb-28 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
      <div>
        <h2 id="faq-title" className={H2}>
          Questions, answered.
        </h2>
        <p className="mt-5 max-w-[40ch] text-lg text-muted-foreground">
          Anything else?{" "}
          <a href={REPO} className="link-grow font-semibold text-foreground">
            Ask on GitHub
          </a>
          .
        </p>
      </div>
      <Accordion type="single" collapsible className="border-t border-border" data-testid="faq">
        {FAQ.map((f, i) => (
          <AccordionItem key={f.q} value={`q${i}`}>
            <AccordionTrigger>{f.q}</AccordionTrigger>
            <AccordionContent>
              <Rich text={f.a} />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

export function FinalCta() {
  return (
    <section data-testid="section-cta" aria-labelledby="cta-title" className="mx-auto max-w-[82.5rem] px-4 pt-4 pb-24 text-center sm:px-5 md:pb-32">
      <h2
        id="cta-title"
        className="mx-auto max-w-[16ch] font-display text-[clamp(2.5rem,1.4rem+4.6vw,5.5rem)] leading-[0.95] font-extrabold tracking-display text-balance"
      >
        Your customers already love you. Let them say so.
      </h2>
      <div className="mt-10 flex flex-wrap justify-center gap-2.5">
        <Button asChild size="lg">
          <a href={DASHBOARD}>
            Open the dashboard
            <ArrowRightIcon aria-hidden className="transition-[translate] duration-300 ease-out motion-safe:group-hover:translate-x-0.5" />
          </a>
        </Button>
        <Button asChild size="lg" variant="outline">
          <a href="#self-host">Host it yourself</a>
        </Button>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer data-testid="section-footer" className="border-t border-border">
      <div className="mx-auto flex max-w-[82.5rem] flex-col gap-8 px-4 py-10 sm:px-5 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-2">
          <Wordmark className="text-2xl" />
          <p className="text-sm text-muted-foreground">Free and open source under the MIT licence. Self-hosted, no third-party tracking.</p>
        </div>
        <div className="flex flex-col gap-5 md:items-end">
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-1 text-sm font-medium text-muted-foreground">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="link-grow inline-flex min-h-11 items-center transition-colors hover:text-foreground">
                {n.label}
              </a>
            ))}
            <a href={REPO} className="link-grow inline-flex min-h-11 items-center gap-1.5 transition-colors hover:text-foreground">
              <GitHubMark className="size-4" />
              GitHub
            </a>
            <a href={CREDITS_URL} className="link-grow inline-flex min-h-11 items-center transition-colors hover:text-foreground">
              Credits
            </a>
          </nav>
          <ModePicker />
        </div>
      </div>
    </footer>
  );
}
