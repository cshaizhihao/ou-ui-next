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
  const api = useMemo(() => createControlPlaneApi(), []);
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
        <LoginOverlay authenticated={authenticated} onAuthenticated={authenticate} />
        <EnvironmentBackdrop />
        <AppShell ready={authenticated} />
      </ApiProvider>
    </QueryClientProvider>
  );
}
