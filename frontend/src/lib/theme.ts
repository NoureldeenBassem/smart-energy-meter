"use client";

/**
 * Shared theme state, same pattern as useLanguage() in i18n.ts.
 *
 * Previously the theme toggle lived only inside the Settings page's own
 * component: the `.dark` class only got applied to <html> while Settings
 * happened to be mounted, so a user who loaded any other page first (a
 * bookmark, a deep link, a fresh tab) never saw their saved theme applied at
 * all — and even that mount-time effect changed nothing visible, because no
 * CSS rule existed for `.dark` anywhere (see globals.css's :root.dark block,
 * added alongside this file). Both gaps are fixed here: this hook is mounted
 * once in Shell.tsx, which wraps every authenticated page, so the theme is
 * applied on first paint regardless of which page loads first.
 */
import { useCallback, useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";

const THEME_STORAGE_KEY = "theme";
const THEME_CHANGE_EVENT = "wattwise:theme-change";

export const THEME_LABELS: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

function resolveIsDark(theme: Theme): boolean {
  if (theme === "system") {
    return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return theme === "dark";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolveIsDark(theme));
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system");

  useEffect(() => {
    const saved = (localStorage.getItem(THEME_STORAGE_KEY) as Theme | null) ?? "system";
    setThemeState(saved);
    applyTheme(saved);

    // Re-apply if the OS-level scheme changes while theme is "system".
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      const current = (localStorage.getItem(THEME_STORAGE_KEY) as Theme | null) ?? "system";
      if (current === "system") applyTheme(current);
    };
    mql.addEventListener("change", onSystemChange);

    const onChange = (e: Event) => {
      const next = (e as CustomEvent<Theme>).detail;
      setThemeState(next);
      applyTheme(next);
    };
    window.addEventListener(THEME_CHANGE_EVENT, onChange);

    return () => {
      mql.removeEventListener("change", onSystemChange);
      window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    };
  }, []);

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
    setThemeState(next);
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: next }));
  }, []);

  return { theme, setTheme };
}

/**
 * Apply the saved theme once, synchronously-ish, without needing a React
 * component mounted — used nowhere yet but kept alongside useTheme() as the
 * one place theme-resolution logic lives, so a future inline <script> (to
 * kill the flash-of-light-theme before hydration) has a single source of
 * truth to call instead of re-deriving the same rule a second place.
 */
export function applyStoredTheme() {
  const saved = (typeof window !== "undefined" ? (localStorage.getItem(THEME_STORAGE_KEY) as Theme | null) : null) ?? "system";
  applyTheme(saved);
}

/**
 * For the rare component that cannot just use a CSS token — e.g. a chart
 * library (recharts) that takes color as a literal JS string prop (`fill`,
 * `stroke`), not a class, so it cannot read --ink/--chip-text/etc. at all.
 * UsageBars.tsx is the first user: its bar-gradient and axis-label colors
 * were hardcoded light-mode hex values that read as near-invisible bars on
 * a dark card. This hook gives such a component a plain boolean to branch
 * its own hardcoded palette on, kept in sync with useTheme()'s class toggle.
 */
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const read = () => setIsDark(document.documentElement.classList.contains("dark"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
