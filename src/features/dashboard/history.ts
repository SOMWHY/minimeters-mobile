import { STREAM_REFRESH_MS } from '@/features/monitoring/use-pcm-stream';

/**
 * Rolling spectrogram history.
 *
 * The library draws rows oldest-first, so a new frame is appended at the end and
 * the oldest row falls off the front. Rows are `Float32Array`s; slicing instead
 * of shifting keeps this cheap enough to run per frame.
 *
 * One row per polled frame, and the stream polls every `STREAM_REFRESH_MS`, so
 * the visible window is only as long as rows × the poll interval — see
 * `SPECTROGRAM_HISTORY_SECONDS`. Deriving one from the other keeps the timeline
 * honest if the poll cadence ever changes.
 */

/** How much audio history the plot shows, in seconds. */
export const SPECTROGRAM_HISTORY_SECONDS = 4;

/** Rows kept for the scrolling plot: one per poll, so 5 s at a 100 ms cadence. */
/**
 * Ceiling on the row count. The raster is one pixel column per row and is
 * rebuilt on the JS thread, so the history stops growing at this width; the
 * visible window is `HISTORY_ROW_MS`-per-row up to that cap.
 */
export const SPECTROGRAM_MAX_ROWS = 120;

export const SPECTROGRAM_HISTORY_ROWS = Math.min(
  SPECTROGRAM_MAX_ROWS,
  Math.round((SPECTROGRAM_HISTORY_SECONDS * 1000) / STREAM_REFRESH_MS),
);

export function appendRow(
  rows: readonly Float32Array[],
  row: Float32Array | null,
  maxRows: number = SPECTROGRAM_HISTORY_ROWS,
): Float32Array[] {
  // `slice(-0)` is `slice(0)`, so a zero-row window needs its own branch.
  if (maxRows <= 0) {
    return [];
  }

  if (row === null) {
    return rows.slice(-maxRows);
  }

  const next = [...rows, row];

  return next.length > maxRows ? next.slice(next.length - maxRows) : next;
}
