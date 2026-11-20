import { useSyncExternalStore } from 'react';

/**
 * Dev-only numbers behind "the meters feel laggy".
 *
 * The visual latency has three separable parts and they need different fixes:
 *
 * - `queueMs` — how much audio is waiting in our own buffer. Non-zero means we
 *   are processing slower than the server sends (JS thread saturated, or the
 *   render pass is too expensive). Fixed by dropping frames, not by the network.
 * - `drainMs` — wall time the analysis + state update for one drain took. If this
 *   approaches `queueMs`'s per-frame cost we are on the edge of falling behind.
 * - `gapMs` — interval between drains that actually had frames. It should track
 *   the server's cadence; a large gap means the network or the socket callback
 *   is batching messages.
 *
 * They are read at 2 Hz through `useStreamMetrics()` so the readout itself does
 * not add re-renders to the thing it is measuring.
 */
export type StreamMetrics = {
  /** Audio time sitting in the client buffer when the drain started, ms. */
  readonly queueMs: number;
  /** Wall time of the drain + analysis pass, ms. */
  readonly drainMs: number;
  /** Interval between drains that had frames, ms. */
  readonly gapMs: number;
  /** Frames taken by the last drain. */
  readonly frames: number;
  /** Frames that were waiting when the drain started. */
  readonly pending: number;
  /** Frames the drain cap or the buffer cap threw away. */
  readonly dropped: number;
  /** Interval between the last two binary messages from the server, ms. */
  readonly msgGapMs: number;
  /** Wall time spent analysing the drained frames (FFT, loudness, history). */
  readonly analyzeMs: number;
};

const EMPTY: StreamMetrics = {
  queueMs: 0,
  drainMs: 0,
  gapMs: 0,
  frames: 0,
  pending: 0,
  dropped: 0,
  msgGapMs: 0,
  analyzeMs: 0,
};

let current: StreamMetrics = EMPTY;
let lastDrainAt = 0;
const listeners = new Set<() => void>();

/**
 * Recording switch shared by the overlay and the drain loop.
 *
 * On in dev, and in a `--no-dev` bundle when `EXPO_PUBLIC_STREAM_METRICS=1` is
 * set — that is the only way to read numbers from a release-like JS runtime
 * without building a native release. Both the display and the recording must
 * agree, otherwise a production-mode run shows an empty readout.
 */
export const STREAM_METRICS_ENABLED =
  __DEV__ || process.env.EXPO_PUBLIC_STREAM_METRICS === '1';

/**
 * Called once per drain that had frames. The gap is measured here so callers do
 * not have to carry a timestamp of their own.
 */
export function recordStreamDrain(next: {
  readonly queueMs: number;
  readonly drainMs: number;
  readonly frames: number;
  readonly pending: number;
  readonly dropped: number;
  readonly msgGapMs: number;
  readonly analyzeMs: number;
}): void {
  const now = Date.now();
  const gapMs = lastDrainAt === 0 ? 0 : now - lastDrainAt;

  lastDrainAt = now;
  current = { ...next, gapMs };

  for (const listener of listeners) {
    listener();
  }
}

export function resetStreamMetrics(): void {
  current = EMPTY;
  lastDrainAt = 0;

  for (const listener of listeners) {
    listener();
  }
}

export function getStreamMetrics(): StreamMetrics {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function useStreamMetrics(): StreamMetrics {
  return useSyncExternalStore(subscribe, getStreamMetrics, getStreamMetrics);
}

/** One compact line for the settings panel. */
export function formatStreamMetrics(metrics: StreamMetrics): string {
  const queue = Math.round(metrics.queueMs);
  const drain = metrics.drainMs.toFixed(1);
  const gap = Math.round(metrics.gapMs);

  return [
    `lag: ${queue} ms waiting`,
    `work: ${drain} ms per pass`,
    `arrive: every ${gap} ms`,
    `${metrics.frames}/${metrics.pending} frames, ${metrics.dropped} dropped`,
    `wire: every ${Math.round(metrics.msgGapMs)} ms`,
    `analyze: ${metrics.analyzeMs} ms`,
  ].join("\n");
}

let lastAnalyzeMs = 0;

/** Reported by the analysis hook; read by the next drain for the readout. */
export function setAnalyzeMs(ms: number): void {
  lastAnalyzeMs = ms;
}

export function getAnalyzeMs(): number {
  return lastAnalyzeMs;
}
