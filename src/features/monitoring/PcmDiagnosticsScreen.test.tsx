import { act, fireEvent, render } from '@testing-library/react-native';
import { PermissionStatus, useCameraPermissions } from 'expo-camera';

import { PcmConnectionProvider } from '@/features/connection/connection-context';
import type { SocketFactory, SocketHandlers } from '@/features/connection/pcm-socket-client';
import { pcmPairing } from '@/features/connection/test-fixtures';

import { PcmDiagnosticsScreen } from './PcmDiagnosticsScreen';

jest.mock('react-native-safe-area-context', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');

  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
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

function stereoFrame(): ArrayBuffer {
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

function renderDiagnostics(socketFactory?: SocketFactory) {
  return render(
    <PcmConnectionProvider socketFactory={socketFactory}>
      <PcmDiagnosticsScreen />
    </PcmConnectionProvider>,
  );
}

describe('PcmDiagnosticsScreen', () => {
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
  });

  it('offers the scanner while unpaired', async () => {
    const screen = await renderDiagnostics();

    expect(screen.getByText('Not paired')).toBeTruthy();
    expect(screen.getByText('Scan plugin QR code')).toBeTruthy();

    screen.unmount();
  });

  it('rejects an invalid pairing code', async () => {
    const screen = await renderDiagnostics();

    await fireEvent.press(screen.getByText('Scan plugin QR code'));
    await fireEvent(screen.getByTestId('camera-view'), 'barcodeScanned', { data: 'nope' });

    expect(screen.getByText('This is not a valid MiniMeters pairing code.')).toBeTruthy();

    screen.unmount();
  });

  it('reports connection state and decodes a frame into the raw table', async () => {
    let handlers: SocketHandlers | null = null;
    const socketFactory: SocketFactory = jest.fn((_url, socketHandlers) => {
      handlers = socketHandlers;

      return { send: jest.fn(), close: jest.fn() };
    });
    const screen = await renderDiagnostics(socketFactory);

    await fireEvent.press(screen.getByText('Scan plugin QR code'));
    await fireEvent(screen.getByTestId('camera-view'), 'barcodeScanned', {
      data: JSON.stringify(pcmPairing),
    });

    expect(socketFactory).toHaveBeenCalledWith('ws://192.168.1.20:8422/ws', expect.any(Object));
    expect(screen.getByText('Connecting · 0 frames')).toBeTruthy();

    if (!handlers) {
      throw new Error('Expected the socket factory to capture handlers');
    }

    const connected = handlers as SocketHandlers;

    await act(async () => connected.onOpen());
    await act(async () =>
      connected.onMessage(JSON.stringify({ type: 'authenticated', version: 1, sampleFormat: 'f32le' })),
    );
    await act(async () => connected.onMessage(stereoFrame()));
    await act(async () => {
      jest.advanceTimersByTime(100);
    });

    expect(screen.getByText('Frames received: 1')).toBeTruthy();
    expect(screen.getByText('Sample rate: 48000 Hz')).toBeTruthy();
    expect(screen.getByText('Channels: 2')).toBeTruthy();
    expect(screen.getByText(/0\s+0\.5\s+-0\.5/)).toBeTruthy();

    screen.unmount();
  });
});
