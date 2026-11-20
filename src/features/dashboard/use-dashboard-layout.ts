import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DashboardLayout, GridConfig } from '@minimetermobile/ui/dist/dashboard';

import {
  clearLayout,
  loadLayout,
  saveLayout,
  type LayoutStorageDeps,
} from './layout-storage';
import { defaultLayout, restoreFactoryLayout } from './model';

export type DashboardLayoutController = {
  /** `null` until the stored layout has been read; render a skeleton until then. */
  readonly layout: DashboardLayout | null;
  readonly setLayout: (next: DashboardLayout) => void;
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
): DashboardLayoutController {
  const [layout, setLayoutState] = useState<DashboardLayout | null>(null);
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
    () => ({ layout, setLayout, resetLayout, forgetLayout }),
    [forgetLayout, layout, resetLayout, setLayout],
  );
}
