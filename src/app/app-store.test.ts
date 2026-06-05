import { useAppStore } from './app-store';

describe('app store', () => {
  beforeEach(() => {
    useAppStore.getState().reset();
    document.documentElement.classList.remove('dark');
  });

  it('manages authenticated session and theme state through Zustand', () => {
    expect(useAppStore.getState().authenticated).toBe(false);

    useAppStore.getState().authenticate({
      csrfToken: 'csrf-store-token',
      operatorSessionId: 'operator-session-store-001'
    });
    expect(useAppStore.getState().authenticated).toBe(true);
    expect(useAppStore.getState().csrfToken).toBe('csrf-store-token');
    expect(useAppStore.getState().operatorSessionId).toBe('operator-session-store-001');

    useAppStore.getState().logout();
    expect(useAppStore.getState().authenticated).toBe(false);
    expect(useAppStore.getState().csrfToken).toBeUndefined();
    expect(useAppStore.getState().operatorSessionId).toBeUndefined();

    useAppStore.getState().authenticate('csrf-store-token');

    useAppStore.getState().toggleTheme();
    expect(useAppStore.getState().theme).toBe('light');
    expect(document.documentElement).not.toHaveClass('dark');

    useAppStore.getState().toggleTheme();
    expect(useAppStore.getState().theme).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
  });
});
