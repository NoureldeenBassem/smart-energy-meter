"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { LayoutGrid, Wallet, ListChecks, TrendingUp, Settings } from "lucide-react";
import { clsx } from "clsx";

import { useLanguage, type TranslationKey } from "@/lib/i18n";

/**
 * Floating bottom navigation — replaces the top pill bar.
 *
 * Five destinations, icon + label, active state in accent fill.
 * Max-width 480px centred on tablet/desktop; full-width on mobile.
 * Safe-area inset for iPhone X+ home indicator.
 */

const NAV_ITEMS = [
  { href: "/overview", labelKey: "nav.home" as TranslationKey, icon: LayoutGrid },
  { href: "/budget", labelKey: "nav.budget" as TranslationKey, icon: Wallet },
  { href: "/recommendations", labelKey: "nav.plan" as TranslationKey, icon: ListChecks },
  { href: "/insights", labelKey: "nav.insights" as TranslationKey, icon: TrendingUp },
  { href: "/settings", labelKey: "nav.settings" as TranslationKey, icon: Settings },
] as const;

interface BottomNavProps {
  /** Optional badge count for Budget tab (alert triggered) */
  budgetAlert?: boolean;
}

export default function BottomNav({ budgetAlert = false }: BottomNavProps) {
  const pathname = usePathname();
  const { t } = useLanguage();

  return (
    <nav
      aria-label="Primary navigation"
      className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-safe"
      style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto max-w-[480px] glass-strong rounded-[var(--r-card)] nav-shadow flex items-center justify-around px-2 py-2">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "flex flex-1 flex-col items-center gap-1 rounded-[var(--r-pill)] py-2 px-1 transition-all duration-150",
                active
                  ? "bg-accent text-ink-panel scale-[1.02] shadow-md"
                  : "text-ink-3 hover:text-ink",
              )}
            >
              <Icon className="h-5 w-5" aria-hidden />
              <span className="text-[10px] font-semibold leading-none">{t(item.labelKey)}</span>
              {item.href === "/budget" && budgetAlert && (
                <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-warn" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}