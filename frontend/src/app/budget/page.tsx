"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Calculator,
  Check,
  Info,
  Loader2,
  Save,
  Wallet,
} from "lucide-react";

import Shell from "@/components/Shell";
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

  const [allowance, setAllowance] = useState<TariffAllowance | null>(null);
  const [brackets, setBrackets] = useState<TariffBracket[]>([]);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [savedTarget, setSavedTarget] = useState<number | null>(null);

  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // Initial load: the brackets table, the current budget (prefills the input) and
  // the forecast (so the target can be compared against the trajectory).
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
      // A 404 from /budgets/active is the normal "no target yet" state, not an
      // error worth showing. The empty input is already the right prompt.
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

  // Presentational only: how much of the allowance the cycle has already eaten.
  const usedPct =
    allowance && prediction && allowance.allowed_kwh > 0
      ? (prediction.kwh_so_far / allowance.allowed_kwh) * 100
      : null;

  const overshoot =
    allowance && prediction
      ? prediction.predicted_kwh - allowance.allowed_kwh
      : null;

  return (
    <>
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white">
          <Wallet className="h-6 w-6 text-emerald-400" />
          Budget Planner
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Pick the bill you want at the end of the cycle. The tariff engine works
          backwards to the kWh that produces it.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ---------------- input ---------------- */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
            <label
              htmlFor="target"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-400"
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
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-2xl font-bold text-white outline-none transition placeholder:text-slate-600 focus:border-emerald-500"
              />
              <span className="text-sm font-semibold text-slate-400">EGP</span>
            </div>

            <div className="mt-5">
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
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
                    className={`flex-1 rounded-lg border py-2 text-sm font-semibold transition ${
                      threshold === t
                        ? "border-emerald-500 bg-emerald-600 text-white"
                        : "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-600"
                    }`}
                  >
                    {t}%
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                Percentage of the allowance at which the banner appears.
              </p>
            </div>

            <button
              type="button"
              onClick={handleSave}
              disabled={!targetValid || saving}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save as my budget
            </button>

            {savedTarget !== null && (
              <p className="mt-3 text-xs text-slate-500">
                Currently saved target: {savedTarget} EGP
              </p>
            )}
            {savedMessage && (
              <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-emerald-900/60 bg-emerald-950/25 p-3 text-xs text-emerald-200">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {savedMessage}
              </p>
            )}
            {error && (
              <p className="mt-3 rounded-lg border border-rose-900/60 bg-rose-950/25 p-3 text-xs text-rose-200">
                {error}
              </p>
            )}
          </div>
        </div>

        {/* ---------------- result ---------------- */}
        <div className="lg:col-span-3">
          {!targetValid ? (
            <div className="flex h-full min-h-[220px] items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-500">
              Enter a target bill to see the kWh it allows.
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-900/50 bg-gradient-to-br from-emerald-950/30 to-slate-900 p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300/80">
                    Allowed consumption
                  </p>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-5xl font-bold tracking-tight text-emerald-300">
                      {allowance ? allowance.allowed_kwh.toFixed(1) : "--"}
                    </span>
                    <span className="text-lg text-emerald-200/70">kWh</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-300">
                    for the whole billing cycle
                  </p>
                </div>
                {calculating && (
                  <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                )}
              </div>

              {allowance && (
                <>
                  {/* The round trip, shown rather than asserted. */}
                  <p className="mt-4 flex items-start gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
                    <Calculator className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <span>
                      Charging {allowance.allowed_kwh.toFixed(3)} kWh through the tariff
                      gives{" "}
                      <span className="font-semibold text-slate-200">
                        {allowance.bill_at_allowance.toFixed(2)} EGP
                      </span>
                      , against a {allowance.target_bill_egp.toFixed(2)} EGP target - the
                      inverse and the forward function agree.
                    </span>
                  </p>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <MiniStat
                      label="Lands in bracket"
                      value={
                        allowance.tariff_position.active_bracket !== null
                          ? `#${allowance.tariff_position.active_bracket}`
                          : "--"
                      }
                      note={
                        allowance.tariff_position.price_per_kwh_current !== null
                          ? `${allowance.tariff_position.price_per_kwh_current} EGP per extra kWh`
                          : undefined
                      }
                    />
                    <MiniStat
                      label="Daily average this buys"
                      value={
                        prediction
                          ? (allowance.allowed_kwh / prediction.cycle_length_days).toFixed(2)
                          : "--"
                      }
                      note={
                        prediction
                          ? `over a ${prediction.cycle_length_days}-day cycle`
                          : undefined
                      }
                    />
                  </div>

                  {prediction && (
                    <div className="mt-5 border-t border-slate-800 pt-5">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Against this cycle
                      </p>
                      {usedPct !== null && (
                        <>
                          <div className="mt-2 mb-1.5 flex justify-between text-xs">
                            <span className="text-slate-400">
                              {prediction.kwh_so_far.toFixed(1)} kWh used of{" "}
                              {allowance.allowed_kwh.toFixed(1)} allowed
                            </span>
                            <span
                              className={`font-semibold ${
                                usedPct >= 90
                                  ? "text-rose-400"
                                  : usedPct >= threshold
                                    ? "text-amber-400"
                                    : "text-emerald-400"
                              }`}
                            >
                              {usedPct.toFixed(1)}%
                            </span>
                          </div>
                          <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                usedPct >= 90
                                  ? "bg-rose-500"
                                  : usedPct >= threshold
                                    ? "bg-amber-500"
                                    : "bg-emerald-500"
                              }`}
                              style={{ width: `${Math.min(usedPct, 100)}%` }}
                            />
                          </div>
                        </>
                      )}

                      {overshoot !== null && (
                        <p className="mt-3 text-sm">
                          {overshoot > 0 ? (
                            <span className="text-rose-300">
                              The current forecast of{" "}
                              {prediction.predicted_kwh.toFixed(1)} kWh exceeds this
                              target by <strong>{overshoot.toFixed(1)} kWh</strong>. To
                              hit it you would need to cut back.
                            </span>
                          ) : (
                            <span className="text-emerald-300">
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
            </div>
          )}

          {/* ---------------- why ---------------- */}
          {brackets.length > 0 && (
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-6">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <Info className="h-3.5 w-3.5" />
                Why it is not a flat rate
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Egypt&apos;s residential tariff is progressive: each bracket&apos;s rate
                applies only to the slice of consumption inside it, so doubling the
                target bill does not double the kWh it buys.
              </p>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[380px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wider text-slate-500">
                      <th className="pb-2 font-semibold">Bracket</th>
                      <th className="pb-2 font-semibold">kWh range</th>
                      <th className="pb-2 text-right font-semibold">EGP / kWh</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-slate-300">
                    {brackets.map((b) => {
                      const active =
                        allowance?.tariff_position.active_bracket === b.bracket_order;
                      return (
                        <tr
                          key={b.bracket_order}
                          className={`border-b border-slate-800/60 last:border-0 ${
                            active ? "bg-emerald-950/30 text-emerald-200" : ""
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
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function MiniStat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-[11px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-white">{value}</p>
      {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

export default function BudgetPage() {
  return <Shell>{(deviceId) => <BudgetBody deviceId={deviceId} />}</Shell>;
}
