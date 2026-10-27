"use client";

import { useRef, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { Modal, Segmented } from "@/components/admin";
import { Icon } from "@/components/Icon";
import { ResumableUpload } from "@/lib/resumable-upload";

type Kind = "text" | "video" | "image";

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
 * through the usual processing) or a screenshot of a review. The button and
 * its dialog; `onAdded` reloads the inbox.
 */
export function ManualAddModal({ projectId, onAdded }: { projectId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("text");
  const [f, setF] = useState<Fields>(EMPTY);
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
    setF(EMPTY);
    setKind("text");
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
    if (kind === "text" && !f.text.trim()) return setError("Add the testimonial's text.");
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
      };
      const body = new FormData();
      body.set("payload", JSON.stringify(payload));
      if (avatar) body.set("avatar", avatar);
      if (logo) body.set("companyLogo", logo);
      for (const img of images) body.append("images", img);
      await api(`/api/admin/projects/${projectId}/testimonials/manual`, { method: "POST", body });
      reset();
      setOpen(false);
      onAdded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
      upload.current = null;
    }
  }

  return (
    <>
      <button type="button" className="small" onClick={() => setOpen(true)} data-testid="manual-add-open">
        <Icon name="plus" />
        Add testimonial
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
          <label>
            {kind === "text" ? "Testimonial text" : "Testimonial text (optional)"}
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
