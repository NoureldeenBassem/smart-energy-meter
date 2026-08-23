"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Lock } from "lucide-react";
import { clsx } from "clsx";

import Shell from "@/components/Shell";
import AlertBanner from "@/components/AlertBanner";
import HeroScene from "@/components/HeroScene";
import PhaseDial from "@/components/PhaseDial";
import TrendChart from "@/components/TrendChart";
import PowerGauge, { fullScaleFor } from "@/components/PowerGauge";
import { Card, CardHead } from "@/components/ui/Card";
import { ThresholdBar } from "@/components/ui/ThresholdBar";
import {
  apiErrorMessage,
  fetchAllowance,
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
 * Overview.
 *
 * Composition follows the reference: the scene holds the left column with the
 * charcoal Overview panel anchored beneath it, and the analytical cards stack to
 * the right — tariff position, phase, then the cycle trend running full width.
 *
 * Every figure is fetched. The only browser-side arithmetic is presentational
 * geometry, and each site is marked: the confidence marker's offset, the budget
 * bar's width, and how far into each published bracket the fetched cycle-to-date
 * consumption sits. No price, allowance or forecast is recomputed here.
 */

const LIVE_POLL_MS = 5000;
const FORECAST_POLL_MS = 30000;

function OverviewBody({ deviceId }: { deviceId: string }) {
  const [telemetry, setTelemetry] = useState<TelemetryDashboard | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [recs, setRecs] = useState<RecommendationDashboard | null>(null);
  const [daily, setDaily] = useState<DailyBucket[]>([]);
  const [brackets, setBrackets] = useState<TariffBracket[]>([]);
  const [allowedKwh, setAllowedKwh] = useState<number | null>(null);

  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [predictionError, setPredictionError] = useState<string | null>(null);
  const [recsError, setRecsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Each section reports its own failure. One endpoint being down must not blank
  // the other two — a missing budget is a normal state for a new account and it
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
      // The budget ceiling drawn on the trend is the tariff engine's own inverse
      // of the saved target, fetched — never a kWh figure derived in the browser.
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

    const liveTimer = setInterval(loadLive, LIVE_POLL_MS);
    const forecastTimer = setInterval(loadForecast, FORECAST_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(liveTimer);
      clearInterval(forecastTimer);
    };
  }, [loadLive, loadForecast]);

  useEffect(() => {
    fetchTariffBrackets().then(setBrackets).catch(() => setBrackets([]));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-40">
        <span className="pulse-dot h-9 w-9 rounded-full bg-accent" />
      </div>
    );
  }

  // ---- presentational geometry (the only browser-side arithmetic here) ----
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

  const connectedLoadW = recs?.allocations.reduce((s, a) => s + a.rated_power_w, 0) ?? 0;
  const gaugeFullScale = fullScaleFor(connectedLoadW);

  // A reading older than a minute is not "live". The meter's own timestamp is the
  // right thing to age, not the time the row was written.
  const readingAgeSeconds = telemetry
    ? (Date.now() - new Date(telemetry.last_updated).getTime()) / 1000
    : null;
  const readingIsStale = readingAgeSeconds !== null && readingAgeSeconds > 60;
  const meterLive = telemetry !== null && !readingIsStale;

  const kwhSoFar = prediction?.kwh_so_far ?? telemetry?.month_energy_kwh ?? 0;
  const threshold = recs?.alert.alert_threshold_pct ?? 85;

  // Headroom under target, as a percentage — rendered on the scene ONLY when the
  // forecast actually lands under the target. Never a fabricated "saving".
  const savingPct =
    prediction && recs && recs.target_bill_egp > 0 && overTargetEgp !== null && overTargetEgp < 0
      ? (Math.abs(overTargetEgp) / recs.target_bill_egp) * 100
      : null;

  return (
    <div className="space-y-4">
      <AlertBanner alert={recs?.alert} daysRemaining={recs?.days_remaining_in_month} />

      {telemetryError && (
        <Card className="!border-warn/35 p-4 text-sm text-warn">{telemetryError}</Card>
      )}

      <div className="grid gap-4 xl:grid-cols-12">
        {/* ===================== left: scene + anchor ===================== */}
        <div className="flex flex-col gap-4 xl:col-span-4">
          <div className="rise d1 flex-1">
            <HeroScene
              live={meterLive}
              watts={telemetry?.active_power ?? null}
              kwhCycle={kwhSoFar}
              savingPct={savingPct}
            />
          </div>

          <Card tone="ink" className="rise d2 p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-[15px] font-semibold text-on-dark">Overview</h2>
                <p className="mt-0.5 text-xs text-on-dark-2">Live power draw</p>
              </div>
              <span className="rounded-[var(--r-pill)] bg-white/15 px-3 py-1.5 text-[11px] font-semibold text-on-dark">
                Today
              </span>
            </div>

            <div className="mt-1">
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

            <dl className="mt-5 space-y-3.5 border-t border-ink-panel-line pt-5">
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
                  prediction ? `${prediction.day_of_month} / ${prediction.cycle_length_days}` : "--"
                }
                unit="days"
              />
            </dl>

            {telemetry && (
              <p className="mt-4 text-[11px] leading-relaxed text-on-dark-2">
                Timestamped{" "}
                <span className="num">{new Date(telemetry.last_updated).toLocaleTimeString()}</span>{" "}
                by the device itself, not on arrival.
              </p>
            )}
          </Card>
        </div>

        {/* ===================== right: analysis ===================== */}
        <div className="grid content-start gap-4 xl:col-span-8">
          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="rise d3 lg:col-span-3">
              <CardHead
                title="Tariff position"
                hint="Egypt's progressive brackets — each rate applies only to its own slice"
                action={
                  <Link
                    href="/budget"
                    aria-label="Open the budget planner"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/60 text-ink-3 transition hover:bg-ink-panel hover:text-accent"
                  >
                    <ArrowUpRight className="h-4 w-4" aria-hidden />
                  </Link>
                }
              />
              <div className="space-y-3 px-6 pb-6 pt-4">
                {brackets.length === 0 ? (
                  <p className="text-sm text-ink-3">Tariff schedule unavailable.</p>
                ) : (
                  brackets.map((b) => {
                    // Presentational only: how much of THIS published bracket the
                    // fetched cycle-to-date consumption fills. No price computed.
                    const upper = b.kwh_to ?? b.kwh_from + 400;
                    const width = upper - b.kwh_from;
                    const filled = Math.min(Math.max(kwhSoFar - b.kwh_from, 0), width);
                    const isActive =
                      prediction?.tariff_position.active_bracket === b.bracket_order;
                    const done = filled >= width - 1e-9 && b.kwh_to !== null;
                    const remaining = prediction?.tariff_position.kwh_remaining_in_bracket;

                    return (
                      <ThresholdBar
                        key={b.bracket_order}
                        label={`${b.kwh_from}–${b.kwh_to ?? "∞"} kWh`}
                        valueText={`${b.price_per_kwh.toFixed(2)} EGP`}
                        fraction={width > 0 ? filled / width : 0}
                        state={isActive ? "active" : done ? "normal" : "muted"}
                        note={
                          isActive && remaining !== null && remaining !== undefined
                            ? `You are here — ${remaining.toFixed(0)} kWh before the next bracket`
                            : undefined
                        }
                      />
                    );
                  })
                )}
              </div>
            </Card>

            <Card className="rise d4 lg:col-span-2">
              <CardHead title="Phase" hint="Power factor is the V–I angle" />
              <div className="px-5 pb-6 pt-3">
                <PhaseDial
                  powerFactor={telemetry?.power_factor ?? null}
                  voltage={telemetry?.voltage ?? null}
                  current={telemetry?.current ?? null}
                  stale={readingIsStale}
                />
              </div>
            </Card>
          </div>

          <Card className="rise d5">
            <CardHead
              title="Consumption trend"
              hint="Cumulative kWh against the budget ceiling, carried to cycle end"
              action={
                <span className="rounded-[var(--r-pill)] bg-white/55 px-3.5 py-1.5 text-[11px] font-semibold text-ink-2">
                  This cycle
                </span>
              }
            />
            <TrendChart
              days={daily}
              predictedKwh={prediction?.predicted_kwh ?? null}
              predictedBillEgp={prediction?.predicted_bill_egp ?? null}
              allowedKwh={allowedKwh}
              cycleLengthDays={prediction?.cycle_length_days ?? null}
            />
          </Card>

          {/* ---- the money row ---- */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="rise d6 p-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                Predicted bill
              </p>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="num text-[34px] font-bold leading-none text-accent-ink">
                  {prediction ? prediction.predicted_bill_egp.toFixed(0) : "--"}
                </span>
                <span className="text-sm font-semibold text-ink-3">EGP</span>
              </div>
              {prediction && (
                <>
                  <p className="mt-1.5 text-xs text-ink-3">
                    {prediction.predicted_kwh.toFixed(0)} kWh ·{" "}
                    {prediction.days_remaining_in_cycle} days left
                  </p>
                  <div className="mt-4">
                    <div className="mb-1.5 flex justify-between text-[10px] text-ink-3">
                      <span className="num">
                        {prediction.confidence_bill_low_egp.toFixed(0)}
                      </span>
                      <span className="font-semibold">80% range</span>
                      <span className="num">
                        {prediction.confidence_bill_high_egp.toFixed(0)}
                      </span>
                    </div>
                    <div className="relative h-2.5 rounded-full bg-white/50">
                      <div className="absolute inset-0 rounded-full bg-accent/60" />
                      <div
                        className="absolute top-1/2 h-4 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-panel"
                        style={{ left: `${markerPct}%` }}
                        title={`Point estimate ${prediction.predicted_bill_egp.toFixed(0)} EGP`}
                      />
                    </div>
                  </div>
                </>
              )}
            </Card>

            <Card className="rise d6 p-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                Spent so far
              </p>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="num text-[34px] font-bold leading-none text-ink">
                  {prediction ? prediction.bill_so_far_egp.toFixed(0) : "--"}
                </span>
                <span className="text-sm font-semibold text-ink-3">EGP</span>
              </div>
              {prediction && (
                <p className="mt-1.5 text-xs text-ink-3">
                  {prediction.kwh_so_far.toFixed(1)} kWh billed to date
                </p>
              )}
              {prediction &&
                prediction.tariff_position.price_per_kwh_current !== null && (
                  <p className="mt-4 rounded-xl bg-white/45 p-3 text-[11px] leading-relaxed text-ink-2">
                    Bracket{" "}
                    <span className="font-bold">
                      {prediction.tariff_position.active_bracket}
                    </span>{" "}
                    at {prediction.tariff_position.price_per_kwh_current} EGP/kWh
                  </p>
                )}
            </Card>

            <Card className="rise d6 p-5">
              <div className="flex items-start justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                  Budget used
                </p>
                <Link
                  href="/recommendations"
                  aria-label="Open today's plan"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/60 text-ink-3 transition hover:bg-ink-panel hover:text-accent"
                >
                  <ArrowUpRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span
                  className={clsx(
                    "num text-[34px] font-bold leading-none",
                    usedPct >= 90
                      ? "text-warn"
                      : usedPct >= threshold
                        ? "text-accent-ink"
                        : "text-ok",
                  )}
                >
                  {recs ? usedPct.toFixed(0) : "--"}
                </span>
                <span className="text-sm font-semibold text-ink-3">%</span>
              </div>
              {recs && (
                <>
                  <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/50">
                    <div
                      className={clsx(
                        "h-full rounded-full transition-all duration-700",
                        usedPct >= 90
                          ? "bg-warn"
                          : usedPct >= threshold
                            ? "bg-accent"
                            : "bg-ok",
                      )}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                  {overTargetEgp !== null && (
                    <p className="mt-2.5 text-[11px] leading-relaxed">
                      {overTargetEgp > 0 ? (
                        <span className="text-warn">
                          Overshooting by{" "}
                          <strong className="num">{overTargetEgp.toFixed(0)} EGP</strong>
                        </span>
                      ) : (
                        <span className="text-ok">
                          Under target by{" "}
                          <strong className="num">
                            {Math.abs(overTargetEgp).toFixed(0)} EGP
                          </strong>
                        </span>
                      )}
                    </p>
                  )}
                </>
              )}
            </Card>
          </div>

          {/* ---- method + today's plan ---- */}
          <div className="grid gap-4 lg:grid-cols-2">
            {predictionError ? (
              <Card className="!border-warn/35 p-5 text-sm text-warn">{predictionError}</Card>
            ) : (
              prediction && (
                <Card className="p-5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                    Method
                  </p>
                  <p className="mt-2 text-sm font-bold text-ink">
                    {prediction.prediction_method === "model"
                      ? "LightGBM model"
                      : "Naive baseline"}
                  </p>
                  {prediction.prediction_method === "model" ? (
                    <p className="mt-2 text-xs leading-relaxed text-ink-3">
                      Naive baseline says {prediction.naive_prediction_kwh.toFixed(1)} kWh; the
                      model corrects it by {prediction.model_correction_kwh >= 0 ? "+" : ""}
                      {prediction.model_correction_kwh.toFixed(2)} kWh.
                    </p>
                  ) : (
                    <p className="mt-2 text-xs font-medium leading-relaxed text-warn">
                      Model withheld: {prediction.fallback_reason}
                    </p>
                  )}
                  <p className="num mt-3 text-[10px] text-ink-3">{prediction.model_version}</p>
                  {prediction.data_quality.warning && (
                    <p className="mt-2 text-xs font-medium text-warn">
                      {prediction.data_quality.warning}
                    </p>
                  )}
                  <p className="mt-2 text-[11px] text-ink-3">
                    {prediction.data_quality.days_with_readings}/
                    {prediction.data_quality.days_elapsed} elapsed days carry telemetry
                    {prediction.data_quality.days_missing > 0 &&
                      ` (${prediction.data_quality.days_missing} missing)`}
                    .
                  </p>
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                    {prediction.confidence_label}. Basis: {prediction.confidence_basis}.
                  </p>
                </Card>
              )
            )}

            {recsError ? (
              <Card className="!border-warn/35 p-5 text-sm text-warn">
                {recsError}
                <div className="mt-3">
                  <Link
                    href="/budget"
                    className="inline-flex items-center gap-1.5 rounded-[var(--r-pill)] bg-ink-panel px-4 py-2 text-xs font-semibold text-on-dark transition hover:opacity-90"
                  >
                    Set a target bill <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </Card>
            ) : (
              recs && (
                <Card className="p-5">
                  <div className="mb-3.5 flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                      Today&apos;s plan
                    </p>
                    <Link
                      href="/recommendations"
                      className="inline-flex items-center gap-1 text-xs font-bold text-accent-ink hover:underline"
                    >
                      Full plan <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>

                  {topRecommendations.length === 0 ? (
                    <p className="py-8 text-center text-sm text-ink-3">
                      No appliances registered yet.
                    </p>
                  ) : (
                    <ul className="space-y-2.5">
                      {topRecommendations.map((a) => (
                        <li
                          key={a.appliance_id}
                          className={clsx(
                            "rounded-xl p-3.5",
                            a.is_essential ? "panel-ink text-on-dark" : "bg-white/50 text-ink",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 text-sm font-bold">
                              {a.is_essential && (
                                <Lock
                                  className="h-3.5 w-3.5 shrink-0 text-accent"
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
                              a.is_essential ? "text-on-dark-2" : "text-ink-3",
                            )}
                          >
                            {a.action_note}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A label/value row inside the charcoal Overview panel. */
function InkRow({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs text-on-dark-2">{label}</dt>
      <dd className="num text-sm font-bold text-on-dark">
        {value}
        <span className="ml-1 text-[11px] font-semibold text-on-dark-2">{unit}</span>
      </dd>
    </div>
  );
}

export default function OverviewPage() {
  return <Shell>{(deviceId) => <OverviewBody deviceId={deviceId} />}</Shell>;
}
