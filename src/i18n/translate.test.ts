import { LOCALES, MESSAGES, type MessageKey } from './messages';
import { translate } from './translate';

const KEYS = Object.keys(MESSAGES.zh) as MessageKey[];

/** `{attempt}`, `{detail}` … in order of appearance. */
function placeholders(template: string): string[] {
  return Array.from(template.matchAll(/\{(\w+)\}/g), (match) => match[1] as string);
}

describe('message tables', () => {
  it('defines every key in every language', () => {
    for (const locale of LOCALES) {
      expect(Object.keys(MESSAGES[locale]).sort()).toEqual([...KEYS].sort());
    }
  });

  it('has no blank strings', () => {
    for (const locale of LOCALES) {
      for (const key of KEYS) {
        expect(MESSAGES[locale][key].trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('uses the same placeholders in every language', () => {
    for (const key of KEYS) {
      const expected = placeholders(MESSAGES.zh[key]).sort();

      for (const locale of LOCALES) {
        expect({ key, locale, vars: placeholders(MESSAGES[locale][key]).sort() }).toEqual({
          key,
          locale,
          vars: expected,
        });
      }
    }
  });
});

describe('translate', () => {
  it('returns the Chinese template by default', () => {
    expect(translate('zh', 'panel.fullscreen')).toBe('全屏');
  });

  it('returns the English template for en', () => {
    expect(translate('en', 'panel.fullscreen')).toBe('Fullscreen');
  });

  it('fills placeholders', () => {
    expect(translate('en', 'banner.reconnecting', { attempt: 3 })).toBe(
      'Reconnecting… (attempt 3)',
    );
    expect(translate('zh', 'banner.reconnecting', { attempt: 2 })).toContain('2');
  });

  it('leaves an unknown placeholder visibly unfilled instead of blanking it', () => {
    expect(translate('en', 'banner.reconnecting')).toContain('{attempt}');
  });

  it('ignores extra vars', () => {
    expect(translate('en', 'panel.done', { unused: 'x' })).toBe('Done');
  });

  it('falls back to the key itself for a key this build does not have', () => {
    // Simulates a stale bundle calling a newer key.
    expect(translate('en', 'not.a.key' as MessageKey)).toBe('not.a.key');
  });
});
