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
import { clsx } from "clsx";

import Shell from "@/components/Shell";
import AlertBanner from "@/components/AlertBanner";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { ThresholdBar } from "@/components/ui/ThresholdBar";
import { SectionHeading } from "@/components/ui/SectionHeading";
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
 * `priority` is deliberately NOT drawn as protection — a High-priority
 * non-essential appliance gets trimmed like any other, and showing the two the
 * same way is the exact conflation that made the guarantee fake in the first place.
 *
 * Essentials are marked by an accent left edge, a padlock and their own group
 * heading, so the two sets are separable before any label is read. The page
 * carries no dark panels, so protection reads from the edge and the icon rather
 * than from an inverted fill.
 */

const STATUS_STYLES: Record<
  AllocationStatus,
  { label: string; chip: string; icon: React.ReactNode }
> = {
  essential: {
    label: "Locked",
    chip: "bg-accent-wash text-accent-deep border-accent-deep/30",
    icon: <Lock className="h-3 w-3" aria-hidden />,
  },
  optimal: {
    label: "Full runtime",
    chip: "bg-surface-muted text-ink-soft border-line",
    icon: <CheckCircle2 className="h-3 w-3" aria-hidden />,
  },
  constrained: {
    label: "Reduced",
    chip: "bg-accent-wash text-accent-deep border-accent-deep/25",
    icon: <TriangleAlert className="h-3 w-3" aria-hidden />,
  },
  shed: {
    label: "Skip today",
    chip: "bg-warn-wash text-warn border-warn/25",
    icon: <Ban className="h-3 w-3" aria-hidden />,
  },
  away: {
    label: "Off (away)",
    chip: "bg-surface-muted text-ink-muted border-line",
    icon: <Moon className="h-3 w-3" aria-hidden />,
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
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-7 w-7 animate-spin text-accent-deep" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border border-warn/25 bg-warn-wash p-5 text-sm text-warn">
        {error}
        <div className="mt-3">
          <Link
            href="/budget"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-surface-ink px-3.5 py-2 text-xs font-semibold text-ink-onDark transition hover:opacity-90"
          >
            Set a target bill <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </Card>
    );
  }

  const essentials = data?.allocations.filter((a) => a.is_essential) ?? [];
  const discretionary = data?.allocations.filter((a) => !a.is_essential) ?? [];
  const planTotal = data?.total_allocated_kwh ?? 0;

  return (
    <div className="space-y-8">
      <AlertBanner alert={data?.alert} daysRemaining={data?.days_remaining_in_month} />

      <div>
        <h1 className="text-[28px] font-bold tracking-tight text-ink">Today&apos;s plan</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          How long to run each appliance to stay inside the budget. Essential appliances
          are reserved first and are never reduced.
        </p>
      </div>

      {/* Mode switcher — same pill vocabulary as the top nav, so "selected" reads
          the same way in both places. */}
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
            Household mode
          </span>
          {switching && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-muted" />}
        </div>
        <div
          role="group"
          aria-label="Household mode"
          className="flex flex-wrap gap-2 rounded-[var(--radius-pill)] bg-surface-muted p-1.5"
        >
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={clsx(
                "flex-1 whitespace-nowrap rounded-[var(--radius-pill)] px-4 py-2 text-sm font-semibold transition",
                mode === m
                  ? "bg-surface-ink text-ink-onDark shadow-sm"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          Mode scales only the discretionary allowance. Even in{" "}
          <span className="font-semibold text-ink-soft">Away</span>, which drops it to
          zero, essential appliances keep their full runtime.
        </p>
      </Card>

      {data && (
        <>
          {/* Budget split */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Budget for today"
              value={data.budget_daily_kwh.toFixed(2)}
              unit="kWh"
              sub={`${data.daily_kwh_allowance.toFixed(1)} kWh left over ${data.days_remaining_in_month}d`}
            />
            <StatTile
              label="Reserved for essentials"
              value={data.essential_kwh.toFixed(2)}
              unit="kWh"
              sub="Taken off the top, before anything else"
              emphasis
            />
            <StatTile
              label="Discretionary pool"
              value={data.discretionary_kwh_allowance.toFixed(2)}
              unit="kWh"
              sub={`${MODE_LABELS[data.active_mode]} mode`}
            />
            <StatTile
              label="Total planned"
              value={data.total_allocated_kwh.toFixed(2)}
              unit="kWh"
              sub={data.within_budget ? "Within budget" : "Over budget — see note below"}
            />
          </div>

          {!data.within_budget && data.budget_note && (
            <Card className="flex items-start gap-3 border border-warn/25 bg-warn-wash p-4">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warn" aria-hidden />
              <div>
                <p className="text-sm font-bold text-warn">
                  This plan does not fit the target
                </p>
                <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                  {data.budget_note}
                </p>
              </div>
            </Card>
          )}

          {/* Share of today's plan — the reference's threshold rows, applied to
              appliances. Proportion of the fetched total; no energy is recomputed. */}
          {data.allocations.length > 0 && planTotal > 0 && (
            <Card className="p-5">
              <SectionHeading
                title="Share of today's plan"
                subtitle="How the day's planned energy divides across the household"
              />
              <div className="space-y-3.5">
                {[...data.allocations]
                  .sort((a, b) => b.estimated_kwh - a.estimated_kwh)
                  .map((a) => (
                    <ThresholdBar
                      key={a.appliance_id}
                      label={a.name}
                      valueText={`${a.estimated_kwh.toFixed(2)} kWh`}
                      fraction={a.estimated_kwh / planTotal}
                      state={
                        a.is_essential
                          ? "active"
                          : a.status === "shed" || a.status === "away"
                            ? "muted"
                            : "normal"
                      }
                    />
                  ))}
              </div>
            </Card>
          )}

          {/* Essentials */}
          {essentials.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink">
                <Lock className="h-4 w-4 text-accent-deep" aria-hidden />
                Essential — protected
                <span className="num rounded-[var(--radius-pill)] bg-accent-wash px-2 py-0.5 text-[11px] font-bold text-accent-deep">
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
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink">
              <Power className="h-4 w-4 text-ink-muted" aria-hidden />
              Adjustable
              {discretionary.length > 0 && (
                <span className="num rounded-[var(--radius-pill)] bg-surface-muted px-2 py-0.5 text-[11px] font-bold text-ink-muted">
                  {discretionary.length}
                </span>
              )}
            </h2>
            {discretionary.length === 0 ? (
              <Card className="p-5 text-sm text-ink-muted">
                Every registered appliance is marked essential, so there is nothing left
                for the allocator to trade off.
              </Card>
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
    </div>
  );
}

function AllocationRow({ allocation: a }: { allocation: Allocation }) {
  const style = STATUS_STYLES[a.status] ?? STATUS_STYLES.optimal;

  return (
    <Card
      className={clsx(
        "p-4",
        a.is_essential && "border-l-4 border-accent-deep",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {a.is_essential ? (
            <span
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-wash"
              title="Essential — never restricted by the allocator"
            >
              <Lock className="h-3.5 w-3.5 text-accent-deep" aria-hidden />
              <span className="sr-only">Essential, never restricted</span>
            </span>
          ) : (
            <span className="h-7 w-7 shrink-0" aria-hidden />
          )}
          <span className="truncate font-bold text-ink">{a.name}</span>
          <span
            className={clsx(
              "inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-pill)] border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              style.chip,
            )}
          >
            {style.icon}
            {style.label}
          </span>
        </div>

        <div className="text-right">
          <span className="num text-xl font-bold text-ink">
            {a.recommended_runtime_hours}
          </span>
          <span className="ml-1 text-xs font-semibold text-ink-muted">h/day</span>
          <p className="num text-xs text-ink-muted">
            {a.estimated_kwh.toFixed(2)} kWh
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
        <span className="num">{a.rated_power_w} W</span>
        <span aria-hidden className="text-ink-muted/50">
          |
        </span>
        {/* priority is shown as what it is — an ordering among adjustable appliances
            only — so it is never mistaken for the protection the padlock means. */}
        <span>
          {a.is_essential ? "Protected regardless of priority" : `${a.priority} priority`}
        </span>
      </div>

      <p className="mt-1.5 text-sm text-ink-soft">{a.action_note}</p>
    </Card>
  );
}

export default function RecommendationsPage() {
  return <Shell>{(deviceId) => <RecommendationsBody deviceId={deviceId} />}</Shell>;
}
