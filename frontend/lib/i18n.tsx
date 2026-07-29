/**
 * lib/i18n.tsx — Lightweight i18n context with JSON locale files.
 *
 * Interpolation/pluralization is backed by `intl-messageformat`, which
 * implements the ICU MessageFormat spec on top of the native
 * `Intl.PluralRules` API. That means locale strings can use real ICU
 * plural syntax:
 *
 *   "{count, plural, one {# donor} other {# donors}}"
 *
 * and the correct plural category (`zero` / `one` / `two` / `few` / `many`
 * / `other`) is selected per-locale — not just the English one/other
 * split you'd get from a naive `count === 1 ? ... : ...` ternary. This
 * matters for locales like Arabic, which has 6 plural categories.
 */
import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from "react";
import IntlMessageFormat from "intl-messageformat";
import en from "@/locales/en.json";
import es from "@/locales/es.json";
import ar from "@/locales/ar.json";

export type Locale = "en" | "es" | "ar";

export type InterpolationValues = Record<string, string | number | Date>;

const locales: Record<Locale, Record<string, any>> = { en, es, ar };

/** BCP-47 tag used for Intl.PluralRules / Intl.NumberFormat per locale. */
export const LOCALE_TAGS: Record<Locale, string> = {
  en: "en-US",
  es: "es-ES",
  ar: "ar-EG",
};

/** Locales that are read/written right-to-left. */
export const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(["ar"]);

export function isRtl(locale: Locale): boolean {
  return RTL_LOCALES.has(locale);
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /** BCP-47 tag for the active locale, e.g. "ar-EG". Feed to Intl.NumberFormat etc. */
  localeTag: string;
  dir: "ltr" | "rtl";
  /** Look up a raw or ICU-interpolated string by dotted key path. */
  t: (key: string, values?: InterpolationValues) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "en",
  setLocale: () => {},
  localeTag: LOCALE_TAGS.en,
  dir: "ltr",
  t: (k) => k,
});

function get(obj: Record<string, any>, path: string): string | undefined {
  return path.split(".").reduce((acc: any, part) => acc?.[part], obj);
}

// Cache compiled ICU MessageFormat instances per (locale, key, pattern) so
// repeated renders (e.g. lists of donation cards) don't re-parse the ICU
// pattern on every call.
const formatterCache = new Map<string, IntlMessageFormat>();

function formatMessage(locale: Locale, key: string, pattern: string, values?: InterpolationValues): string {
  if ((!values || Object.keys(values).length === 0) && !pattern.includes("{")) {
    // Plain string, nothing to interpolate — skip the ICU parser entirely.
    return pattern;
  }

  const cacheKey = `${locale}::${key}::${pattern}`;
  let msg = formatterCache.get(cacheKey);
  if (!msg) {
    try {
      msg = new IntlMessageFormat(pattern, LOCALE_TAGS[locale]);
      formatterCache.set(cacheKey, msg);
    } catch {
      // Malformed ICU pattern — fail soft to the raw string.
      return pattern;
    }
  }

  try {
    const result = msg.format(values ?? {});
    return Array.isArray(result) ? result.join("") : String(result);
  } catch {
    return pattern;
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("locale");
      if (stored === "en" || stored === "es" || stored === "ar") return stored;
    }
    return "en";
  });

  const dir = isRtl(locale) ? "rtl" : "ltr";

  // Keep <html dir="..."> / <html lang="..."> in sync with the active
  // locale so RTL locales actually render right-to-left, and so that
  // browser/AT behavior (bidi, form controls, scrollbars) follows suit.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dir = dir;
    document.documentElement.lang = LOCALE_TAGS[locale];
  }, [locale, dir]);

  const handleSetLocale = useCallback((l: Locale) => {
    setLocale(l);
    if (typeof window !== "undefined") {
      localStorage.setItem("locale", l);
    }
  }, []);

  const t = useCallback(
    (key: string, values?: InterpolationValues) => {
      const pattern = get(locales[locale], key);
      if (pattern === undefined) return key;
      return formatMessage(locale, key, pattern, values);
    },
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale: handleSetLocale, localeTag: LOCALE_TAGS[locale], dir, t }),
    [locale, handleSetLocale, dir, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
