"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SparklesIcon } from "lucide-react";
import { api } from "@/app/admin/api";
import { Button } from "@/components/ui/button";

/**
 * The dashboard's Get started card (D10: a link to the wizard, never a
 * redirect). Skip hides it for this person. Part of the redesigned dashboard
 * home, so it's drawn with the theme's utilities (inside `.ui-app`).
 */
export function WelcomeCard({ first }: { first: boolean }) {
  const router = useRouter();
  return (
    <section
      className="relative flex flex-col gap-5 overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-1)] sm:flex-row sm:items-center sm:p-6"
      data-testid="welcome-card"
      aria-labelledby="welcome-h"
    >
      <span aria-hidden className="relative inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
        <SparklesIcon className="size-6" />
      </span>
      <div className="relative min-w-0 flex-1">
        <h2 id="welcome-h" className="text-lg leading-snug font-semibold tracking-tight text-foreground">
          {first ? "Get started" : "Set up another project"}
        </h2>
        <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">
          Answer three questions and we&apos;ll find testimonials on your site, then make a collection form, a Wall of Love and two widgets in your
          colours.
        </p>
      </div>
      <div className="relative flex shrink-0 items-center gap-2">
        <Button asChild size="sm">
          <Link href="/admin/welcome">Start setup</Link>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={async () => {
            await api("/api/admin/onboarding", {
              method: "POST",
              json: { skip: true },
            }).catch(() => null);
            router.refresh();
          }}
        >
          Skip
        </Button>
      </div>
    </section>
  );
}
