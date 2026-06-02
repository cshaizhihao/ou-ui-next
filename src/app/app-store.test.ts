import { useAppStore } from './app-store';

describe('app store', () => {
  beforeEach(() => {
    useAppStore.getState().reset();
    document.documentElement.classList.remove('dark');
  });

  it('manages authenticated session and theme state through Zustand', () => {
    expect(useAppStore.getState().authenticated).toBe(false);

    useAppStore.getState().authenticate();
    expect(useAppStore.getState().authenticated).toBe(true);

    useAppStore.getState().toggleTheme();
    expect(useAppStore.getState().theme).toBe('light');
    expect(document.documentElement).not.toHaveClass('dark');

    useAppStore.getState().toggleTheme();
    expect(useAppStore.getState().theme).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
  });
});
