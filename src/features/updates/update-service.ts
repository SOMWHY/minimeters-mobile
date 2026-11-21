import * as Updates from 'expo-updates';

/**
 * The slice of EAS Update the dashboard needs, behind an interface so the
 * hook that drives it can be tested without a native updates module.
 */
export type UpdateService = {
  /** False in development builds and in runtimes built without updates. */
  enabled: boolean;
  /** Resolves `true` when a newer bundle is published for this runtime. */
  check: () => Promise<boolean>;
  /** Downloads the pending bundle and restarts into it. */
  downloadAndReload: () => Promise<void>;
};

/**
 * Real implementation.
 *
 * `check` never throws: a phone with no network at launch is the normal case,
 * and an update check is not worth a visible error. `downloadAndReload` does
 * throw, because there the user asked for it and needs to know it failed.
 */
export const expoUpdateService: UpdateService = {
  enabled: Updates.isEnabled,
  check: async () => {
    try {
      const result = await Updates.checkForUpdateAsync();

      return result.isAvailable;
    } catch {
      return false;
    }
  },
  downloadAndReload: async () => {
    // `reloadAsync` is only correct when a *new* bundle actually landed; a
    // stale publish can return `isNew: false` and reloading would drop the
    // user back into an identical screen for no reason.
    const fetched = await Updates.fetchUpdateAsync();

    if (fetched.isNew) {
      await Updates.reloadAsync();
    }
  },
};
