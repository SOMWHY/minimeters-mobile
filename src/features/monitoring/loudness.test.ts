import {
  createLoudnessMeter,
  kWeightingCoefficients,
  LOUDNESS_GATE_LUFS,
  MOMENTARY_WINDOW_MS,
} from './loudness';

/** One frame of a sine at `frequency` Hz. */
function sine(
  frequency: number,
  { amplitude = 0.5, sampleRate = 48000, samples = 480 } = {},
): Float32Array {
  const buffer = new Float32Array(samples);

  for (let index = 0; index < samples; index += 1) {
    buffer[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
  }

  return buffer;
}

/** Feed `durationMs` worth of frames and return the final reading. */
function measure(
  frequency: number,
  { amplitude = 0.5, sampleRate = 48000, durationMs = 600 } = {},
): number {
  const meter = createLoudnessMeter(sampleRate);
  const frameSamples = 480;
  const frameMs = (frameSamples / sampleRate) * 1000;
  const frames = Math.ceil(durationMs / frameMs);
  const source = sine(frequency, { amplitude, sampleRate, samples: frameSamples });

  for (let index = 0; index < frames; index += 1) {
    meter.push([source]);
  }

  return meter.value();
}

describe('kWeightingCoefficients', () => {
  it('produces finite coefficients for a range of sample rates', () => {
    for (const rate of [8000, 44100, 48000, 96000]) {
      const { shelf, highPass } = kWeightingCoefficients(rate);

      for (const value of [shelf.b0, shelf.b1, shelf.b2, shelf.a1, shelf.a2]) {
        expect(Number.isFinite(value)).toBe(true);
      }

      for (const value of [highPass.b0, highPass.b1, highPass.b2, highPass.a1, highPass.a2]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it('keeps the 48 kHz high-pass numerator from the standard', () => {
    const { highPass } = kWeightingCoefficients(48000);

    expect(highPass.b0).toBe(1);
    expect(highPass.b1).toBe(-2);
    expect(highPass.b2).toBe(1);
  });

  it('falls back to 48 kHz coefficients for a nonsense rate', () => {
    expect(kWeightingCoefficients(Number.NaN)).toEqual(kWeightingCoefficients(48000));
    expect(kWeightingCoefficients(0)).toEqual(kWeightingCoefficients(48000));
  });
});

describe('createLoudnessMeter', () => {
  it('gates silence at the absolute floor', () => {
    const meter = createLoudnessMeter(48000);

    expect(meter.value()).toBe(LOUDNESS_GATE_LUFS);

    for (let index = 0; index < 40; index += 1) {
      meter.push([new Float32Array(480)]);
    }

    expect(meter.value()).toBe(LOUDNESS_GATE_LUFS);
  });

  it('reads a 1 kHz tone near its RMS level', () => {
    // 0.5 amplitude sine is -9.03 dBFS RMS; K-weighting is ~flat there and the
    // standard applies a -0.691 dB offset, so the reading lands near -9.7 LUFS.
    const lufs = measure(1000);

    expect(lufs).toBeGreaterThan(-11);
    expect(lufs).toBeLessThan(-8);
  });

  it('reports the same tone 6 dB louder at twice the amplitude', () => {
    const quiet = measure(1000, { amplitude: 0.25 });
    const loud = measure(1000, { amplitude: 0.5 });

    expect(loud - quiet).toBeCloseTo(6.02, 0);
  });

  it('weights low frequencies down', () => {
    const low = measure(60);
    const mid = measure(1000);

    expect(low).toBeLessThan(mid - 3);
  });

  it('is insensitive to sample rate', () => {
    const at48 = measure(1000, { sampleRate: 48000 });
    const at441 = measure(1000, { sampleRate: 44100 });

    expect(Math.abs(at48 - at441)).toBeLessThan(0.5);
  });

  it('sums channels instead of averaging them', () => {
    const meter = createLoudnessMeter(48000);
    const mono = sine(1000);
    const stereo = createLoudnessMeter(48000);

    for (let index = 0; index < 60; index += 1) {
      meter.push([mono]);
      stereo.push([mono, mono]);
    }

    // Two identical channels carry twice the power: +3.01 dB.
    expect(stereo.value() - meter.value()).toBeCloseTo(3.01, 0);
  });

  it('falls back to the gate after the window passes into silence', () => {
    const meter = createLoudnessMeter(48000);
    const tone = sine(1000);
    const silent = new Float32Array(480);

    for (let index = 0; index < 60; index += 1) {
      meter.push([tone]);
    }

    expect(meter.value()).toBeGreaterThan(LOUDNESS_GATE_LUFS);

    const silentFrames = Math.ceil((MOMENTARY_WINDOW_MS / ((480 / 48000) * 1000)) * 2);

    for (let index = 0; index < silentFrames; index += 1) {
      meter.push([silent]);
    }

    expect(meter.value()).toBe(LOUDNESS_GATE_LUFS);
  });

  it('forgets everything on reset', () => {
    const meter = createLoudnessMeter(48000);

    for (let index = 0; index < 60; index += 1) {
      meter.push([sine(1000)]);
    }

    expect(meter.value()).toBeGreaterThan(LOUDNESS_GATE_LUFS);
    meter.reset();
    expect(meter.value()).toBe(LOUDNESS_GATE_LUFS);
  });

  it('ignores empty channels gracefully', () => {
    const meter = createLoudnessMeter(48000);

    meter.push([]);
    meter.push([new Float32Array(0)]);

    expect(meter.value()).toBe(LOUDNESS_GATE_LUFS);
  });
});
