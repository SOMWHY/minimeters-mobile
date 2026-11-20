import type { PcmBlock } from '@minimetermobile/ui';

import { ANALYSIS_FLOOR_DB, binFrequencyRange } from '@/features/monitoring/analysis';

/**
 * Columns the waveform picture is split into.
 *
 * The readout has to sample the *same* columns the library drew, so the host
 * passes this explicitly instead of relying on the library default staying put.
 */
export const WAVEFORM_COLUMNS = 96;

/** Fallback when the stream has not told us a rate yet. */
export const DEFAULT_SAMPLE_RATE = 48_000;

const A4_HZ = 440;
const A4_MIDI = 69;
const NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

export type NoteReading = {
  /** Scientific pitch name with octave, e.g. `A#4`. */
  readonly name: string;
  /** Detune from that note, rounded to whole cents (negative = below). */
  readonly cents: number;
};

/**
 * Nearest equal-tempered note to `hz`, A4 = 440.
 *
 * Returns `null` for frequencies that have no note (0 Hz, negatives, NaN) so the
 * readout can drop the segment instead of printing `C-1`.
 */
export function noteFromFrequency(hz: number): NoteReading | null {
  if (!Number.isFinite(hz) || hz <= 0) {
    return null;
  }

  const exact = A4_MIDI + 12 * Math.log2(hz / A4_HZ);
  const midi = Math.round(exact);
  const index = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;

  return { name: `${NOTE_NAMES[index]}${octave}`, cents: Math.round((exact - midi) * 100) };
}

/** `456.75Hz` */
export function formatHz(hz: number): string {
  return `${hz.toFixed(2)}Hz`;
}

/** `-44.96dB` */
export function formatDb(db: number): string {
  return `${db.toFixed(2)}dB`;
}

/** `A#4 - 35 Cents` — always signed, so `+ 0 Cents` reads as in tune. */
export function formatNote(reading: NoteReading): string {
  const sign = reading.cents < 0 ? '-' : '+';

  return `${reading.name} ${sign} ${Math.abs(reading.cents)} Cents`;
}

/** `2.4s` */
export function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}

function sampleLength(block: PcmBlock): number {
  const channels = Math.max(1, Math.floor(block.channels) || 1);

  return Math.max(0, Math.floor(block.samplesPerChannel || 0)) ||
    Math.floor(block.samples.length / channels);
}

function sampleAt(block: PcmBlock, sampleIndex: number, channel: number): number {
  const channels = Math.max(1, Math.floor(block.channels) || 1);
  const picked = Math.min(Math.max(0, channel), channels - 1);
  const value = block.samples[sampleIndex * channels + picked];

  return Number.isFinite(value) ? value : 0;
}

function toDb(peak: number): number {
  if (!Number.isFinite(peak) || peak <= 0) {
    return ANALYSIS_FLOOR_DB;
  }

  return Math.max(ANALYSIS_FLOOR_DB, 20 * Math.log10(peak));
}

/**
 * Peak level of the waveform column under the cursor.
 *
 * Mirrors `envelopeFromFrames`: frames are concatenated oldest first and cut
 * into `columns` equal spans (`floor(index * columns / total)`), so the column
 * the user pointed at is the column that was drawn there.
 */
export function waveformReadout(options: {
  readonly frames: readonly PcmBlock[];
  readonly columns?: number;
  readonly fraction: number;
  readonly channel?: number;
}): { db: number } | null {
  const { frames, fraction, channel = 0 } = options;
  const columns = Math.max(1, Math.floor(options.columns ?? WAVEFORM_COLUMNS) || 1);

  let total = 0;
  for (const frame of frames) {
    total += sampleLength(frame);
  }

  if (total === 0) {
    return null;
  }

  const column = Math.min(columns - 1, Math.max(0, Math.floor(fraction * columns)));
  // Inverse of floor(index * columns / total): the span that maps to `column`.
  const start = Math.ceil((column * total) / columns);
  const end = Math.ceil(((column + 1) * total) / columns);

  let peak = 0;
  let offset = 0;

  for (const frame of frames) {
    const length = sampleLength(frame);
    const from = Math.max(start, offset);
    const to = Math.min(end, offset + length);

    for (let global = from; global < to; global += 1) {
      peak = Math.max(peak, Math.abs(sampleAt(frame, global - offset, channel)));
    }

    offset += length;
  }

  return { db: toDb(peak) };
}

/** Level, frequency, and note of the spectrum bin under the cursor. */
export function spectrumReadout(options: {
  readonly bins: ArrayLike<number>;
  readonly fraction: number;
  readonly sampleRate?: number;
}): { db: number; hz: number; note: NoteReading | null } | null {
  const { bins, fraction, sampleRate = DEFAULT_SAMPLE_RATE } = options;

  if (bins.length === 0) {
    return null;
  }

  const index = Math.min(
    bins.length - 1,
    Math.max(0, Math.round(fraction * (bins.length - 1))),
  );
  const value = Number(bins[index]);
  const db = Number.isFinite(value) ? value : ANALYSIS_FLOOR_DB;
  const hz = binFrequencyRange(index, sampleRate).center;

  return { db, hz, note: noteFromFrequency(hz) };
}

/**
 * Cell under the cursor on the (transposed) spectrogram.
 *
 * `fractionY` is measured from the top, where the highest frequency bin is
 * drawn; `fractionX` from the left, which is the oldest row.
 */
export function spectrogramReadout(options: {
  readonly rows: readonly ArrayLike<number>[];
  readonly fractionX: number;
  readonly fractionY: number;
  readonly sampleRate?: number;
  readonly refreshMs: number;
}): { db: number; hz: number; note: NoteReading | null; secondsAgo: number } | null {
  const { rows, fractionX, fractionY, sampleRate = DEFAULT_SAMPLE_RATE, refreshMs } = options;

  if (rows.length === 0) {
    return null;
  }

  const bins = Math.max(...rows.map((row) => row.length));

  if (bins === 0) {
    return null;
  }

  const binIndex = Math.min(
    bins - 1,
    Math.max(0, Math.round((1 - fractionY) * (bins - 1))),
  );
  const row = rows[Math.min(rows.length - 1, Math.max(0, Math.floor(fractionX * rows.length)))];
  const unit = Number(row[binIndex] ?? 0);
  const db = ANALYSIS_FLOOR_DB + Math.min(1, Math.max(0, unit)) * -ANALYSIS_FLOOR_DB;
  const hz = binFrequencyRange(binIndex, sampleRate).center;
  const secondsAgo = Math.max(0, (1 - fractionX) * rows.length * refreshMs) / 1000;

  return { db, hz, note: noteFromFrequency(hz), secondsAgo };
}
