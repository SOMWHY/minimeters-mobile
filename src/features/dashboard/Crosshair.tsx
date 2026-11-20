import { useMemo, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import type { VisualizationTheme } from '@minimetermobile/ui';

/** Which axes the cursor draws. */
export type CrosshairKind = 'waveform' | 'spectrum' | 'spectrogram';

export type CrosshairPoint = {
  /** 0 = left edge, 1 = right edge. */
  readonly x: number;
  /** 0 = top edge, 1 = bottom edge. */
  readonly y: number;
};

export type CrosshairProps = {
  readonly kind: CrosshairKind;
  readonly theme: VisualizationTheme;
  /** Readout text at a point; `null` when there is nothing to report yet. */
  readonly readout: (point: CrosshairPoint) => string | null;
};

/** Two taps closer than this (and within the same spot) toggle the cursor. */
const DOUBLE_TAP_MS = 300;
const TAP_SLOP = 12;

type Size = { readonly width: number; readonly height: number };

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function pointerOf(event: {
  nativeEvent?: {
    locationX?: number;
    locationY?: number;
    timestamp?: number;
  };
}): { x: number; y: number; time: number } {
  const native = event.nativeEvent ?? {};

  return {
    x: native.locationX ?? 0,
    y: native.locationY ?? 0,
    time: native.timestamp ?? Date.now(),
  };
}

/**
 * Double-tap-to-measure layer that sits on top of a module.
 *
 * Deliberately its own component rather than state inside `ModuleBody`: moving
 * the cursor re-renders this overlay only, so a finger drag does not push a new
 * Skia scene through the module on every frame.
 *
 * Gestures are only mounted outside edit mode — the card's hold-then-drag owns
 * touch there, and two responders fighting over the same finger is how drags get
 * stuck.
 */
export function Crosshair({ kind, theme, readout }: CrosshairProps) {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [active, setActive] = useState(false);
  const [point, setPoint] = useState<CrosshairPoint>({ x: 0.5, y: 0.5 });
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [lastTap, setLastTap] = useState<{ x: number; y: number; time: number } | null>(null);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const { x, y } = pointerOf(event);

          setStart({ x, y });
        },
        onPanResponderMove: (event) => {
          const { x, y } = pointerOf(event);

          if (!active || size.width === 0 || size.height === 0) {
            return;
          }

          setPoint({ x: clamp01(x / size.width), y: clamp01(y / size.height) });
        },
        onPanResponderRelease: (event) => {
          const pointer = pointerOf(event);
          const from = start ?? { x: pointer.x, y: pointer.y };
          const travelled = Math.hypot(pointer.x - from.x, pointer.y - from.y);

          setStart(null);

          if (travelled > TAP_SLOP) {
            return; // A drag; the cursor already followed it.
          }

          const doubled =
            lastTap !== null &&
            pointer.time - lastTap.time <= DOUBLE_TAP_MS &&
            Math.hypot(pointer.x - lastTap.x, pointer.y - lastTap.y) <= TAP_SLOP * 2;

          if (!doubled) {
            setLastTap({ x: pointer.x, y: pointer.y, time: pointer.time });

            return;
          }

          setLastTap(null);

          if (active) {
            setActive(false);

            return;
          }

          if (size.width > 0 && size.height > 0) {
            setPoint({ x: clamp01(pointer.x / size.width), y: clamp01(pointer.y / size.height) });
          }

          setActive(true);
        },
        onPanResponderTerminate: () => setStart(null),
      }),
    [active, lastTap, size.height, size.width, start],
  );

  const color = theme.colors.traces.primary;
  const text = active ? readout(point) : null;
  const px = point.x * size.width;
  const py = point.y * size.height;
  const flipX = point.x > 0.55;
  // The spectrogram is read on both axes — a frequency line and a time line —
  // while the waveform only has a level to report for a column.
  const vertical = true;
  const horizontal = kind !== 'waveform';

  return (
    <View
      testID="crosshair-surface"
      style={StyleSheet.absoluteFill}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;

        setSize({ width, height });
      }}
      {...responder.panHandlers}
    >
      {active && size.width > 0 && size.height > 0 && (
        <>
          {vertical && (
            <View
              testID="crosshair-vertical"
              pointerEvents="none"
              style={[styles.line, { left: px, width: 1, top: 0, bottom: 0, backgroundColor: color }]}
            />
          )}
          {horizontal && (
            <View
              testID="crosshair-horizontal"
              pointerEvents="none"
              style={[styles.line, { top: py, height: 1, left: 0, right: 0, backgroundColor: color }]}
            />
          )}
          {text !== null && (
            <View
              testID="crosshair-readout"
              pointerEvents="none"
              style={[
                styles.badge,
                flipX
                  ? { right: Math.max(0, size.width - px + 10) }
                  : { left: px + 10 },
                { top: Math.min(Math.max(4, py - 12), Math.max(4, size.height - 30)) },
              ]}
            >
              <View style={styles.badgeInner}>
                <Text style={styles.badgeLabel} numberOfLines={3}>
                  {text}
                </Text>
              </View>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    position: 'absolute',
    opacity: 0.9,
  },
  badge: {
    position: 'absolute',
    maxWidth: '86%',
  },
  badgeInner: {
    backgroundColor: 'rgba(0,0,0,0.66)',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeLabel: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
