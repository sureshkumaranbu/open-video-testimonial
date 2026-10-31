"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, LinkIcon } from "lucide-react";
import { copyText } from "@/components/admin/clipboard";
import { cn } from "@/lib/utils";

/** Copies a project's collection link; the label says so for two seconds (and tells screen readers). */
export function CopyLink({ url, className }: { url: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      data-testid="copy-share-link"
      title={url}
      className={cn(className, state === "copied" && "text-foreground")}
      onClick={async () => {
        const ok = await copyText(url);
        setState(ok ? "copied" : "failed");
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setState("idle"), 2000);
      }}
    >
      {state === "copied" ? <CheckIcon aria-hidden className="size-4 text-primary" /> : <LinkIcon aria-hidden className="size-4" />}
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : "Share link"}</span>
    </button>
  );
}
