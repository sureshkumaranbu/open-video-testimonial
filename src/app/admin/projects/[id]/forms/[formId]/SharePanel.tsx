"use client";

import { CopyField } from "@/components/admin";
// Imported directly, not from the kit's index, so only pages with a QR code load the encoder.
import { QrStudio } from "@/components/admin/QrStudio";
import type { FormRow } from "../types";

/** FORM-11: the hosted link, a QR code (PNG or SVG, any colour) and the three ways to embed the form. */
export function SharePanel({ form, accent, logoUrl }: { form: FormRow; accent: string; logoUrl?: string | null }) {
  return (
    <div className="stack fb-editor" data-testid="share-panel">
      <h2 className="section-title">Link</h2>
      <CopyField label="Hosted link" value={form.links.hosted} testId="share-link" />
      {form.status === "paused" && <p className="notice small">The form is paused: the link shows its closed message.</p>}

      <h2 className="section-title">QR code</h2>
      <QrStudio url={form.links.hosted} fileBase={form.slug} logoUrl={logoUrl} suggestion={accent} />

      <h2 className="section-title">Embed</h2>
      <CopyField label="Inline on your page" value={form.links.inline} multiline rows={3} testId="embed-inline" hint="The form appears where you paste this." />
      <CopyField label="Popup button" value={form.links.popup} multiline rows={3} testId="embed-popup" hint="A floating button that opens the form." />
      <CopyField label="Iframe" value={form.links.iframe} multiline rows={3} testId="embed-iframe" hint="For site builders that only take an iframe." />
    </div>
  );
}
