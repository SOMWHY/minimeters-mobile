import { fireEvent, render } from '@testing-library/react-native';
import { BUILT_IN_THEMES } from '@minimetermobile/ui/dist/theme';

import { UpdateNotice } from './UpdateNotice';

const theme = BUILT_IN_THEMES[Object.keys(BUILT_IN_THEMES)[0] as keyof typeof BUILT_IN_THEMES];

function renderNotice(
  phase: Parameters<typeof UpdateNotice>[0]['phase'],
  handlers: { onApply?: jest.Mock; onDismiss?: jest.Mock } = {},
) {
  return render(
    <UpdateNotice
      phase={phase}
      theme={theme}
      topInset={24}
      onApply={handlers.onApply ?? jest.fn()}
      onDismiss={handlers.onDismiss ?? jest.fn()}
    />,
  );
}

describe('UpdateNotice', () => {
  it('renders nothing while checking, idle, or unsupported', async () => {
    for (const phase of ['checking', 'idle', 'unsupported'] as const) {
      const view = await renderNotice(phase);

      expect(view.queryByTestId('update-notice')).toBeNull();
    }
  });

  it('offers the update and applies it on tap', async () => {
    const onApply = jest.fn();
    const view = await renderNotice('available', { onApply });

    expect(view.getByText('Update available')).toBeTruthy();

    await fireEvent.press(view.getByTestId('update-apply'));

    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('dismisses without applying', async () => {
    const onApply = jest.fn();
    const onDismiss = jest.fn();
    const view = await renderNotice('available', { onApply, onDismiss });

    await fireEvent.press(view.getByTestId('update-dismiss'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('shows progress and refuses a second apply while downloading', async () => {
    const onApply = jest.fn();
    const view = await renderNotice('downloading', { onApply });

    expect(view.getByText('Updating…')).toBeTruthy();

    await fireEvent.press(view.getByTestId('update-apply'));

    expect(onApply).not.toHaveBeenCalled();
  });

  it('still allows dismissing a download that hangs', async () => {
    const onDismiss = jest.fn();
    const view = await renderNotice('downloading', { onDismiss });

    await fireEvent.press(view.getByTestId('update-dismiss'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
