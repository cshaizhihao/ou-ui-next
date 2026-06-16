import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, vi } from 'vitest';
import { ConfigDrawer } from './config-drawer';

afterEach(() => {
  vi.restoreAllMocks();
});

function DrawerHarness() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <main data-testid="drawer-background">
        <button onClick={() => setOpen(true)} type="button">
          Open Drawer
        </button>
      </main>
      <ConfigDrawer
        footer={
          <button onClick={() => setOpen(false)} type="button">
            Save Changes
          </button>
        }
        open={open}
        title="Runtime Details"
        onClose={() => setOpen(false)}
      >
        <button type="button">Copy Context</button>
      </ConfigDrawer>
    </div>
  );
}

describe('ConfigDrawer', () => {
  it('moves initial focus into the drawer and keeps Tab focus inside it', async () => {
    const user = userEvent.setup();

    render(<DrawerHarness />);

    await user.click(screen.getByRole('button', { name: 'Open Drawer' }));

    const dialog = await screen.findByRole('dialog', { name: 'Runtime Details' });
    const closeButton = within(dialog).getByRole('button', { name: 'Close' });

    await waitFor(() => {
      expect(closeButton).toHaveFocus();
    });

    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).toHaveTextContent('Save Changes');

    await user.keyboard('{Tab}');
    expect(closeButton).toHaveFocus();
  });

  it('moves focus into the drawer after it mounts when the opening animation frame fires early', async () => {
    const user = userEvent.setup();

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    render(<DrawerHarness />);

    await user.click(screen.getByRole('button', { name: 'Open Drawer' }));

    const dialog = await screen.findByRole('dialog', { name: 'Runtime Details' });
    const closeButton = within(dialog).getByRole('button', { name: 'Close' });

    await waitFor(() => {
      expect(closeButton).toHaveFocus();
    });
  });

  it('does not steal focus from a drawer control if the operator reaches it before initial focus runs', async () => {
    const user = userEvent.setup();
    let initialFocusFrame: FrameRequestCallback | undefined;

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      initialFocusFrame = callback;
      return 1;
    });

    render(<DrawerHarness />);

    await user.click(screen.getByRole('button', { name: 'Open Drawer' }));

    const dialog = await screen.findByRole('dialog', { name: 'Runtime Details' });
    const copyButton = within(dialog).getByRole('button', { name: 'Copy Context' });

    copyButton.focus();
    initialFocusFrame?.(0);

    expect(copyButton).toHaveFocus();
  });

  it('closes with Escape and returns focus to the opening control', async () => {
    const user = userEvent.setup();

    render(<DrawerHarness />);

    const trigger = screen.getByRole('button', { name: 'Open Drawer' });

    await user.click(trigger);
    expect(await screen.findByRole('dialog', { name: 'Runtime Details' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Runtime Details' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });

  it('ignores a stale initial-focus frame after the drawer has closed and restored focus', async () => {
    const user = userEvent.setup();
    let initialFocusFrame: FrameRequestCallback | undefined;

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      initialFocusFrame = callback;
      return 1;
    });

    render(<DrawerHarness />);

    const trigger = screen.getByRole('button', { name: 'Open Drawer' });

    await user.click(trigger);
    expect(await screen.findByRole('dialog', { name: 'Runtime Details' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });

    initialFocusFrame?.(0);

    expect(trigger).toHaveFocus();
  });

  it('hides sibling page content from assistive technology while open', async () => {
    const user = userEvent.setup();

    render(<DrawerHarness />);

    const background = screen.getByTestId('drawer-background');

    expect(background).not.toHaveAttribute('aria-hidden');
    expect(background).not.toHaveAttribute('inert');

    await user.click(screen.getByRole('button', { name: 'Open Drawer' }));

    expect(await screen.findByRole('dialog', { name: 'Runtime Details' })).toBeInTheDocument();
    await waitFor(() => {
      expect(background).toHaveAttribute('aria-hidden', 'true');
      expect(background).toHaveAttribute('inert');
    });

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Runtime Details' })).not.toBeInTheDocument();
      expect(background).not.toHaveAttribute('aria-hidden');
      expect(background).not.toHaveAttribute('inert');
    });
  });

  it('renders as a hard-edged operations drawer instead of a glass modal', async () => {
    const user = userEvent.setup();

    render(<DrawerHarness />);

    await user.click(screen.getByRole('button', { name: 'Open Drawer' }));

    const overlay = document.querySelector('.overlay.open');
    const dialog = await screen.findByRole('dialog', { name: 'Runtime Details' });

    expect(overlay).toHaveClass('ou-drawer-overlay');
    expect(dialog).toHaveClass('ou-config-drawer');
    expect(dialog.outerHTML).not.toMatch(/\bbackdrop-blur\b|\bbg-white\/|\bbg-black\/|\brounded-full\b/u);
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveClass('ou-drawer-close');
  });
});
