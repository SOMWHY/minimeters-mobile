import { act, fireEvent, render, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PermissionStatus, useCameraPermissions } from 'expo-camera';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { THEME_STORAGE_KEY } from './layout-storage';
import { INDICATOR_COLORS } from './connection-indicator';
import { PcmConnectionProvider } from '@/features/connection/connection-context';
import type { SocketFactory, SocketHandlers } from '@/features/connection/pcm-socket-client';
import { pcmPairing } from '@/features/connection/test-fixtures';
import { PAIRING_STORAGE_KEY } from '@/features/connection/pairing-storage';
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

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, bottom: 0, left: 0, right: 0 },
};

function renderScreen(props: { socketFactory?: SocketFactory; storage?: LayoutStorageDeps }) {
  return render(
    <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
      <PcmConnectionProvider socketFactory={props.socketFactory}>
        <DashboardScreen storage={props.storage} />
      </PcmConnectionProvider>
    </SafeAreaProvider>,
  );
}

/**
 * The settings orb replaced the pinned bar: every control is behind a tap on it.
 *
 * Tap and drag share the orb — the drag only claims the responder once the
 * finger travels — so a plain press is enough to open the panel.
 */
async function openSettingsPanel(screen: { getByTestId: (id: string) => unknown }) {
  await fireEvent.press(screen.getByTestId('settings-orb') as never);
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
  beforeEach(async () => {
    // The stream remembers the last pairing in AsyncStorage (the jest mock is
    // shared across tests), so a test that scans would auto-connect the next one.
    await AsyncStorage.clear();
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

  it('starts unpaired with the factory dashboard in place and the light idle', async () => {
    const screen = await renderScreen({ storage: memoryStorage() });

    // The header text is gone: one light carries the whole connection state.
    expect(screen.queryByText('Dashboard')).toBeNull();
    expect(screen.queryByText('Not paired')).toBeNull();
    expect(screen.getByTestId('connection-light')).toHaveStyle({
      backgroundColor: INDICATOR_COLORS.idle,
    });
    expect(screen.getByTestId('connection-light').props.accessibilityLabel).toBe('Not connected');
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

    await openSettingsPanel(screen);
    await fireEvent.press(screen.getByText('Scan plugin QR code'));
    await fireEvent(screen.getByTestId('camera-view'), 'barcodeScanned', {
      data: JSON.stringify(pcmPairing),
    });
    expect(socketFactory).toHaveBeenCalledWith('ws://192.168.1.20:8422/ws', expect.any(Object));
    // Pairing starts the socket but is not yet a live feed.
    expect(screen.getByTestId('connection-light').props.accessibilityLabel).toBe('Not connected');

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

    expect(screen.getByTestId('connection-light')).toHaveStyle({
      backgroundColor: INDICATOR_COLORS.live,
    });
    expect(screen.getByTestId('connection-light').props.accessibilityLabel).toBe('Connected');
    await layoutGrid(screen);
    expect(screen.getByText('module:waveform')).toBeTruthy();

    screen.unmount();
  });

  it('reconnects on launch with the stored device token and skips the scanner', async () => {
    const sent: string[] = [];
    let socketHandlers: SocketHandlers | null = null;
    const socketFactory: SocketFactory = jest.fn((_url, handlers) => {
      socketHandlers = handlers;
      return { send: (data: string) => sent.push(data), close: jest.fn() };
    });

    await AsyncStorage.setItem(
      PAIRING_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        address: '192.168.1.20',
        port: 8422,
        path: '/ws',
        token: 'expired-qr-token',
        deviceToken: 'kept-device-token',
      }),
    );

    const screen = await renderScreen({ socketFactory, storage: memoryStorage() });
    await act(async () => {});

    // No scan: the stored pairing drives the connection. The panel shows the
    // paired controls instead of the scan button.
    expect(socketFactory).toHaveBeenCalledWith('ws://192.168.1.20:8422/ws', expect.any(Object));
    await openSettingsPanel(screen);
    expect(screen.queryByText('Scan plugin QR code')).toBeNull();
    expect(screen.getByText('Disconnect')).toBeTruthy();

    if (!socketHandlers) {
      throw new Error('Expected the socket factory to capture handlers');
    }

    await act(async () => socketHandlers?.onOpen());
    expect(JSON.parse(sent[0] ?? '{}')).toMatchObject({
      type: 'authenticate',
      token: 'expired-qr-token',
      deviceToken: 'kept-device-token',
    });

    await act(async () =>
      socketHandlers?.onMessage(
        JSON.stringify({
          type: 'authenticated',
          version: 1,
          sampleFormat: 'f32le',
          deviceToken: 'rotated-device-token',
        }),
      ),
    );
    await act(async () => {});

    // A token the server rotated is what the next launch will present.
    expect(JSON.parse((await AsyncStorage.getItem(PAIRING_STORAGE_KEY)) ?? '{}')).toMatchObject({
      deviceToken: 'rotated-device-token',
    });

    screen.unmount();
  });

  it('reports an invalid pairing code and keeps the scanner open', async () => {
    const screen = await renderScreen({ storage: memoryStorage() });

    await openSettingsPanel(screen);
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

    await openSettingsPanel(screen);
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

    await openSettingsPanel(screen);
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

  it('keeps the edit controls and the hidden tray in the settings panel', async () => {
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

    await openSettingsPanel(screen);
    await fireEvent.press(screen.getByText('Scan plugin QR code'));
    await fireEvent(screen.getByTestId('camera-view'), 'barcodeScanned', {
      data: JSON.stringify(pcmPairing),
    });

    await fireEvent.press(screen.getByText('Edit layout'));

    // Editing keeps the page scrollable — a long grid has to be reachable — while
    // a card drag freezes it for the duration of the gesture.
    expect(screen.getByTestId('dashboard-scroll').props.scrollEnabled).toBe(true);
    expect(screen.getByTestId('settings-panel')).toContainElement(
      screen.getByText('Reset layout'),
    );
    expect(screen.getByTestId('settings-panel')).toContainElement(
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

    await openSettingsPanel(screen);
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

    await openSettingsPanel(screen);
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

  it('keeps the session alive and retries slowly after a rejected token', async () => {
    const handlers: SocketHandlers[] = [];
    const socketFactory: SocketFactory = jest.fn((_url, socketHandlers) => {
      handlers.push(socketHandlers);
      return { send: jest.fn(), close: jest.fn() };
    });
    const screen = await renderScreen({ socketFactory, storage: memoryStorage() });

    await openSettingsPanel(screen);
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

    // Nothing is stored to prove the server issues tokens, so the hint points at
    // a re-scan first and only blames the build if that keeps failing.
    expect(screen.getByText(/no device token stored/)).toBeTruthy();
    expect(screen.getByTestId('connection-light').props.accessibilityLabel).toBe(
      'Connection error',
    );
    expect(screen.getByTestId('connection-light')).toHaveStyle({
      backgroundColor: INDICATOR_COLORS.error,
    });

    // A rejected token is a slow re-auth, not a dead end: the phone keeps the
    // last frame and retries so that a fresh scan recovers on its own.
    await act(async () => {
      jest.advanceTimersByTime(29_000);
    });
    expect(socketFactory).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    expect(socketFactory).toHaveBeenCalledTimes(2);

    screen.unmount();
  });

  it('asks for a re-scan when the server had issued a device token', async () => {
    const handlers: SocketHandlers[] = [];
    const socketFactory: SocketFactory = jest.fn((_url, socketHandlers) => {
      handlers.push(socketHandlers);
      return { send: jest.fn(), close: jest.fn() };
    });
    const screen = await renderScreen({ socketFactory, storage: memoryStorage() });

    await openSettingsPanel(screen);
    await fireEvent.press(screen.getByText('Scan plugin QR code'));
    await fireEvent(screen.getByTestId('camera-view'), 'barcodeScanned', {
      data: JSON.stringify(pcmPairing),
    });
    await act(async () => handlers[0]?.onOpen());
    await act(async () =>
      handlers[0]?.onMessage(
        JSON.stringify({
          type: 'authenticated',
          version: 1,
          sampleFormat: 'f32le',
          deviceToken: 'issued-device-token',
        }),
      ),
    );

    await act(async () =>
      handlers[0]?.onMessage(
        JSON.stringify({ type: 'error', code: 'invalid_token', message: 'Pairing code expired' }),
      ),
    );

    // The server does issue tokens, so this really is an expired code.
    expect(screen.getByText('The pairing code expired. Scan the plugin QR code again.')).toBeTruthy();

    screen.unmount();
  });
});

describe('DashboardScreen fit', () => {
  /** Push a layout box onto a testID'd node, as the platform would. */
  async function layoutNode(
    screen: { getByTestId: (id: string) => unknown },
    testID: string,
    width: number,
    height: number,
  ) {
    await act(async () => {
      fireEvent(screen.getByTestId(testID) as never, 'layout', {
        nativeEvent: { layout: { width, height, x: 0, y: 0 } },
      });
    });
  }

  /**
   * The measured viewport is what the grid must fill.
   *
   * The window estimate and the laid-out scroll view disagree on Android; the
   * difference used to be a band of background under the last row that no card
   * could reach. The phone preset pads 12 and gaps 8 over five gaps and six
   * rows, so a viewport of 800 leaves `(800 - 24 - 40) / 6`.
   */
  it('fits the grid to the measured viewport', async () => {
    const screen = await renderScreen({ storage: memoryStorage() });

    await layoutNode(screen, 'dashboard-scroll', 390, 800);

    const grid = screen.getByTestId('dashboard-grid');
    expect(StyleSheet.flatten(grid.props.style).height).toBeCloseTo(800, 0);

    screen.unmount();
  });

  it('re-fits when the viewport changes, as on rotation', async () => {
    const screen = await renderScreen({ storage: memoryStorage() });

    const height = () => StyleSheet.flatten(screen.getByTestId('dashboard-grid').props.style).height;

    await layoutNode(screen, 'dashboard-scroll', 390, 800);
    expect(height()).toBeCloseTo(800, 0);

    // A shorter viewport re-fits on the next layout pass, exactly.
    await layoutNode(screen, 'dashboard-scroll', 390, 600);
    expect(height()).toBeCloseTo(600, 0);

    // Squeezing below the row floor is refused: the page scrolls instead.
    await layoutNode(screen, 'dashboard-scroll', 390, 240);
    expect(height()).toBeGreaterThan(240);

    screen.unmount();
  });

  it('falls back to the window estimate before the first layout pass', async () => {
    const screen = await renderScreen({ storage: memoryStorage() });

    const height = StyleSheet.flatten(screen.getByTestId('dashboard-grid').props.style).height;

    expect(Number.isFinite(height)).toBe(true);
    expect(height).toBeGreaterThan(0);

    screen.unmount();
  });
});

describe('DashboardScreen chrome', () => {
  it('carries the connection light inside the settings orb', async () => {
    const screen = await renderScreen({ storage: memoryStorage() });

    // The orb is the one thing always on screen, so the status dot lives in it
    // rather than in a separate badge hugging a corner.
    expect(within(screen.getByTestId('settings-orb')).getByTestId('connection-light')).toBeTruthy();
    expect(screen.queryByTestId('connection-light-host')).toBeNull();
    expect(screen.getAllByTestId('connection-light')).toHaveLength(1);

    screen.unmount();
  });
});
