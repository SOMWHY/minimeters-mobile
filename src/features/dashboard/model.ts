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
 * Vertical limits for the fitted row height, in dp.
 *
 * The floor keeps a card legible when the layout has more rows than the screen;
 * the ceiling stops a one- or two-row layout from becoming a billboard. It is
 * deliberately high: anything lower silently reintroduces the dead strip at the
 * bottom of a portrait screen, because the fitted height gets capped while the
 * grid still has to reach the bottom edge.
 */
export const MIN_ROW_HEIGHT = 56;
export const MAX_ROW_HEIGHT = 320;

/**
 * Height the dashboard may fill, in dp.
 *
 * Only the status bar is reserved. The bottom inset is deliberately *not*
 * subtracted or padded off: reserving it left a full-width band of background
 * under the last row that no module could ever reach. It is most obvious in
 * portrait, where the system bar sits at the bottom, and invisible in
 * landscape, where the same bar moves to the side and the bottom inset is 0.
 * Modules draw under the transparent bar, the way the desktop app does; the
 * settings orb clamps above the inset separately so it stays reachable.
 */
export function viewportHeight(options: {
  readonly windowHeight: number;
  readonly insets: { readonly top: number };
}): number {
  const top = Number.isFinite(options.insets.top) ? Math.max(0, options.insets.top) : 0;
  const height = Number.isFinite(options.windowHeight) ? options.windowHeight : 0;

  return Math.max(0, height - top);
}

/**
 * Height the grid may fill: the measured scroll viewport when there is one.
 *
 * `viewportHeight` above is only a first-frame estimate. On Android the window
 * height and the safe-area insets can disagree — the window under-reports the
 * navigation bar while the root view still spans the whole screen — so fitting
 * to the estimate left a band of background under the last row that no module
 * could reach and no card could be dragged into. The measured viewport is the
 * only number that describes what the grid actually has to fill, so it wins
 * whenever it exists; rotation and inset changes re-measure, which re-fits.
 */
export function gridViewport(options: {
  readonly measured?: number | null;
  readonly windowHeight: number;
  readonly insets: { readonly top: number };
}): number {
  const measured = options.measured;

  if (typeof measured === 'number' && Number.isFinite(measured) && measured > 0) {
    return measured;
  }

  return viewportHeight({ windowHeight: options.windowHeight, insets: options.insets });
}

/** Rows the layout currently occupies (`max(row + rowSpan)`), at least one. */
export function layoutRowCount(items: readonly DashboardItem[]): number {
  let rows = 0;

  for (const item of items) {
    if (item.visible) {
      rows = Math.max(rows, item.placement.row + item.placement.rowSpan);
    }
  }

  return Math.max(1, rows);
}

/**
 * Stretch the row height so `rows` rows exactly fill `availableHeight`.
 *
 * The dashboard should read as one full screen of instruments, not a grid with
 * dead space under it. Solving for the row height (rather than scaling the
 * whole grid) keeps drag/resize stepping in whole cells. When even the floor
 * cannot fit, the grid is simply taller than the viewport and the page scrolls.
 */
export function fitRowsToViewport(options: {
  readonly availableHeight: number;
  readonly rows: number;
  readonly preset: GridMetrics;
}): GridMetrics {
  const rows = Math.max(1, Math.floor(options.rows) || 1);
  const { padding, gap } = options.preset;
  const usable = options.availableHeight - padding * 2 - gap * (rows - 1);
  const fitted = Number.isFinite(usable) ? usable / rows : MIN_ROW_HEIGHT;
  const clamped = Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, fitted));

  return { ...options.preset, rowHeight: Math.round(clamped * 10) / 10 };
}

/**
 * Grid geometry for the current window.
 *
 * `config.columns` must follow the preset: the library measures one column from
 * `config.columns` and reads row height from `metrics`, so the two disagreeing
 * would misplace every card.
 *
 * When `availableHeight` and `rows` are supplied the row height is fitted to the
 * viewport; without them the preset's fixed row height is returned.
 */
export function gridForWindow(window: {
  readonly width: number;
  readonly height: number;
  readonly availableHeight?: number;
  readonly rows?: number;
}): { metrics: GridMetrics; config: GridConfig } {
  const shortSide = Math.min(
    Math.abs(window.width),
    Math.abs(window.height),
  );
  const preset =
    shortSide >= DASHBOARD_SHORT_SIDE_THRESHOLD
      ? GRID_PRESETS.tablet
      : GRID_PRESETS.phone;
  const metrics =
    window.availableHeight === undefined || window.rows === undefined
      ? preset
      : fitRowsToViewport({
          availableHeight: window.availableHeight,
          rows: window.rows,
          preset,
        });

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
