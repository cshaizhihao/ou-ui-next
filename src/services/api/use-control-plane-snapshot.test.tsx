import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ApiProvider } from './api-provider';
import { controlPlaneSnapshotQueryKey, useControlPlaneSnapshot } from './use-control-plane-snapshot';
import { createMockApi } from '../mock/mock-api';

describe('useControlPlaneSnapshot', () => {
  it('loads the full v1 control-plane inventory through TanStack Query', async () => {
    const api = createMockApi({ seedInventory: true });
    const listAgentCredentials = vi.spyOn(api, 'listAgentCredentials');
    const listAgentLogChunks = vi.spyOn(api, 'listAgentLogChunks');
    const getAgentLogRetentionPolicy = vi.spyOn(api, 'getAgentLogRetentionPolicy');
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
      configRevisions: [],
      preflightPlans: [],
      runtimeSnapshots: [],
      trafficRollups: [],
      agentCredentials: [],
      agentLogChunks: [],
      agentLogRetentionPolicy: {
        maxAgeDays: 7,
        maxEventsPerAgent: 5000,
        source: 'runtime-config'
      },
      systemAlerts: expect.any(Array)
    });
    expect(listAgentCredentials).toHaveBeenCalled();
    expect(listAgentLogChunks).toHaveBeenCalledWith({ limit: 200 });
    expect(getAgentLogRetentionPolicy).toHaveBeenCalled();
    expect(result.current.data?.agents).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'agent-hkg-01' })])
    );
    expect(result.current.data?.customers).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Acme Team' })])
    );
    expect(result.current.data?.nodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'node-hkg-edge-01' })])
    );
    expect(result.current.data?.subscriptionBundles).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'sub-global-premium' })])
    );
    expect(result.current.data?.subscriptionClients).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'sub-client-acme-hkg' })])
    );
    expect(result.current.data?.permissionGrants).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'grant-admin-tunnel' })])
    );
  });
});
