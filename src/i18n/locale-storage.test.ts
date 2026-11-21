import {
  LOCALE_STORAGE_KEY,
  isLocale,
  loadLocale,
  saveLocale,
  type LocaleStorageDeps,
} from './locale-storage';

function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));

  const deps: LocaleStorageDeps = {
    getItem: async (key) => store.get(key) ?? null,
    setItem: async (key, value) => {
      store.set(key, value);
    },
  };

  return { deps, store };
}

function failingStorage(): LocaleStorageDeps {
  return {
    getItem: async () => {
      throw new Error('storage offline');
    },
    setItem: async () => {
      throw new Error('storage offline');
    },
  };
}

describe('isLocale', () => {
  it('accepts the supported tags and nothing else', () => {
    expect(isLocale('zh')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(7)).toBe(false);
  });
});

describe('loadLocale', () => {
  it('returns what was saved', async () => {
    const { deps } = memoryStorage({ [LOCALE_STORAGE_KEY]: 'en' });

    await expect(loadLocale(deps)).resolves.toBe('en');
  });

  it('falls back to Chinese when nothing is stored', async () => {
    const { deps } = memoryStorage();

    await expect(loadLocale(deps)).resolves.toBe('zh');
  });

  it('falls back to Chinese for a language this build dropped', async () => {
    const { deps } = memoryStorage({ [LOCALE_STORAGE_KEY]: 'fr' });

    await expect(loadLocale(deps)).resolves.toBe('zh');
  });

  it('falls back to Chinese when storage throws', async () => {
    await expect(loadLocale(failingStorage())).resolves.toBe('zh');
  });
});

describe('saveLocale', () => {
  it('writes under the versioned key', async () => {
    const { deps, store } = memoryStorage();

    await saveLocale(deps, 'en');

    expect(store.get(LOCALE_STORAGE_KEY)).toBe('en');
  });

  it('swallows a write failure', async () => {
    await expect(saveLocale(failingStorage(), 'en')).resolves.toBeUndefined();
  });
});
