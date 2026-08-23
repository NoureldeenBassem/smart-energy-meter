"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Ban,
  CheckCircle2,
  Loader2,
  Lock,
  Moon,
  Power,
  TriangleAlert,
} from "lucide-react";

import Shell from "@/components/Shell";
import AlertBanner from "@/components/AlertBanner";
import {
  MODES,
  MODE_LABELS,
  apiErrorMessage,
  fetchRecommendations,
  type Allocation,
  type AllocationStatus,
  type Mode,
  type RecommendationDashboard,
} from "@/lib/api";

/**
 * Today's appliance plan.
 *
 * ESSENTIALS ARE RENDERED LOCKED
 * ------------------------------
 * `is_essential` is a hard backend constraint, not a hint: the allocator reserves
 * an essential appliance's full desired runtime before any budget arithmetic runs,
 * in every mode including "away". So the row shows a padlock, sits in its own
 * group above the adjustable ones, and its runtime is presented as fixed.
 *
 * The lock is a faithful picture of the backend, not a UI convention layered on
 * top: there is no request this screen could send that would reduce that number.
 * `priority` is deliberately NOT drawn as protection - a High-priority
 * non-essential appliance gets trimmed like any other, and showing the two the
 * same way is the exact conflation that made the guarantee fake in the first place.
 */

const STATUS_STYLES: Record<
  AllocationStatus,
  { label: string; row: string; chip: string; icon: React.ReactNode }
> = {
  essential: {
    label: "Locked",
    row: "border-emerald-900/60 bg-emerald-950/20",
    chip: "bg-emerald-950 text-emerald-300 border-emerald-800",
    icon: <Lock className="h-3 w-3" />,
  },
  optimal: {
    label: "Full runtime",
    row: "border-slate-800 bg-slate-950/60",
    chip: "bg-slate-900 text-slate-300 border-slate-700",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  constrained: {
    label: "Reduced",
    row: "border-amber-900/50 bg-amber-950/20",
    chip: "bg-amber-950 text-amber-300 border-amber-800",
    icon: <TriangleAlert className="h-3 w-3" />,
  },
  shed: {
    label: "Skip today",
    row: "border-rose-900/50 bg-rose-950/20",
    chip: "bg-rose-950 text-rose-300 border-rose-900",
    icon: <Ban className="h-3 w-3" />,
  },
  away: {
    label: "Off (away)",
    row: "border-slate-800 bg-slate-950/40",
    chip: "bg-slate-900 text-slate-400 border-slate-700",
    icon: <Moon className="h-3 w-3" />,
  },
};

function RecommendationsBody({ deviceId }: { deviceId: string }) {
  const [mode, setMode] = useState<Mode>("normal");
  const [data, setData] = useState<RecommendationDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (m: Mode, isSwitch: boolean) => {
      if (isSwitch) setSwitching(true);
      try {
        setData(await fetchRecommendations(deviceId, m));
        setError(null);
      } catch (err) {
        setError(apiErrorMessage(err, "Could not load recommendations."));
      } finally {
        setSwitching(false);
        setLoading(false);
      }
    },
    [deviceId],
  );

  useEffect(() => {
    load(mode, false);
  }, [load, mode]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-900/60 bg-rose-950/25 p-5 text-sm text-rose-200">
        {error}
        <div className="mt-3">
          <Link
            href="/budget"
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            Set a target bill <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  const essentials = data?.allocations.filter((a) => a.is_essential) ?? [];
  const discretionary = data?.allocations.filter((a) => !a.is_essential) ?? [];

  return (
    <>
      <AlertBanner alert={data?.alert} daysRemaining={data?.days_remaining_in_month} />

      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white">
          <Power className="h-6 w-6 text-indigo-400" />
          Today&apos;s plan
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          How long to run each appliance to stay inside the budget. Essential
          appliances are reserved first and are never reduced.
        </p>
      </div>

      {/* Mode switcher */}
      <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Household mode
          </span>
          {switching && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`rounded-lg border py-2 text-sm font-semibold transition ${
                mode === m
                  ? "border-emerald-500 bg-emerald-600 text-white"
                  : "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-600"
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <p className="mt-2.5 text-xs text-slate-500">
          Mode scales only the discretionary allowance. Even in{" "}
          <span className="font-semibold text-slate-400">Away</span>, which drops it to
          zero, essential appliances keep their full runtime.
        </p>
      </div>

      {data && (
        <>
          {/* Budget split */}
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label="Budget for today"
              value={data.budget_daily_kwh.toFixed(2)}
              unit="kWh"
              note={`${data.daily_kwh_allowance.toFixed(1)} kWh left over ${data.days_remaining_in_month}d`}
            />
            <Tile
              label="Reserved for essentials"
              value={data.essential_kwh.toFixed(2)}
              unit="kWh"
              accent="text-emerald-300"
              note="Taken off the top, before anything else"
            />
            <Tile
              label="Discretionary pool"
              value={data.discretionary_kwh_allowance.toFixed(2)}
              unit="kWh"
              note={`${MODE_LABELS[data.active_mode]} mode`}
            />
            <Tile
              label="Total planned"
              value={data.total_allocated_kwh.toFixed(2)}
              unit="kWh"
              accent={data.within_budget ? "text-white" : "text-amber-300"}
              note={data.within_budget ? "Within budget" : "Over budget - see note below"}
            />
          </div>

          {!data.within_budget && data.budget_note && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-900/60 bg-amber-950/25 p-4">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div>
                <p className="text-sm font-semibold text-amber-200">
                  This plan does not fit the target
                </p>
                <p className="mt-1 text-sm text-slate-300">{data.budget_note}</p>
              </div>
            </div>
          )}

          {/* Essentials */}
          {essentials.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
                <Lock className="h-4 w-4 text-emerald-400" />
                Essential - protected
                <span className="rounded-full border border-emerald-900 bg-emerald-950/60 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                  {essentials.length}
                </span>
              </h2>
              <div className="space-y-2.5">
                {essentials.map((a) => (
                  <AllocationRow key={a.appliance_id} allocation={a} />
                ))}
              </div>
            </section>
          )}

          {/* Discretionary */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Power className="h-4 w-4 text-slate-400" />
              Adjustable
              {discretionary.length > 0 && (
                <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-slate-400">
                  {discretionary.length}
                </span>
              )}
            </h2>
            {discretionary.length === 0 ? (
              <p className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-500">
                Every registered appliance is marked essential, so there is nothing left
                for the allocator to trade off.
              </p>
            ) : (
              <div className="space-y-2.5">
                {discretionary.map((a) => (
                  <AllocationRow key={a.appliance_id} allocation={a} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

function AllocationRow({ allocation: a }: { allocation: Allocation }) {
  const style = STATUS_STYLES[a.status] ?? STATUS_STYLES.optimal;

  return (
    <div className={`rounded-xl border p-4 ${style.row}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {a.is_essential ? (
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-800 bg-emerald-950"
              title="Essential - never restricted by the allocator"
            >
              <Lock className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
              <span className="sr-only">Essential, never restricted</span>
            </span>
          ) : (
            <span className="h-7 w-7 shrink-0" aria-hidden />
          )}
          <span className="truncate font-semibold text-white">{a.name}</span>
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${style.chip}`}
          >
            {style.icon}
            {style.label}
          </span>
        </div>

        <div className="text-right">
          <span className="text-lg font-bold text-white">
            {a.recommended_runtime_hours}
          </span>
          <span className="ml-1 text-xs text-slate-400">h/day</span>
          <p className="text-xs text-slate-500">{a.estimated_kwh.toFixed(2)} kWh</p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
        <span className="font-mono">{a.rated_power_w} W</span>
        <span className="text-slate-600">|</span>
        {/* priority is shown as what it is - an ordering among adjustable appliances
            only - so it is never mistaken for the protection the padlock means. */}
        <span>
          {a.is_essential
            ? "Protected regardless of priority"
            : `${a.priority} priority`}
        </span>
      </div>

      <p className="mt-1.5 text-sm text-slate-300">{a.action_note}</p>
    </div>
  );
}

function Tile({
  label,
  value,
  unit,
  note,
  accent = "text-white",
}: {
  label: string;
  value: string;
  unit: string;
  note?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className={`text-2xl font-bold ${accent}`}>{value}</span>
        <span className="text-xs text-slate-400">{unit}</span>
      </div>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

export default function RecommendationsPage() {
  return <Shell>{(deviceId) => <RecommendationsBody deviceId={deviceId} />}</Shell>;
}
