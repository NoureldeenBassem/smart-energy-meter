"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { LogOut, Settings } from "lucide-react";
import { clsx } from "clsx";

import Logo from "@/components/Logo";
import BottomNav from "@/components/BottomNav";
import { fetchIsOnline, fetchRecommendations } from "@/lib/api";

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
 * Minimal top app bar: logo mark (left) + live badge (right).
 * Floating bottom bar: 5 destinations (Home, Budget, Plan, Insights, Settings).
 * The page background is the body gradient in globals.css; there is no scene
 * layer, so nothing here fetches telemetry purely for decoration.
 */

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
  const [budgetAlert, setBudgetAlert] = useState(false);

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

  // Online badge + budget-alert poll on 5s interval
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
      // Check budget alert for bottom nav badge
      try {
        const recs = await fetchRecommendations(deviceId, "normal");
        if (!cancelled) setBudgetAlert(recs.alert?.alert_triggered ?? false);
      } catch {
        /* ignore */
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
      {/* Minimal top app bar — logo + live status */}
      <header className="sticky top-0 z-40 px-4 pt-4">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between">
          <Link href="/overview" className="shrink-0" aria-label="Wattwise home">
            <Logo size={36} showName={false} />
          </Link>
          <span
            className={clsx(
              "flex items-center gap-1.5 rounded-[var(--r-pill)] px-3 py-1.5 text-[11px] font-bold",
              isOnline ? "bg-accent text-ink-panel" : "bg-warn-wash text-warn",
            )}
            aria-live="polite"
          >
            <span className={clsx("h-1.5 w-1.5 rounded-full", isOnline ? "pulse-dot bg-ink-panel" : "bg-warn")} />
            {isOnline ? "Live" : "Offline"}
          </span>
        </div>
      </header>

      {/* Main content — bottom padding clears the floating nav */}
      <main className="mx-auto max-w-[1200px] px-4 py-5 pb-28 sm:px-6">
        {children(deviceId)}
      </main>

      {/* Floating bottom navigation */}
      <BottomNav budgetAlert={budgetAlert} />
    </div>
  );
}
