import { Platform, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import * as NavigationBar from 'expo-navigation-bar';

import { useFullscreen } from './use-fullscreen';

jest.mock('expo-navigation-bar', () => ({
  setVisibilityAsync: jest.fn(async () => undefined),
}));

const setVisibilityAsync = NavigationBar.setVisibilityAsync as unknown as jest.Mock;

function Harness({ enabled }: { readonly enabled: boolean }) {
  useFullscreen(enabled);

  return <Text>harness</Text>;
}

describe('useFullscreen', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    setVisibilityAsync.mockClear();
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  });

  it('hides the navigation bar when enabled and restores it on unmount', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    const view = await render(<Harness enabled />);

    expect(setVisibilityAsync).toHaveBeenCalledWith('hidden');

    await view.unmount();

    // Unmounting must hand the bars back — the screen can go away while enabled.
    expect(setVisibilityAsync).toHaveBeenLastCalledWith('visible');
  });

  it('shows the bar when disabled', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    await render(<Harness enabled={false} />);

    expect(setVisibilityAsync).toHaveBeenCalledWith('visible');
  });

  it('restores the bars when the toggle is switched off', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    const view = await render(<Harness enabled />);

    await view.rerender(<Harness enabled={false} />);

    expect(setVisibilityAsync).toHaveBeenLastCalledWith('visible');
  });

  it('does nothing off Android', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });

    const view = await render(<Harness enabled />);

    await view.rerender(<Harness enabled={false} />);
    await view.unmount();

    // iOS has no navigation-bar API; touching it would throw on a real device.
    expect(setVisibilityAsync).not.toHaveBeenCalled();
  });

  it('swallows a rejected platform call', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    setVisibilityAsync.mockRejectedValueOnce(new Error('OEM build'));

    await expect(render(<Harness enabled />)).resolves.toBeDefined();
    // Let the rejection settle so a missing `.catch` would surface as an
    // unhandled rejection in the test run.
    await Promise.resolve();
  });
});
