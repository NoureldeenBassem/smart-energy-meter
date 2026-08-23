"use client";

import { clsx } from "clsx";

/**
 * The hero visual: a household consumer unit with the meter's CT clamp on the
 * live conductor, and current flowing out to the home.
 *
 * WHY AN ILLUSTRATION AND NOT A PHOTOGRAPH
 * ----------------------------------------
 * A stock photo of a breaker panel would need licensing, ship a binary into the
 * repo, and fix one colour temperature the palette then has to live with. This
 * is inline SVG: it themes from the same tokens as everything else, scales to
 * any card size without artefacts, and costs no network request.
 *
 * The flow animation is driven by `live`. When the meter is not reporting the
 * dashes stop and the wire greys out — the illustration tells the truth about
 * device state rather than animating regardless, which would imply data that is
 * not arriving. prefers-reduced-motion stops it too, via globals.css.
 *
 * Hotspot dots mark the three physical parts of the system, echoing the
 * reference's callout markers but labelled with real components.
 */
export default function HeroPanel({
  live,
  watts,
}: {
  live: boolean;
  watts: number | null;
}) {
  const wire =
    "M211 266 L211 330 Q211 352 233 352 L318 352 Q340 352 340 374 L340 430";

  return (
    <div className="relative h-full min-h-[320px] w-full overflow-hidden rounded-[var(--radius-card)] shadow-[var(--shadow-card)]">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 22% 12%, #eaf0f8 0%, #c6d0de 45%, #9fadc1 100%)",
        }}
      />

      <svg
        viewBox="0 0 420 520"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label={
          live
            ? `Home electrical panel with the meter clamp attached, drawing ${
                watts === null ? "an unknown load" : `${watts.toFixed(0)} watts`
              }`
            : "Home electrical panel with the meter clamp attached; the meter is not reporting"
        }
      >
        <defs>
          <linearGradient id="hp-metal" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f8fafc" />
            <stop offset="55%" stopColor="#dde4ee" />
            <stop offset="100%" stopColor="#b9c4d4" />
          </linearGradient>
          <linearGradient id="hp-breaker" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#cfd8e5" />
          </linearGradient>
          <filter id="hp-soft" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow
              dx="0"
              dy="10"
              stdDeviation="12"
              floodColor="#0f172a"
              floodOpacity="0.22"
            />
          </filter>
          <filter id="hp-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* consumer unit */}
        <g filter="url(#hp-soft)">
          <rect x="96" y="70" width="230" height="196" rx="14" fill="url(#hp-metal)" />
          <rect
            x="96"
            y="70"
            width="230"
            height="196"
            rx="14"
            fill="none"
            stroke="#94a3b8"
            strokeWidth="2"
          />
          <rect x="116" y="112" width="190" height="8" rx="3" fill="#aab6c6" />
          <rect x="116" y="186" width="190" height="8" rx="3" fill="#aab6c6" />

          {[0, 1, 2, 3, 4, 5].map((i) => (
            <g key={`t${i}`}>
              <rect
                x={122 + i * 30}
                y={120}
                width="22"
                height="48"
                rx="4"
                fill="url(#hp-breaker)"
                stroke="#9aa7b8"
                strokeWidth="1.2"
              />
              <rect x={128 + i * 30} y={132} width="10" height="5" rx="2" fill="#7c8a9c" />
            </g>
          ))}

          {[0, 1, 2, 3, 4, 5].map((i) => (
            <g key={`b${i}`}>
              <rect
                x={122 + i * 30}
                y={194}
                width="22"
                height="48"
                rx="4"
                fill="url(#hp-breaker)"
                stroke="#9aa7b8"
                strokeWidth="1.2"
              />
              <rect
                x={128 + i * 30}
                y={206}
                width="10"
                height="5"
                rx="2"
                fill={i === 2 ? "#b9c21f" : "#7c8a9c"}
              />
            </g>
          ))}
        </g>

        {/* live conductor */}
        <path d={wire} fill="none" stroke="#8593a6" strokeWidth="9" strokeLinecap="round" />
        <path
          d={wire}
          fill="none"
          stroke={live ? "#dce531" : "#9aa7b8"}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray="14 20"
          filter={live ? "url(#hp-glow)" : undefined}
          className={clsx(live && "hp-flow")}
        />

        {/* CT clamp */}
        <g filter="url(#hp-soft)">
          <rect x="180" y="286" width="62" height="46" rx="12" fill="#1e2632" />
          <rect
            x="180"
            y="286"
            width="62"
            height="46"
            rx="12"
            fill="none"
            stroke="#3b4757"
            strokeWidth="1.5"
          />
          <circle cx="211" cy="309" r="13" fill="none" stroke="#4c596b" strokeWidth="4" />
          <circle
            cx="211"
            cy="309"
            r="13"
            fill="none"
            stroke={live ? "#dce531" : "#64748b"}
            strokeWidth="2.2"
            strokeDasharray="4 6"
            className={clsx(live && "hp-spin")}
          />
        </g>

        {/* ESP32 */}
        <path
          d="M242 300 Q272 296 276 268"
          fill="none"
          stroke="#7d8b9e"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <g filter="url(#hp-soft)">
          <rect x="252" y="228" width="52" height="38" rx="8" fill="#232c39" />
          <rect x="260" y="238" width="36" height="18" rx="4" fill="#394454" />
          <circle
            cx="266"
            cy="247"
            r="2.6"
            fill={live ? "#dce531" : "#5b6779"}
            className={clsx(live && "hp-blink")}
          />
          <text
            x="281"
            y="251"
            textAnchor="middle"
            fill="#9fb0c6"
            style={{ fontSize: 8, fontWeight: 700 }}
          >
            ESP32
          </text>
        </g>

        {/* the home the current feeds */}
        <g filter="url(#hp-soft)">
          <path
            d="M300 452 L340 420 L380 452 Z"
            fill="#e6ecf5"
            stroke="#94a3b8"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <rect
            x="312"
            y="452"
            width="56"
            height="42"
            rx="5"
            fill="#f3f6fb"
            stroke="#94a3b8"
            strokeWidth="2"
          />
          <rect
            x="330"
            y="464"
            width="20"
            height="18"
            rx="3"
            fill={live ? "#dce531" : "#cbd5e1"}
            opacity={live ? 0.95 : 0.6}
          />
        </g>

        {/* hotspot markers */}
        {[
          { x: 211, y: 309 },
          { x: 281, y: 247 },
          { x: 340, y: 430 },
        ].map((h) => (
          <g key={`${h.x}-${h.y}`} aria-hidden>
            <circle cx={h.x} cy={h.y} r="15" fill="#ffffff" opacity="0.16" />
            <circle cx={h.x} cy={h.y} r="5.5" fill="#ffffff" stroke="#64748b" strokeWidth="1.5" />
          </g>
        ))}
      </svg>

      <div className="absolute left-5 top-5">
        <span
          className={clsx(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur",
            live ? "bg-surface-ink/85 text-accent" : "bg-surface-ink/75 text-ink-onDark-muted",
          )}
        >
          <span
            className={clsx(
              "h-1.5 w-1.5 rounded-full",
              live ? "animate-pulse bg-accent" : "bg-ink-onDark-muted",
            )}
          />
          {live ? "Measuring" : "Not reporting"}
        </span>
      </div>

      <div className="absolute bottom-5 left-5 right-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft/80">
          Main distribution board
        </p>
        <p className="mt-0.5 text-[13px] font-medium text-ink-soft">
          Non-invasive clamp on the live conductor
        </p>
      </div>
    </div>
  );
}
