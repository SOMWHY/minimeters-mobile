import { memo } from 'react';
import type { ReactElement } from 'react';
import {
  LoudnessModule,
  OscilloscopeModule,
  SpectrogramModule,
  SpectrumModule,
  VectorscopeModule,
  VuModule,
  WaveformModule,
  type CellRect,
  type DashboardItem,
  type PcmBlock,
  type VisualizationTheme,
} from '@minimetermobile/ui';

import type { FrameAnalysis } from '@/features/monitoring/analysis';
import type { PcmAudioFrame } from '@/features/monitoring/pcm-frame';

import { SPECTROGRAM_HISTORY_ROWS } from './history';
import { toScopeBlock } from './scope-block';
import {
  LOUDNESS_BAR_DB_RANGE,
  loudnessValues,
  SPECTRUM_DB_RANGE,
  vuLevels,
} from './module-values';

export type ModuleBodyProps = {
  readonly item: DashboardItem;
  readonly rect: CellRect;
  readonly theme: VisualizationTheme;
  readonly frame: PcmAudioFrame | null;
  /** `null` until the first frame arrives, so modules show their waiting state. */
  readonly analysis: FrameAnalysis | null;
  readonly history: readonly Float32Array[];
  /** Recent auto-gained blocks, oldest first — the waveform's picture of the past. */
  readonly scopeFrames: readonly PcmBlock[];
};

/**
 * One dashboard card's content.
 *
 * Every module gets the measured cell height so the plot fills the card the user
 * resized; nothing here computes layout. Missing data is passed through as
 * `null` rather than zeros, so the library renders `waiting` instead of a flat
 * line that looks like real silence.
 */
function ModuleBodyBase({
  item,
  rect,
  theme,
  frame,
  analysis,
  history,
  scopeFrames,
}: ModuleBodyProps): ReactElement {
  const height = rect.height;
  const block = toScopeBlock(frame, analysis);

  switch (item.kind) {
    case 'waveform':
      return (
        <WaveformModule
          theme={theme}
          frames={scopeFrames.length > 0 ? scopeFrames : null}
          block={block}
          height={height}
        />
      );
    case 'oscilloscope':
      return <OscilloscopeModule theme={theme} block={block} height={height} />;
    case 'vectorscope':
      return <VectorscopeModule theme={theme} block={block} height={height} />;
    case 'spectrum':
      return (
        <SpectrumModule
          theme={theme}
          bins={analysis?.bins ?? null}
          dbRange={SPECTRUM_DB_RANGE}
          height={height}
        />
      );
    case 'vu':
      return <VuModule theme={theme} data={analysis ? vuLevels(analysis) : null} height={height} />;
    case 'loudness':
      return (
        <LoudnessModule
          theme={theme}
          data={analysis ? loudnessValues(analysis) : null}
          dbRange={LOUDNESS_BAR_DB_RANGE}
          height={height}
        />
      );
    case 'spectrogram':
      return (
        <SpectrogramModule
          theme={theme}
          rows={history.length > 0 ? history : null}
          maxRows={SPECTROGRAM_HISTORY_ROWS}
          height={height}
        />
      );
  }
}

/**
 * Memoised so a 10 Hz frame stream does not re-render every module for changes
 * that only concern the grid — entering edit mode, or a drag preview.
 */
export const ModuleBody = memo(ModuleBodyBase);
