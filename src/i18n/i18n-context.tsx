import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { loadLocale, saveLocale, type LocaleStorageDeps } from './locale-storage';
import { DEFAULT_LOCALE, type Locale, type MessageKey } from './messages';
import { translate, type MessageVars } from './translate';

export type Translate = (key: MessageKey, vars?: MessageVars) => string;

export type I18nValue = {
  readonly locale: Locale;
  readonly setLocale: (locale: Locale) => void;
  readonly t: Translate;
};

const I18nContext = createContext<I18nValue | null>(null);

export type I18nProviderProps = {
  readonly children: ReactNode;
  /** Injected for tests; defaults to device storage. */
  readonly storage?: LocaleStorageDeps;
  /** Forces a locale and skips storage entirely (tests, previews). */
  readonly initialLocale?: Locale;
};

/**
 * Owns the active language.
 *
 * Storage is read once on mount and the UI starts in the default language, so
 * the first frame never blocks on I/O. A stored language other than the default
 * therefore switches one frame after launch rather than delaying the splash —
 * the trade is deliberate: nothing on the dashboard is language-dependent until
 * the settings panel is opened, which cannot happen that fast.
 */
export function I18nProvider({ children, storage, initialLocale }: I18nProviderProps) {
  const store = storage ?? AsyncStorage;
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? DEFAULT_LOCALE);

  useEffect(() => {
    if (initialLocale !== undefined) {
      return;
    }

    let active = true;

    void loadLocale(store).then((stored) => {
      if (active) {
        setLocaleState(stored);
      }
    });

    return () => {
      active = false;
    };
  }, [initialLocale, store]);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);

      if (initialLocale === undefined) {
        void saveLocale(store, next);
      }
    },
    [initialLocale, store],
  );

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: (key, vars) => translate(locale, key, vars),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);

  if (value === null) {
    throw new Error('useI18n must be used inside <I18nProvider>');
  }

  return value;
}
