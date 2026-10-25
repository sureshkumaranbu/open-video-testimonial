"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";

/** The words beside the stars, by rating (index 0 is "no rating yet"). */
export const RATING_WORDS = ["", "Poor", "Fair", "Good", "Great", "Outstanding"];

type Props = {
  value: number;
  onChange: (n: number) => void;
  /** The group's accessible name. */
  label?: string;
  /** Six entries, like RATING_WORDS. */
  words?: string[];
  /** Each star's accessible name. */
  starLabel?: (n: number) => string;
};

const englishStar = (n: number) => `${n} star${n > 1 ? "s" : ""}`;

/** Five stars; clicking the chosen star again clears the rating. */
export function StarInput({ value, onChange, label = "Rating", words = RATING_WORDS, starLabel = englishStar }: Props) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="row" style={{ gap: "var(--space-3)" }}>
      <div
        className="star-input"
        role="radiogroup"
        aria-label={label}
        data-hover={hover ? "" : undefined}
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={starLabel(n)}
            data-on={!hover && n <= value}
            data-hover-on={n <= hover}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(n === value ? 0 : n)}
          >
            <Icon name="star" />
          </button>
        ))}
      </div>
      <span className="muted small" aria-live="polite">
        {words[shown]}
      </span>
    </div>
  );
}
