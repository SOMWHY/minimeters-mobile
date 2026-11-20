import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import type { VisualizationTheme } from '@minimetermobile/ui';

import {
  connectionTone,
  INDICATOR_COLORS,
  indicatorLabel,
  type IndicatorInput,
} from './connection-indicator';
import {
  clampOrbPosition,
  ORB_SIZE,
  panelSide,
  type OrbInsets,
  type OrbPosition,
  type OrbWindow,
} from './settings-orb';

export type SettingsOrbProps = {
  readonly theme: VisualizationTheme;
  readonly window: OrbWindow;
  readonly insets: OrbInsets;
  /** Where the orb starts; later drags are owned here and reported upward. */
  readonly initialPosition: OrbPosition;
  /** Called once per drag, on release, so storage is not written per frame. */
  readonly onDragEnd: (position: OrbPosition) => void;
  readonly open: boolean;
  readonly onToggle: () => void;
  /**
   * Connection state, shown as the dot at the centre of the orb.
   *
   * The orb is the only thing pinned to the screen at all times, so it is the
   * one place a status light is guaranteed to be visible — no separate badge to
   * collide with the grid or the system bars.
   */
  readonly indicator: IndicatorInput;
  /** Panel body, rendered only while open. */
  readonly children: ReactNode;
};

type GestureEvent = {
  readonly nativeEvent?: { readonly pageX?: number; readonly pageY?: number };
};

function pointerOf(event: GestureEvent): { x: number; y: number } {
  const native = event.nativeEvent ?? {};

  return { x: native.pageX ?? 0, y: native.pageY ?? 0 };
}

/**
 * The only always-visible control on the dashboard.
 *
 * Tapping it opens the settings card; dragging it moves it out of the way and
 * the position survives a relaunch. Replaces the fixed bottom bar so the grid
 * can use the whole screen.
 */
export function SettingsOrb({
  theme,
  window,
  insets,
  initialPosition,
  onDragEnd,
  open,
  onToggle,
  indicator,
  children,
}: SettingsOrbProps) {
  const [position, setPosition] = useState(initialPosition);
  /**
   * Where the finger landed when the drag began; `null` between gestures.
   *
   * A ref rather than state: a move copies it into the drag translation, which
   * lives on the native driver, so a drag never re-renders the panel either.
   */
  const startRef = useRef<{
    readonly x: number;
    readonly y: number;
    readonly pageX: number;
    readonly pageY: number;
  } | null>(null);
  /**
   * Drag offset, committed to `position` on release.
   *
   * Kept off the render path on purpose: the panel is a full settings sheet, and
   * re-rendering it at every touch event is what made dragging feel heavy.
   */
  const [drag] = useState(
    () => new Animated.ValueXY({ x: 0, y: 0 }),
  );
  /** Last clamped position the drag drew, so release commits what was shown. */
  const previewRef = useRef<OrbPosition | null>(null);

  // A rotation or a restored position can leave the orb outside the new window.
  // Derived rather than stored so no effect has to write state back.
  const placed = clampOrbPosition({ position, window, insets });

  /**
   * Raw responder props instead of `PanResponder`.
   *
   * The orb needs no gesture algebra — a press on the child `Pressable` opens the
   * panel, and a move claims the touch for the drag — and the plain callbacks
   * keep the whole component free of refs.
   */
  const responders = {
    onStartShouldSetResponder: () => false,
    onMoveShouldSetResponder: () => true,
    onResponderGrant: (event: GestureEvent) => {
      const pointer = pointerOf(event);

      startRef.current = {
        x: placed.x,
        y: placed.y,
        pageX: pointer.x,
        pageY: pointer.y,
      };
    },
    onResponderMove: (event: GestureEvent) => {
      const start = startRef.current;

      if (start === null) {
        return;
      }

      const pointer = pointerOf(event);
      const next = clampOrbPosition({
        position: {
          x: start.x + pointer.x - start.pageX,
          y: start.y + pointer.y - start.pageY,
        },
        window,
        insets,
      });

      // Show the clamped result, not the raw finger delta: the orb stops at the
      // edge instead of sliding out and snapping back on release.
      previewRef.current = next;
      drag.setValue({ x: next.x - start.x, y: next.y - start.y });
    },
    onResponderRelease: () => {
      const start = startRef.current;

      if (start === null) {
        return;
      }

      startRef.current = null;

      const released = previewRef.current ?? { x: start.x, y: start.y };

      previewRef.current = null;
      drag.setValue({ x: 0, y: 0 });
      setPosition(released);
      onDragEnd(released);
    },
    onResponderTerminate: () => {
      startRef.current = null;
      previewRef.current = null;
      drag.setValue({ x: 0, y: 0 });
    },
  };

  const side = panelSide(placed, window);
  const tone = connectionTone(indicator);

  return (
    <Animated.View
      style={[
        styles.root,
        {
          left: placed.x,
          top: placed.y,
          transform: drag.getTranslateTransform(),
        },
      ]}
      pointerEvents="box-none"
    >
      {open && (
        <View
          testID="settings-panel"
          style={[
            styles.panel,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.axis,
              maxWidth: Math.max(0, window.width - 24),
              ...(side.vertical === 'above'
                ? { bottom: ORB_SIZE + 8 }
                : { top: ORB_SIZE + 8 }),
              ...(side.horizontal === 'left' ? { right: 0 } : { left: 0 }),
            },
          ]}
        >
          {children}
        </View>
      )}

      <View {...responders} style={styles.orbHost}>
        <Pressable
          testID="settings-orb"
          accessibilityRole="button"
          accessibilityLabel="Dashboard settings"
          accessibilityState={{ expanded: open }}
          onPress={onToggle}
          style={[
            styles.orb,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.accent },
          ]}
        >
          <View
            testID="connection-light"
            accessibilityRole="image"
            accessibilityLabel={indicatorLabel(tone)}
            style={[styles.orbDot, { backgroundColor: INDICATOR_COLORS[tone] }]}
          />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    width: ORB_SIZE,
    height: ORB_SIZE,
    zIndex: 20,
    elevation: 20,
  },
  orbHost: {
    width: ORB_SIZE,
    height: ORB_SIZE,
  },
  orb: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.92,
  },
  orbDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    opacity: 0.9,
  },
  panel: {
    position: 'absolute',
    width: 280,
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 12,
  },
});
