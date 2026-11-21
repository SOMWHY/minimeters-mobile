import { act, fireEvent, render } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { I18nProvider, useI18n } from './i18n-context';
import { LOCALE_STORAGE_KEY, type LocaleStorageDeps } from './locale-storage';

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

/** Exposes the active language and a way to change it. */
function Probe() {
  const { locale, setLocale, t } = useI18n();

  return (
    <>
      <Text testID="locale">{locale}</Text>
      <Text testID="label">{t('panel.fullscreen')}</Text>
      <Pressable testID="switch-en" onPress={() => setLocale('en')}>
        <Text>en</Text>
      </Pressable>
    </>
  );
}

async function renderProbe(storage?: LocaleStorageDeps, forced?: 'zh' | 'en') {
  return render(
    <I18nProvider storage={storage} initialLocale={forced}>
      <Probe />
    </I18nProvider>,
  );
}

/** Let the storage read resolve and React re-render. */
async function flushStorageRead() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('I18nProvider', () => {
  it('starts in Chinese', async () => {
    const { getByTestId } = await renderProbe(memoryStorage().deps);

    expect(getByTestId('locale')).toHaveTextContent('zh');
    expect(getByTestId('label')).toHaveTextContent('全屏');
  });

  it('adopts a stored language after the first frame', async () => {
    const { deps } = memoryStorage({ [LOCALE_STORAGE_KEY]: 'en' });
    const { getByTestId } = await renderProbe(deps);

    await flushStorageRead();

    expect(getByTestId('locale')).toHaveTextContent('en');
    expect(getByTestId('label')).toHaveTextContent('Fullscreen');
  });

  it('switches immediately and persists the choice', async () => {
    const { deps, store } = memoryStorage();
    const { getByTestId } = await renderProbe(deps);

    await act(async () => {
      fireEvent.press(getByTestId('switch-en'));
    });

    expect(getByTestId('locale')).toHaveTextContent('en');
    expect(getByTestId('label')).toHaveTextContent('Fullscreen');

    await flushStorageRead();

    expect(store.get(LOCALE_STORAGE_KEY)).toBe('en');
  });

  it('ignores storage entirely when a locale is forced', async () => {
    const { deps, store } = memoryStorage({ [LOCALE_STORAGE_KEY]: 'en' });
    const { getByTestId } = await renderProbe(deps, 'zh');

    await flushStorageRead();
    expect(getByTestId('locale')).toHaveTextContent('zh');

    await act(async () => {
      fireEvent.press(getByTestId('switch-en'));
    });

    expect(getByTestId('locale')).toHaveTextContent('en');
    // Seeded with `en`; a forced locale must leave the stored value untouched.
    expect(store.get(LOCALE_STORAGE_KEY)).toBe('en');
  });
});
