"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Copies `text`. The icon morphs into a check (drawn in with a stroke
 * animation, home.css `.copy-check`) and the label reads "Copied" for two
 * seconds; screen readers hear it through the live region.
 */
export function CopyButton({ text, label = "Copy", className, testId }: { text: string; label?: string; className?: string; testId?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Older browsers and insecure origins: a hidden textarea and execCommand.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      ta.remove();
    }
    setState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      data-testid={testId}
      data-state={state}
      className={cn(
        "group/copy inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground",
        "transition-[scale,background-color] duration-200 ease-out motion-safe:active:scale-[0.96]",
        "focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ring",
        className,
      )}
    >
      <span className="relative grid size-4 place-items-center" aria-hidden>
        <CopyIcon className="copy-icon col-start-1 row-start-1 size-4" />
        <CheckIcon className="copy-check col-start-1 row-start-1 size-4" strokeWidth={3} />
      </span>
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}</span>
    </button>
  );
}
