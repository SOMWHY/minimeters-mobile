import { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';

import type { PcmAudioFrame } from '@/features/monitoring/pcm-frame';
import { usePcmStream, type PcmStream } from '@/features/monitoring/use-pcm-stream';

import type { SocketFactory } from './pcm-socket-client';

export type PcmConnectionValue = PcmStream & {
  /**
   * Run `listener` for every new frame.
   *
   * Frames arrive from a timer, so subscribers update state from an external
   * callback instead of an effect — no cascading renders, and two screens can
   * observe the same socket without opening a second one.
   */
  readonly subscribe: (listener: (frame: PcmAudioFrame) => void) => () => void;
};

const PcmConnectionContext = createContext<PcmConnectionValue | null>(null);

export function PcmConnectionProvider({
  children,
  socketFactory,
}: {
  children: ReactNode;
  socketFactory?: SocketFactory;
}) {
  const listenersRef = useRef(new Set<(frame: PcmAudioFrame) => void>());

  const handleFrame = useCallback((frame: PcmAudioFrame) => {
    for (const listener of listenersRef.current) {
      listener(frame);
    }
  }, []);

  const stream = usePcmStream({ socketFactory, onFrame: handleFrame });

  const subscribe = useCallback((listener: (frame: PcmAudioFrame) => void) => {
    listenersRef.current.add(listener);

    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const value = useMemo<PcmConnectionValue>(() => ({ ...stream, subscribe }), [stream, subscribe]);

  return <PcmConnectionContext.Provider value={value}>{children}</PcmConnectionContext.Provider>;
}

export function usePcmConnection(): PcmConnectionValue {
  const value = useContext(PcmConnectionContext);

  if (!value) {
    throw new Error('usePcmConnection must be used inside a PcmConnectionProvider');
  }

  return value;
}
