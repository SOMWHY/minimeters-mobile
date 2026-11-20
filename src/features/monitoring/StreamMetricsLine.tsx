import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { formatStreamMetrics, getStreamMetrics } from './stream-metrics';

/**
 * Dev-only latency readout.
 *
 * `queue` is how much audio was waiting for us, `drain` how long one
 * analysis pass took, `gap` the interval between drains. Together they say
 * whether a laggy meter is buffering, render cost, or the network — instead of
 * guessing. Samples at 2 Hz so the readout does not re-render what it measures.
 */
export function StreamMetricsLine(): React.ReactNode {
  const [line, setLine] = useState(() => formatStreamMetrics(getStreamMetrics()));

  useEffect(() => {
    if (!__DEV__) {
      return;
    }

    const id = setInterval(() => {
      setLine(formatStreamMetrics(getStreamMetrics()));
    }, 500);

    return () => {
      clearInterval(id);
    };
  }, []);

  if (!__DEV__) {
    return null;
  }

  return (
    <Text testID="stream-metrics" style={styles.line}>
      {line}
    </Text>
  );
}

const styles = StyleSheet.create({
  line: {
    marginTop: 8,
    fontFamily: 'SpaceMono',
    fontSize: 10,
    opacity: 0.6,
  },
});
