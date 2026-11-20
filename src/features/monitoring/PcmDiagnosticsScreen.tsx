import { Button, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { usePcmConnection } from '@/features/connection/connection-context';
import { PairingScanner } from '@/features/monitoring/PairingScanner';
import { selectSampleRows, type PcmAudioFrame } from '@/features/monitoring/pcm-frame';

const connectionLabels = {
  connecting: 'Connecting',
  authenticating: 'Authenticating',
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Connection error',
} as const;

function FrameDetails({ frame, frameCount }: { frame: PcmAudioFrame; frameCount: number }) {
  const channelLabels = frame.channels === 2 ? ['L', 'R'] : ['Ch 1'];

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Frames received: {frameCount}</ThemedText>
      <ThemedText>Timestamp: {frame.timestampMs} ms</ThemedText>
      <ThemedText>Sample rate: {frame.sampleRate} Hz</ThemedText>
      <ThemedText>Channels: {frame.channels}</ThemedText>
      <ThemedText>Samples per channel: {frame.samplesPerChannel}</ThemedText>
      <ThemedText type="smallBold">Latest raw samples</ThemedText>
      {channelLabels.length > 1 && (
        <ThemedText type="code">Index    {channelLabels.join('       ')}</ThemedText>
      )}
      {selectSampleRows(frame).map((row) => (
        <ThemedText type="code" key={row.index}>
          {channelLabels.length === 2
            ? `${row.index}        ${row.values[0]}    ${row.values[1]}`
            : `${row.index}        ${row.values[0]}`}
        </ThemedText>
      ))}
    </View>
  );
}

/**
 * Raw protocol view: pairing plus the undecoded frame table.
 *
 * Kept off the dashboard so a protocol regression stays diagnosable without a
 * debugger — it reads the same provider the dashboard does.
 */
export function PcmDiagnosticsScreen() {
  const connection = usePcmConnection();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="subtitle">Diagnostics</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {connection.isPaired
              ? `${connectionLabels[connection.status]} · ${connection.frameCount} frames`
              : 'Not paired'}
          </ThemedText>

          {!connection.isPaired && !connection.isScanning && (
            <Button title="Scan plugin QR code" onPress={connection.startScan} />
          )}

          {connection.isScanning && (
            <View style={styles.section}>
              <PairingScanner active onQrScanned={connection.handleQrScanned} />
              <Button title="Cancel scan" onPress={connection.cancelScan} />
            </View>
          )}

          {connection.scanError && (
            <ThemedText accessibilityRole="alert">{connection.scanError}</ThemedText>
          )}
          {connection.connectionError && (
            <ThemedText accessibilityRole="alert">Error: {connection.connectionError}</ThemedText>
          )}
          {connection.protocolError && (
            <ThemedText accessibilityRole="alert">
              Protocol error: {connection.protocolError}
            </ThemedText>
          )}

          {connection.frame ? (
            <FrameDetails frame={connection.frame} frameCount={connection.frameCount} />
          ) : (
            connection.isPaired && (
              <ThemedText type="small">Waiting for the first frame…</ThemedText>
            )
          )}

          {connection.isPaired && (
            <Button title="Disconnect and scan another code" onPress={connection.disconnect} />
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: 800,
    alignSelf: 'center',
    padding: 20,
    gap: 16,
  },
  section: {
    gap: 12,
    padding: 16,
    borderRadius: 16,
  },
});
