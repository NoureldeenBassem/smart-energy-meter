import { clsx } from "clsx";

/**
 * Horizontal labelled threshold bar — the reference's temperature rows.
 *
 * Used for two things in this product:
 *   * tariff brackets on /overview  (how far into the current price tier)
 *   * per-appliance daily budget on /recommendations
 *
 * The tick marks are drawn from a repeating-linear-gradient rather than as
 * elements, so a bar with any width gets the same visual rhythm without the DOM
 * carrying twenty empty spans.
 *
 * `state` is never the ONLY carrier of meaning: every bar prints its own value
 * as text, so the colour is reinforcement rather than the message.
 */
export function ThresholdBar({
  label,
  valueText,
  fraction,
  state = "normal",
  note,
  marker,
}: {
  label: string;
  valueText: string;
  fraction: number;
  state?: "normal" | "active" | "warn" | "muted";
  note?: string;
  /** 0-1 position of a secondary marker, e.g. where the next bracket starts. */
  marker?: number;
}) {
  const pct = Math.min(Math.max(fraction, 0), 1) * 100;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="truncate text-[13px] font-medium text-ink-soft">{label}</span>
        <span
          className={clsx(
            "num shrink-0 text-[13px] font-semibold",
            state === "warn"
              ? "text-warn"
              : state === "active"
                ? "text-accent-deep"
                : state === "muted"
                  ? "text-ink-muted"
                  : "text-ink",
          )}
        >
          {valueText}
        </span>
      </div>

      <div
        className="relative h-2.5 w-full overflow-hidden rounded-full bg-bg-deep"
        role="img"
        aria-label={`${label}: ${valueText}`}
      >
        {/* tick rhythm */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, transparent 0 7px, rgba(15,23,42,0.22) 7px 8px)",
          }}
        />
        <div
          className={clsx(
            "relative h-full rounded-full transition-[width] duration-700 ease-out",
            state === "warn"
              ? "bg-warn"
              : state === "active"
                ? "bg-accent"
                : state === "muted"
                  ? "bg-ink-muted/45"
                  : "bg-ink-soft",
          )}
          style={{ width: `${pct}%` }}
        />
        {typeof marker === "number" && (
          <span
            aria-hidden
            className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-ink"
            style={{ left: `${Math.min(Math.max(marker, 0), 1) * 100}%` }}
          />
        )}
      </div>

      {note && <p className="mt-1 text-[11px] text-ink-muted">{note}</p>}
    </div>
  );
}
