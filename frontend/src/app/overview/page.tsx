"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Gauge as GaugeIcon,
  Lock,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";

import Shell from "@/components/Shell";
import AlertBanner from "@/components/AlertBanner";
import PowerGauge, { fullScaleFor } from "@/components/PowerGauge";
import {
  apiErrorMessage,
  fetchPrediction,
  fetchRecommendations,
  fetchTelemetry,
  type Prediction,
  type RecommendationDashboard,
  type TelemetryDashboard,
} from "@/lib/api";

/**
 * Overview - the demo's opening screen, told in three beats.
 *
 *   1. HOOK     what is happening right now      (live gauge + today's kWh)
 *   2. STAKES   what it will cost you            (predicted bill + confidence range)
 *   3. SOLUTION what to do about it              (budget status + top recommendations)
 *
 * The order is the argument, so the sections are numbered on screen.
 *
 * Every figure below is fetched. Nothing on this page is computed in the browser
 * except two presentational things, both marked where they happen: the position of
 * the marker inside the confidence bar, and the width of the budget progress bar.
 */

const LIVE_POLL_MS = 5000;      // telemetry: cheap, and it is the "live" claim
const FORECAST_POLL_MS = 30000; // prediction + recommendations: heavier, slower-moving

function OverviewBody({ deviceId }: { deviceId: string }) {
  const [telemetry, setTelemetry] = useState<TelemetryDashboard | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [recs, setRecs] = useState<RecommendationDashboard | null>(null);

  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [predictionError, setPredictionError] = useState<string | null>(null);
  const [recsError, setRecsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Each section reports its own failure. One endpoint being down must not blank
  // the other two - a missing budget is a normal state for a new account, and it
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
    const [pred, rec] = await Promise.allSettled([
      fetchPrediction(deviceId),
      fetchRecommendations(deviceId, "normal"),
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
    } else {
      setRecsError(apiErrorMessage(rec.reason, "Could not load recommendations."));
    }
  }, [deviceId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all([loadLive(), loadForecast()]);
      if (!cancelled) setLoading(false);
    })();

    const liveTimer = setInterval(loadLive, LIVE_POLL_MS);
    const forecastTimer = setInterval(loadForecast, FORECAST_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(liveTimer);
      clearInterval(forecastTimer);
    };
  }, [loadLive, loadForecast]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Zap className="h-7 w-7 animate-pulse text-emerald-400" />
      </div>
    );
  }

  // ---- presentational geometry (the only browser-side arithmetic on this page) ----
  const band = prediction
    ? prediction.confidence_bill_high_egp - prediction.confidence_bill_low_egp
    : 0;
  const markerPct =
    prediction && band > 0
      ? ((prediction.predicted_bill_egp - prediction.confidence_bill_low_egp) / band) * 100
      : 50;

  const usedPct = recs?.alert.pct_of_budget_used ?? 0;
  const barPct = Math.min(usedPct, 100);

  const overTargetEgp =
    prediction && recs ? prediction.predicted_bill_egp - recs.target_bill_egp : null;

  const topRecommendations = recs
    ? [...recs.allocations]
        .sort((a, b) => Number(b.is_essential) - Number(a.is_essential))
        .slice(0, 3)
    : [];

  // Gauge full scale = this household's registered connected load. The allocation
  // rows already carry every appliance's rated power, so no extra request.
  const connectedLoadW =
    recs?.allocations.reduce((sum, a) => sum + a.rated_power_w, 0) ?? 0;
  const gaugeFullScale = fullScaleFor(connectedLoadW);

  // A reading older than a minute is not "live". The meter's own timestamp is the
  // right thing to age, not the time the row was written.
  const readingAgeSeconds = telemetry
    ? (Date.now() - new Date(telemetry.last_updated).getTime()) / 1000
    : null;
  const readingIsStale = readingAgeSeconds !== null && readingAgeSeconds > 60;

  return (
    <>
      {/* The alert sits above the story: it is the one thing that should interrupt it. */}
      <AlertBanner alert={recs?.alert} daysRemaining={recs?.days_remaining_in_month} />

      {/* ==================== 1. HOOK ==================== */}
      <section className="mb-10">
        <SectionHeading
          step={1}
          icon={<Activity className="h-4 w-4 text-emerald-400" />}
          title="Right now"
          subtitle="Live draw from the meter, and what the day has cost so far"
        />

        {telemetryError ? (
          <Panel tone="error">{telemetryError}</Panel>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 lg:col-span-1">
              <PowerGauge
                watts={telemetry?.active_power}
                fullScaleWatts={gaugeFullScale}
                scaleNote={
                  connectedLoadW > 0
                    ? `Scale: ${gaugeFullScale} W, your registered connected load (${connectedLoadW} W)`
                    : undefined
                }
                stale={readingIsStale}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
              <Stat
                label="Used today"
                value={telemetry ? telemetry.today_energy_kwh.toFixed(2) : "--"}
                unit="kWh"
                accent="text-sky-400"
                icon={<Zap className="h-5 w-5 text-sky-400" />}
                note="Africa/Cairo local day"
              />
              <Stat
                label="This billing cycle"
                value={telemetry ? telemetry.month_energy_kwh.toFixed(1) : "--"}
                unit="kWh"
                accent="text-white"
                icon={<GaugeIcon className="h-5 w-5 text-slate-400" />}
                note={
                  prediction
                    ? `Day ${prediction.day_of_month} of ${prediction.cycle_length_days}`
                    : undefined
                }
              />
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 sm:col-span-2">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Instantaneous reading
                </p>
                <div className="grid grid-cols-3 gap-3 font-mono text-sm">
                  <Reading label="Voltage" value={telemetry ? `${telemetry.voltage} V` : "--"} />
                  <Reading label="Current" value={telemetry ? `${telemetry.current} A` : "--"} />
                  <Reading
                    label="Power factor"
                    value={telemetry ? telemetry.power_factor.toFixed(2) : "--"}
                  />
                </div>
                {telemetry && (
                  <p className="mt-3 text-xs text-slate-500">
                    Reading timestamped{" "}
                    <span className="font-mono">
                      {new Date(telemetry.last_updated).toLocaleString()}
                    </span>{" "}
                    by the device itself, not on arrival.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ==================== 2. STAKES ==================== */}
      <section className="mb-10">
        <SectionHeading
          step={2}
          icon={<TrendingUp className="h-4 w-4 text-amber-400" />}
          title="Where the month is heading"
          subtitle="Predicted end-of-cycle bill, with the error range actually measured on held-out data"
        />

        {predictionError ? (
          <Panel tone="error">{predictionError}</Panel>
        ) : prediction ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-900/60 bg-gradient-to-br from-amber-950/40 to-slate-900 p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-300/80">
                Predicted bill at cycle end
              </p>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-5xl font-bold tracking-tight text-amber-300">
                  {prediction.predicted_bill_egp.toFixed(0)}
                </span>
                <span className="text-lg text-amber-200/70">EGP</span>
              </div>
              <p className="mt-1 text-sm text-slate-300">
                {prediction.predicted_kwh.toFixed(1)} kWh forecast ·{" "}
                {prediction.days_remaining_in_cycle} days remaining
              </p>

              {/* Confidence band. The marker's left offset is the only derived value. */}
              <div className="mt-6">
                <div className="mb-1.5 flex justify-between text-xs text-slate-400">
                  <span>{prediction.confidence_bill_low_egp.toFixed(0)} EGP</span>
                  <span className="font-semibold text-slate-300">Confidence range</span>
                  <span>{prediction.confidence_bill_high_egp.toFixed(0)} EGP</span>
                </div>
                <div className="relative h-3 rounded-full bg-slate-800">
                  <div className="absolute inset-0 rounded-full bg-amber-500/25" />
                  <div
                    className="absolute top-1/2 h-5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-300"
                    style={{ left: `${markerPct}%` }}
                    title={`Point estimate ${prediction.predicted_bill_egp.toFixed(0)} EGP`}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  {prediction.confidence_label}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Basis: {prediction.confidence_basis}.{" "}
                  {prediction.confidence_low.toFixed(1)}-
                  {prediction.confidence_high.toFixed(1)} kWh.
                </p>
              </div>
            </div>

            {/* The hero number gets the full width above; these two sit under it as
                equal columns. Previously the bill card was 2/3 and these stacked in
                the remaining third, which left a tall empty gap beside them. */}
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Spent so far
                </p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-white">
                    {prediction.bill_so_far_egp.toFixed(0)}
                  </span>
                  <span className="text-sm text-slate-400">EGP</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {prediction.kwh_so_far.toFixed(1)} kWh billed to date
                </p>
                {prediction.tariff_position.price_per_kwh_current !== null && (
                  <p className="mt-2 text-xs text-slate-400">
                    Currently in tariff bracket{" "}
                    <span className="font-semibold text-slate-200">
                      {prediction.tariff_position.active_bracket}
                    </span>{" "}
                    at {prediction.tariff_position.price_per_kwh_current} EGP/kWh
                    {prediction.tariff_position.kwh_remaining_in_bracket !== null && (
                      <>
                        {" "}
                        - {prediction.tariff_position.kwh_remaining_in_bracket.toFixed(0)} kWh
                        before the next one
                      </>
                    )}
                    .
                  </p>
                )}
              </div>

              {/* How the model is doing against the baseline it has to beat. Stated
                  plainly, including when the model is refused and the naive
                  baseline is being served instead. */}
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Method
                </p>
                <p className="mt-2 text-sm font-semibold text-slate-100">
                  {prediction.prediction_method === "model"
                    ? "LightGBM model"
                    : "Naive baseline"}
                </p>
                {prediction.prediction_method === "model" ? (
                  <p className="mt-1 text-xs text-slate-400">
                    Naive baseline says {prediction.naive_prediction_kwh.toFixed(1)} kWh; the
                    model corrects it by {prediction.model_correction_kwh >= 0 ? "+" : ""}
                    {prediction.model_correction_kwh.toFixed(2)} kWh.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-amber-300/90">
                    Model withheld: {prediction.fallback_reason}
                  </p>
                )}
                <p className="mt-2 font-mono text-[11px] text-slate-500">
                  {prediction.model_version}
                </p>
                {prediction.data_quality.warning && (
                  <p className="mt-2 text-xs text-amber-300/90">
                    {prediction.data_quality.warning}
                  </p>
                )}
                <p className="mt-2 text-xs text-slate-500">
                  {prediction.data_quality.days_with_readings}/
                  {prediction.data_quality.days_elapsed} elapsed days carry telemetry
                  {prediction.data_quality.days_missing > 0 &&
                    ` (${prediction.data_quality.days_missing} missing)`}
                  .
                </p>
              </div>
            </div>
          </div>
        ) : (
          <Panel>Not enough history yet to forecast this cycle.</Panel>
        )}
      </section>

      {/* ==================== 3. SOLUTION ==================== */}
      <section>
        <SectionHeading
          step={3}
          icon={<Target className="h-4 w-4 text-indigo-400" />}
          title="What to do about it"
          subtitle="Your target versus your trajectory, and today's plan"
        />

        {recsError ? (
          <Panel tone="error">
            {recsError}
            <div className="mt-3">
              <Link
                href="/budget"
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                Set a target bill <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </Panel>
        ) : recs ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Budget target
                  </p>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-white">
                      {recs.target_bill_egp.toFixed(0)}
                    </span>
                    <span className="text-sm text-slate-400">EGP</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Allowance
                  </p>
                  <p className="mt-2 text-lg font-bold text-white">
                    {recs.daily_kwh_allowance.toFixed(1)}
                    <span className="ml-1 text-xs font-normal text-slate-400">kWh left</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {recs.budget_daily_kwh.toFixed(2)} kWh/day over{" "}
                    {recs.days_remaining_in_month}d
                  </p>
                </div>
              </div>

              <div className="mt-5">
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="text-slate-400">Budget used</span>
                  <span
                    className={`font-semibold ${
                      usedPct >= 90
                        ? "text-rose-400"
                        : usedPct >= recs.alert.alert_threshold_pct
                          ? "text-amber-400"
                          : "text-emerald-400"
                    }`}
                  >
                    {usedPct.toFixed(1)}%
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      usedPct >= 90
                        ? "bg-rose-500"
                        : usedPct >= recs.alert.alert_threshold_pct
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                    }`}
                    style={{ width: `${barPct}%` }}
                  />
                </div>
              </div>

              {overTargetEgp !== null && (
                <p className="mt-4 text-sm">
                  {overTargetEgp > 0 ? (
                    <span className="text-rose-300">
                      On track to overshoot the target by{" "}
                      <strong>{overTargetEgp.toFixed(0)} EGP</strong>.
                    </span>
                  ) : (
                    <span className="text-emerald-300">
                      On track to come in{" "}
                      <strong>{Math.abs(overTargetEgp).toFixed(0)} EGP</strong> under target.
                    </span>
                  )}
                </p>
              )}

              {!recs.within_budget && recs.budget_note && (
                <p className="mt-3 rounded-lg border border-amber-900/60 bg-amber-950/30 p-3 text-xs text-amber-200">
                  {recs.budget_note}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Today&apos;s plan
                </p>
                <Link
                  href="/recommendations"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400 hover:text-emerald-300"
                >
                  Full plan <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              {topRecommendations.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">
                  No appliances registered yet.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {topRecommendations.map((a) => (
                    <li
                      key={a.appliance_id}
                      className={`rounded-lg border p-3 ${
                        a.is_essential
                          ? "border-emerald-900/60 bg-emerald-950/20"
                          : "border-slate-800 bg-slate-950/60"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-white">
                          {a.is_essential && (
                            <Lock
                              className="h-3.5 w-3.5 shrink-0 text-emerald-400"
                              aria-label="Essential - never restricted"
                            />
                          )}
                          {a.name}
                        </span>
                        <span className="shrink-0 text-sm font-semibold text-slate-200">
                          {a.recommended_runtime_hours} h
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-400">{a.action_note}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <Panel>No plan yet.</Panel>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Small presentational pieces, kept local to this page.
// ---------------------------------------------------------------------------

function SectionHeading({
  step,
  icon,
  title,
  subtitle,
}: {
  step: number;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-700 text-xs font-bold text-slate-400">
        {step}
      </span>
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white">
          {icon}
          {title}
        </h2>
        <p className="text-sm text-slate-400">{subtitle}</p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  accent,
  icon,
  note,
}: {
  label: string;
  value: string;
  unit: string;
  accent: string;
  icon: React.ReactNode;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div className="mb-3 flex items-start justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </span>
        {icon}
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-3xl font-bold ${accent}`}>{value}</span>
        <span className="text-sm text-slate-400">{unit}</span>
      </div>
      {note && <p className="mt-2 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-0.5 text-slate-200">{value}</p>
    </div>
  );
}

function Panel({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "error";
}) {
  return (
    <div
      className={`rounded-xl border p-4 text-sm ${
        tone === "error"
          ? "border-rose-900/60 bg-rose-950/25 text-rose-200"
          : "border-slate-800 bg-slate-900 text-slate-400"
      }`}
    >
      {children}
    </div>
  );
}

export default function OverviewPage() {
  return <Shell>{(deviceId) => <OverviewBody deviceId={deviceId} />}</Shell>;
}
