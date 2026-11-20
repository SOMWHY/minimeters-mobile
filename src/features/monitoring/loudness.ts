/**
 * Momentary loudness (LUFS) per ITU-R BS.1770-4.
 *
 * The plugin never sends loudness; it sends raw PCM. Loudness is therefore
 * derived here, on the host: K-weight the signal (high shelf + high pass) and
 * average the weighted power over a 400 ms window. The double filter is what
 * makes a loud 60 Hz rumble score lower than a mid-range tone at the same RMS,
 * which is the whole point of a loudness meter.
 */

export type Biquad = {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
};

/** Absolute gate from BS.1770: below this the signal reads as silence. */
export const LOUDNESS_GATE_LUFS = -70;

/** Momentary window length. */
export const MOMENTARY_WINDOW_MS = 400;

/**
 * K-weighting coefficients for any sample rate.
 *
 * BS.1770 publishes the 48 kHz numbers, but the filters are re-derived for other
 * rates with the same analog prototype (the approach pyLoudNorm uses), so a
 * 44.1 kHz plugin reads the same loudness instead of being ~0.2 dB off.
 */
export function kWeightingCoefficients(sampleRate: number): {
  readonly shelf: Biquad;
  readonly highPass: Biquad;
} {
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;

  // Stage 1: high shelf, ~+4 dB above ~1.7 kHz.
  const shelfF0 = 1681.974450955533;
  const shelfGain = 3.999843853973347;
  const shelfQ = 0.7071752369554196;
  const shelfK = Math.tan((Math.PI * shelfF0) / rate);
  const vh = Math.pow(10, shelfGain / 20);
  const vb = Math.pow(vh, 0.499666774155);
  const shelfA0 = 1 + shelfK / shelfQ + shelfK * shelfK;

  const shelf: Biquad = {
    b0: (vh + (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
    b1: (2 * (shelfK * shelfK - vh)) / shelfA0,
    b2: (vh - (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
    a1: (2 * (shelfK * shelfK - 1)) / shelfA0,
    a2: (1 - shelfK / shelfQ + shelfK * shelfK) / shelfA0,
  };

  // Stage 2: high pass at ~38 Hz (the RLB curve).
  const passF0 = 38.13547087602444;
  const passQ = 0.5003270373238773;
  const passK = Math.tan((Math.PI * passF0) / rate);
  const passA0 = 1 + passK / passQ + passK * passK;

  const highPass: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (passK * passK - 1)) / passA0,
    a2: (1 - passK / passQ + passK * passK) / passA0,
  };

  return { shelf, highPass };
}

type FilterState = { x1: number; x2: number; y1: number; y2: number };

function step(filter: Biquad, state: FilterState, input: number): number {
  const output =
    filter.b0 * input +
    filter.b1 * state.x1 +
    filter.b2 * state.x2 -
    filter.a1 * state.y1 -
    filter.a2 * state.y2;

  state.x2 = state.x1;
  state.x1 = input;
  state.y2 = state.y1;
  state.y1 = output;

  return output;
}

type WindowEntry = {
  /** Sum of squares across all channels for this slice. */
  readonly sumSquares: number;
  /** Samples per channel contributed by this slice. */
  readonly count: number;
};

export type LoudnessMeter = {
  /** Feed one frame's de-interleaved channels. */
  readonly push: (channels: readonly Float32Array[]) => void;
  /** Momentary loudness in LUFS, `LOUDNESS_GATE_LUFS` until there is signal. */
  readonly value: () => number;
  readonly reset: () => void;
};

/**
 * Rolling-window loudness meter.
 *
 * The window is trimmed by sample count rather than wall-clock time, so the
 * reading stays sample-accurate even if the plugin's frames arrive irregularly.
 */
export function createLoudnessMeter(
  sampleRate: number,
  windowMs: number = MOMENTARY_WINDOW_MS,
): LoudnessMeter {
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
  const windowSamples = Math.max(1, Math.round((windowMs * rate) / 1000));
  const filters = kWeightingCoefficients(rate);

  let entries: WindowEntry[] = [];
  let states: { shelf: FilterState; highPass: FilterState }[] = [];
  let totalSamples = 0;

  function reset(): void {
    entries = [];
    states = [];
    totalSamples = 0;
  }

  function push(channels: readonly Float32Array[]): void {
    if (channels.length === 0) {
      return;
    }

    while (states.length < channels.length) {
      const fresh = (): FilterState => ({ x1: 0, x2: 0, y1: 0, y2: 0 });
      states.push({ shelf: fresh(), highPass: fresh() });
    }

    const count = channels[0].length;

    if (count === 0) {
      return;
    }

    let sumSquares = 0;

    for (let channel = 0; channel < channels.length; channel += 1) {
      const samples = channels[channel];
      const state = states[channel];

      for (let index = 0; index < samples.length; index += 1) {
        const shelved = step(filters.shelf, state.shelf, samples[index]);
        const weighted = step(filters.highPass, state.highPass, shelved);

        sumSquares += weighted * weighted;
      }
    }

    entries.push({ sumSquares, count });
    totalSamples += count;

    // Drop whole slices first, then trim the oldest partially so the window
    // stays exactly 400 ms instead of quantising to the frame length.
    while (entries.length > 0 && totalSamples - entries[0].count >= windowSamples) {
      totalSamples -= entries[0].count;
      entries.shift();
    }

    if (entries.length > 1 && totalSamples > windowSamples) {
      const excess = totalSamples - windowSamples;
      const head = entries[0];

      entries[0] = {
        sumSquares: head.sumSquares * (1 - excess / head.count),
        count: head.count - excess,
      };
      totalSamples = windowSamples;
    }
  }

  function value(): number {
    if (totalSamples === 0) {
      return LOUDNESS_GATE_LUFS;
    }

    let sumSquares = 0;

    for (const entry of entries) {
      sumSquares += entry.sumSquares;
    }

    const meanSquare = sumSquares / totalSamples;

    if (!(meanSquare > 0)) {
      return LOUDNESS_GATE_LUFS;
    }

    const lufs = -0.691 + 10 * Math.log10(meanSquare);

    return Math.max(LOUDNESS_GATE_LUFS, lufs);
  }

  return { push, value, reset };
}
