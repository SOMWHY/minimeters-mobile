import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Pressable,
  ScrollView,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
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

import { fitRowsToViewport, gridForWindow, gridViewport, layoutRowCount } from './model';
import type { LayoutStorageDeps } from './layout-storage';
import { ModuleBody } from './module-bodies';
import { loadOrbPosition, saveOrbPosition } from './orb-storage';
import {
  clampOrbPosition,
  defaultOrbPosition,
  type OrbInsets,
  type OrbPosition,
} from './settings-orb';
import { SettingsOrb } from './SettingsOrb';
import { StreamMetricsLine } from '@/features/monitoring/StreamMetricsLine';
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

/**
 * The instruments, edge to edge.
 *
 * There is no chrome around the grid any more: the row height is fitted to the
 * viewport so the modules fill the screen, and everything that used to live in
 * the bottom bar moved into the floating settings orb.
 */
export function DashboardScreen({ storage }: DashboardScreenProps) {
  const stream = usePcmConnection();
  const { analysis, history, scopeFrames, meter } = useLiveAnalysis();

  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();

  /**
   * Height the grid may fill, in dp, as actually laid out.
   *
   * Measured rather than derived — see `gridViewport`. `null` until the first
   * layout pass, which falls back to the window estimate.
   */
  const [viewport, setViewport] = useState<number | null>(null);
  /** The screen's own box, measured, so the orb clamps to real bounds. */
  const [box, setBox] = useState<{ readonly width: number; readonly height: number } | null>(null);

  // Columns come from the preset alone; the fitted row height needs the layout,
  // which in turn needs the columns. Resolving them in that order avoids a cycle.
  const { metrics: presetMetrics, config } = useMemo(
    () => gridForWindow({ width, height }),
    [height, width],
  );
  const defaultThemeId = scheme === 'dark' ? 'midnight' : 'ice';
  const { layout, themeId, setLayout, setThemeId, resetLayout } = useDashboardLayout(
    config,
    storage,
    themeIds,
    defaultThemeId,
  );

  const rows = layout === null ? 1 : layoutRowCount(layout.items);
  /**
   * Only the status bar is reserved at the top.
   *
   * The bottom inset (Android navigation bar, iOS home indicator) is *not*
   * padded off: the strip it used to reserve was a full-width band of
   * background the modules could never reach — most obvious in portrait, where
   * the bar sits at the bottom, and invisible in landscape, where it moves to
   * the side. The grid runs to the physical bottom edge and the modules draw
   * under a transparent system bar, the way the desktop app does.
   *
   * The height comes from the measured scroll viewport, not from the window:
   * the two disagree on Android (see `gridViewport`), and the disagreement is
   * exactly the dead band this fit used to leave behind.
   */
  const availableHeight = gridViewport({
    measured: viewport,
    windowHeight: height,
    insets: { top: insets.top },
  });
  const metrics = useMemo(
    () => fitRowsToViewport({ availableHeight, rows, preset: presetMetrics }),
    [availableHeight, presetMetrics, rows],
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

  const orbWindow = useMemo(() => box ?? { width, height }, [box, height, width]);
  const orbInsets: OrbInsets = useMemo(
    () => ({ top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right }),
    [insets.bottom, insets.left, insets.right, insets.top],
  );
  const orbStorage = storage ?? AsyncStorage;

  const [orbPosition, setOrbPosition] = useState<OrbPosition>(() =>
    defaultOrbPosition({ window: { width, height }, insets: orbInsets }),
  );
  const [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => {
    let active = true;

    void loadOrbPosition(orbStorage).then((stored) => {
      if (!active || stored === null) {
        return;
      }

      setOrbPosition(
        clampOrbPosition({
          position: stored,
          window: orbWindow,
          insets: { top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right },
        }),
      );
    });

    return () => {
      active = false;
    };
  }, [insets.bottom, insets.left, insets.right, insets.top, orbStorage, orbWindow]);

  const handleOrbDragEnd = useCallback(
    (position: OrbPosition) => {
      setOrbPosition(position);
      void saveOrbPosition(orbStorage, position);
    },
    [orbStorage],
  );

  const togglePanel = useCallback(() => setPanelOpen((current) => !current), []);

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

  const handleViewportLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;

    if (Number.isFinite(next) && next > 0) {
      setViewport(next);
    }
  }, []);

  const handleBoxLayout = useCallback((event: LayoutChangeEvent) => {
    const { width: nextWidth, height: nextHeight } = event.nativeEvent.layout;

    if (nextWidth > 0 && nextHeight > 0) {
      setBox({ width: nextWidth, height: nextHeight });
    }
  }, []);

  const loggedGeometry = useRef(false);
  useEffect(() => {
    if (!__DEV__ || loggedGeometry.current || viewport === null) {
      return;
    }

    loggedGeometry.current = true;
    // One line per launch: shows whether the window estimate disagrees with the
    // measured viewport on this device — the difference is the old dead band.
    console.log('[dashboard] geometry', { window: height, measured: viewport, insets: orbInsets });
  }, [height, orbInsets, viewport]);

  return (
    <ThemedView style={styles.container}>
      <View
        onLayout={handleBoxLayout}
        style={[styles.screen, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}
      >
        <ScrollView
          testID="dashboard-scroll"
          onLayout={handleViewportLayout}
          style={styles.scroll}
          contentContainerStyle={styles.content}
          scrollEnabled={!dragging}
        >
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
                  meter={meter}
                  history={history}
                  scopeFrames={scopeFrames}
                  editing={editing}
                />
              )}
            />
          )}
        </ScrollView>
      </View>

      <SettingsOrb
        theme={theme}
        window={orbWindow}
        insets={orbInsets}
        indicator={{
          status: stream.status,
          reauthRequired: stream.reauthRequired,
          fatalError: stream.fatalError,
          connectionError: stream.connectionError,
          protocolError: stream.protocolError,
        }}
        initialPosition={orbPosition}
        onDragEnd={handleOrbDragEnd}
        open={panelOpen}
        onToggle={togglePanel}
      >
        {banner !== null && (
          <ThemedText type="small" accessibilityRole="alert" testID="connection-banner">
            {banner}
          </ThemedText>
        )}

        <View style={styles.themeRow}>
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
        </View>

        {!stream.isPaired && <Button title="Scan plugin QR code" onPress={stream.startScan} />}

        {stream.isPaired && (
          <>
            <Button
              title={editing ? 'Done' : 'Edit layout'}
              onPress={() => setEditing((current) => !current)}
            />
            {editing && <Button title="Reset layout" onPress={resetLayout} />}
            <Button title="Disconnect" onPress={stream.disconnect} />
          </>
        )}

        {editing && hidden.length > 0 && (
          <ScrollView testID="hidden-tray" style={styles.tray} nestedScrollEnabled>
            <ModuleTray hidden={hidden} theme={theme} onRestore={handleRestore} />
          </ScrollView>
        )}

      </SettingsOrb>

      {__DEV__ && (
        <View style={styles.devOverlay} pointerEvents="none">
          <StreamMetricsLine color="#FFFFFF" />
        </View>
      )}

      <PairingScannerOverlay
        visible={stream.isScanning}
        error={stream.scanError}
        onQrScanned={stream.handleQrScanned}
        onCancel={stream.cancelScan}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  devOverlay: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 30,
    elevation: 30,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  container: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
  themeRow: {
    gap: 6,
  },
  themeChips: {
    flexDirection: 'row',
    gap: 8,
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
  tray: {
    maxHeight: 140,
  },
});
