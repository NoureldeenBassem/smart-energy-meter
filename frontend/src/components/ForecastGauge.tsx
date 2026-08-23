"use client";

/**
 * Half-circle forecast gauge — predicted bill against the budget target.
 *
 * The reference draws a 180° dial with a thick accent arc, a dark remainder and
 * a needle. Here the sweep is anchored to something real: full scale is the
 * user's target bill, so the needle's position IS the answer to "am I going to
 * overshoot?" — past the midpoint of the dark segment means the forecast has
 * passed the target.
 *
 * The badge is the percentage over or under target, not a decorative delta.
 * It only renders when a target exists; with no budget set there is nothing to
 * be a percentage of, and inventing one would be worse than leaving it out.
 */

const CX = 150;
const CY = 148;
const R = 108;
const W = 30;

function polar(fraction: number, radius: number): [number, number] {
  const a = (180 + 180 * fraction) * (Math.PI / 180);
  return [CX + radius * Math.cos(a), CY + radius * Math.sin(a)];
}

function arcPath(from: number, to: number, radius: number) {
  const [x0, y0] = polar(from, radius);
  const [x1, y1] = polar(to, radius);
  const large = to - from > 0.5 ? 1 : 0;
  return `M ${x0} ${y0} A ${radius} ${radius} 0 ${large} 1 ${x1} ${y1}`;
}

export default function ForecastGauge({
  predictedEgp,
  targetEgp,
  stale = false,
}: {
  predictedEgp: number | null;
  targetEgp: number | null;
  stale?: boolean;
}) {
  const hasScale = targetEgp !== null && targetEgp > 0;

  // Full scale is 1.4x the target, so the target sits at ~71% of the dial and
  // an overshoot still has somewhere to point instead of pinning at the end.
  const fullScale = hasScale ? targetEgp * 1.4 : null;
  const fraction =
    predictedEgp !== null && fullScale
      ? Math.min(Math.max(predictedEgp / fullScale, 0), 1)
      : null;
  const targetFraction = hasScale && fullScale ? targetEgp / fullScale : null;

  const deltaPct =
    predictedEgp !== null && hasScale
      ? ((predictedEgp - targetEgp) / targetEgp) * 100
      : null;

  const over = deltaPct !== null && deltaPct > 0;
  const arcColour = stale ? "#8593a5" : over ? "#f2726b" : "#e3ec4a";

  const [nx, ny] = fraction !== null ? polar(fraction, R - 6) : [CX, CY];

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-full max-w-[300px]">
        <svg
          viewBox="0 0 300 200"
          className="w-full"
          role="img"
          aria-label={
            predictedEgp === null
              ? "Bill forecast unavailable"
              : hasScale
                ? `Forecast ${predictedEgp.toFixed(0)} EGP against a ${targetEgp.toFixed(0)} EGP target`
                : `Forecast ${predictedEgp.toFixed(0)} EGP, no target set`
          }
        >
          {/* remainder */}
          <path
            d={arcPath(0, 1, R)}
            fill="none"
            stroke="#2b2f37"
            strokeWidth={W}
            strokeLinecap="round"
            opacity={0.9}
          />
          {/* value */}
          {fraction !== null && fraction > 0.005 && (
            <path
              d={arcPath(0, fraction, R)}
              fill="none"
              stroke={arcColour}
              strokeWidth={W}
              strokeLinecap="round"
              style={{ transition: "stroke 700ms ease-out" }}
            />
          )}

          {/* target tick — where the budget actually sits on the sweep */}
          {targetFraction !== null && (
            <g>
              <line
                x1={polar(targetFraction, R - W / 2 - 5)[0]}
                y1={polar(targetFraction, R - W / 2 - 5)[1]}
                x2={polar(targetFraction, R + W / 2 + 5)[0]}
                y2={polar(targetFraction, R + W / 2 + 5)[1]}
                stroke="#21262d"
                strokeWidth={3}
                strokeLinecap="round"
              />
            </g>
          )}

          {/* needle */}
          {fraction !== null && (
            <g style={{ transition: "all 800ms cubic-bezier(0.22,1,0.36,1)" }}>
              <path
                d={`M ${CX - 6} ${CY} L ${nx} ${ny} L ${CX + 6} ${CY} Z`}
                fill="#f7f9fc"
                stroke="#98a4b5"
                strokeWidth={1}
              />
              <circle cx={CX} cy={CY} r={9} fill="#f7f9fc" stroke="#98a4b5" strokeWidth={1.5} />
              <circle cx={CX} cy={CY} r={3.5} fill="#2b2f37" />
            </g>
          )}

          {/* endpoint labels */}
          <text x={CX - R} y={CY + 24} textAnchor="middle" fill="#5c6673" style={{ fontSize: 11, fontWeight: 600 }}>
            0
          </text>
          <text x={CX + R} y={CY + 24} textAnchor="middle" fill="#5c6673" style={{ fontSize: 11, fontWeight: 600 }}>
            {fullScale ? fullScale.toFixed(0) : "--"}
          </text>
        </svg>

        {/* delta badge, sitting over the arc as in the reference */}
        {deltaPct !== null && (
          <span
            className={`num absolute right-1 top-1 rounded-lg px-2 py-1 text-[11px] font-bold ${
              over ? "bg-warn text-white" : "bg-accent text-ink-panel"
            }`}
          >
            {deltaPct > 0 ? "+" : ""}
            {deltaPct.toFixed(1)}%
          </span>
        )}
      </div>

      <div className="-mt-3 text-center">
        <div className="num text-[34px] font-bold leading-none text-ink">
          {predictedEgp === null ? "--" : predictedEgp.toFixed(0)}
        </div>
        <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
          Predicted bill (EGP)
        </div>
        {hasScale && (
          <div className="num mt-1 text-[11px] text-ink-3">
            target {targetEgp.toFixed(0)} EGP
          </div>
        )}
      </div>
    </div>
  );
}
