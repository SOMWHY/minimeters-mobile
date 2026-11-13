const HEADER_SIZE = 32;
const PROTOCOL_VERSION = 1;
const AUDIO_MESSAGE_TYPE = 1;
const FLOAT32_LE_SAMPLE_FORMAT = 1;
const MAX_CHANNELS = 2;
const MAX_DISPLAY_ROWS = 8;

export type PcmAudioFrame = {
  timestampMs: number;
  sampleRate: number;
  channels: number;
  samplesPerChannel: number;
  samples: Float32Array;
};

export type PcmDecodeError =
  | 'short_header'
  | 'invalid_magic'
  | 'unsupported_version'
  | 'unsupported_message_type'
  | 'invalid_header_size'
  | 'unsupported_sample_format'
  | 'invalid_metadata'
  | 'invalid_payload_size';

export type PcmDecodeResult =
  | { ok: true; frame: PcmAudioFrame }
  | { ok: false; reason: PcmDecodeError };

export type SampleRow = {
  index: number;
  values: number[];
};

export function decodePcmFrame(data: ArrayBuffer): PcmDecodeResult {
  if (data.byteLength < HEADER_SIZE) {
    return { ok: false, reason: 'short_header' };
  }

  const view = new DataView(data);
  if (
    view.getUint8(0) !== 0x4d ||
    view.getUint8(1) !== 0x4d ||
    view.getUint8(2) !== 0x53 ||
    view.getUint8(3) !== 0x41
  ) {
    return { ok: false, reason: 'invalid_magic' };
  }

  if (view.getUint8(4) !== PROTOCOL_VERSION) {
    return { ok: false, reason: 'unsupported_version' };
  }
  if (view.getUint8(5) !== AUDIO_MESSAGE_TYPE) {
    return { ok: false, reason: 'unsupported_message_type' };
  }
  if (view.getUint16(6, true) !== HEADER_SIZE) {
    return { ok: false, reason: 'invalid_header_size' };
  }
  if (view.getUint32(24, true) !== FLOAT32_LE_SAMPLE_FORMAT) {
    return { ok: false, reason: 'unsupported_sample_format' };
  }

  const timestampLow = view.getUint32(8, true);
  const timestampHigh = view.getUint32(12, true);
  const timestampMs = timestampLow + timestampHigh * 2 ** 32;
  const sampleRate = view.getUint32(16, true);
  const channels = view.getUint16(20, true);
  const samplesPerChannel = view.getUint16(22, true);
  const payloadSize = view.getUint32(28, true);

  if (
    !Number.isSafeInteger(timestampMs) ||
    sampleRate === 0 ||
    channels < 1 ||
    channels > MAX_CHANNELS ||
    samplesPerChannel === 0
  ) {
    return { ok: false, reason: 'invalid_metadata' };
  }

  const sampleCount = channels * samplesPerChannel;
  const expectedPayloadSize = sampleCount * Float32Array.BYTES_PER_ELEMENT;
  if (
    payloadSize !== expectedPayloadSize ||
    data.byteLength !== HEADER_SIZE + expectedPayloadSize
  ) {
    return { ok: false, reason: 'invalid_payload_size' };
  }

  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = view.getFloat32(HEADER_SIZE + index * Float32Array.BYTES_PER_ELEMENT, true);
  }

  return {
    ok: true,
    frame: { timestampMs, sampleRate, channels, samplesPerChannel, samples },
  };
}

export function selectSampleRows(frame: PcmAudioFrame): SampleRow[] {
  const rowCount = Math.min(MAX_DISPLAY_ROWS, frame.samplesPerChannel);
  const rows: SampleRow[] = [];

  for (let index = 0; index < rowCount; index += 1) {
    const values: number[] = [];
    for (let channel = 0; channel < frame.channels; channel += 1) {
      values.push(frame.samples[index * frame.channels + channel]);
    }
    rows.push({ index, values });
  }

  return rows;
}
