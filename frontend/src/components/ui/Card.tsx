import { clsx } from "clsx";

/**
 * The one card shell every surface uses.
 *
 * Two materials, and only two: frosted glass for everything, and a charcoal
 * panel for the single anchor on each screen. A third material would stop the
 * page reading as one atmosphere.
 *
 * `tone="ink"` also sets `.on-ink`, which the focus-ring rule in globals.css
 * keys off so keyboard focus stays visible against the dark fill.
 */
export function Card({
  tone = "glass",
  className,
  children,
}: {
  tone?: "glass" | "strong" | "ink";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={clsx(
        "rounded-[var(--r-card)]",
        tone === "ink" && "on-ink panel-ink text-on-dark",
        tone === "glass" && "glass text-ink",
        tone === "strong" && "glass-strong text-ink",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Card header: title left, optional control right — the reference's arrow slot. */
export function CardHead({
  title,
  hint,
  action,
  tone = "glass",
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  tone?: "glass" | "ink";
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-6 pt-5">
      <div className="min-w-0">
        <h2
          className={clsx(
            "text-[15px] font-semibold tracking-tight",
            tone === "ink" ? "text-on-dark" : "text-ink",
          )}
        >
          {title}
        </h2>
        {hint && (
          <p className={clsx("mt-0.5 text-xs", tone === "ink" ? "text-on-dark-2" : "text-ink-3")}>
            {hint}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
