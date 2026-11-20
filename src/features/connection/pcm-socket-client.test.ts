import { pcmPairing } from './test-fixtures';
import { PcmSocketClient, type SocketHandlers } from './pcm-socket-client';

type FakeSocket = {
  handlers: SocketHandlers;
  send: jest.Mock<void, [string]>;
  close: jest.Mock<void, []>;
};

function createFakeSocket() {
  let fakeSocket: FakeSocket | undefined;
  const factory = jest.fn((_url: string, handlers: SocketHandlers) => {
    fakeSocket = {
      handlers,
      send: jest.fn(),
      close: jest.fn(),
    };
    return fakeSocket;
  });

  return {
    factory,
    get socket() {
      if (!fakeSocket) {
        throw new Error('Socket has not been created');
      }
      return fakeSocket;
    },
  };
}

function makeStereoFrame(): ArrayBuffer {
  const buffer = new ArrayBuffer(40);
  const view = new DataView(buffer);
  for (const [index, byte] of [...'MMSA'].entries()) {
    view.setUint8(index, byte.charCodeAt(0));
  }
  view.setUint8(4, 1);
  view.setUint8(5, 1);
  view.setUint16(6, 32, true);
  view.setUint32(8, 321, true);
  view.setUint32(16, 48000, true);
  view.setUint16(20, 2, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 1, true);
  view.setUint32(28, 8, true);
  view.setFloat32(32, 0.5, true);
  view.setFloat32(36, -0.5, true);
  return buffer;
}

describe('PcmSocketClient', () => {
  it('authenticates before accepting binary audio', () => {
    const fake = createFakeSocket();
    const onState = jest.fn();
    const onProtocolError = jest.fn();
    const client = new PcmSocketClient(pcmPairing, { onState, onProtocolError }, fake.factory);

    client.connect();

    expect(onState).toHaveBeenLastCalledWith('connecting');
    expect(fake.factory).toHaveBeenCalledWith('ws://192.168.1.20:8422/ws', expect.any(Object));

    fake.socket.handlers.onOpen();
    expect(onState).toHaveBeenLastCalledWith('authenticating');
    expect(fake.socket.send).toHaveBeenCalledWith(
      '{"type":"authenticate","version":1,"token":"0123456789abcdef"}',
    );

    fake.socket.handlers.onMessage(makeStereoFrame());
    expect(client.getLatestFrame()).toBeNull();
    expect(onProtocolError).toHaveBeenCalledWith('binary_before_authentication');

    fake.socket.handlers.onMessage(
      JSON.stringify({ type: 'authenticated', version: 1, sampleFormat: 'f32le' }),
    );
    expect(onState).toHaveBeenLastCalledWith('connected');

    fake.socket.handlers.onMessage(makeStereoFrame());
    expect(client.getLatestFrame()?.timestampMs).toBe(321);
    expect(Array.from(client.getLatestFrame()?.samples ?? [])).toEqual([0.5, -0.5]);
    expect(client.getReceivedFrameCount()).toBe(1);
  });

  it('reports server authentication errors and closes the socket', () => {
    const fake = createFakeSocket();
    const onState = jest.fn();
    const onError = jest.fn();
    const client = new PcmSocketClient(pcmPairing, { onState, onError }, fake.factory);

    client.connect();
    fake.socket.handlers.onOpen();
    fake.socket.handlers.onMessage(JSON.stringify({ type: 'error', code: 'invalid_token' }));

    expect(onState).toHaveBeenLastCalledWith('error');
    expect(onError).toHaveBeenCalledWith('invalid_token');
    expect(fake.socket.close).toHaveBeenCalledTimes(1);
    fake.socket.handlers.onClose();
    expect(onState).toHaveBeenLastCalledWith('error');
  });

  it('rejects malformed frames while retaining later valid frames', () => {
    const fake = createFakeSocket();
    const onProtocolError = jest.fn();
    const client = new PcmSocketClient(pcmPairing, { onProtocolError }, fake.factory);

    client.connect();
    fake.socket.handlers.onOpen();
    fake.socket.handlers.onMessage(
      JSON.stringify({ type: 'authenticated', version: 1, sampleFormat: 'f32le' }),
    );

    const invalidFrame = makeStereoFrame();
    new DataView(invalidFrame).setUint8(0, 0);
    fake.socket.handlers.onMessage(invalidFrame);
    expect(client.getLatestFrame()).toBeNull();
    expect(client.getReceivedFrameCount()).toBe(0);
    expect(onProtocolError).toHaveBeenCalledWith('invalid_magic');

    fake.socket.handlers.onMessage(makeStereoFrame());
    expect(client.getReceivedFrameCount()).toBe(1);
  });

  it('closes and clears the active session on disconnect', () => {
    const fake = createFakeSocket();
    const onState = jest.fn();
    const client = new PcmSocketClient(pcmPairing, { onState }, fake.factory);
    client.connect();
    fake.socket.handlers.onOpen();
    fake.socket.handlers.onMessage(
      JSON.stringify({ type: 'authenticated', version: 1, sampleFormat: 'f32le' }),
    );
    fake.socket.handlers.onMessage(makeStereoFrame());

    client.disconnect();
    expect(fake.socket.close).toHaveBeenCalledTimes(1);
    expect(client.getLatestFrame()).toBeNull();
    expect(client.getReceivedFrameCount()).toBe(0);
    expect(onState).toHaveBeenLastCalledWith('disconnected');

    fake.socket.handlers.onMessage(makeStereoFrame());
    expect(client.getLatestFrame()).toBeNull();
    expect(onState).toHaveBeenLastCalledWith('disconnected');
  });

  it('does not open a second socket while one is active', () => {
    const fake = createFakeSocket();
    const client = new PcmSocketClient(pcmPairing, {}, fake.factory);

    client.connect();
    client.connect();

    expect(fake.factory).toHaveBeenCalledTimes(1);
  });

  it('drains every buffered frame so analysis never skips audio', () => {
    const fake = createFakeSocket();
    const client = new PcmSocketClient(pcmPairing, {}, fake.factory);

    client.connect();
    fake.socket.handlers.onOpen();
    fake.socket.handlers.onMessage(
      JSON.stringify({ type: 'authenticated', version: 1, sampleFormat: 'f32le' }),
    );
    // The server publishes ~10 blocks per second; a 10 Hz poll receives three
    // of them between ticks, and all three must reach the analysis engine.
    fake.socket.handlers.onMessage(makeStereoFrame());
    fake.socket.handlers.onMessage(makeStereoFrame());
    fake.socket.handlers.onMessage(makeStereoFrame());

    expect(client.getPendingFrameCount()).toBe(3);

    const drained = client.drainFrames();

    expect(drained).toHaveLength(3);
    expect(client.getPendingFrameCount()).toBe(0);
    // A drained buffer leaves the diagnostic "latest frame" empty rather than
    // replaying a frame the analyser has already consumed.
    expect(client.getLatestFrame()).toBeNull();
    expect(client.getReceivedFrameCount()).toBe(3);
  });

  it('keeps the device token the server issues on authentication', () => {
    const fake = createFakeSocket();
    const onAuthenticated = jest.fn();
    const client = new PcmSocketClient(pcmPairing, { onAuthenticated }, fake.factory);

    client.connect();
    fake.socket.handlers.onOpen();
    fake.socket.handlers.onMessage(
      JSON.stringify({
        type: 'authenticated',
        version: 1,
        sampleFormat: 'f32le',
        deviceToken: 'a'.repeat(32),
      }),
    );

    expect(client.getDeviceToken()).toBe('a'.repeat(32));
    expect(onAuthenticated).toHaveBeenCalledWith({ deviceToken: 'a'.repeat(32) });
  });

  it('accepts a heartbeat as liveness without inventing audio', () => {
    const fake = createFakeSocket();
    const onHeartbeat = jest.fn();
    const client = new PcmSocketClient(pcmPairing, { onHeartbeat }, fake.factory);

    client.connect();
    fake.socket.handlers.onOpen();
    fake.socket.handlers.onMessage(
      JSON.stringify({ type: 'authenticated', version: 1, sampleFormat: 'f32le' }),
    );
    fake.socket.handlers.onMessage(JSON.stringify({ type: 'heartbeat' }));

    expect(onHeartbeat).toHaveBeenCalledTimes(1);
    expect(client.getPendingFrameCount()).toBe(0);
    expect(client.getLatestFrame()).toBeNull();
  });
});
