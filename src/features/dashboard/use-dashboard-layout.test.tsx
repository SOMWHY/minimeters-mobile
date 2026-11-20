import { act, renderHook, waitFor } from '@testing-library/react-native';

import type {
  DashboardItem,
  GridConfig,
} from '@minimetermobile/ui/dist/dashboard';

import type { LayoutStorageDeps } from './layout-storage';
import { LAYOUT_STORAGE_KEY } from './layout-storage';
import { gridForWindow } from './model';
import { useDashboardLayout } from './use-dashboard-layout';

const THEMES = ['midnight'];

const phone = gridForWindow({ width: 390, height: 844 });
const phoneLandscape = gridForWindow({ width: 844, height: 390 });
const tablet = gridForWindow({ width: 1024, height: 768 });

interface HookProps {
  readonly config: GridConfig;
}

function countingStorage(initial: string | null) {
  const store = new Map<string, string>();
  const counts = { reads: 0, writes: 0 };

  if (initial !== null) {
    store.set(LAYOUT_STORAGE_KEY, initial);
  }

  const deps: LayoutStorageDeps = {
    getItem: async (key) => {
      if (key === LAYOUT_STORAGE_KEY) {
        counts.reads += 1;
      }

      return store.get(key) ?? null;
    },
    setItem: async (key, value) => {
      if (key === LAYOUT_STORAGE_KEY) {
        counts.writes += 1;
      }

      store.set(key, value);
    },
    removeItem: async (key) => {
      store.delete(key);
    },
  };

  return { counts, deps };
}

/** A stored phone layout: one full-width module, one half-width in column 1. */
const storedPhoneLayout = JSON.stringify({
  version: 1,
  items: [
    {
      id: 'waveform',
      kind: 'waveform',
      visible: true,
      placement: { col: 0, row: 0, colSpan: 2, rowSpan: 1 },
    },
    {
      id: 'vu',
      kind: 'vu',
      visible: true,
      placement: { col: 1, row: 1, colSpan: 1, rowSpan: 1 },
    },
  ],
});

function renderLayout(config: GridConfig, deps: LayoutStorageDeps) {
  return renderHook(
    (props: HookProps) => useDashboardLayout(props.config, deps, THEMES),
    { initialProps: { config } },
  );
}

describe('useDashboardLayout', () => {
  it('reads the stored layout once and re-fits the layout in hand when the column count changes', async () => {
    const { counts, deps } = countingStorage(storedPhoneLayout);
    const { result, rerender } = await renderLayout(phone.config, deps);

    await waitFor(() => expect(result.current.layout).not.toBeNull());

    expect(counts.reads).toBe(1);
    // `reconcile` rebuilds every factory module the payload does not mention, so
    // the loaded layout is a superset of what was stored.
    expect(result.current.layout?.items.map((item) => item.id)).toEqual(
      expect.arrayContaining(['waveform', 'vu']),
    );

    // Hide a module: an edit that exists only in memory and in the store, never
    // in the factory layout. Reloading from storage on re-fit would lose it.
    const edited: DashboardItem[] = (result.current.layout?.items ?? []).map(
      (item) => (item.id === 'vu' ? { ...item, visible: false } : item),
    );

    await act(async () => {
      result.current.setLayout({ items: edited });
    });

    const before = result.current.layout;
    const writesAfterEdit = counts.writes;

    // A tablet-sized window: the layout in hand is clamped onto four columns.
    await rerender({ config: tablet.config });

    await waitFor(() => expect(result.current.layout).not.toBe(before));

    expect(counts.reads).toBe(1);
    expect(counts.writes).toBe(writesAfterEdit + 1);

    const after = result.current.layout;

    expect(after?.items.map((item) => item.id)).toEqual(
      before?.items.map((item) => item.id),
    );
    expect(after?.items.find((item) => item.id === 'vu')?.visible).toBe(false);

    for (const item of after?.items ?? []) {
      expect(item.placement.col + item.placement.colSpan).toBeLessThanOrEqual(4);
    }
  });

  it('leaves the layout alone when only the metrics change', async () => {
    const { counts, deps } = countingStorage(storedPhoneLayout);
    const { result, rerender } = await renderLayout(phone.config, deps);

    await waitFor(() => expect(result.current.layout).not.toBeNull());

    const before = result.current.layout;

    // Phone landscape: same two columns, new row height.
    await rerender({ config: phoneLandscape.config });

    expect(result.current.layout).toBe(before);
    expect(counts.reads).toBe(1);
    expect(counts.writes).toBe(0);
  });

  it('starts from the factory layout when nothing is stored', async () => {
    const { counts, deps } = countingStorage(null);
    const { result } = await renderLayout(phone.config, deps);

    await waitFor(() => expect(result.current.layout).not.toBeNull());

    expect(result.current.layout?.items.length).toBeGreaterThan(0);
    expect(counts.reads).toBe(1);
    expect(counts.writes).toBe(0);
  });
});
