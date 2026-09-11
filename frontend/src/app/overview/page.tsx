"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ChevronDown,
  Lock,
  Refrigerator,
  Lightbulb,
  AirVent,
  Flame,
  WashingMachine,
  Plug,
  Thermometer,
  TriangleAlert,
} from "lucide-react";
import { clsx } from "clsx";

import Shell from "@/components/Shell";
import AlertBanner from "@/components/AlertBanner";
import PhaseDial from "@/components/PhaseDial";
import ForecastGauge from "@/components/ForecastGauge";
import UsageBars from "@/components/UsageBars";
import PowerGauge, { fullScaleFor } from "@/components/PowerGauge";
import { Card, CardHead } from "@/components/ui/Card";
import { ThresholdBar } from "@/components/ui/ThresholdBar";
import {
  apiErrorMessage,
  fetchAllowance,
  fetchDailyTelemetry,
  fetchPrediction,
  fetchRecommendations,
  fetchTelemetry,
  type Allocation,
  type DailyBucket,
  type Prediction,
  type RecommendationDashboard,
  type TelemetryDashboard,
} from "@/lib/api";

/**
 * Overview — redesigned for mobile-first KPI hierarchy.
 *
 * Primary:  Current Consumption (PowerGauge hero)
 * Secondary: Today's kWh, Predicted Bill, Budget Progress
 * Chart:    Energy Usage (14-day bars)
 * AI:       Appliance Recommendations (top 4)
 * Strip:    Phase Dial
 */

const LIVE_POLL_MS = 5000;
const FORECAST_POLL_MS = 30000;

/** Appliance name -> icon */
function applianceIcon(name: string) {
  const n = name.toLowerCase();
  if (n.includes("fridge") || n.includes("refriger")) return Refrigerator;
  if (n.includes("light")) return Lightbulb;
  if (n.includes("air") || n.includes("ac") || n.includes("condition")) return AirVent;
  if (n.includes("heater") || n.includes("water")) return Flame;
  if (n.includes("wash")) return WashingMachine;
  return Plug;
}

function OverviewBody({ deviceId }: { deviceId: string }) {
  const [telemetry, setTelemetry] = useState<TelemetryDashboard | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [recs, setRecs] = useState<RecommendationDashboard | null>(null);
  const [daily, setDaily] = useState<DailyBucket[]>([]);
  const [allowedKwh, setAllowedKwh] = useState<number | null>(null);

  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [predictionError, setPredictionError] = useState<string | null>(null);
  const [recsError, setRecsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadLive = useCallback(async () => {
    try {
      setTelemetry(await fetchTelemetry(deviceId));
      setTelemetryError(null);
    } catch (err) {
      setTelemetryError(apiErrorMessage(err, "Could not load live telemetry."));
    }
  }, [deviceId]);

  const loadForecast = useCallback(async () => {
    const [pred, rec, days] = await Promise.allSettled([
      fetchPrediction(deviceId),
      fetchRecommendations(deviceId, "normal"),
      fetchDailyTelemetry(deviceId),
    ]);

    if (pred.status === "fulfilled") {
      setPrediction(pred.value);
      setPredictionError(null);
    } else {
      setPredictionError(apiErrorMessage(pred.reason, "Could not load the forecast."));
    }

    if (rec.status === "fulfilled") {
      setRecs(rec.value);
      setRecsError(null);
      try {
        const a = await fetchAllowance(rec.value.target_bill_egp);
        setAllowedKwh(a.allowed_kwh);
      } catch {
        setAllowedKwh(null);
      }
    } else {
      setRecsError(apiErrorMessage(rec.reason, "Could not load recommendations."));
    }

    if (days.status === "fulfilled") setDaily(days.value);
  }, [deviceId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all([loadLive(), loadForecast()]);
      if (!cancelled) setLoading(false);
    })();
    const a = setInterval(loadLive, LIVE_POLL_MS);
    const b = setInterval(loadForecast, FORECAST_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(a);
      clearInterval(b);
    };
  }, [loadLive, loadForecast]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="pulse-dot h-9 w-9 rounded-full bg-accent" />
      </div>
    );
  }

  const connectedLoadW = recs?.allocations.reduce((s, a) => s + a.rated_power_w, 0) ?? 0;
  const gaugeFullScale = fullScaleFor(connectedLoadW);

  const ageSeconds = telemetry
    ? (Date.now() - new Date(telemetry.last_updated).getTime()) / 1000
    : null;
  const stale = ageSeconds !== null && ageSeconds > 60;
  const meterLive = telemetry !== null && !stale;

  const usedPct = recs?.alert.pct_of_budget_used ?? 0;
  const threshold = recs?.alert.alert_threshold_pct ?? 85;

  const loadFraction = telemetry ? Math.min(telemetry.active_power / gaugeFullScale, 1) : 0;
  const voltFraction = telemetry ? Math.min(telemetry.voltage / 260, 1) : 0;
  const currentFraction = telemetry ? Math.min(telemetry.current / 25, 1) : 0;
  const pfFraction = telemetry ? Math.min(Math.abs(telemetry.power_factor), 1) : 0;

  const essentials = recs?.allocations.filter((a) => a.is_essential) ?? [];
  const satisfaction =
    recs && recs.allocations.length > 0
      ? (recs.allocations.filter((a) => a.status === "essential" || a.status === "optimal").length /
          recs.allocations.length) *
        100
      : null;

  return (
    <div className="space-y-4">
      <AlertBanner alert={recs?.alert} daysRemaining={recs?.days_remaining_in_month} />

      {/* ============ HERO: Current Consumption Gauge ============ */}
      <Card className="rise d1 p-5">
        <CardHead
          title="Current Consumption"
          hint="Live power from the meter"
          action={
            <Link
              href="/recommendations"
              aria-label="Open today's plan"
              className="grid h-8 w-8 place-items-center rounded-full bg-white/60 text-chip-text-2 transition hover:bg-ink-panel hover:text-accent"
            >
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Link>
          }
        />
        <div className="flex flex-col items-center gap-4">
          <PowerGauge
            watts={telemetry?.active_power}
            fullScaleWatts={gaugeFullScale}
            scaleNote={
              connectedLoadW > 0
                ? `Scale ${gaugeFullScale} W · connected load ${connectedLoadW} W`
                : undefined
            }
            stale={stale}
          />
          <div className="w-full grid grid-cols-2 gap-4 text-center">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Voltage</p>
              <p className="num text-2xl font-bold text-ink">{telemetry ? telemetry.voltage.toFixed(1) : "--"}</p>
              <p className="text-[11px] text-ink-3">V</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Current</p>
              <p className="num text-2xl font-bold text-ink">{telemetry ? telemetry.current.toFixed(2) : "--"}</p>
              <p className="text-[11px] text-ink-3">A</p>
            </div>
          </div>
          <div className="w-full flex items-center justify-between border-t border-white/50 pt-3.5">
            <span className="flex items-center gap-2 text-xs text-ink-3">
              <Thermometer className="h-4 w-4" aria-hidden />
              Reading age
              <span className="num font-semibold text-ink-2">
                {ageSeconds === null ? "--" : `${Math.round(ageSeconds)}s`}
              </span>
            </span>
            {stale ? (
              <span className="flex items-center gap-1.5 text-xs font-bold text-warn">
                <TriangleAlert className="h-4 w-4" aria-hidden />
                Not reporting
              </span>
            ) : (
              <span className="rounded-[var(--r-pill)] bg-accent px-2.5 py-1 text-[10px] font-bold text-ink-panel">
                LIVE
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* ============ SECONDARY KPI ROW ============ */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Today's kWh */}
        <Card className="rise d2 p-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Today's Energy</span>
          <p className="mt-2 flex items-baseline gap-1.5">
            <span className="num text-[30px] font-bold leading-none text-ink">
              {telemetry ? telemetry.today_energy_kwh.toFixed(2) : "--"}
            </span>
            <span className="text-sm font-semibold text-ink-3">kWh</span>
          </p>
        </Card>

        {/* Predicted Bill (mini) */}
        <Card className="rise d3 p-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Predicted Bill</span>
          <p className="mt-2 flex items-baseline gap-1.5">
            <span className={clsx("num text-[30px] font-bold leading-none", prediction && prediction.predicted_bill_egp > (recs?.target_bill_egp ?? Infinity) ? "text-warn" : "text-accent-ink")}>
              {prediction ? prediction.predicted_bill_egp.toFixed(0) : "--"}
            </span>
            <span className="text-sm font-semibold text-ink-3">EGP</span>
          </p>
        </Card>

        {/* Budget Progress */}
        <Card className="rise d4 p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Budget Used</span>
            <span
              className={clsx(
                "num text-sm font-bold",
                usedPct >= 90 ? "text-warn" : usedPct >= threshold ? "text-amber" : "text-accent-ink",
              )}
            >
              {recs ? usedPct.toFixed(1) : "--"}%
            </span>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/45">
            <div
              className={clsx(
                "h-full rounded-full transition-all duration-700",
                usedPct >= 90 ? "bg-warn" : usedPct >= threshold ? "bg-amber" : "bg-accent",
              )}
              style={{ width: `${Math.min(usedPct, 100)}%` }}
            />
          </div>
        </Card>

        {/* Cycle Position */}
        <Card className="rise d5 p-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Cycle Day</span>
          <p className="mt-2 flex items-baseline gap-1.5">
            <span className="num text-[30px] font-bold leading-none text-ink">
              {prediction ? `${prediction.day_of_month}/${prediction.cycle_length_days}` : "--"}
            </span>
            <span className="text-sm font-semibold text-ink-3">days</span>
          </p>
        </Card>
      </div>

      {/* ============ MAIN GRID: Chart + Forecast + Recommendations ============ */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Left: Energy Usage (14-day bars) - spans 7 cols on lg */}
        <Card className="rise d6 lg:col-span-7">
          <CardHead
            title="Energy Usage (kWh)"
            hint="Daily totals this cycle"
            action={
              <span className="rounded-[var(--r-pill)] bg-white/55 px-3.5 py-1.5 text-[11px] font-semibold text-chip-text">
                Last 14 days
              </span>
            }
          />
          <UsageBars
            days={daily}
            dailyAllowanceKwh={recs?.budget_daily_kwh ?? null}
          />
        </Card>

        {/* Right column: Forecast + Recommendations - spans 5 cols on lg */}
        <div className="space-y-4 lg:col-span-5">
          {/* Energy Forecast */}
          <Card className="rise d7 p-5">
            <CardHead
              title="Energy Forecast"
              hint="Month-end bill on the progressive tariff"
              action={
                <Link
                  href="/budget"
                  aria-label="Open the budget planner"
                  className="grid h-8 w-8 place-items-center rounded-full bg-white/60 text-chip-text-2 transition hover:bg-ink-panel hover:text-accent"
                >
                  <ArrowUpRight className="h-4 w-4" aria-hidden />
                </Link>
              }
            />
            <div className="flex flex-col items-center">
              {predictionError ? (
                <p className="py-10 text-center text-sm text-warn">{predictionError}</p>
              ) : (
                <>
                  <ForecastGauge
                    predictedEgp={prediction?.predicted_bill_egp ?? null}
                    targetEgp={recs?.target_bill_egp ?? null}
                    stale={stale}
                  />
                  <dl className="mt-5 w-full grid grid-cols-2 gap-x-4 gap-y-3.5 border-t border-white/50 pt-4">
                    <Field label="Predicted kWh" value={prediction ? prediction.predicted_kwh.toFixed(2) : "--"} />
                    <Field
                      label="Confidence band"
                      value={
                        prediction
                          ? `${prediction.confidence_bill_low_egp.toFixed(0)}–${prediction.confidence_bill_high_egp.toFixed(0)}`
                          : "--"
                      }
                    />
                    <Field label="Model version" value={prediction?.model_version ?? "--"} mono />
                    <Field
                      label="Day coverage"
                      value={
                        prediction
                          ? `${prediction.data_quality.days_with_readings}/${prediction.data_quality.days_elapsed}`
                          : "--"
                      }
                    />
                  </dl>
                  {prediction && prediction.prediction_method !== "model" && (
                    <p className="mt-3 rounded-lg bg-warn-wash p-2.5 text-[11px] font-medium leading-relaxed text-warn">
                      Model withheld: {prediction.fallback_reason}
                    </p>
                  )}
                </>
              )}
            </div>
          </Card>

          {/* Appliance Recommendations */}
          <Card className="rise d8 p-5">
            <CardHead
              title="Appliance Recommendations"
              hint="Today's plan, essentials reserved first"
              action={
                <Link
                  href="/recommendations"
                  aria-label="Open the full plan"
                  className="grid h-8 w-8 place-items-center rounded-full bg-white/60 text-chip-text-2 transition hover:bg-ink-panel hover:text-accent"
                >
                  <ArrowUpRight className="h-4 w-4" aria-hidden />
                </Link>
              }
            />
            <div>
              {recsError ? (
                <p className="text-sm text-warn">{recsError}</p>
              ) : recs ? (
                <>
                  {satisfaction !== null && (
                    <div className="mb-4">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[13px] font-medium text-ink-2">
                          Appliances at full runtime
                        </span>
                        <span className="num text-[13px] font-bold text-accent-ink">
                          {satisfaction.toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-white/50">
                        <div
                          className="h-full rounded-full bg-accent transition-all duration-700"
                          style={{ width: `${satisfaction}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-[11px] text-ink-3">
                        {essentials.length} essential, {recs.allocations.length - essentials.length} adjustable
                      </p>
                    </div>
                  )}

                  <ul className="space-y-2">
                    {[...recs.allocations]
                      .sort((a, b) => Number(b.is_essential) - Number(a.is_essential))
                      .slice(0, 4)
                      .map((a) => (
                        <ApplianceRow key={a.appliance_id} a={a} />
                      ))}
                  </ul>
                  {recs.allocations.length > 4 && (
                    <Link
                      href="/recommendations"
                      className="mt-3 block text-center text-sm font-semibold text-accent-ink underline decoration-dotted underline-offset-2"
                    >
                      View all {recs.allocations.length} appliances →
                    </Link>
                  )}
                </>
              ) : (
                <p className="py-8 text-center text-sm text-ink-3">No plan yet.</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* ============ Phase Dial (narrow strip) ============ */}
      <Card className="rise d9">
        <div className="flex flex-col items-center gap-5 px-6 py-5 sm:flex-row sm:items-center">
          <div className="w-full max-w-[190px] shrink-0">
            <PhaseDial
              powerFactor={telemetry?.power_factor ?? null}
              voltage={telemetry?.voltage ?? null}
              current={telemetry?.current ?? null}
              stale={stale}
            />
          </div>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink">Phase angle</h2>
            <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-ink-3">
              Power factor is the angle between the voltage and current waveforms —
              PF = cos&nbsp;φ. Near 1.0 almost all the power drawn is doing real work;
              a falling value means motors and compressors pulling reactive current.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function ApplianceRow({ a }: { a: Allocation }) {
  const Icon = applianceIcon(a.name);
  const badge = a.is_essential
    ? { text: "essential", cls: "bg-accent text-ink-panel" }
    : a.status === "shed" || a.status === "away"
      ? { text: "skip today", cls: "bg-warn-wash text-warn" }
      : a.status === "constrained"
        ? { text: "reduced", cls: "bg-accent-wash text-accent-ink" }
        : { text: a.priority.toLowerCase(), cls: "bg-white/70 text-chip-text-2" };

  return (
    <li
      className={clsx(
        "flex items-center gap-3 rounded-xl p-3",
        a.is_essential ? "border-l-[3px] border-accent-2 bg-white/60" : "bg-white/45",
      )}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/80 text-chip-text">
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-[13px] font-bold text-chip-text">
          {a.is_essential && <Lock className="h-3 w-3 shrink-0 text-accent-ink" aria-label="Essential" />}
          {a.name}{" "}
          <span className="num font-semibold text-chip-text-2">({a.recommended_runtime_hours}h/day)</span>
        </p>
        <p className="num mt-0.5 text-[11px] text-chip-text-2">{a.estimated_kwh.toFixed(2)} kWh</p>
      </div>
      <span className={clsx("shrink-0 rounded-[var(--r-pill)] px-2.5 py-1 text-[10px] font-bold", badge.cls)}>
        {badge.text}
      </span>
    </li>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-3">{label}</dt>
      <dd className={clsx("mt-1 font-bold text-ink", mono ? "num text-[11px]" : "num text-[15px]")}>
        {value}
      </dd>
    </div>
  );
}

export default function OverviewPage() {
  return <Shell>{(deviceId) => <OverviewBody deviceId={deviceId} />}</Shell>;
}