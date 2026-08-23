"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { LayoutGrid, Wallet, ListChecks, LogOut, Settings } from "lucide-react";
import { clsx } from "clsx";

import Logo from "@/components/Logo";
import SceneBackground from "@/components/SceneBackground";
import { fetchIsOnline, fetchTelemetry, type TelemetryDashboard } from "@/lib/api";

/**
 * Auth guard + chrome shared by every signed-in page.
 *
 * The guard is unchanged: no token -> /auth, token but no device -> /onboarding,
 * and nothing renders until the check has run, so a signed-out visitor never
 * sees a flash of the real UI. `children` is a function of the resolved
 * deviceId so no page re-reads localStorage or handles the null case itself.
 *
 * NAVIGATION
 * ----------
 * A floating glass bar: mark and wordmark left, a segmented pill group centred,
 * status and account right. The active item sits in a solid charcoal pill with
 * its icon — but `aria-current="page"` is what actually carries that meaning.
 * The pill is the visual half only.
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
  const [scene, setScene] = useState<TelemetryDashboard | null>(null);

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
  // page is fetching — it stays responsive even on a page that loads once.
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
      try {
        const t = await fetchTelemetry(deviceId);
        if (!cancelled) setScene(t);
      } catch {
        /* the scene keeps its last values; it is chrome, not a readout */
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
      <div className="grid min-h-screen place-items-center">
        <span className="pulse-dot h-9 w-9 rounded-full bg-accent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* ONE scene behind the whole app — fixed, full-bleed, shared by every
          route. The cards float on it. This is the structure the reference
          uses: a photograph as the page background, not a picture in a tile. */}
      <SceneBackground
        live={isOnline}
        watts={scene?.active_power ?? null}
        kwhCycle={scene?.month_energy_kwh ?? null}
        savingPct={null}
      />
      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-5 sm:pt-5">
        <div className="mx-auto flex max-w-[1560px] items-center justify-between gap-3 rounded-[var(--r-pill)] glass-strong px-3 py-2.5">
          <Link href="/overview" className="shrink-0 pl-0.5">
            <Logo size={38} />
          </Link>

          <nav aria-label="Primary" className="min-w-0 flex-1">
            <ul className="mx-auto flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-[var(--r-pill)] bg-white/45 p-1.5">
              {NAV.map((item) => {
                const active = pathname === item.href;
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={clsx(
                        "flex items-center gap-2 whitespace-nowrap rounded-[var(--r-pill)] px-3 py-2 text-[13px] font-semibold transition-all duration-300 sm:px-4",
                        active
                          ? "bg-ink-panel text-on-dark shadow-md"
                          : "text-ink-3 hover:bg-white/70 hover:text-ink",
                      )}
                    >
                      <span
                        className={clsx(
                          "grid h-6 w-6 shrink-0 place-items-center rounded-full transition-colors",
                          active ? "bg-accent text-ink-panel" : "text-ink-3",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <span className={clsx(active ? "inline" : "hidden lg:inline")}>
                        {item.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <span
              className={clsx(
                "hidden items-center gap-1.5 rounded-[var(--r-pill)] px-3 py-1.5 text-[11px] font-bold sm:flex",
                isOnline ? "bg-accent text-ink-panel" : "bg-warn-wash text-warn",
              )}
            >
              <span className={clsx("h-1.5 w-1.5 rounded-full", isOnline ? "pulse-dot bg-ink-panel" : "bg-warn")} />
              {isOnline ? "Live" : "Offline"}
            </span>
            <Link
              href="/budget"
              aria-label="Settings and budget"
              className="grid h-10 w-10 place-items-center rounded-full bg-white/60 text-ink-3 transition hover:bg-white hover:text-ink"
            >
              <Settings className="h-4 w-4" aria-hidden />
            </Link>
            <button
              onClick={handleLogout}
              title="Log out"
              aria-label="Log out"
              className="grid h-10 w-10 place-items-center rounded-full bg-ink-panel text-on-dark transition hover:opacity-90"
            >
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1560px] px-3 pb-12 pt-4 sm:px-5">{children(deviceId)}</main>
    </div>
  );
}
