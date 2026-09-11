"use client";

/**
 * Minimal, real i18n. Previously the Settings language toggle wrote a
 * preference to localStorage that nothing ever read — switching to
 * "العربية" changed which button looked pressed and nothing else. This
 * makes the switch actually translate visible text, and flips the document
 * direction to RTL for Arabic, which a language toggle that doesn't touch
 * layout direction would get wrong for any real Arabic reader.
 *
 * SCOPE, STATED HONESTLY: this covers the bottom navigation and the
 * Settings page — the two surfaces a user directly exercises when testing
 * "does the language switch work". The rest of the app (Overview, Budget,
 * Recommendations, Insights body copy) is not translated yet. Extending
 * TRANSLATIONS with more keys and swapping more components' literal
 * strings for t("key") calls is the same pattern, just more of it — no
 * architecture change needed to keep going.
 */
import { useCallback, useEffect, useState } from "react";

export type Language = "en" | "ar";

const LANGUAGE_STORAGE_KEY = "language";

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  ar: "العربية",
};

const TRANSLATIONS = {
  en: {
    "nav.home": "Home",
    "nav.budget": "Budget",
    "nav.plan": "Plan",
    "nav.insights": "Insights",
    "nav.settings": "Settings",

    "settings.title": "Settings",
    "settings.subtitle": "Manage your account, device, and display preferences.",

    "settings.profile.title": "Profile",
    "settings.profile.email": "Email",
    "settings.profile.change": "Change",
    "settings.profile.password": "Password",
    "settings.profile.lastUpdated": "Last updated —",
    "settings.profile.update": "Update",
    "settings.profile.deleteAccount": "Delete account",
    "settings.profile.deleteAccountHint": "Permanently remove your data",
    "settings.profile.delete": "Delete",

    "settings.device.title": "Device",
    "settings.device.id": "Device ID",
    "settings.device.rename": "Rename",
    "settings.device.repair": "Re-pair device",
    "settings.device.repairHint": "Connect a different meter",
    "settings.device.repairAction": "Re-pair",
    "settings.device.remove": "Remove device",
    "settings.device.removeHint": "Disconnect this meter",
    "settings.device.removeAction": "Remove",

    "settings.notifications.title": "Notifications",
    "settings.notifications.budgetAlert": "Budget alert",
    "settings.notifications.budgetAlertHint": "Notify when spending crosses your threshold",
    "settings.notifications.threshold": "Alert threshold",
    "settings.notifications.thresholdHint": "You'll be notified when {pct}% of your allowed kWh is used.",
    "settings.notifications.save": "Save notification settings",
    "settings.notifications.saving": "Saving...",
    "settings.notifications.setBudgetFirst": "Set a target bill in Budget to enable alerts.",
    "settings.notifications.push": "Push notifications",
    "settings.notifications.soon": "Coming soon",

    "settings.display.title": "Display",
    "settings.display.theme": "Theme",
    "settings.display.themeHint": "System follows your OS setting.",
    "settings.display.language": "Language",
    "settings.display.units": "Units",

    "settings.about.title": "About",
    "settings.about.logout": "Log out",
  },
  ar: {
    "nav.home": "الرئيسية",
    "nav.budget": "الميزانية",
    "nav.plan": "الخطة",
    "nav.insights": "التحليلات",
    "nav.settings": "الإعدادات",

    "settings.title": "الإعدادات",
    "settings.subtitle": "إدارة حسابك وجهازك وتفضيلات العرض.",

    "settings.profile.title": "الملف الشخصي",
    "settings.profile.email": "البريد الإلكتروني",
    "settings.profile.change": "تغيير",
    "settings.profile.password": "كلمة المرور",
    "settings.profile.lastUpdated": "آخر تحديث —",
    "settings.profile.update": "تحديث",
    "settings.profile.deleteAccount": "حذف الحساب",
    "settings.profile.deleteAccountHint": "إزالة بياناتك نهائيًا",
    "settings.profile.delete": "حذف",

    "settings.device.title": "الجهاز",
    "settings.device.id": "معرف الجهاز",
    "settings.device.rename": "إعادة تسمية",
    "settings.device.repair": "إعادة ربط الجهاز",
    "settings.device.repairHint": "اتصال بعداد مختلف",
    "settings.device.repairAction": "إعادة ربط",
    "settings.device.remove": "إزالة الجهاز",
    "settings.device.removeHint": "فصل هذا العداد",
    "settings.device.removeAction": "إزالة",

    "settings.notifications.title": "الإشعارات",
    "settings.notifications.budgetAlert": "تنبيه الميزانية",
    "settings.notifications.budgetAlertHint": "التنبيه عند تجاوز الإنفاق للحد المحدد",
    "settings.notifications.threshold": "حد التنبيه",
    "settings.notifications.thresholdHint": "سيتم إعلامك عند استخدام {pct}% من الكيلوواط ساعة المسموح بها.",
    "settings.notifications.save": "حفظ إعدادات الإشعارات",
    "settings.notifications.saving": "جارٍ الحفظ...",
    "settings.notifications.setBudgetFirst": "حدد فاتورة مستهدفة في الميزانية لتفعيل التنبيهات.",
    "settings.notifications.push": "الإشعارات الفورية",
    "settings.notifications.soon": "قريبًا",

    "settings.display.title": "العرض",
    "settings.display.theme": "المظهر",
    "settings.display.themeHint": "يتبع إعداد النظام تلقائيًا.",
    "settings.display.language": "اللغة",
    "settings.display.units": "الوحدات",

    "settings.about.title": "حول",
    "settings.about.logout": "تسجيل الخروج",
  },
} as const satisfies Record<Language, Record<string, string>>;

export type TranslationKey = keyof typeof TRANSLATIONS["en"];

function translate(language: Language, key: TranslationKey, vars?: Record<string, string | number>): string {
  let s: string = TRANSLATIONS[language][key] ?? TRANSLATIONS.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(`{${k}}`, String(v));
    }
  }
  return s;
}

function applyDocumentDirection(language: Language) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
}

/**
 * Shared language state. Reads the saved preference once on mount, applies
 * `lang`/`dir` to the document immediately (so RTL takes effect the moment
 * the page using this hook mounts, not just after a manual toggle), and
 * keeps every component using this hook in sync via a `storage`-adjacent
 * custom event — `localStorage` alone does not re-render components in the
 * SAME tab that wrote it; only OTHER tabs get a native `storage` event.
 */
const LANGUAGE_CHANGE_EVENT = "wattwise:language-change";

export function useLanguage() {
  const [language, setLanguageState] = useState<Language>("en");

  useEffect(() => {
    const saved = (localStorage.getItem(LANGUAGE_STORAGE_KEY) as Language | null) ?? "en";
    setLanguageState(saved);
    applyDocumentDirection(saved);

    const onChange = (e: Event) => {
      const next = (e as CustomEvent<Language>).detail;
      setLanguageState(next);
      applyDocumentDirection(next);
    };
    window.addEventListener(LANGUAGE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(LANGUAGE_CHANGE_EVENT, onChange);
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    applyDocumentDirection(lang);
    setLanguageState(lang);
    window.dispatchEvent(new CustomEvent(LANGUAGE_CHANGE_EVENT, { detail: lang }));
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => translate(language, key, vars),
    [language],
  );

  return { language, setLanguage, t };
}
