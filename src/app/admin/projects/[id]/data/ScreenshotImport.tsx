"use client";

import { useState } from "react";
import { OCR_HELP_URL } from "@/lib/insights/links";
import { ManualAddModal } from "../ManualAddModal";

/**
 * IMP-07 on the import page: a screenshot of a review (from a chat, an email
 * or a site with no importer) read into a testimonial. It opens the manual
 * add dialog on its Image tab, so the owner checks every field the OCR found
 * before anything is saved, and the image is kept as the screenshot.
 */
export function ScreenshotImport({ projectId, ocr }: { projectId: string; ocr: boolean }) {
  const [added, setAdded] = useState(0);
  return (
    <section className="panel" aria-labelledby="shot-h" data-testid="screenshot-import">
      <div className="panel-head">
        <h2 id="shot-h">Import a screenshot</h2>
      </div>
      <div className="panel-body stack">
        <p className="muted small">
          {ocr ? (
            "For praise that came as a screenshot: Plaudit reads the quote, the name and the date out of it, you check them, and the image is kept with the testimonial."
          ) : (
            <>
              Add a screenshot of a review as an image testimonial. Reading its text automatically needs OCR on this server (
              <a href={OCR_HELP_URL} target="_blank" rel="noopener">
                how to set it up
              </a>
              ).
            </>
          )}
        </p>
        <div>
          <ManualAddModal projectId={projectId} onAdded={() => setAdded((n) => n + 1)} initialKind="image" ocr={ocr} openLabel="Import a screenshot" openTestId="screenshot-import-open" />
        </div>
        {added > 0 && (
          <p className="small" role="status" data-testid="screenshot-import-done">
            Added {added === 1 ? "a testimonial" : `${added} testimonials`}. <a href={`/admin/projects/${projectId}`}>See it in the inbox</a>.
          </p>
        )}
      </div>
    </section>
  );
}
