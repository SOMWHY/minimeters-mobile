import { useCallback, useEffect, useRef, useState } from 'react';

import { parsePairingPayload, type PairingPayload } from '@/features/connection/pairing';
import {
  PcmSocketClient,
  type PcmConnectionState,
  type PcmSocketCredentials,
  type SocketFactory,
} from '@/features/connection/pcm-socket-client';
import {
  clearPairing,
  defaultPairingStorage,
  loadPairing,
  savePairing,
  type PairingStorageDeps,
} from '@/features/connection/pairing-storage';
import {
  classifyFailure,
  nextRetryDelay,
  REAUTH_RETRY_MS,
  STALL_TIMEOUT_MS,
} from '@/features/connection/reconnect';

import type { PcmAudioFrame } from './pcm-frame';

/** How often the screen drains the client's frame buffer. */
export const STREAM_REFRESH_MS = 100;

/** Why automatic recovery gave up, for the UI to explain. */
export type FatalErrorKind = 'protocol' | 'unreachable';

export type PcmStream = {
  readonly status: PcmConnectionState;
  readonly isScanning: boolean;
  readonly isPaired: boolean;
  readonly frame: PcmAudioFrame | null;
  readonly frameCount: number;
  /** Increments for every successful authentication, so consumers can reset per session. */
  readonly sessionId: number;
  readonly reconnecting: boolean;
  /** 1-based number of the retry attempt in flight, or 0 when stable. */
  readonly retryAttempt: number;
  /** The server rejected the pairing token; the last frame stays on screen. */
  readonly reauthRequired: boolean;
  readonly fatalError: FatalErrorKind | null;
  readonly scanError: string | null;
  readonly connectionError: string | null;
  readonly protocolError: string | null;
  readonly startScan: () => void;
  readonly cancelScan: () => void;
  readonly handleQrScanned: (data: string) => void;
  readonly disconnect: () => void;
};

/**
 * Pairing, the latest-frame poll, and recovery from a dropped socket.
 *
 * The socket client buffers the newest frame; the UI pulls on a timer instead of
 * re-rendering per message, so a 30 fps stream cannot outrun the render budget.
 * A phone loses this socket routinely (backgrounding, Wi-Fi handover), so a
 * dropped connection retries with backoff, and a socket that stays open but stops
 * delivering audio is treated as dead.
 */
export function usePcmStream({
  socketFactory,
  refreshMs = STREAM_REFRESH_MS,
  onFrame,
  onFrames,
  storage = defaultPairingStorage,
}: {
  socketFactory?: SocketFactory;
  refreshMs?: number;
  /**
   * Called once per *new* frame, from the poll timer — an external subscription
   * callback, so a host may update state from here without a render cascade.
   */
  onFrame?: (frame: PcmAudioFrame) => void;
  /**
   * Called with every frame received since the previous poll, in arrival order.
   *
   * Analysis must use this rather than `onFrame`: the server publishes ~10
   * blocks per second, and a consumer that only looks at the newest one advances
   * its meters by one block per poll instead of one block per block.
   */
  onFrames?: (frames: PcmAudioFrame[]) => void;
  /** Where the last pairing is remembered; injected for tests. */
  storage?: PairingStorageDeps;
} = {}): PcmStream {
  const clientRef = useRef<PcmSocketClient | null>(null);
  const onFrameRef = useRef(onFrame);
  const onFramesRef = useRef(onFrames);
  const lastFrameRef = useRef<PcmAudioFrame | null>(null);
  const lastFrameAtRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const pairedRef = useRef(false);
  const mountedRef = useRef(false);
  const connectRef = useRef<() => void>(() => {});
  const [isScanning, setIsScanning] = useState(false);
  const [isPaired, setIsPaired] = useState(false);
  const [status, setStatus] = useState<PcmConnectionState>('disconnected');
  const [frame, setFrame] = useState<PcmAudioFrame | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [sessionId, setSessionId] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [reauthRequired, setReauthRequired] = useState(false);
  const [fatalError, setFatalError] = useState<FatalErrorKind | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [protocolError, setProtocolError] = useState<string | null>(null);

  useEffect(() => {
    onFrameRef.current = onFrame;
    onFramesRef.current = onFrames;
  }, [onFrame, onFrames]);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  /**
   * Retry the current pairing, or stop and explain why retrying cannot help.
   *
   * A rejected token keeps the session alive: the last frame stays on screen, a
   * banner asks for a re-scan, and the retry cadence slows down so a token that
   * was rejected once is not hammered. Anything else still ends the loop when
   * the backoff is spent.
   */
  const scheduleRetry = useCallback(() => {
    const client = clientRef.current;

    if (!client || !pairedRef.current) {
      return;
    }

    const kind = classifyFailure(client.getLastErrorCode());

    if (kind === 'terminal_protocol') {
      setReconnecting(false);
      setFrame(null);
      setFatalError('protocol');
      return;
    }

    if (kind === 'reauth_required') {
      setReauthRequired(true);
      setReconnecting(true);
      clearRetryTimer();
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        connectRef.current();
      }, REAUTH_RETRY_MS);
      return;
    }

    const delay = nextRetryDelay(attemptRef.current);

    if (delay === null) {
      setReconnecting(false);
      setFrame(null);
      setFatalError('unreachable');
      return;
    }

    attemptRef.current += 1;
    setRetryAttempt(attemptRef.current);
    setReconnecting(true);
    setFrame(null);

    clearRetryTimer();
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      connectRef.current();
    }, delay);
  }, [clearRetryTimer]);

  const connectNow = useCallback(() => {
    const client = clientRef.current;

    if (!client || !pairedRef.current) {
      return;
    }

    client.connect();
  }, []);

  useEffect(() => {
    connectRef.current = connectNow;
  }, [connectNow]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      pairedRef.current = false;
      clearRetryTimer();
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, [clearRetryTimer]);

  useEffect(() => {
    const client = clientRef.current;
    if (status !== 'connected' || !client) {
      return;
    }

    lastFrameAtRef.current = Date.now();

    const refresh = () => {
      const frames = client.drainFrames();

      if (frames.length > 0) {
        const latest = frames[frames.length - 1]!;

        lastFrameRef.current = latest;
        lastFrameAtRef.current = Date.now();
        setFrame(latest);
        setFrameCount(client.getReceivedFrameCount());
        onFramesRef.current?.(frames);
        onFrameRef.current?.(latest);
        return;
      }

      if (Date.now() - lastFrameAtRef.current < STALL_TIMEOUT_MS) {
        return;
      }

      // Open socket, no audio: presume it died silently and rebuild it.
      lastFrameAtRef.current = Date.now();
      client.forceReconnect();
      attemptRef.current += 1;
      setRetryAttempt(attemptRef.current);
      setReconnecting(true);
      setFrame(null);
      connectRef.current();
    };

    refresh();
    const timer = setInterval(refresh, refreshMs);

    return () => clearInterval(timer);
  }, [refreshMs, status]);

  /**
   * Connect with a set of credentials and remember them.
   *
   * Shared by the QR path and the launch path: a stored pairing reconnects with
   * no scan at all, presenting the device token the server issued last time.
   */
  const beginPairing = useCallback(
    (credentials: PcmSocketCredentials) => {
      setScanError(null);
      setConnectionError(null);
      setProtocolError(null);
      setFatalError(null);
      setReauthRequired(false);
      setFrame(null);
      setFrameCount(0);
      setIsScanning(false);
      setIsPaired(true);

      clearRetryTimer();
      attemptRef.current = 0;
      setRetryAttempt(0);
      setReconnecting(false);
      pairedRef.current = true;

      const client = new PcmSocketClient(
        credentials,
        {
          onState: (state) => {
            if (!mountedRef.current) {
              return;
            }

            setStatus(state);

            if (state === 'connected') {
              attemptRef.current = 0;
              setRetryAttempt(0);
              setReconnecting(false);
              setFatalError(null);
              setReauthRequired(false);
              setConnectionError(null);
              setFrameCount(0);
              setSessionId((current) => current + 1);
              return;
            }

            if (state === 'disconnected' || state === 'error') {
              scheduleRetry();
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
          onAuthenticated: ({ deviceToken }) => {
            // Persisting the device token is what makes the next launch (and
            // every later reconnect) independent of the QR code's lifetime.
            void savePairing(
              { ...credentials, deviceToken: deviceToken ?? credentials.deviceToken ?? null },
              storage,
            );
          },
        },
        socketFactory,
      );

      clientRef.current = client;
      client.connect();
    },
    [clearRetryTimer, scheduleRetry, socketFactory, storage],
  );

  useEffect(() => {
    let cancelled = false;

    void loadPairing(storage).then((stored) => {
      if (cancelled || stored === null || !mountedRef.current) {
        return;
      }

      beginPairing(stored);
    });

    return () => {
      cancelled = true;
    };
  }, [beginPairing, storage]);

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

      beginPairing(result.payload);
    },
    [beginPairing],
  );

  const disconnect = useCallback(() => {
    pairedRef.current = false;
    clearRetryTimer();
    attemptRef.current = 0;
    clientRef.current?.disconnect();
    clientRef.current = null;
    lastFrameRef.current = null;
    // An explicit disconnect forgets the pairing: reconnecting is the user's
    // decision, and a stale device token would reconnect behind their back.
    void clearPairing(storage);
    setRetryAttempt(0);
    setReconnecting(false);
    setReauthRequired(false);
    setFatalError(null);
    setIsPaired(false);
    setIsScanning(false);
    setStatus('disconnected');
    setFrame(null);
    setFrameCount(0);
    setConnectionError(null);
    setProtocolError(null);
  }, [clearRetryTimer, storage]);

  const startScan = useCallback(() => {
    clearRetryTimer();
    setScanError(null);
    setFatalError(null);
    setReconnecting(false);
    setIsScanning(true);
  }, [clearRetryTimer]);

  const cancelScan = useCallback(() => {
    setIsScanning(false);
  }, []);

  return {
    status,
    isScanning,
    isPaired,
    frame,
    frameCount,
    sessionId,
    reconnecting,
    retryAttempt,
    reauthRequired,
    fatalError,
    scanError,
    connectionError,
    protocolError,
    startScan,
    cancelScan,
    handleQrScanned,
    disconnect,
  };
}

export type { PairingPayload };
