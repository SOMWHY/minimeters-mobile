import { fireEvent, render } from '@testing-library/react-native';
import { BUILT_IN_THEMES } from '@minimetermobile/ui/dist/theme';

import { Crosshair } from './Crosshair';

const theme = BUILT_IN_THEMES.midnight;

/**
 * RN's PanResponder reads RN's touch bookkeeping to build its gesture state, so
 * a synthetic move has to look like one finger travelling across the surface.
 */
function touchHistoryAt(x: number, y: number, time: number) {
  return {
    touchBank: [
      {
        touchActive: true,
        startPageX: 0,
        startPageY: 0,
        startTimeStamp: 0,
        currentPageX: x,
        currentPageY: y,
        currentTimeStamp: time,
        previousPageX: 0,
        previousPageY: 0,
        previousTimeStamp: 0,
      },
    ],
    numberActiveTouches: 1,
    indexOfSingleActiveTouch: 0,
    mostRecentTimeStamp: time,
  };
}

async function events(
  surface: { props: unknown },
  type: 'grant' | 'move' | 'release',
  { x, y, time }: { x: number; y: number; time: number },
) {
  await fireEvent(surface as never, `responder${type[0].toUpperCase()}${type.slice(1)}`, {
    nativeEvent: { locationX: x, locationY: y, timestamp: time },
    touchHistory: touchHistoryAt(x, y, time),
  });
}

async function tap(
  surface: Parameters<typeof events>[0],
  point: { x: number; y: number; time: number },
) {
  await events(surface, 'grant', point);
  await events(surface, 'release', point);
}

describe('Crosshair', () => {
  async function renderCursor(
    props: Partial<Parameters<typeof Crosshair>[0] & object> = {},
  ) {
    const screen = await render(
      <Crosshair
        kind="spectrum"
        theme={theme}
        readout={(point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`}
        {...props}
      />,
    );
    const surface = screen.getByTestId('crosshair-surface');

    // The overlay needs a measured size before it can place a cursor.
    await fireEvent(surface, 'layout', {
      nativeEvent: { layout: { width: 200, height: 100, x: 0, y: 0 } },
    });

    return { screen, surface };
  }

  it('appears on a double tap and reports the point under it', async () => {
    const { screen, surface } = await renderCursor();

    expect(screen.queryByTestId('crosshair-readout')).toBeNull();

    await tap(surface, { x: 50, y: 25, time: 1_000 });
    expect(screen.queryByTestId('crosshair-readout')).toBeNull(); // one tap is not enough

    await tap(surface, { x: 50, y: 25, time: 1_100 });

    expect(screen.getByTestId('crosshair-readout')).toHaveTextContent('0.25,0.25');
    expect(screen.getByTestId('crosshair-vertical')).toBeTruthy();
    // A spectrum shows both axes.
    expect(screen.getByTestId('crosshair-horizontal')).toBeTruthy();

    screen.unmount();
  });

  it('disappears on the next double tap', async () => {
    const { screen, surface } = await renderCursor();

    await tap(surface, { x: 50, y: 25, time: 1_000 });
    await tap(surface, { x: 50, y: 25, time: 1_100 });
    expect(screen.getByTestId('crosshair-readout')).toBeTruthy();

    await tap(surface, { x: 50, y: 25, time: 3_000 });
    await tap(surface, { x: 50, y: 25, time: 3_100 });

    expect(screen.queryByTestId('crosshair-readout')).toBeNull();

    screen.unmount();
  });

  it('follows a finger dragged while it is open', async () => {
    const { screen, surface } = await renderCursor();

    await tap(surface, { x: 50, y: 25, time: 1_000 });
    await tap(surface, { x: 50, y: 25, time: 1_100 });

    await events(surface, 'grant', { x: 50, y: 25, time: 2_000 });
    await events(surface, 'move', { x: 150, y: 75, time: 2_100 });

    expect(screen.getByTestId('crosshair-readout')).toHaveTextContent('0.75,0.75');

    // A long drag must not be mistaken for another double tap.
    await events(surface, 'release', { x: 150, y: 75, time: 2_200 });
    expect(screen.getByTestId('crosshair-readout')).toBeTruthy();

    screen.unmount();
  });

  it('draws only a vertical line for the waveform', async () => {
    const { screen, surface } = await renderCursor({ kind: 'waveform' });

    await tap(surface, { x: 50, y: 25, time: 1_000 });
    await tap(surface, { x: 50, y: 25, time: 1_100 });

    expect(screen.getByTestId('crosshair-vertical')).toBeTruthy();
    expect(screen.queryByTestId('crosshair-horizontal')).toBeNull();

    screen.unmount();
  });

  it('draws a horizontal frequency line on the spectrogram', async () => {
    const { screen, surface } = await renderCursor({ kind: 'spectrogram' });

    await tap(surface, { x: 50, y: 25, time: 1_000 });
    await tap(surface, { x: 50, y: 25, time: 1_100 });

    expect(screen.getByTestId('crosshair-horizontal')).toBeTruthy();
    expect(screen.getByTestId('crosshair-vertical')).toBeTruthy();

    screen.unmount();
  });

  it('shows nothing when there is nothing to report', async () => {
    const { screen, surface } = await renderCursor({ readout: () => null });

    await tap(surface, { x: 50, y: 25, time: 1_000 });
    await tap(surface, { x: 50, y: 25, time: 1_100 });

    expect(screen.queryByTestId('crosshair-readout')).toBeNull();
    expect(screen.getByTestId('crosshair-vertical')).toBeTruthy();

    screen.unmount();
  });
});
