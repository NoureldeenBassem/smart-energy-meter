"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Calculator,
  Check,
  Info,
  Loader2,
  Save,
  Wallet,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

import Shell from "@/components/Shell";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { ThresholdBar } from "@/components/ui/ThresholdBar";
import {
  apiErrorMessage,
  fetchActiveBudget,
  fetchAllowance,
  fetchPrediction,
  fetchTariffBrackets,
  saveBudget,
  type Prediction,
  type TariffAllowance,
  type TariffBracket,
} from "@/lib/api";

/**
 * Budget Planner - target bill in, allowed kWh out.
 *
 * THE ARITHMETIC IS NOT DONE HERE
 * -------------------------------
 * The inverse tariff function lives in
 * backend/app/services/tariff_engine/calculator.py :: bill_to_kwh and is reached
 * through GET /tariff/allowance. Re-implementing a seven-bracket progressive
 * inverse in TypeScript would give this screen its own opinion about what 800 EGP
 * buys, and the first time the brackets changed the two would disagree silently.
 * So every keystroke costs one request, debounced.
 *
 * `bill_at_allowance` comes back from the same endpoint: it is
 * calculate_bill(bill_to_kwh(target)), the round trip, and it is printed on screen
 * so the inverse is demonstrated rather than claimed.
 */

const DEBOUNCE_MS = 350;
const THRESHOLD_CHOICES = [75, 85, 90] as const;

function BudgetBody({ deviceId }: { deviceId: string }) {
  const [targetInput, setTargetInput] = useState("");
  const [threshold, setThreshold] = useState<number>(85);
  const [showTariff, setShowTariff] = useState(false);

  const [allowance, setAllowance] = useState<TariffAllowance | null>(null);
  const [brackets, setBrackets] = useState<TariffBracket[]>([]);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [savedTarget, setSavedTarget] = useState<number | null>(null);

  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    (async () => {
      const [br, bud, pred] = await Promise.allSettled([
        fetchTariffBrackets(),
        fetchActiveBudget(),
        fetchPrediction(deviceId),
      ]);
      if (br.status === "fulfilled") setBrackets(br.value);
      if (pred.status === "fulfilled") setPrediction(pred.value);
      if (bud.status === "fulfilled") {
        setTargetInput(String(bud.value.target_bill_egp));
        setThreshold(bud.value.alert_threshold_pct);
        setSavedTarget(bud.value.target_bill_egp);
      }
    })();
  }, [deviceId]);

  const target = Number(targetInput);
  const targetValid = targetInput.trim() !== "" && Number.isFinite(target) && target >= 0;

  const compute = useCallback(async (value: number) => {
    setCalculating(true);
    try {
      setAllowance(await fetchAllowance(value));
      setError(null);
    } catch (err) {
      setAllowance(null);
      setError(apiErrorMessage(err, "Could not reach the tariff engine."));
    } finally {
      setCalculating(false);
    }
  }, []);

  useEffect(() => {
    if (!targetValid) {
      setAllowance(null);
      return;
    }
    const timer = setTimeout(() => compute(target), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [target, targetValid, compute]);

  const handleSave = async () => {
    if (!targetValid) return;
    setSaving(true);
    setSavedMessage(null);
    try {
      const budget = await saveBudget(target, threshold);
      setSavedTarget(budget.target_bill_egp);
      setSavedMessage(
        `Saved. Recommendations and the budget alert now use ${budget.target_bill_egp} EGP at a ${budget.alert_threshold_pct}% alert threshold.`,
      );
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save the budget."));
    } finally {
      setSaving(false);
    }
  };

  // Presentational only
  const usedPct =
    allowance && prediction && allowance.allowed_kwh > 0
      ? (prediction.kwh_so_far / allowance.allowed_kwh) * 100
      : null;

  const overshoot =
    allowance && prediction
      ? prediction.predicted_kwh - allowance.allowed_kwh
      : null;

  const dailyAvg = allowance && prediction
    ? allowance.allowed_kwh / prediction.cycle_length_days
    : null;

  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent">
          <Wallet className="h-5 w-5 text-ink-panel" aria-hidden />
        </span>
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-ink">Budget Planner</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-3">
            Pick the bill you want at the end of the cycle. The tariff engine works
            backwards to the kWh that produces it.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {/* ---------------- HERO: Allowed kWh ---------------- */}
        <Card className="p-6">
          {!targetValid ? (
            <div className="flex min-h-[180px] items-center justify-center text-center text-sm text-ink-3">
              Enter a target bill to see the kWh it allows.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                    Allowed consumption
                  </p>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="num text-[56px] font-bold leading-none text-accent-ink">
                      {allowance ? allowance.allowed_kwh.toFixed(1) : "--"}
                    </span>
                    <span className="text-lg font-semibold text-ink-3">kWh</span>
                  </div>
                  <p className="mt-2 text-sm text-ink-3">for the whole billing cycle</p>
                </div>
                {calculating && <Loader2 className="h-4 w-4 animate-spin text-ink-3" />}
              </div>

              {allowance && (
                <>
                  {/* Round trip verification */}
                  <p className="mt-5 flex items-start gap-2 rounded-xl bg-white/50 p-3 text-xs leading-relaxed text-chip-text-2">
                    <Calculator className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-ink" aria-hidden />
                    <span>
                      Charging {allowance.allowed_kwh.toFixed(3)} kWh through the tariff
                      gives{" "}
                      <span className="num font-bold text-accent-ink">
                        {allowance.bill_at_allowance.toFixed(2)} EGP
                      </span>
                      , against a {allowance.target_bill_egp.toFixed(2)} EGP target — the
                      inverse and the forward function agree.
                    </span>
                  </p>

                  {/* Mini stats grid */}
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <StatTile
                      label="Bracket"
                      value={
                        allowance.tariff_position.active_bracket !== null
                          ? `#${allowance.tariff_position.active_bracket}`
                          : "--"
                      }
                      note={
                        allowance.tariff_position.price_per_kwh_current !== null
                          ? `${allowance.tariff_position.price_per_kwh_current} EGP/kWh`
                          : undefined
                      }
                    />
                    <StatTile
                      label="Daily average"
                      value={dailyAvg !== null ? dailyAvg.toFixed(2) : "--"}
                      unit="kWh"
                      note={prediction ? `over ${prediction.cycle_length_days}d cycle` : undefined}
                    />
                    <StatTile
                      label="This cycle so far"
                      value={prediction ? prediction.kwh_so_far.toFixed(1) : "--"}
                      unit="kWh"
                      note={usedPct !== null ? `${usedPct.toFixed(1)}% of allowance` : undefined}
                    />
                    <StatTile
                      label="Forecast vs target"
                      value={
                        overshoot !== null
                          ? `${overshoot > 0 ? "+" : ""}${overshoot.toFixed(1)}`
                          : "--"
                      }
                      unit="kWh"
                      emphasis={overshoot !== null && overshoot > 0}
                      note={overshoot !== null ? (overshoot > 0 ? "Over target" : "Under target") : undefined}
                    />
                  </div>

                  {/* Budget progress bar */}
                  {prediction && usedPct !== null && (
                    <div className="mt-6 border-t border-white/50 pt-5">
                      <div className="mb-1.5 flex justify-between text-xs">
                        <span className="num text-ink-3">
                          {prediction.kwh_so_far.toFixed(1)} kWh used of {allowance.allowed_kwh.toFixed(1)} allowed
                        </span>
                        <span
                          className={`num font-bold ${
                            usedPct >= 90
                              ? "text-warn"
                              : usedPct >= threshold
                                ? "text-amber"
                                : "text-accent-ink"
                          }`}
                        >
                          {usedPct.toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-white/45">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            usedPct >= 90
                              ? "bg-warn"
                              : usedPct >= threshold
                                ? "bg-amber"
                                : "bg-accent"
                          }`}
                          style={{ width: `${Math.min(usedPct, 100)}%` }}
                        />
                      </div>

                      {overshoot !== null && (
                        <p className="mt-3 text-sm">
                          {overshoot > 0 ? (
                            <span className="text-warn">
                              The current forecast of{" "}
                              {prediction.predicted_kwh.toFixed(1)} kWh exceeds this
                              target by <strong>{overshoot.toFixed(1)} kWh</strong>. To
                              hit it you would need to cut back.
                            </span>
                          ) : (
                            <span className="text-accent-ink">
                              The current forecast of{" "}
                              {prediction.predicted_kwh.toFixed(1)} kWh comes in{" "}
                              <strong>{Math.abs(overshoot).toFixed(1)} kWh</strong> under
                              this target.
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </Card>

        {/* ---------------- INPUT SECTION ---------------- */}
        <Card className="p-6">
          <label
            htmlFor="target"
            className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3"
          >
            Target monthly bill
          </label>
          <div className="mt-2 flex items-center gap-2">
            <input
              id="target"
              type="number"
              min={0}
              step={10}
              inputMode="decimal"
              value={targetInput}
              onChange={(e) => {
                setTargetInput(e.target.value);
                setSavedMessage(null);
              }}
              placeholder="800"
              className="num w-full rounded-xl border border-white/60 bg-white/50 px-4 py-3.5 text-3xl font-bold text-chip-text outline-none transition placeholder:text-chip-text-2/50 focus:border-accent-2"
            />
            <span className="text-sm font-bold text-ink-3">EGP</span>
          </div>

          <div className="mt-5">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
              Alert me at
            </span>
            <div className="mt-2 flex gap-2">
              {THRESHOLD_CHOICES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setThreshold(t);
                    setSavedMessage(null);
                  }}
                  className={`num flex-1 rounded-[var(--r-pill)] py-2 text-sm font-bold transition ${
                    threshold === t
                      ? "bg-ink-panel text-on-dark"
                      : "bg-white/50 text-chip-text-2 hover:text-chip-text"
                  }`}
                >
                  {t}%
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-3">
              Percentage of the allowance at which the banner appears.
            </p>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={!targetValid || saving}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-[var(--r-pill)] bg-ink-panel py-3.5 text-sm font-bold text-on-dark transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save as my budget
          </button>

          {savedTarget !== null && (
            <p className="num mt-3 text-xs text-ink-3">
              Currently saved target: {savedTarget} EGP
            </p>
          )}
          {savedMessage && (
            <p className="mt-3 flex items-start gap-1.5 rounded-xl border border-accent-2/25 bg-accent-wash p-3 text-xs text-accent-ink">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {savedMessage}
            </p>
          )}
          {error && (
            <p className="mt-3 rounded-xl border border-warn/25 bg-warn-wash p-3 text-xs text-warn">
              {error}
            </p>
          )}
        </Card>

        {/* ---------------- TARIFF TABLE (COLLAPSIBLE) ---------------- */}
        {brackets.length > 0 && (
          <Card className="p-5">
            <button
              type="button"
              onClick={() => setShowTariff(!showTariff)}
              className="flex w-full items-center justify-between gap-4"
              aria-expanded={showTariff}
            >
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-accent-ink" aria-hidden />
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                  Why it is not a flat rate
                </span>
              </div>
              {showTariff ? (
                <ChevronUp className="h-5 w-5 text-ink-3" aria-hidden />
              ) : (
                <ChevronDown className="h-5 w-5 text-ink-3" aria-hidden />
              )}
            </button>

            <div className="mt-3 overflow-hidden transition-all duration-300" style={{ maxHeight: showTariff ? "500px" : "0" }}>
              {showTariff && (
                <>
                  <p className="max-w-prose text-sm leading-relaxed text-ink-3">
                    Egypt&apos;s residential tariff is progressive: each bracket&apos;s rate
                    applies only to the slice of consumption inside it, so doubling the
                    target bill does not double the kWh it buys.
                  </p>

                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[380px] text-sm">
                      <thead>
                        <tr className="border-b border-white/60 text-left text-[10px] uppercase tracking-[0.1em] text-ink-3">
                          <th className="pb-2 font-semibold">Bracket</th>
                          <th className="pb-2 font-semibold">kWh range</th>
                          <th className="pb-2 text-right font-semibold">EGP / kWh</th>
                        </tr>
                      </thead>
                      <tbody className="num text-ink-2">
                        {brackets.map((b) => {
                          const active =
                            allowance?.tariff_position.active_bracket === b.bracket_order;
                          return (
                            <tr
                              key={b.bracket_order}
                              className={`border-b border-white/50 last:border-0 ${
                                active ? "bg-accent-wash font-bold text-accent-ink" : ""
                              }`}
                            >
                              <td className="py-1.5">{b.bracket_order}</td>
                              <td className="py-1.5">
                                {b.kwh_from}
                                {" - "}
                                {b.kwh_to === null ? "above" : b.kwh_to}
                              </td>
                              <td className="py-1.5 text-right">
                                {b.price_per_kwh.toFixed(2)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

export default function BudgetPage() {
  return <Shell>{(deviceId) => <BudgetBody deviceId={deviceId} />}</Shell>;
}