import { act, fireEvent, render } from '@testing-library/react-native';
import { PermissionStatus, useCameraPermissions } from 'expo-camera';

import { pcmPairing } from '@/features/connection/test-fixtures';
import type { SocketFactory, SocketHandlers } from '@/features/connection/pcm-socket-client';

import { PcmMonitorScreen } from './PcmMonitorScreen';

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

describe('PcmMonitorScreen', () => {
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

  it('scans, authenticates, and displays the latest raw PCM frame', async () => {
    let socketHandlers: SocketHandlers | null = null;
    const socketFactory: SocketFactory = jest.fn((_url, handlers) => {
      socketHandlers = handlers;
      return { send: jest.fn(), close: jest.fn() };
    });
    const screen = await render(<PcmMonitorScreen socketFactory={socketFactory} />);

    await fireEvent.press(screen.getByText('Scan plugin QR code'));
    await fireEvent(screen.getByTestId('camera-view'), 'barcodeScanned', {
      data: JSON.stringify(pcmPairing),
    });
    expect(socketFactory).toHaveBeenCalledWith(
      'ws://192.168.1.20:8422/ws',
      expect.any(Object),
    );
    expect(screen.getByText('Connection: Connecting')).toBeTruthy();

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

    expect(screen.getByText('Connection: Connected')).toBeTruthy();
    expect(screen.getByText('Frames received: 1')).toBeTruthy();
    expect(screen.getByText('Timestamp: 321 ms')).toBeTruthy();
    expect(screen.getByText('Sample rate: 48000 Hz')).toBeTruthy();
    expect(screen.getByText('Channels: 2')).toBeTruthy();
    expect(screen.getByText('Samples per channel: 1')).toBeTruthy();
    expect(screen.getByText(/0\s+0\.5\s+-0\.5/)).toBeTruthy();

    screen.unmount();
  });

  it('shows a recoverable error for an invalid pairing code', async () => {
    const screen = await render(<PcmMonitorScreen />);

    await fireEvent.press(screen.getByText('Scan plugin QR code'));
    await fireEvent(screen.getByTestId('camera-view'), 'barcodeScanned', {
      data: 'not a pairing code',
    });

    expect(screen.getByText('This is not a valid MiniMeters pairing code.')).toBeTruthy();
    expect(screen.getByTestId('camera-view')).toBeTruthy();

    screen.unmount();
  });
});
