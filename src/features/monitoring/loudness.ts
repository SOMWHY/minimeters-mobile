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

/** Short-term window length (EBU R128). */
export const SHORT_TERM_WINDOW_MS = 3000;

/** Relative gate distance for integrated loudness, in LU. */
export const INTEGRATED_RELATIVE_GATE_LU = 10;

/** Bounded block history for the integrated value (400 ms each ≈ 24 minutes). */
const MAX_INTEGRATED_BLOCKS = 3600;

/**
 * How long the programme may sit below the absolute gate before the integrated
 * measurement starts over.
 *
 * Integrated loudness is a programme average by definition, so it must not drift
 * while the transport is stopped. Without this reset a muted input would keep a
 * stale average on screen forever; with it, the next programme begins from a
 * fresh measurement instead of inheriting the previous one.
 */
export const INTEGRATED_RESET_SILENCE_MS = 5000;

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
  /** Short-term loudness (3 s window). */
  readonly shortTerm: () => number;
  /**
   * Integrated (programme) loudness per BS.1770-4 gating.
   *
   * This is the number people mean by "the LUFS" of a track: 400 ms blocks,
   * absolute -70 LUFS gate, then a relative gate 10 LU below the loud blocks so
   * a quiet intro cannot drag the average down.
   */
  readonly integrated: () => number;
  readonly reset: () => void;
};

/** Convert weighted mean square to LUFS. */
function toLufs(meanSquare: number): number {
  if (!(meanSquare > 0)) {
    return LOUDNESS_GATE_LUFS;
  }

  return Math.max(LOUDNESS_GATE_LUFS, -0.691 + 10 * Math.log10(meanSquare));
}

/**
 * Rolling-window loudness meter.
 *
 * The windows are trimmed by sample count rather than wall-clock time, so the
 * reading stays sample-accurate even if the plugin's frames arrive irregularly.
 * Blocks for the integrated value are non-overlapping, which is what a live
 * meter can afford: 75 % overlap only sharpens the gate, not the reading.
 */
export function createLoudnessMeter(sampleRate: number): LoudnessMeter {
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
  const samplesFor = (windowMs: number): number => Math.max(1, Math.round((windowMs * rate) / 1000));
  const momentarySamples = samplesFor(MOMENTARY_WINDOW_MS);
  const shortTermSamples = samplesFor(SHORT_TERM_WINDOW_MS);
  const silentResetSamples = samplesFor(INTEGRATED_RESET_SILENCE_MS);
  const blockSamples = momentarySamples;
  const filters = kWeightingCoefficients(rate);

  let entries: WindowEntry[] = [];
  let states: { shelf: FilterState; highPass: FilterState }[] = [];
  let totalSamples = 0;

  let blockSumSquares = 0;
  let blockCount = 0;
  let blocks: number[] = [];
  let silentSamples = 0;

  function reset(): void {
    entries = [];
    states = [];
    totalSamples = 0;
    blockSumSquares = 0;
    blockCount = 0;
    blocks = [];
    silentSamples = 0;
  }

  function accumulateIntegrated(sumSquares: number, count: number): void {
    let remaining = sumSquares;
    let pending = count;

    while (pending > 0) {
      const room = blockSamples - blockCount;
      const take = Math.min(room, pending);
      const share = pending > 0 ? take / pending : 0;

      blockSumSquares += remaining * share;
      blockCount += take;
      remaining -= remaining * share;
      pending -= take;

      if (blockCount >= blockSamples) {
        blocks.push(blockSumSquares / blockCount);
        blockSumSquares = 0;
        blockCount = 0;

        if (blocks.length > MAX_INTEGRATED_BLOCKS) {
          blocks.shift();
        }
      }
    }
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
    accumulateIntegrated(sumSquares, count);

    if (toLufs(sumSquares / count) <= LOUDNESS_GATE_LUFS) {
      silentSamples += count;

      if (silentSamples >= silentResetSamples && blocks.length > 0) {
        blockSumSquares = 0;
        blockCount = 0;
        blocks = [];
      }
    } else {
      silentSamples = 0;
    }

    // Drop whole slices first, then trim the oldest partially so the window
    // stays exact instead of quantising to the frame length. The buffer keeps
    // the longest window; the shorter ones are summed from the tail.
    while (entries.length > 0 && totalSamples - entries[0].count >= shortTermSamples) {
      totalSamples -= entries[0].count;
      entries.shift();
    }

    if (entries.length > 1 && totalSamples > shortTermSamples) {
      const excess = totalSamples - shortTermSamples;
      const head = entries[0];

      entries[0] = {
        sumSquares: head.sumSquares * (1 - excess / head.count),
        count: head.count - excess,
      };
      totalSamples = shortTermSamples;
    }
  }

  /** Mean square over the newest `windowSamples`, walking back from the tail. */
  function windowMeanSquare(windowSamples: number): number {
    let counted = 0;
    let sumSquares = 0;

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      const take = Math.min(entry.count, windowSamples - counted);

      if (take <= 0) {
        break;
      }

      sumSquares += entry.sumSquares * (take / entry.count);
      counted += take;
    }

    return counted > 0 ? sumSquares / counted : 0;
  }

  function momentary(): number {
    return toLufs(windowMeanSquare(momentarySamples));
  }

  function shortTerm(): number {
    return toLufs(windowMeanSquare(shortTermSamples));
  }

  function integrated(): number {
    const aboveAbsolute = blocks.filter((energy) => toLufs(energy) > LOUDNESS_GATE_LUFS);

    if (aboveAbsolute.length === 0) {
      return LOUDNESS_GATE_LUFS;
    }

    const absoluteMean =
      aboveAbsolute.reduce((total, energy) => total + energy, 0) / aboveAbsolute.length;
    const relativeThreshold = toLufs(absoluteMean) - INTEGRATED_RELATIVE_GATE_LU;
    const gated = aboveAbsolute.filter((energy) => toLufs(energy) > relativeThreshold);

    if (gated.length === 0) {
      return LOUDNESS_GATE_LUFS;
    }

    return toLufs(gated.reduce((total, energy) => total + energy, 0) / gated.length);
  }

  return { push, value: momentary, shortTerm, integrated, reset };
}
