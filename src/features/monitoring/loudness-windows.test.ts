import {
  ANALYSIS_BIN_COUNT,
  ANALYSIS_FLOOR_DB,
  silentAnalysis,
  type FrameAnalysis,
} from './analysis';
import {
  createLoudnessMeter,
  INTEGRATED_RESET_SILENCE_MS,
  LOUDNESS_GATE_LUFS,
  MOMENTARY_WINDOW_MS,
  SHORT_TERM_WINDOW_MS,
} from './loudness';
import type { PcmAudioFrame } from './pcm-frame';

function sineFrame(amplitude: number, samplesPerChannel = 480, sampleRate = 48000): PcmAudioFrame {
  const samples = new Float32Array(samplesPerChannel);

  for (let index = 0; index < samplesPerChannel; index += 1) {
    samples[index] = amplitude * Math.sin((2 * Math.PI * 1000 * index) / sampleRate);
  }

  return { channels: 1, sampleRate, samples, samplesPerChannel, timestampMs: 0 };
}

function feed(
  meter: ReturnType<typeof createLoudnessMeter>,
  amplitude: number,
  durationMs: number,
  frameMs = 10,
): void {
  const frames = Math.ceil(durationMs / frameMs);

  for (let index = 0; index < frames; index += 1) {
    const frame = sineFrame(amplitude);
    meter.push([frame.samples]);
  }
}

describe('loudness windows', () => {
  it('keeps momentary at 400 ms and short-term at 3 s', () => {
    expect(MOMENTARY_WINDOW_MS).toBe(400);
    expect(SHORT_TERM_WINDOW_MS).toBe(3000);
  });

  it('drops momentary back to the gate after 400 ms of silence but keeps short-term alive', () => {
    const meter = createLoudnessMeter(48000);

    feed(meter, 0.5, 1000);

    expect(meter.value()).toBeGreaterThan(LOUDNESS_GATE_LUFS);

    feed(meter, 0, 600);

    expect(meter.value()).toBe(LOUDNESS_GATE_LUFS);
    expect(meter.shortTerm()).toBeGreaterThan(LOUDNESS_GATE_LUFS);
  });

  it('lets short-term fall away once the 3 s window empties', () => {
    const meter = createLoudnessMeter(48000);

    feed(meter, 0.5, 1000);
    feed(meter, 0, SHORT_TERM_WINDOW_MS + 500);

    expect(meter.shortTerm()).toBe(LOUDNESS_GATE_LUFS);
  });

  it('reports integrated loudness that survives a silent passage', () => {
    const meter = createLoudnessMeter(48000);

    feed(meter, 0.5, 1500);
    feed(meter, 0, 1500);

    expect(meter.value()).toBe(LOUDNESS_GATE_LUFS);
    expect(meter.integrated()).toBeGreaterThan(LOUDNESS_GATE_LUFS);
  });

  it('holds integrated loudness steady as the programme continues', () => {
    const meter = createLoudnessMeter(48000);

    feed(meter, 0.5, 2000);
    const early = meter.integrated();

    feed(meter, 0.5, 6000);

    expect(early).toBeGreaterThan(LOUDNESS_GATE_LUFS);
    expect(Math.abs(meter.integrated() - early)).toBeLessThan(0.5);
  });

  it('drops a quiet passage through the relative gate', () => {
    const loudOnly = createLoudnessMeter(48000);
    const withQuiet = createLoudnessMeter(48000);

    feed(loudOnly, 0.5, 6000);

    feed(withQuiet, 0.5, 3000);
    feed(withQuiet, 0.005, 3000);

    // -40 dB below the main programme is more than 10 LU down, so the gated
    // integrated value must stay close to the loud-only reading.
    expect(Math.abs(withQuiet.integrated() - loudOnly.integrated())).toBeLessThan(1);
  });

  it('reaches the gate when the whole programme is silent', () => {
    const meter = createLoudnessMeter(48000);

    feed(meter, 0, 2000);

    expect(meter.integrated()).toBe(LOUDNESS_GATE_LUFS);
  });

  it('clears the block history on reset', () => {
    const meter = createLoudnessMeter(48000);

    feed(meter, 0.5, 2000);
    meter.reset();

    expect(meter.integrated()).toBe(LOUDNESS_GATE_LUFS);
    expect(meter.shortTerm()).toBe(LOUDNESS_GATE_LUFS);
  });

  it('ignores empty channel lists without corrupting the blocks', () => {
    const meter = createLoudnessMeter(48000);

    feed(meter, 0.5, 1000);
    meter.push([]);
    meter.push([new Float32Array(0)]);

    expect(meter.integrated()).toBeGreaterThan(LOUDNESS_GATE_LUFS);
  });

  it('holds the integrated average through a short gap, then starts over', () => {
    const meter = createLoudnessMeter(48000);

    feed(meter, 0.5, 6000);

    const measured = meter.integrated();

    expect(measured).toBeGreaterThan(LOUDNESS_GATE_LUFS);

    // A programme average must survive a breath, a mute between takes, or the
    // tail of a fade — it only starts over once the input is truly quiet.
    feed(meter, 0, INTEGRATED_RESET_SILENCE_MS - 1000);
    expect(meter.integrated()).toBeCloseTo(measured, 5);

    feed(meter, 0, 2000);
    expect(meter.integrated()).toBe(LOUDNESS_GATE_LUFS);
  });

  it('keeps momentary live so a muted input falls to the gate at once', () => {
    const meter = createLoudnessMeter(48000);

    feed(meter, 0.5, 6000);
    expect(meter.value()).toBeGreaterThan(LOUDNESS_GATE_LUFS);

    feed(meter, 0, MOMENTARY_WINDOW_MS + 100);

    expect(meter.value()).toBe(LOUDNESS_GATE_LUFS);
    // Integrated deliberately lags: it describes the whole programme.
    expect(meter.integrated()).toBeGreaterThan(LOUDNESS_GATE_LUFS);
  });
});

describe('analysis placeholders', () => {
  it('starts every loudness field at the gate', () => {
    const analysis: FrameAnalysis = silentAnalysis();

    expect(analysis.lufs).toBe(LOUDNESS_GATE_LUFS);
    expect(analysis.momentaryLufs).toBe(LOUDNESS_GATE_LUFS);
    expect(analysis.shortTermLufs).toBe(LOUDNESS_GATE_LUFS);
    expect(analysis.bins).toHaveLength(ANALYSIS_BIN_COUNT);
    expect(analysis.spectrogramRow).toHaveLength(ANALYSIS_BIN_COUNT);
    expect(analysis.bins[0]).toBe(ANALYSIS_FLOOR_DB);
  });
});
