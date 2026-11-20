import { StyleSheet, View } from 'react-native';

import {
  connectionTone,
  INDICATOR_COLORS,
  indicatorLabel,
  type IndicatorInput,
} from './connection-indicator';

/**
 * A dot that carries the whole connection state.
 *
 * Deliberately not pressable: it replaced a row of text that grew with every
 * feature, and a control that looks tappable but does nothing is worse than no
 * control. Details live in the banner below the grid.
 */
export function ConnectionLight(props: IndicatorInput) {
  const tone = connectionTone(props);

  return (
    <View
      testID="connection-light"
      accessibilityRole="image"
      accessibilityLabel={indicatorLabel(tone)}
      style={[styles.light, { backgroundColor: INDICATOR_COLORS[tone] }]}
    />
  );
}

const styles = StyleSheet.create({
  light: {
    width: 12,
    height: 12,
    borderRadius: 999,
  },
});
