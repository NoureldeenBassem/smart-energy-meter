"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import type { DailyBucket } from "@/lib/api";

/**
 * Cumulative consumption across the billing cycle, with the forecast carried
 * forward to cycle end.
 *
 * WHY CUMULATIVE, AND WHY A LINE
 * ------------------------------
 * The reference charts daily production as bars. Daily bars answer "what did I
 * use on the 14th?", which is not the question this product exists to answer.
 * The bill is a function of the RUNNING TOTAL against a progressive tariff, so
 * the cumulative curve is the quantity that actually decides what you pay —
 * and it is the only shape on which the forecast, the budget ceiling and the
 * bracket thresholds can all be drawn in the same space and compared by eye.
 *
 * Solid line: measured, day by day. Dashed continuation: where the forecast
 * lands at cycle end. The two are drawn in visibly different weights because
 * one is a measurement and the other is a projection, and a chart that renders
 * them identically is claiming a certainty it does not have.
 *
 * The budget ceiling is a horizontal rule. Where the dashed line crosses above
 * it, the overshoot is legible without reading a single number.
 *
 * NOTHING IS RECOMPUTED HERE. Points are the API's daily totals accumulated for
 * display; the endpoint is the API's own predicted_kwh; the ceiling is the
 * API's allowed kWh. The only arithmetic is the running sum and the geometry.
 */

export default function TrendChart({
  days,
  predictedKwh,
  predictedBillEgp,
  allowedKwh,
  cycleLengthDays,
}: {
  days: DailyBucket[];
  predictedKwh: number | null;
  predictedBillEgp: number | null;
  allowedKwh: number | null;
  cycleLengthDays: number | null;
}) {
  if (days.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center px-6 pb-6">
        <p className="text-sm text-ink-3">No daily totals for this cycle yet.</p>
      </div>
    );
  }

  const cycleDays = cycleLengthDays ?? 31;

  let running = 0;
  const measured = days.map((d) => {
    running += d.total_energy_kwh;
    const day = Number(d.bucket_start.slice(8, 10));
    return { day, actual: Number(running.toFixed(2)), forecast: null as number | null };
  });

  const lastDay = measured[measured.length - 1].day;
  const lastValue = measured[measured.length - 1].actual;

  // The projection: a straight carry from today's total to the forecast total at
  // cycle end. Deliberately straight — the model predicts the END POINT, not a
  // shape, and drawing a curve here would invent daily structure it never
  // produced.
  const projection: { day: number; actual: number | null; forecast: number | null }[] = [];
  if (predictedKwh !== null && cycleDays > lastDay) {
    for (let d = lastDay; d <= cycleDays; d++) {
      const t = (d - lastDay) / (cycleDays - lastDay);
      projection.push({
        day: d,
        actual: d === lastDay ? lastValue : null,
        forecast: Number((lastValue + (predictedKwh - lastValue) * t).toFixed(2)),
      });
    }
  }

  const data = [
    ...measured.map((m) => ({ ...m, forecast: m.day === lastDay ? lastValue : null })),
    ...projection.slice(1),
  ];

  const yMax = Math.max(
    predictedKwh ?? 0,
    allowedKwh ?? 0,
    lastValue,
  ) * 1.12;

  return (
    <div className="relative px-2 pb-5">
      <ResponsiveContainer width="100%" height={286}>
        <AreaChart data={data} margin={{ top: 46, right: 18, left: -14, bottom: 4 }}>
          <defs>
            <linearGradient id="tc-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e3ec4a" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#e3ec4a" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="#8698b4" strokeOpacity={0.22} strokeDasharray="2 6" vertical={false} />

          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#5c6673" }}
            tickFormatter={(d: number) => String(d).padStart(2, "0")}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#5c6673" }}
            width={46}
            domain={[0, Math.ceil(yMax / 50) * 50]}
            tickFormatter={(v: number) => `${v}`}
          />

          {allowedKwh !== null && (
            <ReferenceLine
              y={allowedKwh}
              stroke="#b32a2f"
              strokeOpacity={0.72}
              strokeDasharray="5 5"
              strokeWidth={1.4}
              label={{
                value: `budget ceiling ${allowedKwh.toFixed(0)} kWh`,
                position: "insideTopLeft",
                fill: "#b32a2f",
                fontSize: 10,
                fontWeight: 600,
              }}
            />
          )}

          {/* measured */}
          <Area
            type="monotone"
            dataKey="actual"
            stroke="#c9d223"
            strokeWidth={3}
            fill="url(#tc-fill)"
            connectNulls={false}
            isAnimationActive={false}
            dot={false}
          />
          {/* projection */}
          <Line
            type="linear"
            dataKey="forecast"
            stroke="#5c6673"
            strokeWidth={2}
            strokeDasharray="6 6"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />

          {/* today */}
          <ReferenceDot
            x={lastDay}
            y={lastValue}
            r={5.5}
            fill="#e3ec4a"
            stroke="#2b2f37"
            strokeWidth={2}
          />
          {/* cycle end */}
          {predictedKwh !== null && (
            <ReferenceDot
              x={cycleDays}
              y={predictedKwh}
              r={4.5}
              fill="#2b2f37"
              stroke="#ffffff"
              strokeWidth={2}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>

      {/* projection badge, echoing the reference's floating tooltip */}
      {predictedBillEgp !== null && (
        <div className="pointer-events-none absolute right-6 top-3">
          <div className="rounded-xl panel-ink px-3 py-2 text-center">
            <div className="num text-[15px] font-bold leading-none text-accent">
              {predictedBillEgp.toLocaleString("en-EG", { maximumFractionDigits: 0 })}
            </div>
            <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-on-dark-2">
              EGP at cycle end
            </div>
          </div>
        </div>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 text-[11px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-5 rounded-full bg-[#c9d223]" /> measured
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-5 rounded-full border-t-2 border-dashed border-[#5c6673]" /> forecast
        </span>
        {allowedKwh !== null && (
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-5 rounded-full border-t-2 border-dashed border-warn" /> budget ceiling
          </span>
        )}
      </div>
    </div>
  );
}
