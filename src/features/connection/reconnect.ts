/**
 * Retry policy for a dropped audio socket.
 *
 * The server validates the pairing token only during the handshake, so a socket
 * that dies long after pairing cannot be re-opened with the same token. Retrying
 * is therefore worth exactly as much as the token's remaining lifetime — past a
 * rejected token the only way forward is a fresh QR scan, and hammering the
 * server would just keep failing.
 */

/** Delay before each retry attempt; length is the number of attempts allowed. */
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 8000] as const;

/** A connected socket that stops delivering audio for this long is presumed dead. */
export const STALL_TIMEOUT_MS = 2000;

export type FailureKind = 'retryable' | 'terminal_auth' | 'terminal_protocol';

const TERMINAL_PROTOCOL_CODES: readonly string[] = [
  'invalid_control_message',
  'binary_before_authentication',
  'short_header',
  'invalid_magic',
  'unsupported_version',
  'unsupported_message_type',
  'invalid_header_size',
  'unsupported_sample_format',
  'invalid_metadata',
  'invalid_payload_size',
];

/**
 * Whether another attempt can plausibly succeed.
 *
 * An expired or rejected token (`invalid_token`) is terminal: the server never
 * re-issues one over the wire, so the user has to scan again.
 */
export function classifyFailure(code: string | null | undefined): FailureKind {
  if (code === 'invalid_token') {
    return 'terminal_auth';
  }

  if (code !== null && code !== undefined && TERMINAL_PROTOCOL_CODES.includes(code)) {
    return 'terminal_protocol';
  }

  return 'retryable';
}

/** Delay in ms for a zero-based attempt index, or `null` once attempts are spent. */
export function nextRetryDelay(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= RECONNECT_DELAYS_MS.length) {
    return null;
  }

  return RECONNECT_DELAYS_MS[attempt];
}
