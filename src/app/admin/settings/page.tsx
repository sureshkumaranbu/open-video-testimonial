import Link from "next/link";
import { WEBHOOK_EVENTS } from "@/db/schema";
import { onlyOpen, projectAccessFor, roleAtLeast, teamOn } from "@/lib/access";
import { analyticsUi } from "@/lib/analytics";
import { env } from "@/lib/env";
import { featureOn } from "@/lib/features";
import { callbackUrl } from "@/lib/oidc";
import { requireAdminPage } from "@/lib/server-session";
import { signInMethods } from "@/lib/sign-in";
import { systemStatus } from "@/lib/system";
import { listForms } from "@/lib/forms";
import { listProjects } from "@/lib/testimonials";
import { AppBar } from "../AppBar";
import { EmailTest } from "./EmailTest";
import { Notifications } from "./Notifications";
import { StorageStatus } from "./StorageStatus";
import { Team } from "./Team";
import { Settings } from "./Settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await requireAdminPage();
  const system = await systemStatus();
  const signIn = signInMethods();
  const missing = (list: string[]) => `Off: set ${list.join(", ")}`;
  const isAdmin = roleAtLeast(session.role, "admin");
  const projectRows = onlyOpen(projectAccessFor(session.email, session.role), listProjects());
  const projects = projectRows.map((p) => ({ id: p.id, name: p.name }));
  const forms = projectRows.flatMap((p) => listForms(p.id).map((f) => ({ id: f.id, name: f.name, projectId: p.id })));
  return (
    <>
      <AppBar trail={[{ label: "Settings" }]} />
      <main className="container stack-lg">
        <div className="page-head">
          <div>
            <h1>Settings</h1>
            <p className="muted">
              {isAdmin
                ? "Server features, the team, API keys and webhooks."
                : "Your own notifications. Server settings, the team, API keys and webhooks are for admins."}
            </p>
          </div>
          {isAdmin && featureOn("team2") && (
            <Link href="/admin/settings/audit" className="button secondary small" data-testid="audit-link">
              Audit log
            </Link>
          )}
        </div>

        {isAdmin && (
          <section className="panel" aria-labelledby="server-h">
            <div className="panel-head">
              <h2 id="server-h" style={{ fontSize: "var(--text-base)" }}>
                This server
              </h2>
            </div>
            <dl className="status-list panel-body" data-testid="server-status">
              <dt>Video conversion</dt>
              <dd data-on={system.ffmpeg}>{system.ffmpeg ? "On: ffmpeg converts videos to MP4 and makes posters" : "Off: install ffmpeg to enable"}</dd>
              <dt>Transcripts</dt>
              <dd data-on={system.transcription.enabled}>
                {system.transcription.enabled ? `On (${system.transcription.provider})` : "Off: set TRANSCRIBE_PROVIDER to enable"}
              </dd>
              <dt>Email</dt>
              <dd data-on={system.email.mode !== "off"}>
                {system.email.mode === "smtp"
                  ? `On: sending as ${system.email.from}`
                  : system.email.mode === "outbox"
                    ? "Test mode: written to DATA_DIR/mail-outbox"
                    : "Off: set SMTP_URL to send request emails (see docs/EMAIL.md)"}
              </dd>
              <dt>Public URL</dt>
              <dd>{env.publicUrl}</dd>
            </dl>
            <h3 className="panel-body small" id="sign-in-h" style={{ paddingBottom: 0 }}>
              Sign-in methods <span className="muted">(setup: docs/AUTH.md)</span>
            </h3>
            <dl className="status-list panel-body" data-testid="sign-in-status" aria-labelledby="sign-in-h">
              <dt>Password</dt>
              <dd data-on={signIn.password}>
                {signIn.passwordKeptOn
                  ? "On: PASSWORD_LOGIN=false is ignored until another method below is on"
                  : signIn.password
                    ? `On: the owner, ${env.adminEmail}${env.passwordLogin ? " (PASSWORD_LOGIN=false turns it off)" : ""}`
                    : env.adminPassword
                      ? "Off: PASSWORD_LOGIN=false"
                      : "Off: ADMIN_PASSWORD isn't set"}
              </dd>
              <dt>Email link</dt>
              <dd data-on={signIn.email}>{signIn.email ? "On: uses the email settings above" : "Off: set up email (SMTP_URL) first"}</dd>
              <dt>Google</dt>
              <dd data-on={signIn.google}>{signIn.google ? `On: redirect URI ${callbackUrl("google")}` : missing(signIn.status.google.missing)}</dd>
              <dt>Apple</dt>
              <dd data-on={signIn.apple}>{signIn.apple ? `On: return URL ${callbackUrl("apple")}` : missing(signIn.status.apple.missing)}</dd>
              <dt>Single sign-on (OIDC)</dt>
              <dd data-on={signIn.oidc}>
                {signIn.oidc
                  ? `On: “${signIn.oidcLabel}”, ${env.oidcIssuer}, redirect URI ${callbackUrl("oidc")}${env.oidcTrustEmail ? "; addresses trusted without email_verified" : ""}`
                  : missing(signIn.status.oidc.missing)}
              </dd>
            </dl>
            {system.email.mode !== "off" && (
              <div className="panel-body stack">
                {system.email.warning && (
                  <p className="notice warn" data-testid="email-from-warning">
                    {system.email.warning}
                  </p>
                )}
                <EmailTest defaultTo={env.adminEmail} />
              </div>
            )}
          </section>
        )}

        {isAdmin && <StorageStatus isOwner={session.role === "owner"} />}

        {isAdmin && (
          <Team
            you={session}
            canInvite={signIn.email || signIn.google || signIn.apple || signIn.oidc}
            emailOn={signIn.email}
            roles={teamOn()}
            projects={projects}
          />
        )}

        {featureOn("notifications") && <Notifications email={session.email} projects={projects} widgetAlerts={analyticsUi()} channels={isAdmin} />}

        {isAdmin && (
          <Settings
            apiBase={`${env.publicUrl}/api/v1`}
            mcpUrl={featureOn("mcp") ? `${env.publicUrl}/mcp` : null}
          perProject={teamOn()}
            events={[...WEBHOOK_EVENTS]}
            projects={projects}
            forms={forms}
          />
        )}
      </main>
    </>
  );
}
