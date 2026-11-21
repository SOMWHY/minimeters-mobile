import { parseOrbPosition, serializeOrbPosition, type OrbPosition } from './settings-orb';

/**
 * Storage key; the version suffix lets a format change discard old payloads.
 *
 * v2 because the default moved from the bottom-right corner to right-centre: a
 * position saved by v1 would pin every existing install to the old corner and
 * they would never see the new default. Dropping v1 is the migration — the orb
 * simply appears at the new spot once, then remembers wherever it is dragged.
 */
export const ORB_STORAGE_KEY = 'minimeters.dashboard.orb.v2';

/**
 * The slice of `AsyncStorage` we use.
 *
 * Same shape as `LayoutStorageDeps` so the screen can hand both the same
 * injected store (and tests can hand both the same fake).
 */
export interface OrbStorageDeps {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
}

/**
 * A remembered orb position, or `null`.
 *
 * A missing or unreadable value is not an error: the orb simply starts in its
 * default spot, which is why this never throws.
 */
export async function loadOrbPosition(
  storage: OrbStorageDeps,
): Promise<OrbPosition | null> {
  try {
    return parseOrbPosition(await storage.getItem(ORB_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Best-effort write; a failed save only costs the position on next launch. */
export async function saveOrbPosition(
  storage: OrbStorageDeps,
  position: OrbPosition,
): Promise<void> {
  try {
    await storage.setItem(ORB_STORAGE_KEY, serializeOrbPosition(position));
  } catch {
    // Ignored on purpose: nothing the user can act on.
  }
}
