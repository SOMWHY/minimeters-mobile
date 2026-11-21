import { STREAM_REFRESH_MS } from '@/features/monitoring/use-pcm-stream';

import {
  appendRow,
  SPECTROGRAM_HISTORY_ROWS,
  SPECTROGRAM_HISTORY_SECONDS,
} from './history';

const row = (value: number): Float32Array => new Float32Array([value]);

describe('spectrogram history window', () => {
  it('covers the configured number of seconds at the real poll cadence', () => {
    // One row per polled frame: this is the assumption the plot's timeline rests
    // on, so a change to either constant has to fail here. The row count is
    // capped, so the window rounds down to whole rows rather than matching the
    // nominal duration exactly.
    const window = SPECTROGRAM_HISTORY_ROWS * STREAM_REFRESH_MS;

    expect(window).toBeLessThanOrEqual(SPECTROGRAM_HISTORY_SECONDS * 1000);
    expect(window).toBeGreaterThan(
      SPECTROGRAM_HISTORY_SECONDS * 1000 - 2 * STREAM_REFRESH_MS,
    );
  });

  it('keeps 4 s of history at the 33 ms poll cadence', () => {
    expect(STREAM_REFRESH_MS).toBe(33);
    expect(SPECTROGRAM_HISTORY_ROWS).toBe(120);
  });
});

describe('appendRow', () => {
  it('appends the newest row last, where the plot draws it', () => {
    const rows = appendRow(appendRow([], row(1)), row(2));

    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toBe(1);
    expect(rows[1][0]).toBe(2);
  });

  it('drops the oldest row once the window is full', () => {
    let rows: Float32Array[] = [];

    for (let index = 0; index < SPECTROGRAM_HISTORY_ROWS + 5; index += 1) {
      rows = appendRow(rows, row(index));
    }

    expect(rows).toHaveLength(SPECTROGRAM_HISTORY_ROWS);
    expect(rows[0][0]).toBe(5);
    expect(rows[rows.length - 1][0]).toBe(SPECTROGRAM_HISTORY_ROWS + 4);
  });

  it('truncates instead of appending a null row', () => {
    const rows = appendRow([row(1), row(2), row(3)], null, 2);

    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe(3);
  });

  it('returns nothing for a zero-row window', () => {
    expect(appendRow([row(1)], row(2), 0)).toEqual([]);
  });

  it('does not mutate the array it was given', () => {
    const original = [row(1)];

    appendRow(original, row(2));

    expect(original).toHaveLength(1);
  });
});
