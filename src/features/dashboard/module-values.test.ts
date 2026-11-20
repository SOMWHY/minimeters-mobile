import type { FrameAnalysis } from '@/features/monitoring/analysis';
import {
  linearToDb,
  LOUDNESS_BAR_DB_RANGE,
  loudnessReadout,
  loudnessValues,
  SPECTRUM_DB_RANGE,
  toBarFraction,
  VU_BAR_DB_RANGE,
  vuLevels,
} from './module-values';

function analysisOf({
  rms = 0.1,
  peak = 0.5,
  lufs = -14,
  momentaryLufs = -12,
  shortTermLufs = -13,
  levels = [{ peak, rms }],
}: {
  rms?: number;
  peak?: number;
  lufs?: number;
  momentaryLufs?: number;
  shortTermLufs?: number;
  levels?: readonly { peak: number; rms: number }[];
} = {}): FrameAnalysis {
  return {
    peak,
    rms,
    lufs,
    momentaryLufs,
    shortTermLufs,
    levels,
    left: new Float32Array(0),
    right: new Float32Array(0),
    bins: new Float32Array(0),
    spectrogramRow: new Float32Array(0),
  };
}

describe('linearToDb', () => {
  it('converts amplitude to dBFS', () => {
    expect(linearToDb(1)).toBeCloseTo(0, 5);
    expect(linearToDb(0.5)).toBeCloseTo(-6.02, 2);
    expect(linearToDb(0.1)).toBeCloseTo(-20, 5);
  });

  it('floors silence and nonsense instead of returning -Infinity', () => {
    expect(linearToDb(0)).toBe(SPECTRUM_DB_RANGE[0]);
    expect(linearToDb(Number.NaN)).toBe(SPECTRUM_DB_RANGE[0]);
    expect(linearToDb(-1)).toBe(SPECTRUM_DB_RANGE[0]);
  });
});

describe('toBarFraction', () => {
  it('puts -20 dBFS two thirds up a -60..0 bar, not a tenth', () => {
    expect(toBarFraction(-20, VU_BAR_DB_RANGE)).toBeCloseTo(2 / 3, 5);
  });

  it('gives the loudness meter a wider window than the VU', () => {
    // The VU bar stops at -60 dBFS; the loudness bar runs to the analysis floor.
    expect(toBarFraction(-20, LOUDNESS_BAR_DB_RANGE)).toBeCloseTo(0.8, 5);
    expect(toBarFraction(-70, LOUDNESS_BAR_DB_RANGE)).toBeCloseTo(0.3, 5);
  });

  it('clamps outside the window', () => {
    expect(toBarFraction(0, VU_BAR_DB_RANGE)).toBe(1);
    expect(toBarFraction(-90, VU_BAR_DB_RANGE)).toBe(0);
    expect(toBarFraction(6, VU_BAR_DB_RANGE)).toBe(1);
  });

  it('returns 0 for a degenerate range or a non-finite value', () => {
    expect(toBarFraction(-20, [-60, -60])).toBe(0);
    expect(toBarFraction(Number.NaN, VU_BAR_DB_RANGE)).toBe(0);
    expect(toBarFraction(-20, [0, -60])).toBe(0);
  });
});

describe('vuLevels', () => {
  it('scales bars and markers in dB', () => {
    const levels = vuLevels(analysisOf({ rms: 0.1, peak: 0.5 }));

    expect(levels.left).toBeCloseTo(2 / 3, 5);
    expect(levels.leftPeak).toBeCloseTo((-6.02 + 60) / 60, 3);
  });

  it('duplicates the only channel so both bars draw on a mono frame', () => {
    const levels = vuLevels(analysisOf({ rms: 0.1 }));

    expect(levels.right).toBe(levels.left);
    expect(levels.rightPeak).toBe(levels.leftPeak);
  });

  it('reads zero for silence', () => {
    const levels = vuLevels(analysisOf({ rms: 0, peak: 0 }));

    expect(levels.left).toBe(0);
    expect(levels.rightPeak).toBe(0);
  });

  it('keeps stereo channels independent', () => {
    const levels = vuLevels(
      analysisOf({
        levels: [
          { peak: 0.5, rms: 0.1 },
          { peak: 0.1, rms: 0.01 },
        ],
      }),
    );

    expect(levels.left).toBeGreaterThan(levels.right);
  });
});

describe('loudnessValues', () => {
  it('reports peak and RMS in dBFS and passes LUFS through', () => {
    const values = loudnessValues(analysisOf({ rms: 0.1, peak: 0.5, lufs: -14.2 }));

    expect(values.peak).toBeCloseTo(-6.02, 2);
    expect(values.rms).toBeCloseTo(-20, 5);
    expect(values.lufs).toBe(-14.2);
  });
});

describe('loudnessReadout', () => {
  it('names all three windows so the headline LUFS is never ambiguous', () => {
    expect(loudnessReadout(analysisOf({ lufs: -14.24, momentaryLufs: -12.31, shortTermLufs: -13.05 })))
      .toBe('-14.2 LUFS (M -12.3 / S -13.1)');
  });

  it('is empty before the first frame', () => {
    expect(loudnessReadout(null)).toBe('');
  });

  it('keeps the gates readable when the signal is silent', () => {
    expect(
      loudnessReadout(
        analysisOf({ lufs: -70, momentaryLufs: -70, shortTermLufs: -70 }),
      ),
    ).toBe('-70.0 LUFS (M -70.0 / S -70.0)');
  });
});
