import type { PcmBlock } from '@minimetermobile/ui';

import type { FrameAnalysis } from '@/features/monitoring/analysis';
import type { PcmAudioFrame } from '@/features/monitoring/pcm-frame';

/** The frame as the meters see it: recorded samples, no display scaling. */
export function toBlock(frame: PcmAudioFrame | null): PcmBlock | null {
  if (!frame) {
    return null;
  }

  return {
    samples: frame.samples,
    channels: frame.channels,
    samplesPerChannel: frame.samplesPerChannel,
  };
}

/**
 * The frame as the scopes draw it: with the automatic display gain applied.
 *
 * A linear picture of raw samples is nearly flat at a normal listening level;
 * the gain lives in `analysis.displaySamples` so the meters above keep reading
 * the untouched frame and never report the lifted level.
 */
export function toScopeBlock(
  frame: PcmAudioFrame | null,
  analysis: FrameAnalysis | null,
): PcmBlock | null {
  if (!frame) {
    return null;
  }

  const samples = analysis?.displaySamples;

  if (!samples || samples.length !== frame.samples.length) {
    return toBlock(frame);
  }

  return {
    samples,
    channels: frame.channels,
    samplesPerChannel: frame.samplesPerChannel,
  };
}
