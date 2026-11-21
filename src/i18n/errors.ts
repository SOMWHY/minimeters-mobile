import type { MessageKey } from './messages';

/**
 * Why the last scan or manual entry was rejected.
 *
 * These used to be finished English sentences produced inside the stream hook.
 * They are codes now so the text is chosen at render time — the hook stays free
 * of language, and a bundle that only ships one language cannot leak the other
 * into the UI.
 */
export type ScanErrorCode =
  | 'unsupportedVersion'
  | 'invalidPayload'
  | 'invalidToken'
  | 'invalidAddress';

/** Map a rejection code onto the message that explains it. */
export function scanErrorKey(code: ScanErrorCode): MessageKey {
  switch (code) {
    case 'unsupportedVersion':
      return 'scanError.unsupportedVersion';
    case 'invalidToken':
      return 'scanError.invalidToken';
    case 'invalidAddress':
      return 'scanError.invalidAddress';
    case 'invalidPayload':
    default:
      return 'scanError.invalidPayload';
  }
}
