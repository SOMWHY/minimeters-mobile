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
import { ANALYSIS_FLOOR_DB } from '@/features/monitoring/analysis';
import type { PcmAudioFrame } from '@/features/monitoring/pcm-frame';

import { SPECTROGRAM_HISTORY_ROWS } from './history';

const DB_RANGE = [ANALYSIS_FLOOR_DB, 0] as const;

function toBlock(frame: PcmAudioFrame | null): PcmBlock | null {
  if (!frame) {
    return null;
  }

  return {
    samples: frame.samples,
    channels: frame.channels,
    samplesPerChannel: frame.samplesPerChannel,
  };
}

function toDb(linear: number): number {
  return linear > 0 ? Math.max(ANALYSIS_FLOOR_DB, 20 * Math.log10(linear)) : ANALYSIS_FLOOR_DB;
}

/** VU bars are normalized 0..1: RMS drives the bar, peak drives the marker. */
function vuLevels(analysis: FrameAnalysis) {
  const left = analysis.levels[0] ?? { peak: 0, rms: 0 };
  const right = analysis.levels[1] ?? left;

  return {
    left: Math.min(1, left.rms),
    right: Math.min(1, right.rms),
    leftPeak: Math.min(1, left.peak),
    rightPeak: Math.min(1, right.peak),
  };
}

function loudnessValues(analysis: FrameAnalysis) {
  return {
    peak: toDb(analysis.peak),
    rms: toDb(analysis.rms),
    lufs: analysis.lufs,
  };
}

export type ModuleBodyProps = {
  readonly item: DashboardItem;
  readonly rect: CellRect;
  readonly theme: VisualizationTheme;
  readonly frame: PcmAudioFrame | null;
  /** `null` until the first frame arrives, so modules show their waiting state. */
  readonly analysis: FrameAnalysis | null;
  readonly history: readonly Float32Array[];
};

/**
 * One dashboard card's content.
 *
 * Every module gets the measured cell height so the plot fills the card the user
 * resized; nothing here computes layout. Missing data is passed through as
 * `null` rather than zeros, so the library renders `waiting` instead of a flat
 * line that looks like real silence.
 */
export function ModuleBody({
  item,
  rect,
  theme,
  frame,
  analysis,
  history,
}: ModuleBodyProps): ReactElement {
  const height = rect.height;
  const block = toBlock(frame);

  switch (item.kind) {
    case 'waveform':
      return <WaveformModule theme={theme} block={block} height={height} />;
    case 'oscilloscope':
      return <OscilloscopeModule theme={theme} block={block} height={height} />;
    case 'vectorscope':
      return <VectorscopeModule theme={theme} block={block} height={height} />;
    case 'spectrum':
      return (
        <SpectrumModule
          theme={theme}
          bins={analysis?.bins ?? null}
          dbRange={DB_RANGE}
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
          dbRange={DB_RANGE}
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
