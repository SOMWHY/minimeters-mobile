import { DEFAULT_LOCALE, LOCALES, type Locale } from './messages';

/** Storage key; the version suffix lets a future migration discard old values. */
export const LOCALE_STORAGE_KEY = 'minimeters.i18n.locale.v1';

/**
 * The slice of `AsyncStorage` used here.
 *
 * Same shape as the dashboard's storage dependency, so a test can hand every
 * consumer one fake object.
 */
export interface LocaleStorageDeps {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** A stored locale, or the default. Never throws: a bad value just falls back. */
export async function loadLocale(storage: LocaleStorageDeps): Promise<Locale> {
  try {
    const stored = await storage.getItem(LOCALE_STORAGE_KEY);

    return isLocale(stored) ? stored : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** Best-effort write; a failure only costs the choice on the next launch. */
export async function saveLocale(
  storage: LocaleStorageDeps,
  locale: Locale,
): Promise<void> {
  try {
    await storage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignored on purpose: nothing the user can act on.
  }
}
