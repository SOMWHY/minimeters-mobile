import { useCallback, useEffect, useRef, useState } from 'react';

import { expoUpdateService, type UpdateService } from './update-service';

/**
 * - `unsupported`: this build cannot receive updates (dev client, no runtime).
 * - `checking`: launch-time lookup in flight.
 * - `idle`: nothing newer, or the user dismissed the offer.
 * - `available`: a newer bundle exists and is **not** downloaded yet.
 * - `downloading`: fetch + restart in progress.
 */
export type AppUpdatePhase = 'unsupported' | 'checking' | 'idle' | 'available' | 'downloading';

export type AppUpdate = {
  phase: AppUpdatePhase;
  /** Downloads the pending bundle and restarts. No-op unless `available`. */
  apply: () => void;
  /** Hides the offer for the rest of this session. */
  dismiss: () => void;
};

/**
 * Checks once at launch and never downloads on its own.
 *
 * The check is deliberately fire-and-forget: no retry, no spinner on screen,
 * no error. An update is an offer, so the only visible states are "there is
 * one" and "there is not". Downloading happens only on `apply`, because a
 * background fetch would restart the app under the user's hands.
 */
export function useAppUpdate(service: UpdateService = expoUpdateService): AppUpdate {
  const [phase, setPhase] = useState<AppUpdatePhase>(() =>
    service.enabled ? 'checking' : 'unsupported',
  );

  // One check per mount: a re-render (theme change, rotation) must not re-ask
  // the update server.
  const checked = useRef(false);

  useEffect(() => {
    if (!service.enabled || checked.current) {
      return;
    }

    checked.current = true;

    let cancelled = false;

    void service.check().then((available) => {
      if (!cancelled) {
        setPhase(available ? 'available' : 'idle');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [service]);

  const apply = useCallback(() => {
    if (phase !== 'available') {
      return;
    }

    setPhase('downloading');

    void service.downloadAndReload().catch(() => {
      // Back to the offer rather than to `idle`: the bundle is still there to
      // try again, and a dead button after a failed download is worse than an
      // offer that keeps reappearing.
      setPhase('available');
    });
  }, [phase, service]);

  const dismiss = useCallback(() => {
    setPhase((current) => (current === 'available' ? 'idle' : current));
  }, []);

  return { phase, apply, dismiss };
}
