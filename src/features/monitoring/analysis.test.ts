import {
  ANALYSIS_BIN_COUNT,
  ANALYSIS_FLOOR_DB,
  analyseFrame,
  silentAnalysis,
} from './analysis';
import type { PcmAudioFrame } from './pcm-frame';

function frameOf({
  amplitude = 0.5,
  channels = 2,
  cycles = 21,
  sampleRate = 48000,
  samplesPerChannel = 1024,
  sine = true,
}: {
  amplitude?: number;
  channels?: number;
  cycles?: number;
  sampleRate?: number;
  samplesPerChannel?: number;
  sine?: boolean;
} = {}): PcmAudioFrame {
  const samples = new Float32Array(samplesPerChannel * channels);

  for (let index = 0; index < samplesPerChannel; index += 1) {
    const value = sine
      ? amplitude * Math.cos((2 * Math.PI * cycles * index) / samplesPerChannel)
      : amplitude;

    for (let channel = 0; channel < channels; channel += 1) {
      samples[index * channels + channel] = channel === 0 ? value : -value;
    }
  }

  return {
    channels,
    sampleRate,
    samples,
    samplesPerChannel,
    timestampMs: 0,
  };
}

function argmax(values: ArrayLike<number>): number {
  let best = 0;

  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[best]) {
      best = index;
    }
  }

  return best;
}

describe('analyseFrame', () => {
  it('measures levels for a steady tone', () => {
    const analysis = analyseFrame(frameOf({ amplitude: 0.5, sine: false }));

    expect(analysis.peak).toBeCloseTo(0.5, 5);
    expect(analysis.rms).toBeCloseTo(0.5, 5);
    expect(analysis.lufs).toBeCloseTo(20 * Math.log10(0.5), 5);
    expect(analysis.levels).toHaveLength(2);
    expect(analysis.levels[0].peak).toBeCloseTo(0.5, 5);
  });

  it('reports RMS for a sine at -6 dBFS', () => {
    const analysis = analyseFrame(frameOf({ amplitude: 0.5 }));

    expect(analysis.peak).toBeCloseTo(0.5, 3);
    expect(analysis.rms).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it('de-interleaves stereo without mixing the channels', () => {
    const samples = new Float32Array([0.1, -0.2, 0.3, -0.4]);
    const analysis = analyseFrame({
      channels: 2,
      sampleRate: 48000,
      samples,
      samplesPerChannel: 2,
      timestampMs: 1,
    });

    expect(Array.from(analysis.left)).toEqual([expect.closeTo(0.1, 6), expect.closeTo(0.3, 6)]);
    expect(Array.from(analysis.right)).toEqual([expect.closeTo(-0.2, 6), expect.closeTo(-0.4, 6)]);
    expect(analysis.levels[0].peak).toBeCloseTo(0.3, 6);
    expect(analysis.levels[1].peak).toBeCloseTo(0.4, 6);
    expect(analysis.peak).toBeCloseTo(0.4, 6);
  });

  it('duplicates a mono frame to both scopes', () => {
    const analysis = analyseFrame(frameOf({ channels: 1 }));

    expect(analysis.levels).toHaveLength(1);
    expect(Array.from(analysis.left)).toEqual(Array.from(analysis.right));
  });

  it('produces one display bin per requested bin count', () => {
    const analysis = analyseFrame(frameOf());

    expect(analysis.bins).toHaveLength(ANALYSIS_BIN_COUNT);
    expect(analysis.spectrogramRow).toHaveLength(ANALYSIS_BIN_COUNT);
    expect(Array.from(analysis.spectrogramRow).every((value) => value >= 0 && value <= 1)).toBe(true);
  });

  it('places a higher tone in a higher bin', () => {
    const low = analyseFrame(frameOf({ cycles: 10 }));
    const high = analyseFrame(frameOf({ cycles: 80 }));

    expect(argmax(high.bins)).toBeGreaterThan(argmax(low.bins));
    expect(Math.max(...high.bins)).toBeGreaterThan(ANALYSIS_FLOOR_DB + 20);
  });

  it('keeps the spectrogram row in step with the bins', () => {
    const analysis = analyseFrame(frameOf({ cycles: 40 }));

    expect(argmax(analysis.spectrogramRow)).toBe(argmax(analysis.bins));
    expect(Math.max(...analysis.spectrogramRow)).toBeGreaterThan(0.5);
  });

  it('does not mutate the incoming frame', () => {
    const frame = frameOf();
    const before = Array.from(frame.samples);

    analyseFrame(frame);

    expect(Array.from(frame.samples)).toEqual(before);
  });

  it('handles frames shorter than the FFT window', () => {
    const analysis = analyseFrame(frameOf({ samplesPerChannel: 64, sine: false }));

    expect(analysis.peak).toBeCloseTo(0.5, 5);
    expect(analysis.bins).toHaveLength(ANALYSIS_BIN_COUNT);
  });
});

describe('silentAnalysis', () => {
  it('sits on the floor with no signal', () => {
    const analysis = silentAnalysis();

    expect(analysis.peak).toBe(0);
    expect(analysis.rms).toBe(0);
    expect(analysis.lufs).toBe(ANALYSIS_FLOOR_DB);
    expect(Array.from(analysis.bins).every((value) => value === ANALYSIS_FLOOR_DB)).toBe(true);
    expect(Array.from(analysis.spectrogramRow).every((value) => value === 0)).toBe(true);
  });

  it('reports digital silence from a real frame the same way', () => {
    const analysis = analyseFrame(frameOf({ amplitude: 0, sine: false }));

    expect(analysis.lufs).toBe(ANALYSIS_FLOOR_DB);
    expect(analysis.peak).toBe(0);
  });
});
