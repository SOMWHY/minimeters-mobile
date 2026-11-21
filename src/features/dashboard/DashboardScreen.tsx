import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
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
import { UpdateNotice } from '@/features/updates/UpdateNotice';
import { useAppUpdate } from '@/features/updates/use-app-update';

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
import { useDashboardLayout } from './use-dashboard-layout';
import { useFullscreen } from './use-fullscreen';
import { scanErrorKey, LOCALES, useI18n } from '@/i18n';
import { useLiveAnalysis } from './use-live-analysis';

const themeIds = Object.keys(BUILT_IN_THEMES);

/**
 * Language names are written in their own language, never translated — a user
 * looking for their language should recognise it before switching to it.
 */
const LOCALE_NAMES = { zh: '中文', en: 'English' } as const;

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
  const { t, locale, setLocale } = useI18n();
  const { analysis, frame: scopeFrame, history, scopeFrames, meter } = useLiveAnalysis();

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
  const { layout, themeId, fullscreen, setLayout, setThemeId, setFullscreen, resetLayout } =
    useDashboardLayout(config, storage, themeIds, defaultThemeId);

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
  /**
   * In fullscreen the status bar is hidden, so the strip it occupied is padding
   * the user paid for and cannot see. Zeroing the inset is what actually lets
   * the grid reach the notch; hiding the bar alone would leave the dead band.
   */
  const topInset = fullscreen ? 0 : insets.top;

  const availableHeight = gridViewport({
    measured: viewport,
    windowHeight: height,
    insets: { top: topInset },
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
    () => ({
      // Fullscreen pulls the clamp in to the physical edges, so the orb can be
      // parked in a corner the system bars used to reserve.
      top: topInset,
      bottom: fullscreen ? 0 : insets.bottom,
      left: insets.left,
      right: insets.right,
    }),
    [fullscreen, insets.bottom, insets.left, insets.right, topInset],
  );
  const orbStorage = storage ?? AsyncStorage;

  const [orbPosition, setOrbPosition] = useState<OrbPosition>(() =>
    defaultOrbPosition({ window: { width, height }, insets: orbInsets }),
  );
  const [panelOpen, setPanelOpen] = useState(false);  const [manualOpen, setManualOpen] = useState(false);
  const [manualAddress, setManualAddress] = useState('');
  const [manualToken, setManualToken] = useState('');
  const toggleManualEntry = useCallback(() => {
    setManualOpen((open) => {
      // Opening starts from a clean slate; a stale error from a previous attempt
      // would otherwise read as if this one had already failed.
      if (!open) {
        stream.clearScanError();
      }

      return !open;
    });
  }, [stream]);
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
          insets: {
            top: topInset,
            bottom: fullscreen ? 0 : insets.bottom,
            left: insets.left,
            right: insets.right,
          },
        }),
      );
    });

    return () => {
      active = false;
    };
  }, [fullscreen, insets.bottom, insets.left, insets.right, orbStorage, orbWindow, topInset]);

  const handleOrbDragEnd = useCallback(
    (position: OrbPosition) => {
      setOrbPosition(position);
      void saveOrbPosition(orbStorage, position);
    },
    [orbStorage],
  );

  const update = useAppUpdate();

  const togglePanel = useCallback(() => setPanelOpen((current) => !current), []);

  const handleRestore = (id: string) => {
    if (!layout) {
      return;
    }

    setLayout({ items: setVisibility(layout.items, id, true, config) });
  };

  const banner = stream.reauthRequired
    ? t(stream.hasDeviceToken ? 'banner.reauth' : 'banner.reauthNoToken')
    : stream.fatalError
      ? t(stream.fatalError === 'protocol' ? 'banner.protocol' : 'banner.unreachable')
      : stream.reconnecting
        ? t('banner.reconnecting', { attempt: stream.retryAttempt })
        : stream.connectionError
          ? t('banner.error', { detail: stream.connectionError })
          : stream.protocolError
            ? t('banner.protocolError', { detail: stream.protocolError })
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

  useFullscreen(fullscreen);

  return (
    <ThemedView style={styles.container}>
      <StatusBar hidden={fullscreen} />
      <View
        testID="dashboard-screen"
        onLayout={handleBoxLayout}
        style={[
          styles.screen,
          { paddingTop: topInset, paddingLeft: insets.left, paddingRight: insets.right },
        ]}
      >
        <ScrollView
          testID="dashboard-scroll"
          onLayout={handleViewportLayout}
          style={styles.scroll}
          contentContainerStyle={styles.content}
          scrollEnabled={!dragging}
        >
          {layout === null ? (
            <ThemedText type="small">{t('dashboard.loading')}</ThemedText>
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
                  frame={scopeFrame}
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

      <UpdateNotice
        phase={update.phase}
        theme={theme}
        topInset={insets.top}
        onApply={update.apply}
        onDismiss={update.dismiss}
      />

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

        <View style={styles.toggleRow}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('panel.fullscreen')}
          </ThemedText>
          {/*
           * A `Pressable` pill, not RN's `Switch`: the native switch swallows
           * touches inside this floating panel on Android, and a pill matches the
           * theme chips right below it.
           */}
          <Pressable
            testID="fullscreen-toggle"
            accessibilityRole="switch"
            accessibilityLabel={t('panel.fullscreen')}
            accessibilityState={{ checked: fullscreen }}
            onPress={() => setFullscreen(!fullscreen)}
            style={[
              styles.switchTrack,
              { backgroundColor: fullscreen ? theme.colors.accent : theme.colors.axis },
            ]}
          >
            <View
              style={[
                styles.switchKnob,
                {
                  backgroundColor: theme.colors.surface,
                  marginLeft: fullscreen ? 22 : 2,
                },
              ]}
            />
          </Pressable>
        </View>

        <View style={styles.themeRow}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('panel.theme')}
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

        <View style={styles.themeRow}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('panel.language')}
          </ThemedText>
          <View style={styles.themeChips}>
            {LOCALES.map((id) => {
              const selected = id === locale;

              return (
                <Pressable
                  key={id}
                  testID={`locale-${id}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setLocale(id)}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <ThemedText type="small" themeColor={selected ? 'text' : 'textSecondary'}>
                    {LOCALE_NAMES[id]}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>

        {!stream.isPaired && (
          <>
            <Button title={t('panel.scanQr')} onPress={stream.startScan} />
            <Button
              title={manualOpen ? t('panel.cancelManual') : t('panel.enterManual')}
              onPress={toggleManualEntry}
            />
            {manualOpen && (
              <View style={styles.manualForm}>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('panel.manualHint')}
                </ThemedText>
                <TextInput
                  testID="manual-address"
                  value={manualAddress}
                  onChangeText={setManualAddress}
                  placeholder={t('panel.addressPlaceholder')}
                  placeholderTextColor={theme.colors.axis}
                  autoCapitalize="none"
                  autoCorrect={false}
                  inputMode="url"
                  style={[
                    styles.input,
                    { color: theme.colors.text, borderColor: theme.colors.axis },
                  ]}
                />
                <TextInput
                  testID="manual-token"
                  value={manualToken}
                  onChangeText={setManualToken}
                  placeholder={t('panel.tokenPlaceholder')}
                  placeholderTextColor={theme.colors.axis}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[
                    styles.input,
                    { color: theme.colors.text, borderColor: theme.colors.axis },
                  ]}
                />
                {stream.scanError !== null && (
                  <ThemedText testID="manual-error" type="small" themeColor="textSecondary">
                    {t(scanErrorKey(stream.scanError))}
                  </ThemedText>
                )}
                <Button
                  title={t('panel.connect')}
                  onPress={() => stream.pairManually(manualAddress, manualToken)}
                />
              </View>
            )}
          </>
        )}

        {stream.isPaired && (
          <>
            <Button
              title={editing ? t('panel.done') : t('panel.editLayout')}
              onPress={() => setEditing((current) => !current)}
            />
            {editing && <Button title={t('panel.resetLayout')} onPress={resetLayout} />}
            <Button title={t('panel.disconnect')} onPress={stream.disconnect} />
          </>
        )}

        {editing && hidden.length > 0 && (
          <ScrollView testID="hidden-tray" style={styles.tray} nestedScrollEnabled>
            <ModuleTray hidden={hidden} theme={theme} onRestore={handleRestore} />
          </ScrollView>
        )}

      </SettingsOrb>

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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  switchTrack: {
    width: 46,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
  },
  switchKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
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
  manualForm: {
    gap: 8,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
});
