import { useEffect, useRef, useState } from 'react';
import { Button, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { parsePairingPayload } from '@/features/connection/pairing';
import {
  PcmSocketClient,
  type PcmConnectionState,
  type SocketFactory,
} from '@/features/connection/pcm-socket-client';

import { PairingScanner } from './PairingScanner';
import { selectSampleRows, type PcmAudioFrame } from './pcm-frame';

type FrameSnapshot = {
  frame: PcmAudioFrame;
  receivedFrameCount: number;
};

type PcmMonitorScreenProps = {
  socketFactory?: SocketFactory;
};

const REFRESH_INTERVAL_MS = 100;

const connectionLabels: Record<PcmConnectionState, string> = {
  connecting: 'Connecting',
  authenticating: 'Authenticating',
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Connection error',
};

export function PcmMonitorScreen({ socketFactory }: PcmMonitorScreenProps) {
  const clientRef = useRef<PcmSocketClient | null>(null);
  const mountedRef = useRef(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isPaired, setIsPaired] = useState(false);
  const [connectionState, setConnectionState] = useState<PcmConnectionState>('disconnected');
  const [frameSnapshot, setFrameSnapshot] = useState<FrameSnapshot | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [protocolError, setProtocolError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, []);

  useEffect(() => {
    const client = clientRef.current;
    if (connectionState !== 'connected' || !client) {
      return;
    }

    const refreshFrame = () => {
      const frame = client.getLatestFrame();
      setFrameSnapshot(
        frame
          ? {
              frame,
              receivedFrameCount: client.getReceivedFrameCount(),
            }
          : null,
      );
    };

    refreshFrame();
    const timer = setInterval(refreshFrame, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [connectionState]);

  function handleQrScanned(data: string) {
    const result = parsePairingPayload(data);
    if (!result.ok) {
      setScanError(
        result.reason === 'unsupported_version'
          ? 'This pairing code uses an unsupported version.'
          : 'This is not a valid MiniMeters pairing code.',
      );
      return;
    }

    setScanError(null);
    setConnectionError(null);
    setProtocolError(null);
    setFrameSnapshot(null);
    setIsScanning(false);
    setIsPaired(true);

    const client = new PcmSocketClient(
      result.payload,
      {
        onState: (state) => {
          if (mountedRef.current) {
            setConnectionState(state);
          }
        },
        onError: (message) => {
          if (mountedRef.current) {
            setConnectionError(message);
          }
        },
        onProtocolError: (reason) => {
          if (mountedRef.current) {
            setProtocolError(reason);
          }
        },
      },
      socketFactory,
    );
    clientRef.current = client;
    client.connect();
  }

  function handleScanAgain() {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setIsPaired(false);
    setIsScanning(false);
    setConnectionState('disconnected');
    setFrameSnapshot(null);
    setConnectionError(null);
    setProtocolError(null);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="subtitle">Raw PCM Monitor</ThemedText>
          <ThemedText>
            Scan the plugin QR code to inspect the live audio samples sent to this device.
          </ThemedText>

          {!isPaired && !isScanning && (
            <Button title="Scan plugin QR code" onPress={() => setIsScanning(true)} />
          )}
          {isScanning && (
            <View style={styles.section}>
              <PairingScanner active onQrScanned={handleQrScanned} />
              <Button title="Cancel scan" onPress={() => setIsScanning(false)} />
            </View>
          )}
          {scanError && <ThemedText accessibilityRole="alert">{scanError}</ThemedText>}

          {isPaired && (
            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="smallBold">
                Connection: {connectionLabels[connectionState]}
              </ThemedText>
              {connectionError && (
                <ThemedText accessibilityRole="alert">Error: {connectionError}</ThemedText>
              )}
              {protocolError && (
                <ThemedText accessibilityRole="alert">Protocol error: {protocolError}</ThemedText>
              )}
              {connectionState === 'connected' && (
                <View style={styles.section}>
                  {frameSnapshot ? (
                    <PcmFrameDetails snapshot={frameSnapshot} />
                  ) : (
                    <ThemedText>Waiting for PCM frames…</ThemedText>
                  )}
                </View>
              )}
              <Button title="Scan another code" onPress={handleScanAgain} />
            </ThemedView>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function PcmFrameDetails({ snapshot }: { snapshot: FrameSnapshot }) {
  const { frame, receivedFrameCount } = snapshot;
  const channelLabels = frame.channels === 2 ? ['L', 'R'] : ['Ch 1'];

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Frames received: {receivedFrameCount}</ThemedText>
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
