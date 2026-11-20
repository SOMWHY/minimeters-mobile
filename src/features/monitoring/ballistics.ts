/**
 * VU ballistics.
 *
 * A raw RMS per frame makes a VU bar twitch: at 30 fps single-frame noise swings
 * the bar several percent and the peak marker flickers. Real meters rise fast
 * and fall slowly, so the bar reads as motion instead of noise. Both stages are
 * exponential (one-pole) smoothers parameterised by time constant, which keeps
 * the result frame-rate independent.
 */

import type { ChannelLevels } from './analysis';

export type BallisticsConfig = {
  /** How fast the bar chases a rising signal. */
  readonly attackMs: number;
  /** How fast it falls back once the signal drops. */
  readonly releaseMs: number;
  /** How long the peak marker stays pinned at its highest value. */
  readonly peakHoldMs: number;
  /** How fast the marker slides down after the hold expires. */
  readonly peakFallMs: number;
};

export const DEFAULT_BALLISTICS: BallisticsConfig = {
  attackMs: 20,
  releaseMs: 260,
  peakHoldMs: 1200,
  peakFallMs: 420,
};

type ChannelState = {
  bar: number;
  peak: number;
  holdRemainingMs: number;
};

export type VuMeter = {
  readonly push: (levels: readonly ChannelLevels[], deltaMs: number) => ChannelLevels[];
  readonly reset: () => void;
};

/** One-pole coefficient: fraction of the distance covered in `deltaMs`. */
function coefficient(deltaMs: number, tauMs: number): number {
  if (!(deltaMs > 0) || !(tauMs > 0)) {
    return 1;
  }

  return Math.min(1, 1 - Math.exp(-deltaMs / tauMs));
}

export function createVuMeter(config: BallisticsConfig = DEFAULT_BALLISTICS): VuMeter {
  let states: ChannelState[] = [];

  function reset(): void {
    states = [];
  }

  function push(levels: readonly ChannelLevels[], deltaMs: number): ChannelLevels[] {
    const rise = coefficient(deltaMs, config.attackMs);
    const fall = coefficient(deltaMs, config.releaseMs);
    const peakFall = coefficient(deltaMs, config.peakFallMs);

    return levels.map((level, index) => {
      const target = Number.isFinite(level.rms) ? level.rms : 0;
      const peakTarget = Number.isFinite(level.peak) ? level.peak : 0;
      // The first frame snaps to the signal: starting from zero would make a
      // meter attached mid-stream fade in instead of reading the room.
      const state = states[index] ?? { bar: target, peak: peakTarget, holdRemainingMs: 0 };
      states[index] = state;

      state.bar += (target - state.bar) * (target > state.bar ? rise : fall);

      if (peakTarget >= state.peak) {
        state.peak = peakTarget;
        state.holdRemainingMs = config.peakHoldMs;
      } else if (state.holdRemainingMs > 0) {
        state.holdRemainingMs = Math.max(0, state.holdRemainingMs - deltaMs);
      } else {
        state.peak += (peakTarget - state.peak) * peakFall;
      }

      // The marker can never sit below the bar it annotates.
      if (state.peak < state.bar) {
        state.peak = state.bar;
      }

      return { rms: state.bar, peak: state.peak };
    });
  }

  return { push, reset };
}
