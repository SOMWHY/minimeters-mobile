import { useMemo, useState } from 'react';
import {
  Button,
  ScrollView,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  DashboardGrid,
  ModuleTray,
  hiddenItems,
  setVisibility,
} from '@minimetermobile/ui/dist/dashboard';
import { BUILT_IN_THEMES, type VisualizationTheme } from '@minimetermobile/ui/dist/theme';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import type { PcmConnectionState } from '@/features/connection/pcm-socket-client';
import { usePcmConnection } from '@/features/connection/connection-context';
import { PairingScanner } from '@/features/monitoring/PairingScanner';

import { gridForWidth } from './model';
import type { LayoutStorageDeps } from './layout-storage';
import { ModuleBody } from './module-bodies';
import { useDashboardLayout } from './use-dashboard-layout';
import { useLiveAnalysis } from './use-live-analysis';

const connectionLabels: Record<PcmConnectionState, string> = {
  connecting: 'Connecting',
  authenticating: 'Authenticating',
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Connection error',
};

export type DashboardScreenProps = {
  /** Injected for tests; defaults to device storage. */
  storage?: LayoutStorageDeps;
};

export function DashboardScreen({ storage }: DashboardScreenProps) {
  const stream = usePcmConnection();
  const { analysis, history, reset: resetLiveAnalysis } = useLiveAnalysis();

  const { width } = useWindowDimensions();
  const scheme = useColorScheme();

  const grid = useMemo(() => gridForWidth(width), [width]);
  const { config, metrics } = grid;
  const { layout, setLayout, resetLayout } = useDashboardLayout(config, storage);

  const [editing, setEditing] = useState(false);

  const theme: VisualizationTheme = scheme === 'dark' ? BUILT_IN_THEMES.midnight : BUILT_IN_THEMES.ice;
  const hidden = layout ? hiddenItems(layout.items) : [];

  const handleRestore = (id: string) => {
    if (!layout) {
      return;
    }

    setLayout({ items: setVisibility(layout.items, id, true, config) });
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} scrollEnabled={!editing}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <ThemedText type="subtitle">Dashboard</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {stream.isPaired
                  ? `${connectionLabels[stream.status]} · ${stream.frameCount} frames${
                      analysis ? ` · ${analysis.lufs.toFixed(1)} dBFS RMS` : ''
                    }`
                  : 'Not paired'}
              </ThemedText>
            </View>
            {stream.isPaired && (
              <View style={styles.headerActions}>
                <Button
                  title={editing ? 'Done' : 'Edit'}
                  onPress={() => setEditing((current) => !current)}
                />
              </View>
            )}
          </View>

          {!stream.isPaired && !stream.isScanning && (
            <Button title="Scan plugin QR code" onPress={stream.startScan} />
          )}

          {stream.isScanning && (
            <View style={styles.section}>
              <PairingScanner active onQrScanned={stream.handleQrScanned} />
              <Button title="Cancel scan" onPress={stream.cancelScan} />
            </View>
          )}

          {stream.scanError && <ThemedText accessibilityRole="alert">{stream.scanError}</ThemedText>}
          {stream.connectionError && (
            <ThemedText accessibilityRole="alert">Error: {stream.connectionError}</ThemedText>
          )}
          {stream.protocolError && (
            <ThemedText accessibilityRole="alert">Protocol error: {stream.protocolError}</ThemedText>
          )}

          {layout === null ? (
            <ThemedText type="small">Loading dashboard…</ThemedText>
          ) : (
            <DashboardGrid
              testID="dashboard-grid"
              layout={layout}
              theme={theme}
              config={config}
              metrics={metrics}
              editing={editing}
              onLayoutChange={setLayout}
              renderModule={(item, rect) => (
                <ModuleBody
                  item={item}
                  rect={rect}
                  theme={theme}
                  frame={stream.frame}
                  analysis={analysis}
                  history={history}
                />
              )}
            />
          )}

          {editing && layout !== null && (
            <ModuleTray hidden={hidden} theme={theme} onRestore={handleRestore} />
          )}

          {editing && (
            <View style={styles.footerActions}>
              <Button title="Reset layout" onPress={resetLayout} />
            </View>
          )}

          {stream.isPaired && (
            <Button
              title="Disconnect and scan another code"
              onPress={() => {
                stream.disconnect();
                resetLiveAnalysis();
              }}
            />
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
    maxWidth: 900,
    alignSelf: 'center',
    padding: 16,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerText: {
    flexShrink: 1,
    gap: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  section: {
    gap: 12,
    padding: 12,
    borderRadius: 16,
  },
  footerActions: {
    flexDirection: 'row',
    gap: 12,
  },
});
