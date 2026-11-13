import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef } from 'react';
import { Button, Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

type PairingScannerProps = {
  active: boolean;
  onQrScanned: (data: string) => void;
};

const SCAN_LOCK_MS = 1000;

export function supportsQrScanning(platform: string): boolean {
  return platform === 'android' || platform === 'ios';
}

export function PairingScanner({ active, onQrScanned }: PairingScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const scanLocked = useRef(false);
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) {
      scanLocked.current = false;
      if (unlockTimer.current !== null) {
        clearTimeout(unlockTimer.current);
        unlockTimer.current = null;
      }
    }

    return () => {
      if (unlockTimer.current !== null) {
        clearTimeout(unlockTimer.current);
      }
    };
  }, [active]);

  if (!active) {
    return null;
  }

  if (!supportsQrScanning(Platform.OS)) {
    return (
      <ThemedView type="backgroundElement" style={styles.message}>
        <ThemedText>QR scanning is available on a physical iOS or Android device.</ThemedText>
      </ThemedView>
    );
  }

  if (permission === null) {
    return (
      <ThemedView type="backgroundElement" style={styles.message}>
        <ThemedText>Checking camera permission…</ThemedText>
      </ThemedView>
    );
  }

  if (!permission.granted) {
    return (
      <ThemedView type="backgroundElement" style={styles.message}>
        <ThemedText>
          Camera access is required to scan the pairing QR code. No audio is recorded.
        </ThemedText>
        {permission.canAskAgain ? (
          <Button title="Allow camera access" onPress={() => void requestPermission()} />
        ) : (
          <ThemedText>
            Camera access is blocked. Enable it for MiniMeters Mobile in your device settings.
          </ThemedText>
        )}
      </ThemedView>
    );
  }

  return (
    <View style={styles.cameraContainer}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (!active || scanLocked.current) {
            return;
          }
          scanLocked.current = true;
          onQrScanned(data);
          unlockTimer.current = setTimeout(() => {
            scanLocked.current = false;
            unlockTimer.current = null;
          }, SCAN_LOCK_MS);
        }}
      />
      <ThemedText style={styles.hint}>Point the camera at the plugin QR code.</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  cameraContainer: {
    gap: 12,
  },
  camera: {
    width: '100%',
    height: 320,
    borderRadius: 16,
    overflow: 'hidden',
  },
  hint: {
    textAlign: 'center',
  },
  message: {
    padding: 16,
    borderRadius: 16,
    gap: 12,
  },
});
