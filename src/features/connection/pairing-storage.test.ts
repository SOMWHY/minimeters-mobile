import {
  PAIRING_STORAGE_KEY,
  clearPairing,
  loadPairing,
  parseStoredPairing,
  savePairing,
  type PairingStorageDeps,
  type StoredPairing,
} from './pairing-storage';

function memoryStorage(): PairingStorageDeps & { readonly store: Map<string, string> } {
  const store = new Map<string, string>();

  return {
    store,
    getItem: async (key) => store.get(key) ?? null,
    setItem: async (key, value) => {
      store.set(key, value);
    },
    removeItem: async (key) => {
      store.delete(key);
    },
  };
}

const pairing: StoredPairing = {
  version: 1,
  address: '192.168.1.20',
  port: 8422,
  path: '/ws',
  token: 'qr-token',
  deviceToken: 'device-token',
};

describe('parseStoredPairing', () => {
  it('round-trips a complete pairing', () => {
    expect(parseStoredPairing(JSON.stringify(pairing))).toEqual(pairing);
  });

  it('keeps a pairing stored before device tokens existed', () => {
    const { deviceToken: _dropped, ...legacy } = pairing;

    expect(parseStoredPairing(JSON.stringify(legacy))).toEqual({
      ...legacy,
      deviceToken: null,
    });
  });

  it.each([
    ['empty', ''],
    ['null', null],
    ['garbage', 'not json'],
    ['an array', '[]'],
    ['the wrong version', JSON.stringify({ ...pairing, version: 2 })],
    ['a missing address', JSON.stringify({ ...pairing, address: '' })],
    ['an out-of-range port', JSON.stringify({ ...pairing, port: 70000 })],
    ['a non-integer port', JSON.stringify({ ...pairing, port: 8422.5 })],
    ['a foreign path', JSON.stringify({ ...pairing, path: '/stream' })],
    ['an empty token', JSON.stringify({ ...pairing, token: '' })],
  ])('rejects %s', (_label, raw) => {
    expect(parseStoredPairing(raw)).toBeNull();
  });
});

describe('pairing storage', () => {
  it('saves, loads, and clears a pairing', async () => {
    const storage = memoryStorage();

    expect(await loadPairing(storage)).toBeNull();

    await savePairing(pairing, storage);
    expect(await loadPairing(storage)).toEqual(pairing);
    expect(storage.store.has(PAIRING_STORAGE_KEY)).toBe(true);

    await clearPairing(storage);
    expect(await loadPairing(storage)).toBeNull();
  });

  it('survives a storage that throws', async () => {
    const failing: PairingStorageDeps = {
      getItem: async () => {
        throw new Error('unavailable');
      },
      setItem: async () => {
        throw new Error('unavailable');
      },
      removeItem: async () => {
        throw new Error('unavailable');
      },
    };

    await expect(loadPairing(failing)).resolves.toBeNull();
    await expect(savePairing(pairing, failing)).resolves.toBeUndefined();
    await expect(clearPairing(failing)).resolves.toBeUndefined();
  });
});
