import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ApiProvider } from './api-provider';
import { controlPlaneSnapshotQueryKey, useControlPlaneSnapshot } from './use-control-plane-snapshot';
import { createMockApi } from '../mock/mock-api';

describe('useControlPlaneSnapshot', () => {
  it('loads the full v1 control-plane inventory through TanStack Query', async () => {
    const api = createMockApi();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false
        }
      }
    });

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          <ApiProvider api={api}>{children}</ApiProvider>
        </QueryClientProvider>
      );
    }

    const { result } = renderHook(() => useControlPlaneSnapshot(true), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(controlPlaneSnapshotQueryKey).toEqual(['control-plane', 'snapshot', 'v1']);
    expect(result.current.data).toMatchObject({
      agents: [{ id: 'agent-hkg-01' }],
      nodes: [{ id: 'node-hkg-edge-01' }],
      subscriptionBundles: [{ id: 'sub-global-premium' }],
      permissionGrants: [{ id: 'grant-admin-tunnel' }],
      configRevisions: [],
      preflightPlans: [],
      runtimeSnapshots: []
    });
  });
});
