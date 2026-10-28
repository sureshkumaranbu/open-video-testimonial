import { onlyOpen, roleAtLeast } from "@/lib/access";
import { requireFeature } from "@/lib/features";
import { getClient, verifyRequest } from "@/lib/oauth";
import { pageAccess } from "@/lib/server-session";
import { listProjects } from "@/lib/testimonials";
import { AppBar } from "../AppBar";
import { Consent } from "./Consent";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect an assistant" };

/** INT-04: a signed-in member lets an MCP client (Claude, ChatGPT…) use Plaudit, read only or also to send invites, in the projects they choose. */
export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ req?: string }> }) {
  requireFeature("mcp");
  const { session, access } = await pageAccess();
  const token = (await searchParams).req ?? "";
  const r = verifyRequest(token);
  const client = r ? getClient(r.clientId) : null;
  const projects = onlyOpen(access, listProjects()).map((p) => ({ id: p.id, name: p.name }));
  return (
    <>
      <AppBar trail={[{ label: "Connect an assistant" }]} />
      <main className="container stack-lg" style={{ maxWidth: "40rem" }}>
        {!r || !client ? (
          <div className="panel panel-body stack" role="alert">
            <h1>This request expired</h1>
            <p className="muted">Start connecting again from the app. Requests last 10 minutes.</p>
          </div>
        ) : (
          <Consent
            req={token}
            clientName={client.name}
            redirectHost={new URL(r.redirectUri).host}
            wantsWrite={r.scope === "write"}
            canWrite={roleAtLeast(session.role, "editor")}
            email={session.email}
            projects={projects}
          />
        )}
      </main>
    </>
  );
}
