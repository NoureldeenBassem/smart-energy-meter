"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Lock, TrendingUp } from "lucide-react";
import { clsx } from "clsx";

import Shell from "@/components/Shell";
import AlertBanner from "@/components/AlertBanner";
import HeroPanel from "@/components/HeroPanel";
import PhaseDial from "@/components/PhaseDial";
import DailyChart from "@/components/DailyChart";
import PowerGauge, { fullScaleFor } from "@/components/PowerGauge";
import { Card, CardHead } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { ThresholdBar } from "@/components/ui/ThresholdBar";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  apiErrorMessage,
  fetchDailyTelemetry,
  fetchPrediction,
  fetchRecommendations,
  fetchTariffBrackets,
  fetchTelemetry,
  type DailyBucket,
  type Prediction,
  type RecommendationDashboard,
  type TariffBracket,
  type TelemetryDashboard,
} from "@/lib/api";

/**
 * Overview — the demo's opening screen, told in three beats.
 *
 *   1. HOOK     what is happening right now      (live gauge + tariff position)
 *   2. STAKES   what it will cost you            (predicted bill + confidence range)
 *   3. SOLUTION what to do about it              (budget status + top recommendations)
 *
 * The order is the argument, so the sections stay numbered on screen.
 *
 * Every figure below is fetched. The only browser-side arithmetic is
 * presentational geometry, and each site is marked: the confidence marker's
 * offset, the budget bar's width, and how far into each published tariff bracket
 * the fetched kwh_so_far sits. No price, allowance or forecast is recomputed
 * here — a second implementation in TypeScript is exactly how the screen and the
 * backend start disagreeing.
 */

const LIVE_POLL_MS = 5000; // telemetry: cheap, and it is the "live" claim
const FORECAST_POLL_MS = 30000; // prediction + recommendations: heavier, slower-moving

function OverviewBody({ deviceId }: { deviceId: string }) {
  const [telemetry, setTelemetry] = useState<TelemetryDashboard | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [recs, setRecs] = useState<RecommendationDashboard | null>(null);
  const [daily, setDaily] = useState<DailyBucket[]>([]);
  const [brackets, setBrackets] = useState<TariffBracket[]>([]);

  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [predictionError, setPredictionError] = useState<string | null>(null);
  const [recsError, setRecsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Each section reports its own failure. One endpoint being down must not blank
  // the other two — a missing budget is a normal state for a new account, and it
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
    } else {
      setRecsError(apiErrorMessage(rec.reason, "Could not load recommendations."));
    }

    // The chart is decoration if it fails — the page still works without it, so
    // it gets no error surface of its own.
    if (days.status === "fulfilled") setDaily(days.value);
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

  // Published tariff schedule. Static, unauthenticated, fetched once — served
  // from the calculator's own constant, not the DB copy, so the bars and the
  // arithmetic cannot drift.
  useEffect(() => {
    fetchTariffBrackets()
      .then(setBrackets)
      .catch(() => setBrackets([]));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <span className="h-8 w-8 animate-pulse rounded-full bg-accent" />
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
  const meterLive = telemetry !== null && !readingIsStale;

  const kwhSoFar = prediction?.kwh_so_far ?? telemetry?.month_energy_kwh ?? 0;
  const todayISO = daily.length > 0 ? daily[daily.length - 1].bucket_start : "";
  const avgDailyKwh =
    daily.length > 0
      ? daily.reduce((s, d) => s + d.total_energy_kwh, 0) / daily.length
      : null;

  return (
    <div className="space-y-10">
      {/* The alert sits above the story: it is the one thing that should interrupt it. */}
      <AlertBanner alert={recs?.alert} daysRemaining={recs?.days_remaining_in_month} />

      {/* ==================== 1. HOOK ==================== */}
      <section>
        <SectionHeading
          step={1}
          title="Right now"
          subtitle="Live draw from the meter, where you sit on the tariff, and the day's shape"
        />

        {telemetryError ? (
          <Card className="border border-warn/25 bg-warn-wash p-4 text-sm text-warn">
            {telemetryError}
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-12">
            {/* ---- left column: hero illustration + gauge card ---- */}
            <div className="flex flex-col gap-4 lg:col-span-4">
              <HeroPanel live={meterLive} watts={telemetry?.active_power ?? null} />

              <Card className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-[15px] font-semibold text-ink">Overview</h2>
                    <p className="mt-0.5 text-xs text-ink-muted">Live power draw</p>
                  </div>
                  <span className="rounded-[var(--radius-pill)] bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-ink-muted">
                    Today
                  </span>
                </div>

                <div className="mt-2">
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

                <dl className="mt-4 space-y-3 border-t border-line pt-4">
                  <InkRow
                    label="Used today"
                    value={telemetry ? telemetry.today_energy_kwh.toFixed(2) : "--"}
                    unit="kWh"
                  />
                  <InkRow
                    label="This billing cycle"
                    value={telemetry ? telemetry.month_energy_kwh.toFixed(1) : "--"}
                    unit="kWh"
                  />
                  <InkRow
                    label="Cycle position"
                    value={
                      prediction
                        ? `${prediction.day_of_month} / ${prediction.cycle_length_days}`
                        : "--"
                    }
                    unit="days"
                  />
                </dl>

                {telemetry && (
                  <p className="mt-4 text-[11px] leading-relaxed text-ink-muted">
                    Timestamped{" "}
                    <span className="num">
                      {new Date(telemetry.last_updated).toLocaleTimeString()}
                    </span>{" "}
                    by the device itself, not on arrival.
                  </p>
                )}
              </Card>
            </div>

            {/* ---- right column: tariff bars, phase dial, daily chart ---- */}
            <div className="grid gap-4 lg:col-span-8 lg:content-start">
              <div className="grid gap-4 sm:grid-cols-5">
                <Card className="sm:col-span-3">
                  <CardHead
                    title="Tariff position"
                    hint="Egypt's progressive brackets — each rate applies only to its own slice"
                  />
                  <div className="space-y-3 px-5 pb-5 pt-4">
                    {brackets.length === 0 ? (
                      <p className="text-sm text-ink-muted">Tariff schedule unavailable.</p>
                    ) : (
                      brackets.map((b) => {
                        // Presentational only: how much of THIS published bracket the
                        // fetched cycle-to-date consumption fills. No price is
                        // computed here.
                        const upper = b.kwh_to ?? b.kwh_from + 400;
                        const width = upper - b.kwh_from;
                        const filled = Math.min(
                          Math.max(kwhSoFar - b.kwh_from, 0),
                          width,
                        );
                        const isActive =
                          prediction?.tariff_position.active_bracket === b.bracket_order;
                        const done = filled >= width - 1e-9 && b.kwh_to !== null;

                        return (
                          <ThresholdBar
                            key={b.bracket_order}
                            label={`${b.kwh_from}–${b.kwh_to ?? "∞"} kWh`}
                            valueText={`${b.price_per_kwh.toFixed(2)} EGP`}
                            fraction={width > 0 ? filled / width : 0}
                            state={isActive ? "active" : done ? "normal" : "muted"}
                            note={
                              isActive &&
                              prediction?.tariff_position.kwh_remaining_in_bracket !== null &&
                              prediction?.tariff_position.kwh_remaining_in_bracket !== undefined
                                ? `You are here — ${prediction.tariff_position.kwh_remaining_in_bracket.toFixed(0)} kWh before the next bracket`
                                : undefined
                            }
                          />
                        );
                      })
                    )}
                  </div>
                </Card>

                <Card className="sm:col-span-2">
                  <CardHead title="Phase" hint="Power factor is the V–I angle" />
                  <div className="px-4 pb-5 pt-3">
                    <PhaseDial
                      powerFactor={telemetry?.power_factor ?? null}
                      voltage={telemetry?.voltage ?? null}
                      current={telemetry?.current ?? null}
                      stale={readingIsStale}
                    />
                  </div>
                </Card>
              </div>

              <Card>
                <CardHead
                  title="Energy consumption"
                  hint="Daily kWh across this billing cycle"
                  action={
                    <span className="rounded-[var(--radius-pill)] border border-line px-3 py-1.5 text-[11px] font-semibold text-ink-muted">
                      This cycle
                    </span>
                  }
                />
                <DailyChart
                  days={daily}
                  todayISO={todayISO}
                  predictedBillEgp={prediction?.predicted_bill_egp ?? null}
                  averageKwh={avgDailyKwh}
                />
              </Card>
            </div>
          </div>
        )}
      </section>

      {/* ---- KPI tiles ---- */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Predicted bill"
          value={prediction ? prediction.predicted_bill_egp.toFixed(0) : "--"}
          unit="EGP"
          sub={
            prediction
              ? `${prediction.predicted_kwh.toFixed(0)} kWh at cycle end`
              : "Awaiting forecast"
          }
          href="/budget"
          hrefLabel="Open the budget planner"
          emphasis
        />
        <StatTile
          label="Spent so far"
          value={prediction ? prediction.bill_so_far_egp.toFixed(0) : "--"}
          unit="EGP"
          sub={prediction ? `${prediction.kwh_so_far.toFixed(1)} kWh billed to date` : undefined}
        />
        <StatTile
          label="Days remaining"
          value={prediction ? String(prediction.days_remaining_in_cycle) : "--"}
          unit="days"
          sub={recs ? `${recs.budget_daily_kwh.toFixed(2)} kWh/day allowance` : undefined}
        />
        <StatTile
          label="Budget used"
          value={recs ? usedPct.toFixed(0) : "--"}
          unit="%"
          sub={recs ? `Alerts at ${recs.alert.alert_threshold_pct}%` : undefined}
          href="/recommendations"
          hrefLabel="Open today's plan"
        />
      </section>

      {/* ==================== 2. STAKES ==================== */}
      <section>
        <SectionHeading
          step={2}
          title="Where the month is heading"
          subtitle="Predicted end-of-cycle bill, with the error range measured on held-out data"
        />

        {predictionError ? (
          <Card className="border border-warn/25 bg-warn-wash p-4 text-sm text-warn">
            {predictionError}
          </Card>
        ) : prediction ? (
          <div className="grid gap-4 lg:grid-cols-12">
            <Card className="p-6 lg:col-span-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                Predicted bill at cycle end
              </p>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="num text-[56px] font-bold leading-none text-accent-deep">
                  {prediction.predicted_bill_egp.toFixed(0)}
                </span>
                <span className="text-lg font-semibold text-ink-muted">EGP</span>
              </div>
              <p className="mt-2 text-sm text-ink-muted">
                {prediction.predicted_kwh.toFixed(1)} kWh forecast ·{" "}
                {prediction.days_remaining_in_cycle} days remaining
              </p>

              {/* Confidence band. The marker's left offset is the only derived value. */}
              <div className="mt-7">
                <div className="mb-1.5 flex justify-between text-[11px] text-ink-muted">
                  <span className="num">
                    {prediction.confidence_bill_low_egp.toFixed(0)} EGP
                  </span>
                  <span className="font-semibold">Confidence range</span>
                  <span className="num">
                    {prediction.confidence_bill_high_egp.toFixed(0)} EGP
                  </span>
                </div>
                <div className="relative h-3 rounded-full bg-bg-deep">
                  <div className="absolute inset-0 rounded-full bg-accent/45" />
                  <div
                    className="absolute top-1/2 h-5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-deep"
                    style={{ left: `${markerPct}%` }}
                    title={`Point estimate ${prediction.predicted_bill_egp.toFixed(0)} EGP`}
                  />
                </div>
                <p className="mt-2.5 text-[11px] text-ink-muted">
                  {prediction.confidence_label}
                </p>
                <p className="mt-0.5 text-[11px] text-ink-muted">
                  Basis: {prediction.confidence_basis}.{" "}
                  <span className="num">
                    {prediction.confidence_low.toFixed(1)}–{prediction.confidence_high.toFixed(1)}
                  </span>{" "}
                  kWh.
                </p>
              </div>
            </Card>

            <Card className="p-6 lg:col-span-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                Spent so far
              </p>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="num text-4xl font-bold text-ink">
                  {prediction.bill_so_far_egp.toFixed(0)}
                </span>
                <span className="text-sm font-semibold text-ink-muted">EGP</span>
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                {prediction.kwh_so_far.toFixed(1)} kWh billed to date
              </p>
              {prediction.tariff_position.price_per_kwh_current !== null && (
                <p className="mt-4 rounded-xl bg-surface-muted p-3 text-xs leading-relaxed text-ink-soft">
                  Currently in tariff bracket{" "}
                  <span className="font-bold text-ink">
                    {prediction.tariff_position.active_bracket}
                  </span>{" "}
                  at {prediction.tariff_position.price_per_kwh_current} EGP/kWh
                  {prediction.tariff_position.kwh_remaining_in_bracket !== null && (
                    <>
                      {" "}
                      — {prediction.tariff_position.kwh_remaining_in_bracket.toFixed(0)} kWh
                      before the next one
                    </>
                  )}
                  .
                </p>
              )}
            </Card>

            {/* How the model is doing against the baseline it has to beat. Stated
                plainly, including when the model is refused and the naive
                baseline is being served instead. */}
            <Card className="p-6 lg:col-span-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                Method
              </p>
              <p className="mt-2.5 flex items-center gap-1.5 text-sm font-bold text-ink">
                <TrendingUp className="h-4 w-4 text-accent-deep" aria-hidden />
                {prediction.prediction_method === "model" ? "LightGBM model" : "Naive baseline"}
              </p>
              {prediction.prediction_method === "model" ? (
                <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                  Naive baseline says {prediction.naive_prediction_kwh.toFixed(1)} kWh; the model
                  corrects it by {prediction.model_correction_kwh >= 0 ? "+" : ""}
                  {prediction.model_correction_kwh.toFixed(2)} kWh.
                </p>
              ) : (
                <p className="mt-2 text-xs font-medium leading-relaxed text-warn">
                  Model withheld: {prediction.fallback_reason}
                </p>
              )}
              <p className="num mt-3 text-[10px] text-ink-muted">{prediction.model_version}</p>
              {prediction.data_quality.warning && (
                <p className="mt-2 text-xs font-medium text-warn">
                  {prediction.data_quality.warning}
                </p>
              )}
              <p className="mt-2 text-[11px] text-ink-muted">
                {prediction.data_quality.days_with_readings}/
                {prediction.data_quality.days_elapsed} elapsed days carry telemetry
                {prediction.data_quality.days_missing > 0 &&
                  ` (${prediction.data_quality.days_missing} missing)`}
                .
              </p>
            </Card>
          </div>
        ) : (
          <Card className="p-4 text-sm text-ink-muted">
            Not enough history yet to forecast this cycle.
          </Card>
        )}
      </section>

      {/* ==================== 3. SOLUTION ==================== */}
      <section>
        <SectionHeading
          step={3}
          title="What to do about it"
          subtitle="Your target versus your trajectory, and today's plan"
        />

        {recsError ? (
          <Card className="border border-warn/25 bg-warn-wash p-4 text-sm text-warn">
            {recsError}
            <div className="mt-3">
              <Link
                href="/budget"
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-surface-ink px-3.5 py-2 text-xs font-semibold text-ink-onDark transition hover:opacity-90"
              >
                Set a target bill <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </Card>
        ) : recs ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                    Budget target
                  </p>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="num text-4xl font-bold text-ink">
                      {recs.target_bill_egp.toFixed(0)}
                    </span>
                    <span className="text-sm font-semibold text-ink-muted">EGP</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                    Allowance
                  </p>
                  <p className="num mt-2 text-xl font-bold text-ink">
                    {recs.daily_kwh_allowance.toFixed(1)}
                    <span className="ml-1 text-[11px] font-semibold text-ink-muted">kWh left</span>
                  </p>
                  <p className="num text-[11px] text-ink-muted">
                    {recs.budget_daily_kwh.toFixed(2)} kWh/day over{" "}
                    {recs.days_remaining_in_month}d
                  </p>
                </div>
              </div>

              <div className="mt-6">
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="text-ink-muted">Budget used</span>
                  <span
                    className={clsx(
                      "num font-bold",
                      usedPct >= 90
                        ? "text-warn"
                        : usedPct >= recs.alert.alert_threshold_pct
                          ? "text-accent-deep"
                          : "text-ok",
                    )}
                  >
                    {usedPct.toFixed(1)}%
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-bg-deep">
                  <div
                    className={clsx(
                      "h-full rounded-full transition-all duration-700",
                      usedPct >= 90
                        ? "bg-warn"
                        : usedPct >= recs.alert.alert_threshold_pct
                          ? "bg-accent"
                          : "bg-ok",
                    )}
                    style={{ width: `${barPct}%` }}
                  />
                </div>
              </div>

              {overTargetEgp !== null && (
                <p className="mt-4 text-sm">
                  {overTargetEgp > 0 ? (
                    <span className="text-warn">
                      On track to overshoot the target by{" "}
                      <strong className="num">{overTargetEgp.toFixed(0)} EGP</strong>.
                    </span>
                  ) : (
                    <span className="text-ok">
                      On track to come in{" "}
                      <strong className="num">{Math.abs(overTargetEgp).toFixed(0)} EGP</strong>{" "}
                      under target.
                    </span>
                  )}
                </p>
              )}

              {!recs.within_budget && recs.budget_note && (
                <p className="mt-4 rounded-xl border border-warn/25 bg-warn-wash p-3 text-xs leading-relaxed text-warn">
                  {recs.budget_note}
                </p>
              )}
            </Card>

            <Card className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                  Today&apos;s plan
                </p>
                <Link
                  href="/recommendations"
                  className="inline-flex items-center gap-1 text-xs font-bold text-accent-deep hover:underline"
                >
                  Full plan <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              {topRecommendations.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-muted">
                  No appliances registered yet.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {topRecommendations.map((a) => (
                    <li
                      key={a.appliance_id}
                      className={clsx(
                        "rounded-xl p-3.5",
                        a.is_essential
                          ? "border-l-4 border-accent-deep bg-accent-wash text-ink"
                          : "bg-surface-muted text-ink",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-sm font-bold">
                          {a.is_essential && (
                            <Lock
                              className="h-3.5 w-3.5 shrink-0 text-accent-deep"
                              aria-label="Essential — never restricted"
                            />
                          )}
                          {a.name}
                        </span>
                        <span className="num shrink-0 text-sm font-bold">
                          {a.recommended_runtime_hours} h
                        </span>
                      </div>
                      <p
                        className={clsx(
                          "mt-1 text-xs",
                          "text-ink-muted",
                        )}
                      >
                        {a.action_note}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        ) : (
          <Card className="p-4 text-sm text-ink-muted">No plan yet.</Card>
        )}
      </section>
    </div>
  );
}

/** A label/value row inside the Overview card. */
function InkRow({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="num text-sm font-bold text-ink">
        {value}
        <span className="ml-1 text-[11px] font-semibold text-ink-muted">{unit}</span>
      </dd>
    </div>
  );
}

export default function OverviewPage() {
  return <Shell>{(deviceId) => <OverviewBody deviceId={deviceId} />}</Shell>;
}
