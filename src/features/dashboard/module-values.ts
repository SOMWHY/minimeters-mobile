import { ANALYSIS_FLOOR_DB, type FrameAnalysis } from '@/features/monitoring/analysis';
import { LOUDNESS_GATE_LUFS } from '@/features/monitoring/loudness';

/**
 * Display mapping between analysis numbers and what the library modules draw.
 *
 * The library only ever receives normalized `0..1` values; the decision of what
 * a "full bar" means belongs here, next to the meter's own physics.
 */

/** dB window the VU bars span. A VU needs a finite bottom or silence is off-scale. */
export const VU_BAR_DB_RANGE = [-60, 0] as const;

/**
 * dB window the loudness bars span.
 *
 * Momentary loudness never reads below the -70 LUFS gate, so the bar starts
 * there: a wider window would leave the bottom third of the bar unreachable.
 */
export const LOUDNESS_BAR_DB_RANGE = [LOUDNESS_GATE_LUFS, 0] as const;

/** dB window the spectrum/spectrogram span. */
export const SPECTRUM_DB_RANGE = [ANALYSIS_FLOOR_DB, 0] as const;

export type NumericRange = readonly [number, number];

/** Linear amplitude to dBFS, floored so silence stays finite. */
export function linearToDb(linear: number): number {
  return linear > 0 && Number.isFinite(linear)
    ? Math.max(ANALYSIS_FLOOR_DB, 20 * Math.log10(linear))
    : ANALYSIS_FLOOR_DB;
}

/**
 * dB to a `0..1` bar fraction.
 *
 * A VU is a dB meter: -20 dBFS sits at two thirds of the bar, not at a tenth.
 * Mapping linear amplitude instead is what makes a "quiet" mix look like the
 * needle barely moves.
 */
export function toBarFraction(db: number, range: NumericRange = VU_BAR_DB_RANGE): number {
  const span = range[1] - range[0];

  if (!Number.isFinite(db) || !Number.isFinite(span) || span <= 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, (db - range[0]) / span));
}

/** VU bars: RMS drives the bar, peak drives the marker, both on the dB scale. */
export function vuLevels(analysis: FrameAnalysis) {
  const left = analysis.levels[0] ?? { peak: 0, rms: 0 };
  const right = analysis.levels[1] ?? left;

  return {
    left: toBarFraction(linearToDb(left.rms)),
    right: toBarFraction(linearToDb(right.rms)),
    leftPeak: toBarFraction(linearToDb(left.peak)),
    rightPeak: toBarFraction(linearToDb(right.peak)),
  };
}

/**
 * Loudness readouts.
 *
 * The bar draws the **momentary** value so it tracks what is playing right now;
 * the programme-integrated average travels alongside as the `INT` note, because
 * by definition it does not fall when the programme goes quiet.
 */
export function loudnessValues(analysis: FrameAnalysis) {
  return {
    peak: linearToDb(analysis.peak),
    rms: linearToDb(analysis.rms),
    lufs: analysis.momentaryLufs,
    integrated: analysis.lufs,
  };
}

/**
 * The host status strip's loudness readout.
 *
 * Integrated is the headline number; momentary and short-term are shown beside
 * it because they are what an engineer watches while riding a level — a bare
 * "LUFS" would be ambiguous about which window it came from.
 */
export function loudnessReadout(analysis: FrameAnalysis | null): string {
  if (!analysis) {
    return '';
  }

  const integrated = analysis.lufs.toFixed(1);
  const momentary = analysis.momentaryLufs.toFixed(1);
  const shortTerm = analysis.shortTermLufs.toFixed(1);

  return `INT ${integrated} · M ${momentary} · S ${shortTerm}`;
}
