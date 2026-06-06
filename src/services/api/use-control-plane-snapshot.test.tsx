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
    const listAgentSessions = vi.spyOn(api, 'listAgentSessions');
    const listAgentLogChunks = vi.spyOn(api, 'listAgentLogChunks');
    const listAgentLogArchives = vi.spyOn(api, 'listAgentLogArchives');
    const getAgentLogRetentionPolicy = vi.spyOn(api, 'getAgentLogRetentionPolicy');
    const getTrafficRollupRetentionPolicy = vi.spyOn(api, 'getTrafficRollupRetentionPolicy');
    const getTelegramBotSettings = vi.spyOn(api, 'getTelegramBotSettings');
    const listTelegramBindings = vi.spyOn(api, 'listTelegramBindings');
    const listTelegramNotificationPolicies = vi.spyOn(api, 'listTelegramNotificationPolicies');
    const listTelegramNotificationDeliveries = vi.spyOn(api, 'listTelegramNotificationDeliveries');
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
      trafficRollupCompactions: [],
      agentCredentials: [],
      agentSessions: [],
      agentLogChunks: [],
      agentLogArchives: [],
      telegramBindings: [],
      telegramNotificationDeliveries: [],
      telegramBotSettings: expect.objectContaining({
        id: 'telegram-bot'
      }),
      telegramNotificationPolicies: [
        expect.objectContaining({
          id: 'telegram-policy-default'
        })
      ],
      agentLogRetentionPolicy: {
        maxAgeDays: 7,
        maxEventsPerAgent: 5000,
        source: 'runtime-config'
      },
      trafficRollupRetentionPolicy: {
        maxAgeDays: 62,
        maxRecordsPerScope: 200_000,
        source: 'runtime-config',
        runtimeDefault: {
          maxAgeDays: 62,
          maxRecordsPerScope: 200_000
        }
      },
      systemAlerts: expect.any(Array)
    });
    expect(listAgentCredentials).toHaveBeenCalled();
    expect(listAgentSessions).toHaveBeenCalled();
    expect(listAgentLogChunks).toHaveBeenCalledWith({ limit: 200 });
    expect(listAgentLogArchives).toHaveBeenCalledWith({ limit: 200 });
    expect(getAgentLogRetentionPolicy).toHaveBeenCalled();
    expect(getTrafficRollupRetentionPolicy).toHaveBeenCalled();
    expect(getTelegramBotSettings).toHaveBeenCalled();
    expect(listTelegramBindings).toHaveBeenCalled();
    expect(listTelegramNotificationPolicies).toHaveBeenCalled();
    expect(listTelegramNotificationDeliveries).toHaveBeenCalled();
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
      expect.arrayContaining([expect.objectContaining({ id: 'grant-bootstrap-owner-tunnel' })])
    );
  });
});
