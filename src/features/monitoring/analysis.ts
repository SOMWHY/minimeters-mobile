import type { PcmAudioFrame } from './pcm-frame';
import { fftMagnitudes, hannWindow } from './fft';
import { LOUDNESS_GATE_LUFS } from './loudness';

/** FFT window length; 1024 at 48 kHz is ~21 ms — one or two server frames. */
export const ANALYSIS_FFT_SIZE = 1024;

/** Bins the spectrum and spectrogram modules consume. */
export const ANALYSIS_BIN_COUNT = 64;

/** Floor for dB conversions, so silence maps to a finite floor instead of -Infinity. */
export const ANALYSIS_FLOOR_DB = -100;

export interface ChannelLevels {
  /** Linear peak magnitude, 0..1 for full scale. */
  readonly peak: number;
  /** Linear RMS magnitude, 0..1 for full scale. */
  readonly rms: number;
}

export interface FrameAnalysis {
  /** Linear peak across all channels. */
  readonly peak: number;
  /** Linear RMS across all channels. */
  readonly rms: number;
  /**
   * Integrated (programme) loudness in LUFS. `analyseFrame` can only offer
   * unweighted dBFS here; the engine replaces it with the gated K-weighted value.
   */
  readonly lufs: number;
  /** K-weighted momentary loudness, 400 ms window. */
  readonly momentaryLufs: number;
  /** K-weighted short-term loudness, 3 s window. */
  readonly shortTermLufs: number;
  /** Per-channel levels, one entry per channel in the incoming frame. */
  readonly levels: readonly ChannelLevels[];
  /** De-interleaved channels; mono frames are duplicated so both scopes draw. */
  readonly left: Float32Array;
  readonly right: Float32Array;
  /** Per-bin level in dBFS, low frequency first. */
  readonly bins: Float32Array;
  /** Same data normalised to 0..1 over the display range, for the spectrogram. */
  readonly spectrogramRow: Float32Array;
  /**
   * Interleaved samples with the *display* gain applied, for the scopes only.
   * `analyseFrame` leaves this identical to `samples`; the engine replaces it
   * with an auto-gained copy so a quiet trace still fills its card. Metering
   * (levels, LUFS, bins) always reads the untouched samples.
   */
  readonly displaySamples: Float32Array;
}

const HANN = hannWindow(ANALYSIS_FFT_SIZE);

function toDb(linear: number): number {
  if (!(linear > 0)) {
    return ANALYSIS_FLOOR_DB;
  }

  return Math.max(ANALYSIS_FLOOR_DB, 20 * Math.log10(linear));
}

function deinterleave(frame: PcmAudioFrame): { left: Float32Array; right: Float32Array } {
  const { samples, channels, samplesPerChannel } = frame;

  if (channels < 2) {
    const mono = samples.slice(0, samplesPerChannel);
    return { left: mono, right: mono.slice() };
  }

  const left = new Float32Array(samplesPerChannel);
  const right = new Float32Array(samplesPerChannel);

  for (let index = 0; index < samplesPerChannel; index += 1) {
    left[index] = samples[index * 2];
    right[index] = samples[index * 2 + 1];
  }

  return { left, right };
}

function levelsOf(samples: Float32Array): ChannelLevels {
  let peak = 0;
  let sumSquares = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    const magnitude = Math.abs(value);

    if (magnitude > peak) {
      peak = magnitude;
    }

    sumSquares += value * value;
  }

  return { peak, rms: samples.length > 0 ? Math.sqrt(sumSquares / samples.length) : 0 };
}

/** Log-spaced bin edges: audio interest is clustered in the low end. */
function binEdges(fftBins: number): number[] {
  const edges: number[] = [];

  for (let index = 0; index <= ANALYSIS_BIN_COUNT; index += 1) {
    const ratio = index / ANALYSIS_BIN_COUNT;
    const edge = Math.floor(Math.pow(fftBins, ratio));

    edges.push(Math.min(fftBins - 1, Math.max(edge, index === 0 ? 0 : edges[index - 1])));
  }

  // Guarantee strictly increasing edges so every display bin owns a slice.
  for (let index = 1; index <= ANALYSIS_BIN_COUNT; index += 1) {
    if (edges[index] <= edges[index - 1]) {
      edges[index] = Math.min(fftBins - 1, edges[index - 1] + 1);
    }
  }

  return edges;
}

const FFT_BINS = ANALYSIS_FFT_SIZE >> 1;
const EDGES = binEdges(FFT_BINS);

/** Map one channel's tail onto the display bins, max-pooled so tones never vanish. */
function spectrumOf(samples: Float32Array): Float64Array {
  const windowed = new Float32Array(ANALYSIS_FFT_SIZE);
  const start = Math.max(0, samples.length - ANALYSIS_FFT_SIZE);

  for (let index = 0; index < ANALYSIS_FFT_SIZE; index += 1) {
    const source = start + index;
    windowed[index] = source < samples.length ? samples[source] * HANN[index] : 0;
  }

  const magnitudes = fftMagnitudes(windowed, ANALYSIS_FFT_SIZE);
  const bins = new Float64Array(ANALYSIS_BIN_COUNT);

  for (let bin = 0; bin < ANALYSIS_BIN_COUNT; bin += 1) {
    let peak = 0;

    for (let source = EDGES[bin]; source <= EDGES[bin + 1]; source += 1) {
      if (magnitudes[source] > peak) {
        peak = magnitudes[source];
      }
    }

    // Hann removes half the energy of a steady tone; ×2 keeps a sine near 0 dBFS.
    bins[bin] = toDb(peak * 2);
  }

  return bins;
}

/**
 * Combine channels by taking the louder one per bin.
 *
 * Averaging the waveforms first would cancel anything panned in anti-phase — a
 * real stereo test signal — so the channels are transformed separately.
 */
function combineSpectra(channels: readonly Float32Array[]): { bins: Float32Array; spectrogramRow: Float32Array } {
  const spectra = channels.map(spectrumOf);
  const bins = new Float32Array(ANALYSIS_BIN_COUNT);
  const spectrogramRow = new Float32Array(ANALYSIS_BIN_COUNT);

  for (let bin = 0; bin < ANALYSIS_BIN_COUNT; bin += 1) {
    let loudest = ANALYSIS_FLOOR_DB;

    for (const spectrum of spectra) {
      if (spectrum[bin] > loudest) {
        loudest = spectrum[bin];
      }
    }

    bins[bin] = loudest;
    spectrogramRow[bin] = Math.min(1, Math.max(0, (loudest - ANALYSIS_FLOOR_DB) / -ANALYSIS_FLOOR_DB));
  }

  return { bins, spectrogramRow };
}

/** Analyse one decoded frame. Pure: no caching, no mutation of the frame. */
export function analyseFrame(frame: PcmAudioFrame): FrameAnalysis {
  const { left, right } = deinterleave(frame);
  const leftLevels = levelsOf(left);
  const rightLevels = levelsOf(right);
  const hasTwoChannels = frame.channels >= 2;
  const levels = hasTwoChannels ? [leftLevels, rightLevels] : [leftLevels];

  const peak = Math.max(...levels.map((entry) => entry.peak));
  const rms = Math.sqrt(
    levels.reduce((total, entry) => total + entry.rms * entry.rms, 0) / levels.length,
  );

  // One spectrum per channel, combined by loudest bin: a hard-panned or
  // anti-phase tone stays visible instead of cancelling out.
  const { bins, spectrogramRow } = combineSpectra(hasTwoChannels ? [left, right] : [left]);

  // Loudness never reads below the gate: -100 dBFS would be "quieter than
  // silence" for a value the UI presents as LUFS.
  const lufs = Math.max(LOUDNESS_GATE_LUFS, toDb(rms));

  return {
    peak,
    rms,
    lufs,
    momentaryLufs: lufs,
    shortTermLufs: lufs,
    levels,
    left,
    right,
    bins,
    spectrogramRow,
    // The engine overwrites this with the auto-gained copy; on its own the
    // analysis has no cross-frame state, so the trace is shown as recorded.
    displaySamples: frame.samples,
  };
}

const SILENT_BINS = (() => {
  const bins = new Float32Array(ANALYSIS_BIN_COUNT);
  bins.fill(ANALYSIS_FLOOR_DB);
  return bins;
})();

/** Stable empty analysis, so a disconnected screen does not recompute every render. */
export function silentAnalysis(): FrameAnalysis {
  return {
    peak: 0,
    rms: 0,
    lufs: LOUDNESS_GATE_LUFS,
    momentaryLufs: LOUDNESS_GATE_LUFS,
    shortTermLufs: LOUDNESS_GATE_LUFS,
    levels: [{ peak: 0, rms: 0 }],
    left: new Float32Array(0),
    right: new Float32Array(0),
    bins: SILENT_BINS,
    spectrogramRow: new Float32Array(ANALYSIS_BIN_COUNT),
    displaySamples: new Float32Array(0),
  };
}
