import { useCallback, useEffect, useRef, useState } from 'react';

import { usePcmConnection } from '@/features/connection/connection-context';
import type { FrameAnalysis } from '@/features/monitoring/analysis';
import { createAnalysisEngine } from '@/features/monitoring/engine';

import { appendRow } from './history';

export type LiveAnalysis = {
  readonly analysis: FrameAnalysis | null;
  readonly history: readonly Float32Array[];
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
 */
export function useLiveAnalysis(): LiveAnalysis {
  const { subscribe } = usePcmConnection();
  const [live, setLive] = useState<Omit<LiveAnalysis, 'reset'>>({
    analysis: null,
    history: [],
  });
  const engineRef = useRef<ReturnType<typeof createAnalysisEngine> | null>(null);

  useEffect(
    () =>
      subscribe((frame) => {
        engineRef.current ??= createAnalysisEngine();
        const engine = engineRef.current;

        setLive((previous) => {
          const analysis = engine.push(frame);

          return {
            analysis,
            history: appendRow(previous.history, analysis.spectrogramRow),
          };
        });
      }),
    [subscribe],
  );

  const reset = useCallback(() => {
    engineRef.current?.reset();
    setLive({ analysis: null, history: [] });
  }, []);

  return { ...live, reset };
}
