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

export type PcmSocketClientCallbacks = {
  onState?: (state: PcmConnectionState) => void;
  onProtocolError?: (reason: PcmDecodeError | 'binary_before_authentication' | 'invalid_control_message') => void;
  onError?: (message: string) => void;
};

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
  private latestFrame: PcmAudioFrame | null = null;
  private receivedFrameCount = 0;

  constructor(
    private readonly pairing: PairingPayload,
    private readonly callbacks: PcmSocketClientCallbacks = {},
    private readonly socketFactory: SocketFactory = createWebSocket,
  ) {}

  connect(): void {
    if (this.socket) {
      return;
    }

    const generation = ++this.generation;
    this.authenticated = false;
    this.latestFrame = null;
    this.receivedFrameCount = 0;
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
    this.latestFrame = null;
    this.receivedFrameCount = 0;
    socket?.close();
    this.setState('disconnected');
  }

  getLatestFrame(): PcmAudioFrame | null {
    return this.latestFrame;
  }

  getReceivedFrameCount(): number {
    return this.receivedFrameCount;
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
      this.callbacks.onProtocolError?.('binary_before_authentication');
      return;
    }

    const result = decodePcmFrame(data);
    if (!result.ok) {
      this.callbacks.onProtocolError?.(result.reason);
      return;
    }

    this.latestFrame = result.frame;
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
      this.fail(generation, socket, detail);
      return;
    }

    if (
      message.type === 'authenticated' &&
      message.version === 1 &&
      message.sampleFormat === 'f32le'
    ) {
      this.authenticated = true;
      this.setState('connected');
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
    this.latestFrame = null;
    this.receivedFrameCount = 0;
    if (this.state !== 'error') {
      this.setState('disconnected');
    }
  }

  private fail(generation: number, socket: SocketTransport, message: string): void {
    if (!this.isCurrent(generation, socket)) {
      return;
    }

    this.authenticated = false;
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
