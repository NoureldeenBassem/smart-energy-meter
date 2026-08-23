"use client";

import Link from "next/link";
import { AlertTriangle, OctagonAlert } from "lucide-react";

import type { BudgetAlert } from "@/lib/api";

/**
 * Two-tier budget alert banner.
 *
 * WHERE THE NUMBERS COME FROM
 * ---------------------------
 * `pct_of_budget_used` is computed by the backend
 * (services/recommendation/engine.py :: check_budget_alert) as
 * `current_month_kwh / bill_to_kwh(target_bill_egp)`, where current_month_kwh is
 * the Africa/Cairo cycle-to-date figure. Nothing is recalculated here.
 *
 * The WARNING tier fires on the backend's own `alert_triggered`, which uses the
 * user's configured `alert_threshold_pct` (75% on the demo account). The CRITICAL
 * tier at 90% is a presentation split on the same backend percentage - it does not
 * invent a second measurement, it just stops a 94%-of-budget month from being
 * shown in the same amber as a 76% one.
 *
 * Below the threshold the component renders nothing. A banner that is always
 * present is a banner nobody reads.
 */

const CRITICAL_PCT = 90;

export default function AlertBanner({
  alert,
  daysRemaining,
}: {
  alert: BudgetAlert | null | undefined;
  daysRemaining?: number;
}) {
  if (!alert || !alert.alert_triggered) return null;

  const critical = alert.pct_of_budget_used >= CRITICAL_PCT;
  const pct = alert.pct_of_budget_used.toFixed(1);

  return (
    <div
      role="alert"
      className={`mb-6 flex items-start gap-3 rounded-xl border p-4 ${
        critical
          ? "border-rose-800 bg-rose-950/40"
          : "border-amber-800 bg-amber-950/30"
      }`}
    >
      {critical ? (
        <OctagonAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
      ) : (
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
      )}

      <div className="min-w-0">
        <p
          className={`text-sm font-semibold ${
            critical ? "text-rose-200" : "text-amber-200"
          }`}
        >
          {critical
            ? `Critical - ${pct}% of your budget is already spent`
            : `Heads up - ${pct}% of your budget is spent`}
          {typeof daysRemaining === "number" && (
            <span className="font-normal opacity-80">
              {" "}
              with {daysRemaining} {daysRemaining === 1 ? "day" : "days"} left in the
              cycle
            </span>
          )}
        </p>

        {/* The backend's own wording, shown verbatim rather than paraphrased. */}
        {alert.message && (
          <p className="mt-1 text-sm text-slate-300">{alert.message}</p>
        )}

        <p className="mt-1 text-xs text-slate-400">
          Your alert threshold is {alert.alert_threshold_pct}%.{" "}
          <Link
            href="/recommendations"
            className="underline decoration-dotted hover:text-slate-200"
          >
            See what to cut back
          </Link>
          {" or "}
          <Link
            href="/budget"
            className="underline decoration-dotted hover:text-slate-200"
          >
            adjust your target
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
