import { Button, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PairingScanner } from '@/features/monitoring/PairingScanner';

export type PairingScannerOverlayProps = {
  readonly visible: boolean;
  readonly error: string | null;
  readonly onQrScanned: (data: string) => void;
  readonly onCancel: () => void;
};

/**
 * The camera, mounted over the whole screen.
 *
 * A camera preview is a native surface: on Android it renders black when it is
 * nested in a scrolling container whose scroll is toggled, because the surface
 * gets clipped or recycled while it is being laid out. Mounting it in an opaque,
 * full-screen overlay that lives outside the scroll view — and only while
 * scanning — keeps the preview attached to a stable parent for its whole life.
 */
export function PairingScannerOverlay({
  visible,
  error,
  onQrScanned,
  onCancel,
}: PairingScannerOverlayProps) {
  if (!visible) {
    return null;
  }

  return (
    <View testID="pairing-scanner-overlay" style={styles.overlay}>
      <View style={styles.card}>
        <ThemedText type="subtitle">Scan the plugin QR code</ThemedText>
        <PairingScanner active onQrScanned={onQrScanned} />
        {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
        <Button title="Cancel" onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    // Opaque on purpose: a transparent overlay lets the scroll content show
    // through the preview surface, which reads as a broken camera.
    backgroundColor: '#000000',
    paddingHorizontal: 16,
    paddingVertical: 24,
    justifyContent: 'center',
    zIndex: 10,
    elevation: 10,
  },
  card: {
    gap: 16,
  },
});
