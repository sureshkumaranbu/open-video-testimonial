// Every dashboard page renders per request, so src/proxy.ts's nonce reaches
// its scripts (a prerendered page would have none and be blocked by the CSP).
export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
