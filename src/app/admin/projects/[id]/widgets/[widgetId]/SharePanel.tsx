"use client";

import { CopyField } from "@/components/admin";
import { PLATFORM_GUIDES, widgetSnippets } from "@/lib/widget-config";

type Props = { widgetId: string; name: string; origin: string; dirty: boolean };

/**
 * DISP-09 and DISP-10: every way to put the widget on a site (script, iframe,
 * hosted link, a React component, the SEO HTML include), a ready-made email
 * to a developer, and short steps for common site builders.
 */
export function SharePanel({ widgetId, name, origin, dirty }: Props) {
  const s = widgetSnippets(origin, widgetId);
  const email =
    `mailto:?subject=${encodeURIComponent(`Testimonials widget for our site: ${name}`)}` +
    `&body=${encodeURIComponent(
      `Hi,\n\nCould you add our testimonials widget to the site? Paste this where it should appear:\n\n${s.script}\n\n` +
        `If the page can't run scripts, use this frame instead:\n\n${s.iframe}\n\n` +
        `For search engines, the same testimonials as plain HTML (fetch it on the server and include it): ${s.html}\n\nThanks!`,
    )}`;
  return (
    <div className="ws-share" data-testid="share-panel">
      {dirty && (
        <p className="notice warn" role="status">
          You have unsaved changes. Save them so your site shows the new version.
        </p>
      )}
      <CopyField label="Script (recommended)" value={s.script} multiline rows={2} testId="snippet-script" hint="Paste it where the widget should appear." />
      <CopyField label="Iframe" value={s.iframe} multiline rows={5} testId="snippet-iframe" hint="For pages that can't run scripts; it grows to fit." />
      <CopyField label="Hosted link" value={s.hosted} testId="snippet-hosted" copyLabel="Copy link" hint="A page of its own, for Notion or a link in an email." />
      <CopyField label="React component" value={s.react} multiline rows={8} testId="snippet-react" hint="Save it as PlauditWidget.jsx and render <PlauditWidget />." />
      <CopyField
        label="SEO include (HTML)"
        value={s.html}
        testId="snippet-html"
        copyLabel="Copy URL"
        hint="Your server fetches this and puts it in the page, so the text is there even without JavaScript. Add ?jsonld=1 for review rich-result data."
      />
      <a className="button secondary small" href={email} data-testid="email-developer">
        Email these to my developer
      </a>
      <div className="ws-guides">
        <b className="small">Step by step</b>
        {PLATFORM_GUIDES.map((g) => (
          <details key={g.id}>
            <summary>{g.name}</summary>
            <p className="small">{g.steps}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
