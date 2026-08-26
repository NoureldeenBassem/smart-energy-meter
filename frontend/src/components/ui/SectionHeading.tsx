import { clsx } from "clsx";

/**
 * Numbered section heading.
 *
 * The numbers are kept from the previous /overview because they carry the page's
 * argument: right now -> where the month is heading -> what to do about it.
 * They are presentational, so the numeral is aria-hidden and the heading text
 * alone is what a screen reader announces.
 */
export function SectionHeading({
  step,
  icon,
  title,
  subtitle,
  right,
}: {
  step?: number;
  /** Leading glyph, used where a section is identified by icon rather than by
   *  its position in an argument. Decorative, so it is hidden from the AT tree. */
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div className="flex items-start gap-3">
        {icon && (
          <span
            aria-hidden
            className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full panel-ink text-accent"
          >
            {icon}
          </span>
        )}
        {typeof step === "number" && (
          <span
            aria-hidden
            className={clsx(
              "num mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full",
              "panel-ink text-[12px] font-bold text-accent",
            )}
          >
            {step}
          </span>
        )}
        <div>
          <h2 className="text-[17px] font-bold tracking-tight text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}
