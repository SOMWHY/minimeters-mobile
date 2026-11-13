import { decodePcmFrame, selectSampleRows, type PcmDecodeError } from './pcm-frame';

function makeFrame({
  channels = 2,
  sampleRate = 48000,
  samples = [0.25, -0.5, 0.75, -1],
  timestamp = 123,
}: {
  channels?: number;
  sampleRate?: number;
  samples?: number[];
  timestamp?: number;
} = {}): ArrayBuffer {
  const samplesPerChannel = samples.length / channels;
  const payloadSize = samples.length * Float32Array.BYTES_PER_ELEMENT;
  const buffer = new ArrayBuffer(32 + payloadSize);
  const view = new DataView(buffer);

  for (const [index, byte] of [...'MMSA'].entries()) {
    view.setUint8(index, byte.charCodeAt(0));
  }
  view.setUint8(4, 1);
  view.setUint8(5, 1);
  view.setUint16(6, 32, true);
  view.setUint32(8, timestamp >>> 0, true);
  view.setUint32(12, Math.floor(timestamp / 2 ** 32), true);
  view.setUint32(16, sampleRate, true);
  view.setUint16(20, channels, true);
  view.setUint16(22, samplesPerChannel, true);
  view.setUint32(24, 1, true);
  view.setUint32(28, payloadSize, true);
  samples.forEach((sample, index) => {
    view.setFloat32(32 + index * 4, sample, true);
  });

  return buffer;
}

describe('decodePcmFrame', () => {
  it('decodes protocol v1 stereo samples and metadata', () => {
    const result = decodePcmFrame(makeFrame());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.frame).toMatchObject({
      timestampMs: 123,
      sampleRate: 48000,
      channels: 2,
      samplesPerChannel: 2,
    });
    expect(Array.from(result.frame.samples)).toEqual([0.25, -0.5, 0.75, -1]);
    expect(selectSampleRows(result.frame)).toEqual([
      { index: 0, values: [0.25, -0.5] },
      { index: 1, values: [0.75, -1] },
    ]);
  });

  it('projects mono samples without adding a second channel', () => {
    const result = decodePcmFrame(makeFrame({ channels: 1, samples: [0.1, -0.2] }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      const rows = selectSampleRows(result.frame);
      expect(rows).toHaveLength(2);
      expect(rows[0].values[0]).toBeCloseTo(0.1);
      expect(rows[1].values[0]).toBeCloseTo(-0.2);
    }
  });

  it('limits the display projection to eight sample rows', () => {
    const samples = Array.from({ length: 20 }, (_, index) => index / 20);
    const result = decodePcmFrame(makeFrame({ channels: 1, samples }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(selectSampleRows(result.frame)).toHaveLength(8);
      expect(selectSampleRows(result.frame)[7].index).toBe(7);
      expect(selectSampleRows(result.frame)[7].values[0]).toBeCloseTo(0.35);
    }
  });

  it('rejects invalid headers and metadata', () => {
    const cases: {
      name: string;
      buffer: ArrayBuffer;
      reason: PcmDecodeError;
      mutate?: (frame: ArrayBuffer) => void;
    }[] = [
      { name: 'short header', buffer: new ArrayBuffer(31), reason: 'short_header' },
      {
        name: 'bad magic',
        buffer: makeFrame(),
        reason: 'invalid_magic',
        mutate: (frame) => new DataView(frame).setUint8(0, 0),
      },
      {
        name: 'bad version',
        buffer: makeFrame(),
        reason: 'unsupported_version',
        mutate: (frame) => new DataView(frame).setUint8(4, 2),
      },
      {
        name: 'bad message type',
        buffer: makeFrame(),
        reason: 'unsupported_message_type',
        mutate: (frame) => new DataView(frame).setUint8(5, 2),
      },
      {
        name: 'bad header size',
        buffer: makeFrame(),
        reason: 'invalid_header_size',
        mutate: (frame) => new DataView(frame).setUint16(6, 31, true),
      },
      {
        name: 'bad sample format',
        buffer: makeFrame(),
        reason: 'unsupported_sample_format',
        mutate: (frame) => new DataView(frame).setUint32(24, 2, true),
      },
      {
        name: 'zero channel count',
        buffer: makeFrame(),
        reason: 'invalid_metadata',
        mutate: (frame) => new DataView(frame).setUint16(20, 0, true),
      },
      {
        name: 'unsupported channel count',
        buffer: makeFrame(),
        reason: 'invalid_metadata',
        mutate: (frame) => new DataView(frame).setUint16(20, 3, true),
      },
      {
        name: 'zero sample rate',
        buffer: makeFrame(),
        reason: 'invalid_metadata',
        mutate: (frame) => new DataView(frame).setUint32(16, 0, true),
      },
      {
        name: 'payload size mismatch',
        buffer: makeFrame(),
        reason: 'invalid_payload_size',
        mutate: (frame) => new DataView(frame).setUint32(28, 12, true),
      },
    ];

    for (const testCase of cases) {
      const buffer = testCase.buffer.slice(0);
      testCase.mutate?.(buffer);
      expect(decodePcmFrame(buffer)).toEqual({ ok: false, reason: testCase.reason });
    }
  });

  it('rejects a truncated payload', () => {
    const frame = makeFrame();
    expect(decodePcmFrame(frame.slice(0, frame.byteLength - 1))).toEqual({
      ok: false,
      reason: 'invalid_payload_size',
    });
  });
});
