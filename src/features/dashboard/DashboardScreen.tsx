import { useMemo, useState } from 'react';
import {
  Button,
  Pressable,
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
import { usePcmConnection } from '@/features/connection/connection-context';
import { PairingScannerOverlay } from '@/features/monitoring/PairingScannerOverlay';

import { ConnectionLight } from './ConnectionLight';
import { gridForWindow } from './model';
import type { LayoutStorageDeps } from './layout-storage';
import { ModuleBody } from './module-bodies';
import { useDashboardLayout } from './use-dashboard-layout';
import { useLiveAnalysis } from './use-live-analysis';

const themeIds = Object.keys(BUILT_IN_THEMES);

const fatalMessages = {
  protocol: 'The plugin and the phone disagree about the audio format.',
  unreachable: 'Lost the connection to the plugin.',
} as const;

/** Shown when the server rejects the token; the last frame stays on screen. */
const REAUTH_MESSAGE = 'The pairing code expired. Scan the plugin QR code again.';

/**
 * A rejection on a pairing that never stored a device token.
 *
 * Usually that is an older server build, which can only accept the short-lived
 * QR token — but it is also what a just-upgraded server looks like to a phone
 * that has not re-paired yet, so the wording points at a re-scan first and only
 * blames the build if that does not help.
 */
const REAUTH_WITHOUT_DEVICE_TOKEN_MESSAGE =
  'The pairing code expired and this phone has no device token stored — scan the QR code again; if it keeps failing, update the server build.';

export type DashboardScreenProps = {
  /** Injected for tests; defaults to device storage. */
  storage?: LayoutStorageDeps;
};

export function DashboardScreen({ storage }: DashboardScreenProps) {
  const stream = usePcmConnection();
  const { analysis, history, scopeFrames } = useLiveAnalysis();

  const { width, height } = useWindowDimensions();
  const scheme = useColorScheme();

  const grid = useMemo(() => gridForWindow({ width, height }), [height, width]);
  const { config, metrics } = grid;
  const defaultThemeId = scheme === 'dark' ? 'midnight' : 'ice';
  const { layout, themeId, setLayout, setThemeId, resetLayout } = useDashboardLayout(
    config,
    storage,
    themeIds,
    defaultThemeId,
  );

  const [editing, setEditing] = useState(false);
  /**
   * True while a card is being dragged or resized.
   *
   * Android's native scroll interceptor otherwise takes the gesture over mid-drag;
   * the grid reports the gesture so the page can stop scrolling for its duration.
   * Ordinary swipes still scroll, because a drag only arms after a still hold.
   */
  const [dragging, setDragging] = useState(false);

  const theme: VisualizationTheme =
    BUILT_IN_THEMES[themeId as keyof typeof BUILT_IN_THEMES] ?? BUILT_IN_THEMES.midnight;
  const hidden = layout ? hiddenItems(layout.items) : [];

  const handleRestore = (id: string) => {
    if (!layout) {
      return;
    }

    setLayout({ items: setVisibility(layout.items, id, true, config) });
  };

  const banner = stream.reauthRequired
    ? stream.hasDeviceToken
      ? REAUTH_MESSAGE
      : REAUTH_WITHOUT_DEVICE_TOKEN_MESSAGE
    : stream.fatalError
      ? fatalMessages[stream.fatalError]
      : stream.reconnecting
        ? `Reconnecting… (attempt ${stream.retryAttempt})`
        : stream.connectionError
          ? `Error: ${stream.connectionError}`
          : stream.protocolError
            ? `Protocol error: ${stream.protocolError}`
            : null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          testID="dashboard-scroll"
          style={styles.scroll}
          contentContainerStyle={styles.content}
          scrollEnabled={!dragging}
        >
          <View style={styles.toolbar}>
            <ThemedText type="small" themeColor="textSecondary">
              Theme
            </ThemedText>
            <View style={styles.themeChips}>
              {themeIds.map((id) => {
                const selected = id === themeId;

                return (
                  <Pressable
                    key={id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setThemeId(id)}
                    style={[styles.chip, selected && styles.chipSelected]}
                  >
                    <ThemedText type="small" themeColor={selected ? 'text' : 'textSecondary'}>
                      {BUILT_IN_THEMES[id as keyof typeof BUILT_IN_THEMES].name}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.toolbarSpacer} />
            <ConnectionLight
              status={stream.status}
              reauthRequired={stream.reauthRequired}
              fatalError={stream.fatalError}
              connectionError={stream.connectionError}
              protocolError={stream.protocolError}
            />
          </View>

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
              onGestureStateChange={setDragging}
              renderModule={(item, rect) => (
                <ModuleBody
                  item={item}
                  rect={rect}
                  theme={theme}
                  frame={stream.frame}
                  analysis={analysis}
                  history={history}
                  scopeFrames={scopeFrames}
                />
              )}
            />
          )}
        </ScrollView>

        {/*
          Everything the user needs while editing lives here, outside the scroll
          view: the page scrolls while editing, but a drag freezes it, so controls
          placed at the end of the content could end up unreachable mid-gesture.
        */}
        <View style={styles.pinnedBar} testID="pinned-bar">
          {banner !== null && (
            <ThemedText type="small" accessibilityRole="alert" testID="connection-banner">
              {banner}
            </ThemedText>
          )}

          {editing && hidden.length > 0 && (
            <ScrollView
              testID="hidden-tray"
              style={styles.tray}
              nestedScrollEnabled
            >
              <ModuleTray hidden={hidden} theme={theme} onRestore={handleRestore} />
            </ScrollView>
          )}

          {!stream.isPaired && (
            <Button title="Scan plugin QR code" onPress={stream.startScan} />
          )}

          {stream.isPaired && (
            <>
              <View style={styles.pinnedRow}>
                <Button
                  title={editing ? 'Done' : 'Edit layout'}
                  onPress={() => setEditing((current) => !current)}
                />
                {editing && <Button title="Reset layout" onPress={resetLayout} />}
              </View>
              <Button title="Disconnect" onPress={stream.disconnect} />
            </>
          )}
        </View>

        <PairingScannerOverlay
          visible={stream.isScanning}
          error={stream.scanError}
          onQrScanned={stream.handleQrScanned}
          onCancel={stream.cancelScan}
        />
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
  scroll: {
    flex: 1,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  themeChips: {
    flexDirection: 'row',
    gap: 8,
  },
  toolbarSpacer: {
    flex: 1,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.6)',
  },
  chipSelected: {
    backgroundColor: 'rgba(128,128,128,0.25)',
  },
  content: {
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
    padding: 16,
    gap: 16,
  },
  tray: {
    maxHeight: 180,
  },
  pinnedBar: {
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
  },
  pinnedRow: {
    flexDirection: 'row',
    gap: 12,
  },
});
