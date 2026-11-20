/**
 * Stateful analysis engine.
 *
 * `analyseFrame` is pure and stateless: it cannot know how loud the last second
 * was, or how fast a bar should fall. Those need memory across frames, so the
 * app talks to this engine instead. The split keeps the pure part trivially
 * testable while the state lives in one place.
 */

import { analyseFrame, type FrameAnalysis } from './analysis';
import { createVuMeter, DEFAULT_BALLISTICS, type BallisticsConfig } from './ballistics';
import { createLoudnessMeter } from './loudness';
import type { PcmAudioFrame } from './pcm-frame';

export type AnalysisEngine = {
  /** Analyse one frame, advancing the meters. */
  readonly push: (frame: PcmAudioFrame) => FrameAnalysis;
  /** Forget the meters; call when the stream restarts. */
  readonly reset: () => void;
};

/** Frame duration derived from the sample count, not the wall clock. */
function frameDurationMs(frame: PcmAudioFrame): number {
  const rate = frame.sampleRate > 0 ? frame.sampleRate : 48000;

  return (frame.samplesPerChannel / rate) * 1000;
}

export function createAnalysisEngine(config: BallisticsConfig = DEFAULT_BALLISTICS): AnalysisEngine {
  let sampleRate = 0;
  let loudness = createLoudnessMeter(sampleRate);
  let vu = createVuMeter(config);

  function reset(): void {
    sampleRate = 0;
    loudness = createLoudnessMeter(0);
    vu = createVuMeter(config);
  }

  function push(frame: PcmAudioFrame): FrameAnalysis {
    if (frame.sampleRate !== sampleRate) {
      sampleRate = frame.sampleRate;
      loudness = createLoudnessMeter(sampleRate);
      vu = createVuMeter(config);
    }

    const base = analyseFrame(frame);
    // A mono frame is duplicated on the scopes, but it is one channel of
    // loudness — feeding it twice would add a phantom +3 dB.
    loudness.push(frame.channels >= 2 ? [base.left, base.right] : [base.left]);

    const levels = vu.push(base.levels, frameDurationMs(frame));

    return {
      ...base,
      levels,
      lufs: loudness.integrated(),
      momentaryLufs: loudness.value(),
      shortTermLufs: loudness.shortTerm(),
    };
  }

  return { push, reset };
}
