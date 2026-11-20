import { act, fireEvent, render } from '@testing-library/react-native';
import { PermissionStatus, useCameraPermissions } from 'expo-camera';

import { THEME_STORAGE_KEY } from './layout-storage';
import { PcmConnectionProvider } from '@/features/connection/connection-context';
import type { SocketFactory, SocketHandlers } from '@/features/connection/pcm-socket-client';
import { pcmPairing } from '@/features/connection/test-fixtures';
import { STALL_TIMEOUT_MS } from '@/features/connection/reconnect';
import { STREAM_REFRESH_MS } from '@/features/monitoring/use-pcm-stream';

import { DashboardScreen } from './DashboardScreen';
import type { LayoutStorageDeps } from './layout-storage';

// The module bodies render Skia canvases, whose ESM build jest cannot load. The
// screen test is about wiring — pairing, status, layout loading — so stub them.
jest.mock('./module-bodies', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Text: RNText } = jest.requireActual<typeof import('react-native')>('react-native');

  return {
    ModuleBody: ({ item }: { item: { kind: string } }) =>
      React.createElement(RNText, null, `module:${item.kind}`),
  };
});

jest.mock('expo-camera', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');

  return {
    CameraView: (props: Record<string, unknown>) =>
      React.createElement(View, { ...props, testID: 'camera-view' }),
    useCameraPermissions: jest.fn(),
    PermissionStatus: { GRANTED: 'granted', DENIED: 'denied' },
  };
});

const mockUseCameraPermissions = jest.mocked(useCameraPermissions);

function makeStereoFrame(): ArrayBuffer {
  const buffer = new ArrayBuffer(40);
  const view = new DataView(buffer);
  for (const [index, byte] of [...'MMSA'].entries()) {
    view.setUint8(index, byte.charCodeAt(0));
  }
  view.setUint8(4, 1);
  view.setUint8(5, 1);
  view.setUint16(6, 32, true);
  view.setUint32(8, 321, true);
  view.setUint32(16, 48000, true);
  view.setUint16(20, 2, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 1, true);
  view.setUint32(28, 8, true);
  view.setFloat32(32, 0.5, true);
  view.setFloat32(36, -0.5, true);
  return buffer;
}

function renderScreen(props: { socketFactory?: SocketFactory; storage?: LayoutStorageDeps }) {
  return render(
    <PcmConnectionProvider socketFactory={props.socketFactory}>
      <DashboardScreen storage={props.storage} />
    </PcmConnectionProvider>,
  );
}

async function layoutGrid(screen: { getByTestId: (id: string) => unknown }) {
  await act(async () => {
    fireEvent(screen.getByTestId('dashboard-grid') as never, 'layout', {
      nativeEvent: { layout: { width: 360, height: 640, x: 0, y: 0 } },
    });
  });
}

function memoryStorage(): LayoutStorageDeps & { readonly store: Map<string, string> } {
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

describe('DashboardScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockUseCameraPermissions.mockReturnValue([
      {
        granted: true,
        canAskAgain: true,
        expires: 'never',
        status: PermissionStatus.GRANTED,
      },
      jest.fn(),
      jest.fn(),
    ]);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('starts unpaired with the factory dashboard in place', async () => {
    const screen = await renderScreen({ storage: memoryStorage() });

    expect(screen.getByText('Not paired')).toBeTruthy();
    await act(async () => {});
    await layoutGrid(screen);
    expect(screen.getByText('module:waveform')).toBeTruthy();
    expect(screen.getByText('module:spectrogram')).toBeTruthy();

    screen.unmount();
  });

  it('pairs, streams, and reports frames on the dashboard', async () => {
    let socketHandlers: SocketHandlers | null = null;
    const socketFactory: SocketFactory = jest.fn((_url, handlers) => {
      socketHandlers = handlers;
      return { send: jest.fn(), close: jest.fn() };
    });
    const screen = await renderScreen({ socketFactory, storage: memoryStorage() });

    await fireEvent.press(screen.getByText('Scan plugin QR code'));
    await fireEvent(screen.getByTestId('camera-view'), 'barcodeScanned', {
      data: JSON.stringify(pcmPairing),
    });
    expect(socketFactory).toHaveBeenCalledWith('ws://192.168.1.20:8422/ws', expect.any(Object));
    expect(screen.getByText('Connecting · 0 frames')).toBeTruthy();

    if (!socketHandlers) {
      throw new Error('Expected the socket factory to capture handlers');
    }

    await act(async () => socketHandlers?.onOpen());
    await act(async () =>
      socketHandlers?.onMessage(
        JSON.stringify({ type: 'authenticated', version: 1, sampleFormat: 'f32le' }),
      ),
    );
    await act(async () => socketHandlers?.onMessage(makeStereoFrame()));
    await act(async () => {
      jest.advanceTimersByTime(100);
    });

    expect(
      screen.getByText(
        /^Connected · 1 frames · -?\d+\.\d LUFS \(M -?\d+\.\d \/ S -?\d+\.\d\)$/,
      ),
    ).toBeTruthy();
    await layoutGrid(screen);
    expect(screen.getByText('module:waveform')).toBeTruthy();

    screen.unmount();
  });

  it('reports an invalid pairing code and keeps the scanner open', async () => {
    const screen = await renderScreen({ storage: memoryStorage() });

    await fireEvent.press(screen.getByText('Scan plugin QR code'));
    await fireEvent(screen.getByTestId('camera-view'), 'barcodeScanned', {
      data: 'not a pairing code',
    });

    expect(screen.getByText('This is not a valid MiniMeters pairing code.')).toBeTruthy();
    expect(screen.getByTestId('camera-view')).toBeTruthy();

    screen.unmount();
  });

  it('switches the theme and persists the choice', async () => {
    const storage = memoryStorage();
    const screen = await renderScreen({ storage });
    await act(async () => {});

    await fireEvent.press(screen.getByText('Ember'));
    await act(async () => {});

    expect(storage.store.get(THEME_STORAGE_KEY)).toBe('ember');

    screen.unmount();
  });

  it('applies a stored layout on load', async () => {
    const storage = memoryStorage();
    storage.store.set(
      'minimeters.dashboard.layout.v1',
      JSON.stringify({
        version: 1,
        items: [
          { id: 'spectrum', kind: 'spectrum', visible: true, placement: { col: 0, row: 0, colSpan: 2, rowSpan: 1 } },
        ],
      }),
    );

    const screen = await renderScreen({ storage });
    await act(async () => {});
    await layoutGrid(screen);

    expect(screen.getByText('module:spectrum')).toBeTruthy();

    screen.unmount();
  });

  it('mounts the scanner in a full-screen overlay with scrolling available', async () => {
    const screen = await renderScreen({ storage: memoryStorage() });

    await fireEvent.press(screen.getByText('Scan plugin QR code'));

    expect(screen.getByTestId('pairing-scanner-overlay')).toBeTruthy();
    // The preview must not live inside the scroll view, which is what made the
    // Android surface render black.
    expect(screen.getByTestId('pairing-scanner-overlay')).toContainElement(
      screen.getByTestId('camera-view'),
    );
    expect(screen.getByTestId('dashboard-scroll').props.scrollEnabled).toBe(true);

    screen.unmount();
  });

  it('keeps edit controls and the hidden tray in the pinned bar while editing', async () => {
    const storage = memoryStorage();
    storage.store.set(
      'minimeters.dashboard.layout.v1',
      JSON.stringify({
        version: 1,
        items: [
          {
            id: 'spectrum',
            kind: 'spectrum',
            visible: false,
            placement: { col: 0, row: 0, colSpan: 2, rowSpan: 1 },
          },
        ],
      }),
    );

    const screen = await renderScreen({ storage });
    await act(async () => {});

    await fireEvent.press(screen.getByText('Scan plugin QR code'));
    await fireEvent(screen.getByTestId('camera-view'), 'barcodeScanned', {
      data: JSON.stringify(pcmPairing),
    });

    await fireEvent.press(screen.getByText('Edit layout'));

    // Scrolling is disabled while editing, so these must sit outside the scroll view.
    expect(screen.getByTestId('dashboard-scroll').props.scrollEnabled).toBe(false);
    expect(screen.getByTestId('pinned-bar')).toContainElement(
      screen.getByText('Reset layout'),
    );
    expect(screen.getByTestId('pinned-bar')).toContainElement(
      screen.getByTestId('hidden-tray'),
    );
    expect(screen.getByText('Done')).toBeTruthy();

    screen.unmount();
  });

  it('reconnects after the socket drops', async () => {
    const handlers: SocketHandlers[] = [];
    const socketFactory: SocketFactory = jest.fn((_url, socketHandlers) => {
      handlers.push(socketHandlers);
      return { send: jest.fn(), close: jest.fn() };
    });
    const screen = await renderScreen({ socketFactory, storage: memoryStorage() });

    await fireEvent.press(screen.getByText('Scan plugin QR code'));
    await fireEvent(screen.getByTestId('camera-view'), 'barcodeScanned', {
      data: JSON.stringify(pcmPairing),
    });
    await act(async () => handlers[0]?.onOpen());
    await act(async () =>
      handlers[0]?.onMessage(
        JSON.stringify({ type: 'authenticated', version: 1, sampleFormat: 'f32le' }),
      ),
    );
    expect(socketFactory).toHaveBeenCalledTimes(1);

    await act(async () => handlers[0]?.onClose?.());
    expect(screen.getByTestId('connection-banner')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(socketFactory).toHaveBeenCalledTimes(2);

    screen.unmount();
  });

  it('rebuilds a socket that stays open but stops delivering audio', async () => {
    const handlers: SocketHandlers[] = [];
    const socketFactory: SocketFactory = jest.fn((_url, socketHandlers) => {
      handlers.push(socketHandlers);
      return { send: jest.fn(), close: jest.fn() };
    });
    const screen = await renderScreen({ socketFactory, storage: memoryStorage() });

    await fireEvent.press(screen.getByText('Scan plugin QR code'));
    await fireEvent(screen.getByTestId('camera-view'), 'barcodeScanned', {
      data: JSON.stringify(pcmPairing),
    });
    await act(async () => handlers[0]?.onOpen());
    await act(async () =>
      handlers[0]?.onMessage(
        JSON.stringify({ type: 'authenticated', version: 1, sampleFormat: 'f32le' }),
      ),
    );
    expect(socketFactory).toHaveBeenCalledTimes(1);

    // The server never sends a keepalive, so silence is indistinguishable from a
    // dead link: give it a couple of seconds and rebuild the connection.
    await act(async () => {
      jest.advanceTimersByTime(STALL_TIMEOUT_MS + STREAM_REFRESH_MS);
    });

    expect(socketFactory).toHaveBeenCalledTimes(2);

    screen.unmount();
  });

  it('stops retrying once the server rejects the pairing code', async () => {
    const handlers: SocketHandlers[] = [];
    const socketFactory: SocketFactory = jest.fn((_url, socketHandlers) => {
      handlers.push(socketHandlers);
      return { send: jest.fn(), close: jest.fn() };
    });
    const screen = await renderScreen({ socketFactory, storage: memoryStorage() });

    await fireEvent.press(screen.getByText('Scan plugin QR code'));
    await fireEvent(screen.getByTestId('camera-view'), 'barcodeScanned', {
      data: JSON.stringify(pcmPairing),
    });
    await act(async () => handlers[0]?.onOpen());

    await act(async () =>
      handlers[0]?.onMessage(
        JSON.stringify({ type: 'error', code: 'invalid_token', message: 'Pairing code expired' }),
      ),
    );

    expect(screen.getByText('The pairing code expired. Scan the plugin QR code again.')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    // The server only checks the token during the handshake, so retrying an
    // expired one would fail forever — the user has to scan again.
    expect(socketFactory).toHaveBeenCalledTimes(1);

    screen.unmount();
  });
});
