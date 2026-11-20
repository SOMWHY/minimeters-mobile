import { useCallback, useEffect, useRef, useState } from 'react';

import type { PcmBlock } from '@minimetermobile/ui';

import { usePcmConnection } from '@/features/connection/connection-context';
import type { FrameAnalysis } from '@/features/monitoring/analysis';
import { createAnalysisEngine } from '@/features/monitoring/engine';

import { appendRow } from './history';
import { appendScopeFrame } from './scope-history';
import { toScopeBlock } from './scope-block';

export type LiveAnalysis = {
  /**
   * Fast lane: the newest frame analysis, updated on every poll (~30 Hz).
   *
   * Only the meters read this. Everything that draws — waveform, spectrum,
   * spectrogram — uses `analysis`, which is emitted at half rate so five Skia
   * scenes are not rebuilt 30 times a second on the JS thread.
   */
  readonly meter: FrameAnalysis | null;
  /** Slow lane: what the scopes draw, emitted every `SCOPE_EMIT_EVERY_POLLS`. */
  readonly analysis: FrameAnalysis | null;
  readonly history: readonly Float32Array[];
  /** Recent scope blocks (auto-gained), oldest first, for the waveform picture. */
  readonly scopeFrames: readonly PcmBlock[];
  /** Clear the accumulated history, e.g. after disconnecting from the plugin. */
  readonly reset: () => void;
};

/**
 * Analysis of the newest frame plus the rolling spectrogram history.
 *
 * State is updated from the stream's frame subscription — an external callback —
 * so this never sets state during an effect body or during render. The engine
 * keeps the meters between frames, so it lives in a ref and is never touched
 * during render.
 *
 * A reconnect starts a new session: the engine holds peak-hold, RMS and the
 * loudness gate, all of which describe audio that is no longer playing, so the
 * first frame after `sessionId` changes begins from a clean engine and an empty
 * spectrogram rather than carrying the old device's history into the new one.
 *
 * Every frame of a poll batch is pushed, not only the newest: the engine's
 * ballistics are driven by the audio each frame carries, so skipping frames
 * scales every time constant by the skip factor.
 */
/**
 * Polls between scope emissions: 2 halves the redraw rate while keeping the
 * meters (which read the fast lane) at the stream cadence.
 */
export const SCOPE_EMIT_EVERY_POLLS = 2;

export function useLiveAnalysis(): LiveAnalysis {
  const { sessionId, subscribeFrames } = usePcmConnection();
  const [meter, setMeter] = useState<FrameAnalysis | null>(null);
  const [live, setLive] = useState<Omit<LiveAnalysis, 'reset' | 'meter'>>({
    analysis: null,
    history: [],
    scopeFrames: [],
  });
  const historyRef = useRef<readonly Float32Array[]>([]);
  const scopeFramesRef = useRef<readonly PcmBlock[]>([]);
  const pollsSinceEmitRef = useRef(0);
  const engineRef = useRef<ReturnType<typeof createAnalysisEngine> | null>(null);
  const sessionIdRef = useRef(sessionId);
  /** Session the engine's accumulated state currently belongs to. */
  const analysedSessionRef = useRef<number | null>(null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(
    () =>
      subscribeFrames((frames) => {
        if (frames.length === 0) {
          return;
        }

        const isNewSession =
          engineRef.current === null || analysedSessionRef.current !== sessionIdRef.current;
        const engine = (engineRef.current ??= createAnalysisEngine());

        if (isNewSession) {
          engine.reset();
          analysedSessionRef.current = sessionIdRef.current;
          historyRef.current = [];
          scopeFramesRef.current = [];
          pollsSinceEmitRef.current = 0;
        }

        let latest: FrameAnalysis | null = null;

        for (const frame of frames) {
          latest = engine.push(frame);
          historyRef.current = appendRow(historyRef.current, latest.spectrogramRow);
          scopeFramesRef.current = appendScopeFrame(
            scopeFramesRef.current,
            toScopeBlock(frame, latest),
          );
        }

        if (!latest) {
          return;
        }

        setMeter(latest);

        pollsSinceEmitRef.current += 1;

        if (pollsSinceEmitRef.current < SCOPE_EMIT_EVERY_POLLS) {
          return;
        }

        pollsSinceEmitRef.current = 0;
        setLive({
          analysis: latest,
          history: historyRef.current,
          scopeFrames: scopeFramesRef.current,
        });
      }),
    [subscribeFrames],
  );

  const reset = useCallback(() => {
    engineRef.current?.reset();
    historyRef.current = [];
    scopeFramesRef.current = [];
    pollsSinceEmitRef.current = 0;
    setMeter(null);
    setLive({ analysis: null, history: [], scopeFrames: [] });
  }, []);

  return { ...live, meter, reset };
}
