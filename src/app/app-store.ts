import { create } from 'zustand';

export type AppTheme = 'dark' | 'light';
export type AppLanguage = 'zh' | 'en';

type AppState = {
  authenticated: boolean;
  csrfToken?: string;
  operatorSessionId?: string;
  theme: AppTheme;
  language: AppLanguage;
};

type AuthenticateInput =
  | string
  | {
      csrfToken?: string;
      operatorSessionId?: string;
    };

type AppActions = {
  authenticate: (input?: AuthenticateInput) => void;
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
  authenticate: (input) => {
    const resolved = typeof input === 'string' ? { csrfToken: input } : input;

    set({
      authenticated: true,
      csrfToken: resolved?.csrfToken,
      operatorSessionId: resolved?.operatorSessionId
    });
  },
  logout: () => set({ authenticated: false, csrfToken: undefined, operatorSessionId: undefined }),
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
