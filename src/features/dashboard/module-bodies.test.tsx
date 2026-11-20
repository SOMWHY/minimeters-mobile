import { render } from '@testing-library/react-native';
import type { CellRect, DashboardItem, ModuleKind } from '@minimetermobile/ui';
import { BUILT_IN_THEMES } from '@minimetermobile/ui/dist/theme';

import { ModuleBody } from './module-bodies';

// The real modules draw through Skia, whose ESM build jest cannot transform.
// This test is about the card wiring — which kinds get a cursor, and only when
// the dashboard is not being edited — so the modules become plain views.
jest.mock('@minimetermobile/ui', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View: RNView } = jest.requireActual<typeof import('react-native')>('react-native');
  const stub = (kind: string) => {
    function ModuleStub({ theme: _theme, ...props }: Record<string, unknown>) {
      return React.createElement(RNView, { ...props, testID: `module-${kind}` });
    }

    ModuleStub.displayName = `ModuleStub(${kind})`;

    return ModuleStub;
  };

  return {
    WaveformModule: stub('waveform'),
    OscilloscopeModule: stub('oscilloscope'),
    VectorscopeModule: stub('vectorscope'),
    SpectrumModule: stub('spectrum'),
    VuModule: stub('vu'),
    LoudnessModule: stub('loudness'),
    SpectrogramModule: stub('spectrogram'),
  };
});

jest.mock('expo-camera', () => ({}));

const theme = BUILT_IN_THEMES.midnight;
const rect: CellRect = { x: 0, y: 0, width: 200, height: 120 };
const analysis = {
  levels: [
    { peak: 0.5, rms: 0.25 },
    { peak: 0.5, rms: 0.25 },
  ],
  bins: new Float32Array(64),
  lufs: -20,
  momentaryLufs: -20,
  shortTermLufs: -20,
  peakDb: -6,
  displaySamples: new Float32Array(0),
} as never;

const history = [new Float32Array(64), new Float32Array(64)];

function item(kind: ModuleKind): DashboardItem {
  return {
    id: kind,
    kind,
    visible: true,
    placement: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
  };
}

async function renderCard(kind: ModuleKind, editing = false) {
  return render(
    <ModuleBody
      item={item(kind)}
      rect={rect}
      theme={theme}
      frame={null}
      analysis={analysis}
      history={history}
      scopeFrames={[]}
      editing={editing}
    />,
  );
}

describe('ModuleBody cursor wiring', () => {
  it.each(['waveform', 'spectrum', 'spectrogram'] as const)(
    'gives %s a double-tap cursor',
    async (kind) => {
      const screen = await renderCard(kind);

      expect(screen.getByTestId('crosshair-surface')).toBeTruthy();
      expect(screen.getByTestId(`module-${kind}`)).toBeTruthy();

      screen.unmount();
    },
  );

  it.each(['oscilloscope', 'vectorscope', 'vu', 'loudness'] as const)(
    'leaves %s without a cursor',
    async (kind) => {
      const screen = await renderCard(kind);

      // A plain View wrapper is still rendered, but no gesture surface.
      expect(screen.queryByTestId('crosshair-surface')).toBeNull();

      screen.unmount();
    },
  );

  it.each(['waveform', 'spectrum', 'spectrogram'] as const)(
    'drops the cursor on %s while editing',
    async (kind) => {
      const screen = await renderCard(kind, true);

      expect(screen.queryByTestId('crosshair-surface')).toBeNull();

      screen.unmount();
    },
  );
});
