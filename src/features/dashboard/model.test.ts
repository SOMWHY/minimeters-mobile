import {
  GRID_PRESETS,
  type DashboardItem,
  type GridPlacement,
} from '@minimetermobile/ui/dist/dashboard';

import {
  DASHBOARD_WIDTH_THRESHOLD,
  DEFAULT_DASHBOARD_ITEMS,
  defaultLayout,
  fitToConfig,
  gridForWidth,
  restoreFactoryLayout,
} from './model';

function placementKey(placement: GridPlacement): string {
  return `${placement.col},${placement.row},${placement.colSpan},${placement.rowSpan}`;
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
    expect(item.placement.row).toBeGreaterThanOrEqual(0);
  }

  for (let index = 0; index < items.length; index += 1) {
    for (let other = index + 1; other < items.length; other += 1) {
      expect(overlaps(items[index].placement, items[other].placement)).toBe(false);
    }
  }
}

describe('gridForWidth', () => {
  it('uses the phone preset below the threshold', () => {
    const { config, metrics } = gridForWidth(390);

    expect(metrics).toEqual(GRID_PRESETS.phone);
    expect(config.columns).toBe(2);
    expect(config.maxColSpan).toBe(2);
  });

  it('uses the tablet preset at and above the threshold', () => {
    const below = gridForWidth(DASHBOARD_WIDTH_THRESHOLD - 1);
    const at = gridForWidth(DASHBOARD_WIDTH_THRESHOLD);
    const wide = gridForWidth(1024);

    expect(below.metrics).toEqual(GRID_PRESETS.phone);
    expect(at.metrics).toEqual(GRID_PRESETS.tablet);
    expect(wide.config.columns).toBe(4);
    expect(wide.config.maxColSpan).toBe(4);
    expect(wide.config.maxRowSpan).toBe(4);
  });
});

describe('DEFAULT_DASHBOARD_ITEMS', () => {
  it('describes the seven modules once each', () => {
    const kinds = DEFAULT_DASHBOARD_ITEMS.map((item) => item.kind);

    expect(DEFAULT_DASHBOARD_ITEMS).toHaveLength(7);
    expect(new Set(kinds).size).toBe(7);
    expect(new Set(DEFAULT_DASHBOARD_ITEMS.map((item) => item.id)).size).toBe(7);
    expect(DEFAULT_DASHBOARD_ITEMS.every((item) => item.visible)).toBe(true);
  });

  it('fits the phone grid without overlapping', () => {
    expectNoOverlap(DEFAULT_DASHBOARD_ITEMS, GRID_PRESETS.phone.columns);
  });
});

describe('defaultLayout', () => {
  it('returns an independent copy of the factory items', () => {
    const layout = defaultLayout();

    expect(layout.items.map((item) => placementKey(item.placement))).toEqual(
      DEFAULT_DASHBOARD_ITEMS.map((item) => placementKey(item.placement)),
    );
    expect(layout.items[0].placement).not.toBe(DEFAULT_DASHBOARD_ITEMS[0].placement);
    expect(layout.items[0]).not.toBe(DEFAULT_DASHBOARD_ITEMS[0]);
  });
});

describe('fitToConfig', () => {
  it('clamps a four-column layout down to two columns', () => {
    const wide = gridForWidth(1024);
    const wideItems: DashboardItem[] = DEFAULT_DASHBOARD_ITEMS.map((item, index) =>
      index === 0
        ? { ...item, placement: { col: 0, row: 0, colSpan: 4, rowSpan: 1 } }
        : item,
    );

    const fitted = fitToConfig(wideItems, wide.config);
    expect(fitted).toHaveLength(7);

    const phone = gridForWidth(390);
    const squeezed = fitToConfig(fitted, phone.config);

    expect(squeezed).toHaveLength(7);
    expect(squeezed.every((item) => item.placement.colSpan <= 2)).toBe(true);
    expectNoOverlap(squeezed, phone.config.columns);
  });
});

describe('restoreFactoryLayout', () => {
  it('brings back the factory arrangement after edits', () => {
    const phone = gridForWidth(390);
    const scrambled: DashboardItem[] = DEFAULT_DASHBOARD_ITEMS.map((item, index) => ({
      ...item,
      visible: index % 2 === 0,
      placement: { col: index % 2, row: index, colSpan: 1, rowSpan: 1 },
    }));

    expect(fitToConfig(scrambled, phone.config)).not.toEqual(defaultLayout().items);

    const restored = restoreFactoryLayout(phone.config);

    expect(restored.items.map((item) => placementKey(item.placement))).toEqual(
      DEFAULT_DASHBOARD_ITEMS.map((item) => placementKey(item.placement)),
    );
    expect(restored.items.every((item) => item.visible)).toBe(true);
  });
});
