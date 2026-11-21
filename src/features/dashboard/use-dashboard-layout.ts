import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DashboardLayout, GridConfig } from '@minimetermobile/ui/dist/dashboard';

import {
  clearLayout,
  loadFullscreen,
  loadLayout,
  loadTheme,
  saveFullscreen,
  saveLayout,
  saveTheme,
  type LayoutStorageDeps,
} from './layout-storage';
import { defaultLayout, fitToConfig, restoreFactoryLayout } from './model';

/** Stable empty default, so callers that pass no registry do not re-run the effect. */
const NO_THEMES: readonly string[] = [];

export type DashboardLayoutController = {
  /** `null` until the stored layout has been read; render a skeleton until then. */
  readonly layout: DashboardLayout | null;
  readonly themeId: string;
  /** True when the host asked for the immersive layout (system bars hidden). */
  readonly fullscreen: boolean;
  readonly setLayout: (next: DashboardLayout) => void;
  readonly setThemeId: (next: string) => void;
  readonly setFullscreen: (next: boolean) => void;
  readonly resetLayout: () => void;
  readonly forgetLayout: () => void;
};

/**
 * Owns the dashboard layout: read once, write on every settled change.
 *
 * Writes are fire-and-forget on purpose — a slow disk must never block a drag
 * from settling, and `saveLayout` already swallows storage failures.
 */
export function useDashboardLayout(
  config: GridConfig,
  storage: LayoutStorageDeps = AsyncStorage,
  themeIds: readonly string[] = NO_THEMES,
  defaultThemeId: string = themeIds[0] ?? '',
): DashboardLayoutController {
  const [layout, setLayoutState] = useState<DashboardLayout | null>(null);
  const [themeId, setThemeIdState] = useState(defaultThemeId);
  const [fullscreen, setFullscreenState] = useState(false);
  const loadedRef = useRef(false);
  /** Latest config without making it a load dependency: see the rotation effect. */
  const configRef = useRef(config);
  /** Latest layout for the re-fit effect, which must not re-run on every change. */
  const layoutRef = useRef<DashboardLayout | null>(null);

  useEffect(() => {
    configRef.current = config;
  });

  useEffect(() => {
    layoutRef.current = layout;
  });

  // Read the stored layout exactly once per storage backend. The grid config is
  // deliberately **not** a dependency: a rotation must re-fit the layout in hand,
  // not throw it away and reload the one from disk.
  useEffect(() => {
    let active = true;

    void loadLayout(storage, configRef.current).then((stored) => {
      if (!active) {
        return;
      }

      loadedRef.current = true;
      layoutRef.current = stored;
      setLayoutState(stored);
    });

    return () => {
      active = false;
    };
  }, [storage]);

  // Rotation or resize: clamp the layout in hand onto the new column count and
  // persist the result, so the next launch opens in the orientation it was left in.
  const columns = config.columns;

  useEffect(() => {
    const current = layoutRef.current;

    if (!loadedRef.current || current === null) {
      return;
    }

    const next = { items: fitToConfig(current.items, configRef.current) };
    layoutRef.current = next;
    setLayoutState(next);
    void saveLayout(storage, next);
  }, [columns, storage]);

  useEffect(() => {
    let active = true;

    void loadTheme(storage, themeIds, defaultThemeId).then((stored) => {
      if (active) {
        setThemeIdState(stored);
      }
    });

    return () => {
      active = false;
    };
  }, [defaultThemeId, storage, themeIds]);

  // Same one-read rule as the theme: the stored preference is applied once, and
  // the default stays windowed until it arrives.
  useEffect(() => {
    let active = true;

    void loadFullscreen(storage).then((stored) => {
      if (active) {
        setFullscreenState(stored);
      }
    });

    return () => {
      active = false;
    };
  }, [storage]);

  const setFullscreen = useCallback(
    (next: boolean) => {
      setFullscreenState(next);
      void saveFullscreen(storage, next);
    },
    [storage],
  );

  const setThemeId = useCallback(
    (next: string) => {
      setThemeIdState(next);
      void saveTheme(storage, next);
    },
    [storage],
  );

  const setLayout = useCallback(
    (next: DashboardLayout) => {
      layoutRef.current = next;
      setLayoutState(next);

      if (loadedRef.current) {
        void saveLayout(storage, next);
      }
    },
    [storage],
  );

  const resetLayout = useCallback(() => {
    const next = restoreFactoryLayout(config);
    layoutRef.current = next;
    setLayoutState(next);
    void saveLayout(storage, next);
  }, [config, storage]);

  const forgetLayout = useCallback(() => {
    const next = defaultLayout();
    layoutRef.current = next;
    void clearLayout(storage);
    setLayoutState(next);
  }, [storage]);

  return useMemo(
    () => ({
      layout,
      themeId,
      fullscreen,
      setLayout,
      setThemeId,
      setFullscreen,
      resetLayout,
      forgetLayout,
    }),
    [
      forgetLayout,
      fullscreen,
      layout,
      resetLayout,
      setFullscreen,
      setLayout,
      setThemeId,
      themeId,
    ],
  );
}
