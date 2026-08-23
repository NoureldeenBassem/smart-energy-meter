"use client";

/**
 * Power-factor phase dial.
 *
 * This is the reference's wind-direction compass, and it is not a borrowed
 * shape: power factor IS an angle. PF = cos(phi), where phi is the phase
 * difference between the voltage and current waveforms, so a needle at
 * acos(PF) is the literal quantity rather than a number mapped onto a circle
 * for decoration.
 *
 * PF near 1.0 -> needle near horizontal, current in phase with voltage, almost
 * all the drawn power is doing real work. PF falling toward 0 swings the needle
 * up: motors and compressors pulling reactive power.
 *
 * The dial is drawn over 0..90 degrees only, because a household PF is
 * conventionally reported as a magnitude in [0, 1] and the sign (leading vs
 * lagging) is not in the telemetry contract. Showing a full 360 circle would
 * imply a direction the meter does not actually measure.
 */
export default function PhaseDial({
  powerFactor,
  voltage,
  current,
  stale = false,
}: {
  powerFactor: number | null;
  voltage: number | null;
  current: number | null;
  stale?: boolean;
}) {
  const pf =
    typeof powerFactor === "number" && Number.isFinite(powerFactor)
      ? Math.min(Math.max(Math.abs(powerFactor), 0), 1)
      : null;

  // acos gives phi in radians; 0 rad (PF 1) points right, pi/2 (PF 0) points up.
  const phiDeg = pf === null ? null : (Math.acos(pf) * 180) / Math.PI;

  const cx = 90;
  const cy = 90;
  const r = 62;

  const needle = (() => {
    if (phiDeg === null) return null;
    const a = (-phiDeg * Math.PI) / 180; // negative: SVG y grows downward
    return {
      x: cx + r * 0.82 * Math.cos(a),
      y: cy + r * 0.82 * Math.sin(a),
    };
  })();

  const accent = stale || pf === null ? "#94a3b8" : "#b9c21f";

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox="0 0 180 180"
        className="w-full max-w-[190px]"
        role="img"
        aria-label={
          pf === null
            ? "Power factor unavailable"
            : `Power factor ${pf.toFixed(2)}, phase angle ${phiDeg?.toFixed(0)} degrees`
        }
      >
        {/* concentric rings */}
        {[r, r * 0.72, r * 0.44].map((rad, i) => (
          <circle
            key={rad}
            cx={cx}
            cy={cy}
            r={rad}
            fill={i === 0 ? "#f4f6fa" : "none"}
            stroke="#dfe5ee"
            strokeWidth="1.5"
          />
        ))}

        {/* quadrant guides at 0, 30, 60, 90 degrees */}
        {[0, 30, 60, 90].map((deg) => {
          const a = (-deg * Math.PI) / 180;
          return (
            <line
              key={deg}
              x1={cx + r * 0.44 * Math.cos(a)}
              y1={cy + r * 0.44 * Math.sin(a)}
              x2={cx + r * Math.cos(a)}
              y2={cy + r * Math.sin(a)}
              stroke="#cfd8e5"
              strokeWidth="1.5"
            />
          );
        })}

        {/* axis labels: what each end of the sweep means */}
        <text x={cx + r + 10} y={cy + 4} textAnchor="middle" fill="#556070" style={{ fontSize: 10, fontWeight: 700 }}>
          1.0
        </text>
        <text x={cx} y={cy - r - 8} textAnchor="middle" fill="#556070" style={{ fontSize: 10, fontWeight: 700 }}>
          0.0
        </text>

        {/* the swept angle, filled */}
        {phiDeg !== null && (
          <path
            d={[
              `M ${cx} ${cy}`,
              `L ${cx + r * 0.72} ${cy}`,
              `A ${r * 0.72} ${r * 0.72} 0 0 0 ${
                cx + r * 0.72 * Math.cos((-phiDeg * Math.PI) / 180)
              } ${cy + r * 0.72 * Math.sin((-phiDeg * Math.PI) / 180)}`,
              "Z",
            ].join(" ")}
            fill={accent}
            opacity={stale ? 0.18 : 0.28}
          />
        )}

        {needle && (
          <g style={{ transition: "all 700ms ease-out" }}>
            <line
              x1={cx}
              y1={cy}
              x2={needle.x}
              y2={needle.y}
              stroke={accent}
              strokeWidth="3.5"
              strokeLinecap="round"
            />
            <circle cx={needle.x} cy={needle.y} r="4" fill={accent} />
          </g>
        )}
        <circle cx={cx} cy={cy} r="6" fill="#151b23" />

        <text
          x={cx}
          y={cy + 34}
          textAnchor="middle"
          className="num"
          fill="#0f172a"
          style={{ fontSize: 22, fontWeight: 700 }}
        >
          {pf === null ? "--" : pf.toFixed(2)}
        </text>
        <text
          x={cx}
          y={cy + 48}
          textAnchor="middle"
          fill="#556070"
          style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em" }}
        >
          POWER FACTOR
        </text>
      </svg>

      <dl className="mt-3 grid w-full grid-cols-3 gap-2 text-center">
        {[
          { label: "Voltage", value: voltage, unit: "V", digits: 1 },
          { label: "Current", value: current, unit: "A", digits: 2 },
          { label: "Phase", value: phiDeg, unit: "°", digits: 0 },
        ].map((f) => (
          <div key={f.label}>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
              {f.label}
            </dt>
            <dd className="num mt-0.5 text-sm font-bold text-ink">
              {typeof f.value === "number" && Number.isFinite(f.value)
                ? f.value.toFixed(f.digits)
                : "--"}
              <span className="ml-0.5 text-[11px] font-semibold text-ink-muted">{f.unit}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
