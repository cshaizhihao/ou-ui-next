import { create } from 'zustand';

export type AppTheme = 'dark' | 'light';
export type AppLanguage = 'zh' | 'en';

type AppState = {
  authenticated: boolean;
  theme: AppTheme;
  language: AppLanguage;
};

type AppActions = {
  authenticate: () => void;
  logout: () => void;
  reset: () => void;
  setLanguage: (language: AppLanguage) => void;
  setTheme: (theme: AppTheme) => void;
  toggleTheme: () => void;
};

const initialState: AppState = {
  authenticated: false,
  theme: 'dark',
  language: 'zh'
};

function applyTheme(theme: AppTheme) {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export const useAppStore = create<AppState & AppActions>((set, get) => ({
  ...initialState,
  authenticate: () => set({ authenticated: true }),
  logout: () => set({ authenticated: false }),
  reset: () => {
    applyTheme(initialState.theme);
    set({ ...initialState });
  },
  setLanguage: (language) => set({ language }),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme: () => {
    const nextTheme: AppTheme = get().theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    set({ theme: nextTheme });
  }
}));
