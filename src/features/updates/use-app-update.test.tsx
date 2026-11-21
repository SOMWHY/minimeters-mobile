import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { UpdateService } from './update-service';
import { useAppUpdate } from './use-app-update';

function service(overrides: Partial<UpdateService> = {}): UpdateService {
  return {
    enabled: true,
    check: jest.fn(async () => false),
    downloadAndReload: jest.fn(async () => undefined),
    ...overrides,
  };
}

describe('useAppUpdate', () => {
  it('checks once at launch and offers an available bundle', async () => {
    const check = jest.fn(async () => true);

    const { result } = await renderHook(() => useAppUpdate(service({ check })));

    await waitFor(() => expect(result.current.phase).toBe('available'));
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('stays idle when nothing is published and never downloads on its own', async () => {
    const downloadAndReload = jest.fn(async () => undefined);

    const { result } = await renderHook(() =>
      useAppUpdate(service({ downloadAndReload })),
    );

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    expect(downloadAndReload).not.toHaveBeenCalled();
  });

  it('reports unsupported builds without asking the server', async () => {
    const check = jest.fn(async () => true);

    const { result } = await renderHook(() =>
      useAppUpdate(service({ enabled: false, check })),
    );

    expect(result.current.phase).toBe('unsupported');
    expect(check).not.toHaveBeenCalled();
  });

  it('downloads and restarts only after apply', async () => {
    let release: (() => void) | null = null;
    const downloadAndReload = jest.fn(
      () => new Promise<void>((resolve) => {
        release = resolve;
      }),
    );

    const { result } = await renderHook(() =>
      useAppUpdate(service({ check: async () => true, downloadAndReload })),
    );

    await waitFor(() => expect(result.current.phase).toBe('available'));

    await act(async () => {
      result.current.apply();
    });

    expect(downloadAndReload).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('downloading');

    await act(async () => {
      release?.();
    });
  });

  it('returns to the offer when the download fails, so it can be retried', async () => {
    const downloadAndReload = jest.fn(async () => {
      throw new Error('offline');
    });

    const { result } = await renderHook(() =>
      useAppUpdate(service({ check: async () => true, downloadAndReload })),
    );

    await waitFor(() => expect(result.current.phase).toBe('available'));

    await act(async () => {
      result.current.apply();
    });

    await waitFor(() => expect(result.current.phase).toBe('available'));
  });

  it('hides the offer on dismiss without downloading', async () => {
    const downloadAndReload = jest.fn(async () => undefined);

    const { result } = await renderHook(() =>
      useAppUpdate(service({ check: async () => true, downloadAndReload })),
    );

    await waitFor(() => expect(result.current.phase).toBe('available'));

    await act(async () => {
      result.current.dismiss();
    });

    expect(result.current.phase).toBe('idle');
    expect(downloadAndReload).not.toHaveBeenCalled();
  });

  it('ignores apply while no bundle is available', async () => {
    const downloadAndReload = jest.fn(async () => undefined);

    const { result } = await renderHook(() =>
      useAppUpdate(service({ downloadAndReload })),
    );

    await waitFor(() => expect(result.current.phase).toBe('idle'));

    await act(async () => {
      result.current.apply();
    });

    expect(downloadAndReload).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('idle');
  });
});
