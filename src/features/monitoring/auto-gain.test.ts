import {
  DEFAULT_AUTO_GAIN,
  createAutoGain,
  type AutoGainConfig,
} from './auto-gain';

const SAMPLE_RATE = 48000;
const SAMPLES_PER_CHANNEL = 512;
const FRAME_MS = (SAMPLES_PER_CHANNEL / SAMPLE_RATE) * 1000;

/** A steady sine, the worst case for an envelope follower that must stay put. */
function sine(amplitude: number): Float32Array {
  const samples = new Float32Array(SAMPLES_PER_CHANNEL * 2);

  for (let index = 0; index < SAMPLES_PER_CHANNEL; index += 1) {
    const value = amplitude * Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE);

    samples[index * 2] = value;
    samples[index * 2 + 1] = value;
  }

  return samples;
}

function peakOf(samples: Float32Array): number {
  let peak = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const magnitude = Math.abs(samples[index]);

    if (magnitude > peak) {
      peak = magnitude;
    }
  }

  return peak;
}

function run(gain: ReturnType<typeof createAutoGain>, amplitude: number, frames: number): Float32Array {
  const frame = sine(amplitude);
  let out = frame;

  for (let index = 0; index < frames; index += 1) {
    out = gain.apply(frame, FRAME_MS);
  }

  return out;
}

describe('createAutoGain', () => {
  it('lifts a quiet programme so the trace nearly fills the plot', () => {
    const gain = createAutoGain();

    // -14 dBFS: a healthy mix, drawn at 20% of the card without auto-gain.
    const out = run(gain, 0.2, 200);

    expect(peakOf(out)).toBeGreaterThan(0.75);
    expect(peakOf(out)).toBeLessThanOrEqual(1);
    expect(gain.gainDb()).toBeGreaterThan(10);
  });

  it('leaves a hot programme close to unity so loud still looks loud', () => {
    const gain = createAutoGain();

    run(gain, 0.9, 200);

    expect(gain.gainDb()).toBeLessThan(0.5);
    expect(gain.gainDb()).toBeGreaterThan(-1.5);
  });

  it('never boosts beyond the configured ceiling', () => {
    const gain = createAutoGain({ ...DEFAULT_AUTO_GAIN, maxGainDb: 12 });
    const out = run(gain, 0.002, 400);

    expect(gain.gainDb()).toBeCloseTo(12, 1);
    expect(peakOf(out)).toBeCloseTo(0.002 * Math.pow(10, 12 / 20), 4);
  });

  it('holds its gain through silence instead of amplifying noise', () => {
    const gain = createAutoGain();

    run(gain, 0.2, 200);
    const lifted = gain.gain();
    const silence = new Float32Array(SAMPLES_PER_CHANNEL * 2);
    const out = gain.apply(silence, FRAME_MS);

    expect(gain.gain()).toBeLessThanOrEqual(lifted * 1.01);
    expect(peakOf(out)).toBe(0);
  });

  it('does not lift a signal that is already below the quiet floor', () => {
    const gain = createAutoGain();

    run(gain, 0.0001, 200);

    expect(gain.gain()).toBe(1);
  });

  it('glides instead of jumping, so the picture does not pop', () => {
    const gain = createAutoGain();

    run(gain, 0.2, 1);
    const afterOneFrame = gain.gain();

    run(gain, 0.2, 400);

    // One 10 ms frame moves a fraction of the way: the steady-state gain for
    // this level is >3x, but it must take a moment to get there.
    expect(afterOneFrame).toBeGreaterThan(1);
    expect(afterOneFrame).toBeLessThan(1.5);
    expect(gain.gain()).toBeGreaterThan(3);
  });

  it('clamps the boosted signal to full scale', () => {
    const config: AutoGainConfig = { ...DEFAULT_AUTO_GAIN, targetPeak: 2, maxGainDb: 24 };
    const gain = createAutoGain(config);
    const out = run(gain, 0.5, 200);

    expect(peakOf(out)).toBe(1);
  });

  it('returns to unity on reset', () => {
    const gain = createAutoGain();

    run(gain, 0.05, 200);
    expect(gain.gain()).toBeGreaterThan(2);

    gain.reset();

    expect(gain.gain()).toBe(1);
    expect(gain.gainDb()).toBe(0);
  });
});
