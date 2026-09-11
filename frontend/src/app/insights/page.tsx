"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { ArrowRight, FileText, Gauge, Target, TrendingUp, Activity } from "lucide-react";
import { clsx } from "clsx";
import Link from "next/link";

import Shell from "@/components/Shell";
import { Card, CardHead } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  apiErrorMessage,
  fetchDailyTelemetry,
  fetchPrediction,
  fetchTariffBrackets,
  fetchNilmBreakdown,
  type DailyBucket,
  type Prediction,
  type TariffBracket,
  type NilmBreakdown,
} from "@/lib/api";

/**
 * Insights — NEW screen added in Phase 4.
 *
 * Five KPI groups, all consuming existing endpoints:
 * 1. Weekly Trend (area chart, 7d) — /telemetry/daily
 * 2. Monthly Tariff Position (stacked bar, 7 brackets) — /tariff/brackets + /predictions
 * 3. Data Quality (stat tile + badge) — /predictions.data_quality
 * 4. Forecast Accuracy (mini stat, model vs naive) — /predictions
 * 5. Peak Hours Heatmap (calendar grid, 30d) — /telemetry/daily (we approximate from daily totals)
 */

interface WeeklyPoint {
  day: string;      // YYYY-MM-DD
  label: string;    // "Mon 25"
  kwh: number;
}

interface BracketPoint {
  bracket: number;
  label: string;    // "1", "2", ...
  used: number;     // kWh consumed in this bracket
  capacity: number; // kWh capacity of bracket
  price: number;    // EGP/kWh
  color: string;
}

function InsightsBody({ deviceId }: { deviceId: string }) {
  const [daily, setDaily] = useState<DailyBucket[]>([]);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [brackets, setBrackets] = useState<TariffBracket[]>([]);
  const [nilm, setNilm] = useState<NilmBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [days, pred, br, nl] = await Promise.allSettled([
          fetchDailyTelemetry(deviceId, 30),
          fetchPrediction(deviceId),
          fetchTariffBrackets(),
          fetchNilmBreakdown(deviceId, 24),
        ]);
        if (days.status === "fulfilled") setDaily(days.value);
        if (pred.status === "fulfilled") setPrediction(pred.value);
        if (br.status === "fulfilled") setBrackets(br.value);
        if (nl.status === "fulfilled") setNilm(nl.value);
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(apiErrorMessage(err, "Could not load insights."));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="pulse-dot h-9 w-9 rounded-full bg-accent" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border border-warn/25 bg-warn-wash p-5 text-sm text-warn rise d1">
        {error}
      </Card>
    );
  }

  // ---- Weekly Trend Data (last 7 days) ----
  const weeklyData: WeeklyPoint[] = (() => {
    if (daily.length === 0) return [];
    const last7 = daily.slice(-7);
    return last7.map((d) => {
      const date = new Date(d.bucket_start + "T00:00:00");
      const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
      const dayNum = date.getDate();
      return {
        day: d.bucket_start,
        label: `${dayName} ${dayNum}`,
        kwh: Number(d.total_energy_kwh.toFixed(2)),
      };
    });
  })();

  // ---- Tariff Position Data (stacked bar) ----
  const tariffData: BracketPoint[] = (() => {
    if (brackets.length === 0 || !prediction) return [];
    const consumed = prediction.tariff_position.consumption_kwh;
    let remaining = consumed;
    return brackets.map((b) => {
      const cap = b.kwh_to !== null ? b.kwh_to - b.kwh_from : remaining;
      const used = Math.max(0, Math.min(cap, remaining));
      remaining -= used;
      // Build gradient colors per bracket — accent for current, charcoal for past, muted for future
      let color: string;
      if (b.bracket_order === prediction.tariff_position.active_bracket) {
        color = "url(#tp-active)";
      } else if (b.bracket_order < (prediction.tariff_position.active_bracket ?? 0)) {
        color = "url(#tp-used)";
      } else {
        color = "url(#tp-future)";
      }
      return {
        bracket: b.bracket_order,
        label: `#${b.bracket_order}`,
        used,
        capacity: cap,
        price: b.price_per_kwh,
        color,
      };
    });
  })();

  // ---- Peak Hours Heatmap Data (approximated from daily totals) ----
  // We don't have hourly data from the API, so we build a calendar heatmap
  // from daily totals over the last 30 days. Each cell = one day.
  const heatmapData = (() => {
    if (daily.length === 0) return [];
    const last30 = daily.slice(-30);
    // Find max for color scaling
    const maxKwh = Math.max(...last30.map((d) => d.total_energy_kwh), 1);
    return last30.map((d) => ({
      day: d.bucket_start,
      kwh: d.total_energy_kwh,
      intensity: d.total_energy_kwh / maxKwh, // 0-1
    }));
  })();

  // ---- Forecast Accuracy ----
  const forecastAccuracy = prediction
    ? prediction.prediction_method === "model"
      ? prediction.naive_prediction_kwh > 0
        ? ((1 - Math.abs(prediction.predicted_kwh - prediction.naive_prediction_kwh) / prediction.naive_prediction_kwh) * 100)
        : 100
      : 0
    : null;

  const naiveError = prediction
    ? prediction.prediction_method === "model"
      ? Math.abs(prediction.predicted_kwh - prediction.naive_prediction_kwh)
      : null
    : null;

  // ---- Current day index for highlighting ----
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayIndex = daily.findIndex((d) => d.bucket_start === todayStr);

  return (
    <div className="space-y-4">
      {/* ============ HERO: Weekly Trend ============ */}
      <Card className="rise d1 p-5">
        <CardHead
          title="Weekly Trend"
          hint="Daily energy over the last 7 days"
          action={
            <Link
              href="/overview"
              aria-label="View full 14-day chart"
              className="grid h-8 w-8 place-items-center rounded-full bg-white/60 text-ink-3 transition hover:bg-ink-panel hover:text-accent"
            >
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          }
        />
        {weeklyData.length === 0 ? (
          <div className="flex h-[250px] items-center justify-center text-sm text-ink-3">
            No data for the last 7 days.
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart
                data={weeklyData}
                margin={{ top: 8, right: 8, left: -24, bottom: 4 }}
              >
                <defs>
                  <linearGradient id="wt-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e3ec4a" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#e3ec4a" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="wt-line" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e3ec4a" stopOpacity={1} />
                    <stop offset="100%" stopColor="#e3ec4a" stopOpacity={0.6} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff40" vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "#5c6673" }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "#5c6673" }}
                  width={42}
                  tickFormatter={(v) => `${v}kWh`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(255,255,255,0.95)",
                    border: "1px solid rgba(255,255,255,0.6)",
                    borderRadius: "12px",
                    boxShadow: "0 8px 32px -8px rgba(30,41,59,0.28)",
                    backdropFilter: "blur(16px)",
                  }}
                  formatter={(v) => [`${Number(v).toFixed(2)} kWh`, "Energy"]}
                />
                <Area
                  type="monotone"
                  dataKey="kwh"
                  stroke="url(#wt-line)"
                  strokeWidth={2}
                  fill="url(#wt-area)"
                  fillOpacity={1}
                  isAnimationActive={false}
                />
                {/* Today marker */}
                {weeklyData.map((d, i) =>
                  i === weeklyData.length - 1 ? (
                    <Cell key={d.day} fill="#e3ec4a" r={4} />
                  ) : null
                )}
              </AreaChart>
            </ResponsiveContainer>
            <p className="mt-3 px-2 text-[11px] text-ink-3">
              <span className="font-semibold text-ink-2">
                {weeklyData[weeklyData.length - 1].label}
              </span>{" "}
              highlighted at{" "}
              <span className="num">{weeklyData[weeklyData.length - 1].kwh.toFixed(2)}</span>{" "}
              kWh.{" "}
              {weeklyData.length > 1 && (
                <>
                  {weeklyData[weeklyData.length - 1].kwh > weeklyData[weeklyData.length - 2].kwh ? (
                    <span className="text-amber">↑ vs previous day</span>
                  ) : (
                    <span className="text-accent-ink">↓ vs previous day</span>
                  )}
                </>
              )}
            </p>
          </>
        )}
      </Card>

      {/* ============ LARGE: Monthly Tariff Position ============ */}
      <Card className="rise d2 p-5">
        <CardHead
          title="Monthly Tariff Position"
          hint="Where your consumption sits in the 7-bracket tariff"
          action={
            <Link
              href="/budget"
              aria-label="Open budget planner"
              className="grid h-8 w-8 place-items-center rounded-full bg-white/60 text-ink-3 transition hover:bg-ink-panel hover:text-accent"
            >
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          }
        />
        {tariffData.length === 0 ? (
          <div className="flex h-[250px] items-center justify-center text-sm text-ink-3">
            No tariff brackets loaded.
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={tariffData}
                layout="vertical"
                margin={{ top: 8, right: 8, left: -16, bottom: 4 }}
              >
                <defs>
                  <linearGradient id="tp-used" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2b2f37" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#2b2f37" stopOpacity={0.4} />
                  </linearGradient>
                  <linearGradient id="tp-active" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e3ec4a" stopOpacity={1} />
                    <stop offset="100%" stopColor="#e3ec4a" stopOpacity={0.5} />
                  </linearGradient>
                  <linearGradient id="tp-future" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8698b4" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#8698b4" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff40" horizontal={false} />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "#5c6673" }}
                  tickFormatter={(v) => `${v}kWh`}
                />
                <YAxis
                  dataKey="label"
                  type="category"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "#3d4650", fontWeight: 600 }}
                  width={36}
                  interval={0}
                  reversed
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(255,255,255,0.95)",
                    border: "1px solid rgba(255,255,255,0.6)",
                    borderRadius: "12px",
                    boxShadow: "0 8px 32px -8px rgba(30,41,59,0.28)",
                    backdropFilter: "blur(16px)",
                  }}
                  formatter={(v, name) =>
                    name === "used"
                      ? [`${Number(v).toFixed(2)} kWh used`, "Used"]
                      : name === "capacity"
                        ? [`${Number(v).toFixed(2)} kWh capacity`, "Capacity"]
                        : [`${Number(v).toFixed(2)} EGP/kWh`, "Rate"]
                  }
                />
                <Legend
                  wrapperStyle={{ paddingTop: 8 }}
                  formatter={(value: string) => [
                    value === "used" ? "Consumed" : value === "capacity" ? "Bracket capacity" : "Rate",
                  ]}
                />
                <Bar dataKey="used" name="Consumed" fill="url(#tp-used)" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {tariffData.map((d) => (
                    <Cell key={d.bracket} fill={d.color} />
                  ))}
                </Bar>
                <Bar dataKey="capacity" name="Bracket capacity" fill="url(#tp-future)" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {tariffData.map((d) => (
                    <Cell key={d.bracket} fill={d.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label="Current bracket"
                value={
                  prediction && prediction.tariff_position.active_bracket !== null
                    ? `#${prediction.tariff_position.active_bracket}`
                    : "--"
                }
                note={
                  prediction &&
                  prediction.tariff_position.price_per_kwh_current !== null
                    ? `${prediction.tariff_position.price_per_kwh_current} EGP/kWh`
                    : undefined
                }
              />
              <StatTile
                label="kWh in current bracket"
                value={
                  prediction &&
                  prediction.tariff_position.kwh_remaining_in_bracket !== null
                    ? prediction.tariff_position.kwh_remaining_in_bracket.toFixed(2)
                    : "--"
                }
                unit="kWh"
                note="Remaining before next bracket"
              />
              <StatTile
                label="Cycle consumption"
                value={prediction?.kwh_so_far.toFixed(1) ?? "--"}
                unit="kWh"
                note={prediction ? `${prediction.cycle_length_days}d cycle` : undefined}
              />
              <StatTile
                label="Cycle bill so far"
                value={prediction?.bill_so_far_egp.toFixed(0) ?? "--"}
                unit="EGP"
                note="From consumed kWh"
              />
            </div>
          </>
        )}
      </Card>

      {/* ============ MEDIUM: Data Quality + Forecast Accuracy ============ */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Data Quality */}
        <Card className="rise d3 p-5">
          <CardHead
            title="Data Quality"
            hint="Coverage of daily readings this cycle"
          />
          {prediction?.data_quality ? (
            <>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="num text-[34px] font-bold leading-none text-ink">
                    {prediction.data_quality.days_with_readings}/{prediction.data_quality.days_elapsed}
                  </p>
                  <p className="mt-1 text-sm text-ink-3">Days with readings / elapsed</p>
                </div>
                <div className="text-right">
                  <p
                    className={clsx(
                      "num text-[24px] font-bold",
                      prediction.data_quality.day_coverage >= 0.9
                        ? "text-accent-ink"
                        : prediction.data_quality.day_coverage >= 0.7
                          ? "text-amber"
                          : "text-warn",
                    )}
                  >
                    {Math.round(prediction.data_quality.day_coverage * 100)}%
                  </p>
                  <p className="mt-1 text-sm text-ink-3">Coverage</p>
                </div>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-white/45">
                <div
                  className={clsx(
                    "h-full rounded-full transition-all duration-700",
                    prediction.data_quality.day_coverage >= 0.9
                      ? "bg-accent"
                      : prediction.data_quality.day_coverage >= 0.7
                        ? "bg-amber"
                        : "bg-warn",
                  )}
                  style={{ width: `${prediction.data_quality.day_coverage * 100}%` }}
                />
              </div>
              {prediction.data_quality.warning && (
                <p className="mt-3 text-sm text-amber">{prediction.data_quality.warning}</p>
              )}
              <div className="mt-4 flex items-center gap-2 text-xs text-ink-3">
                <FileText className="h-3.5 w-3.5" aria-hidden />
                <span>{prediction.data_quality.days_missing} days missing this cycle</span>
              </div>
            </>
          ) : (
            <p className="text-sm text-ink-3">No data quality info available.</p>
          )}
        </Card>

        {/* Forecast Accuracy */}
        <Card className="rise d4 p-5">
          <CardHead
            title="Forecast Accuracy"
            hint="Model vs naive persistence baseline"
          />
          {prediction ? (
            <>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="num text-[34px] font-bold leading-none text-ink">
                    {prediction.prediction_method === "model" ? "Model" : "Naive"}
                  </p>
                  <p className="mt-1 text-sm text-ink-3">Active method</p>
                </div>
                <div className="text-right">
                  {forecastAccuracy !== null && (
                    <p
                      className={clsx(
                        "num text-[24px] font-bold",
                        forecastAccuracy >= 80 ? "text-accent-ink" : forecastAccuracy >= 50 ? "text-amber" : "text-warn",
                      )}
                    >
                      {forecastAccuracy.toFixed(1)}%
                    </p>
                  )}
                  {forecastAccuracy === null && <p className="num text-[24px] font-bold text-ink">--</p>}
                  <p className="mt-1 text-sm text-ink-3">vs naive baseline</p>
                </div>
              </div>
              {prediction.prediction_method === "model" && (
                <>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <dt className="text-ink-3">Predicted kWh</dt>
                    <dd className="num font-bold text-ink">{prediction.predicted_kwh.toFixed(2)}</dd>
                    <dt className="text-ink-3">Naive baseline</dt>
                    <dd className="num font-bold text-ink">{prediction.naive_prediction_kwh.toFixed(2)}</dd>
                    <dt className="text-ink-3">Model correction</dt>
                    <dd className="num font-bold text-accent-ink">{prediction.model_correction_kwh.toFixed(2)}</dd>
                    <dt className="text-ink-3">Error vs naive</dt>
                    <dd className="num font-bold text-ink">{naiveError?.toFixed(2)} kWh</dd>
                  </dl>
                  <div className="mt-3 text-[11px] text-ink-3">
                    <span className="font-semibold">Model: </span>{prediction.model_version}{" "}
                    {prediction.confidence_basis && (
                      <>
                        <span aria-hidden className="text-ink-3/50 mx-2">|</span>
                        <span className="font-semibold">Basis: </span>{prediction.confidence_basis}
                      </>
                    )}
                  </div>
                </>
              )}
              {prediction.prediction_method !== "model" && (
                <p className="mt-3 rounded-lg bg-warn-wash p-2.5 text-[11px] font-medium leading-relaxed text-warn">
                  Model withheld: {prediction.fallback_reason}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-ink-3">No prediction data.</p>
          )}
        </Card>
      </div>

      {/* ============ MEDIUM: Peak Hours Heatmap ============ */}
      <Card className="rise d5 p-5">
        <CardHead
          title="Peak Hours Heatmap"
          hint="Daily energy intensity over the last 30 days"
        />
        {heatmapData.length === 0 ? (
          <div className="flex h-[180px] items-center justify-center text-sm text-ink-3">
            No daily data for heatmap.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto pb-2">
              <div className="grid grid-cols-7 gap-1.5 min-w-[380px]">
                {/* Weekday headers */}
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <div key={d} className="text-center text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-3 pb-1">
                    {d}
                  </div>
                ))}
                {/* Day cells — simplified: just sequential grid */}
                {heatmapData.map((d, i) => (
                  <div
                    key={d.day}
                    className={clsx(
                      "relative aspect-square rounded-lg transition",
                      `bg-white/${Math.round(30 + d.intensity * 60)}`,
                      d.intensity > 0.7 && "ring-2 ring-accent-2",
                      d.day === daily[daily.length - 1]?.bucket_start && "ring-2 ring-accent",
                    )}
                    title={`${d.day}: ${d.kwh.toFixed(2)} kWh`}
                  >
                    <span className="absolute bottom-1 right-1 text-[9px] font-bold text-ink-2">
                      {d.kwh.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-ink-3">
              <span>
                <span className="inline-block w-3 h-3 rounded bg-white/30 mr-1.5" />
                Low
              </span>
              <span>
                <span className="inline-block w-3 h-3 rounded bg-white/60 mr-1.5" />
                Medium
              </span>
              <span>
                <span className="inline-block w-3 h-3 rounded bg-white/90 mr-1.5" />
                High
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded ring-2 ring-accent" />
                Today
              </span>
            </div>
          </>
        )}
      </Card>

      {/* ============ FOOTER: Key metrics summary ============ */}
      <Card className="rise d6 p-5">
        <SectionHeading title="Key Metrics" subtitle="Cycle snapshot" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Cycle start"
            value={prediction ? new Date(prediction.cycle_start_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "--"}
          />
          <StatTile
            label="Days remaining"
            value={prediction ? String(prediction.days_remaining_in_cycle) : "--"}
            unit="days"
          />
          <StatTile
            label="Predicted bill"
            value={prediction ? prediction.predicted_bill_egp.toFixed(0) : "--"}
            unit="EGP"
            emphasis
          />
          <StatTile
            label="Confidence band"
            value={
              prediction
                ? `${prediction.confidence_bill_low_egp.toFixed(0)}–${prediction.confidence_bill_high_egp.toFixed(0)}`
                : "--"
            }
            unit="EGP"
          />
        </div>
      </Card>

      {/* ============ NILM: appliance activity inferred from the single sensor ============ */}
      <Card className="rise d7 p-5">
        <SectionHeading
          title="Appliance Activity"
          subtitle={`Detected from the meter alone, last ${nilm ? Math.round((new Date(nilm.window_end).getTime() - new Date(nilm.window_start).getTime()) / 3600000) : 24}h`}
        />
        {!nilm ? (
          <p className="mt-4 text-sm text-ink-3">No NILM data yet — needs at least one appliance ON/OFF transition in the window.</p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-2xl bg-white/60 p-3">
                <p className="num text-xl font-bold text-ink">{nilm.matched_events}</p>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-3">Matched</p>
              </div>
              <div className="rounded-2xl bg-white/60 p-3">
                <p className="num text-xl font-bold text-ink">{nilm.ambiguous_events}</p>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-3">Ambiguous</p>
              </div>
              <div className="rounded-2xl bg-white/60 p-3">
                <p className="num text-xl font-bold text-ink">{nilm.unmatched_events}</p>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-3">Unmatched</p>
              </div>
            </div>
            {nilm.appliances.filter((a) => a.on_events > 0).length === 0 ? (
              <p className="mt-4 text-sm text-ink-3">
                No appliance transitions detected yet in this window — an appliance already running when the window
                started stays invisible until its next OFF/ON event; this is a known limitation, not an error.
              </p>
            ) : (
              <div className="mt-4 space-y-2">
                {nilm.appliances
                  .filter((a) => a.on_events > 0)
                  .map((a) => (
                    <div
                      key={a.appliance_id}
                      className="flex items-center justify-between rounded-2xl bg-white/60 px-4 py-3"
                    >
                      <div className="flex items-center gap-2.5">
                        <Activity className="h-4 w-4 text-accent-ink" aria-hidden />
                        <div>
                          <p className="text-sm font-semibold text-ink">{a.name}</p>
                          <p className="text-[11px] text-ink-3">
                            {a.on_events} event{a.on_events === 1 ? "" : "s"} · {a.estimated_runtime_hours.toFixed(2)} h
                            {a.is_essential && " · essential"}
                          </p>
                        </div>
                      </div>
                      <p className="num text-sm font-bold text-ink">{a.estimated_energy_kwh.toFixed(3)} kWh</p>
                    </div>
                  ))}
              </div>
            )}
            <p className="mt-3 text-[11px] text-ink-3">
              Estimated from step changes in the aggregate power signal, matched against each appliance's registered
              wattage — not a per-appliance sensor. See SUBMISSION_STATUS.md §4b.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}

export default function InsightsPage() {
  return <Shell>{(deviceId) => <InsightsBody deviceId={deviceId} />}</Shell>;
}