"use client";

import * as React from "react";
import { XIcon } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * shadcn/ui's Sheet (a Radix dialog): focus is trapped inside while it's
 * open, Esc and the overlay close it, and focus returns to the trigger.
 * It slides in from the right (the home page's menu) or the left (the
 * dashboard's sidebar on phones).
 */
export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;

export function SheetContent({
  className,
  children,
  container,
  closeLabel = "Close menu",
  side = "right",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  /** Where to mount it; inside the themed page so it inherits the page's tokens and base styles. */
  container?: HTMLElement | null;
  closeLabel?: string;
  side?: "left" | "right";
}) {
  return (
    <SheetPrimitive.Portal container={container}>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-black/45 data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in"
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed inset-y-0 z-50 flex h-full w-[min(22rem,88vw)] flex-col gap-6 overflow-y-auto bg-background p-6 text-foreground shadow-lift",
          side === "right"
            ? "right-0 data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in"
            : "left-0 data-[state=closed]:animate-sheet-out-left data-[state=open]:animate-sheet-in-left",
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close
          className="absolute top-4 right-4 inline-flex size-11 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:size-5"
          aria-label={closeLabel}
        >
          <XIcon aria-hidden />
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

export function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title data-slot="sheet-title" className={cn("text-lg font-bold", className)} {...props} />;
}

export function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description data-slot="sheet-description" className={cn("text-sm text-muted-foreground", className)} {...props} />
  );
}
