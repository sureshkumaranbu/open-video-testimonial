import { headers } from "next/headers";
import { display } from "../fonts";
import { adminBootScript } from "./_shell/boot";
import "./app.css";

// Every dashboard page renders per request, so src/proxy.ts's nonce reaches
// its scripts (a prerendered page would have none and be blocked by the CSP).
export const dynamic = "force-dynamic";

/**
 * `.admin-root` puts the dashboard on the theme (globals.css maps its tokens
 * onto theme.css's; docs/THEMING.md) and carries the interface font. It adds
 * no box of its own. The boot script applies light/dark and the sidebar's
 * state before the first paint.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <div className={`admin-root ${display.variable}`}>
      <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: adminBootScript }} />
      {children}
    </div>
  );
}
