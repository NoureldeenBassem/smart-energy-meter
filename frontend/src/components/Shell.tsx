"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Zap, LogOut } from "lucide-react";

import { fetchIsOnline } from "@/lib/api";

/**
 * Auth guard + chrome shared by every signed-in page.
 *
 * The guard is the same one /dashboard already used: no token -> /auth, token
 * but no device -> /onboarding. It lives here rather than being copy-pasted into
 * three pages, and it renders nothing until the check has run so a signed-out
 * visitor never sees a flash of the real UI.
 *
 * `children` is a function of the resolved deviceId. That is deliberate: every
 * page needs the device id to fetch anything, and passing it down means no page
 * has to re-read localStorage or handle the null case itself.
 */

const NAV = [
  { href: "/overview", label: "Overview" },
  { href: "/budget", label: "Budget Planner" },
  { href: "/recommendations", label: "Recommendations" },
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
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Zap className="h-8 w-8 text-emerald-400 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/95 sticky top-0 z-20 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <Zap className="h-6 w-6 text-emerald-400" />
              <span className="font-bold tracking-tight">Smart Energy Meter</span>
            </div>
            <div className="flex items-center gap-3">
              <div
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  isOnline
                    ? "border-emerald-800 bg-emerald-950 text-emerald-400"
                    : "border-rose-900 bg-rose-950 text-rose-400"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    isOnline ? "animate-pulse bg-emerald-400" : "bg-rose-400"
                  }`}
                />
                {isOnline ? "Live" : "Offline"}
              </div>
              <button
                onClick={handleLogout}
                className="p-2 text-slate-400 transition hover:text-white"
                title="Log out"
                aria-label="Log out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>

          <nav className="flex gap-1 -mb-px">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                    active
                      ? "border-emerald-400 text-white"
                      : "border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-200"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">{children(deviceId)}</main>
    </div>
  );
}
