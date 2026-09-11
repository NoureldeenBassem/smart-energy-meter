"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Bell,
  BellOff,
  Gauge,
  Globe,
  LogOut,
  Mail,
  Monitor,
  Moon,
  Sun,
  Target,
  Trash2,
  TrendingUp,
  User,
  Wifi,
  RotateCcw,
} from "lucide-react";
import { clsx } from "clsx";

import Shell from "@/components/Shell";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  apiErrorMessage,
  fetchActiveBudget,
  fetchCurrentUserEmail,
  type Budget,
} from "@/lib/api";
import { useLanguage, LANGUAGE_LABELS, type Language } from "@/lib/i18n";
import { useTheme, THEME_LABELS, type Theme } from "@/lib/theme";

/**
 * Settings — NEW screen added in Phase 4.
 *
 * Five sections, all using existing endpoints or localStorage:
 * 1. Profile — Email, password change, delete account
 * 2. Device — Device ID, rename, re-pair, remove
 * 3. Notifications — Budget alert toggle, threshold %, push (future)
 * 4. Display — Theme (system/light/dark), units, language
 * 5. About — Version, licenses, privacy, logout
 */

interface SettingsBodyProps {
  deviceId: string;
}

function SettingsBody({ deviceId }: SettingsBodyProps) {
  const router = useRouter();
  const { language, setLanguage, t } = useLanguage();
  const { theme, setTheme } = useTheme();
  const [budget, setBudget] = useState<Budget | null>(null);
  const [budgetAlertEnabled, setBudgetAlertEnabled] = useState(true);
  const [alertThreshold, setAlertThreshold] = useState(85);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(() => localStorage.getItem("user_email"));

  // Self-heal a session that logged in before the auth page started saving
  // user_email — fetch it once from the server and backfill localStorage so
  // this only ever runs the one time per such session, not on every visit.
  useEffect(() => {
    if (email) return;
    (async () => {
      try {
        const real = await fetchCurrentUserEmail();
        localStorage.setItem("user_email", real);
        setEmail(real);
      } catch {
        // Not fatal — the UI falls back to a placeholder below.
      }
    })();
  }, [email]);

  // Load budget for alert threshold
  useEffect(() => {
    (async () => {
      try {
        const b = await fetchActiveBudget();
        setBudget(b);
        setAlertThreshold(b.alert_threshold_pct);
        setBudgetAlertEnabled(b.alert_threshold_pct > 0);
      } catch {
        // No budget set yet
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Theme and language are both loaded and applied by their shared hooks
  // (useTheme, useLanguage) — no local state or effect needed here.

  const handleSaveNotificationSettings = async () => {
    setSaving(true);
    setSavedMessage(null);
    try {
      const threshold = budgetAlertEnabled ? alertThreshold : 0;
      await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ""}/api/v1/budgets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("access_token")}`,
        },
        body: JSON.stringify({
          target_bill_egp: budget?.target_bill_egp ?? 800,
          alert_threshold_pct: threshold,
        }),
      });
      setBudget((prev) => prev ? { ...prev, alert_threshold_pct: threshold } : null);
      setSavedMessage("Notification settings saved.");
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save notification settings."));
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("device_id");
    router.replace("/auth");
  };

  const handleRemoveDevice = async () => {
    if (!confirm("Remove this device? You'll need to pair a new one to continue.")) return;
    localStorage.removeItem("device_id");
    router.replace("/onboarding");
  };

  const handleDeleteAccount = async () => {
    if (!confirm("Delete your account? This cannot be undone.")) return;
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ""}/api/v1/auth/me`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("access_token")}`,
        },
      });
      if (!res.ok) {
        setError("Could not delete the account. Please try again.");
        return;
      }
    } catch (err) {
      setError(apiErrorMessage(err, "Could not delete the account. Please try again."));
      return;
    }
    // Only clear local state and redirect once the server confirms the
    // account is actually gone — never before, and never on a failed request.
    localStorage.clear();
    router.replace("/auth");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="pulse-dot h-9 w-9 rounded-full bg-accent" />
      </div>
    );
  }

  const savedEmail = email ?? "—";

  return (
    <div className="space-y-4">
      {/* ============ HEADER ============ */}
      <div className="mb-2 flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent">
          <Wifi className="h-5 w-5 text-ink-panel" aria-hidden />
        </span>
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-ink">{t("settings.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-3">
            {t("settings.subtitle")}
          </p>
        </div>
      </div>

      {error && (
        <Card className="border border-warn/25 bg-warn-wash p-4 text-sm text-warn">
          {error}
        </Card>
      )}
      {savedMessage && (
        <Card className="border border-accent-2/25 bg-accent-wash p-4 text-sm text-accent-ink">
          {savedMessage}
        </Card>
      )}

      {/* ============ 1. PROFILE ============ */}
      <Card className="p-5">
        <SectionHeading title={t("settings.profile.title")} icon={<User className="h-4 w-4" />} />
        <div className="space-y-4 mt-2">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">{t("settings.profile.email")}</p>
              <p className="mt-0.5 font-medium text-ink">{savedEmail}</p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-[var(--r-pill)] bg-white/50 px-3.5 py-1.5 text-sm font-semibold text-chip-text-2 transition hover:bg-white/70 hover:text-chip-text"
            >
              {t("settings.profile.change")}
            </button>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-white/50 pt-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">{t("settings.profile.password")}</p>
              <p className="mt-0.5 text-sm text-ink-3">{t("settings.profile.lastUpdated")}</p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-[var(--r-pill)] bg-white/50 px-3.5 py-1.5 text-sm font-semibold text-chip-text-2 transition hover:bg-white/70 hover:text-chip-text"
            >
              {t("settings.profile.update")}
            </button>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-white/50 pt-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-warn">{t("settings.profile.deleteAccount")}</p>
              <p className="mt-0.5 text-sm text-ink-3">{t("settings.profile.deleteAccountHint")}</p>
            </div>
            <button
              type="button"
              onClick={handleDeleteAccount}
              className="shrink-0 rounded-[var(--r-pill)] bg-warn-wash px-3.5 py-1.5 text-sm font-semibold text-warn transition hover:bg-warn/20"
            >
              {t("settings.profile.delete")}
            </button>
          </div>
        </div>
      </Card>

      {/* ============ 2. DEVICE ============ */}
      <Card className="p-5">
        <SectionHeading title={t("settings.device.title")} icon={<Wifi className="h-4 w-4" />} />
        <div className="space-y-4 mt-2">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">{t("settings.device.id")}</p>
              <p className="mt-0.5 num font-mono text-sm text-ink truncate max-w-[200px]">{deviceId}</p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-[var(--r-pill)] bg-white/50 px-3.5 py-1.5 text-sm font-semibold text-chip-text-2 transition hover:bg-white/70 hover:text-chip-text"
            >
              {t("settings.device.rename")}
            </button>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-white/50 pt-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">{t("settings.device.repair")}</p>
              <p className="mt-0.5 text-sm text-ink-3">{t("settings.device.repairHint")}</p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-[var(--r-pill)] bg-white/50 px-3.5 py-1.5 text-sm font-semibold text-chip-text-2 transition hover:bg-white/70 hover:text-chip-text"
            >
              <RotateCcw className="h-3.5 w-3.5 inline mr-1.5" /> {t("settings.device.repairAction")}
            </button>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-white/50 pt-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-warn">{t("settings.device.remove")}</p>
              <p className="mt-0.5 text-sm text-ink-3">{t("settings.device.removeHint")}</p>
            </div>
            <button
              type="button"
              onClick={handleRemoveDevice}
              className="shrink-0 rounded-[var(--r-pill)] bg-warn-wash px-3.5 py-1.5 text-sm font-semibold text-warn transition hover:bg-warn/20"
            >
              <Trash2 className="h-3.5 w-3.5 inline mr-1.5" /> {t("settings.device.removeAction")}
            </button>
          </div>
        </div>
      </Card>

      {/* ============ 3. NOTIFICATIONS ============ */}
      <Card className="p-5">
        <SectionHeading title={t("settings.notifications.title")} icon={<Bell className="h-4 w-4" />} />
        <div className="space-y-4 mt-2">
          {/* Budget alert toggle */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-wash">
                {budgetAlertEnabled ? (
                  <Bell className="h-5 w-5 text-accent-ink" aria-hidden />
                ) : (
                  <BellOff className="h-5 w-5 text-ink-3" aria-hidden />
                )}
              </span>
              <div>
                <p className="font-semibold text-ink">{t("settings.notifications.budgetAlert")}</p>
                <p className="text-sm text-ink-3">{t("settings.notifications.budgetAlertHint")}</p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={budgetAlertEnabled}
              onClick={() => {
                setBudgetAlertEnabled(!budgetAlertEnabled);
                setSavedMessage(null);
              }}
              className={clsx(
                "shrink-0 relative h-6 w-11 rounded-[var(--r-pill)] transition",
                budgetAlertEnabled ? "bg-accent" : "bg-white/50",
              )}
              aria-label={budgetAlertEnabled ? "Disable budget alert" : "Enable budget alert"}
            >
              <span
                className={clsx(
                  "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition",
                  budgetAlertEnabled ? "left-5.5" : "left-0.5",
                )}
              />
            </button>
          </div>

          {/* Alert threshold — only shown when enabled */}
          {budgetAlertEnabled && (
            <div className="border-t border-white/50 pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3 mb-3">
                {t("settings.notifications.threshold")}
              </p>
              <div className="flex gap-2">
                {[75, 85, 90, 95].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setAlertThreshold(t);
                      setSavedMessage(null);
                    }}
                    className={clsx(
                      "num flex-1 rounded-[var(--r-pill)] py-2 text-sm font-bold transition",
                      alertThreshold === t
                        ? "bg-ink-panel text-on-dark"
                        : "bg-white/50 text-chip-text-2 hover:text-chip-text",
                    )}
                  >
                    {t}%
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-ink-3">
                {t("settings.notifications.thresholdHint", { pct: alertThreshold })}
              </p>
            </div>
          )}

          {/* Save button for notifications */}
          {(budgetAlertEnabled && budget) || !budgetAlertEnabled ? (
            <button
              type="button"
              onClick={handleSaveNotificationSettings}
              disabled={saving}
              className="w-full rounded-[var(--r-pill)] bg-ink-panel py-3 text-sm font-bold text-on-dark transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? t("settings.notifications.saving") : t("settings.notifications.save")}
            </button>
          ) : (
            <p className="text-sm text-ink-3">
              {t("settings.notifications.setBudgetFirst")}
            </p>
          )}

          {/* Push notifications (future) */}
          <div className="border-t border-white/50 pt-4">
            <div className="flex items-center justify-between gap-4 opacity-50">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-white/50">
                  <Bell className="h-5 w-5 text-chip-text-2" aria-hidden />
                </span>
                <div>
                  <p className="font-semibold text-ink">{t("settings.notifications.push")}</p>
                  <p className="text-sm text-ink-3">{t("settings.notifications.soon")}</p>
                </div>
              </div>
              <span className="shrink-0 rounded-[var(--r-pill)] bg-white/30 px-2.5 py-1 text-[10px] font-bold text-chip-text-2">
                {t("settings.notifications.soon")}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* ============ 4. DISPLAY ============ */}
      <Card className="p-5">
        <SectionHeading title={t("settings.display.title")} icon={<Monitor className="h-4 w-4" />} />
        <div className="space-y-4 mt-2">
          {/* Theme */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3 mb-2">{t("settings.display.theme")}</p>
            <div role="group" aria-label="Theme" className="flex flex-wrap gap-2 rounded-[var(--r-pill)] bg-white/50 p-1.5">
              {(["system", "light", "dark"] as Theme[]).map((th) => (
                <button
                  key={th}
                  type="button"
                  onClick={() => setTheme(th)}
                  aria-pressed={theme === th}
                  className={clsx(
                    "flex-1 whitespace-nowrap rounded-[var(--r-pill)] px-4 py-2 text-sm font-semibold transition",
                    theme === th
                      ? "bg-ink-panel text-on-dark shadow-sm"
                      : "text-chip-text-2 hover:text-chip-text",
                  )}
                >
                  {THEME_LABELS[th]}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-3">{t("settings.display.themeHint")}</p>
          </div>

          {/* Language */}
          <div className="border-t border-white/50 pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3 mb-2">{t("settings.display.language")}</p>
            <div role="group" aria-label="Language" className="flex flex-wrap gap-2 rounded-[var(--r-pill)] bg-white/50 p-1.5">
              {(["en", "ar"] as Language[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLanguage(l)}
                  aria-pressed={language === l}
                  className={clsx(
                    "flex-1 whitespace-nowrap rounded-[var(--r-pill)] px-4 py-2 text-sm font-semibold transition",
                    language === l
                      ? "bg-ink-panel text-on-dark shadow-sm"
                      : "text-chip-text-2 hover:text-chip-text",
                  )}
                >
                  {LANGUAGE_LABELS[l]}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-3">
              {language === "ar" ? "التطبيق الآن بالعربية، من اليمين إلى اليسار." : "Nav and this page translate; the rest of the app is next."}
            </p>
          </div>

          {/* Units */}
          <div className="border-t border-white/50 pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3 mb-2">{t("settings.display.units")}</p>
            <div role="group" aria-label="Units" className="flex flex-wrap gap-2 rounded-[var(--r-pill)] bg-white/50 p-1.5">
              <button
                type="button"
                className="flex-1 whitespace-nowrap rounded-[var(--r-pill)] px-4 py-2 text-sm font-semibold bg-ink-panel text-on-dark shadow-sm"
                disabled
              >
                kWh / EGP (fixed)
              </button>
            </div>
            <p className="mt-2 text-xs text-ink-3">Egyptian tariff uses kWh and EGP by law.</p>
          </div>
        </div>
      </Card>

      {/* ============ 5. ABOUT ============ */}
      <Card className="p-5">
        <SectionHeading title={t("settings.about.title")} icon={<Globe className="h-4 w-4" />} />
        <div className="space-y-4 mt-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-white/50">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-wash">
                <Target className="h-5 w-5 text-accent-ink" aria-hidden />
              </span>
              <div>
                <p className="font-semibold text-chip-text">Version</p>
                <p className="text-sm text-chip-text-2">1.0.0 (Phase 4)</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-white/50">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-white/70">
                <Gauge className="h-5 w-5 text-chip-text-2" aria-hidden />
              </span>
              <div>
                <p className="font-semibold text-chip-text">Tariff Engine</p>
                <p className="text-sm text-chip-text-2">7-bracket progressive</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-white/50">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-white/70">
                <TrendingUp className="h-5 w-5 text-chip-text-2" aria-hidden />
              </span>
              <div>
                <p className="font-semibold text-chip-text">Forecast Model</p>
                <p className="text-sm text-chip-text-2">LightGBM + residual</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-white/50">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-white/70">
                <Mail className="h-5 w-5 text-chip-text-2" aria-hidden />
              </span>
              <div>
                <p className="font-semibold text-chip-text">Support</p>
                <p className="text-sm text-chip-text-2">noureldinbassem.work@gmail.com</p>
              </div>
            </div>
          </div>

          <div className="border-t border-white/50 pt-4 space-y-2">
            <Link
              href="/privacy"
              className="flex items-center justify-between gap-3 text-sm text-ink hover:text-accent-ink transition"
            >
              <span>Privacy Policy</span>
              <ArrowRight className="h-4 w-4 text-ink-3" />
            </Link>
            <Link
              href="/terms"
              className="flex items-center justify-between gap-3 text-sm text-ink hover:text-accent-ink transition"
            >
              <span>Terms of Service</span>
              <ArrowRight className="h-4 w-4 text-ink-3" />
            </Link>
            <Link
              href="/licenses"
              className="flex items-center justify-between gap-3 text-sm text-ink hover:text-accent-ink transition"
            >
              <span>Open Source Licenses</span>
              <ArrowRight className="h-4 w-4 text-ink-3" />
            </Link>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="mt-4 w-full flex items-center justify-center gap-2 rounded-[var(--r-pill)] bg-warn-wash py-3 text-sm font-bold text-warn transition hover:bg-warn/20"
          >
            <LogOut className="h-4 w-4" />
            {t("settings.about.logout")}
          </button>
        </div>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  return <Shell>{(deviceId) => <SettingsBody deviceId={deviceId} />}</Shell>;
}