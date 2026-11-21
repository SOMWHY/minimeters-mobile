import { buildManualPairing, parsePairingPayload } from './pairing';

const validPayload = {
  version: 1,
  address: '192.168.1.20',
  port: 8422,
  path: '/ws',
  token: '0123456789abcdef',
};

describe('parsePairingPayload', () => {
  it('accepts the server pairing JSON', () => {
    expect(parsePairingPayload(JSON.stringify(validPayload))).toEqual({
      ok: true,
      payload: validPayload,
    });
  });

  it.each([
    ['malformed JSON', '{'],
    ['unsupported version', JSON.stringify({ ...validPayload, version: 2 })],
    ['empty address', JSON.stringify({ ...validPayload, address: '' })],
    ['invalid port', JSON.stringify({ ...validPayload, port: 65536 })],
    ['wrong path', JSON.stringify({ ...validPayload, path: '/other' })],
    ['empty token', JSON.stringify({ ...validPayload, token: '' })],
    ['unexpected field', JSON.stringify({ ...validPayload, extra: true })],
  ])('rejects %s', (_case, input) => {
    expect(parsePairingPayload(input).ok).toBe(false);
  });
});

describe('buildManualPairing', () => {
  it('defaults to the desktop port when only a host is typed', () => {
    expect(buildManualPairing(' 192.168.1.20 ', validPayload.token)).toEqual({
      ok: true,
      payload: validPayload,
    });
  });

  it.each([
    ['host:port', '192.168.1.20:9000', 9000],
    ['a ws URL with the path', 'ws://192.168.1.20:9000/ws', 9000],
    ['a trailing slash', '192.168.1.20:9000/', 9000],
  ])('accepts %s', (_case, address, port) => {
    expect(buildManualPairing(address, validPayload.token)).toEqual({
      ok: true,
      payload: { ...validPayload, port },
    });
  });

  it('keeps a bare IPv6 literal on the default port', () => {
    expect(buildManualPairing('fe80::1', validPayload.token)).toEqual({
      ok: true,
      payload: { ...validPayload, address: 'fe80::1' },
    });
  });

  it('reads a bracketed IPv6 literal with a port', () => {
    expect(buildManualPairing('[fe80::1]:9000', validPayload.token)).toEqual({
      ok: true,
      payload: { ...validPayload, address: 'fe80::1', port: 9000 },
    });
  });

  it('accepts the whole QR payload pasted into the address field', () => {
    expect(buildManualPairing(JSON.stringify(validPayload), 'ignored')).toEqual({
      ok: true,
      payload: validPayload,
    });
  });

  it.each([
    ['an empty token', '192.168.1.20', '  '],
    ['a token with whitespace', '192.168.1.20', 'abc def'],
  ])('rejects %s', (_case, address, token) => {
    expect(buildManualPairing(address, token)).toEqual({ ok: false, reason: 'invalid_token' });
  });

  it.each([
    ['an empty address', '   '],
    ['a port out of range', '192.168.1.20:70000'],
    ['a non-numeric port', '192.168.1.20:ws'],
    ['a path instead of a host', '192.168.1.20/ws'],
    ['an unbalanced IPv6 bracket', '[fe80::1'],
    ['a truncated QR payload', '{"version":1'],
  ])('rejects %s', (_case, address) => {
    expect(buildManualPairing(address, validPayload.token)).toEqual({
      ok: false,
      reason: 'invalid_address',
    });
  });
});
