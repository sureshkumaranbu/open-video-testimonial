"use client";

import { useRef, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { Modal, Segmented } from "@/components/admin";
import { Icon } from "@/components/Icon";
import { OCR_HELP_URL } from "@/lib/insights/links";
import { ResumableUpload } from "@/lib/resumable-upload";

type Kind = "text" | "video" | "image" | "case_study";
type OcrRead = { text: string; name: string | null; date: string | null; provider: string };

const PLATFORMS = [
  ["", "Not posted anywhere else"],
  ["email", "Email"],
  ["google", "Google"],
  ["trustpilot", "Trustpilot"],
  ["g2", "G2"],
  ["capterra", "Capterra"],
  ["producthunt", "Product Hunt"],
  ["appstore", "App Store"],
  ["googleplay", "Google Play"],
  ["x", "X (Twitter)"],
  ["linkedin", "LinkedIn"],
  ["facebook", "Facebook"],
  ["youtube", "YouTube"],
  ["other", "Somewhere else"],
] as const;

const MAX_IMAGES = 5;

type Fields = {
  name: string;
  title: string;
  company: string;
  email: string;
  authorWebsite: string;
  rating: string;
  headline: string;
  text: string;
  platform: string;
  sourceUrl: string;
  sourceDate: string;
  tags: string;
  status: "approved" | "pending" | "hidden";
};

const EMPTY: Fields = {
  name: "",
  title: "",
  company: "",
  email: "",
  authorWebsite: "",
  rating: "",
  headline: "",
  text: "",
  platform: "",
  sourceUrl: "",
  sourceDate: "",
  tags: "",
  status: "approved",
};

const orUndefined = (s: string) => (s.trim() ? s.trim() : undefined);

/**
 * Adding a testimonial by hand (PRD §8.1): text, a video file (which goes
 * through the usual processing), a screenshot of a review, or (insights
 * flag) a case study, which adds the testimonial and opens the case-study
 * editor (SHARE-04). With OCR on (IMP-07), the Image tab can read the
 * screenshot into the fields; the owner checks them before adding, and the
 * image is kept as the screenshot. The button and its dialog; `onAdded`
 * reloads the inbox.
 */
export function ManualAddModal({
  projectId,
  onAdded,
  prefill,
  customerId,
  caseStudy = false,
  ocr,
  initialKind = "text",
  openLabel = "Add testimonial",
  openTestId = "manual-add-open",
}: {
  projectId: string;
  onAdded: () => void;
  /** INBOX-12: a customer's profile opens it with their details filled in, and links the new testimonial to them. */
  prefill?: Partial<Pick<Fields, "name" | "title" | "company" | "email" | "authorWebsite">>;
  customerId?: string;
  /** SHARE-04: offer the Case study tab. */
  caseStudy?: boolean;
  /** IMP-07 (insights flag): true when OCR is on for this project ("Read the screenshot"), false to say how to turn it on; left out, nothing is shown. */
  ocr?: boolean;
  /** The tab it opens on (the import page opens it on Image). */
  initialKind?: Kind;
  openLabel?: string;
  openTestId?: string;
}) {
  const start: Fields = { ...EMPTY, ...prefill };
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>(initialKind);
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState<OcrRead | null>(null);
  const [f, setF] = useState<Fields>(start);
  const [avatar, setAvatar] = useState<File | null>(null);
  const [logo, setLogo] = useState<File | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const [video, setVideo] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const upload = useRef<ResumableUpload | null>(null);

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  function reset() {
    setF(start);
    setKind(initialKind);
    setRead(null);
    setAvatar(null);
    setLogo(null);
    setImages([]);
    setVideo(null);
    setProgress(null);
    setError(null);
  }

  function close() {
    if (saving) void upload.current?.abort();
    setOpen(false);
    setSaving(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return setError("Add the person's name.");
    if ((kind === "text" || kind === "case_study") && !f.text.trim()) return setError("Add the testimonial's text.");
    if (kind === "video" && !video) return setError("Choose the video file.");
    if (kind === "image" && !images.length) return setError("Attach the screenshot or image.");
    setSaving(true);
    setError(null);
    try {
      let videoUpload: { id: string; token: string } | undefined;
      if (kind === "video" && video) {
        const up = new ResumableUpload({
          createUrl: `/api/admin/uploads?kind=video&projectId=${encodeURIComponent(projectId)}`,
          size: video.size,
          onProgress: (s) => setProgress(s.total ? Math.round((s.sent / s.total) * 100) : 0),
        });
        upload.current = up;
        up.append(video);
        videoUpload = await up.finish();
      }
      const payload = {
        kind,
        name: f.name.trim(),
        title: orUndefined(f.title),
        company: orUndefined(f.company),
        email: orUndefined(f.email),
        authorWebsite: orUndefined(f.authorWebsite),
        rating: f.rating ? Number(f.rating) : undefined,
        headline: orUndefined(f.headline),
        text: orUndefined(f.text),
        platform: orUndefined(f.platform),
        sourceUrl: orUndefined(f.sourceUrl),
        sourceDate: orUndefined(f.sourceDate),
        tags: f.tags.split(",").map((s) => s.trim()).filter(Boolean),
        status: f.status,
        videoUpload,
        customerId,
      };
      const body = new FormData();
      body.set("payload", JSON.stringify(payload));
      if (avatar) body.set("avatar", avatar);
      if (logo) body.set("companyLogo", logo);
      for (const img of images) body.append("images", img);
      const added = await api<{ caseStudy?: { id: string } }>(`/api/admin/projects/${projectId}/testimonials/manual`, { method: "POST", body });
      reset();
      setOpen(false);
      // SHARE-04: straight on to the case study's editor.
      if (added.caseStudy) window.location.assign(`/admin/projects/${projectId}/case-studies/${added.caseStudy.id}`);
      else onAdded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
      upload.current = null;
    }
  }

  /** IMP-07: reads the first image and fills what it found; nothing is saved until "Add testimonial". */
  async function readScreenshot() {
    if (!images[0]) return;
    setReading(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("image", images[0]);
      const { read: r } = await api<{ read: OcrRead }>(`/api/admin/projects/${projectId}/ocr`, { method: "POST", body });
      setRead(r);
      setF((x) => ({ ...x, text: r.text || x.text, name: x.name.trim() ? x.name : (r.name ?? ""), sourceDate: x.sourceDate || (r.date ?? "") }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setReading(false);
    }
  }

  return (
    <>
      <button type="button" className="small" onClick={() => setOpen(true)} data-testid={openTestId}>
        <Icon name="plus" />
        {openLabel}
      </button>
      <Modal
        open={open}
        onClose={close}
        title="Add a testimonial"
        description="For praise you received elsewhere. You confirm you have the person's permission to use it."
        size="lg"
        testId="manual-add"
        onSubmit={submit}
        footer={
          <>
            <button type="button" className="ghost" onClick={close}>
              Cancel
            </button>
            <button type="submit" disabled={saving}>
              {saving ? (progress !== null && progress < 100 ? `Uploading… ${progress}%` : "Adding…") : "Add testimonial"}
            </button>
          </>
        }
      >
        <div className="stack ib-edit">
          <Segmented
            label="Kind of testimonial"
            options={[
              { value: "text", label: "Text" },
              { value: "video", label: "Video" },
              { value: "image", label: "Image" },
              ...(caseStudy ? [{ value: "case_study", label: "Case study" }] : []),
            ]}
            value={kind}
            onChange={(v) => setKind(v as Kind)}
            testId="manual-kind"
          />
          <div className="ib-edit-grid">
            <label>
              Name
              <input type="text" value={f.name} onChange={set("name")} required maxLength={120} autoComplete="off" data-autofocus />
            </label>
            <label>
              Job title
              <input type="text" value={f.title} onChange={set("title")} maxLength={120} />
            </label>
            <label>
              Company
              <input type="text" value={f.company} onChange={set("company")} maxLength={120} />
            </label>
            <label>
              Email (private)
              <input type="email" value={f.email} onChange={set("email")} maxLength={200} />
            </label>
            <label>
              Website
              <input type="url" value={f.authorWebsite} onChange={set("authorWebsite")} placeholder="https://" />
            </label>
            <label>
              Rating
              <select value={f.rating} onChange={set("rating")}>
                <option value="">No rating</option>
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? "star" : "stars"}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Headline
            <input type="text" value={f.headline} onChange={set("headline")} maxLength={200} />
          </label>
          {kind === "case_study" && (
            <p className="muted small" data-testid="manual-case-study-note">
              Add what the customer said; after adding, the case study editor opens with a template made from it (and Draft with AI, when it&apos;s on).
            </p>
          )}
          <label>
            {kind === "text" || kind === "case_study" ? "Testimonial text" : "Testimonial text (optional)"}
            <textarea value={f.text} onChange={set("text")} rows={4} maxLength={5000} />
          </label>
          {kind === "video" && (
            <label>
              Video file
              <input type="file" accept="video/*" onChange={(e) => setVideo(e.target.files?.[0] ?? null)} data-testid="manual-video" />
            </label>
          )}
          <label>
            {kind === "image" ? `Screenshot or image (up to ${MAX_IMAGES})` : `Images (optional, up to ${MAX_IMAGES})`}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              onChange={(e) => {
                const picked = [...(e.target.files ?? [])];
                setImages(picked.slice(0, MAX_IMAGES));
                if (picked.length > MAX_IMAGES) setError(`Only the first ${MAX_IMAGES} images are kept.`);
              }}
              data-testid="manual-images"
            />
          </label>
          {kind === "image" && ocr !== undefined && (
            <div className="stack" style={{ gap: "var(--space-1)" }}>
              {ocr ? (
                <div className="row" style={{ gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
                  <button type="button" className="secondary small" onClick={() => void readScreenshot()} disabled={!images.length || reading} data-testid="manual-ocr">
                    <Icon name="sparkle" />
                    {reading ? "Reading…" : "Read the screenshot"}
                  </button>
                  <span className="muted small">Fills the text, name and date from the first image. Check them before adding.</span>
                </div>
              ) : (
                <span className="muted small" data-testid="manual-ocr-off">
                  Reading the text out of a screenshot needs OCR on this server (
                  <a href={OCR_HELP_URL} target="_blank" rel="noopener">
                    how to set it up
                  </a>
                  ).
                </span>
              )}
              {read && (
                <p className="small" role="status" data-testid="manual-ocr-done">
                  Read the screenshot{read.name ? `: found ${read.name}` : ""}{read.date ? `, ${read.date}` : ""}. Check the text below; the image is kept with the testimonial.
                </p>
              )}
            </div>
          )}
          <div className="ib-edit-grid">
            <label>
              Photo of the person
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => setAvatar(e.target.files?.[0] ?? null)} />
            </label>
            <label>
              Company logo
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          <div className="ib-edit-grid">
            <label>
              Where it was posted
              <select value={f.platform} onChange={set("platform")}>
                {PLATFORMS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Link to the original
              <input type="url" value={f.sourceUrl} onChange={set("sourceUrl")} placeholder="https://" />
            </label>
            <label>
              Date
              <input type="date" value={f.sourceDate} onChange={set("sourceDate")} />
            </label>
            <label>
              Status
              <select value={f.status} onChange={set("status")}>
                <option value="approved">Approved (public)</option>
                <option value="pending">Pending review</option>
                <option value="hidden">Hidden (internal use)</option>
              </select>
            </label>
          </div>
          <label>
            Tags (comma separated)
            <input type="text" value={f.tags} onChange={set("tags")} placeholder="homepage, pricing" />
          </label>
          {error && (
            <p className="error-text small" role="alert">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
