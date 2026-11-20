import type { PairingPayload } from './pairing';
import { decodePcmFrame, type PcmAudioFrame, type PcmDecodeError } from '../monitoring/pcm-frame';

export type PcmConnectionState =
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'disconnected'
  | 'error';

export type SocketHandlers = {
  onOpen(): void;
  onMessage(data: unknown): void;
  onError(): void;
  onClose(): void;
};

export type SocketTransport = {
  send(data: string): void;
  close(): void;
};

export type SocketFactory = (url: string, handlers: SocketHandlers) => SocketTransport;

/**
 * What the socket needs to authenticate: the QR payload, plus the long-lived
 * device token once the server has issued one.
 */
export type PcmSocketCredentials = PairingPayload & {
  readonly deviceToken?: string | null;
};

export type PcmSocketClientCallbacks = {
  onState?: (state: PcmConnectionState) => void;
  onProtocolError?: (reason: PcmDecodeError | 'binary_before_authentication' | 'invalid_control_message') => void;
  onError?: (message: string) => void;
  /** The server accepted us; a device token means future reconnects need no QR scan. */
  onAuthenticated?: (info: { deviceToken: string | null }) => void;
  /** Liveness ping sent when the host has no audio to publish. */
  onHeartbeat?: () => void;
};

/**
 * How much audio is kept before the oldest frames are dropped.
 *
 * The host polls at 10 Hz, so a healthy stream buffers ~100 ms. The cap only
 * matters after a stall: replaying minutes of backlog would make the meters
 * lag by minutes instead of resynchronising.
 */
/**
 * How much audio the client may hold before it starts throwing the oldest away.
 *
 * This is a latency budget, not a storage limit. The pacer drains every 33 ms and
 * analyzes what it finds, so a deep queue does not make the picture smoother — it
 * makes it *older*: once the queue fills to the cap, the plot is permanently that
 * many milliseconds behind the sound. 150 ms is four analysis ticks: enough to
 * ride out one slow frame, small enough that a backlog can never become visible.
 */
export const MAX_BUFFERED_SECONDS = 0.15;

/**
 * Frames handed to the analyzer per drain.
 *
 * The newest few keep the meters' time constants honest; anything older is
 * already off-screen, and analysing it delays the frame that is on-screen.
 */
export const MAX_DRAIN_FRAMES = 3;

function createWebSocket(url: string, handlers: SocketHandlers): SocketTransport {
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  socket.onopen = () => handlers.onOpen();
  socket.onmessage = (event) => handlers.onMessage(event.data);
  socket.onerror = () => handlers.onError();
  socket.onclose = () => handlers.onClose();

  return {
    send: (data) => socket.send(data),
    close: () => socket.close(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class PcmSocketClient {
  private socket: SocketTransport | null = null;
  private generation = 0;
  private authenticated = false;
  private state: PcmConnectionState = 'disconnected';
  private frames: PcmAudioFrame[] = [];
  private bufferedSamples = 0;
  private lastDeviceToken: string | null = null;
  /** Long-lived credential presented on every handshake, if the server issued one. */
  private deviceToken: string | null = null;
  private receivedFrameCount = 0;
  private lastErrorCode: string | null = null;

  constructor(
    private readonly pairing: PcmSocketCredentials,
    private readonly callbacks: PcmSocketClientCallbacks = {},
    private readonly socketFactory: SocketFactory = createWebSocket,
  ) {
    this.deviceToken = this.pairing.deviceToken ?? null;
  }

  connect(): void {
    if (this.socket) {
      return;
    }

    const generation = ++this.generation;
    this.authenticated = false;
    this.clearFrames();
    this.receivedFrameCount = 0;
    this.lastErrorCode = null;
    this.setState('connecting');

    let socket: SocketTransport;
    try {
      socket = this.socketFactory(
        `ws://${this.pairing.address}:${this.pairing.port}${this.pairing.path}`,
        {
          onOpen: () => {
            if (!this.isCurrent(generation, socket)) {
              return;
            }
            this.setState('authenticating');
            try {
              socket.send(
                JSON.stringify({
                  type: 'authenticate',
                  version: 1,
                  token: this.pairing.token,
                  // Sent only after the first pairing: a known device is not
                  // gated by the QR code's expiry.
                  ...(this.deviceToken ? { deviceToken: this.deviceToken } : {}),
                }),
              );
            } catch {
              this.fail(generation, socket, 'Unable to send authentication request');
            }
          },
          onMessage: (data) => this.handleMessage(generation, socket, data),
          onError: () => this.fail(generation, socket, 'WebSocket connection failed'),
          onClose: () => this.handleClose(generation, socket),
        },
      );
    } catch (error) {
      this.authenticated = false;
      this.setState('error');
      this.callbacks.onError?.(
        error instanceof Error ? error.message : 'Unable to create WebSocket connection',
      );
      return;
    }
    this.socket = socket;
  }

  disconnect(): void {
    const socket = this.socket;
    this.generation += 1;
    this.socket = null;
    this.authenticated = false;
    this.clearFrames();
    this.receivedFrameCount = 0;
    socket?.close();
    this.setState('disconnected');
  }

  /** The most recent decoded frame, kept for the diagnostics screen. */
  getLatestFrame(): PcmAudioFrame | null {
    return this.frames.length === 0
      ? null
      : this.frames[this.frames.length - 1]!;
  }

  /**
   * Removes the buffered frames and returns the newest `maxFrames` of them.
   *
   * Analysis still iterates over what it is given, because duration-based meters
   * (peak hold, RMS window, VU release) advance per frame. But feeding it the
   * whole buffer is what turns a slow renderer into permanent lag: a 30-frame
   * backlog costs 30 FFTs *and* shows audio captured a second ago. Handing over
   * the newest few keeps the time constants close to real time while keeping the
   * picture attached to the present.
   */
  drainFrames(maxFrames: number = MAX_DRAIN_FRAMES): PcmAudioFrame[] {
    const limit = Math.max(1, Math.floor(maxFrames) || MAX_DRAIN_FRAMES);
    const drained =
      this.frames.length > limit ? this.frames.slice(-limit) : this.frames;
    this.frames = [];
    this.bufferedSamples = 0;

    return drained;
  }

  /** Frames waiting for the next drain; diagnostics and tests only. */
  getPendingFrameCount(): number {
    return this.frames.length;
  }

  /** Device token issued by the server on the current or a previous pairing. */
  getDeviceToken(): string | null {
    return this.lastDeviceToken;
  }

  getReceivedFrameCount(): number {
    return this.receivedFrameCount;
  }

  /**
   * Why the last attempt failed, as the server or the protocol named it.
   *
   * Retry policy lives above this client, but only the client knows whether a
   * failure was a dropped socket or a rejected pairing token.
   */
  getLastErrorCode(): string | null {
    return this.lastErrorCode;
  }

  /**
   * Drop a socket that stopped delivering audio without reporting an error.
   *
   * Emits no state change: the caller immediately reconnects, and a stray
   * `disconnected` would schedule a second, competing attempt.
   */
  forceReconnect(): void {
    const socket = this.socket;
    this.generation += 1;
    this.socket = null;
    this.authenticated = false;
    this.clearFrames();
    this.receivedFrameCount = 0;
    socket?.close();
  }

  private clearFrames(): void {
    this.frames = [];
    this.bufferedSamples = 0;
  }

  private pushFrame(frame: PcmAudioFrame): void {
    this.frames.push(frame);
    this.bufferedSamples += Number.isFinite(frame.samplesPerChannel)
      ? frame.samplesPerChannel
      : 0;

    const sampleRate =
      Number.isFinite(frame.sampleRate) && frame.sampleRate > 0
        ? frame.sampleRate
        : 48000;
    const cap = Math.max(1, Math.floor(sampleRate * MAX_BUFFERED_SECONDS));

    while (this.bufferedSamples > cap && this.frames.length > 1) {
      const dropped = this.frames.shift();
      this.bufferedSamples -=
        dropped !== undefined && Number.isFinite(dropped.samplesPerChannel)
          ? dropped.samplesPerChannel
          : 0;
    }
  }

  private handleMessage(generation: number, socket: SocketTransport, data: unknown): void {
    if (!this.isCurrent(generation, socket)) {
      return;
    }

    if (typeof data === 'string') {
      this.handleControlMessage(generation, socket, data);
      return;
    }

    if (!(data instanceof ArrayBuffer)) {
      this.fail(generation, socket, 'Unsupported WebSocket message data');
      this.callbacks.onProtocolError?.('invalid_control_message');
      return;
    }

    if (!this.authenticated) {
      this.lastErrorCode ??= 'binary_before_authentication';
      this.callbacks.onProtocolError?.('binary_before_authentication');
      return;
    }

    const result = decodePcmFrame(data);
    if (!result.ok) {
      this.lastErrorCode ??= result.reason;
      this.callbacks.onProtocolError?.(result.reason);
      return;
    }

    this.pushFrame(result.frame);
    this.receivedFrameCount += 1;
  }

  private handleControlMessage(
    generation: number,
    socket: SocketTransport,
    data: string,
  ): void {
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      this.fail(generation, socket, 'Invalid server control message');
      this.callbacks.onProtocolError?.('invalid_control_message');
      return;
    }

    if (!isRecord(message)) {
      this.fail(generation, socket, 'Invalid server control message');
      this.callbacks.onProtocolError?.('invalid_control_message');
      return;
    }

    if (message.type === 'error') {
      const code = typeof message.code === 'string' ? message.code : 'server_error';
      const detail = typeof message.message === 'string' ? message.message : code;
      this.fail(generation, socket, detail, code);
      return;
    }

    if (message.type === 'heartbeat') {
      this.callbacks.onHeartbeat?.();
      return;
    }

    if (
      message.type === 'authenticated' &&
      message.version === 1 &&
      message.sampleFormat === 'f32le'
    ) {
      this.authenticated = true;
      this.lastDeviceToken =
        typeof message.deviceToken === 'string' ? message.deviceToken : null;

      if (this.lastDeviceToken) {
        // Reuse it on every later reconnect, so an expired QR code cannot lock
        // this phone out of a plugin it has already paired with.
        this.deviceToken = this.lastDeviceToken;
      }

      this.setState('connected');
      this.callbacks.onAuthenticated?.({ deviceToken: this.lastDeviceToken });
      return;
    }

    this.fail(generation, socket, 'Unexpected server control message');
    this.callbacks.onProtocolError?.('invalid_control_message');
  }

  private handleClose(generation: number, socket: SocketTransport): void {
    if (!this.isCurrent(generation, socket)) {
      return;
    }

    this.socket = null;
    this.authenticated = false;
    this.clearFrames();
    this.receivedFrameCount = 0;
    if (this.state !== 'error') {
      this.setState('disconnected');
    }
  }

  private fail(
    generation: number,
    socket: SocketTransport,
    message: string,
    code?: string,
  ): void {
    if (!this.isCurrent(generation, socket)) {
      return;
    }

    this.authenticated = false;
    this.lastErrorCode = code ?? this.lastErrorCode ?? message;
    // Clear the socket first so the retry path can reconnect immediately and a
    // late close event cannot restart the state machine.
    this.socket = null;
    this.clearFrames();
    this.receivedFrameCount = 0;
    this.setState('error');
    this.callbacks.onError?.(message);
    socket.close();
  }

  private isCurrent(generation: number, socket: SocketTransport): boolean {
    return generation === this.generation && this.socket === socket;
  }

  private setState(state: PcmConnectionState): void {
    this.state = state;
    this.callbacks.onState?.(state);
  }
}
