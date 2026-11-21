import { memo } from 'react';
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
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
import { STREAM_REFRESH_MS } from '@/features/monitoring/use-pcm-stream';

import { Crosshair } from './Crosshair';
import { SPECTROGRAM_HISTORY_ROWS } from './history';
import { toScopeBlock } from './scope-block';
import {
  formatDb,
  formatHz,
  formatNote,
  formatSeconds,
  spectrumReadout,
  spectrogramReadout,
  waveformReadout,
  WAVEFORM_COLUMNS,
  DEFAULT_SAMPLE_RATE,
} from './readout';
import {
  LOUDNESS_BAR_DB_RANGE,
  loudnessReadout,
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
  /**
   * Fast-lane analysis for the meters only: same shape, updated every poll while
   * `analysis` updates at half rate. Falls back to `analysis` when absent.
   */
  readonly meter?: FrameAnalysis | null;
  readonly history: readonly Float32Array[];
  /** Recent auto-gained blocks, oldest first — the waveform's picture of the past. */
  readonly scopeFrames: readonly PcmBlock[];
  /**
   * Edit mode suppresses the double-tap cursor: the card's hold-then-drag owns
   * touch there.
   */
  readonly editing?: boolean;
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
  meter: meterProp,
  history,
  scopeFrames,
  editing = false,
}: ModuleBodyProps): ReactElement {
  const height = rect.height;
  // Meters read the fast lane and fall back to the scope rate when the caller
  // does not split them (stories, tests).
  const meter = meterProp ?? analysis;
  const block = toScopeBlock(frame, analysis);
  const sampleRate = frame?.sampleRate ?? DEFAULT_SAMPLE_RATE;

  let content: ReactElement;
  let cursor: ReactElement | null = null;

  switch (item.kind) {
    case 'waveform':
      content = (
        <WaveformModule
          theme={theme}
          frames={scopeFrames.length > 0 ? scopeFrames : null}
          block={block}
          columns={WAVEFORM_COLUMNS}
          height={height}
        />
      );
      if (!editing) {
        cursor = (
          <Crosshair
            kind="waveform"
            theme={theme}
            readout={(point) => {
              const reading = waveformReadout({
                frames: scopeFrames,
                columns: WAVEFORM_COLUMNS,
                fraction: point.x,
              });

              return reading === null ? null : formatDb(reading.db);
            }}
          />
        );
      }
      break;
    case 'oscilloscope':
      content = <OscilloscopeModule theme={theme} block={block} height={height} />;
      break;
    case 'vectorscope':
      content = <VectorscopeModule theme={theme} block={block} height={height} />;
      break;
    case 'spectrum':
      content = (
        <SpectrumModule
          theme={theme}
          bins={analysis?.bins ?? null}
          dbRange={SPECTRUM_DB_RANGE}
          height={height}
        />
      );
      if (!editing) {
        cursor = (
          <Crosshair
            kind="spectrum"
            theme={theme}
            readout={(point) => {
              if (analysis === null) {
                return null;
              }

              const reading = spectrumReadout({
                bins: analysis.bins,
                fraction: point.x,
                sampleRate,
              });

              if (reading === null) {
                return null;
              }

              const note = reading.note === null ? null : formatNote(reading.note);

              return [formatDb(reading.db), formatHz(reading.hz), note]
                .filter((part): part is string => part !== null)
                .join(' | ');
            }}
          />
        );
      }
      break;
    case 'vu':
      content = (
        <VuModule
          theme={theme}
          data={meter ? vuLevels(meter) : null}
          readout={loudnessReadout(meter)}
          height={height}
        />
      );
      break;
    case 'loudness':
      content = (
        <LoudnessModule
          theme={theme}
          data={meter ? loudnessValues(meter) : null}
          dbRange={LOUDNESS_BAR_DB_RANGE}
          height={height}
        />
      );
      break;
    case 'spectrogram':
      content = (
        <SpectrogramModule
          theme={theme}
          rows={history.length > 0 ? history : null}
          maxRows={SPECTROGRAM_HISTORY_ROWS}
          height={height}
        />
      );
      if (!editing) {
        cursor = (
          <Crosshair
            kind="spectrogram"
            theme={theme}
            readout={(point) => {
              const reading = spectrogramReadout({
                rows: history,
                fractionX: point.x,
                fractionY: point.y,
                sampleRate,
                refreshMs: STREAM_REFRESH_MS,
              });

              if (reading === null) {
                return null;
              }

              const note = reading.note === null ? null : formatNote(reading.note);

              return [
                formatDb(reading.db),
                formatHz(reading.hz),
                note,
                formatSeconds(reading.secondsAgo),
              ]
                .filter((part): part is string => part !== null)
                .join(' | ');
            }}
          />
        );
      }
      break;
  }

  return (
    <View style={styles.body}>
      {content}
      {cursor}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
});

/**
 * Memoised so a 10 Hz frame stream does not re-render every module for changes
 * that only concern the grid — entering edit mode, or a drag preview.
 */
export const ModuleBody = memo(ModuleBodyBase);
