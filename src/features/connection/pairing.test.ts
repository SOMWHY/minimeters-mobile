import { parsePairingPayload } from './pairing';

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
