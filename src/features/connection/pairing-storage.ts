import AsyncStorage from '@react-native-async-storage/async-storage';

import type { PairingPayload } from './pairing';

/**
 * Remembers the last accepted pairing so a relaunch does not need a QR scan.
 *
 * The QR token expires, so a stored pairing is only useful together with the
 * device token the server issues on the first successful handshake: the QR
 * gates *new* pairings, the device token keeps known phones connected.
 */
export const PAIRING_STORAGE_KEY = 'minimeters.pairing.v1';

export type StoredPairing = PairingPayload & {
  /** Issued by the server after the first successful authentication. */
  readonly deviceToken: string | null;
};

export type PairingStorageDeps = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export const defaultPairingStorage: PairingStorageDeps = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses a stored pairing, returning `null` for anything unrecognisable. */
export function parseStoredPairing(raw: string | null): StoredPairing | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  if (
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
    return null;
  }

  return {
    version: 1,
    address: parsed.address,
    port: parsed.port,
    path: '/ws',
    token: parsed.token,
    deviceToken: typeof parsed.deviceToken === 'string' && parsed.deviceToken.length > 0
      ? parsed.deviceToken
      : null,
  };
}

export async function loadPairing(
  storage: PairingStorageDeps = defaultPairingStorage,
): Promise<StoredPairing | null> {
  try {
    return parseStoredPairing(await storage.getItem(PAIRING_STORAGE_KEY));
  } catch {
    return null;
  }
}

export async function savePairing(
  pairing: StoredPairing,
  storage: PairingStorageDeps = defaultPairingStorage,
): Promise<void> {
  try {
    await storage.setItem(PAIRING_STORAGE_KEY, JSON.stringify(pairing));
  } catch {
    // A device without writable storage still streams; it just re-scans next launch.
  }
}

export async function clearPairing(
  storage: PairingStorageDeps = defaultPairingStorage,
): Promise<void> {
  try {
    await storage.removeItem(PAIRING_STORAGE_KEY);
  } catch {
    // Ignored: the in-memory session has already been closed.
  }
}
