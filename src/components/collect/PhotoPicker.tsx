"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { isImageMime, sniffMime, tooLarge, UNSUPPORTED_IMAGE } from "@/lib/sniff";

export type PhotoPickerLabels = {
  label: string;
  optional: string;
  /** `{mb}` is the size limit. */
  hint: string;
  change: string;
  /** `{mb}` is the size limit. */
  tooLarge: string;
  unsupported: string;
};

const mb = (bytes: number) => String(Math.round(bytes / 1024 / 1024));

const ENGLISH: PhotoPickerLabels = {
  label: "Photo",
  optional: "(optional)",
  hint: "A headshot or your logo, under {mb} MB",
  change: "Looks good. Click to change it.",
  tooLarge: "",
  unsupported: UNSUPPORTED_IMAGE,
};

type Props = {
  maxBytes: number;
  /** The form field name when it's sent with a <form>; left out when `onChange` holds the file instead. */
  name?: string;
  labels?: Partial<PhotoPickerLabels>;
  required?: boolean;
  /**
   * Controlled use (the step-by-step form): the picked file is handed up and
   * passed back in, so it survives the picker leaving the page between steps.
   */
  file?: File | null;
  onChange?: (file: File | null) => void;
  testId?: string;
};

/** The optional photo. A file we can't use is refused when it's picked, not on submit. */
export function PhotoPicker({ maxBytes, name = "avatar", labels, required, file, onChange, testId }: Props) {
  const l = { ...ENGLISH, ...labels };
  const controlled = onChange !== undefined;
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!controlled) return;
    const url = file ? URL.createObjectURL(file) : null;
    setPreview(url);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [controlled, file]);
  useEffect(() => () => {
    if (!controlled && preview) URL.revokeObjectURL(preview);
  }, [controlled, preview]);
  const tooBig = l.tooLarge ? l.tooLarge.replaceAll("{mb}", mb(maxBytes)) : tooLarge(maxBytes);
  return (
    <label className="file-pick" style={{ position: "relative" }} data-testid={testId}>
      <span className="preview" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview ? <img src={preview} alt="" /> : <Icon name="upload" />}
      </span>
      <span className="stack" style={{ gap: 2 }}>
        <span>
          {l.label} {!required && <span className="hint">{l.optional}</span>}
        </span>
        {problem ? (
          <span className="error-text xsmall" role="alert" data-testid="photo-problem">
            {problem}
          </span>
        ) : (
          <span className="hint xsmall">{preview ? l.change : l.hint.replaceAll("{mb}", mb(maxBytes))}</span>
        )}
      </span>
      <input
        type="file"
        name={controlled ? undefined : name}
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={async (e) => {
          const input = e.target;
          const picked = input.files?.[0];
          if (!controlled) setPreview(null);
          setProblem(null);
          if (!picked) {
            onChange?.(null);
            return;
          }
          // Same checks as the server, by the file's real type, so it isn't refused only on submit.
          const head = new Uint8Array(await picked.slice(0, 16).arrayBuffer());
          const problem = picked.size > maxBytes ? tooBig : !isImageMime(sniffMime(head)) ? l.unsupported : null;
          if (problem) {
            input.value = ""; // so the form doesn't send it
            setProblem(problem);
            onChange?.(null);
            return;
          }
          if (controlled) onChange(picked);
          else setPreview(URL.createObjectURL(picked));
        }}
      />
    </label>
  );
}
