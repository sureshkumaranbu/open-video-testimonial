import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * shadcn/ui's Button, in Plaudit's pill shape. Hover lifts it a little and a
 * press scales it down (both off with reduced motion); the focus ring uses
 * the theme's --ring.
 */
export const buttonVariants = cva(
  [
    "group relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full font-bold select-none",
    "transition-[translate,scale,background-color,color,box-shadow,border-color] duration-200 ease-out",
    "motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 motion-safe:active:scale-[0.97]",
    "focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ring",
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-[1.1em] [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:shadow-lift",
        inverse: "bg-foreground text-background hover:shadow-lift",
        /** For use on a --primary surface. */
        onPrimary: "bg-primary-foreground text-primary hover:shadow-lift",
        outline: "border-[1.5px] border-border bg-card text-foreground hover:border-foreground/40",
        ghost: "text-foreground hover:bg-accent",
      },
      size: {
        default: "h-12 px-6 text-base",
        sm: "h-11 px-4 text-sm",
        lg: "h-14 px-7 text-lg",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
