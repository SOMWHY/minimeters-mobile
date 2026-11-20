import {
  formatDb,
  formatHz,
  formatNote,
  formatSeconds,
  noteFromFrequency,
  spectrumReadout,
  spectrogramReadout,
  waveformReadout,
} from './readout';
import {
  ANALYSIS_BIN_COUNT,
  ANALYSIS_FLOOR_DB,
  binFrequencyRange,
} from '@/features/monitoring/analysis';
import type { PcmBlock } from '@minimetermobile/ui';

function block(samples: number[], channels = 1): PcmBlock {
  return {
    samples: Float32Array.from(samples),
    channels,
    samplesPerChannel: samples.length / channels,
  } as unknown as PcmBlock;
}

describe('noteFromFrequency', () => {
  it('names concert A exactly', () => {
    expect(noteFromFrequency(440)).toEqual({ name: 'A4', cents: 0 });
  });

  it('reports how far a frequency sits from the nearest note', () => {
    // 456.75 Hz is between A#4 (466.16) and A4 (440): 35 cents below A#4.
    expect(noteFromFrequency(456.75)).toEqual({ name: 'A#4', cents: -35 });
    expect(noteFromFrequency(196.02)).toEqual({ name: 'G3', cents: 0 });
  });

  it('drops frequencies that have no note', () => {
    expect(noteFromFrequency(0)).toBeNull();
    expect(noteFromFrequency(-40)).toBeNull();
    expect(noteFromFrequency(Number.NaN)).toBeNull();
  });
});

describe('formatting', () => {
  it('keeps the desktop readout shape', () => {
    expect(formatHz(456.75)).toBe('456.75Hz');
    expect(formatDb(-44.96)).toBe('-44.96dB');
    expect(formatSeconds(2.44)).toBe('2.4s');
  });

  it('always signs the cents so in-tune reads as + 0', () => {
    expect(formatNote({ name: 'G3', cents: 0 })).toBe('G3 + 0 Cents');
    expect(formatNote({ name: 'A#4', cents: -35 })).toBe('A#4 - 35 Cents');
    expect(formatNote({ name: 'C5', cents: 12 })).toBe('C5 + 12 Cents');
  });
});

describe('waveformReadout', () => {
  it('reports the peak of the column under the cursor', () => {
    // Two columns of two samples: 0.25 then 0.5.
    const frames = [block([0.25, 0.5])];

    expect(waveformReadout({ frames, columns: 2, fraction: 0.1 })?.db).toBeCloseTo(-12.04, 1);
    expect(waveformReadout({ frames, columns: 2, fraction: 0.9 })?.db).toBeCloseTo(-6.02, 1);
  });

  it('measures silence at the analysis floor', () => {
    expect(waveformReadout({ frames: [block([0, 0])], columns: 2, fraction: 0.5 })).toEqual({
      db: ANALYSIS_FLOOR_DB,
    });
  });

  it('takes the absolute value, not the signed peak', () => {
    // A fully negative column must not read as silence.
    const reading = waveformReadout({
      frames: [block([-0.5, -0.5])],
      columns: 1,
      fraction: 0.5,
    });

    expect(reading?.db).toBeCloseTo(-6.02, 1);
  });

  it('reads the requested channel', () => {
    const stereo = block([0.1, 0.8], 2);

    expect(waveformReadout({ frames: [stereo], columns: 1, fraction: 0.5 })?.db).toBeCloseTo(
      -20,
      0,
    );
    expect(
      waveformReadout({ frames: [stereo], columns: 1, fraction: 0.5, channel: 1 })?.db,
    ).toBeCloseTo(-1.94, 1);
  });

  it('has nothing to report without audio', () => {
    expect(waveformReadout({ frames: [], fraction: 0.5 })).toBeNull();
    expect(waveformReadout({ frames: [block([])], fraction: 0.5 })).toBeNull();
  });
});

describe('spectrumReadout', () => {
  const bins = Array.from({ length: ANALYSIS_BIN_COUNT }, (_unused, index) => -60 + index);

  it('reads the first and last bin at the edges of the picture', () => {
    expect(spectrumReadout({ bins, fraction: 0 })?.hz).toBe(
      binFrequencyRange(0, 48_000).center,
    );
    expect(spectrumReadout({ bins, fraction: 1 })?.hz).toBe(
      binFrequencyRange(ANALYSIS_BIN_COUNT - 1, 48_000).center,
    );
  });

  it('clamps a cursor dragged past the edge', () => {
    expect(spectrumReadout({ bins, fraction: -3 })?.db).toBe(-60);
    expect(spectrumReadout({ bins, fraction: 9 })?.db).toBe(-60 + ANALYSIS_BIN_COUNT - 1);
  });

  it('maps frequency to a note on the same bin', () => {
    const reading = spectrumReadout({ bins, fraction: 0.5 });

    expect(reading?.note?.name).toBe(noteFromFrequency(reading?.hz ?? 0)?.name);
  });

  it('has nothing to report without bins', () => {
    expect(spectrumReadout({ bins: [], fraction: 0.5 })).toBeNull();
  });
});

describe('spectrogramReadout', () => {
  // Four time rows of four bins; the newest row sits on the right.
  const rows = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0.5, 0.5, 0.5, 0.5],
  ];

  it('reads the highest bin at the top of the picture', () => {
    const top = spectrogramReadout({
      rows,
      fractionX: 1,
      fractionY: 0,
      refreshMs: 100,
    });

    expect(top?.hz).toBe(binFrequencyRange(3, 48_000).center);
  });

  it('reads the lowest bin at the bottom of the picture', () => {
    const bottom = spectrogramReadout({
      rows,
      fractionX: 1,
      fractionY: 1,
      refreshMs: 100,
    });

    expect(bottom?.hz).toBe(binFrequencyRange(0, 48_000).center);
  });

  it('turns the x axis into time ago — right edge is now', () => {
    expect(
      spectrogramReadout({ rows, fractionX: 1, fractionY: 0.5, refreshMs: 100 })?.secondsAgo,
    ).toBe(0);
    expect(
      spectrogramReadout({ rows, fractionX: 0, fractionY: 0.5, refreshMs: 100 })?.secondsAgo,
    ).toBeCloseTo(0.4, 5);
  });

  it('maps the cell unit onto the analysis floor', () => {
    // The oldest row (left edge) is silent, the newest (right edge) is at 0.5.
    const quiet = spectrogramReadout({ rows, fractionX: 0, fractionY: 0.5, refreshMs: 100 });
    const loud = spectrogramReadout({ rows, fractionX: 1, fractionY: 0.5, refreshMs: 100 });

    expect(quiet?.db).toBe(ANALYSIS_FLOOR_DB);
    expect(loud?.db).toBeCloseTo(ANALYSIS_FLOOR_DB / 2, 5);
  });

  it('has nothing to report without history', () => {
    expect(spectrogramReadout({ rows: [], fractionX: 0, fractionY: 0, refreshMs: 100 })).toBeNull();
  });
});
