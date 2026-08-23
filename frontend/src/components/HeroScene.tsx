"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";

/**
 * The hero scene — a household smart meter, live, with the person it serves.
 *
 * This replaces the reference's turbine photograph. It is drawn rather than
 * photographed for three reasons: no licensing, no binary in the repo, and it
 * can be wired to real state. A stock photo cannot know whether the meter is
 * reporting; this does.
 *
 * WHAT MOVES, AND WHY
 * -------------------
 * Every animation is bound to `live`. When the meter stops reporting the disc
 * halts, the current stops flowing, the digits freeze and the scene desaturates.
 * A hero that keeps animating while nothing is arriving is a lie told in motion,
 * and it is the easiest kind of lie to ship by accident.
 *
 *   · the induction disc turns at a rate scaled by real measured power
 *   · current flows along the service conductor into the home
 *   · the register digits count the real cycle-to-date kWh
 *   · the bill curve falls, and the figure beside it lifts
 *
 * The figure is deliberately geometric — a constructed silhouette, not a
 * cartoon. Illustration that tries for character at this scale reads as clip
 * art; restraint reads as design.
 */

export default function HeroScene({
  live,
  watts,
  kwhCycle,
  savingPct,
}: {
  live: boolean;
  watts: number | null;
  kwhCycle: number | null;
  savingPct: number | null;
}) {
  // Disc speed tracks real load: idle ~7s per turn, heavy ~1.1s. Bounded so a
  // spike cannot spin it into a blur or stall it into looking broken.
  const discSeconds = (() => {
    if (!live || watts === null || watts <= 0) return null;
    const t = Math.min(Math.max(watts / 2500, 0), 1);
    return (7 - t * 5.9).toFixed(2);
  })();

  const register = useCountUp(kwhCycle ?? 0, live);

  return (
    <div className="relative h-full min-h-[460px] w-full overflow-hidden rounded-[var(--r-card)] glass">
      {/* depth wash behind the scene */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(90% 70% at 26% 14%, rgba(255,255,255,0.9) 0%, transparent 58%)," +
            "radial-gradient(80% 60% at 82% 96%, rgba(134,152,180,0.5) 0%, transparent 62%)",
        }}
      />
      <div aria-hidden className="sheen pointer-events-none absolute -inset-x-10 -top-24 h-56 rotate-[8deg] bg-white/45 blur-3xl" />

      <svg
        viewBox="0 0 440 560"
        className={clsx(
          "absolute inset-0 h-full w-full transition-[filter] duration-700",
          !live && "grayscale-[0.55] opacity-90",
        )}
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label={
          live
            ? `Smart meter reporting ${watts === null ? "an unknown load" : `${watts.toFixed(0)} watts`}`
            : "Smart meter, not currently reporting"
        }
      >
        <defs>
          <linearGradient id="hs-body" x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="60%" stopColor="#e6ecf5" />
            <stop offset="100%" stopColor="#c3cddd" />
          </linearGradient>
          <linearGradient id="hs-glass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#dbe3ee" stopOpacity="0.7" />
          </linearGradient>
          <linearGradient id="hs-fall" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#b32a2f" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#e3ec4a" />
          </linearGradient>
          <filter id="hs-drop" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="14" stdDeviation="16" floodColor="#1e2937" floodOpacity="0.24" />
          </filter>
          <filter id="hs-glow" x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="4.5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* ================= service conductor into the home ================= */}
        <path
          d="M96 214 L96 300 Q96 322 118 322 L300 322 Q322 322 322 344 L322 402"
          fill="none" stroke="#94a3b8" strokeWidth="10" strokeLinecap="round" opacity="0.55"
        />
        <path
          d="M96 214 L96 300 Q96 322 118 322 L300 322 Q322 322 322 344 L322 402"
          fill="none"
          stroke={live ? "#e3ec4a" : "#a9b6c7"}
          strokeWidth="3.6"
          strokeLinecap="round"
          strokeDasharray="16 20"
          filter={live ? "url(#hs-glow)" : undefined}
          className={clsx(live && "flow")}
        />

        {/* ============================ the meter ============================ */}
        <g filter="url(#hs-drop)" className={clsx(live && "bob")}>
          {/* enclosure */}
          <rect x="38" y="58" width="176" height="164" rx="26" fill="url(#hs-body)" />
          <rect x="38" y="58" width="176" height="164" rx="26" fill="none" stroke="#a8b4c6" strokeWidth="1.6" />
          {/* dome */}
          <path d="M62 58 A 64 52 0 0 1 190 58 Z" fill="#ffffff" opacity="0.5" />

          {/* register window */}
          <rect x="62" y="80" width="128" height="38" rx="9" fill="#242a33" />
          <text
            x="126" y="107" textAnchor="middle"
            className="num"
            fill={live ? "#e3ec4a" : "#7c8798"}
            style={{ fontSize: 25, fontWeight: 700, letterSpacing: "0.06em" }}
          >
            {register}
          </text>
          <text x="180" y="107" textAnchor="end" fill="#8d99a9" style={{ fontSize: 9, fontWeight: 700 }}>
            kWh
          </text>

          {/* induction disc */}
          <circle cx="126" cy="164" r="34" fill="url(#hs-glass)" stroke="#b3bfd0" strokeWidth="1.4" />
          <g
            className={clsx(discSeconds && "spin-disc")}
            style={discSeconds ? { animationDuration: `${discSeconds}s`, transformOrigin: "126px 164px" } : undefined}
          >
            <circle cx="126" cy="164" r="26" fill="none" stroke="#cfd8e5" strokeWidth="7" />
            <path d="M126 138 A 26 26 0 0 1 152 164 L126 164 Z" fill={live ? "#e3ec4a" : "#c3cddd"} opacity="0.9" />
            <circle cx="126" cy="164" r="3.4" fill="#2b2f37" />
          </g>

          {/* status lamp */}
          <circle
            cx="196" cy="76" r="4.6"
            fill={live ? "#e3ec4a" : "#94a3b8"}
            className={clsx(live && "pulse-dot")}
          />
        </g>

        {/* ===================== the home being supplied ===================== */}
        <g filter="url(#hs-drop)">
          <path d="M262 418 L322 372 L382 418 Z" fill="#eef2f8" stroke="#a8b4c6" strokeWidth="1.8" strokeLinejoin="round" />
          <rect x="278" y="418" width="88" height="66" rx="8" fill="#f7f9fc" stroke="#a8b4c6" strokeWidth="1.8" />
          {/* lit window */}
          <rect
            x="306" y="438" width="32" height="28" rx="4"
            fill={live ? "#e3ec4a" : "#d5dce6"}
            opacity={live ? 0.95 : 0.65}
          />
        </g>

        {/* ============== the falling bill, and the person it lifts ============== */}
        <g transform="translate(0,4)">
          {/* the curve coming down */}
          <path
            d="M64 500 C 118 500 148 468 196 452 C 236 438 262 434 292 432"
            fill="none" stroke="url(#hs-fall)" strokeWidth="4" strokeLinecap="round"
          />
          {[["64","500"],["130","486"],["196","452"],["250","438"],["292","432"]].map(([x,y],i)=>(
            <circle key={i} cx={x} cy={y} r="3.4" fill={i===4 ? "#e3ec4a" : "#9fb0c8"} />
          ))}
          <text x="64" y="522" fill="#5c6673" style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em" }}>
            BILL
          </text>

          {/* the figure — geometric, arms raised */}
          <g className={clsx(live && "bob")} style={{ animationDelay: "0.7s" }}>
            <circle cx="352" cy="470" r="13" fill="#2b2f37" />
            <path d="M352 486 L352 518" stroke="#2b2f37" strokeWidth="9" strokeLinecap="round" />
            <path d="M352 518 L340 546 M352 518 L364 546" stroke="#2b2f37" strokeWidth="8" strokeLinecap="round" />
            <path d="M352 494 L330 474 M352 494 L374 474" stroke="#2b2f37" strokeWidth="8" strokeLinecap="round" />
            {savingPct !== null && savingPct > 0 && (
              <text x="352" y="446" textAnchor="middle" className="num" fill="#5c6400" style={{ fontSize: 13, fontWeight: 700 }}>
                −{savingPct.toFixed(0)}%
              </text>
            )}
          </g>
        </g>

        {/* callout markers over the two components that exist physically */}
        {[{ x: 126, y: 164 }, { x: 322, y: 402 }].map((h) => (
          <g key={`${h.x}`} aria-hidden>
            <circle cx={h.x} cy={h.y} r="16" fill="#ffffff" opacity="0.2" />
            <circle cx={h.x} cy={h.y} r="5.5" fill="#ffffff" stroke="#7d8b9e" strokeWidth="1.5" />
          </g>
        ))}
      </svg>

      {/* ---- overlays ---- */}
      <div className="absolute left-5 top-5 flex items-center gap-2">
        <span className={clsx(
          "inline-flex items-center gap-1.5 rounded-[var(--r-pill)] px-3 py-1.5 text-[11px] font-semibold backdrop-blur",
          live ? "bg-ink-panel/85 text-accent" : "bg-ink-panel/70 text-on-dark-2",
        )}>
          <span className={clsx("h-1.5 w-1.5 rounded-full", live ? "pulse-dot bg-accent" : "bg-on-dark-2")} />
          {live ? "Measuring" : "Not reporting"}
        </span>
      </div>

      <div className="absolute bottom-5 left-5 right-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-3">
          Main distribution board
        </p>
        <p className="mt-0.5 text-[13px] font-medium text-ink-2">
          Non-invasive clamp on the live conductor
        </p>
      </div>
    </div>
  );
}

/**
 * Eases the register up to its real value once, then tracks it exactly.
 *
 * The count-up is a first-paint flourish only. After it lands, the displayed
 * figure is the fetched one — an animation that kept re-running on every poll
 * would make a settled reading look unsettled.
 */
function useCountUp(target: number, enabled: boolean) {
  const [shown, setShown] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    if (!enabled || done.current) {
      setShown(target);
      return;
    }
    const start = performance.now();
    const dur = 1100;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min((t - start) / dur, 1);
      setShown(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
      else done.current = true;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled]);

  return shown.toFixed(1);
}
