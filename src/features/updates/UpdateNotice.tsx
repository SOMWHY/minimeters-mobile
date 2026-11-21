import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { VisualizationTheme } from '@minimetermobile/ui/dist/theme';

import type { AppUpdatePhase } from './use-app-update';

type Props = {
  phase: AppUpdatePhase;
  theme: VisualizationTheme;
  /** Safe-area top, so the pill clears the status bar on notched devices. */
  topInset: number;
  onApply: () => void;
  onDismiss: () => void;
};

/**
 * The only surface for updates: a dismissible pill, shown only when a newer
 * bundle is already known to exist.
 *
 * It sits above the grid rather than inside the settings panel because a
 * prompt nobody opens is not a prompt. Nothing is downloaded until the pill is
 * tapped, and a tap restarts the app into the new bundle immediately — there is
 * no half-applied state to explain.
 */
export function UpdateNotice({ phase, theme, topInset, onApply, onDismiss }: Props) {
  if (phase !== 'available' && phase !== 'downloading') {
    return null;
  }

  const busy = phase === 'downloading';

  return (
    <View
      testID="update-notice"
      accessibilityRole="alert"
      style={[
        styles.pill,
        {
          top: topInset + 8,
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.accent,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={theme.colors.accent} />
      ) : (
        <Text style={[styles.label, { color: theme.colors.text }]}>Update available</Text>
      )}

      <Pressable
        testID="update-apply"
        accessibilityRole="button"
        accessibilityLabel="Install update"
        accessibilityState={{ disabled: busy, busy }}
        disabled={busy}
        onPress={onApply}
        style={[styles.action, { borderColor: theme.colors.accent }]}
      >
        <Text style={[styles.actionLabel, { color: theme.colors.accent }]}>
          {busy ? 'Updating…' : 'Update'}
        </Text>
      </Pressable>

      {/*
       * Dismiss stays available while downloading: a slow fetch on a bad link
       * must not trap the user behind a spinner. The partial download is simply
       * discarded and offered again on the next launch.
       */}
      <Pressable
        testID="update-dismiss"
        accessibilityRole="button"
        accessibilityLabel="Dismiss update"
        onPress={onDismiss}
        hitSlop={8}
      >
        <Text style={[styles.dismiss, { color: theme.colors.textMuted }]}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 14,
    paddingRight: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  action: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  dismiss: {
    fontSize: 15,
    paddingHorizontal: 2,
  },
});
