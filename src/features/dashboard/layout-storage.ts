import { normalizeLayout, type DashboardItem, type DashboardLayout, type GridConfig } from '@minimetermobile/ui/dist/dashboard';

import { defaultLayout } from './model';

/** Storage key; the version suffix lets a future format change discard old payloads. */
export const LAYOUT_STORAGE_KEY = 'minimeters.dashboard.layout.v1';

const STORED_VERSION = 1;

/**
 * The slice of `AsyncStorage` we use.
 *
 * Injected rather than imported so the module is testable in Node and so the
 * host can swap in a mock during development.
 */
export interface LayoutStorageDeps {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

interface StoredLayout {
  readonly version: number;
  readonly items: readonly DashboardItem[];
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function isStoredPlacement(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const placement = value as Record<string, unknown>;

  return (
    isFiniteInteger(placement.col) &&
    isFiniteInteger(placement.row) &&
    isFiniteInteger(placement.colSpan) &&
    isFiniteInteger(placement.rowSpan) &&
    placement.colSpan > 0 &&
    placement.rowSpan > 0
  );
}

function isStoredItem(value: unknown): value is DashboardItem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const item = value as Record<string, unknown>;

  return (
    typeof item.id === 'string' &&
    typeof item.kind === 'string' &&
    typeof item.visible === 'boolean' &&
    isStoredPlacement(item.placement)
  );
}

function parseStored(raw: string | null): readonly unknown[] | null {
  if (raw === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    const payload = parsed as Partial<StoredLayout>;

    if (payload.version !== STORED_VERSION || !Array.isArray(payload.items)) {
      return null;
    }

    return payload.items;
  } catch {
    return null;
  }
}

/**
 * Merge stored items onto the factory list.
 *
 * The factory list is the source of truth for which modules exist, so a stored
 * layout written by an older build cannot resurrect a removed module, and a
 * module added since then still appears. Per item, the first well-formed entry
 * with a matching `id` and `kind` wins; anything else falls back to factory.
 */
function reconcile(stored: readonly unknown[], config: GridConfig): DashboardItem[] {
  const claimed = new Set<string>();
  const usable = stored.filter((entry): entry is DashboardItem => {
    if (!isStoredItem(entry) || claimed.has(entry.id)) {
      return false;
    }

    claimed.add(entry.id);
    return true;
  });

  const merged = defaultLayout().items.map((factoryItem) => {
    const match = usable.find(
      (candidate) => candidate.id === factoryItem.id && candidate.kind === factoryItem.kind,
    );

    if (!match) {
      return factoryItem;
    }

    return {
      ...factoryItem,
      visible: match.visible,
      placement: {
        col: match.placement.col,
        row: match.placement.row,
        colSpan: match.placement.colSpan,
        rowSpan: match.placement.rowSpan,
      },
    };
  });

  return normalizeLayout(merged, config);
}

/**
 * Read the stored layout, always returning something renderable.
 *
 * Never rejects: a missing, corrupt, outdated, or unreadable payload yields the
 * factory arrangement, because a dashboard that refuses to render is worse than
 * a dashboard that forgets its arrangement.
 */
export async function loadLayout(
  deps: LayoutStorageDeps,
  config: GridConfig,
): Promise<DashboardLayout> {
  try {
    const stored = parseStored(await deps.getItem(LAYOUT_STORAGE_KEY));

    if (stored === null) {
      return { items: normalizeLayout(defaultLayout().items, config) };
    }

    return { items: reconcile(stored, config) };
  } catch {
    return defaultLayout();
  }
}

/** Persist the settled layout. Storage failures are swallowed for the same reason. */
export async function saveLayout(deps: LayoutStorageDeps, layout: DashboardLayout): Promise<void> {
  const payload: StoredLayout = {
    version: STORED_VERSION,
    items: layout.items.map((item) => ({
      id: item.id,
      kind: item.kind,
      visible: item.visible,
      placement: {
        col: item.placement.col,
        row: item.placement.row,
        colSpan: item.placement.colSpan,
        rowSpan: item.placement.rowSpan,
      },
    })),
  };

  try {
    await deps.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Losing a layout edit is acceptable; crashing the screen is not.
  }
}

/** Forget the stored layout, so the next load is the factory one. */
export async function clearLayout(deps: LayoutStorageDeps): Promise<void> {
  try {
    await deps.removeItem(LAYOUT_STORAGE_KEY);
  } catch {
    // Same rationale as `saveLayout`.
  }
}

/** Storage key for the chosen visualization theme. */
export const THEME_STORAGE_KEY = 'minimeters.dashboard.theme.v1';

/**
 * Read the stored theme id, falling back to `fallbackId`.
 *
 * Never rejects and never returns an id the theme registry does not know, so a
 * stale or hand-edited value cannot blank the dashboard.
 */
export async function loadTheme<Id extends string>(
  deps: LayoutStorageDeps,
  known: readonly Id[],
  fallbackId: Id = known[0],
): Promise<Id> {
  try {
    const stored = await deps.getItem(THEME_STORAGE_KEY);

    if (stored !== null && (known as readonly string[]).includes(stored)) {
      return stored as Id;
    }
  } catch {
    // Fall through to the default, same rationale as `loadLayout`.
  }

  return fallbackId;
}

/** Persist the chosen theme id. Storage failures are swallowed. */
export async function saveTheme(deps: LayoutStorageDeps, themeId: string): Promise<void> {
  try {
    await deps.setItem(THEME_STORAGE_KEY, themeId);
  } catch {
    // Same rationale as `saveLayout`.
  }
}
