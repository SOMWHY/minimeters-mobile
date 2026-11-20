import {
  DEFAULT_GRID_CONFIG,
  GRID_PRESETS,
  normalizeLayout,
  type DashboardItem,
  type DashboardLayout,
  type GridConfig,
  type GridMetrics,
  type ModuleKind,
} from '@minimetermobile/ui/dist/dashboard';

/**
 * Shortest-side width at which the dashboard switches to the tablet grid.
 *
 * Keyed to the short side rather than the width on purpose: a phone in landscape
 * is still a phone, and rotating a 390 dp-wide device must not silently turn its
 * two readable columns into four cramped ones. 600 dp is above every phone and
 * below every tablet in either orientation.
 */
export const DASHBOARD_SHORT_SIDE_THRESHOLD = 600;

/**
 * Grid geometry for the current window.
 *
 * `config.columns` must follow the preset: the library measures one column from
 * `config.columns` and reads row height from `metrics`, so the two disagreeing
 * would misplace every card.
 */
export function gridForWindow(window: {
  readonly width: number;
  readonly height: number;
}): { metrics: GridMetrics; config: GridConfig } {
  const shortSide = Math.min(
    Math.abs(window.width),
    Math.abs(window.height),
  );
  const metrics =
    shortSide >= DASHBOARD_SHORT_SIDE_THRESHOLD
      ? GRID_PRESETS.tablet
      : GRID_PRESETS.phone;

  return {
    metrics,
    config: {
      ...DEFAULT_GRID_CONFIG,
      columns: metrics.columns,
      maxColSpan: metrics.columns,
    },
  };
}

type FactoryItem = {
  readonly kind: ModuleKind;
  readonly col: number;
  readonly row: number;
  readonly colSpan: number;
  readonly rowSpan: number;
};

/**
 * Factory arrangement, expressed on the two-column phone grid.
 *
 * The modules the host can feed today sit at the top; the four that need
 * host-side analysis follow, so an empty state is never the first thing seen.
 */
const FACTORY_ITEMS: readonly FactoryItem[] = [
  { kind: 'waveform', col: 0, row: 0, colSpan: 2, rowSpan: 1 },
  { kind: 'vectorscope', col: 0, row: 1, colSpan: 1, rowSpan: 1 },
  { kind: 'oscilloscope', col: 1, row: 1, colSpan: 1, rowSpan: 1 },
  { kind: 'spectrum', col: 0, row: 2, colSpan: 2, rowSpan: 1 },
  { kind: 'vu', col: 0, row: 3, colSpan: 1, rowSpan: 1 },
  { kind: 'loudness', col: 1, row: 3, colSpan: 1, rowSpan: 1 },
  { kind: 'spectrogram', col: 0, row: 4, colSpan: 2, rowSpan: 2 },
];

function toDashboardItem(item: FactoryItem): DashboardItem {
  return {
    id: item.kind,
    kind: item.kind,
    visible: true,
    placement: {
      col: item.col,
      row: item.row,
      colSpan: item.colSpan,
      rowSpan: item.rowSpan,
    },
  };
}

function factoryItems(): DashboardItem[] {
  return FACTORY_ITEMS.map(toDashboardItem);
}

/** The factory items, exported for tests and for the "reset" affordance. */
export const DEFAULT_DASHBOARD_ITEMS: readonly DashboardItem[] = Object.freeze(
  factoryItems(),
);

/** A fresh, mutable copy of the factory layout. */
export function defaultLayout(): DashboardLayout {
  return { items: factoryItems() };
}

/** Re-clamp a stored layout onto the current grid (call after a rotation). */
export function fitToConfig(
  items: readonly DashboardItem[],
  config: GridConfig,
): DashboardItem[] {
  return normalizeLayout(items, config);
}

/**
 * Show every module again in its factory arrangement.
 *
 * The library's `resetLayout` re-packs items with `autoPlace`, which loses the
 * intended arrangement, so the host keeps its own factory copy and re-clamps it.
 */
export function restoreFactoryLayout(config: GridConfig): DashboardLayout {
  return { items: normalizeLayout(factoryItems(), config) };
}
