"use client";

import { useSyncExternalStore } from "react";
import { MODE_KEY, MODES, type Mode } from "@/lib/themes";

/**
 * The visitor's light/dark/system choice, shared by the home page and the
 * dashboard. Their boot scripts (src/app/_home/boot.ts and
 * src/app/admin/_shell/boot.ts) apply it before first paint; this keeps it in
 * sync afterwards (the toggle, other tabs, and the system setting while
 * "system" is chosen).
 */

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function read(): Mode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return (MODES as readonly string[]).includes(v ?? "") ? (v as Mode) : "system";
  } catch {
    return "system";
  }
}

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function isDark(mode: Mode) {
  return mode === "dark" || (mode === "system" && systemDark());
}

function apply(mode: Mode, animate: boolean) {
  const root = document.documentElement;
  const dark = isDark(mode);
  if (root.classList.contains("dark") === dark) return;
  const swap = () => {
    root.classList.toggle("dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
    emit();
  };
  // A short cross-fade where the browser has View Transitions; otherwise, or with reduced motion, an instant swap.
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (animate && doc.startViewTransition && !reduced()) {
    root.dataset.vt = "theme";
    const t = doc.startViewTransition(swap) as { finished?: Promise<void> };
    void t.finished?.finally(() => delete root.dataset.vt);
  } else swap();
}

export function setMode(mode: Mode) {
  try {
    if (mode === "system") localStorage.removeItem(MODE_KEY);
    else localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Private mode: it still applies for this page view.
  }
  current = mode;
  apply(mode, true);
  emit();
}

let current: Mode | null = null;

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (listeners.size === 1) {
    current = read();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => {
      if (current === "system") {
        apply("system", true);
        emit();
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== MODE_KEY && e.key !== null) return;
      current = read();
      apply(current, false);
      emit();
    };
    mq.addEventListener("change", onSystem);
    window.addEventListener("storage", onStorage);
    teardown = () => {
      mq.removeEventListener("change", onSystem);
      window.removeEventListener("storage", onStorage);
    };
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size) teardown?.();
  };
}
let teardown: (() => void) | undefined;

const snapshot = () => (current ??= read());

/** [chosen mode, whether the page is dark right now]; "system" and light before hydration. */
export function useMode(): [Mode, boolean] {
  const mode = useSyncExternalStore(subscribe, snapshot, () => "system" as Mode);
  const dark = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
  return [mode, dark];
}
