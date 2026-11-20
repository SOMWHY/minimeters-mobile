import { fftInPlace, fftMagnitudes, hannWindow } from './fft';

function sine(size: number, cycles: number, amplitude = 1): Float32Array {
  const samples = new Float32Array(size);

  for (let index = 0; index < size; index += 1) {
    samples[index] = amplitude * Math.sin((2 * Math.PI * cycles * index) / size);
  }

  return samples;
}

describe('fftMagnitudes', () => {
  it('rejects sizes that are not a power of two', () => {
    expect(() => fftMagnitudes([0, 1, 2], 3)).toThrow(/power of two/);
    expect(() => fftMagnitudes([], 0)).toThrow(/power of two/);
  });

  it('puts DC in bin 0 and nothing elsewhere', () => {
    const magnitudes = fftMagnitudes(new Float32Array(64).fill(1), 64);

    expect(magnitudes).toHaveLength(32);
    expect(magnitudes[0]).toBeCloseTo(1, 6);
    for (let bin = 1; bin < magnitudes.length; bin += 1) {
      expect(magnitudes[bin]).toBeCloseTo(0, 6);
    }
  });

  it('puts a whole-scale sine at its own bin', () => {
    const magnitudes = fftMagnitudes(sine(1024, 16), 1024);

    expect(magnitudes[16]).toBeCloseTo(1, 3);
    for (let bin = 0; bin < magnitudes.length; bin += 1) {
      if (bin !== 16) {
        expect(magnitudes[bin]).toBeLessThan(0.01);
      }
    }
  });

  it('scales with amplitude', () => {
    const full = fftMagnitudes(sine(512, 8, 1), 512);
    const half = fftMagnitudes(sine(512, 8, 0.5), 512);

    expect(half[8]).toBeCloseTo(full[8] / 2, 4);
  });

  it('zero-pads when the input is shorter than the window', () => {
    const magnitudes = fftMagnitudes([1, 1], 64);

    expect(magnitudes[0]).toBeCloseTo(2 / 64, 6);
    expect(magnitudes.every((value) => Number.isFinite(value))).toBe(true);
  });

  it('transforms in place without touching array identity', () => {
    const re = new Float64Array([1, 0, 0, 0]);
    const im = new Float64Array([0, 0, 0, 0]);

    fftInPlace(re, im);

    expect(re).toHaveLength(4);
    expect(im).toHaveLength(4);
    expect(re[0]).toBeCloseTo(1, 6);
    expect(() => fftInPlace(new Float64Array(4), new Float64Array(8))).toThrow(/must match/);
  });
});

describe('hannWindow', () => {
  it('is periodic with zero endpoints and a unit centre', () => {
    const window = hannWindow(8);

    expect(window).toHaveLength(8);
    expect(window[0]).toBeCloseTo(0, 6);
    expect(window[4]).toBeCloseTo(1, 6);
    expect(window[2]).toBeCloseTo(window[6], 6);
  });
});
