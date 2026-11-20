import { ANALYSIS_BIN_COUNT, ANALYSIS_FLOOR_DB } from './analysis';
import { createAnalysisEngine } from './engine';
import { LOUDNESS_GATE_LUFS } from './loudness';
import type { PcmAudioFrame } from './pcm-frame';

function frameOf({
  amplitude = 0.5,
  channels = 2,
  cycles = 21,
  sampleRate = 48000,
  samplesPerChannel = 1024,
}: {
  amplitude?: number;
  channels?: number;
  cycles?: number;
  sampleRate?: number;
  samplesPerChannel?: number;
} = {}): PcmAudioFrame {
  const samples = new Float32Array(samplesPerChannel * channels);

  for (let index = 0; index < samplesPerChannel; index += 1) {
    const value = amplitude * Math.cos((2 * Math.PI * cycles * index) / samplesPerChannel);

    for (let channel = 0; channel < channels; channel += 1) {
      samples[index * channels + channel] = value;
    }
  }

  return { channels, sampleRate, samples, samplesPerChannel, timestampMs: 0 };
}

describe('createAnalysisEngine', () => {
  it('fills the spectrum and spectrogram rows for a live frame', () => {
    const engine = createAnalysisEngine();
    const analysis = engine.push(frameOf());

    expect(analysis.bins).toHaveLength(ANALYSIS_BIN_COUNT);
    expect(analysis.spectrogramRow).toHaveLength(ANALYSIS_BIN_COUNT);
    expect(Math.max(...analysis.bins)).toBeGreaterThan(ANALYSIS_FLOOR_DB + 20);
  });

  it('reports K-weighted loudness, not raw RMS', () => {
    const engine = createAnalysisEngine();
    let analysis = engine.push(frameOf());

    for (let index = 0; index < 40; index += 1) {
      analysis = engine.push(frameOf());
    }

    expect(analysis.lufs).toBeGreaterThan(LOUDNESS_GATE_LUFS);
    expect(analysis.lufs).toBeLessThan(0);
  });

  it('starts at the loudness gate before any signal', () => {
    const engine = createAnalysisEngine();

    expect(engine.push(frameOf({ amplitude: 0 })).lufs).toBe(LOUDNESS_GATE_LUFS);
  });

  it('adds two real channels (+3 dB), not a duplicated mono track (+6 dB)', () => {
    const mono = createAnalysisEngine();
    const stereo = createAnalysisEngine();

    let monoAnalysis = mono.push(frameOf({ channels: 1 }));
    let stereoAnalysis = stereo.push(frameOf({ channels: 2 }));

    for (let index = 0; index < 40; index += 1) {
      monoAnalysis = mono.push(frameOf({ channels: 1 }));
      stereoAnalysis = stereo.push(frameOf({ channels: 2 }));
    }

    // Two identical channels carry twice the power: +3.01 dB. Feeding a mono
    // frame to the meter twice would show +6 dB, which is the bug this guards.
    expect(stereoAnalysis.lufs - monoAnalysis.lufs).toBeCloseTo(3.01, 0);
  });

  it('smooths the VU reading instead of echoing the raw frame', () => {
    const engine = createAnalysisEngine();
    let analysis = engine.push(frameOf({ amplitude: 0.9 }));

    for (let index = 0; index < 30; index += 1) {
      analysis = engine.push(frameOf({ amplitude: 0.9 }));
    }

    const loudBar = analysis.levels[0].rms;
    analysis = engine.push(frameOf({ amplitude: 0 }));

    // One silent frame must not slam the bar to zero.
    expect(analysis.levels[0].rms).toBeGreaterThan(loudBar * 0.5);
  });

  it('keeps the scope buffers raw, so the waveform keeps its shape', () => {
    const engine = createAnalysisEngine();
    const frame = frameOf();
    const analysis = engine.push(frame);

    expect(analysis.left).toHaveLength(frame.samplesPerChannel);
    expect(analysis.left[0]).toBeCloseTo(frame.samples[0], 6);
  });

  it('lifts the scope trace without touching the meters', () => {
    const engine = createAnalysisEngine();
    let analysis = engine.push(frameOf({ amplitude: 0.1 }));

    for (let index = 0; index < 200; index += 1) {
      analysis = engine.push(frameOf({ amplitude: 0.1 }));
    }

    const displayPeak = Math.max(...analysis.displaySamples.map(Math.abs));
    const rawPeak = analysis.levels[0].peak;

    // -20 dBFS drawn at 10% height is the complaint this fixes: at the +12 dB
    // ceiling it now covers ~40% of the card.
    expect(rawPeak).toBeLessThan(0.15);
    expect(displayPeak).toBeGreaterThan(0.3);
    expect(displayPeak).toBeLessThanOrEqual(1);

    // Metering is unchanged by the display gain.
    expect(analysis.levels[0].peak).toBeCloseTo(0.1, 3);
    expect(analysis.lufs).toBeLessThan(-10);
  });

  it('restarts its meters when the sample rate changes', () => {
    const engine = createAnalysisEngine();

    for (let index = 0; index < 40; index += 1) {
      engine.push(frameOf({ sampleRate: 48000 }));
    }

    const analysis = engine.push(frameOf({ sampleRate: 44100, amplitude: 0 }));

    expect(analysis.lufs).toBe(LOUDNESS_GATE_LUFS);
    expect(Number.isFinite(analysis.levels[0].rms)).toBe(true);
  });

  it('forgets everything on reset', () => {
    const engine = createAnalysisEngine();

    for (let index = 0; index < 40; index += 1) {
      engine.push(frameOf());
    }

    engine.reset();
    const analysis = engine.push(frameOf({ amplitude: 0 }));

    expect(analysis.lufs).toBe(LOUDNESS_GATE_LUFS);
  });
});
