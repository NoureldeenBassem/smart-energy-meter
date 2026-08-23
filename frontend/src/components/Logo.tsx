/**
 * Wattwise mark.
 *
 * A yellow disc holding a dark meter arc with a bolt cut through it — the dial
 * and the current in one figure, which is what the product is: measurement in
 * service of a decision. Sized by the `size` prop so the same mark serves the
 * nav bar, the auth screen and a favicon without a second asset.
 *
 * The name lives in PRODUCT_NAME so renaming is a one-line change.
 */

export const PRODUCT_NAME = "Wattwise";

export function LogoMark({ size = 38 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label={`${PRODUCT_NAME} logo`}
      className="shrink-0"
    >
      <defs>
        <linearGradient id="wm-disc" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#eef56a" />
          <stop offset="100%" stopColor="#d5de2f" />
        </linearGradient>
      </defs>

      <circle cx="24" cy="24" r="24" fill="url(#wm-disc)" />

      {/* dial arc — 240° sweep, the gauge the whole product is built on */}
      <path
        d="M12.5 31.5 A 14 14 0 1 1 35.5 31.5"
        fill="none"
        stroke="#22262d"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.9"
      />

      {/* tick marks */}
      {[-58, -20, 20, 58].map((deg) => {
        const a = ((deg - 90) * Math.PI) / 180;
        return (
          <line
            key={deg}
            x1={24 + 9.5 * Math.cos(a)}
            y1={24 + 9.5 * Math.sin(a)}
            x2={24 + 6.5 * Math.cos(a)}
            y2={24 + 6.5 * Math.sin(a)}
            stroke="#22262d"
            strokeWidth="1.6"
            strokeLinecap="round"
            opacity="0.55"
          />
        );
      })}

      {/* bolt */}
      <path
        d="M26.6 11.5 L17.6 25.4 h5.3 l-1.6 11.1 9.1 -14.2 h-5.4 z"
        fill="#22262d"
      />
    </svg>
  );
}

export default function Logo({
  size = 38,
  showName = true,
  tone = "light",
}: {
  size?: number;
  showName?: boolean;
  tone?: "light" | "dark";
}) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={size} />
      {showName && (
        <span
          className={`text-[15px] font-semibold tracking-tight ${
            tone === "dark" ? "text-on-dark" : "text-ink"
          }`}
        >
          {PRODUCT_NAME}
        </span>
      )}
    </span>
  );
}
