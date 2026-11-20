/**
 * Pure geometry for the floating settings orb.
 *
 * No React and no storage: the component owns gestures, this owns "where is it
 * allowed to be". Kept separate so the clamping rules are testable in Node.
 */

/** Diameter of the orb, in dp. */
export const ORB_SIZE = 44;

/** Gap between the orb and the safe-area edge, in dp. */
export const ORB_MARGIN = 16;

/** Drag distance below which a gesture counts as a tap, in dp. */
export const ORB_TAP_SLOP = 8;

export type OrbPosition = {
  readonly x: number;
  readonly y: number;
};

export type OrbWindow = {
  readonly width: number;
  readonly height: number;
};

export type OrbInsets = {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
};

const NO_INSETS: OrbInsets = { top: 0, bottom: 0, left: 0, right: 0 };

function bounds(window: OrbWindow, insets: OrbInsets) {
  const minX = insets.left + ORB_MARGIN;
  const minY = insets.top + ORB_MARGIN;
  const maxX = window.width - insets.right - ORB_SIZE - ORB_MARGIN;
  const maxY = window.height - insets.bottom - ORB_SIZE - ORB_MARGIN;

  return {
    // A window smaller than the orb would invert the range; collapse it instead
    // of pushing the orb off the opposite edge.
    minX: Math.min(minX, maxX),
    maxX: Math.max(minX, maxX),
    minY: Math.min(minY, maxY),
    maxY: Math.max(minY, maxY),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Bottom-right corner, inside the safe area — where a thumb already is. */
export function defaultOrbPosition(options: {
  readonly window: OrbWindow;
  readonly insets?: OrbInsets;
}): OrbPosition {
  const insets = options.insets ?? NO_INSETS;
  const { maxX, maxY } = bounds(options.window, insets);

  return { x: maxX, y: maxY };
}

/** Keep the orb on screen after a drag, a rotation, or a restore. */
export function clampOrbPosition(options: {
  readonly position: OrbPosition;
  readonly window: OrbWindow;
  readonly insets?: OrbInsets;
}): OrbPosition {
  const insets = options.insets ?? NO_INSETS;
  const { minX, maxX, minY, maxY } = bounds(options.window, insets);
  const x = Number.isFinite(options.position.x) ? options.position.x : maxX;
  const y = Number.isFinite(options.position.y) ? options.position.y : maxY;

  return { x: clamp(x, minX, maxX), y: clamp(y, minY, maxY) };
}

/** `{"x":12,"y":300}`; anything unreadable returns `null` so callers fall back. */
export function parseOrbPosition(value: string | null): OrbPosition | null {
  if (value === null || value.length === 0) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    const { x, y } = parsed as Record<string, unknown>;

    if (typeof x !== 'number' || typeof y !== 'number') {
      return null;
    }

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }

    return { x, y };
  } catch {
    return null;
  }
}

export function serializeOrbPosition(position: OrbPosition): string {
  return JSON.stringify({ x: Math.round(position.x), y: Math.round(position.y) });
}

/**
 * Which side of the orb the settings card opens on.
 *
 * The card is wider than it is tall, so it prefers to sit above the orb and
 * flips below when the orb is near the top of the screen.
 */
export function panelSide(position: OrbPosition, window: OrbWindow): {
  readonly horizontal: 'left' | 'right';
  readonly vertical: 'above' | 'below';
} {
  return {
    horizontal: position.x + ORB_SIZE / 2 > window.width / 2 ? 'left' : 'right',
    vertical: position.y + ORB_SIZE / 2 > window.height / 2 ? 'above' : 'below',
  };
}
