/**
 * Shared i18n system for GreenPay
 *
 * This module provides a unified translation system across:
 * - Frontend (Next.js)
 * - Mobile (React Native/Expo)
 * - Extension (Browser extension)
 *
 * Features:
 * - ICU MessageFormat for pluralization
 * - RTL support
 * - Type-safe translations
 * - Shared locale files
 */

import IntlMessageFormat from "intl-messageformat";

// Import locale files
import en from "../locales/en.json";
import es from "../locales/es.json";
import ar from "../locales/ar.json";

export type Locale = "en" | "es" | "ar";

export const LOCALES: Locale[] = ["en", "es", "ar"];

export interface Translations {
  [key: string]: any;
}

export const localeData: Record<Locale, Translations> = {
  en,
  es,
  ar,
};

/** BCP-47 tags for Intl APIs */
export const LOCALE_TAGS: Record<Locale, string> = {
  en: "en-US",
  es: "es-ES",
  ar: "ar-EG",
};

/** RTL locales */
export const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(["ar"]);

export function isRtl(locale: Locale): boolean {
  return RTL_LOCALES.has(locale);
}

export function getDir(locale: Locale): "ltr" | "rtl" {
  return isRtl(locale) ? "rtl" : "ltr";
}

export type InterpolationValues = Record<string, string | number | Date>;

/**
 * Get a translation by dot-notation key path.
 *
 * @example
 * t("nav.home") // returns "Home"
 * t("project.donorsCount", { count: 5 }) // returns "5 donors"
 */
export function getMessage(
  locale: Locale,
  key: string,
  values?: InterpolationValues
): string {
  const data = localeData[locale];
  if (!data) {
    console.warn(`Missing locale data for: ${locale}`);
    return key;
  }

  // Resolve dot-notation path
  const parts = key.split(".");
  let result: any = data;
  for (const part of parts) {
    if (result && typeof result === "object" && part in result) {
      result = result[part];
    } else {
      console.warn(`Missing translation key: ${key} for locale: ${locale}`);
      return key;
    }
  }

  if (typeof result !== "string") {
    console.warn(`Translation key "${key}" is not a string`);
    return key;
  }

  // If there are no values, return the string directly
  if (!values || Object.keys(values).length === 0) {
    return result;
  }

  // Use ICU MessageFormat for interpolation and pluralization
  try {
    const formatter = new IntlMessageFormat(result, LOCALE_TAGS[locale]);
    return formatter.format(values) as string;
  } catch (err) {
    console.warn(`Failed to format message for key: ${key}`, err);
    return result;
  }
}

/**
 * Create a t() function for a specific locale.
 */
export function createT(locale: Locale) {
  return (key: string, values?: InterpolationValues): string => {
    return getMessage(locale, key, values);
  };
}

/**
 * Get all available languages
 */
export function getAvailableLanguages(): { code: Locale; name: string; nativeName: string }[] {
  return [
    { code: "en", name: "English", nativeName: "English" },
    { code: "es", name: "Spanish", nativeName: "Español" },
    { code: "ar", name: "Arabic", nativeName: "العربية" },
  ];
}

/**
 * Check if a translation key exists in all locales
 */
export function keyExistsInAllLocales(key: string): boolean {
  for (const locale of LOCALES) {
    const data = localeData[locale];
    if (!data) return false;

    const parts = key.split(".");
    let result: any = data;
    for (const part of parts) {
      if (result && typeof result === "object" && part in result) {
        result = result[part];
      } else {
        return false;
      }
    }
    if (typeof result !== "string") return false;
  }
  return true;
}
