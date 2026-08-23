"use client";

import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import type { DailyBucket } from "@/lib/api";

/**
 * Daily consumption for the current billing cycle.
 *
 * Bars are hatched by default and ONE bar is solid accent — today. That is the
 * reference's treatment, and here it earns its place: the highlighted bar is the
 * day the rest of the dashboard is talking about, so the eye lands on the same
 * day the recommendation engine is budgeting for.
 *
 * The floating badge shows the predicted month-end bill rather than a percentage
 * change, because that is the number this product exists to produce. It is
 * anchored over today's bar so the projection is visually attached to the point
 * it is projecting from.
 *
 * NOTHING HERE IS RECOMPUTED IN THE BROWSER. Bars are the API's own daily
 * totals; the badge is the API's own predicted figure. The only arithmetic is
 * positioning.
 */

const HATCH_ID = "dc-hatch";

export default function DailyChart({
  days,
  todayISO,
  predictedBillEgp,
  averageKwh,
}: {
  days: DailyBucket[];
  todayISO: string;
  predictedBillEgp: number | null;
  averageKwh: number | null;
}) {
  if (days.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center px-5 pb-5">
        <p className="text-sm text-ink-muted">
          No daily totals for this cycle yet.
        </p>
      </div>
    );
  }

  const data = days.map((d) => ({
    day: d.bucket_start,
    label: new Date(d.bucket_start + "T00:00:00").getDate().toString().padStart(2, "0"),
    kwh: Number(d.total_energy_kwh.toFixed(3)),
    isToday: d.bucket_start === todayISO,
  }));

  const todayIndex = data.findIndex((d) => d.isToday);
  const highlightIndex = todayIndex >= 0 ? todayIndex : data.length - 1;
  const highlight = data[highlightIndex];

  // Badge sits over the highlighted bar. Percentage across the plot area, so it
  // tracks the bar on any container width.
  //
  // CLAMPED so it cannot leave the card. When the highlighted day is the newest
  // one it sits at the far right, and at 375px an unclamped badge pushed ~16px
  // past the edge and made the whole page scroll sideways. clamp() keeps it
  // fully inside; at that point the connector sits a few px off the bar, which
  // is the right trade against a horizontally scrolling document.
  const badgeLeftPct = ((highlightIndex + 0.5) / data.length) * 100;
  const badgeLeft = `clamp(46px, ${badgeLeftPct}%, calc(100% - 46px))`;

  return (
    <div className="relative px-2 pb-4">
      {predictedBillEgp !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2"
          style={{ left: badgeLeft }}
        >
          <div className="rounded-lg bg-surface-ink px-2.5 py-1.5 text-center shadow-[var(--shadow-ink)]">
            <div className="num text-[13px] font-bold leading-none text-accent">
              {predictedBillEgp.toLocaleString("en-EG", {
                maximumFractionDigits: 0,
              })}
            </div>
            <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-onDark-muted">
              EGP projected
            </div>
          </div>
          <div className="mx-auto h-2 w-px bg-surface-ink" />
        </div>
      )}

      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={data} margin={{ top: 56, right: 8, left: -18, bottom: 4 }}>
          <defs>
            <pattern
              id={HATCH_ID}
              patternUnits="userSpaceOnUse"
              width="6"
              height="6"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="#e3e9f2" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#c2ccdb" strokeWidth="3" />
            </pattern>
          </defs>

          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#556070" }}
            interval="preserveStartEnd"
            minTickGap={8}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#556070" }}
            width={44}
            tickFormatter={(v: number) => `${v}`}
          />

          {averageKwh !== null && (
            <ReferenceLine
              y={averageKwh}
              stroke="#556070"
              strokeDasharray="4 4"
              strokeWidth={1.25}
              label={{
                value: `avg ${averageKwh.toFixed(1)} kWh`,
                position: "insideTopRight",
                fill: "#556070",
                fontSize: 10,
              }}
            />
          )}

          <Bar dataKey="kwh" radius={[5, 5, 3, 3]} maxBarSize={26} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell
                key={d.day}
                fill={i === highlightIndex ? "#dce531" : `url(#${HATCH_ID})`}
                stroke={i === highlightIndex ? "#b9c21f" : "transparent"}
                strokeWidth={i === highlightIndex ? 1 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <p className="px-3 text-[11px] text-ink-muted">
        Daily kWh this cycle.{" "}
        <span className="font-semibold text-ink-soft">
          Day {highlight.label} highlighted
        </span>{" "}
        at {highlight.kwh.toFixed(2)} kWh
        {predictedBillEgp !== null && " — the badge is the projected month-end bill."}
      </p>
    </div>
  );
}
