"use client";

import { clsx } from "clsx";

/**
 * The page background — ONE full-bleed scene behind the entire app.
 *
 * An opened consumer unit: the meter body, the CT clamp on the incoming live
 * conductor, the ZMPT101B voltage module and the ESP32 on a carrier board, with
 * annotation callouts naming each part the way an installation diagram would.
 *
 * WHY ANNOTATED, AND WHY VECTOR
 * -----------------------------
 * The callouts are the point. This is a hardware project whose hardware has not
 * arrived, so the background does the job a photograph would: it shows what is
 * being built and names the parts. Every label points at a component that is in
 * the bill of materials — nothing is captioned that does not exist in the design.
 *
 * Vector rather than photograph: no licensing, no binary in the repo, it scales
 * to any viewport, it themes from the same tokens as the cards, and — the part a
 * photo cannot do — it reacts to live state.
 *
 * EVERY ANIMATION IS BOUND TO `live`. When the meter stops reporting the disc
 * halts, current stops flowing, the register freezes and the scene desaturates.
 * A background that animates while nothing is arriving is a lie told in motion.
 *
 * Composition is weighted into the left half: that is the region the card grid
 * deliberately leaves uncovered, the same way the reference leaves its panel
 * visible beside the data cards.
 */

type Callout = {
  /** anchor on the hardware */
  ax: number;
  ay: number;
  /** label box origin */
  lx: number;
  ly: number;
  title: string;
  sub?: string;
  /** which side the leader leaves the box from */
  side: "left" | "right";
};

const CALLOUTS: Callout[] = [
  { ax: 352, ay: 322, lx: 66, ly: 250, side: "right", title: "CT clamp", sub: "clamped, not cut" },
  { ax: 372, ay: 268, lx: 470, ly: 176, side: "left", title: "Non-invasive SCT-013", sub: "around the live conductor" },
  { ax: 548, ay: 470, lx: 640, ly: 404, side: "left", title: "ZMPT101B", sub: "isolated voltage sensing" },
  { ax: 402, ay: 596, lx: 66, ly: 566, side: "right", title: "Burden + bias network", sub: "centres the AC swing" },
  { ax: 556, ay: 620, lx: 646, ly: 638, side: "left", title: "ESP32 ADC", sub: "samples V and I" },
];

export default function SceneBackground({
  live,
  watts,
  kwhCycle,
}: {
  live: boolean;
  watts: number | null;
  kwhCycle: number | null;
  /** kept for call-site compatibility; the scene no longer prints a saving */
  savingPct?: number | null;
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
        className={clsx("h-full w-full transition-[filter] duration-1000", !live && "saturate-[0.4]")}
      >
        <defs>
          <linearGradient id="sc-room" x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0%" stopColor="#dfe6f0" />
            <stop offset="48%" stopColor="#bdcadc" />
            <stop offset="100%" stopColor="#93a3bd" />
          </linearGradient>
          <linearGradient id="sc-door" x1="0" y1="0" x2="1" y2="0.6">
            <stop offset="0%" stopColor="#e9eef6" />
            <stop offset="100%" stopColor="#b9c5d6" />
          </linearGradient>
          <linearGradient id="sc-box" x1="0" y1="0" x2="0.7" y2="1">
            <stop offset="0%" stopColor="#d3dbe7" />
            <stop offset="100%" stopColor="#9dabc0" />
          </linearGradient>
          <linearGradient id="sc-meter" x1="0" y1="0" x2="0.5" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="62%" stopColor="#e8eef6" />
            <stop offset="100%" stopColor="#c2ccdb" />
          </linearGradient>
          <linearGradient id="sc-pcb" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#2f6b4a" />
            <stop offset="100%" stopColor="#1d4a33" />
          </linearGradient>
          <filter id="sc-drop" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="22" stdDeviation="26" floodColor="#1a2430" floodOpacity="0.3" />
          </filter>
          <filter id="sc-glow" x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* ---------------- room ---------------- */}
        <rect width="1600" height="900" fill="url(#sc-room)" />
        <ellipse cx="700" cy="980" rx="1200" ry="300" fill="#8496b1" opacity="0.4" />

        {/* ---------------- enclosure, door swung open ---------------- */}
        <g filter="url(#sc-drop)">
          <path d="M132 96 L196 132 L196 828 L132 792 Z" fill="url(#sc-door)" opacity="0.96" />
          <rect x="196" y="132" width="516" height="696" rx="22" fill="url(#sc-box)" />
          <rect x="216" y="152" width="476" height="656" rx="14" fill="#c8d2e0" opacity="0.85" />
        </g>

        {/* ---------------- incoming conductors ---------------- */}
        {[
          { d: "M244 152 L244 296 Q244 322 270 322 L332 322", c: "#8b3a2a" },
          { d: "M286 152 L286 262 Q286 288 312 288 L332 288", c: "#2f3d63" },
          { d: "M328 152 L328 232 Q328 254 350 254 L392 254", c: "#4a5464" },
        ].map((w, i) => (
          <path key={i} d={w.d} fill="none" stroke={w.c} strokeWidth="17" strokeLinecap="round" opacity="0.9" />
        ))}

        {/* ---------------- CT clamp on the live conductor ---------------- */}
        <g filter="url(#sc-drop)">
          <rect x="316" y="284" width="74" height="80" rx="16" fill="#20262f" />
          <rect x="316" y="284" width="74" height="80" rx="16" fill="none" stroke="#39424f" strokeWidth="2" />
          <circle cx="352" cy="322" r="20" fill="none" stroke="#4d5866" strokeWidth="7" />
          <circle
            cx="352" cy="322" r="20" fill="none"
            stroke={live ? "#e3ec4a" : "#6d7a8b"} strokeWidth="3"
            strokeDasharray="5 8"
            className={clsx(live && "spin-slow")}
            style={{ transformOrigin: "352px 322px" }}
          />
        </g>

        {/* ---------------- meter body ---------------- */}
        <g filter="url(#sc-drop)">
          <rect x="290" y="392" width="322" height="196" rx="26" fill="url(#sc-meter)" />
          <rect x="290" y="392" width="322" height="196" rx="26" fill="none" stroke="#a6b2c5" strokeWidth="2.5" />

          {/* register */}
          <rect x="322" y="420" width="216" height="60" rx="10" fill="#212730" />
          <text
            x="430" y="463" textAnchor="middle" className="num"
            fill={live ? "#e3ec4a" : "#7c8798"}
            style={{ fontSize: 36, fontWeight: 700, letterSpacing: "0.06em" }}
          >
            {kwhCycle === null ? "----" : kwhCycle.toFixed(1)}
          </text>
          <text x="528" y="463" textAnchor="end" fill="#8d99a9" style={{ fontSize: 13, fontWeight: 700 }}>
            kWh
          </text>

          {/* induction disc */}
          <circle cx="356" cy="530" r="38" fill="#f1f5fb" stroke="#b0bccd" strokeWidth="2.5" />
          <g
            className={clsx(discSeconds && "spin-disc")}
            style={discSeconds ? { animationDuration: `${discSeconds}s`, transformOrigin: "356px 530px" } : undefined}
          >
            <circle cx="356" cy="530" r="28" fill="none" stroke="#cfd8e5" strokeWidth="9" />
            <path d="M356 502 A 28 28 0 0 1 384 530 L356 530 Z" fill={live ? "#e3ec4a" : "#c3cddd"} />
            <circle cx="356" cy="530" r="4.5" fill="#2b2f37" />
          </g>

          {/* ZMPT101B module */}
          <g>
            <rect x="512" y="440" width="72" height="56" rx="8" fill="#1f5fa8" />
            <rect x="524" y="452" width="48" height="20" rx="4" fill="#2a72c4" />
            <circle cx="548" cy="484" r="5" fill="#123f74" />
          </g>

          <circle cx="586" cy="418" r="6" fill={live ? "#e3ec4a" : "#94a3b8"} className={clsx(live && "pulse-dot")} />
        </g>

        {/* ---------------- carrier board with ESP32 ---------------- */}
        <g filter="url(#sc-drop)">
          <rect x="300" y="600" width="300" height="132" rx="12" fill="url(#sc-pcb)" />
          {/* traces */}
          {[622, 644, 666, 688, 710].map((y) => (
            <path key={y} d={`M316 ${y} H 470 Q 486 ${y} 486 ${y + 12} H 584`} fill="none" stroke="#5fbf8c" strokeWidth="2" opacity="0.4" />
          ))}
          {/* ESP32 */}
          <rect x="500" y="612" width="84" height="66" rx="7" fill="#1b232e" />
          <rect x="510" y="624" width="64" height="30" rx="4" fill="#2b3644" />
          <text x="542" y="670" textAnchor="middle" fill="#9fb0c6" style={{ fontSize: 10, fontWeight: 700 }}>ESP32</text>
          <circle cx="518" cy="639" r="3.4" fill={live ? "#e3ec4a" : "#5b6779"} className={clsx(live && "pulse-dot")} />
          {/* burden resistor + bias divider, drawn as parts */}
          <rect x="330" y="620" width="46" height="18" rx="4" fill="#d8c69a" />
          <rect x="330" y="656" width="46" height="18" rx="4" fill="#d8c69a" />
          <rect x="398" y="620" width="30" height="54" rx="5" fill="#2b3644" />
          {/* pin header */}
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <rect key={i} x={318 + i * 15} y={700} width="8" height="18" rx="2" fill="#c8b06a" />
          ))}
        </g>

        {/* ---------------- signal path: clamp -> board ---------------- */}
        <path
          d="M352 364 L352 392 M352 588 L352 600"
          stroke="#7d8b9e" strokeWidth="4" strokeLinecap="round" opacity="0.7"
        />
        <path
          d="M612 490 Q 700 490 700 660 Q 700 720 640 720 L600 720"
          fill="none" stroke="#8fa0b8" strokeWidth="9" strokeLinecap="round" opacity="0.5"
        />
        <path
          d="M612 490 Q 700 490 700 660 Q 700 720 640 720 L600 720"
          fill="none"
          stroke={live ? "#e3ec4a" : "#a9b7ca"}
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeDasharray="14 20"
          filter={live ? "url(#sc-glow)" : undefined}
          className={clsx(live && "flow")}
        />

        {/* ---------------- annotation callouts ---------------- */}
        {CALLOUTS.map((c) => {
          const boxW = Math.max(c.title.length, (c.sub ?? "").length) * 7.2 + 34;
          const boxH = c.sub ? 54 : 36;
          const from = c.side === "left" ? c.lx : c.lx + boxW;
          return (
            <g key={c.title}>
              {/* leader */}
              <path
                d={`M ${from} ${c.ly + boxH / 2} L ${(from + c.ax) / 2} ${c.ly + boxH / 2} L ${(from + c.ax) / 2} ${c.ay} L ${c.ax} ${c.ay}`}
                fill="none"
                stroke="#e3ec4a"
                strokeWidth="2.2"
                opacity="0.92"
              />
              <circle cx={c.ax} cy={c.ay} r="5.5" fill="#e3ec4a" stroke="#2b2f37" strokeWidth="1.6" />
              {/* label */}
              <rect x={c.lx} y={c.ly} width={boxW} height={boxH} rx="12" fill="#2b2f37" opacity="0.93" />
              <text x={c.lx + 17} y={c.ly + (c.sub ? 23 : 23)} fill="#f1f4f8" style={{ fontSize: 15, fontWeight: 700 }}>
                {c.title}
              </text>
              {c.sub && (
                <text x={c.lx + 17} y={c.ly + 42} fill="#9aa5b4" style={{ fontSize: 12 }}>
                  {c.sub}
                </text>
              )}
            </g>
          );
        })}

        {/* installation note, as the reference stamps one on the panel */}
        <text x="640" y="800" textAnchor="middle" fill="#4b5666" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.16em" }}>
          NON-INVASIVE INSTALL · NO CONDUCTOR CUT
        </text>
      </svg>

      {/* Veil so the card grid always sits on a calm field, without washing out
          the annotated hardware on the left. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0) 30%, rgba(226,233,243,0.44) 54%, rgba(226,233,243,0.56) 100%)",
        }}
      />
    </div>
  );
}
