"use client";

import { useEffect, useState } from "react";
import { fillLabel, type Labels } from "@/lib/forms/labels";
import type { GrantedReward } from "@/lib/rewards-config";

const SLICE_COLOURS = ["#2563eb", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#0ea5e9", "#f97316", "#14b8a6", "#ec4899", "#84cc16", "#6366f1", "#eab308"];
const SPIN_MS = 3200;

function reducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A pie of the prizes, each slice as wide as its chance (so what people see is the real odds). */
function Wheel({ chances, rotation, spinning }: { chances: number[]; rotation: number; spinning: boolean }) {
  const total = chances.reduce((a, b) => a + b, 0) || 1;
  let at = 0;
  const slices = chances.map((c, i) => {
    const start = (at / total) * 360;
    at += c;
    const end = (at / total) * 360;
    const large = end - start > 180 ? 1 : 0;
    const p = (deg: number) => {
      const rad = ((deg - 90) * Math.PI) / 180;
      return `${50 + 48 * Math.cos(rad)} ${50 + 48 * Math.sin(rad)}`;
    };
    const d = c >= total ? "M50 2a48 48 0 1 0 0.01 0z" : `M50 50L${p(start)}A48 48 0 ${large} 1 ${p(end)}z`;
    return <path key={i} d={d} fill={SLICE_COLOURS[i % SLICE_COLOURS.length]} stroke="#fff" strokeWidth={0.6} />;
  });
  return (
    <div className="fr-wheel" aria-hidden>
      <span className="fr-wheel-pointer" />
      <svg
        viewBox="0 0 100 100"
        style={{ transform: `rotate(${rotation}deg)`, transition: spinning ? `transform ${SPIN_MS}ms cubic-bezier(0.17, 0.67, 0.21, 1)` : "none" }}
      >
        {slices}
        <circle cx="50" cy="50" r="7" fill="#fff" />
      </svg>
    </div>
  );
}

/**
 * FORM-13: the reward on the thank-you page. The server already decided it
 * (a wheel's prize too); the wheel only animates to that slice, and skips
 * the animation for people who prefer reduced motion.
 */
export function RewardReveal({ reward, labels: l, projectName }: { reward: GrantedReward; labels: Labels; projectName: string }) {
  const wheel = reward.status === "given" ? reward.wheel : undefined;
  const [revealed, setRevealed] = useState(!wheel);
  const [rotation, setRotation] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!wheel) return;
    if (reducedMotion()) {
      setRevealed(true);
      return;
    }
    // Land the won slice's middle under the pointer at the top, after a few turns.
    const total = wheel.chances.reduce((a, b) => a + b, 0) || 1;
    const before = wheel.chances.slice(0, wheel.won).reduce((a, b) => a + b, 0);
    const middle = ((before + wheel.chances[wheel.won] / 2) / total) * 360;
    const raf = requestAnimationFrame(() => setRotation(5 * 360 + (360 - middle)));
    const t = setTimeout(() => setRevealed(true), SPIN_MS + 100);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [wheel]);

  const title = fillLabel(reward.title || l.rewardTitle, { project: projectName });
  const copy = async (code: string) => {
    try {
      await navigator.clipboard?.writeText(code);
    } catch {
      // Blocked clipboard: the code is on screen to copy by hand.
    }
    setCopied(true);
  };

  return (
    <section className="fr-reward" data-testid="reward" data-status={reward.status} aria-labelledby="fr-reward-title">
      <h2 id="fr-reward-title">{title}</h2>
      {reward.status === "sold_out" ? (
        <p className="fr-sub" data-testid="reward-sold-out">
          {l.rewardSoldOut}
        </p>
      ) : reward.status === "unavailable" ? (
        <p className="fr-sub" data-testid="reward-unavailable">
          {l.rewardUnavailable}
        </p>
      ) : (
        <>
          {reward.message && <p className="fr-sub">{reward.message}</p>}
          {wheel && (
            <div className="fr-wheel-wrap">
              <Wheel chances={wheel.chances} rotation={rotation} spinning={rotation > 0} />
              <ul className="fr-wheel-legend">
                {wheel.labels.map((label, i) => (
                  <li key={i}>
                    <span className="fr-dot" style={{ background: SLICE_COLOURS[i % SLICE_COLOURS.length] }} aria-hidden />
                    {label} <span className="muted">({fillLabel(l.wheelChance, { chance: wheel.chances[i] })})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div aria-live="polite">
            {!revealed ? (
              <p className="fr-sub">{l.wheelSpinning}</p>
            ) : (
              <div className="stack" style={{ gap: 8 }} data-testid="reward-revealed">
                {wheel && <strong data-testid="reward-prize">{fillLabel(l.wheelWon, { prize: wheel.labels[wheel.won] })}</strong>}
                {reward.code && (
                  <div className="link-field fr-code">
                    <span>
                      <span className="visually-hidden">{l.rewardCode}: </span>
                      <code data-testid="reward-code">{reward.code}</code>
                    </span>
                    <button type="button" className="secondary small" onClick={() => copy(reward.code!)}>
                      {copied ? l.copied : l.rewardCopy}
                    </button>
                  </div>
                )}
                {reward.url && (
                  <a className="button secondary" href={reward.url} target="_blank" rel="noopener noreferrer" data-testid="reward-url">
                    {l.rewardOpen}
                  </a>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
