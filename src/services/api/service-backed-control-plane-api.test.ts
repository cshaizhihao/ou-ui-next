import { createControlPlaneService } from '../../server/control-plane/control-plane-service';
import { createInMemoryControlPlaneRepository } from '../../server/control-plane/in-memory-control-plane-repository';
import { seedForwardRules, seedPermissionGrants } from '../mock/mock-data';
import { createServiceBackedControlPlaneApi } from './service-backed-control-plane-api';

function mutationContext(id: string) {
  return {
    actor: 'admin',
    operatorGroupId: 'owner',
    resourceGroupId: 'group-premium',
    sourceIp: '127.0.0.1',
    requestId: `req-${id}`,
    idempotencyKey: `idem-${id}`
  };
}

describe('service-backed control plane read model hydration', () => {
  it('keeps new forwarding rules deploying until the Agent result succeeds', async () => {
    const repository = createInMemoryControlPlaneRepository({
      permissionGrants: seedPermissionGrants
    });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository }),
      readModelNow: () => '2026-06-04T04:01:00.000Z',
      inventory: {
        agents: []
      }
    });

    const task = await api.createTask(
      {
        operation: 'forward.create',
        resourceType: 'forward',
        targetId: 'forward-runtime-gated-2443',
        targetLabel: 'Runtime gated HTTPS forwarding',
        summary: 'Create runtime gated forwarding',
        metadata: {
          agentIds: ['agent-hkg-01'],
          listenAddress: '0.0.0.0',
          listenPort: 2443,
          targetAddress: '10.10.0.8',
          targetPort: 9443,
          protocol: 'tcp+udp',
          name: 'Runtime gated HTTPS forwarding',
          ownerName: 'Acme Team',
          billingDirection: 'both'
        }
      },
      mutationContext('forward-runtime-gated')
    );

    expect(await api.listForwardRules()).toEqual([
      expect.objectContaining({
        id: 'forward-runtime-gated-2443',
        portStatus: 'deploying',
        ports: [expect.objectContaining({ status: 'deploying' })]
      })
    ]);

    const [outboxItem] = await api.listCommandOutbox();
    const ackObservedAt = new Date(Date.parse(outboxItem.deadlineAt) - 30_000).toISOString();
    const resultObservedAt = new Date(Date.parse(outboxItem.deadlineAt) - 15_000).toISOString();

    await api.receiveAgentEvent({
      type: 'ack',
      eventId: 'evt-forward-runtime-gated-ack',
      commandId: outboxItem.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: outboxItem.seq + 1,
      sessionId: 'sess-agent-hkg-01',
      observedAt: ackObservedAt,
      payload: {
        duplicate: false
      }
    });
    await api.receiveAgentEvent({
      type: 'result',
      eventId: 'evt-forward-runtime-gated-result',
      commandId: outboxItem.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: outboxItem.seq + 2,
      sessionId: 'sess-agent-hkg-01',
      observedAt: resultObservedAt,
      payload: {
        status: 'succeeded',
        appliedConfigRevision: outboxItem.command.type === 'apply' ? outboxItem.command.payload.configRevision : undefined
      }
    });

    expect(await api.listForwardRules()).toEqual([
      expect.objectContaining({
        id: 'forward-runtime-gated-2443',
        portStatus: 'allocated',
        ports: [expect.objectContaining({ status: 'allocated' })]
      })
    ]);
  });

  it('replays persisted Agent telemetry into host and forwarding read models after restart', async () => {
    const repository = createInMemoryControlPlaneRepository({
      forwardRules: seedForwardRules,
      agentEvents: [
        {
          type: 'telemetry_sample',
          eventId: 'evt-restart-telemetry-agent-hkg-01',
          agentId: 'agent-hkg-01',
          seq: 12,
          sessionId: 'sess-agent-hkg-01',
          observedAt: '2026-06-04T04:00:30.000Z',
          payload: {
            cpuPercent: 37,
            cpuCores: 4,
            memoryPercent: 58,
            memoryUsedBytes: 3_200_000_000,
            memoryTotalBytes: 8_000_000_000,
            diskPercent: 41,
            diskUsedBytes: 24_000_000_000,
            diskTotalBytes: 64_000_000_000,
            latencyMs: 86,
            latencySamplesMs: [72, 86],
            packetLossPercent: 0,
            monthlyIngressBytes: 1_500,
            monthlyEgressBytes: 500,
            trafficAccountingMode: 'both',
            monthlyResetDay: 7,
            manualUsedTrafficBytes: 200,
            trafficTelemetrySource: 'agent',
            cpuModel: 'AMD EPYC 7B13',
            kernelVersion: '6.8.0-ou',
            virtualization: 'kvm',
            primaryNetworkInterface: 'eth0',
            hardwareDetectedAt: '2026-06-04T04:00:25.000Z',
            hardwareTelemetrySource: 'agent',
            forwardingCounters: [
              {
                ruleId: 'forward-hkg-443',
                agentId: 'agent-hkg-01',
                serviceName: 'ou-forward-forward-hkg-443-agent-hkg-01',
                listenPort: 443,
                targetAddress: '10.12.0.8',
                targetPort: 8443,
                protocol: 'tcp+udp',
                inboundBytes: 900,
                outboundBytes: 1_100,
                sampledAt: '2026-06-04T04:00:30.000Z',
                source: 'nftables'
              }
            ]
          }
        }
      ]
    });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository }),
      readModelNow: () => '2026-06-04T04:01:00.000Z',
      inventory: {
        agents: []
      }
    });

    const agents = await api.listAgents();
    const rules = await api.listForwardRules();

    expect(agents).toEqual([
      expect.objectContaining({
        id: 'agent-hkg-01',
        status: 'online',
        trafficPolicy: expect.objectContaining({
          accountingMode: 'both',
          monthlyResetDay: 7,
          manualUsedTrafficBytes: 200
        }),
        hardware: expect.objectContaining({
          cpuModel: 'AMD EPYC 7B13',
          kernelVersion: '6.8.0-ou',
          virtualization: 'kvm',
          primaryNetworkInterface: 'eth0'
        }),
        telemetry: expect.objectContaining({
          cpuPercent: 37,
          cpuCores: 4,
          memoryPercent: 58,
          diskPercent: 41,
          latencyMs: 86,
          monthlyIngressBytes: 1_500,
          monthlyEgressBytes: 500,
          monthlyTrafficUsedBytes: 2_000
        })
      })
    ]);
    expect(rules.find((rule) => rule.id === 'forward-hkg-443')).toMatchObject({
      inboundBytes: 900,
      outboundBytes: 1_100,
      ports: [
        expect.objectContaining({
          agentId: 'agent-hkg-01',
          inboundBytes: 900,
          outboundBytes: 1_100,
          counterSource: 'nftables',
          lastCounterSampleAt: '2026-06-04T04:00:30.000Z'
        })
      ]
    });
  });

  it('derives degraded and offline managed-host status from stale Agent runtime signals', async () => {
    const repository = createInMemoryControlPlaneRepository({
      agentEvents: [
        {
          type: 'heartbeat',
          eventId: 'evt-stale-heartbeat-agent-edge-01',
          agentId: 'agent-edge-01',
          seq: 1,
          sessionId: 'sess-agent-edge-01',
          observedAt: '2026-06-04T04:00:00.000Z',
          payload: {
            version: '1.0.0-runtime',
            uptimeSeconds: 3600,
            capabilities: ['host-agent', 'xray', 'port-forwarding'],
            lastSeenCommandSeq: 0
          }
        }
      ]
    });

    const degradedApi = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository }),
      readModelNow: () => '2026-06-04T04:01:30.000Z',
      inventory: {
        agents: []
      }
    });
    await expect(degradedApi.listAgents()).resolves.toEqual([
      expect.objectContaining({
        id: 'agent-edge-01',
        status: 'degraded'
      })
    ]);

    const offlineApi = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository }),
      readModelNow: () => '2026-06-04T04:05:00.000Z',
      inventory: {
        agents: []
      }
    });
    await expect(offlineApi.listAgents()).resolves.toEqual([
      expect.objectContaining({
        id: 'agent-edge-01',
        status: 'offline'
      })
    ]);
  });

  it('does not resurrect a removed managed host when stale Agent telemetry keeps arriving', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository }),
      inventory: {
        agents: [
          {
            id: 'agent-removed-01',
            name: 'Removed Host',
            status: 'online',
            region: 'custom',
            publicAddress: '198.51.100.20',
            connectionMode: 'pull',
            version: '1.0.0-runtime',
            platform: 'linux/amd64',
            capabilities: ['host-agent', 'xray', 'port-forwarding'],
            maxTrafficBytes: 0,
            monthlyTrafficLimitBytes: 0,
            expiresAt: '',
            probeConfig: {
              pingTarget: '1.1.1.1',
              pingIntervalSeconds: 30,
              latencyGreenMaxMs: 100,
              latencyYellowMaxMs: 200
            },
            trafficPolicy: {
              accountingMode: 'both',
              monthlyResetDay: 1,
              manualUsedTrafficBytes: 0,
              telemetrySource: 'agent'
            },
            hardware: {},
            lastHeartbeatAt: '2026-06-04T04:00:00.000Z',
            telemetry: {
              cpuPercent: 0,
              memoryPercent: 0,
              memoryUsedBytes: 0,
              memoryTotalBytes: 0,
              diskUsedBytes: 0,
              diskTotalBytes: 0,
              txBytes: 0,
              rxBytes: 0,
              uploadSpeedBps: 0,
              downloadSpeedBps: 0,
              uploadTotalBytes: 0,
              downloadTotalBytes: 0,
              monthlyTrafficUsedBytes: 0,
              latencyMs: 0,
              latencySamplesMs: [],
              packetLossPercent: 0,
              packetLossSamplesPercent: [],
              onlineDays: 0
            }
          }
        ]
      }
    });

    await api.createTask({
      operation: 'agent.delete',
      resourceType: 'agent',
      targetId: 'agent-removed-01',
      targetLabel: 'Removed Host',
      summary: 'Remove stale managed host',
      metadata: {
        agentId: 'agent-removed-01',
        displayName: 'Removed Host'
      }
    });
    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-stale-telemetry-agent-removed-01',
      agentId: 'agent-removed-01',
      seq: 2,
      sessionId: 'sess-agent-removed-01',
      observedAt: '2026-06-04T04:01:00.000Z',
      payload: {
        latencyMs: 42,
        cpuPercent: 20
      }
    });

    await expect(api.listAgents()).resolves.toEqual([]);
  });

  it('replays subscription source deletion across restarts and filters stale inventory nodes', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository }),
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await api.createTask(
      {
        operation: 'subscription.import',
        resourceType: 'subscription',
        targetId: 'source-restart-delete',
        targetLabel: 'Restart Delete Source',
        summary: 'Import restart delete source',
        metadata: {
          sourceId: 'source-restart-delete',
          kind: 'clash',
          name: 'Restart Delete Source',
          url: 'https://provider.example.com/restart.yaml',
          refreshIntervalMinutes: 30,
          dedupeKey: 'server-port'
        }
      },
      mutationContext('subscription-import-restart-delete')
    );
    await api.createTask(
      {
        operation: 'subscription.delete',
        resourceType: 'subscription',
        targetId: 'source-restart-delete',
        targetLabel: 'Restart Delete Source',
        summary: 'Delete restart source',
        metadata: {
          sourceId: 'source-restart-delete'
        }
      },
      mutationContext('subscription-delete-restart-delete')
    );
    await repository.transaction((transaction) =>
      transaction.replaceSubscriptionInventoryNodesForSource('source-restart-delete', [
        {
          id: 'inventory-source-restart-delete-vless-01',
          sourceId: 'source-restart-delete',
          name: 'Restart Deleted Node',
          protocol: 'vless',
          server: '198.51.100.22',
          port: 443,
          latencyMs: 82,
          tags: ['region:hk'],
          rawUrl: 'vless://11111111-1111-4111-8111-111111111111@198.51.100.22:443#Restart',
          inboundTag: 'source-restart-delete-vless-01'
        }
      ])
    );

    const restartedApi = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository }),
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await expect(restartedApi.listSubscriptionSources()).resolves.toEqual([]);
    await expect(restartedApi.listSubscriptionInventoryNodes()).resolves.toEqual([]);
  });

  it('persists subscription source sync state across service-backed API restarts', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const fetcher: typeof fetch = async () =>
      new Response(
        [
          'proxies:',
          '  - name: "HK Persisted Sync 01"',
          '    type: vless',
          '    server: persisted-hk.example.com',
          '    port: 443',
          '    uuid: 11111111-1111-4111-8111-111111111111'
        ].join('\n'),
        {
          status: 200,
          headers: {
            'Content-Type': 'text/yaml'
          }
        }
      );
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository }),
      fetcher,
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await api.createTask(
      {
        operation: 'subscription.import',
        resourceType: 'subscription',
        targetId: 'source-persisted-sync',
        targetLabel: 'Persisted Sync Source',
        summary: 'Import persisted sync source',
        metadata: {
          sourceId: 'source-persisted-sync',
          kind: 'clash',
          name: 'Persisted Sync Source',
          url: 'https://provider.example.com/persisted.yaml',
          refreshIntervalMinutes: 30,
          dedupeKey: 'server-port'
        }
      },
      mutationContext('subscription-import-persisted-sync')
    );
    await expect(api.syncSubscriptionSource('source-persisted-sync')).resolves.toMatchObject({
      status: 'synced',
      nodeCount: 1
    });
    await expect(repository.listSubscriptionSources()).resolves.toEqual([
      expect.objectContaining({
        id: 'source-persisted-sync',
        status: 'synced',
        nodeCount: 1
      })
    ]);
    await api.createTask(
      {
        operation: 'subscription.generate',
        resourceType: 'subscription',
        targetId: 'sub-client-persisted-count',
        targetLabel: 'Persisted Count Client',
        summary: 'Create persisted count client',
        metadata: {
          subscriptionClientId: 'sub-client-persisted-count',
          displayName: 'Persisted Count Client',
          subId: 'persisted_count',
          email: 'count@example.com',
          protocol: 'vless',
          sourceIds: ['source-persisted-sync'],
          formats: ['plain', 'clash'],
          outputFormats: ['uri', 'clash'],
          generatedNodeCount: 999,
          remainingDays: 30
        }
      },
      mutationContext('subscription-client-persisted-count')
    );
    await expect(repository.listSubscriptionClients()).resolves.toEqual([
      expect.objectContaining({
        id: 'sub-client-persisted-count',
        generatedNodeCount: 1
      })
    ]);

    const restartedApi = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository }),
      fetcher,
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await expect(restartedApi.listSubscriptionSources()).resolves.toEqual([
      expect.objectContaining({
        id: 'source-persisted-sync',
        status: 'synced',
        nodeCount: 1
      })
    ]);
    await expect(restartedApi.listSubscriptionInventoryNodes()).resolves.toEqual([
      expect.objectContaining({
        sourceId: 'source-persisted-sync',
        name: 'HK Persisted Sync 01',
        server: 'persisted-hk.example.com'
      })
    ]);
    await expect(restartedApi.listSubscriptionClients()).resolves.toEqual([
      expect.objectContaining({
        id: 'sub-client-persisted-count',
        generatedNodeCount: 1
      })
    ]);
  });

  it('persists subscription export profiles across service-backed API restarts', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository }),
      inventory: {
        subscriptionExportProfiles: []
      }
    });

    await api.createTask(
      {
        operation: 'subscription.profile.upsert',
        resourceType: 'subscription',
        targetId: 'profile-mihomo-premium',
        targetLabel: 'Mihomo Premium',
        summary: 'Save subscription export profile',
        metadata: {
          profileId: 'profile-mihomo-premium',
          name: 'Mihomo Premium',
          client: 'mihomo',
          sourceIds: ['source-premium'],
          includeFilter: 'premium|streaming',
          excludeFilter: 'expired|test',
          regionFilter: ['hk', 'sg'],
          outputFormats: ['mihomo', 'clash', 'uri'],
          templateName: 'mihomo-compatible.yaml',
          includeTrafficHeaders: true,
          proxyGroups: [
            {
              id: 'proxy-group-premium-auto',
              name: 'Premium Auto',
              strategy: 'url-test',
              filterTags: ['premium', 'streaming']
            }
          ]
        }
      },
      mutationContext('subscription-profile-upsert')
    );

    await expect(repository.listSubscriptionExportProfiles()).resolves.toEqual([
      expect.objectContaining({
        id: 'profile-mihomo-premium',
        client: 'mihomo',
        outputFormats: ['mihomo', 'clash', 'uri']
      })
    ]);

    const restartedApi = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository }),
      inventory: {
        subscriptionExportProfiles: []
      }
    });

    await expect(restartedApi.listSubscriptionExportProfiles()).resolves.toEqual([
      expect.objectContaining({
        id: 'profile-mihomo-premium',
        proxyGroups: [
          expect.objectContaining({
            name: 'Premium Auto',
            strategy: 'url-test'
          })
        ]
      })
    ]);

    await restartedApi.createTask(
      {
        operation: 'subscription.profile.delete',
        resourceType: 'subscription',
        targetId: 'profile-mihomo-premium',
        targetLabel: 'Mihomo Premium',
        summary: 'Delete subscription export profile',
        metadata: {
          profileId: 'profile-mihomo-premium'
        }
      },
      mutationContext('subscription-profile-delete')
    );

    await expect(repository.listSubscriptionExportProfiles()).resolves.toEqual([]);
  });
});
