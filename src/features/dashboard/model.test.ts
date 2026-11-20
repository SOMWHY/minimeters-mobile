import {
  GRID_PRESETS,
  type DashboardItem,
  type GridPlacement,
} from '@minimetermobile/ui/dist/dashboard';

import {
  DASHBOARD_SHORT_SIDE_THRESHOLD,
  DEFAULT_DASHBOARD_ITEMS,
  defaultLayout,
  fitRowsToViewport,
  fitToConfig,
  gridForWindow,
  layoutRowCount,
  MAX_ROW_HEIGHT,
  MIN_ROW_HEIGHT,
  restoreFactoryLayout,
  viewportHeight,
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

describe('gridForWindow', () => {
  it('keeps the phone preset in both orientations', () => {
    const portrait = gridForWindow({ width: 390, height: 844 });
    const landscape = gridForWindow({ width: 844, height: 390 });

    for (const { config, metrics } of [portrait, landscape]) {
      expect(metrics).toEqual(GRID_PRESETS.phone);
      expect(config.columns).toBe(2);
      expect(config.maxColSpan).toBe(2);
    }
  });

  it('decides on the short side, so a wide phone stays two columns', () => {
    const wideButShort = gridForWindow({
      width: 2000,
      height: DASHBOARD_SHORT_SIDE_THRESHOLD - 1,
    });

    expect(wideButShort.metrics).toEqual(GRID_PRESETS.phone);
    expect(wideButShort.config.columns).toBe(2);
  });

  it('uses the tablet preset at the threshold in either orientation', () => {
    const portrait = gridForWindow({
      width: DASHBOARD_SHORT_SIDE_THRESHOLD,
      height: 1280,
    });
    const landscape = gridForWindow({ width: 1024, height: 768 });

    for (const { config, metrics } of [portrait, landscape]) {
      expect(metrics).toEqual(GRID_PRESETS.tablet);
      expect(config.columns).toBe(4);
      expect(config.maxColSpan).toBe(4);
      expect(config.maxRowSpan).toBe(4);
    }
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
    const wide = gridForWindow({ width: 1024, height: 768 });
    const wideItems: DashboardItem[] = DEFAULT_DASHBOARD_ITEMS.map((item, index) =>
      index === 0
        ? { ...item, placement: { col: 0, row: 0, colSpan: 4, rowSpan: 1 } }
        : item,
    );

    const fitted = fitToConfig(wideItems, wide.config);
    expect(fitted).toHaveLength(7);

    const phone = gridForWindow({ width: 390, height: 844 });
    const squeezed = fitToConfig(fitted, phone.config);

    expect(squeezed).toHaveLength(7);
    expect(squeezed.every((item) => item.placement.colSpan <= 2)).toBe(true);
    expectNoOverlap(squeezed, phone.config.columns);
  });
});

describe('restoreFactoryLayout', () => {
  it('brings back the factory arrangement after edits', () => {
    const phone = gridForWindow({ width: 390, height: 844 });
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

describe('layoutRowCount', () => {
  it('counts the rows a layout occupies, not the items', () => {
    expect(layoutRowCount(DEFAULT_DASHBOARD_ITEMS)).toBe(6);
  });

  it('ignores hidden items', () => {
    const items = DEFAULT_DASHBOARD_ITEMS.map((item) =>
      item.kind === 'spectrogram' ? { ...item, visible: false } : item,
    );

    expect(layoutRowCount(items)).toBe(4);
  });

  it('never reports fewer than one row', () => {
    expect(layoutRowCount([])).toBe(1);
  });
});

describe('viewportHeight', () => {
  it('reserves the status bar and nothing else', () => {
    // The bottom inset is what used to leave a dead band under the last row.
    expect(viewportHeight({ windowHeight: 844, insets: { top: 47 } })).toBe(797);
  });

  it('never goes negative', () => {
    expect(viewportHeight({ windowHeight: 20, insets: { top: 47 } })).toBe(0);
  });

  it('survives a negative or absurd inset', () => {
    expect(viewportHeight({ windowHeight: 800, insets: { top: -10 } })).toBe(800);
    expect(viewportHeight({ windowHeight: 800, insets: { top: Number.NaN } })).toBe(800);
    expect(viewportHeight({ windowHeight: Number.NaN, insets: { top: 0 } })).toBe(0);
  });
});

describe('fitRowsToViewport', () => {
  const preset = GRID_PRESETS.phone;

  /** The grid's own height for a fitted metrics: padding, rows, and the gaps. */
  function gridHeight(metrics: { rowHeight: number; gap: number; padding: number }, rows: number) {
    return metrics.padding * 2 + rows * metrics.rowHeight + metrics.gap * (rows - 1);
  }

  it('makes the grid exactly as tall as the viewport', () => {
    const availableHeight = 742;
    const rows = 6;
    const metrics = fitRowsToViewport({ availableHeight, rows, preset });

    expect(gridHeight(metrics, rows)).toBeCloseTo(availableHeight, 5);
    // Whatever it takes to fill the screen, the columns/gap/padding are untouched.
    expect(metrics.columns).toBe(preset.columns);
    expect(metrics.gap).toBe(preset.gap);
    expect(metrics.padding).toBe(preset.padding);
  });

  it('fills a tall portrait screen even with only four rows', () => {
    // The row height needed here (≈209 dp) is above the old 200 dp ceiling,
    // which capped the fit and left the strip the user kept seeing.
    const availableHeight = 900;
    const rows = 4;
    const metrics = fitRowsToViewport({ availableHeight, rows, preset });

    expect(gridHeight(metrics, rows)).toBeCloseTo(availableHeight, 5);
  });

  it('keeps cards readable on a tall screen', () => {
    // A single-row layout on a tablet-sized viewport would otherwise be enormous.
    expect(fitRowsToViewport({ availableHeight: 2_000, rows: 1, preset }).rowHeight).toBe(
      MAX_ROW_HEIGHT,
    );
  });

  it('falls back to the minimum height when the layout cannot fit', () => {
    // Twelve rows on a short screen: scroll rather than squeeze to nothing.
    expect(fitRowsToViewport({ availableHeight: 400, rows: 12, preset }).rowHeight).toBe(
      MIN_ROW_HEIGHT,
    );
  });

  it('rounds to one decimal so the layout does not drift by fractions', () => {
    const { rowHeight } = fitRowsToViewport({ availableHeight: 700, rows: 7, preset });

    expect(rowHeight).toBe(Math.round(rowHeight * 10) / 10);
  });

  it('treats a zero-row or unmeasured viewport as one row at the floor', () => {
    expect(fitRowsToViewport({ availableHeight: 0, rows: 0, preset }).rowHeight).toBe(
      MIN_ROW_HEIGHT,
    );
    expect(fitRowsToViewport({ availableHeight: Number.NaN, rows: 3, preset }).rowHeight).toBe(
      MIN_ROW_HEIGHT,
    );
  });
});
