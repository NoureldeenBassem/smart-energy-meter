"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";

import Logo from "@/components/Logo";
import { registerUser, loginUser } from "@/lib/api";
import { useTheme } from "@/lib/theme";

/**
 * Sign-in / sign-up.
 *
 * Split layout: the hero illustration carries the left half so the product is
 * recognisable before an account exists, and the form sits in a card on the
 * right. On small screens the illustration is dropped rather than squashed — it
 * is context, not content, and a 120px-tall version of it would be neither.
 *
 * The auth logic is untouched: same two calls, same token handling, same
 * redirect to /onboarding.
 */
export default function AuthPage() {
  const router = useRouter();
  useTheme(); // Shell only wraps authenticated pages, so /auth needs its own call to respect a saved dark-mode preference before login
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const token =
        mode === "register"
          ? await registerUser(email, password)
          : await loginUser(email, password);

      localStorage.setItem("access_token", token);
      localStorage.setItem("user_email", email);
      router.push("/onboarding");
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(
        detail ||
          (mode === "register"
            ? "Could not create account. Try a different email."
            : "Invalid email or password."),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-4 sm:p-6">
      {/* Single centred column. The two-column split here existed only to leave
          the left half open for the background scene; with no scene behind it
          that column was dead space, so the form owns the page. */}
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-[1200px] items-stretch">
        <div className="flex items-center justify-center">
          <div className="w-full max-w-md">
            <div className="mb-7">
              <Logo size={44} />
            </div>

            <h1 className="text-[26px] font-bold tracking-tight text-ink">
              {mode === "register" ? "Create your account" : "Welcome back"}
            </h1>
            <p className="mt-1.5 text-sm text-ink-3">
              Track live consumption, forecast your month-end bill on Egypt&apos;s
              progressive tariff, and get a daily plan that keeps you inside your budget.
            </p>

            <div className="mt-6 rounded-[var(--r-card)] glass p-6 rise d1">
              <div
                role="group"
                aria-label="Account mode"
                className="mb-6 flex rounded-[var(--r-pill)] bg-white/50 p-1.5"
              >
                {(["register", "login"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    aria-pressed={mode === m}
                    className={clsx(
                      "flex-1 rounded-[var(--r-pill)] py-2 text-sm font-semibold transition",
                      mode === m
                        ? "bg-ink-panel text-on-dark shadow-sm"
                        : "text-chip-text-2 hover:text-chip-text",
                    )}
                  >
                    {m === "register" ? "Sign Up" : "Log In"}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="email"
                    className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3"
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-white/60 bg-white/50 px-3.5 py-2.5 text-sm text-chip-text outline-none transition focus:border-accent-2"
                  />
                </div>
                <div>
                  <label
                    htmlFor="password"
                    className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3"
                  >
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    autoComplete={
                      mode === "register" ? "new-password" : "current-password"
                    }
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-white/60 bg-white/50 px-3.5 py-2.5 text-sm text-chip-text outline-none transition focus:border-accent-2"
                  />
                  <p className="mt-1 text-[11px] text-ink-3">
                    At least 8 characters.
                  </p>
                </div>

                {error && (
                  <p
                    role="alert"
                    className="rounded-xl border border-warn/25 bg-warn-wash p-3 text-xs font-medium text-warn"
                  >
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-[var(--r-pill)] bg-ink-panel py-3 text-sm font-bold text-on-dark transition hover:opacity-90 disabled:opacity-50"
                >
                  {loading
                    ? "Working..."
                    : mode === "register"
                      ? "Create Account"
                      : "Log In"}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}