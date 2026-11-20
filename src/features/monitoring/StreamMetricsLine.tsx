import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import {
  STREAM_METRICS_ENABLED,
  formatStreamMetrics,
  getStreamMetrics,
} from './stream-metrics';

/**
 * Latency readout for the phone's audio pipeline.
 *
 * It answers three separable questions with numbers instead of guesses: how much
 * audio was waiting for us, how long the analysis loop took, and how often the
 * socket actually delivered. Sampling at 1 Hz keeps the readout from re-rendering
 * what it measures.
 */
/** Bump when the readout itself changes, so a stale bundle cannot hide. */
const BUILD_TAG = 'metrics-prod';


export function StreamMetricsLine({ color }: { color: string }): React.ReactNode {
  const [line, setLine] = useState(() => formatStreamMetrics(getStreamMetrics()));

  useEffect(() => {
    if (!STREAM_METRICS_ENABLED) {
      return;
    }

    const id = setInterval(() => {
      const metrics = getStreamMetrics();

      setLine(formatStreamMetrics(metrics));
      // Also on the Metro terminal so the numbers can be copied verbatim
      // instead of read off a phone screen.
      console.log(`[stream] ${JSON.stringify(metrics)}`);
    }, 1000);

    return () => {
      clearInterval(id);
    };
  }, []);

  if (!STREAM_METRICS_ENABLED) {
    return null;
  }

  return (
    <Text testID="stream-metrics" style={[styles.line, { color }]}>
      {`${BUILD_TAG} · ${line}`}
    </Text>
  );
}

const styles = StyleSheet.create({
  line: {
    marginTop: 10,
    fontFamily: 'SpaceMono',
    fontSize: 11,
  },
});
