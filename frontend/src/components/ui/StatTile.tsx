import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { clsx } from "clsx";

import { Card } from "./Card";

/**
 * Small KPI card: big number, muted label, circular arrow button top-right.
 *
 * The arrow NAVIGATES. In the reference it is decoration; here every tile that
 * shows one links to the page that explains the number, so the affordance is
 * honest — a control that looks clickable is clickable.
 */
export function StatTile({
  label,
  value,
  unit,
  sub,
  href,
  hrefLabel,
  emphasis = false,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  href?: string;
  hrefLabel?: string;
  emphasis?: boolean;
}) {
  return (
    <Card className="relative flex h-full flex-col justify-between p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
          {label}
        </span>
        {href && (
          <Link
            href={href}
            aria-label={hrefLabel ?? `Open ${label}`}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/60 text-ink-3 transition hover:bg-ink-panel hover:text-accent"
          >
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </Link>
        )}
      </div>

      <div className="mt-5">
        <div className="flex items-baseline gap-1.5">
          <span
            className={clsx(
              "num text-[30px] font-bold leading-none",
              emphasis ? "text-accent-ink" : "text-ink",
            )}
          >
            {value}
          </span>
          {unit && (
            <span className="text-sm font-semibold text-ink-3">{unit}</span>
          )}
        </div>
        {sub && <p className="mt-1.5 text-xs text-ink-3">{sub}</p>}
      </div>
    </Card>
  );
}
