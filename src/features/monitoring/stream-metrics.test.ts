import { STREAM_METRICS_ENABLED } from './stream-metrics';

test('metrics are recorded wherever the overlay can display them', () => {
  // A `--no-dev` bundle started with EXPO_PUBLIC_STREAM_METRICS=1 shows the
  // overlay, so the drain loop has to record in that bundle too. If the two
  // guards drift apart the production-mode readout is permanently empty.
  expect(STREAM_METRICS_ENABLED).toBe(
    __DEV__ || process.env.EXPO_PUBLIC_STREAM_METRICS === '1',
  );
  expect(typeof STREAM_METRICS_ENABLED).toBe('boolean');
});
