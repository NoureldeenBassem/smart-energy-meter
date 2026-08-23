"use client";

/**
 * Live power gauge - a 270-degree SVG arc with ticks and a needle.
 *
 * Hand-drawn rather than pulled from recharts because a gauge is one arc, five
 * ticks and a needle, and RadialBarChart brings a whole chart lifecycle to draw it.
 *
 * THE SCALE IS FIXED, LABELLED, AND DERIVED FROM THE HOUSEHOLD
 * -----------------------------------------------------------
 * Full scale is the registered connected load - the sum of every appliance's rated
 * power, rounded up - and both endpoints are printed. Two rejected alternatives:
 *
 *   * A generic 3000 W dial. On this household (1650 W of registered appliances)
 *     the needle can never pass the halfway mark, so the top half of the dial is
 *     decoration and a genuinely heavy load looks moderate.
 *   * Auto-scaling to the current reading. That is the dishonest one: the needle
 *     would sit in the same place at 67 W and at 1600 W, and the dial would stop
 *     carrying information at all.
 *
 * The needle is drawn at every value, including very low ones. At 67 W of a 2000 W
 * connected load the arc fill is a few pixels wide, which reads as a broken
 * component rather than as "almost nothing is running" - the needle is what makes
 * a near-zero reading legible as a real measurement.
 *
 * If the reading exceeds full scale the arc and needle clamp at the top of the dial
 * and a line of text says so, so the overrun stays visible.
 */

const CX = 100;
const CY = 100;
const R = 78;
const SWEEP_DEG = 270;
const START_DEG = 135;
const ARC_LENGTH = (SWEEP_DEG / 360) * 2 * Math.PI * R;
const TICK_FRACTIONS = [0, 0.25, 0.5, 0.75, 1];

function polar(fraction: number, radius: number): [number, number] {
  const a = ((START_DEG + SWEEP_DEG * fraction) * Math.PI) / 180;
  return [CX + radius * Math.cos(a), CY + radius * Math.sin(a)];
}

const [X0, Y0] = polar(0, R);
const [X1, Y1] = polar(1, R);
const ARC_PATH = `M ${X0} ${Y0} A ${R} ${R} 0 1 1 ${X1} ${Y1}`;

/**
 * Full scale for a household: its total connected load rounded up to the next
 * 500 W, with a 1000 W floor so a household with one lamp still gets a sane dial.
 */
export function fullScaleFor(connectedLoadWatts: number): number {
  if (!Number.isFinite(connectedLoadWatts) || connectedLoadWatts <= 0) return 2000;
  return Math.max(1000, Math.ceil(connectedLoadWatts / 500) * 500);
}

export default function PowerGauge({
  watts,
  fullScaleWatts = 2000,
  scaleNote,
  stale = false,
}: {
  watts: number | null | undefined;
  fullScaleWatts?: number;
  scaleNote?: string;
  stale?: boolean;
}) {
  const value = typeof watts === "number" && Number.isFinite(watts) ? watts : null;
  const fraction =
    value === null ? 0 : Math.min(Math.max(value / fullScaleWatts, 0), 1);

  const colour =
    value === null || stale
      ? "#64748b"
      : fraction >= 0.75
        ? "#fb7185"
        : fraction >= 0.5
          ? "#fbbf24"
          : "#34d399";

  const [nx1, ny1] = polar(fraction, R - 21);
  const [nx2, ny2] = polar(fraction, R + 8);

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox="0 0 200 190"
        className="w-full max-w-[280px]"
        role="img"
        aria-label={
          value === null
            ? "Live power unavailable"
            : `Live power ${value.toFixed(0)} watts of a ${fullScaleWatts} watt scale`
        }
      >
        {/* Ticks, behind the arc */}
        {TICK_FRACTIONS.map((t) => {
          const [tx1, ty1] = polar(t, R - 12);
          const [tx2, ty2] = polar(t, R - 4);
          return (
            <line
              key={t}
              x1={tx1}
              y1={ty1}
              x2={tx2}
              y2={ty2}
              stroke="#334155"
              strokeWidth={2}
              strokeLinecap="round"
            />
          );
        })}

        {/* Track */}
        <path
          d={ARC_PATH}
          fill="none"
          stroke="#1e293b"
          strokeWidth={13}
          strokeLinecap="round"
        />
        {/* Value */}
        <path
          d={ARC_PATH}
          fill="none"
          stroke={colour}
          strokeWidth={13}
          strokeLinecap="round"
          strokeDasharray={ARC_LENGTH}
          strokeDashoffset={ARC_LENGTH * (1 - fraction)}
          style={{
            transition: "stroke-dashoffset 700ms ease-out, stroke 700ms ease-out",
          }}
        />

        {/* Needle - drawn at every value, so a near-zero reading is still legible */}
        {value !== null && (
          <g style={{ transition: "all 700ms ease-out" }}>
            <line
              x1={nx1}
              y1={ny1}
              x2={nx2}
              y2={ny2}
              stroke={colour}
              strokeWidth={3.5}
              strokeLinecap="round"
            />
            <circle cx={nx2} cy={ny2} r={3.5} fill={colour} />
          </g>
        )}

        <text
          x={CX}
          y={CY + 4}
          textAnchor="middle"
          className="fill-white"
          style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.02em" }}
        >
          {value === null ? "--" : value.toFixed(0)}
        </text>
        <text
          x={CX}
          y={CY + 26}
          textAnchor="middle"
          className="fill-slate-400"
          style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0.14em" }}
        >
          WATTS
        </text>

        {/* Endpoint labels, so the dial's scale is never a mystery. */}
        <text
          x={X0 - 1}
          y={Y0 + 21}
          textAnchor="middle"
          className="fill-slate-500"
          style={{ fontSize: 11 }}
        >
          0
        </text>
        <text
          x={X1 + 1}
          y={Y1 + 21}
          textAnchor="middle"
          className="fill-slate-500"
          style={{ fontSize: 11 }}
        >
          {fullScaleWatts}
        </text>
      </svg>

      {scaleNote && (
        <p className="mt-1 text-center text-xs text-slate-500">{scaleNote}</p>
      )}
      {value !== null && value > fullScaleWatts && (
        <p className="mt-1 text-xs font-semibold text-rose-400">
          Above the {fullScaleWatts} W dial range
        </p>
      )}
      {stale && (
        <p className="mt-1 text-center text-xs text-amber-400/90">
          Last stored reading - the meter is not reporting right now
        </p>
      )}
    </div>
  );
}
