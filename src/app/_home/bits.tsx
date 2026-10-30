import { cn } from "@/lib/utils";
import type { SamplePerson } from "./samples";

const STAR = "M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z";

/** Five drawn stars with one accessible label ("Rated 4 out of 5"). */
export function Stars({ rating, className, size = 18 }: { rating: number; className?: string; size?: number }) {
  return (
    <span role="img" aria-label={`Rated ${rating} out of 5`} className={cn("inline-flex gap-0.5", className)} data-stars>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          aria-hidden
          width={size}
          height={size}
          viewBox="0 0 24 24"
          className={n <= rating ? "fill-star" : "fill-star-off"}
          style={{ ["--n" as string]: n }}
        >
          <path d={STAR} />
        </svg>
      ))}
    </span>
  );
}

/** A sample person's face: decorative (the name is always beside it), sized up front so it never shifts layout. */
export function Face({ person, size = 40, className, eager = false }: { person: SamplePerson; size?: number; className?: string; eager?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={person.avatar}
      alt=""
      width={size}
      height={size}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      data-face={person.id}
      className={cn("face shrink-0 rounded-full object-cover", className)}
      style={{ width: size, height: size }}
    />
  );
}

/** The visible label on every sample testimonial. */
export function SampleTag({ className }: { className?: string }) {
  return (
    <span
      data-sample-tag
      className={cn(
        "inline-flex h-6 items-center rounded-full bg-background/80 px-2.5 text-xs font-semibold text-foreground backdrop-blur-sm",
        className,
      )}
    >
      Sample
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display text-[1.625rem] leading-none font-extrabold tracking-display", className)}>
      plaudit<span className="text-primary">.</span>
    </span>
  );
}

/** GitHub's mark, drawn (lucide no longer ships brand icons). */
export function GitHubMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={cn("size-5", className)}>
      <path d="M12 2.25a9.75 9.75 0 0 0-3.08 19c.49.09.67-.21.67-.47v-1.65c-2.71.59-3.29-1.31-3.29-1.31-.44-1.13-1.08-1.43-1.08-1.43-.89-.6.07-.59.07-.59.98.07 1.5 1.01 1.5 1.01.87 1.5 2.29 1.07 2.85.82.09-.63.34-1.07.62-1.31-2.17-.25-4.44-1.08-4.44-4.82 0-1.06.38-1.93 1-2.61-.1-.25-.43-1.24.1-2.58 0 0 .82-.26 2.68 1a9.3 9.3 0 0 1 4.88 0c1.86-1.26 2.68-1 2.68-1 .53 1.34.2 2.33.1 2.58.62.68 1 1.55 1 2.61 0 3.75-2.28 4.57-4.45 4.81.35.3.66.9.66 1.81v2.68c0 .26.18.57.68.47A9.75 9.75 0 0 0 12 2.25z" />
    </svg>
  );
}

/** Renders `code` spans in plain copy (the FAQ answers). */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.startsWith("`") ? (
          <code key={i} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground">
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}
