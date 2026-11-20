/**
 * Display auto-gain for the scope modules.
 *
 * A linear plot of PCM samples is honest but nearly invisible: a healthy mix
 * peaks around -12 dBFS, so the trace only ever occupies ~25% of the card, and
 * quiet passages draw a flat line. Broadcast analysers solve this with a
 * display gain that follows the programme level instead of the sample values.
 *
 * This module is deliberately separate from the metering chain: it only scales
 * the samples handed to the waveform / oscilloscope / vectorscope. Levels, LUFS
 * and the spectrum keep reading the untouched samples, so a lifted trace never
 * inflates a meter reading.
 */

export interface AutoGainConfig {
  /** Peak the trace is normalised to, in 0..1 of full scale. */
  readonly targetPeak: number;
  /** Ceiling on the applied gain; a quiet room should not become a light show. */
  readonly maxGainDb: number;
  /** Floor on the applied gain, so a hot master is still shown honestly. */
  readonly minGainDb: number;
  /** Envelope follows peaks up this fast (ms). */
  readonly attackMs: number;
  /** …and lets go this slowly (ms), so the picture does not pump per frame. */
  readonly releaseMs: number;
  /** Makeup gain glides towards its target over this time (ms). */
  readonly glideMs: number;
  /** Below this envelope the gain is held, not raised: silence stays silence. */
  readonly quietFloorDb: number;
}

export const DEFAULT_AUTO_GAIN: AutoGainConfig = {
  targetPeak: 0.75,
  // +12 dB lifts a -20 dBFS passage to a third of the card; more than that
  // squashes the dynamics the picture is supposed to show.
  maxGainDb: 12,
  minGainDb: -6,
  attackMs: 20,
  releaseMs: 800,
  glideMs: 300,
  quietFloorDb: -70,
};

export interface AutoGain {
  /**
   * Scale one interleaved frame.
   *
   * @param samples interleaved PCM, |sample| <= 1
   * @param durationMs how much audio the frame covers, used for the time constants
   * @returns a new buffer with the display gain applied and the result clamped to ±1
   */
  readonly apply: (samples: Float32Array, durationMs: number) => Float32Array;
  /** Current gain as a linear factor (1 = unity). */
  readonly gain: () => number;
  /** Current gain in dB, for diagnostics. */
  readonly gainDb: () => number;
  readonly reset: () => void;
}

/** One-pole smoothing factor for a time constant, clamped so dt cannot overshoot. */
function smoothing(durationMs: number, timeConstantMs: number): number {
  if (!(durationMs > 0) || !(timeConstantMs > 0)) {
    return 1;
  }

  return 1 - Math.exp(-durationMs / timeConstantMs);
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

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

export function createAutoGain(config: AutoGainConfig = DEFAULT_AUTO_GAIN): AutoGain {
  const quietFloor = dbToLinear(config.quietFloorDb);
  const minGain = dbToLinear(config.minGainDb);
  const maxGain = dbToLinear(config.maxGainDb);

  let envelope = 0;
  let current = 1;

  function apply(samples: Float32Array, durationMs: number): Float32Array {
    const peak = peakOf(samples);
    const attack = smoothing(durationMs, config.attackMs);
    const release = smoothing(durationMs, config.releaseMs);

    envelope = peak > envelope ? envelope + (peak - envelope) * attack : envelope + (peak - envelope) * release;

    // A frame of near-silence would otherwise ask for enormous gain and then
    // slam back on the next note; hold the last gain through the quiet part.
    if (envelope >= quietFloor) {
      const wanted = Math.min(maxGain, Math.max(minGain, config.targetPeak / envelope));

      current += (wanted - current) * smoothing(durationMs, config.glideMs);
    }

    const scaled = new Float32Array(samples.length);

    for (let index = 0; index < samples.length; index += 1) {
      const value = samples[index] * current;

      scaled[index] = value > 1 ? 1 : value < -1 ? -1 : value;
    }

    return scaled;
  }

  return {
    apply,
    gain: () => current,
    gainDb: () => 20 * Math.log10(current),
    reset: () => {
      envelope = 0;
      current = 1;
    },
  };
}
