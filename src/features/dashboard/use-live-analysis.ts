import { useCallback, useEffect, useState } from 'react';

import { usePcmConnection } from '@/features/connection/connection-context';
import { analyseFrame, type FrameAnalysis } from '@/features/monitoring/analysis';

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
 * so this never sets state during an effect body or during render.
 */
export function useLiveAnalysis(): LiveAnalysis {
  const { subscribe } = usePcmConnection();
  const [live, setLive] = useState<Omit<LiveAnalysis, 'reset'>>({
    analysis: null,
    history: [],
  });

  useEffect(
    () =>
      subscribe((frame) => {
        setLive((previous) => {
          const analysis = analyseFrame(frame);

          return {
            analysis,
            history: appendRow(previous.history, analysis.spectrogramRow),
          };
        });
      }),
    [subscribe],
  );

  const reset = useCallback(() => setLive({ analysis: null, history: [] }), []);

  return { ...live, reset };
}
