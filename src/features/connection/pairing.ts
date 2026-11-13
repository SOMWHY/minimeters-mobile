export type PairingPayload = {
  version: 1;
  address: string;
  port: number;
  path: '/ws';
  token: string;
};

export type PairingParseResult =
  | { ok: true; payload: PairingPayload }
  | { ok: false; reason: 'invalid_json' | 'unsupported_version' | 'invalid_payload' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parsePairingPayload(raw: string): PairingParseResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  if (!isRecord(parsed)) {
    return { ok: false, reason: 'invalid_payload' };
  }

  if (parsed.version !== undefined && parsed.version !== 1) {
    return { ok: false, reason: 'unsupported_version' };
  }

  const keys = Object.keys(parsed);
  if (
    keys.length !== 5 ||
    !keys.every((key) => ['version', 'address', 'port', 'path', 'token'].includes(key)) ||
    parsed.version !== 1 ||
    typeof parsed.address !== 'string' ||
    parsed.address.length === 0 ||
    typeof parsed.port !== 'number' ||
    !Number.isInteger(parsed.port) ||
    parsed.port < 1 ||
    parsed.port > 65535 ||
    parsed.path !== '/ws' ||
    typeof parsed.token !== 'string' ||
    parsed.token.length === 0
  ) {
    return { ok: false, reason: 'invalid_payload' };
  }

  return {
    ok: true,
    payload: {
      version: 1,
      address: parsed.address,
      port: parsed.port,
      path: '/ws',
      token: parsed.token,
    },
  };
}
