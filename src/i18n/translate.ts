import { DEFAULT_LOCALE, MESSAGES, type Locale, type MessageKey } from './messages';

/** Values substituted into `{placeholder}` slots. */
export type MessageVars = Record<string, string | number>;

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Look a message up and fill its placeholders.
 *
 * An unknown key cannot happen through the typed API; if one ever arrives at
 * runtime (a stale bundle calling a key this build does not have) it renders the
 * key itself rather than throwing inside a render pass.
 */
export function translate(locale: Locale, key: MessageKey, vars?: MessageVars): string {
  const table = MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE];
  const template = table[key];

  if (template === undefined) {
    return key;
  }

  if (vars === undefined) {
    return template;
  }

  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = vars[name];

    return value === undefined ? match : String(value);
  });
}

export type { Locale, MessageKey };
export { DEFAULT_LOCALE, LOCALES, MESSAGES } from './messages';
