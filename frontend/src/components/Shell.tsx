"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Zap, LogOut, LayoutGrid, Wallet, ListChecks } from "lucide-react";
import { clsx } from "clsx";

import { fetchIsOnline } from "@/lib/api";

/**
 * Auth guard + chrome shared by every signed-in page.
 *
 * The guard is unchanged: no token -> /auth, token but no device -> /onboarding,
 * and nothing renders until the check has run so a signed-out visitor never sees
 * a flash of the real UI.
 *
 * `children` is a function of the resolved deviceId, so no page re-reads
 * localStorage or handles the null case itself.
 *
 * NAV STYLE
 * ---------
 * The active item sits in a solid dark pill. `aria-current="page"` is still what
 * carries that meaning to assistive tech — the pill is the visual half only.
 */

const NAV = [
  { href: "/overview", label: "Overview", icon: LayoutGrid },
  { href: "/budget", label: "Budget Planner", icon: Wallet },
  { href: "/recommendations", label: "Recommendations", icon: ListChecks },
] as const;

export default function Shell({
  children,
}: {
  children: (deviceId: string) => React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [isOnline, setIsOnline] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    const storedDeviceId = localStorage.getItem("device_id");

    if (!token) {
      router.replace("/auth");
      return;
    }
    if (!storedDeviceId) {
      router.replace("/onboarding");
      return;
    }
    setDeviceId(storedDeviceId);
    setChecked(true);
  }, [router]);

  // Online badge polls on its own short interval, independent of whatever the
  // page is fetching. Cheap endpoint, and it keeps the badge responsive even on
  // a page that only loads its data once.
  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const online = await fetchIsOnline(deviceId);
        if (!cancelled) setIsOnline(online);
      } catch {
        if (!cancelled) setIsOnline(false);
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [deviceId]);

  const handleLogout = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("device_id");
    router.replace("/auth");
  };

  if (!checked || !deviceId) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg">
        <Zap className="h-8 w-8 animate-pulse text-accent-deep" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="sticky top-0 z-30 bg-bg/85 backdrop-blur">
        <div className="mx-auto max-w-[1400px] px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius-pill)] bg-surface px-3 py-2 shadow-[var(--shadow-card)]">
            {/* brand */}
            <Link href="/overview" className="flex shrink-0 items-center gap-2.5 pl-1">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-accent">
                <Zap className="h-[18px] w-[18px] text-surface-ink" aria-hidden />
              </span>
              <span className="hidden text-[15px] font-bold tracking-tight sm:block">
                Smart Meter
              </span>
            </Link>

            {/* nav pills */}
            <nav aria-label="Primary" className="min-w-0 flex-1">
              <ul className="flex items-center justify-center gap-1 overflow-x-auto">
                {NAV.map((item) => {
                  const active = pathname === item.href;
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={clsx(
                          "flex items-center gap-2 whitespace-nowrap rounded-[var(--radius-pill)] px-3.5 py-2 text-[13px] font-semibold transition sm:px-4",
                          active
                            ? "bg-surface-ink text-ink-onDark shadow-sm"
                            : "text-ink-muted hover:bg-surface-muted hover:text-ink",
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden />
                        <span className="hidden md:inline">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            {/* status + account */}
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={clsx(
                  "flex items-center gap-1.5 rounded-[var(--radius-pill)] px-2.5 py-1.5 text-[11px] font-bold",
                  isOnline
                    ? "bg-accent-wash text-accent-deep"
                    : "bg-warn-wash text-warn",
                )}
              >
                <span
                  className={clsx(
                    "h-1.5 w-1.5 rounded-full",
                    isOnline ? "animate-pulse bg-accent-deep" : "bg-warn",
                  )}
                />
                <span className="hidden sm:inline">{isOnline ? "Live" : "Offline"}</span>
              </span>
              <button
                onClick={handleLogout}
                className="grid h-9 w-9 place-items-center rounded-full border border-line text-ink-muted transition hover:border-ink hover:bg-ink hover:text-white"
                title="Log out"
                aria-label="Log out"
              >
                <LogOut className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 pb-12 pt-2 sm:px-6">
        {children(deviceId)}
      </main>
    </div>
  );
}
