"use client";

import { useRef, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { Icon } from "@/components/Icon";
import type { AuthorImage } from "@/lib/author-images";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const LABELS: Record<AuthorImage, { title: string; noun: string }> = {
  avatar: { title: "Photo of the person", noun: "photo" },
  logo: { title: "Company logo", noun: "logo" },
};

function AuthorImageField({ testimonialId, which, imageKey, onChanged }: { testimonialId: string; which: AuthorImage; imageKey: string | null; onChanged: () => void }) {
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const { title, noun } = LABELS[which];
  const url = `/api/admin/testimonials/${testimonialId}/author-image/${which}`;

  async function run(kind: "upload" | "remove", picked?: File) {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "upload" && picked) {
        const body = new FormData();
        body.set("file", picked);
        await api(url, { method: "POST", body });
      } else {
        await api(url, { method: "DELETE" });
      }
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
      if (file.current) file.current.value = "";
    }
  }

  return (
    <div className="stack ib-author-image" data-testid={`author-image-${which}`}>
      <span className="ib-author-image-title">{title}</span>
      <div className="ib-author-image-row">
        <span className="ib-author-image-box" data-empty={imageKey ? undefined : true} data-shape={which}>
          {imageKey ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/media/${imageKey}`} alt={title} data-testid={`author-image-${which}-preview`} />
          ) : (
            <Icon name="image" />
          )}
        </span>
        <div className="row">
          <button type="button" className="secondary small" onClick={() => file.current?.click()} disabled={busy !== null}>
            <Icon name="upload" />
            {busy === "upload" ? "Uploading…" : imageKey ? `Replace ${noun}` : `Upload ${noun}`}
          </button>
          {imageKey && (
            <button type="button" className="ghost small" onClick={() => void run("remove")} disabled={busy !== null}>
              {busy === "remove" ? "Removing…" : "Remove"}
            </button>
          )}
        </div>
        <input
          ref={file}
          type="file"
          accept={ACCEPT}
          className="visually-hidden"
          tabIndex={-1}
          aria-label={`${title} file`}
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (picked) void run("upload", picked);
          }}
        />
      </div>
      {error && (
        <p className="error-text small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The person's photo and company logo (INBOX-08). Each saves as soon as it's
 * picked or removed, like the brand kit's logo; the history records it.
 */
export function AuthorImages({
  testimonialId,
  avatarKey,
  companyLogoKey,
  onChanged,
}: {
  testimonialId: string;
  avatarKey: string | null;
  companyLogoKey: string | null;
  onChanged: () => void;
}) {
  return (
    <div className="stack">
      <div className="ib-edit-grid">
        <AuthorImageField testimonialId={testimonialId} which="avatar" imageKey={avatarKey} onChanged={onChanged} />
        <AuthorImageField testimonialId={testimonialId} which="logo" imageKey={companyLogoKey} onChanged={onChanged} />
      </div>
      <p className="hint xsmall">PNG, JPEG, WebP or GIF. These save as soon as you pick or remove them.</p>
    </div>
  );
}
