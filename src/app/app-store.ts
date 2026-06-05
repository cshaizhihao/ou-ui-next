import { create } from 'zustand';

export type AppTheme = 'dark' | 'light';
export type AppLanguage = 'zh' | 'en';

type AppState = {
  authenticated: boolean;
  csrfToken?: string;
  theme: AppTheme;
  language: AppLanguage;
};

type AppActions = {
  authenticate: (csrfToken?: string) => void;
  logout: () => void;
  reset: () => void;
  setCsrfToken: (csrfToken?: string) => void;
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
  authenticate: (csrfToken) => set({ authenticated: true, csrfToken }),
  logout: () => set({ authenticated: false, csrfToken: undefined }),
  reset: () => {
    applyTheme(initialState.theme);
    set({ ...initialState });
  },
  setCsrfToken: (csrfToken) => set({ csrfToken }),
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
