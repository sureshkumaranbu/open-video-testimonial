import { Resolver } from "node:dns/promises";

/**
 * REQ-06 (self-host): what the From domain publishes for SPF and DMARC, shown
 * next to a campaign's test send. It only reports what DNS says; nothing is
 * ever blocked on it, and a slow or failing lookup just says so. DKIM needs
 * the provider's selector, so it isn't looked up.
 */
export type SenderAuth = {
  domain: string;
  /** False when the domain wasn't looked up (a reserved test name, or no domain at all). */
  checked: boolean;
  /** The v=spf1 record, or null when there's none. */
  spf: string | null;
  /** The v=DMARC1 record at _dmarc.<domain>, or null when there's none. */
  dmarc: string | null;
  /** Why a lookup didn't give an answer (a timeout, a DNS error, or a reserved name). */
  note: string | null;
};

export type TxtLookup = (name: string) => Promise<string[][]>;

const TIMEOUT_MS = 3000;

/** Names that never have real DNS (RFC 2606 and 6761), so tests and local setups skip the lookup. */
const RESERVED = /(^|\.)(localhost|test|example|invalid|local)$|^example\.(com|net|org)$/i;

function defaultLookup(): TxtLookup {
  const resolver = new Resolver({ timeout: TIMEOUT_MS, tries: 1 });
  return (name) => resolver.resolveTxt(name);
}

function withTimeout<T>(p: Promise<T>, ms: number) {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error("timed out"), { code: "ETIMEOUT" })), ms).unref?.())]);
}

/** One TXT name: the first record that starts with `prefix`, null when there's none, or the error. */
async function find(lookup: TxtLookup, name: string, prefix: RegExp, ms: number): Promise<{ record: string | null; error: string | null }> {
  try {
    const records = (await withTimeout(lookup(name), ms)).map((chunks) => chunks.join(""));
    return { record: records.find((r) => prefix.test(r.trim())) ?? null, error: null };
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    // "No such record" is an answer, not a failure.
    if (code === "ENODATA" || code === "ENOTFOUND") return { record: null, error: null };
    return { record: null, error: code === "ETIMEOUT" ? "The DNS lookup timed out" : `The DNS lookup failed (${code || (err as Error).message})` };
  }
}

export async function checkSenderDomain(address: string, o: { lookup?: TxtLookup; timeoutMs?: number } = {}): Promise<SenderAuth> {
  const domain = (address.split("@")[1] ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!domain || !/^[a-z0-9.-]+$/.test(domain)) {
    return { domain, checked: false, spf: null, dmarc: null, note: "SMTP_FROM has no domain to look up" };
  }
  if (RESERVED.test(domain)) {
    return { domain, checked: false, spf: null, dmarc: null, note: `${domain} is a reserved test name, so it has no DNS records to check` };
  }
  const lookup = o.lookup ?? defaultLookup();
  const ms = o.timeoutMs ?? TIMEOUT_MS;
  const [spf, dmarc] = await Promise.all([find(lookup, domain, /^v=spf1\b/i, ms), find(lookup, `_dmarc.${domain}`, /^v=DMARC1\b/i, ms)]);
  return { domain, checked: true, spf: spf.record, dmarc: dmarc.record, note: spf.error ?? dmarc.error };
}
