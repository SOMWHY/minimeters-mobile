import type { PcmConnectionState } from '@/features/connection/pcm-socket-client';

/** What the single status light in the toolbar can say. */
export type IndicatorTone = 'idle' | 'live' | 'error';

/** Fixed palette: one place to change if the theme ever owns these colours. */
export const INDICATOR_COLORS: Record<IndicatorTone, string> = {
  idle: '#3B82F6',
  live: '#22C55E',
  error: '#EF4444',
};

export type IndicatorInput = {
  status: PcmConnectionState;
  reauthRequired: boolean;
  fatalError: unknown;
  connectionError: unknown;
  protocolError: unknown;
};

/**
 * Fold the whole connection state into one tone.
 *
 * Error wins over a connected socket: a protocol error or a rejected token is
 * worth seeing even while the transport still looks healthy. Connecting,
 * authenticating and mid-retry all read as idle — they need no attention.
 */
export function connectionTone({
  status,
  reauthRequired,
  fatalError,
  connectionError,
  protocolError,
}: IndicatorInput): IndicatorTone {
  if (
    status === 'error' ||
    reauthRequired ||
    fatalError != null ||
    connectionError != null ||
    protocolError != null
  ) {
    return 'error';
  }

  if (status === 'connected') {
    return 'live';
  }

  return 'idle';
}

/** Spoken description of the light; the colour alone is not accessible. */
export function indicatorLabel(tone: IndicatorTone): string {
  if (tone === 'live') {
    return 'Connected';
  }

  if (tone === 'error') {
    return 'Connection error';
  }

  return 'Not connected';
}
