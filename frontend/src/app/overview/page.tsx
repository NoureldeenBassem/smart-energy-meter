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
 * Overview.
 *
 * Laid out to the supplied reference: the annotated panel scene carries the
 * left column with the charcoal status panel anchored at its foot, and four
 * glass cards sit in a 2x2 to the right — load performance, energy forecast,
 * usage bars, appliance recommendations.
 *
 * Every figure is fetched. The only browser-side arithmetic is presentational
 * geometry, and each site is marked. No price, allowance or forecast is
 * recomputed here.
 */

const LIVE_POLL_MS = 5000;
const FORECAST_POLL_MS = 30000;

/** Appliance name -> icon, matching the reference's per-row iconography. */
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

  // Each section reports its own failure. One endpoint being down must not blank
  // the others — a missing budget is a normal state for a new account and it
  // should not take the live gauge with it.
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
      // The allowance drawn on the bars is the tariff engine's own inverse of
      // the saved target, fetched — never a kWh figure derived in the browser.
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
      <div className="flex items-center justify-center py-40">
        <span className="pulse-dot h-9 w-9 rounded-full bg-accent" />
      </div>
    );
  }

  const connectedLoadW = recs?.allocations.reduce((s, a) => s + a.rated_power_w, 0) ?? 0;
  const gaugeFullScale = fullScaleFor(connectedLoadW);

  // A reading older than a minute is not "live". The meter's own timestamp is
  // the right thing to age, not when the row was written.
  const ageSeconds = telemetry
    ? (Date.now() - new Date(telemetry.last_updated).getTime()) / 1000
    : null;
  const stale = ageSeconds !== null && ageSeconds > 60;
  const meterLive = telemetry !== null && !stale;

  const usedPct = recs?.alert.pct_of_budget_used ?? 0;
  const threshold = recs?.alert.alert_threshold_pct ?? 85;

  // Presentational only: each live reading as a fraction of a sane full scale,
  // so the bars have somewhere to sit. No measurement is derived here.
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

      <div className="grid gap-4 xl:grid-cols-12">
        {/* ============ left: the annotated scene, panel at its foot ============ */}
        <div className="flex min-h-[620px] flex-col justify-between gap-4 xl:col-span-5">
          <div className="rise d1">
            <span className="inline-flex items-center gap-2.5 rounded-[var(--r-pill)] panel-ink px-4 py-2.5 text-[13px] font-semibold text-on-dark">
              <span className={clsx("h-2 w-2 rounded-full", meterLive ? "pulse-dot bg-accent" : "bg-on-dark-2")} />
              <span className="text-accent">Household Meter 01</span>
              <ChevronDown className="h-3.5 w-3.5 text-on-dark-2" aria-hidden />
            </span>
          </div>

          <Card tone="ink" className="rise d2 p-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <h2 className="text-[17px] font-bold text-on-dark">Meter Status</h2>
                <p className="mt-0.5 text-xs text-on-dark-2">
                  {telemetry ? "Household Meter 01" : "No reading"}
                </p>
                <div className="mt-2">
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
                </div>
              </div>

              <div className="flex flex-col">
                <h2 className="text-[17px] font-bold text-on-dark">Cycle Status</h2>
                <p className="mt-0.5 text-xs text-on-dark-2">Africa/Cairo local days</p>

                <dl className="mt-4 space-y-3.5">
                  <InkRow label="Used today" value={telemetry ? telemetry.today_energy_kwh.toFixed(2) : "--"} unit="kWh" />
                  <InkRow label="This cycle" value={telemetry ? telemetry.month_energy_kwh.toFixed(1) : "--"} unit="kWh" />
                  <InkRow
                    label="Cycle position"
                    value={prediction ? `${prediction.day_of_month}/${prediction.cycle_length_days}` : "--"}
                    unit="days"
                  />
                  <InkRow
                    label="Spent so far"
                    value={prediction ? prediction.bill_so_far_egp.toFixed(0) : "--"}
                    unit="EGP"
                  />
                </dl>

                <div className="mt-auto pt-4">
                  <div className="mb-1.5 flex items-center justify-between text-[11px]">
                    <span className="text-on-dark-2">Budget used</span>
                    <span
                      className={clsx(
                        "num font-bold",
                        usedPct >= 90 ? "text-[#f2726b]" : usedPct >= threshold ? "text-[#f5b13a]" : "text-accent",
                      )}
                    >
                      {recs ? usedPct.toFixed(1) : "--"}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/12">
                    <div
                      className={clsx(
                        "h-full rounded-full transition-all duration-700",
                        usedPct >= 90 ? "bg-[#f2726b]" : usedPct >= threshold ? "bg-[#f5b13a]" : "bg-accent",
                      )}
                      style={{ width: `${Math.min(usedPct, 100)}%` }}
                    />
                  </div>
                  {telemetry && (
                    <p className="mt-3 text-[10px] leading-relaxed text-on-dark-2">
                      Timestamped <span className="num">{new Date(telemetry.last_updated).toLocaleTimeString()}</span>{" "}
                      by the device, not on arrival.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* ===================== right: the 2x2 card grid ===================== */}
        <div className="grid content-start gap-4 xl:col-span-7">
          <div className="grid gap-4 lg:grid-cols-2">
            {/* ---- Load Performance ---- */}
            <Card className="rise d3">
              <CardHead
                title="Load Performance"
                hint="Live electrical readings from the meter"
                action={
                  <Link
                    href="/recommendations"
                    aria-label="Open today's plan"
                    className="grid h-8 w-8 place-items-center rounded-full bg-white/60 text-ink-3 transition hover:bg-ink-panel hover:text-accent"
                  >
                    <ArrowUpRight className="h-4 w-4" aria-hidden />
                  </Link>
                }
              />
              <div className="space-y-4 px-6 pb-5 pt-4">
                {telemetryError ? (
                  <p className="text-sm text-warn">{telemetryError}</p>
                ) : (
                  <>
                    <ThresholdBar
                      label="Active power"
                      valueText={telemetry ? `${telemetry.active_power.toFixed(0)} W` : "--"}
                      fraction={loadFraction}
                      state={loadFraction >= 0.85 ? "warn" : "active"}
                      note={`of ${gaugeFullScale} W connected load`}
                    />
                    <ThresholdBar
                      label="Voltage (ZMPT101B)"
                      valueText={telemetry ? `${telemetry.voltage.toFixed(1)} V` : "--"}
                      fraction={voltFraction}
                      state="normal"
                    />
                    <ThresholdBar
                      label="Current (SCT-013)"
                      valueText={telemetry ? `${telemetry.current.toFixed(2)} A` : "--"}
                      fraction={currentFraction}
                      state="normal"
                    />
                    <ThresholdBar
                      label="Power factor"
                      valueText={telemetry ? telemetry.power_factor.toFixed(2) : "--"}
                      fraction={pfFraction}
                      state={pfFraction < 0.8 ? "warn" : "muted"}
                    />
                  </>
                )}

                <div className="flex items-center justify-between border-t border-white/50 pt-3.5">
                  <span className="flex items-center gap-2 text-xs text-ink-3">
                    <Thermometer className="h-4 w-4" aria-hidden />
                    Reading age{" "}
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

            {/* ---- Energy Forecast ---- */}
            <Card className="rise d4">
              <CardHead
                title="Energy Forecast"
                hint="Month-end bill on the progressive tariff"
                action={
                  <Link
                    href="/budget"
                    aria-label="Open the budget planner"
                    className="grid h-8 w-8 place-items-center rounded-full bg-white/60 text-ink-3 transition hover:bg-ink-panel hover:text-accent"
                  >
                    <ArrowUpRight className="h-4 w-4" aria-hidden />
                  </Link>
                }
              />
              <div className="px-5 pb-5 pt-2">
                {predictionError ? (
                  <p className="py-10 text-center text-sm text-warn">{predictionError}</p>
                ) : (
                  <>
                    <ForecastGauge
                      predictedEgp={prediction?.predicted_bill_egp ?? null}
                      targetEgp={recs?.target_bill_egp ?? null}
                      stale={stale}
                    />
                    <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3.5 border-t border-white/50 pt-4">
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
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* ---- Energy Usage ---- */}
            <Card className="rise d5">
              <CardHead
                title="Energy Usage (kWh)"
                hint="Daily totals this cycle"
                action={
                  <span className="rounded-[var(--r-pill)] bg-white/55 px-3.5 py-1.5 text-[11px] font-semibold text-ink-2">
                    Last 14 days
                  </span>
                }
              />
              <UsageBars
                days={daily}
                dailyAllowanceKwh={recs?.budget_daily_kwh ?? null}
              />
            </Card>

            {/* ---- Appliance Recommendations ---- */}
            <Card className="rise d6">
              <CardHead
                title="Appliance Recommendations"
                hint="Today's plan, essentials reserved first"
                action={
                  <Link
                    href="/recommendations"
                    aria-label="Open the full plan"
                    className="grid h-8 w-8 place-items-center rounded-full bg-white/60 text-ink-3 transition hover:bg-ink-panel hover:text-accent"
                  >
                    <ArrowUpRight className="h-4 w-4" aria-hidden />
                  </Link>
                }
              />
              <div className="px-6 pb-5 pt-4">
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
                  </>
                ) : (
                  <p className="py-8 text-center text-sm text-ink-3">No plan yet.</p>
                )}
              </div>
            </Card>
          </div>

          {/* ---- phase dial, tucked under as a narrow strip ---- */}
          <Card className="rise d6">
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
      </div>
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
        : { text: a.priority.toLowerCase(), cls: "bg-white/70 text-ink-3" };

  return (
    <li
      className={clsx(
        "flex items-center gap-3 rounded-xl p-3",
        a.is_essential ? "border-l-[3px] border-accent-2 bg-white/60" : "bg-white/45",
      )}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/80 text-ink-2">
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-[13px] font-bold text-ink">
          {a.is_essential && <Lock className="h-3 w-3 shrink-0 text-accent-ink" aria-label="Essential" />}
          {a.name}{" "}
          <span className="num font-semibold text-ink-3">({a.recommended_runtime_hours}h/day)</span>
        </p>
        <p className="num mt-0.5 text-[11px] text-ink-3">{a.estimated_kwh.toFixed(2)} kWh</p>
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

function InkRow({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs text-on-dark-2">{label}</dt>
      <dd className="num text-sm font-bold text-on-dark">
        {value}
        <span className="ml-1 text-[10px] font-semibold text-on-dark-2">{unit}</span>
      </dd>
    </div>
  );
}

export default function OverviewPage() {
  return <Shell>{(deviceId) => <OverviewBody deviceId={deviceId} />}</Shell>;
}
