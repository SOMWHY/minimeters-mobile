import {
  connectionTone,
  INDICATOR_COLORS,
  indicatorLabel,
  type IndicatorInput,
} from './connection-indicator';

const base: IndicatorInput = {
  status: 'disconnected',
  reauthRequired: false,
  fatalError: null,
  connectionError: null,
  protocolError: null,
};

describe('connectionTone', () => {
  it.each(['disconnected', 'connecting', 'authenticating'] as const)(
    'reads %s as idle',
    (status) => {
      expect(connectionTone({ ...base, status })).toBe('idle');
    },
  );

  it('reads a connected socket as live', () => {
    expect(connectionTone({ ...base, status: 'connected' })).toBe('live');
  });

  it.each([
    ['an error state', { status: 'error' as const }],
    ['a rejected token', { reauthRequired: true }],
    ['a fatal error', { fatalError: 'unreachable' }],
    ['a socket error', { connectionError: 'Network request failed' }],
    ['a protocol error', { protocolError: 'unexpected frame' }],
  ])('reads %s as error', (_label, patch) => {
    expect(connectionTone({ ...base, ...patch })).toBe('error');
  });

  it('prefers error over a socket that still looks connected', () => {
    expect(
      connectionTone({ ...base, status: 'connected', protocolError: 'unexpected frame' }),
    ).toBe('error');
  });
});

describe('INDICATOR_COLORS', () => {
  it('has a distinct colour per tone', () => {
    const colours = Object.values(INDICATOR_COLORS);

    expect(colours).toHaveLength(3);
    expect(new Set(colours).size).toBe(3);
  });
});

describe('indicatorLabel', () => {
  it('names each tone', () => {
    expect(indicatorLabel('idle')).toBe('status.idle');
    expect(indicatorLabel('live')).toBe('status.connected');
    expect(indicatorLabel('error')).toBe('status.error');
  });
});
