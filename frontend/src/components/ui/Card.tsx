import { clsx } from "clsx";

/**
 * The one card shell every surface uses.
 *
 * `tone="ink"` is the near-black variant used for the hero Overview card. It sets
 * `.on-ink`, which the focus-ring rule in globals.css keys off so keyboard focus
 * stays visible on a dark background.
 */
export function Card({
  tone = "light",
  className,
  children,
}: {
  tone?: "light" | "ink";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={clsx(
        "rounded-[var(--radius-card)] transition-shadow",
        tone === "ink"
          ? "on-ink bg-surface-ink text-ink-onDark shadow-[var(--shadow-ink)]"
          : "bg-surface text-ink shadow-[var(--shadow-card)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Card header: title on the left, optional action on the right.
 *
 * The reference puts a small circular arrow button in that slot. Here it is a
 * real link rather than an ornament — see StatTile.
 */
export function CardHead({
  title,
  hint,
  action,
  tone = "light",
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  tone?: "light" | "ink";
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5">
      <div className="min-w-0">
        <h2
          className={clsx(
            "text-[15px] font-semibold tracking-tight",
            tone === "ink" ? "text-ink-onDark" : "text-ink",
          )}
        >
          {title}
        </h2>
        {hint && (
          <p
            className={clsx(
              "mt-0.5 text-xs",
              tone === "ink" ? "text-ink-onDark-muted" : "text-ink-muted",
            )}
          >
            {hint}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
