import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo } from 'react';
import { EnvironmentBackdrop } from '../components/layout/environment-backdrop';
import { AppShell } from '../components/layout/app-shell';
import { LoginOverlay } from '../features/auth/login-overlay';
import { ApiProvider } from '../services/api/api-provider';
import { createControlPlaneApi } from '../services/api/create-control-plane-api';
import { useAppStore } from './app-store';

export function App() {
  const authenticated = useAppStore((state) => state.authenticated);
  const authenticate = useAppStore((state) => state.authenticate);
  const language = useAppStore((state) => state.language);
  const setLanguage = useAppStore((state) => state.setLanguage);
  const api = useMemo(
    () =>
      createControlPlaneApi({
        getCsrfToken: () => useAppStore.getState().csrfToken
      }),
    []
  );
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false
          }
        }
      }),
    []
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <LoginOverlay
          authenticated={authenticated}
          language={language}
          onAuthenticated={authenticate}
          onLanguageChange={setLanguage}
        />
        <EnvironmentBackdrop />
        {authenticated ? <AppShell ready /> : null}
      </ApiProvider>
    </QueryClientProvider>
  );
}
