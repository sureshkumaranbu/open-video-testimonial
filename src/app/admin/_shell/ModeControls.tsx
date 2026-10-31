"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { setMode, useMode } from "@/components/theme/mode";
import { MODES, type Mode } from "@/lib/themes";
import { cn } from "@/lib/utils";

const LABEL: Record<Mode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};
const ICON = { system: MonitorIcon, light: SunIcon, dark: MoonIcon } as const;

/** Light, dark or follow the system: three radios in a row (arrow keys move and choose). */
export function ModePicker({ className, testId, compact = false }: { className?: string; testId?: string; compact?: boolean }) {
  const [mode] = useMode();
  return (
    <div
      role="radiogroup"
      aria-label="Colour mode"
      data-testid={testId}
      className={cn("grid grid-cols-3 gap-0.5 rounded-full bg-muted p-1", className)}
    >
      {MODES.map((m) => {
        const Icon = ICON[m];
        const on = mode === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            data-mode={m}
            title={compact ? LABEL[m] : undefined}
            onClick={() => setMode(m)}
            onKeyDown={(e) => {
              const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
              if (!step) return;
              e.preventDefault();
              const next = MODES[(MODES.indexOf(m) + step + MODES.length) % MODES.length];
              setMode(next);
              (e.currentTarget.parentElement?.querySelector(`[data-mode="${next}"]`) as HTMLElement | null)?.focus();
            }}
            className={cn(
              "inline-flex h-9 min-w-0 cursor-pointer items-center justify-center gap-1 rounded-full px-1.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-200 ease-out max-lg:h-11",
              on ? "bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)] dark:bg-input" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon aria-hidden className="size-3.5 shrink-0" />
            <span className={compact ? "sr-only" : "truncate"}>{LABEL[m]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** One button, light ↔ dark: for the collapsed sidebar and the phone's top bar. */
export function ModeToggle({ className, testId, onClick, ...rest }: React.ComponentProps<"button"> & { testId?: string }) {
  const [, dark] = useMode();
  return (
    <button
      {...rest}
      type="button"
      data-testid={testId}
      aria-label="Dark mode"
      aria-pressed={dark}
      onClick={(e) => {
        onClick?.(e);
        setMode(dark ? "light" : "dark");
      }}
      className={cn(
        "relative inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground lg:size-10",
        className,
      )}
    >
      <SunIcon
        aria-hidden
        className="size-[1.15rem] transition-[scale,rotate,opacity] duration-300 ease-out dark:scale-50 dark:rotate-90 dark:opacity-0"
      />
      <MoonIcon
        aria-hidden
        className="absolute size-[1.15rem] scale-50 -rotate-90 opacity-0 transition-[scale,rotate,opacity] duration-300 ease-out dark:scale-100 dark:rotate-0 dark:opacity-100"
      />
    </button>
  );
}
