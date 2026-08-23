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
      className={`flex items-start gap-3 rounded-[var(--radius-card)] p-4 shadow-[var(--shadow-card)] ${
        critical
          ? "border border-warn/30 bg-warn-wash"
          : "border border-accent-deep/25 bg-accent-wash"
      }`}
    >
      {critical ? (
        <OctagonAlert className="mt-0.5 h-5 w-5 shrink-0 text-warn" aria-hidden />
      ) : (
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-accent-deep" aria-hidden />
      )}

      <div className="min-w-0">
        <p
          className={`text-sm font-bold ${
            critical ? "text-warn" : "text-accent-deep"
          }`}
        >
          {critical
            ? `Critical — ${pct}% of your budget is already spent`
            : `Heads up — ${pct}% of your budget is spent`}
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
          <p className="mt-1 text-sm text-ink-soft">{alert.message}</p>
        )}

        <p className="mt-1.5 text-xs text-ink-muted">
          Your alert threshold is {alert.alert_threshold_pct}%.{" "}
          <Link
            href="/recommendations"
            className="font-semibold underline decoration-dotted underline-offset-2 hover:text-ink"
          >
            See what to cut back
          </Link>
          {" or "}
          <Link
            href="/budget"
            className="font-semibold underline decoration-dotted underline-offset-2 hover:text-ink"
          >
            adjust your target
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
