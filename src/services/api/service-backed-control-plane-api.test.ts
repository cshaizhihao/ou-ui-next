import { createControlPlaneService } from '../../server/control-plane/control-plane-service';
import { createInMemoryControlPlaneRepository } from '../../server/control-plane/in-memory-control-plane-repository';
import { createControlPlaneTestClock } from '../../test/control-plane-clock';
import type { SubscriptionClientIdentity, XrayInbound } from '../../domain';
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

async function importSubscriptionSource(
  api: ReturnType<typeof createServiceBackedControlPlaneApi>,
  input: { sourceId: string; name: string; url: string; fetchTimeoutSeconds?: number; maxBodyBytes?: number }
) {
  await api.createTask(
    {
      operation: 'subscription.import',
      resourceType: 'subscription',
      targetId: input.sourceId,
      targetLabel: input.name,
      summary: `Import ${input.name}`,
      metadata: {
        sourceId: input.sourceId,
        kind: 'clash',
        name: input.name,
        url: input.url,
        refreshIntervalMinutes: 30,
        ...(input.fetchTimeoutSeconds ? { fetchTimeoutSeconds: input.fetchTimeoutSeconds } : {}),
        ...(input.maxBodyBytes ? { maxBodyBytes: input.maxBodyBytes } : {}),
        dedupeKey: 'server-port'
      }
    },
    mutationContext(`subscription-import-${input.sourceId}`)
  );
}

async function allowPublicSubscriptionHostResolver() {
  return [{ address: '93.184.216.34', family: 4 as const }];
}

describe('service-backed control plane read model hydration', () => {
  it('projects observability metrics from tasks, command outbox, Agents, alerts, and audit state', async () => {
    const repository = createInMemoryControlPlaneRepository({
      permissionGrants: seedPermissionGrants
    });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => '2026-06-02T00:00:00.000Z',
      inventory: {
        agents: []
      }
    });

    const task = await api.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent HKG 01',
        summary: 'Deploy Agent config for observability metrics'
      },
      mutationContext('observability-metrics-task')
    );

    await expect(
      api.createTask(
        {
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-hkg-denied',
          targetLabel: 'Agent HKG denied',
          summary: 'Denied Agent config for observability metrics'
        },
        {
          ...mutationContext('observability-metrics-denied'),
          actor: 'operator:bob',
          operatorGroupId: 'ops-viewer'
        }
      )
    ).rejects.toMatchObject({ code: 'permission.denied' });

    await expect(api.getObservabilityMetrics()).resolves.toMatchObject({
      generatedAt: '2026-06-02T00:00:00.000Z',
      tasks: {
        total: 1,
        active: 1,
        failed: 0,
        byStatus: expect.objectContaining({
          queued: 1,
          failed: 0
        })
      },
      commandOutbox: {
        total: 1,
        backlog: 1,
        byStatus: expect.objectContaining({
          pending: 1,
          completed: 0
        })
      },
      audit: expect.objectContaining({
        valid: true,
        denied: 1,
        quotaExceeded: 0
      })
    });
    await expect(repository.listCommandOutbox()).resolves.toEqual([
      expect.objectContaining({
        taskId: task.id,
        status: 'pending'
      })
    ]);
  });

  it('retrieves retained Agent log chunks from persisted Agent events', async () => {
    const repository = createInMemoryControlPlaneRepository({
      permissionGrants: seedPermissionGrants
    });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      inventory: {
        agents: []
      }
    });

    const task = await api.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent HKG 01',
        summary: 'Deploy Agent config with log streaming'
      },
      mutationContext('agent-log-chunk-task')
    );
    const [outboxItem] = await api.listCommandOutbox();
    const observedAt = new Date(Date.parse(outboxItem.deadlineAt) - 30_000).toISOString();

    await api.receiveAgentEvent({
      type: 'log_chunk',
      eventId: 'evt-agent-hkg-log-chunk-001',
      commandId: outboxItem.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: outboxItem.seq + 1,
      sessionId: 'sess-agent-hkg-log-01',
      observedAt,
      payload: {
        chunkSeq: 1,
        stream: 'stderr',
        content: 'xray reload warning: certificate chain checked'
      }
    });

    await expect(api.listAgentLogChunks({ agentId: 'agent-hkg-01', limit: 10 })).resolves.toEqual([
      {
        eventId: 'evt-agent-hkg-log-chunk-001',
        agentId: 'agent-hkg-01',
        sessionId: 'sess-agent-hkg-log-01',
        seq: outboxItem.seq + 1,
        observedAt,
        commandId: outboxItem.commandId,
        taskId: task.id,
        chunkSeq: 1,
        stream: 'stderr',
        content: 'xray reload warning: certificate chain checked'
      }
    ]);
  });

  it('prunes Agent log chunks by retention window and per-Agent cap when events are received', async () => {
    const repository = createInMemoryControlPlaneRepository({
      permissionGrants: seedPermissionGrants
    });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({
        repository,
        now: createControlPlaneTestClock(),
        agentLogRetention: {
          maxAgeMs: 60_000,
          maxEventsPerAgent: 2
        }
      }),
      inventory: {
        agents: []
      }
    });

    const task = await api.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent HKG 01',
        summary: 'Deploy Agent config with retained log cleanup'
      },
      mutationContext('agent-log-retention-task')
    );
    const [outboxItem] = await api.listCommandOutbox();
    const baseObservedMs = Date.parse(outboxItem.deadlineAt) - 180_000;
    const sessionId = 'sess-agent-hkg-log-retention';

    for (const [index, offsetMs] of [0, 80_000, 100_000, 110_000].entries()) {
      await api.receiveAgentEvent({
        type: 'log_chunk',
        eventId: `evt-agent-hkg-retained-log-${index + 1}`,
        commandId: outboxItem.commandId,
        taskId: task.id,
        agentId: 'agent-hkg-01',
        seq: outboxItem.seq + index + 1,
        sessionId,
        observedAt: new Date(baseObservedMs + offsetMs).toISOString(),
        payload: {
          chunkSeq: index + 1,
          stream: 'stderr',
          content: `retention chunk ${index + 1}`
        }
      });
    }

    await expect(api.listAgentLogChunks({ agentId: 'agent-hkg-01', limit: 10 })).resolves.toEqual([
      expect.objectContaining({
        eventId: 'evt-agent-hkg-retained-log-4',
        content: 'retention chunk 4'
      }),
      expect.objectContaining({
        eventId: 'evt-agent-hkg-retained-log-3',
        content: 'retention chunk 3'
      })
    ]);
    await expect(repository.listAgentEvents()).resolves.toEqual([
      expect.objectContaining({ eventId: 'evt-agent-hkg-retained-log-4' }),
      expect.objectContaining({ eventId: 'evt-agent-hkg-retained-log-3' })
    ]);
  });

  it('keeps new forwarding rules deploying until the Agent result succeeds', async () => {
    const repository = createInMemoryControlPlaneRepository({
      permissionGrants: seedPermissionGrants
    });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
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

    await expect(
      api.transitionTask(task.id, 'running', mutationContext('forward-runtime-gated-manual-running'))
    ).resolves.toMatchObject({
      id: task.id,
      status: 'running'
    });
    await expect(
      api.transitionTask(task.id, 'succeeded', mutationContext('forward-runtime-gated-manual-succeeded'))
    ).rejects.toMatchObject({
      code: 'agent_result.required'
    });
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
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
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
          monthlyTrafficUsedBytes: 2_000,
          sampleGapDetected: false,
          expectedSamplingIntervalSeconds: 30
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
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => '2026-06-04T04:01:30.000Z',
      inventory: {
        agents: []
      }
    });
    await expect(degradedApi.listAgents()).resolves.toEqual([
      expect.objectContaining({
        id: 'agent-edge-01',
        status: 'degraded',
        telemetry: expect.objectContaining({
          sampleGapDetected: true,
          sampleGapSeconds: 90,
          sampleGapReason: 'no_telemetry_sample'
        })
      })
    ]);
    await expect(degradedApi.listSystemAlerts()).resolves.toEqual([
      expect.objectContaining({
        kind: 'agent.telemetry_sampling_gap',
        severity: 'warning',
        status: 'active',
        resourceId: 'agent-edge-01'
      })
    ]);

    const offlineApi = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
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
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
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
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
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
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
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
            'Content-Type': 'text/yaml',
            'subscription-userinfo': `upload=${2 * 1024 * 1024}; download=${4 * 1024 * 1024}; total=${500 * 1024 * 1024}; expire=1798761600`
          }
        }
      );
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      fetcher,
      subscriptionSourceHostResolver: allowPublicSubscriptionHostResolver,
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
      nodeCount: 1,
      traffic: {
        sourceId: 'source-persisted-sync',
        uploadBytes: 2 * 1024 * 1024,
        downloadBytes: 4 * 1024 * 1024,
        totalBytes: 500 * 1024 * 1024,
        expiresAt: '2027-01-01T00:00:00.000Z'
      }
    });
    await expect(repository.listSubscriptionSources()).resolves.toEqual([
      expect.objectContaining({
        id: 'source-persisted-sync',
        status: 'synced',
        nodeCount: 1,
        traffic: {
          sourceId: 'source-persisted-sync',
          uploadBytes: 2 * 1024 * 1024,
          downloadBytes: 4 * 1024 * 1024,
          totalBytes: 500 * 1024 * 1024,
          expiresAt: '2027-01-01T00:00:00.000Z'
        }
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
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
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
        nodeCount: 1,
        traffic: expect.objectContaining({
          downloadBytes: 4 * 1024 * 1024,
          totalBytes: 500 * 1024 * 1024
        })
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
    await expect(restartedApi.listSubscriptionBundles()).resolves.toEqual([
      expect.objectContaining({
        id: 'sub-global-premium',
        sources: [expect.objectContaining({ id: 'source-persisted-sync', nodeCount: 1, status: 'ok' })],
        generatedNodeCount: 1,
        healthScore: 100
      })
    ]);
  });

  it('marks external subscription source syncs warning when imported nodes duplicate another source', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      const name = url.includes('backup') ? 'HK Backup Duplicate' : 'HK Primary Node';

      return new Response(
        [
          'proxies:',
          `  - name: "${name}"`,
          '    type: vless',
          '    server: duplicate-hk.example.com',
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
    };
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      fetcher,
      subscriptionSourceHostResolver: allowPublicSubscriptionHostResolver,
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    for (const sourceId of ['source-primary-sync', 'source-backup-sync']) {
      await api.createTask(
        {
          operation: 'subscription.import',
          resourceType: 'subscription',
          targetId: sourceId,
          targetLabel: sourceId,
          summary: `Import ${sourceId}`,
          metadata: {
            sourceId,
            kind: 'clash',
            name: sourceId,
            url: `https://provider.example.com/${sourceId.includes('backup') ? 'backup' : 'primary'}.yaml`,
            refreshIntervalMinutes: 30,
            dedupeKey: 'server-port'
          }
        },
        mutationContext(`subscription-import-${sourceId}`)
      );
    }

    await expect(api.syncSubscriptionSource('source-primary-sync')).resolves.toMatchObject({
      status: 'synced',
      warnings: []
    });
    await expect(api.syncSubscriptionSource('source-backup-sync')).resolves.toMatchObject({
      status: 'warning',
      nodeCount: 1,
      warnings: ['subscription_source.cross_source_duplicates:1']
    });
    await expect(repository.listSubscriptionSources()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'source-primary-sync', status: 'synced', nodeCount: 1, syncWarnings: [] }),
      expect.objectContaining({
        id: 'source-backup-sync',
        status: 'warning',
        nodeCount: 1,
        syncWarnings: ['subscription_source.cross_source_duplicates:1']
      })
    ]));
    await expect(repository.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'subscription.source.synced',
          operation: 'subscription.sync',
          targetId: 'source-primary-sync',
          result: 'succeeded',
          severity: 'info'
        }),
        expect.objectContaining({
          action: 'subscription.source.synced',
          operation: 'subscription.sync',
          targetId: 'source-backup-sync',
          result: 'succeeded',
          severity: 'warning',
          after: expect.objectContaining({
            warnings: ['subscription_source.cross_source_duplicates:1']
          })
        })
      ])
    );
    await expect(api.verifyAuditLogChain()).resolves.toMatchObject({ valid: true });
  });

  it('audits failed service-backed external subscription source syncs', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const fetcher: typeof fetch = async () =>
      new Response('upstream unavailable', {
        status: 503,
        statusText: 'Service Unavailable'
      });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      fetcher,
      subscriptionSourceHostResolver: allowPublicSubscriptionHostResolver,
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await api.createTask(
      {
        operation: 'subscription.import',
        resourceType: 'subscription',
        targetId: 'source-failed-sync',
        targetLabel: 'Failed Sync Source',
        summary: 'Import failed sync source',
        metadata: {
          sourceId: 'source-failed-sync',
          kind: 'clash',
          name: 'Failed Sync Source',
          url: 'https://provider.example.com/failed.yaml',
          refreshIntervalMinutes: 30,
          dedupeKey: 'server-port'
        }
      },
      mutationContext('subscription-import-failed-sync')
    );

    await expect(api.syncSubscriptionSource('source-failed-sync')).resolves.toMatchObject({
      status: 'failed',
      nodeCount: 0,
      warnings: ['subscription_source.sync_failed:remote responded 503 Service Unavailable']
    });
    await expect(repository.listSubscriptionSources()).resolves.toEqual([
      expect.objectContaining({
        id: 'source-failed-sync',
        status: 'failed',
        nodeCount: 0,
        syncWarnings: ['subscription_source.sync_failed:remote responded 503 Service Unavailable']
      })
    ]);
    await expect(repository.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'subscription.source.sync_failed',
          operation: 'subscription.sync',
          targetId: 'source-failed-sync',
          result: 'failed',
          severity: 'warning',
          after: expect.objectContaining({
            warnings: ['subscription_source.sync_failed:remote responded 503 Service Unavailable']
          })
        })
      ])
    );
    await expect(api.verifyAuditLogChain()).resolves.toMatchObject({ valid: true });
  });

  it('rejects unsupported external subscription source URL protocols without remote fetch', async () => {
    const repository = createInMemoryControlPlaneRepository();
    let fetchCalled = false;
    const fetcher: typeof fetch = async () => {
      fetchCalled = true;
      return new Response('');
    };
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      fetcher,
      subscriptionSourceHostResolver: allowPublicSubscriptionHostResolver,
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await importSubscriptionSource(api, {
      sourceId: 'source-unsupported-url-sync',
      name: 'Unsupported URL Sync Source',
      url: 'file:///etc/passwd'
    });

    await expect(api.syncSubscriptionSource('source-unsupported-url-sync')).resolves.toMatchObject({
      status: 'failed',
      nodeCount: 0,
      warnings: ['subscription_source.sync_failed:subscription source url protocol must be http or https']
    });
    expect(fetchCalled).toBe(false);
    await expect(repository.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'subscription.source.sync_failed',
          targetId: 'source-unsupported-url-sync',
          after: expect.objectContaining({
            warnings: ['subscription_source.sync_failed:subscription source url protocol must be http or https']
          })
        })
      ])
    );
    await expect(api.verifyAuditLogChain()).resolves.toMatchObject({ valid: true });
  });

  it('rejects local and private external subscription source hosts without remote fetch', async () => {
    const repository = createInMemoryControlPlaneRepository();
    let fetchCalled = false;
    const resolvedHostnames: string[] = [];
    const fetcher: typeof fetch = async () => {
      fetchCalled = true;
      return new Response('');
    };
    const hostResolver = async (hostname: string) => {
      resolvedHostnames.push(hostname);
      return allowPublicSubscriptionHostResolver();
    };
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      fetcher,
      subscriptionSourceHostResolver: hostResolver,
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });
    const blockedSources = [
      ['source-localhost-sync', 'https://localhost/sub.yaml'],
      ['source-private-ip-sync', 'http://192.168.1.10/sub.yaml'],
      ['source-short-loopback-ip-sync', 'http://127.1/sub.yaml'],
      ['source-cgnat-ip-sync', 'http://100.64.1.10/sub.yaml'],
      ['source-ipv6-loopback-sync', 'http://[::1]/sub.yaml'],
      ['source-ipv6-ula-sync', 'http://[fd00::1]/sub.yaml'],
      ['source-ipv6-link-local-sync', 'http://[fe80::1]/sub.yaml'],
      ['source-ipv6-multicast-sync', 'http://[ff02::1]/sub.yaml'],
      ['source-ipv6-mapped-private-sync', 'http://[::ffff:192.168.1.10]/sub.yaml']
    ] as const;

    for (const [sourceId, url] of blockedSources) {
      await importSubscriptionSource(api, {
        sourceId,
        name: sourceId,
        url
      });

      await expect(api.syncSubscriptionSource(sourceId)).resolves.toMatchObject({
        status: 'failed',
        nodeCount: 0,
        warnings: ['subscription_source.sync_failed:subscription source host is not allowed for remote fetch']
      });
    }

    expect(fetchCalled).toBe(false);
    expect(resolvedHostnames).toEqual([]);
    await expect(repository.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining(
        blockedSources.map(([sourceId]) =>
          expect.objectContaining({
            action: 'subscription.source.sync_failed',
            targetId: sourceId,
            after: expect.objectContaining({
              warnings: ['subscription_source.sync_failed:subscription source host is not allowed for remote fetch']
            })
          })
        )
      )
    );
    await expect(api.verifyAuditLogChain()).resolves.toMatchObject({ valid: true });
  });

  it('rejects external subscription source hosts that resolve to private addresses without remote fetch', async () => {
    const repository = createInMemoryControlPlaneRepository();
    let fetchCalled = false;
    const resolvedHostnames: string[] = [];
    const fetcher: typeof fetch = async () => {
      fetchCalled = true;
      return new Response('');
    };
    const hostResolver = async (hostname: string) => {
      resolvedHostnames.push(hostname);
      return [
        { address: '93.184.216.34', family: 4 as const },
        { address: '10.2.3.4', family: 4 as const }
      ];
    };
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      fetcher,
      subscriptionSourceHostResolver: hostResolver,
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await importSubscriptionSource(api, {
      sourceId: 'source-resolved-private-sync',
      name: 'Resolved Private Sync Source',
      url: 'https://updates.example.test/sub.yaml'
    });

    await expect(api.syncSubscriptionSource('source-resolved-private-sync')).resolves.toMatchObject({
      status: 'failed',
      nodeCount: 0,
      warnings: ['subscription_source.sync_failed:subscription source resolved host is not allowed for remote fetch']
    });
    expect(resolvedHostnames).toEqual(['updates.example.test']);
    expect(fetchCalled).toBe(false);
    await expect(repository.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'subscription.source.sync_failed',
          targetId: 'source-resolved-private-sync',
          after: expect.objectContaining({
            warnings: [
              'subscription_source.sync_failed:subscription source resolved host is not allowed for remote fetch'
            ]
          })
        })
      ])
    );
    await expect(api.verifyAuditLogChain()).resolves.toMatchObject({ valid: true });
  });

  it('enforces the external subscription source egress allowlist before DNS and remote fetch', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const resolvedHostnames: string[] = [];
    const fetchedUrls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      fetchedUrls.push(String(input));
      return new Response(
        [
          'proxies:',
          '  - name: "Allowlisted HK 01"',
          '    type: vless',
          '    server: allowlisted-hk.example.com',
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
    };
    const hostResolver = async (hostname: string) => {
      resolvedHostnames.push(hostname);
      return allowPublicSubscriptionHostResolver();
    };
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      fetcher,
      subscriptionSourceHostResolver: hostResolver,
      subscriptionSourceEgress: {
        allowedHosts: ['*.trusted.example.com']
      },
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await importSubscriptionSource(api, {
      sourceId: 'source-allowlisted-sync',
      name: 'Allowlisted Sync Source',
      url: 'https://edge.trusted.example.com/sub.yaml'
    });
    await importSubscriptionSource(api, {
      sourceId: 'source-not-allowlisted-sync',
      name: 'Not Allowlisted Sync Source',
      url: 'https://blocked.example.com/sub.yaml'
    });

    await expect(api.syncSubscriptionSource('source-allowlisted-sync')).resolves.toMatchObject({
      status: 'synced',
      nodeCount: 1
    });
    await expect(api.syncSubscriptionSource('source-not-allowlisted-sync')).resolves.toMatchObject({
      status: 'failed',
      nodeCount: 0,
      warnings: ['subscription_source.sync_failed:subscription source host is not in the egress allowlist']
    });
    expect(resolvedHostnames).toEqual(['edge.trusted.example.com']);
    expect(fetchedUrls).toEqual(['https://edge.trusted.example.com/sub.yaml']);
    await expect(repository.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'subscription.source.synced',
          targetId: 'source-allowlisted-sync',
          result: 'succeeded'
        }),
        expect.objectContaining({
          action: 'subscription.source.sync_failed',
          targetId: 'source-not-allowlisted-sync',
          after: expect.objectContaining({
            warnings: ['subscription_source.sync_failed:subscription source host is not in the egress allowlist']
          })
        })
      ])
    );
    await expect(api.verifyAuditLogChain()).resolves.toMatchObject({ valid: true });
  });

  it('fails external subscription source syncs that exceed the configured body limit', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const fetcher: typeof fetch = async () =>
      new Response('x'.repeat(11), {
        status: 200,
        headers: {
          'Content-Type': 'text/yaml',
          'Content-Length': '11'
        }
      });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      fetcher,
      subscriptionSourceHostResolver: allowPublicSubscriptionHostResolver,
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await importSubscriptionSource(api, {
      sourceId: 'source-oversized-sync',
      name: 'Oversized Sync Source',
      url: 'https://provider.example.com/oversized.yaml',
      maxBodyBytes: 10
    });

    await expect(api.syncSubscriptionSource('source-oversized-sync')).resolves.toMatchObject({
      status: 'failed',
      nodeCount: 0,
      warnings: ['subscription_source.sync_failed:remote response exceeds 10 bytes']
    });
    await expect(repository.listSubscriptionSources()).resolves.toEqual([
      expect.objectContaining({
        id: 'source-oversized-sync',
        status: 'failed',
        nodeCount: 0,
        maxBodyBytes: 10,
        syncWarnings: ['subscription_source.sync_failed:remote response exceeds 10 bytes']
      })
    ]);
    await expect(api.verifyAuditLogChain()).resolves.toMatchObject({ valid: true });
  });

  it('times out external subscription source fetches and records sync failure state', async () => {
    const repository = createInMemoryControlPlaneRepository();
    let observedSignal: AbortSignal | undefined;
    const fetcher: typeof fetch = async (_input, init) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    };
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      fetcher,
      subscriptionSourceHostResolver: allowPublicSubscriptionHostResolver,
      subscriptionSourceFetch: {
        timeoutMs: 5
      },
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await importSubscriptionSource(api, {
      sourceId: 'source-timeout-sync',
      name: 'Timeout Sync Source',
      url: 'https://provider.example.com/timeout.yaml'
    });

    await expect(api.syncSubscriptionSource('source-timeout-sync')).resolves.toMatchObject({
      status: 'failed',
      nodeCount: 0,
      warnings: ['subscription_source.sync_failed:remote fetch timed out after 5ms']
    });
    expect(observedSignal?.aborted).toBe(true);
    await expect(repository.listSubscriptionSources()).resolves.toEqual([
      expect.objectContaining({
        id: 'source-timeout-sync',
        status: 'failed',
        nodeCount: 0,
        syncWarnings: ['subscription_source.sync_failed:remote fetch timed out after 5ms']
      })
    ]);
    await expect(api.verifyAuditLogChain()).resolves.toMatchObject({ valid: true });
  });

  it('projects service-backed subscription client traffic from matched Xray clients', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const inbounds: XrayInbound[] = [
      {
        id: 'inbound-acme-hk-vless',
        nodeId: 'node-hk',
        agentId: 'agent-hk',
        customerName: 'Acme',
        serverAddress: 'edge.example.com',
        clientIdentity: '11111111-1111-4111-8111-111111111111',
        subscriptionRule: 'premium',
        protocol: 'vless',
        label: 'Acme HK VLESS',
        listenAddress: '0.0.0.0',
        listenPort: 443,
        status: 'enabled',
        clients: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            email: 'acme@example.com',
            enabled: true,
            credentialType: 'uuid',
            subId: 'sub_acme_hk',
            trafficLimitBytes: 500 * 1024 * 1024 * 1024,
            usedTrafficBytes: 40 * 1024 * 1024 * 1024,
            expiresAt: '2026-12-31T23:59:59.000Z',
            ipLimit: 3
          }
        ],
        streamSettings: {
          network: 'tcp',
          security: 'reality',
          sni: 'edge.example.com',
          fingerprint: 'chrome'
        },
        tls: {
          enabled: true,
          certificateId: 'cert-edge',
          alpn: ['h2', 'http/1.1']
        },
        reality: {
          enabled: true,
          publicKey: 'reality-public-key',
          fingerprint: 'chrome',
          shortIds: ['a1b2c3d4'],
          serverNames: ['edge.example.com']
        },
        fallbacks: [],
        sniffingEnabled: true,
        configVersion: 'cfg-acme-vless'
      }
    ];
    const subscriptionClients: SubscriptionClientIdentity[] = [
      {
        id: 'sub-client-acme-hk',
        customerName: 'Acme',
        displayName: 'Acme HK',
        subId: 'sub_acme_hk',
        email: 'acme@example.com',
        enabled: true,
        protocol: 'vless',
        group: 'premium',
        trafficLimitBytes: 500 * 1024 * 1024 * 1024,
        usedTrafficBytes: 2 * 1024 * 1024 * 1024,
        expiresAt: '2026-12-31T23:59:59.000Z',
        ipLimit: 3,
        requestLimitPerHour: 360,
        sourceIds: [],
        selectedTags: ['premium'],
        includeFilter: '',
        excludeFilter: '',
        regionFilter: [],
        routingRule: 'tag:premium',
        maxLatencyMs: 0,
        sortStrategy: 'latency',
        formats: ['plain', 'clash'],
        outputFormats: ['uri', 'clash'],
        templateName: 'mihomo-compatible.yaml',
        accessTokenPreview: 'sub_acme...hk',
        generatedNodeCount: 99,
        lastGeneratedAt: '2026-06-04T00:00:00.000Z'
      }
    ];
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      inventory: {
        inbounds,
        subscriptionClients
      }
    });

    await expect(api.listSubscriptionClients()).resolves.toEqual([
      expect.objectContaining({
        id: 'sub-client-acme-hk',
        usedTrafficBytes: 40 * 1024 * 1024 * 1024,
        generatedNodeCount: 1
      })
    ]);
  });

  it('persists subscription export profiles across service-backed API restarts', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
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
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
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
