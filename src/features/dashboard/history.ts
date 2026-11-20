/**
 * Rolling spectrogram history.
 *
 * The library draws rows oldest-first, so a new frame is appended at the end and
 * the oldest row falls off the front. Rows are `Float32Array`s; slicing instead
 * of shifting keeps this cheap enough to run per frame.
 */

/** Rows kept for the scrolling plot; at ~30 fps this is a couple of seconds. */
export const SPECTROGRAM_HISTORY_ROWS = 48;

export function appendRow(
  rows: readonly Float32Array[],
  row: Float32Array | null,
  maxRows: number = SPECTROGRAM_HISTORY_ROWS,
): Float32Array[] {
  if (row === null || maxRows <= 0) {
    return rows.slice(-maxRows);
  }

  const next = [...rows, row];

  return next.length > maxRows ? next.slice(next.length - maxRows) : next;
}
