import type { DashboardItem, DashboardLayout, GridPlacement } from '@minimetermobile/ui/dist/dashboard';

import { defaultLayout, gridForWidth } from './model';
import {
  LAYOUT_STORAGE_KEY,
  clearLayout,
  loadLayout,
  saveLayout,
  type LayoutStorageDeps,
} from './layout-storage';

function memoryStorage(initial: Record<string, string> = {}): LayoutStorageDeps & {
  readonly store: Map<string, string>;
} {
  const store = new Map(Object.entries(initial));

  return {
    store,
    getItem: async (key) => store.get(key) ?? null,
    setItem: async (key, value) => {
      store.set(key, value);
    },
    removeItem: async (key) => {
      store.delete(key);
    },
  };
}

const phone = gridForWidth(390);

function keys(layout: DashboardLayout): string[] {
  return layout.items.map(
    (item) =>
      `${item.id}:${item.placement.col},${item.placement.row},${item.placement.colSpan},${item.placement.rowSpan}:${item.visible}`,
  );
}

function overlaps(a: GridPlacement, b: GridPlacement): boolean {
  const horizontal = a.col < b.col + b.colSpan && b.col < a.col + a.colSpan;
  const vertical = a.row < b.row + b.rowSpan && b.row < a.row + a.rowSpan;

  return horizontal && vertical;
}

function expectNoOverlap(items: readonly DashboardItem[], columns: number) {
  for (const item of items) {
    expect(item.placement.col).toBeGreaterThanOrEqual(0);
    expect(item.placement.col + item.placement.colSpan).toBeLessThanOrEqual(columns);
  }

  for (let index = 0; index < items.length; index += 1) {
    for (let other = index + 1; other < items.length; other += 1) {
      expect(overlaps(items[index].placement, items[other].placement)).toBe(false);
    }
  }
}

describe('loadLayout', () => {
  it('falls back to the factory layout when nothing is stored', async () => {
    const storage = memoryStorage();

    const layout = await loadLayout(storage, phone.config);

    expect(keys(layout)).toEqual(keys(defaultLayout()));
  });

  it('returns the factory layout for unreadable payloads', async () => {
    for (const payload of ['not json', '{}', '{"version":2,"items":[]}', '{"version":1,"items":"nope"}']) {
      const storage = memoryStorage({ [LAYOUT_STORAGE_KEY]: payload });

      const layout = await loadLayout(storage, phone.config);

      expect(keys(layout)).toEqual(keys(defaultLayout()));
    }
  });

  it('keeps a stored arrangement and its hidden state', async () => {
    const stored = memoryStorage();
    const edited: DashboardLayout = {
      items: defaultLayout().items.map((item) =>
        item.kind === 'vu'
          ? { ...item, visible: false, placement: { col: 1, row: 0, colSpan: 1, rowSpan: 1 } }
          : item.kind === 'waveform'
            ? { ...item, placement: { col: 0, row: 3, colSpan: 1, rowSpan: 2 } }
            : item,
      ),
    };

    await saveLayout(stored, edited);
    const layout = await loadLayout(stored, phone.config);
    const vu = layout.items.find((item) => item.kind === 'vu');
    const waveform = layout.items.find((item) => item.kind === 'waveform');

    expect(vu).toMatchObject({ visible: false });
    expect(waveform?.placement).toMatchObject({ colSpan: 1, rowSpan: 2 });
    expect(layout.items).toHaveLength(7);
  });

  it('replaces unknown, duplicated, and corrupt entries with factory ones', async () => {
    const payload = JSON.stringify({
      version: 1,
      items: [
        { id: 'waveform', kind: 'waveform', visible: false, placement: { col: 0, row: 6, colSpan: 2, rowSpan: 1 } },
        { id: 'waveform', kind: 'waveform', visible: true, placement: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } },
        { id: 'ghost', kind: 'waveform', visible: true, placement: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } },
        { id: 'vu', kind: 'not-a-module', visible: true, placement: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } },
        { id: 'spectrum', kind: 'spectrum', visible: true, placement: { col: 0, row: null, colSpan: 2, rowSpan: 1 } },
      ],
    });
    const storage = memoryStorage({ [LAYOUT_STORAGE_KEY]: payload });

    const layout = await loadLayout(storage, phone.config);
    const ids = layout.items.map((item) => item.id);

    expect(layout.items).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
    expect(ids).not.toContain('ghost');
    expect(layout.items.find((item) => item.kind === 'waveform')?.visible).toBe(false);

    const spectrum = layout.items.find((item) => item.kind === 'spectrum');
    expect(spectrum?.visible).toBe(true);
    expect(spectrum?.placement.colSpan).toBe(2);
    expect(Number.isInteger(spectrum?.placement.row)).toBe(true);
    expectNoOverlap(layout.items, phone.config.columns);
  });

  it('clamps a stored wide layout onto a narrower grid', async () => {
    const wide = gridForWidth(1024);
    const storage = memoryStorage({
      [LAYOUT_STORAGE_KEY]: JSON.stringify({
        version: 1,
        items: defaultLayout().items.map((item) => ({
          ...item,
          placement: { col: 0, row: item.placement.row, colSpan: 4, rowSpan: 1 },
        })),
      }),
    });

    const layout = await loadLayout(storage, phone.config);

    expect(wide.config.columns).toBe(4);
    expect(layout.items.every((item) => item.placement.colSpan <= 2)).toBe(true);
    for (const item of layout.items) {
      expect(item.placement.col + item.placement.colSpan).toBeLessThanOrEqual(2);
    }
  });
});

describe('saveLayout', () => {
  it('writes a versioned payload under the layout key', async () => {
    const storage = memoryStorage();

    await saveLayout(storage, defaultLayout());

    const raw = storage.store.get(LAYOUT_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string)).toMatchObject({ version: 1 });
    expect(JSON.parse(raw as string).items).toHaveLength(7);
  });

  it('swallows storage failures so the dashboard keeps rendering', async () => {
    const failing: LayoutStorageDeps = {
      getItem: async () => {
        throw new Error('disk on fire');
      },
      setItem: async () => {
        throw new Error('disk on fire');
      },
      removeItem: async () => {
        throw new Error('disk on fire');
      },
    };

    await expect(saveLayout(failing, defaultLayout())).resolves.toBeUndefined();
    await expect(clearLayout(failing)).resolves.toBeUndefined();
    await expect(loadLayout(failing, phone.config)).resolves.toMatchObject({
      items: expect.any(Array),
    });
  });
});

describe('clearLayout', () => {
  it('removes the stored layout', async () => {
    const storage = memoryStorage();
    await saveLayout(storage, defaultLayout());

    await clearLayout(storage);

    expect(storage.store.has(LAYOUT_STORAGE_KEY)).toBe(false);
    expect(keys(await loadLayout(storage, phone.config))).toEqual(keys(defaultLayout()));
  });
});
