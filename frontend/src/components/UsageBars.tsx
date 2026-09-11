"use client";

import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";

import type { DailyBucket } from "@/lib/api";
import { useIsDark } from "@/lib/theme";

/**
 * Daily energy usage — the reference's bar chart.
 *
 * Bars carry a vertical charcoal gradient, pale at the foot and dark at the
 * head, exactly as the reference draws them. Today is the one accent bar so the
 * eye lands on the day the recommendation engine is budgeting for.
 *
 * The dashed rule is the household's own daily allowance — the tariff engine's
 * inverse of the saved target, divided across the cycle. A bar above the line
 * is a day that spent more than its share, which is the single most useful
 * thing this chart can say and costs no extra ink.
 *
 * NOTHING IS RECOMPUTED HERE. Bars are the API's daily totals; the rule is the
 * API's own allowance. The only arithmetic is choosing which bar is today.
 */
export default function UsageBars({
  days,
  dailyAllowanceKwh,
  windowDays = 14,
}: {
  days: DailyBucket[];
  dailyAllowanceKwh: number | null;
  windowDays?: number;
}) {
  const isDark = useIsDark();

  if (days.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center px-6 pb-6">
        <p className="text-sm text-ink-3">No daily totals for this cycle yet.</p>
      </div>
    );
  }

  const slice = days.slice(-windowDays);
  const data = slice.map((d) => ({
    label: d.bucket_start.slice(8, 10) + "/" + d.bucket_start.slice(5, 7),
    kwh: Number(d.total_energy_kwh.toFixed(2)),
    day: d.bucket_start,
  }));
  const todayIndex = data.length - 1;

  // Recharts takes color as a literal prop, not a class, so it cannot read
  // the --ink/--warn CSS tokens the rest of the app uses. #2b2f37 (dark
  // charcoal) as the bar color and #5c6673 for axis text were tuned for a
  // light card and read as near-invisible on a dark one — this branches the
  // same three colors on the same dark-mode signal every other component
  // reads from CSS, just resolved in JS since that is what recharts needs.
  const barColor = isDark ? "#c7cdd6" : "#2b2f37";
  const axisColor = isDark ? "#9aa5b4" : "#5c6673";
  const allowanceColor = isDark ? "#ff7a7e" : "#b32a2f";

  return (
    <div className="px-2 pb-4">
      <ResponsiveContainer width="100%" height={252}>
        <BarChart data={data} margin={{ top: 16, right: 14, left: -16, bottom: 4 }}>
          <defs>
            <linearGradient id="ub-bar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={barColor} stopOpacity={0.92} />
              <stop offset="100%" stopColor={barColor} stopOpacity={0.16} />
            </linearGradient>
            <linearGradient id="ub-today" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e3ec4a" stopOpacity={1} />
              <stop offset="100%" stopColor="#e3ec4a" stopOpacity={0.4} />
            </linearGradient>
          </defs>

          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: axisColor }}
            interval="preserveStartEnd"
            minTickGap={10}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: axisColor }}
            width={42}
          />

          {dailyAllowanceKwh !== null && dailyAllowanceKwh > 0 && (
            <ReferenceLine
              y={dailyAllowanceKwh}
              stroke={allowanceColor}
              strokeDasharray="5 5"
              strokeWidth={1.3}
              strokeOpacity={0.8}
              label={{
                value: `daily allowance ${dailyAllowanceKwh.toFixed(1)} kWh`,
                position: "insideTopRight",
                fill: allowanceColor,
                fontSize: 10,
                fontWeight: 600,
              }}
            />
          )}

          <Bar dataKey="kwh" radius={[6, 6, 2, 2]} maxBarSize={30} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={d.day} fill={i === todayIndex ? "url(#ub-today)" : "url(#ub-bar)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <p className="px-4 text-[11px] text-ink-3">
        Last {data.length} days.{" "}
        <span className="font-semibold text-ink-2">{data[todayIndex].label} highlighted</span> at{" "}
        <span className="num">{data[todayIndex].kwh.toFixed(2)}</span> kWh.
      </p>
    </div>
  );
}
