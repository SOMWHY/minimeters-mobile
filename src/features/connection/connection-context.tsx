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
  /**
   * Run `listener` once per poll with **every** frame received since the last
   * poll, in arrival order.
   *
   * Analysis subscribers must use this rather than `subscribe`: the socket
   * buffers ~10 blocks per second and dropping all but the newest one makes
   * duration-based meters advance far slower than wall-clock time.
   */
  readonly subscribeFrames: (
    listener: (frames: PcmAudioFrame[]) => void,
  ) => () => void;
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
  const frameListenersRef = useRef(new Set<(frames: PcmAudioFrame[]) => void>());

  const handleFrame = useCallback((frame: PcmAudioFrame) => {
    for (const listener of listenersRef.current) {
      listener(frame);
    }
  }, []);

  const handleFrames = useCallback((frames: PcmAudioFrame[]) => {
    for (const listener of frameListenersRef.current) {
      listener(frames);
    }
  }, []);

  const stream = usePcmStream({
    socketFactory,
    onFrame: handleFrame,
    onFrames: handleFrames,
  });

  const subscribe = useCallback((listener: (frame: PcmAudioFrame) => void) => {
    listenersRef.current.add(listener);

    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const subscribeFrames = useCallback(
    (listener: (frames: PcmAudioFrame[]) => void) => {
      frameListenersRef.current.add(listener);

      return () => {
        frameListenersRef.current.delete(listener);
      };
    },
    [],
  );

  const value = useMemo<PcmConnectionValue>(
    () => ({ ...stream, subscribe, subscribeFrames }),
    [stream, subscribe, subscribeFrames],
  );

  return <PcmConnectionContext.Provider value={value}>{children}</PcmConnectionContext.Provider>;
}

export function usePcmConnection(): PcmConnectionValue {
  const value = useContext(PcmConnectionContext);

  if (!value) {
    throw new Error('usePcmConnection must be used inside a PcmConnectionProvider');
  }

  return value;
}
