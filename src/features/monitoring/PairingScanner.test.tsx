import { fireEvent, render } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { PairingScanner, supportsQrScanning } from './PairingScanner';
import { PermissionStatus, useCameraPermissions } from 'expo-camera';

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

describe('PairingScanner', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('only enables QR scanning on native platforms', () => {
    expect(supportsQrScanning('ios')).toBe(true);
    expect(supportsQrScanning('android')).toBe(true);
    expect(supportsQrScanning('web')).toBe(false);
    expect(supportsQrScanning('windows')).toBe(false);
  });

  it('asks for permission before rendering the camera', async () => {
    const requestPermission = jest.fn();
    mockUseCameraPermissions.mockReturnValue([
      {
        granted: false,
        canAskAgain: true,
        expires: 'never',
        status: PermissionStatus.DENIED,
      },
      requestPermission,
      jest.fn(),
    ]);

    const screen = await render(<PairingScanner active onQrScanned={jest.fn()} />);
    expect(screen.queryByTestId('camera-view')).toBeNull();
    await fireEvent.press(screen.getByText('Allow camera access'));
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it('shows the QR-only camera after permission is granted and accepts one scan at a time', async () => {
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
    const onQrScanned = jest.fn();
    const screen = await render(<PairingScanner active onQrScanned={onQrScanned} />);

    const camera = screen.getByTestId('camera-view');
    expect(camera.props.barcodeScannerSettings).toEqual({ barcodeTypes: ['qr'] });

    await fireEvent(camera, 'barcodeScanned', { data: '{"token":"pairing"}' });
    await fireEvent(camera, 'barcodeScanned', { data: '{"token":"pairing"}' });
    expect(onQrScanned).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1000);
    await fireEvent(camera, 'barcodeScanned', { data: '{"token":"pairing"}' });
    expect(onQrScanned).toHaveBeenCalledTimes(2);
  });

  it('renders an unsupported message on web without mounting a camera', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
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

    const screen = await render(<PairingScanner active onQrScanned={jest.fn()} />);
    expect(screen.getByText(/physical iOS or Android device/)).toBeTruthy();
    expect(screen.queryByTestId('camera-view')).toBeNull();
  });
});
