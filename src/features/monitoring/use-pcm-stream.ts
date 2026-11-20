import { useCallback, useEffect, useRef, useState } from 'react';

import { parsePairingPayload } from '@/features/connection/pairing';
import {
  PcmSocketClient,
  type PcmConnectionState,
  type SocketFactory,
} from '@/features/connection/pcm-socket-client';

import type { PcmAudioFrame } from './pcm-frame';

/** How often the screen samples the client's latest frame. */
export const STREAM_REFRESH_MS = 100;

export type PcmStream = {
  readonly status: PcmConnectionState;
  readonly isScanning: boolean;
  readonly isPaired: boolean;
  readonly frame: PcmAudioFrame | null;
  readonly frameCount: number;
  readonly scanError: string | null;
  readonly connectionError: string | null;
  readonly protocolError: string | null;
  readonly startScan: () => void;
  readonly cancelScan: () => void;
  readonly handleQrScanned: (data: string) => void;
  readonly disconnect: () => void;
};

/**
 * Pairing plus the latest-frame poll.
 *
 * The socket client buffers the newest frame; the UI pulls on a timer instead of
 * re-rendering per message, so a 30 fps stream cannot outrun the render budget.
 */
export function usePcmStream({
  socketFactory,
  refreshMs = STREAM_REFRESH_MS,
  onFrame,
}: {
  socketFactory?: SocketFactory;
  refreshMs?: number;
  /**
   * Called once per *new* frame, from the poll timer — an external subscription
   * callback, so a host may update state from here without a render cascade.
   */
  onFrame?: (frame: PcmAudioFrame) => void;
} = {}): PcmStream {
  const clientRef = useRef<PcmSocketClient | null>(null);
  const onFrameRef = useRef(onFrame);
  const lastFrameRef = useRef<PcmAudioFrame | null>(null);
  const mountedRef = useRef(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isPaired, setIsPaired] = useState(false);
  const [status, setStatus] = useState<PcmConnectionState>('disconnected');
  const [frame, setFrame] = useState<PcmAudioFrame | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [protocolError, setProtocolError] = useState<string | null>(null);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, []);

  useEffect(() => {
    const client = clientRef.current;
    if (status !== 'connected' || !client) {
      return;
    }

    const refresh = () => {
      const latest = client.getLatestFrame();

      if (!latest || latest === lastFrameRef.current) {
        return;
      }

      lastFrameRef.current = latest;
      setFrame(latest);
      setFrameCount(client.getReceivedFrameCount());
      onFrameRef.current?.(latest);
    };

    refresh();
    const timer = setInterval(refresh, refreshMs);

    return () => clearInterval(timer);
  }, [refreshMs, status]);

  const handleQrScanned = useCallback(
    (data: string) => {
      const result = parsePairingPayload(data);

      if (!result.ok) {
        setScanError(
          result.reason === 'unsupported_version'
            ? 'This pairing code uses an unsupported version.'
            : 'This is not a valid MiniMeters pairing code.',
        );
        return;
      }

      setScanError(null);
      setConnectionError(null);
      setProtocolError(null);
      setFrame(null);
      setFrameCount(0);
      setIsScanning(false);
      setIsPaired(true);

      const client = new PcmSocketClient(
        result.payload,
        {
          onState: (state) => {
            if (mountedRef.current) {
              setStatus(state);
            }
          },
          onError: (message) => {
            if (mountedRef.current) {
              setConnectionError(message);
            }
          },
          onProtocolError: (reason) => {
            if (mountedRef.current) {
              setProtocolError(reason);
            }
          },
        },
        socketFactory,
      );

      clientRef.current = client;
      client.connect();
    },
    [socketFactory],
  );

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    lastFrameRef.current = null;
    setIsPaired(false);
    setIsScanning(false);
    setStatus('disconnected');
    setFrame(null);
    setFrameCount(0);
    setConnectionError(null);
    setProtocolError(null);
  }, []);

  const startScan = useCallback(() => {
    setScanError(null);
    setIsScanning(true);
  }, []);

  const cancelScan = useCallback(() => {
    setIsScanning(false);
  }, []);

  return {
    status,
    isScanning,
    isPaired,
    frame,
    frameCount,
    scanError,
    connectionError,
    protocolError,
    startScan,
    cancelScan,
    handleQrScanned,
    disconnect,
  };
}
