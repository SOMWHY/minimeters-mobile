/**
 * Minimal radix-2 FFT, kept in the host app rather than pulled from npm.
 *
 * The candidates on npm (`fft.js`, `kissfft-js`, `fourier`) have all been
 * unpublished-but-frozen since 2022; the algorithm itself does not change, so a
 * fixed-size decimation-in-time transform plus unit tests against known tones is
 * less risk than an unmaintained dependency.
 */

function assertPowerOfTwo(size: number): void {
  if (!Number.isInteger(size) || size < 2 || (size & (size - 1)) !== 0) {
    throw new Error(`FFT size must be a power of two, received ${size}`);
  }
}

/**
 * In-place forward transform.
 *
 * `re` and `im` must both be exactly `size` long; `im` starts as zeros for real
 * input. No windowing and no normalisation happen here — callers own both.
 */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const size = re.length;
  assertPowerOfTwo(size);

  if (im.length !== size) {
    throw new Error(`FFT buffers must match: re=${size} im=${im.length}`);
  }

  // Bit-reversal permutation.
  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >> 1;

    for (; reversed & bit; bit >>= 1) {
      reversed ^= bit;
    }

    reversed ^= bit;

    if (index < reversed) {
      const reTmp = re[index];
      re[index] = re[reversed];
      re[reversed] = reTmp;

      const imTmp = im[index];
      im[index] = im[reversed];
      im[reversed] = imTmp;
    }
  }

  for (let width = 2; width <= size; width <<= 1) {
    const half = width >> 1;
    const angleStep = (-2 * Math.PI) / width;

    for (let start = 0; start < size; start += width) {
      for (let offset = 0; offset < half; offset += 1) {
        const angle = angleStep * offset;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const evenIndex = start + offset;
        const oddIndex = evenIndex + half;

        const oddRe = re[oddIndex] * cos - im[oddIndex] * sin;
        const oddIm = re[oddIndex] * sin + im[oddIndex] * cos;

        re[oddIndex] = re[evenIndex] - oddRe;
        im[oddIndex] = im[evenIndex] - oddIm;

        re[evenIndex] += oddRe;
        im[evenIndex] += oddIm;
      }
    }
  }
}

/**
 * Magnitude spectrum of the first `size` samples, scaled so a full-scale sine
 * reads 1.0 at its bin (`2 / size` corrects for the transform's gain; DC uses
 * `1 / size` because it has no conjugate twin).
 *
 * Returns `size / 2` bins: the positive half is all a display needs.
 */
export function fftMagnitudes(samples: ArrayLike<number>, size: number): Float64Array {
  assertPowerOfTwo(size);

  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const limit = Math.min(size, samples.length);

  for (let index = 0; index < limit; index += 1) {
    re[index] = samples[index];
  }

  fftInPlace(re, im);

  const half = size >> 1;
  const magnitudes = new Float64Array(half);
  const sineGain = 2 / size;
  const dcGain = 1 / size;

  for (let bin = 0; bin < half; bin += 1) {
    // DC has no conjugate twin, so it takes half the sine gain to read its own level.
    magnitudes[bin] = Math.hypot(re[bin], im[bin]) * (bin === 0 ? dcGain : sineGain);
  }

  return magnitudes;
}

/** Periodic Hann window; periodic (not symmetric) so the FFT bins stay aligned. */
export function hannWindow(size: number): Float64Array {
  assertPowerOfTwo(size);

  const window = new Float64Array(size);

  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size);
  }

  return window;
}
