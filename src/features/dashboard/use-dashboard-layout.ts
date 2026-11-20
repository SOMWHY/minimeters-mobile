import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DashboardLayout, GridConfig } from '@minimetermobile/ui/dist/dashboard';

import {
  clearLayout,
  loadLayout,
  loadTheme,
  saveLayout,
  saveTheme,
  type LayoutStorageDeps,
} from './layout-storage';
import { defaultLayout, restoreFactoryLayout } from './model';

/** Stable empty default, so callers that pass no registry do not re-run the effect. */
const NO_THEMES: readonly string[] = [];

export type DashboardLayoutController = {
  /** `null` until the stored layout has been read; render a skeleton until then. */
  readonly layout: DashboardLayout | null;
  readonly themeId: string;
  readonly setLayout: (next: DashboardLayout) => void;
  readonly setThemeId: (next: string) => void;
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
  const loadedRef = useRef(false);

  useEffect(() => {
    let active = true;

    void loadLayout(storage, config).then((stored) => {
      if (!active) {
        return;
      }

      loadedRef.current = true;
      setLayoutState(stored);
    });

    return () => {
      active = false;
    };
  }, [config, storage]);

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

  const setThemeId = useCallback(
    (next: string) => {
      setThemeIdState(next);
      void saveTheme(storage, next);
    },
    [storage],
  );

  const setLayout = useCallback(
    (next: DashboardLayout) => {
      setLayoutState(next);

      if (loadedRef.current) {
        void saveLayout(storage, next);
      }
    },
    [storage],
  );

  const resetLayout = useCallback(() => {
    const next = restoreFactoryLayout(config);
    setLayoutState(next);
    void saveLayout(storage, next);
  }, [config, storage]);

  const forgetLayout = useCallback(() => {
    void clearLayout(storage);
    setLayoutState(defaultLayout());
  }, [storage]);

  return useMemo(
    () => ({ layout, themeId, setLayout, setThemeId, resetLayout, forgetLayout }),
    [forgetLayout, layout, resetLayout, setLayout, setThemeId, themeId],
  );
}
