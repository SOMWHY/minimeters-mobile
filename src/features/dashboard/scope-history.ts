// Deep import, not the package barrel: the barrel pulls `react-native-skia`,
// which Jest cannot load in this workspace (see the deep-import note in TODO).
import { WAVEFORM_HISTORY_SECONDS } from '@minimetermobile/ui/dist/modules/waveform/history';
import type { PcmBlock } from '@minimetermobile/ui';

import { STREAM_REFRESH_MS } from '@/features/monitoring/use-pcm-stream';

/**
 * Rolling waveform history.
 *
 * The waveform card is a picture of the recent past, so it needs more than the
 * newest block: one entry per polled frame, covering `WAVEFORM_HISTORY_SECONDS`.
 * Frames carry the auto-gained samples the scopes already draw, so the history
 * and the oscilloscope agree on scale.
 */

/** Frames kept for the scrolling envelope: 3 s at a 100 ms cadence. */
export const WAVEFORM_HISTORY_FRAMES = Math.max(
  1,
  Math.round((WAVEFORM_HISTORY_SECONDS * 1000) / STREAM_REFRESH_MS),
);

export function appendScopeFrame(
  frames: readonly PcmBlock[],
  frame: PcmBlock | null,
  maxFrames: number = WAVEFORM_HISTORY_FRAMES,
): PcmBlock[] {
  // `slice(-0)` is `slice(0)`, so a zero-length window needs its own branch.
  if (maxFrames <= 0) {
    return [];
  }

  if (frame === null) {
    return frames.slice(-maxFrames);
  }

  const next = [...frames, frame];

  return next.length > maxFrames ? next.slice(next.length - maxFrames) : next;
}
