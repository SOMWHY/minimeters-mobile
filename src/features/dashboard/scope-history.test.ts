import { WAVEFORM_HISTORY_SECONDS } from '@minimetermobile/ui/dist/modules/waveform/history';

import { STREAM_REFRESH_MS } from '@/features/monitoring/use-pcm-stream';
import type { PcmBlock } from '@minimetermobile/ui';

import { appendScopeFrame, WAVEFORM_HISTORY_FRAMES } from './scope-history';

function blockOf(value: number): PcmBlock {
  return { samples: new Float32Array([value, value]), channels: 2, samplesPerChannel: 1 };
}

describe('appendScopeFrame', () => {
  it('keeps three seconds of frames at the current poll cadence', () => {
    const expected = Math.round((WAVEFORM_HISTORY_SECONDS * 1000) / STREAM_REFRESH_MS);

    expect(WAVEFORM_HISTORY_FRAMES).toBe(expected);
    expect(WAVEFORM_HISTORY_FRAMES).toBeGreaterThanOrEqual(1);
  });

  it('drops the oldest frame once the window is full', () => {
    const frames = [blockOf(1), blockOf(2), blockOf(3)];

    const next = appendScopeFrame(frames, blockOf(4), 3);

    expect(next.map((frame) => frame.samples[0])).toEqual([2, 3, 4]);
  });

  it('is a no-op window when asked for none', () => {
    // `slice(-0)` would return everything, so zero needs its own path.
    expect(appendScopeFrame([blockOf(1)], blockOf(2), 0)).toEqual([]);
    expect(appendScopeFrame([], null, 0)).toEqual([]);
  });

  it('passes null through as a trim, not an append', () => {
    const frames = [blockOf(1), blockOf(2), blockOf(3)];

    expect(appendScopeFrame(frames, null, 2).map((frame) => frame.samples[0])).toEqual([2, 3]);
  });
});
