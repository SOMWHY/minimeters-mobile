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

/**
 * Port the desktop app listens on. Manual entry defaults to it so the address
 * field accepts a bare host, which is what people read off the QR card first.
 */
export const DEFAULT_PAIRING_PORT = 8422;

export type ManualPairingFailure = 'invalid_address' | 'invalid_token';

export type ManualPairingResult =
  | { ok: true; payload: PairingPayload }
  | { ok: false; reason: ManualPairingFailure };

function normalizeAddress(raw: string): { host: string; port: number } | null {
  let value = raw.trim();

  // Accept what people actually paste: a bare host, host:port, or the whole
  // `ws://host:port/ws` URL they copied out of a log. The path is only stripped
  // from a URL: `host/ws` is a typo, not an address.
  const hadScheme = /^wss?:\/\//i.test(value);
  value = value.replace(/^wss?:\/\//i, '');

  if (hadScheme) {
    value = value.replace(/\/ws$/i, '');
  }

  value = value.replace(/\/+$/, '');

  if (value.length === 0) {
    return null;
  }

  let host = value;
  let portText: string | null = null;

  if (value.startsWith('[')) {
    // Bracketed IPv6, optionally followed by `:port`.
    const close = value.indexOf(']');
    if (close === -1) {
      return null;
    }

    host = value.slice(1, close);

    const rest = value.slice(close + 1);
    if (rest.length > 0) {
      if (!rest.startsWith(':')) {
        return null;
      }

      portText = rest.slice(1);
    }
  } else {
    const firstColon = value.indexOf(':');
    const lastColon = value.lastIndexOf(':');

    // A single colon is `host:port`; several mean a bare IPv6 literal, which
    // keeps the default port.
    if (firstColon !== -1 && firstColon === lastColon) {
      host = value.slice(0, lastColon);
      portText = value.slice(lastColon + 1);
    }
  }

  if (host.length === 0 || /[\s/]/.test(host)) {
    return null;
  }

  if (portText === null) {
    return { host, port: DEFAULT_PAIRING_PORT };
  }

  if (!/^\d{1,5}$/.test(portText)) {
    return null;
  }

  const port = Number(portText);
  if (port < 1 || port > 65535) {
    return null;
  }

  return { host, port };
}

/**
 * Builds a pairing payload from the two fields the desktop app shows under its
 * QR code.
 *
 * The QR scanner is the happy path, but it is the only path today — a desktop
 * on a platform where the camera is unavailable, a remote session, or a pasted
 * code all end at these two values. Pasting the entire QR JSON into the address
 * field works too, since that is the same text the scanner would have decoded.
 */
export function buildManualPairing(address: string, token: string): ManualPairingResult {
  const trimmedAddress = address.trim();
  const trimmedToken = token.trim();

  if (trimmedToken.length === 0 || /\s/.test(trimmedToken)) {
    return { ok: false, reason: 'invalid_token' };
  }

  if (trimmedAddress.length === 0) {
    return { ok: false, reason: 'invalid_address' };
  }

  if (trimmedAddress.startsWith('{')) {
    const pasted = parsePairingPayload(trimmedAddress);

    return pasted.ok ? pasted : { ok: false, reason: 'invalid_address' };
  }

  const normalized = normalizeAddress(trimmedAddress);
  if (normalized === null) {
    return { ok: false, reason: 'invalid_address' };
  }

  return {
    ok: true,
    payload: {
      version: 1,
      address: normalized.host,
      port: normalized.port,
      path: '/ws',
      token: trimmedToken,
    },
  };
}
