"use client";

import { clsx } from "clsx";

/**
 * The page background — ONE full-bleed scene behind the entire app.
 *
 * This is the structural point of the design: in the reference, the photograph
 * is the background of the whole viewport and the cards float on top of it as
 * translucent glass. It is not a picture sitting inside a card in the left
 * column. Getting that wrong turns the page into a grid of tiles and loses the
 * depth entirely.
 *
 * So this renders once, fixed, at z-index -1, from the Shell — every route
 * shares the same continuous scene, and navigating between pages does not
 * reset it.
 *
 * COMPOSITION IS LEFT-WEIGHTED ON PURPOSE
 * ---------------------------------------
 * The meter, the person and the falling bill sit in the left third, which is
 * the region the card grid deliberately leaves uncovered — the same way the
 * turbine occupies the left of the reference while the data cards stack right.
 * `slice` crops the sides on narrow viewports exactly as a background photo
 * would.
 *
 * EVERY ANIMATION IS BOUND TO `live`.
 * When the meter stops reporting the disc halts, current stops flowing, the
 * register freezes and the scene desaturates. A background that keeps animating
 * while no data is arriving is a lie told in motion.
 */
export default function SceneBackground({
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
  // spike cannot blur it and an idle house cannot stall it into looking broken.
  const discSeconds = (() => {
    if (!live || watts === null || watts <= 0) return null;
    const t = Math.min(Math.max(watts / 2500, 0), 1);
    return (7 - t * 5.9).toFixed(2);
  })();

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <svg
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
        className={clsx(
          "h-full w-full transition-[filter] duration-1000",
          !live && "saturate-[0.45]",
        )}
      >
        <defs>
          {/* the sky */}
          <linearGradient id="sb-sky" x1="0" y1="0" x2="0.35" y2="1">
            <stop offset="0%" stopColor="#dde5f0" />
            <stop offset="46%" stopColor="#bccadd" />
            <stop offset="100%" stopColor="#93a6c1" />
          </linearGradient>
          <radialGradient id="sb-sun" cx="0.12" cy="0.06" r="0.72">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.92" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="sb-warm" cx="0.86" cy="0.1" r="0.6">
            <stop offset="0%" stopColor="#e3ec4a" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#e3ec4a" stopOpacity="0" />
          </radialGradient>

          <linearGradient id="sb-body" x1="0" y1="0" x2="0.55" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="58%" stopColor="#e7edf6" />
            <stop offset="100%" stopColor="#bfcadb" />
          </linearGradient>
          <linearGradient id="sb-dome" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#d5deea" stopOpacity="0.65" />
          </linearGradient>
          <linearGradient id="sb-fall" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#b32a2f" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#e3ec4a" />
          </linearGradient>

          <filter id="sb-drop" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="26" stdDeviation="30" floodColor="#1e2937" floodOpacity="0.26" />
          </filter>
          <filter id="sb-glow" x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="7" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* ---------------- atmosphere ---------------- */}
        <rect width="1600" height="900" fill="url(#sb-sky)" />
        <rect width="1600" height="900" fill="url(#sb-sun)" />
        <rect width="1600" height="900" fill="url(#sb-warm)" />

        {/* ground haze */}
        <ellipse cx="800" cy="960" rx="1100" ry="270" fill="#8698b4" opacity="0.42" />

        {/* ---------------- service conductor ---------------- */}
        <path
          d="M300 500 L300 646 Q300 690 344 690 L742 690 Q786 690 786 646 L786 560"
          fill="none" stroke="#8fa0b8" strokeWidth="20" strokeLinecap="round" opacity="0.5"
        />
        <path
          d="M300 500 L300 646 Q300 690 344 690 L742 690 Q786 690 786 646 L786 560"
          fill="none"
          stroke={live ? "#e3ec4a" : "#a9b7ca"}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray="30 38"
          filter={live ? "url(#sb-glow)" : undefined}
          className={clsx(live && "flow")}
        />

        {/* ---------------- the meter ---------------- */}
        <g filter="url(#sb-drop)" className={clsx(live && "bob")}>
          <rect x="132" y="176" width="336" height="316" rx="52" fill="url(#sb-body)" />
          <rect x="132" y="176" width="336" height="316" rx="52" fill="none" stroke="#a3b0c4" strokeWidth="3" />
          <path d="M178 176 A 122 96 0 0 1 422 176 Z" fill="url(#sb-dome)" />

          {/* register */}
          <rect x="176" y="216" width="248" height="72" rx="16" fill="#242a33" />
          <text
            x="300" y="268" textAnchor="middle" className="num"
            fill={live ? "#e3ec4a" : "#7c8798"}
            style={{ fontSize: 46, fontWeight: 700, letterSpacing: "0.05em" }}
          >
            {kwhCycle === null ? "----" : kwhCycle.toFixed(1)}
          </text>
          <text x="410" y="268" textAnchor="end" fill="#8d99a9" style={{ fontSize: 16, fontWeight: 700 }}>
            kWh
          </text>

          {/* induction disc */}
          <circle cx="300" cy="382" r="70" fill="#f2f6fb" stroke="#b3bfd0" strokeWidth="3" opacity="0.95" />
          <g
            className={clsx(discSeconds && "spin-disc")}
            style={discSeconds ? { animationDuration: `${discSeconds}s`, transformOrigin: "300px 382px" } : undefined}
          >
            <circle cx="300" cy="382" r="52" fill="none" stroke="#cfd8e5" strokeWidth="15" />
            <path d="M300 330 A 52 52 0 0 1 352 382 L300 382 Z" fill={live ? "#e3ec4a" : "#c3cddd"} />
            <circle cx="300" cy="382" r="8" fill="#2b2f37" />
          </g>

          {/* lamp */}
          <circle cx="432" cy="212" r="9" fill={live ? "#e3ec4a" : "#94a3b8"} className={clsx(live && "pulse-dot")} />
        </g>

        {/* ---------------- the home ---------------- */}
        <g filter="url(#sb-drop)">
          <path d="M672 560 L786 470 L900 560 Z" fill="#eef2f8" stroke="#a3b0c4" strokeWidth="3" strokeLinejoin="round" />
          <rect x="702" y="560" width="168" height="130" rx="14" fill="#f7f9fc" stroke="#a3b0c4" strokeWidth="3" />
          <rect
            x="758" y="600" width="58" height="52" rx="7"
            fill={live ? "#e3ec4a" : "#d5dce6"} opacity={live ? 0.95 : 0.6}
          />
        </g>

        {/* ---------------- the falling bill, and the person ---------------- */}
        <path
          d="M150 800 C 250 800 300 742 390 712 C 452 690 500 682 548 678"
          fill="none" stroke="url(#sb-fall)" strokeWidth="7" strokeLinecap="round"
        />
        {[[150, 800], [270, 776], [390, 712], [470, 690], [548, 678]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i === 4 ? 9 : 6} fill={i === 4 ? "#e3ec4a" : "#93a6c1"} />
        ))}
        <text x="150" y="838" fill="#4b5666" style={{ fontSize: 17, fontWeight: 700, letterSpacing: "0.18em" }}>
          BILL
        </text>

        <g className={clsx(live && "bob")} style={{ animationDelay: "0.9s" }}>
          <circle cx="640" cy="742" r="27" fill="#2b2f37" />
          <path d="M640 774 L640 838" stroke="#2b2f37" strokeWidth="18" strokeLinecap="round" />
          <path d="M640 838 L616 890 M640 838 L664 890" stroke="#2b2f37" strokeWidth="16" strokeLinecap="round" />
          <path d="M640 790 L594 752 M640 790 L686 752" stroke="#2b2f37" strokeWidth="16" strokeLinecap="round" />
          {savingPct !== null && savingPct > 0 && (
            <text x="640" y="700" textAnchor="middle" className="num" fill="#4d5500" style={{ fontSize: 25, fontWeight: 700 }}>
              −{savingPct.toFixed(0)}%
            </text>
          )}
        </g>

        {/* callout markers over the two components that physically exist */}
        {[{ x: 300, y: 382 }, { x: 786, y: 560 }].map((h) => (
          <g key={h.x}>
            <circle cx={h.x} cy={h.y} r="30" fill="#ffffff" opacity="0.18" />
            <circle cx={h.x} cy={h.y} r="10" fill="#ffffff" stroke="#7d8b9e" strokeWidth="3" />
          </g>
        ))}
      </svg>

      {/* A veil so glass cards on the right always sit on a calm field rather
          than on top of scene detail, without washing out the left third. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0) 26%, rgba(226,233,243,0.42) 52%, rgba(226,233,243,0.52) 100%)",
        }}
      />
    </div>
  );
}
