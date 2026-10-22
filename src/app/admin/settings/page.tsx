import { WEBHOOK_EVENTS } from "@/db/schema";
import { env } from "@/lib/env";
import { requireAdminPage } from "@/lib/server-session";
import { systemStatus } from "@/lib/system";
import { listProjects } from "@/lib/testimonials";
import { AppBar } from "../AppBar";
import { Settings } from "./Settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireAdminPage();
  const system = await systemStatus();
  return (
    <>
      <AppBar trail={[{ label: "Settings" }]} />
      <main className="container stack-lg">
        <div className="page-head">
          <div>
            <h1>Settings</h1>
            <p className="muted">Server features, API keys and webhooks.</p>
          </div>
        </div>

        <section className="panel" aria-labelledby="server-h">
          <div className="panel-head">
            <h2 id="server-h" style={{ fontSize: "var(--text-base)" }}>
              This server
            </h2>
          </div>
          <dl className="status-list panel-body" data-testid="server-status">
            <dt>Video conversion</dt>
            <dd data-on={system.ffmpeg}>
              {system.ffmpeg ? "On: ffmpeg converts videos to MP4 and makes posters" : "Off: install ffmpeg to enable"}
            </dd>
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
                  : "Off: set SMTP_URL to send request emails"}
            </dd>
            <dt>Public URL</dt>
            <dd>{env.publicUrl}</dd>
          </dl>
        </section>

        <Settings
          apiBase={`${env.publicUrl}/api/v1`}
          events={[...WEBHOOK_EVENTS]}
          projects={listProjects().map((p) => ({ id: p.id, name: p.name }))}
        />
      </main>
    </>
  );
}
