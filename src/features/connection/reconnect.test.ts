import {
  classifyFailure,
  nextRetryDelay,
  RECONNECT_DELAYS_MS,
  STALL_TIMEOUT_MS,
} from './reconnect';

describe('classifyFailure', () => {
  it('treats a rejected pairing code as terminal', () => {
    expect(classifyFailure('invalid_token')).toBe('terminal_auth');
  });

  it('treats a protocol violation as terminal', () => {
    expect(classifyFailure('invalid_magic')).toBe('terminal_protocol');
    expect(classifyFailure('short_header')).toBe('terminal_protocol');
    expect(classifyFailure('binary_before_authentication')).toBe('terminal_protocol');
  });

  it('retries anything the transport can recover from', () => {
    expect(classifyFailure(null)).toBe('retryable');
    expect(classifyFailure(undefined)).toBe('retryable');
    expect(classifyFailure('ECONNRESET')).toBe('retryable');
    expect(classifyFailure('server_error')).toBe('retryable');
    expect(classifyFailure('websocket Connection failed')).toBe('retryable');
  });
});

describe('nextRetryDelay', () => {
  it('backs off on every attempt and then gives up', () => {
    expect(RECONNECT_DELAYS_MS.map((_, attempt) => nextRetryDelay(attempt))).toEqual([
      ...RECONNECT_DELAYS_MS,
    ]);
    expect(nextRetryDelay(RECONNECT_DELAYS_MS.length)).toBeNull();
  });

  it('rejects an attempt index that is not a whole number', () => {
    expect(nextRetryDelay(-1)).toBeNull();
    expect(nextRetryDelay(1.5)).toBeNull();
  });
});

it('calls a stream stalled only after several frame intervals', () => {
  // A 30 fps stream delivers a frame every ~33 ms; the watchdog must not fire on
  // a single dropped frame.
  expect(STALL_TIMEOUT_MS).toBeGreaterThan(1000);
});
