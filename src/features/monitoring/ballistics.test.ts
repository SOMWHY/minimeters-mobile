import { createVuMeter, DEFAULT_BALLISTICS } from './ballistics';
import type { ChannelLevels } from './analysis';

const level = (rms: number, peak: number = rms): ChannelLevels => ({ rms, peak });

/** Push the same level for `durationMs` in `stepMs` slices, return the last read. */
function hold(meter: ReturnType<typeof createVuMeter>, value: number, durationMs: number, stepMs = 16): ChannelLevels {
  let last = level(0);

  for (let elapsed = 0; elapsed < durationMs; elapsed += stepMs) {
    last = meter.push([level(value)], stepMs)[0];
  }

  return last;
}

describe('createVuMeter', () => {
  it('returns one reading per channel', () => {
    const meter = createVuMeter();
    const out = meter.push([level(0.5), level(0.25)], 16);

    expect(out).toHaveLength(2);
    expect(out[1].rms).toBeLessThan(out[0].rms);
  });

  it('jumps to the signal immediately on the first frame', () => {
    const meter = createVuMeter();
    const out = meter.push([level(0.8)], 16)[0];

    expect(out.rms).toBeCloseTo(0.8, 5);
  });

  it('rises most of the way within ~3 attack time constants', () => {
    const meter = createVuMeter();
    const out = hold(meter, 1, DEFAULT_BALLISTICS.attackMs * 3);

    expect(out.rms).toBeGreaterThan(0.9);
  });

  it('falls slowly — much slower than it rises', () => {
    const meter = createVuMeter();
    hold(meter, 1, 120);
    const out = hold(meter, 0, 60);

    expect(out.rms).toBeGreaterThan(0.5);
  });

  it('reaches the floor after several release time constants', () => {
    const meter = createVuMeter();
    hold(meter, 1, 120);
    const out = hold(meter, 0, DEFAULT_BALLISTICS.releaseMs * 8);

    expect(out.rms).toBeLessThan(0.01);
  });

  it('pins the peak marker, then releases it after the hold', () => {
    const meter = createVuMeter();
    const transient = meter.push([level(0.2, 0.9)], 16)[0];

    expect(transient.peak).toBeCloseTo(0.9, 5);

    const held = hold(meter, 0, DEFAULT_BALLISTICS.peakHoldMs * 0.8);

    expect(held.peak).toBeCloseTo(0.9, 5);

    const released = hold(meter, 0, DEFAULT_BALLISTICS.peakFallMs * 6);

    expect(released.peak).toBeLessThan(0.2);
  });

  it('raises the hold timer when a new peak arrives', () => {
    const meter = createVuMeter();

    meter.push([level(0.2, 0.5)], 16);
    hold(meter, 0, DEFAULT_BALLISTICS.peakHoldMs * 0.7);
    meter.push([level(0.2, 0.8)], 16);
    const held = hold(meter, 0, DEFAULT_BALLISTICS.peakHoldMs * 0.7);

    expect(held.peak).toBeCloseTo(0.8, 5);
  });

  it('never lets the marker sit below the bar', () => {
    const meter = createVuMeter();
    const out = hold(meter, 0.4, 200);

    expect(out.peak).toBeGreaterThanOrEqual(out.rms);
  });

  it('treats a zero-length frame as an instant step', () => {
    const meter = createVuMeter();

    meter.push([level(1)], 0);
    const out = meter.push([level(0)], 0)[0];

    expect(out.rms).toBe(0);
  });

  it('survives non-finite input', () => {
    const meter = createVuMeter();
    const out = meter.push([{ rms: Number.NaN, peak: Number.NaN }], 16)[0];

    expect(Number.isFinite(out.rms)).toBe(true);
    expect(Number.isFinite(out.peak)).toBe(true);
  });

  it('drops all state on reset', () => {
    const meter = createVuMeter();

    hold(meter, 1, 200);
    meter.reset();
    const out = meter.push([level(0.1)], 16)[0];

    expect(out.rms).toBeCloseTo(0.1, 5);
    expect(out.peak).toBeCloseTo(0.1, 5);
  });
});
