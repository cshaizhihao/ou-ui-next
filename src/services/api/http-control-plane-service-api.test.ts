import { seedAgents, seedForwardRules, seedPermissionGrants } from '../mock/mock-data';
import { AGENT_INSTALL_PROFILE } from '../../domain';
import { createHttpControlPlaneServer } from './http-control-plane-server';
import { createServiceBackedControlPlaneApi } from './service-backed-control-plane-api';
import { createControlPlaneService } from '../../server/control-plane/control-plane-service';
import { createInMemoryControlPlaneRepository } from '../../server/control-plane/in-memory-control-plane-repository';
import { createControlPlaneTestClock } from '../../test/control-plane-clock';
import type { AgentEventEnvelope } from './api-contract';
import type { CommandOutboxItem } from './control-plane-api';

type TestServiceApiOptions = {
  fetcher?: typeof fetch;
  subscriptionSourceHostResolver?: (hostname: string) => Promise<Array<{ address: string; family: 4 | 6 }>>;
};

async function allowPublicSubscriptionHostResolver() {
  return [{ address: '93.184.216.34', family: 4 as const }];
}

function createServiceApi(options: TestServiceApiOptions = {}) {
  const repository = createInMemoryControlPlaneRepository({
    forwardRules: seedForwardRules,
    permissionGrants: [
      ...seedPermissionGrants,
      {
        id: 'grant-ops-viewer-tunnel',
        subjectType: 'group',
        subjectId: 'ops-viewer',
        resourceType: 'tunnel-group',
        resourceId: 'group-premium',
        permissions: ['read', 'operate'],
        grantedBy: 'system:bootstrap',
        reason: 'viewer operations baseline',
        resourceVersion: 'permv-ops-viewer',
        createdAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z'
      }
    ]
  });

  return createServiceBackedControlPlaneApi({
    repository,
    service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
    inventory: {
      agents: seedAgents
    },
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    ...(options.subscriptionSourceHostResolver
      ? { subscriptionSourceHostResolver: options.subscriptionSourceHostResolver }
      : {})
  });
}

async function withServer<T>(run: (baseUrl: string) => Promise<T>, options: TestServiceApiOptions = {}) {
  const server = createHttpControlPlaneServer(createServiceApi(options));

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('HTTP control-plane test server did not bind to a TCP port');
  }

  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function mutationHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Actor': 'admin',
    'X-Operator-Group-Id': 'owner',
    'X-Resource-Group-Id': 'group-premium',
    'X-Forwarded-For': '203.0.113.10',
    'X-Request-Id': 'req-service-api-task-001',
    'Idempotency-Key': 'idem-service-api-task-001',
    'If-Match': 'forward-forward-hkg-443-v1',
    ...overrides
  };
}

function withRiskConfirmation<T extends { operation: string; targetId: string }>(input: T) {
  return {
    ...input,
    riskConfirmation: {
      operation: input.operation,
      targetId: input.targetId
    }
  };
}

describe('HTTP control-plane service-backed API', () => {
  it('creates tasks through the service kernel and exposes outbox/audit through HTTP', async () => {
    await withServer(async (baseUrl) => {
      const taskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders(),
        body: JSON.stringify({
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Apply service-backed forwarding policy'
        })
      });
      const taskEnvelope = await taskResponse.json();

      expect(taskResponse.status).toBe(201);
      expect(taskEnvelope.data).toMatchObject({
        operation: 'forward.apply',
        status: 'queued',
        actor: 'admin'
      });

      const outboxResponse = await fetch(`${baseUrl}/api/v1/command-outbox`);
      const outboxEnvelope = await outboxResponse.json();

      expect(outboxEnvelope.data).toEqual([
        expect.objectContaining({
          taskId: taskEnvelope.taskId,
          status: 'pending',
          transport: 'http-pull'
        })
      ]);

      const auditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`);
      const auditEnvelope = await auditResponse.json();
      const revisionsResponse = await fetch(`${baseUrl}/api/v1/config-revisions`);
      const revisionsEnvelope = await revisionsResponse.json();
      const preflightResponse = await fetch(`${baseUrl}/api/v1/preflight-plans`);
      const preflightEnvelope = await preflightResponse.json();
      const snapshotsResponse = await fetch(`${baseUrl}/api/v1/runtime-snapshots`);
      const snapshotsEnvelope = await snapshotsResponse.json();

      expect(auditEnvelope.data).toEqual([
        expect.objectContaining({
          action: 'task.created',
          taskId: taskEnvelope.taskId,
          requestId: 'req-service-api-task-001'
        })
      ]);
      expect(revisionsResponse.status).toBe(200);
      expect(revisionsEnvelope.data).toEqual([
        expect.objectContaining({
          taskId: taskEnvelope.taskId,
          status: 'compiled'
        })
      ]);
      expect(preflightEnvelope.data).toEqual([
        expect.objectContaining({
          taskId: taskEnvelope.taskId,
          status: 'pending'
        })
      ]);
      expect(snapshotsEnvelope.data).toEqual([
        expect.objectContaining({
          taskId: taskEnvelope.taskId,
          status: 'captured'
        })
      ]);
    });
  });

  it('rejects Agent events whose command belongs to a different task and counts them in batches', async () => {
    await withServer(async (baseUrl) => {
      const sourceHeaders = mutationHeaders({
        'X-Request-Id': 'req-service-api-agent-event-binding-source',
        'Idempotency-Key': 'idem-service-api-agent-event-binding-source'
      });
      const wrongTaskHeaders = mutationHeaders({
        'X-Request-Id': 'req-service-api-agent-event-binding-wrong-task',
        'Idempotency-Key': 'idem-service-api-agent-event-binding-wrong-task'
      });
      delete sourceHeaders['If-Match'];
      delete wrongTaskHeaders['If-Match'];

      const sourceTaskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: sourceHeaders,
        body: JSON.stringify({
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-hkg-01',
          targetLabel: 'Agent-A HKG Gateway',
          summary: 'Deploy service Agent config'
        })
      });
      const sourceTaskEnvelope = await sourceTaskResponse.json();
      const wrongTaskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: wrongTaskHeaders,
        body: JSON.stringify({
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-sin-02',
          targetLabel: 'Agent-B SIN Gateway',
          summary: 'Deploy unrelated service Agent config'
        })
      });
      const wrongTaskEnvelope = await wrongTaskResponse.json();
      const outboxResponse = await fetch(`${baseUrl}/api/v1/command-outbox`);
      const outboxEnvelope = await outboxResponse.json();
      const sourceCommand = (outboxEnvelope.data as CommandOutboxItem[]).find(
        (item) => item.taskId === sourceTaskEnvelope.taskId
      );

      expect(sourceTaskResponse.status).toBe(201);
      expect(wrongTaskResponse.status).toBe(201);
      expect(sourceCommand).toBeDefined();

      const appliedConfigRevision =
        sourceCommand!.command.type === 'apply' ? sourceCommand!.command.payload.configRevision : undefined;
      const mismatchEvent = {
        type: 'result',
        eventId: 'evt-service-api-agent-command-task-mismatch',
        commandId: sourceCommand!.commandId,
        taskId: wrongTaskEnvelope.taskId,
        agentId: sourceCommand!.agentId,
        seq: sourceCommand!.seq + 1,
        sessionId: 'sess-service-api-agent-command-task-mismatch',
        observedAt: '2026-06-02T00:00:25.000Z',
        payload: {
          status: 'succeeded',
          ...(appliedConfigRevision ? { appliedConfigRevision } : {}),
          healthSummary: {
            runtime: 'healthy'
          }
        }
      };

      const singleResponse = await fetch(`${baseUrl}/agent/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          events: [mismatchEvent]
        })
      });
      const singleEnvelope = await singleResponse.json();

      expect(singleResponse.status).toBe(409);
      expect(singleEnvelope.error).toMatchObject({
        code: 'agent_event.command_task_mismatch'
      });

      const batchResponse = await fetch(`${baseUrl}/agent/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          events: [
            {
              ...mismatchEvent,
              eventId: 'evt-service-api-agent-command-task-mismatch-batch',
              seq: sourceCommand!.seq + 2
            },
            {
              type: 'heartbeat',
              eventId: 'evt-service-api-agent-command-task-mismatch-heartbeat',
              agentId: sourceCommand!.agentId,
              seq: sourceCommand!.seq + 3,
              sessionId: 'sess-service-api-agent-command-task-mismatch',
              observedAt: '2026-06-02T00:00:30.000Z',
              payload: {
                version: '1.0.0',
                lastSeenCommandSeq: sourceCommand!.seq
              }
            }
          ]
        })
      });
      const batchEnvelope = await batchResponse.json();
      const nextOutboxResponse = await fetch(`${baseUrl}/api/v1/command-outbox`);
      const nextOutboxEnvelope = await nextOutboxResponse.json();

      expect(batchResponse.status).toBe(202);
      expect(batchEnvelope.data).toEqual({
        accepted: 1,
        rejected: 1
      });
      expect(nextOutboxEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            commandId: sourceCommand!.commandId,
            taskId: sourceTaskEnvelope.taskId,
            status: 'pending'
          })
        ])
      );
    });
  });

  it('exposes Agent-derived traffic rollups through HTTP read models', async () => {
    await withServer(async (baseUrl) => {
      const eventResponse = await fetch(`${baseUrl}/agent/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          events: [
            {
              type: 'telemetry_sample',
              eventId: 'evt-service-api-traffic-rollup-001',
              agentId: 'agent-hkg-01',
              seq: 17,
              sessionId: 'sess-agent-hkg-rollup',
              observedAt: '2026-06-02T00:00:17.000Z',
              payload: {
                trafficAccountingMode: 'both',
                monthlyResetDay: 1,
                monthlyIngressBytes: 2048,
                monthlyEgressBytes: 4096,
                trafficBillingPeriod: '2026-06-reset-01',
                forwardingCounters: [
                  {
                    ruleId: 'forward-hkg-443',
                    inboundBytes: 512,
                    outboundBytes: 1024,
                    source: 'nftables',
                    trafficBillingPeriod: '2026-06-reset-01'
                  }
                ]
              }
            }
          ]
        })
      });

      expect(eventResponse.status).toBe(202);

      const rollupsResponse = await fetch(`${baseUrl}/api/v1/traffic-rollups`);
      const rollupsEnvelope = await rollupsResponse.json();

      expect(rollupsResponse.status).toBe(200);
      expect(rollupsEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'traffic-evt-service-api-traffic-rollup-001-agent',
            dimension: 'agent',
            subjectId: 'agent-hkg-01',
            meteredBytes: 6144
          }),
          expect.objectContaining({
            id: 'traffic-evt-service-api-traffic-rollup-001-forward-1',
            dimension: 'forward-rule',
            subjectId: 'forward-hkg-443',
            meteredBytes: 1536
          })
        ])
      );

      const filteredRollupsResponse = await fetch(
        `${baseUrl}/api/v1/traffic-rollups?dimension=forward-rule&agentId=agent-hkg-01&limit=10`
      );
      const filteredRollupsEnvelope = await filteredRollupsResponse.json();

      expect(filteredRollupsResponse.status).toBe(200);
      expect(filteredRollupsEnvelope.data).toEqual([
        expect.objectContaining({
          id: 'traffic-evt-service-api-traffic-rollup-001-forward-1',
          dimension: 'forward-rule',
          subjectId: 'forward-hkg-443',
          meteredBytes: 1536
        })
      ]);

      const exportResponse = await fetch(
        `${baseUrl}/api/v1/traffic-rollups:export?dimension=forward-rule&agentId=agent-hkg-01&format=json`
      );
      const exportEnvelope = await exportResponse.json();

      expect(exportResponse.status).toBe(200);
      expect(exportEnvelope.data).toMatchObject({
        format: 'json',
        contentType: 'application/json; charset=utf-8',
        count: 1,
        query: {
          dimension: 'forward-rule',
          agentId: 'agent-hkg-01',
          limit: 1000,
          format: 'json'
        },
        rollups: [
          expect.objectContaining({
            id: 'traffic-evt-service-api-traffic-rollup-001-forward-1'
          })
        ]
      });
      expect(exportEnvelope.data.content).toContain('"id": "traffic-evt-service-api-traffic-rollup-001-forward-1"');

      const snapshotResponse = await fetch(`${baseUrl}/api/v1/snapshot`);
      const snapshotEnvelope = await snapshotResponse.json();

      expect(snapshotEnvelope.data.trafficRollups).toEqual(rollupsEnvelope.data);
    });
  });

  it('persists subscription import tasks into the service-backed source read model', async () => {
    await withServer(async (baseUrl) => {
      const headers = mutationHeaders({
        'X-Request-Id': 'req-service-api-subscription-import',
        'Idempotency-Key': 'idem-service-api-subscription-import'
      });
      delete headers['If-Match'];

      const response = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          operation: 'subscription.import',
          resourceType: 'subscription',
          targetId: 'source-custom-hkg',
          targetLabel: 'Custom HKG Source',
          summary: 'Import custom subscription source',
          metadata: {
            sourceId: 'source-custom-hkg',
            kind: 'mihomo-provider',
            name: 'Custom HKG Source',
            url: 'https://provider.example.com/hkg.yaml',
            userAgent: 'OU-UI-Next/1.0',
            refreshIntervalMinutes: 45,
            fetchTimeoutSeconds: 12,
            maxBodyBytes: 8 * 1024 * 1024,
            includeFilter: 'premium|streaming',
            excludeFilter: 'expired|test',
            dedupeKey: 'uuid'
          }
        })
      });
      const taskEnvelope = await response.json();

      expect(response.status).toBe(201);
      expect(taskEnvelope.data).toMatchObject({
        operation: 'subscription.import',
        status: 'queued'
      });

      const sourcesResponse = await fetch(`${baseUrl}/api/v1/subscription-sources`);
      const sourcesEnvelope = await sourcesResponse.json();

      expect(sourcesEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'source-custom-hkg',
            kind: 'mihomo-provider',
            name: 'Custom HKG Source',
            url: 'https://provider.example.com/hkg.yaml',
            status: 'syncing',
            dedupeKey: 'uuid',
            includeFilter: 'premium|streaming',
            excludeFilter: 'expired|test',
            refreshIntervalMinutes: 45,
            fetchTimeoutSeconds: 12,
            maxBodyBytes: 8 * 1024 * 1024,
            userAgent: 'OU-UI-Next/1.0'
          })
        ])
      );
      const providersResponse = await fetch(`${baseUrl}/api/v1/proxy-providers`);
      const providersEnvelope = await providersResponse.json();

      expect(providersEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'provider-source-custom-hkg',
            externalSubscriptionId: 'source-custom-hkg',
            filter: 'premium|streaming',
            excludeFilter: 'expired|test',
            processMode: 'server'
          })
        ])
      );
    });
  });

  it('persists generated subscription client rules into the service-backed read model', async () => {
    await withServer(async (baseUrl) => {
      const headers = mutationHeaders({
        'X-Request-Id': 'req-service-api-subscription-client',
        'Idempotency-Key': 'idem-service-api-subscription-client'
      });
      delete headers['If-Match'];

      const response = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          operation: 'subscription.generate',
          resourceType: 'subscription',
          targetId: 'sub-client-service-read-model',
          targetLabel: 'Service Read Model Subscription',
          summary: 'Create client subscription rule',
          metadata: {
            subscriptionClientId: 'sub-client-service-read-model',
            customerName: 'Service Read Model Customer',
            ruleName: 'Service Read Model Subscription',
            displayName: 'Service Read Model Subscription',
            subId: 'sub_service_hkg',
            email: 'service@example.com',
            protocol: 'vless',
            group: 'premium',
            trafficLimitGb: 600,
            usedTrafficGb: 48,
            remainingDays: 60,
            ipLimit: 2,
            sourceIds: ['source-mihomo-hkg'],
            selectedTags: ['premium'],
            includeFilter: '香港|HK',
            excludeFilter: 'test|expired',
            regionFilter: ['hk'],
            routingRule: 'tag:premium AND !tag:test',
            maxLatencyMs: 160,
            sortStrategy: 'latency',
            formats: ['plain', 'mihomo'],
            outputFormats: ['uri', 'clash'],
            templateName: 'mihomo-compatible.yaml',
            accessTokenPreview: 'ou_servic...hkg1',
            securePathPreview: '/A1b2C3d4E5f6G7h8',
            enabled: true,
            generatedNodeCount: 4
          }
        })
      });
      const taskEnvelope = await response.json();

      expect(response.status).toBe(201);
      expect(taskEnvelope.data).toMatchObject({
        operation: 'subscription.generate',
        status: 'queued'
      });

      const clientsResponse = await fetch(`${baseUrl}/api/v1/subscription-clients`);
      const clientsEnvelope = await clientsResponse.json();

      expect(clientsEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'sub-client-service-read-model',
            customerName: 'Service Read Model Customer',
            ruleName: 'Service Read Model Subscription',
            displayName: 'Service Read Model Subscription',
            sourceIds: ['source-mihomo-hkg'],
            regionFilter: ['hk'],
            maxLatencyMs: 160,
            formats: ['plain', 'mihomo'],
            outputFormats: ['uri', 'clash'],
            accessTokenPreview: 'ou_servic...hkg1',
            securePathPreview: '/A1b2C3d4E5f6G7h8'
          })
        ])
      );
      const exportFilesResponse = await fetch(`${baseUrl}/api/v1/subscription-export-files`);
      const exportFilesEnvelope = await exportFilesResponse.json();

      expect(exportFilesEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'export-sub-client-service-read-model',
            selectedProviderIds: [],
            formats: ['plain', 'mihomo']
          })
        ])
      );
    });
  });

  it('syncs external subscription sources and exposes parsed nodes to public subscription output', async () => {
    const fetcher: typeof fetch = async (url, init) => {
      expect(String(url)).toBe('https://provider.example.com/premium.yaml');
      expect(init?.headers).toMatchObject({
        Accept: 'text/yaml,application/yaml,text/plain,*/*',
        'User-Agent': 'OU-UI-Next/1.0'
      });

      return new Response(
        [
          'proxies:',
          '  - name: "HK Premium 01"',
          '    type: vless',
          '    server: hk1.example.com',
          '    port: 443',
          '    uuid: 11111111-1111-4111-8111-111111111111',
          '    tls: true',
          '    servername: hk1.example.com',
          '  - name: "HK Expired 02"',
          '    type: trojan',
          '    server: expired.example.com',
          '    port: 443',
          '    password: expired',
          '  - name: "SG Premium 03"',
          '    type: ss',
          '    server: sg1.example.com',
          '    port: 8388',
          '    cipher: 2022-blake3-aes-128-gcm',
          '    password: sg-secret'
        ].join('\n'),
        {
          status: 200,
          headers: {
            'Content-Type': 'text/yaml'
          }
        }
      );
    };

    await withServer(
      async (baseUrl) => {
        const sourceHeaders = mutationHeaders({
          'X-Request-Id': 'req-service-api-subscription-source-sync-import',
          'Idempotency-Key': 'idem-service-api-subscription-source-sync-import'
        });
        delete sourceHeaders['If-Match'];

        const sourceResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
          method: 'POST',
          headers: sourceHeaders,
          body: JSON.stringify({
            operation: 'subscription.import',
            resourceType: 'subscription',
            targetId: 'source-premium-sync',
            targetLabel: 'Premium External Source',
            summary: 'Import premium external source',
            metadata: {
              sourceId: 'source-premium-sync',
              kind: 'clash',
              name: 'Premium External Source',
              url: 'https://provider.example.com/premium.yaml',
              refreshIntervalMinutes: 30,
              includeFilter: 'premium',
              excludeFilter: 'expired',
              dedupeKey: 'server-port'
            }
          })
        });

        expect(sourceResponse.status).toBe(201);

        const syncResponse = await fetch(`${baseUrl}/api/v1/subscription-sources/source-premium-sync/sync`, {
          method: 'POST',
          headers: mutationHeaders({
            'X-Request-Id': 'req-service-api-subscription-source-sync',
            'Idempotency-Key': 'idem-service-api-subscription-source-sync'
          })
        });
        const syncEnvelope = await syncResponse.json();

        expect(syncResponse.status).toBe(202);
        expect(syncEnvelope.data).toMatchObject({
          sourceId: 'source-premium-sync',
          status: 'synced',
          nodeCount: 2
        });

        const throttledSyncResponse = await fetch(`${baseUrl}/api/v1/subscription-sources/source-premium-sync/sync`, {
          method: 'POST',
          headers: mutationHeaders({
            'X-Request-Id': 'req-service-api-subscription-source-sync-throttled',
            'Idempotency-Key': 'idem-service-api-subscription-source-sync-throttled'
          })
        });
        const throttledSyncEnvelope = await throttledSyncResponse.json();

        expect(throttledSyncResponse.status).toBe(429);
        expect(throttledSyncEnvelope.error).toMatchObject({
          code: 'subscription_source.rate_limited',
          details: expect.objectContaining({
            sourceId: 'source-premium-sync',
            refreshIntervalMinutes: 30
          })
        });

        const nodesResponse = await fetch(`${baseUrl}/api/v1/subscription-nodes`);
        const nodesEnvelope = await nodesResponse.json();

        expect(nodesEnvelope.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              sourceId: 'source-premium-sync',
              name: 'HK Premium 01',
              server: 'hk1.example.com',
              port: 443,
              protocol: 'vless'
            }),
            expect.objectContaining({
              sourceId: 'source-premium-sync',
              name: 'SG Premium 03',
              server: 'sg1.example.com',
              port: 8388,
              protocol: 'shadowsocks'
            })
          ])
        );
        expect(nodesEnvelope.data).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ name: 'HK Expired 02' })])
        );

        const clientHeaders = mutationHeaders({
          'X-Request-Id': 'req-service-api-subscription-source-sync-client',
          'Idempotency-Key': 'idem-service-api-subscription-source-sync-client'
        });
        delete clientHeaders['If-Match'];

        const clientResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
          method: 'POST',
          headers: clientHeaders,
          body: JSON.stringify({
            operation: 'subscription.generate',
            resourceType: 'subscription',
            targetId: 'sub-client-premium-sync',
            targetLabel: 'Premium Synced Client',
            summary: 'Create synced external subscription rule',
            metadata: {
              subscriptionClientId: 'sub-client-premium-sync',
              displayName: 'Premium Synced Client',
              subId: 'sub_premium_sync',
              email: 'premium@example.com',
              protocol: 'vless',
              group: 'premium',
              sourceIds: ['source-premium-sync'],
              selectedTags: ['external-subscription'],
              includeFilter: 'HK',
              securePathPreview: '/A1b2C3d4E5f6G7h8J9k2Lm3n',
              formats: ['plain', 'clash'],
              outputFormats: ['uri', 'clash'],
              trafficLimitGb: 1024,
              remainingDays: 30,
              generatedNodeCount: 1
            }
          })
        });

        expect(clientResponse.status).toBe(201);

        const publicResponse = await fetch(`${baseUrl}/sub/A1b2C3d4E5f6G7h8J9k2Lm3n/clash/sub_premium_sync`);
        const publicBody = await publicResponse.text();

        expect(publicResponse.status).toBe(200);
        expect(publicBody).toContain('HK Premium 01');
        expect(publicBody).toContain('hk1.example.com');
        expect(publicBody).not.toContain('SG Premium 03');
        expect(publicResponse.headers.get('x-ou-ui-node-count')).toBe('1');

        const syncedExportFilesResponse = await fetch(`${baseUrl}/api/v1/subscription-export-files`);
        const syncedExportFilesEnvelope = await syncedExportFilesResponse.json();

        expect(syncedExportFilesEnvelope.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: 'export-sub-client-premium-sync',
              selectedProviderIds: ['provider-source-premium-sync'],
              formats: ['plain', 'clash']
            })
          ])
        );

        const deleteSourceHeaders = mutationHeaders({
          'X-Request-Id': 'req-service-api-subscription-source-delete',
          'Idempotency-Key': 'idem-service-api-subscription-source-delete'
        });
        delete deleteSourceHeaders['If-Match'];

        const deleteSourceResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
          method: 'POST',
          headers: deleteSourceHeaders,
          body: JSON.stringify(withRiskConfirmation({
            operation: 'subscription.delete',
            resourceType: 'subscription',
            targetId: 'source-premium-sync',
            targetLabel: 'Premium External Source',
            summary: 'Delete premium external source',
            metadata: {
              sourceId: 'source-premium-sync'
            }
          }))
        });

        expect(deleteSourceResponse.status).toBe(201);

        const deletedSourcesResponse = await fetch(`${baseUrl}/api/v1/subscription-sources`);
        const deletedSourcesEnvelope = await deletedSourcesResponse.json();
        const deletedNodesResponse = await fetch(`${baseUrl}/api/v1/subscription-nodes`);
        const deletedNodesEnvelope = await deletedNodesResponse.json();
        const deletedPublicResponse = await fetch(`${baseUrl}/sub/A1b2C3d4E5f6G7h8J9k2Lm3n/clash/sub_premium_sync`);
        const deletedPublicBody = await deletedPublicResponse.text();

        expect(deletedSourcesEnvelope.data).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ id: 'source-premium-sync' })])
        );
        expect(deletedNodesEnvelope.data).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ sourceId: 'source-premium-sync' })])
        );
        expect(deletedPublicResponse.headers.get('x-ou-ui-node-count')).toBe('0');
        expect(deletedPublicBody).not.toContain('HK Premium 01');
      },
      { fetcher, subscriptionSourceHostResolver: allowPublicSubscriptionHostResolver }
    );
  });

  it('syncs sing-box JSON subscription sources through the service-backed HTTP API', async () => {
    const fetcher: typeof fetch = async (url, init) => {
      expect(String(url)).toBe('https://provider.example.com/sing-box.json');
      expect(init?.headers).toMatchObject({
        Accept: 'application/json,text/json,text/plain,*/*',
        'User-Agent': 'OU-UI-Next/1.0'
      });

      return new Response(
        JSON.stringify({
          outbounds: [
            {
              type: 'vless',
              tag: 'HK Sing-box VLESS',
              server: 'hk-singbox.example.com',
              server_port: 443,
              uuid: '6dfb3f2e-46c1-4d25-9d73-6d8f36f40f01',
              tls: {
                enabled: true,
                server_name: 'hk-singbox.example.com'
              }
            },
            {
              type: 'direct',
              tag: 'DIRECT'
            }
          ]
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    };

    await withServer(
      async (baseUrl) => {
        const sourceHeaders = mutationHeaders({
          'X-Request-Id': 'req-service-api-sing-box-source-import',
          'Idempotency-Key': 'idem-service-api-sing-box-source-import'
        });
        delete sourceHeaders['If-Match'];

        const sourceResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
          method: 'POST',
          headers: sourceHeaders,
          body: JSON.stringify({
            operation: 'subscription.import',
            resourceType: 'subscription',
            targetId: 'source-sing-box-sync',
            targetLabel: 'Sing-box External Source',
            summary: 'Import sing-box external source',
            metadata: {
              sourceId: 'source-sing-box-sync',
              kind: 'sing-box',
              name: 'Sing-box External Source',
              url: 'https://provider.example.com/sing-box.json',
              includeFilter: 'HK',
              dedupeKey: 'server-port'
            }
          })
        });

        expect(sourceResponse.status).toBe(201);

        const syncResponse = await fetch(`${baseUrl}/api/v1/subscription-sources/source-sing-box-sync/sync`, {
          method: 'POST',
          headers: mutationHeaders({
            'X-Request-Id': 'req-service-api-sing-box-source-sync',
            'Idempotency-Key': 'idem-service-api-sing-box-source-sync'
          })
        });
        const syncEnvelope = await syncResponse.json();

        expect(syncResponse.status).toBe(202);
        expect(syncEnvelope.data).toMatchObject({
          sourceId: 'source-sing-box-sync',
          status: 'synced',
          nodeCount: 1
        });

        const nodesResponse = await fetch(`${baseUrl}/api/v1/subscription-nodes`);
        const nodesEnvelope = await nodesResponse.json();

        expect(nodesEnvelope.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              sourceId: 'source-sing-box-sync',
              name: 'HK Sing-box VLESS',
              protocol: 'vless',
              server: 'hk-singbox.example.com',
              port: 443,
              clashConfig: expect.objectContaining({
                type: 'vless',
                uuid: '6dfb3f2e-46c1-4d25-9d73-6d8f36f40f01'
              })
            })
          ])
        );
        expect(nodesEnvelope.data).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ name: 'DIRECT' })])
        );
      },
      { fetcher, subscriptionSourceHostResolver: allowPublicSubscriptionHostResolver }
    );
  });

  it('resets quota policies through the dedicated HTTP action route', async () => {
    await withServer(async (baseUrl) => {
      const beforeResponse = await fetch(`${baseUrl}/api/v1/quota-policies`);
      const beforeEnvelope = await beforeResponse.json();

      expect(beforeResponse.status).toBe(200);
      expect(beforeEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'managed-host:agent-hkg-01',
            usedBytes: 382 * 1024 * 1024 * 1024
          })
        ])
      );

      const resetResponse = await fetch(
        `${baseUrl}/api/v1/quota-policies/${encodeURIComponent('managed-host:agent-hkg-01')}/reset`,
        {
          method: 'POST',
          headers: mutationHeaders({
            'X-Request-Id': 'req-service-api-quota-reset',
            'Idempotency-Key': 'idem-service-api-quota-reset'
          })
        }
      );
      const resetEnvelope = await resetResponse.json();

      expect(resetResponse.status).toBe(202);
      expect(resetEnvelope.taskId).toBe(resetEnvelope.data.id);
      expect(resetEnvelope.data).toMatchObject({
        operation: 'quota.reset',
        resourceType: 'quota',
        targetId: 'managed-host:agent-hkg-01',
        targetLabel: '香港入口 Agent',
        status: 'queued'
      });

      const afterResponse = await fetch(`${baseUrl}/api/v1/quota-policies`);
      const afterEnvelope = await afterResponse.json();

      expect(afterResponse.status).toBe(200);
      expect(afterEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'managed-host:agent-hkg-01',
            usedBytes: 0,
            enforcementState: 'active'
          })
        ])
      );

      const auditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`);
      const auditEnvelope = await auditResponse.json();

      expect(auditResponse.status).toBe(200);
      expect(auditEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'task.created',
            operation: 'quota.reset',
            targetId: 'managed-host:agent-hkg-01',
            before: expect.objectContaining({
              id: 'managed-host:agent-hkg-01',
              usedBytes: 382 * 1024 * 1024 * 1024
            }),
            after: expect.objectContaining({
              usedBytes: 0
            })
          })
        ])
      );
    });
  });

  it('persists inbound and forwarding task changes into service-backed read models', async () => {
    await withServer(async (baseUrl) => {
      const readTaskOutbox = async (taskId: string): Promise<CommandOutboxItem[]> => {
        const response = await fetch(`${baseUrl}/api/v1/command-outbox`);
        const envelope = (await response.json()) as { data: CommandOutboxItem[] };

        return envelope.data.filter((item) => item.taskId === taskId).sort((left, right) => left.seq - right.seq);
      };
      const postAgentEvent = async (event: AgentEventEnvelope) => {
        const response = await fetch(`${baseUrl}/agent/v1/events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            events: [event]
          })
        });

        expect(response.status).toBe(202);
      };
      const readExpectedConfigRevision = (item: CommandOutboxItem) => {
        if (item.command.type === 'apply' || item.command.type === 'reload') {
          return item.command.payload.configRevision;
        }

        if (item.command.type === 'rollback') {
          return item.command.payload.targetConfigRevision;
        }

        return undefined;
      };
      const completeAgentCommands = async (taskId: string, eventPrefix: string) => {
        const outbox = await readTaskOutbox(taskId);

        expect(outbox.length).toBeGreaterThan(0);

        for (const [index, item] of outbox.entries()) {
          const sessionId = `sess-${eventPrefix}-${item.agentId}`;
          const ackObservedAt = new Date(Date.parse(item.deadlineAt) - 30_000 + index * 1000).toISOString();
          const resultObservedAt = new Date(Date.parse(item.deadlineAt) - 15_000 + index * 1000).toISOString();
          const appliedConfigRevision = readExpectedConfigRevision(item);

          await postAgentEvent({
            type: 'ack',
            eventId: `evt-${eventPrefix}-${item.agentId}-ack`,
            commandId: item.commandId,
            taskId,
            agentId: item.agentId,
            seq: item.seq + 1,
            sessionId,
            observedAt: ackObservedAt,
            payload: {
              duplicate: false
            }
          });
          await postAgentEvent({
            type: 'result',
            eventId: `evt-${eventPrefix}-${item.agentId}-result`,
            commandId: item.commandId,
            taskId,
            agentId: item.agentId,
            seq: item.seq + 2,
            sessionId,
            observedAt: resultObservedAt,
            payload: {
              status: 'succeeded',
              ...(appliedConfigRevision ? { appliedConfigRevision } : {}),
              healthSummary: {
                runtime: 'healthy'
              }
            }
          });
        }
      };
      const inboundHeaders = mutationHeaders({
        'X-Request-Id': 'req-service-api-inbound-read-model',
        'Idempotency-Key': 'idem-service-api-inbound-read-model'
      });
      delete inboundHeaders['If-Match'];

      await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: inboundHeaders,
        body: JSON.stringify({
          operation: 'inbound.create',
          resourceType: 'inbound',
          targetId: 'customer-node-service-read-model',
          targetLabel: 'Service Read Model Inbound',
          summary: 'Create customer Xray inbound',
          metadata: {
            agentId: 'agent-hkg-01',
            customerNodeName: 'Service Read Model Inbound',
            customerName: 'Service Customer',
            serverAddress: 'edge.example.com',
            xrayProtocol: 'vless',
            listenPort: 443,
            clientIdentity: 'service-customer-main',
            streamNetwork: 'ws',
            security: 'tls',
            sni: 'edge.example.com',
            path: '/service-customer',
            ipLimit: 3,
            trafficLimitGb: 500,
            remainingDays: 30,
            subscriptionRule: 'tag:service-read-model'
          }
        })
      });

      const inboundsResponse = await fetch(`${baseUrl}/api/v1/inbounds`);
      const inboundsEnvelope = await inboundsResponse.json();

      expect(inboundsEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'customer-node-service-read-model',
            agentId: 'agent-hkg-01',
            label: 'Service Read Model Inbound',
            customerName: 'Service Customer',
            listenPort: 443,
            subscriptionRule: 'tag:service-read-model'
          })
        ])
      );

      const deleteInboundHeaders = mutationHeaders({
        'X-Request-Id': 'req-service-api-inbound-delete-read-model',
        'Idempotency-Key': 'idem-service-api-inbound-delete-read-model'
      });
      delete deleteInboundHeaders['If-Match'];

      await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: deleteInboundHeaders,
        body: JSON.stringify(withRiskConfirmation({
          operation: 'inbound.delete',
          resourceType: 'inbound',
          targetId: 'customer-node-service-read-model',
          targetLabel: 'Service Read Model Inbound',
          summary: 'Delete customer Xray inbound',
          metadata: {
            agentId: 'agent-hkg-01',
            customerNodeName: 'Service Read Model Inbound'
          }
        }))
      });

      const deletedInboundsResponse = await fetch(`${baseUrl}/api/v1/inbounds`);
      const deletedInboundsEnvelope = await deletedInboundsResponse.json();

      expect(deletedInboundsEnvelope.data).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'customer-node-service-read-model'
          })
        ])
      );

      const forwardHeaders = mutationHeaders({
        'X-Request-Id': 'req-service-api-forward-read-model',
        'Idempotency-Key': 'idem-service-api-forward-read-model'
      });
      delete forwardHeaders['If-Match'];

      const forwardTaskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: forwardHeaders,
        body: JSON.stringify({
          operation: 'forward.create',
          resourceType: 'forward',
          targetId: 'forward-service-read-model-2443',
          targetLabel: 'Service Read Model Forwarding',
          summary: 'Create multi-host port forwarding',
          metadata: {
            name: 'Service Read Model Forwarding',
            ownerName: 'Service Customer',
            tunnelId: 'tunnel-relay-hkg',
            listenAddress: '0.0.0.0',
            listenPort: 2443,
            targetAddress: '172.20.8.10',
            targetPort: 9443,
            protocol: 'tcp+udp',
            entryNodeIds: ['agent-hkg-01', 'agent-sin-02'],
            strategy: 'round-robin',
            quotaGb: 1024,
            rateLimitMbps: 600,
            billingDirection: 'single',
            monthlyResetDay: 11,
            currentUsedTrafficGb: 18,
            tunnelMode: 'direct'
          }
        })
      });
      const forwardTaskEnvelope = await forwardTaskResponse.json();

      expect(forwardTaskResponse.status).toBe(201);

      const forwardRulesResponse = await fetch(`${baseUrl}/api/v1/forward-rules`);
      const forwardRulesEnvelope = await forwardRulesResponse.json();

      expect(forwardRulesEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'forward-service-read-model-2443',
            billingDirection: 'single',
            monthlyResetDay: 11,
            portStatus: 'deploying',
            manualUsedBytes: 18 * 1024 * 1024 * 1024,
            quotaBytes: 1024 * 1024 * 1024 * 1024,
            rateLimitMbps: 600,
            ports: expect.arrayContaining([
              expect.objectContaining({
                agentId: 'agent-hkg-01',
                listenPort: 2443,
                targetAddress: '172.20.8.10',
                targetPort: 9443
              }),
              expect.objectContaining({
                agentId: 'agent-sin-02',
                listenPort: 2443
              })
            ])
          })
        ])
      );

      const manualSuccessHeaders = mutationHeaders({
        'X-Request-Id': 'req-service-api-forward-read-model-manual-success',
        'Idempotency-Key': 'idem-service-api-forward-read-model-manual-success'
      });
      delete manualSuccessHeaders['If-Match'];

      const manualSuccessResponse = await fetch(`${baseUrl}/api/v1/tasks/${forwardTaskEnvelope.taskId}/transition`, {
        method: 'POST',
        headers: manualSuccessHeaders,
        body: JSON.stringify({ status: 'succeeded' })
      });

      expect(manualSuccessResponse.status).toBe(409);
      await completeAgentCommands(forwardTaskEnvelope.taskId, 'forward-create-read-model');

      const allocatedForwardRulesResponse = await fetch(`${baseUrl}/api/v1/forward-rules`);
      const allocatedForwardRulesEnvelope = await allocatedForwardRulesResponse.json();

      expect(allocatedForwardRulesEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'forward-service-read-model-2443',
            portStatus: 'allocated'
          })
        ])
      );

      const deleteForwardHeaders = mutationHeaders({
        'X-Request-Id': 'req-service-api-forward-delete-read-model',
        'Idempotency-Key': 'idem-service-api-forward-delete-read-model'
      });
      delete deleteForwardHeaders['If-Match'];

      const deleteForwardTaskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: deleteForwardHeaders,
        body: JSON.stringify(withRiskConfirmation({
          operation: 'forward.delete',
          resourceType: 'forward',
          targetId: 'forward-service-read-model-2443',
          targetLabel: 'Service Read Model Forwarding',
          summary: 'Delete port forwarding rule',
          metadata: {
            entryNodeIds: ['agent-hkg-01', 'agent-sin-02'],
            listenPort: 2443,
            targetAddress: '172.20.8.10',
            targetPort: 9443
          }
        }))
      });
      const deleteForwardTaskEnvelope = await deleteForwardTaskResponse.json();

      const deletedForwardRulesResponse = await fetch(`${baseUrl}/api/v1/forward-rules`);
      const deletedForwardRulesEnvelope = await deletedForwardRulesResponse.json();

      expect(deleteForwardTaskResponse.status).toBe(201);
      expect(deletedForwardRulesEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'forward-service-read-model-2443',
            portStatus: 'releasing'
          })
        ])
      );

      await completeAgentCommands(deleteForwardTaskEnvelope.taskId, 'forward-delete-read-model');

      const removedForwardRulesResponse = await fetch(`${baseUrl}/api/v1/forward-rules`);
      const removedForwardRulesEnvelope = await removedForwardRulesResponse.json();

      expect(removedForwardRulesEnvelope.data).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'forward-service-read-model-2443'
          })
        ])
      );
    });
  });

  it('persists managed host profile updates into the service-backed agent read model', async () => {
    await withServer(async (baseUrl) => {
      const headers = mutationHeaders({
        'X-Request-Id': 'req-service-api-agent-read-model',
        'Idempotency-Key': 'idem-service-api-agent-read-model'
      });
      delete headers['If-Match'];

      const response = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          operation: 'agent.update',
          resourceType: 'agent',
          targetId: 'agent-hkg-01',
          targetLabel: 'edge-renamed-01',
          summary: 'Update managed host profile',
          metadata: {
            agentId: 'agent-hkg-01',
            hostName: 'edge-renamed-01',
            maxTrafficGb: 2048,
            monthlyTrafficGb: 512,
            trafficAccountingMode: 'egress',
            monthlyResetDay: 7,
            currentUsedTrafficGb: 256,
            expiresAt: '2026-12-31T23:59:59.000Z',
            pingTarget: 'www.cloudflare.com',
            pingIntervalSeconds: 30
          }
        })
      });
      const taskEnvelope = await response.json();

      expect(response.status).toBe(201);
      expect(taskEnvelope.data).toMatchObject({
        operation: 'agent.update',
        status: 'queued'
      });

      const agentsResponse = await fetch(`${baseUrl}/api/v1/agents`);
      const agentsEnvelope = await agentsResponse.json();

      expect(agentsEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'agent-hkg-01',
            name: 'edge-renamed-01',
            maxTrafficBytes: 2048 * 1024 * 1024 * 1024,
            monthlyTrafficLimitBytes: 512 * 1024 * 1024 * 1024,
            trafficPolicy: expect.objectContaining({
              accountingMode: 'egress',
              monthlyResetDay: 7,
              manualUsedTrafficBytes: 256 * 1024 * 1024 * 1024
            }),
            expiresAt: '2026-12-31T23:59:59.000Z',
            probeConfig: expect.objectContaining({
              pingTarget: 'www.cloudflare.com',
              pingIntervalSeconds: 30
            })
          })
        ])
      );
    });
  });

  it('enforces RBAC denial through the HTTP service kernel path', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Actor': 'operator:bob',
          'X-Operator-Group-Id': 'ops-viewer',
          'X-Request-Id': 'req-service-api-rbac-denied',
          'Idempotency-Key': 'idem-service-api-rbac-denied'
        }),
        body: JSON.stringify({
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Apply denied forwarding policy'
        })
      });
      const envelope = await response.json();

      expect(response.status).toBe(403);
      expect(envelope.error).toMatchObject({
        code: 'permission.denied'
      });

      const auditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`);
      const auditEnvelope = await auditResponse.json();

      expect(auditEnvelope.data).toEqual([
        expect.objectContaining({
          action: 'audit.denied',
          denialCode: 'permission.denied',
          actor: 'operator:bob'
        })
      ]);
    });
  });

  it('returns a stable HTTP error code when high-risk confirmation is missing', async () => {
    await withServer(async (baseUrl) => {
      const headers = mutationHeaders({
        'X-Request-Id': 'req-service-api-high-risk-missing',
        'Idempotency-Key': 'idem-service-api-high-risk-missing'
      });
      delete headers['If-Match'];

      const response = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          operation: 'agent.delete',
          resourceType: 'agent',
          targetId: 'agent-hkg-01',
          targetLabel: 'Agent-A HKG Gateway',
          summary: 'Remove managed host without confirmation'
        })
      });
      const envelope = await response.json();

      expect(response.status).toBe(409);
      expect(envelope.error).toMatchObject({
        code: 'high_risk_confirmation.required',
        message: 'High-risk operations require explicit confirmation that matches the operation and target.'
      });

      const auditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`);
      const auditEnvelope = await auditResponse.json();
      const tasksResponse = await fetch(`${baseUrl}/api/v1/tasks`);
      const tasksEnvelope = await tasksResponse.json();

      expect(tasksEnvelope.data).toEqual([]);
      expect(auditEnvelope.data).toEqual([
        expect.objectContaining({
          action: 'audit.denied',
          denialCode: 'high_risk_confirmation.required',
          operation: 'agent.delete',
          targetId: 'agent-hkg-01'
        })
      ]);
    });
  });

  it('persists permission grants through the HTTP service kernel path', async () => {
    await withServer(async (baseUrl) => {
      const headers = mutationHeaders({
        'X-Request-Id': 'req-service-api-permission-grant',
        'Idempotency-Key': 'idem-service-api-permission-grant'
      });
      delete headers['If-Match'];

      const response = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          operation: 'permission.grant',
          targetId: 'grant-ops-premium-operate',
          targetLabel: 'group:ops-hkg -> group-premium',
          summary: 'Grant operate permission to ops-hkg',
          permissionChange: {
            subjectType: 'group',
            subjectId: 'ops-hkg',
            resourceType: 'tunnel-group',
            resourceId: 'group-premium',
            permissions: ['read', 'operate'],
            reason: 'handoff premium tunnel operations'
          }
        })
      });
      const envelope = await response.json();

      expect(response.status).toBe(201);
      expect(envelope.data).toMatchObject({
        operation: 'permission.grant',
        status: 'queued'
      });

      const grantsResponse = await fetch(`${baseUrl}/api/v1/permission-grants`);
      const grantsEnvelope = await grantsResponse.json();

      expect(grantsEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'grant-ops-premium-operate',
            subjectType: 'group',
            subjectId: 'ops-hkg',
            resourceId: 'group-premium',
            permissions: ['read', 'operate'],
            grantedBy: 'admin'
          })
        ])
      );

      const revokeHeaders = mutationHeaders({
        'X-Request-Id': 'req-service-api-permission-revoke',
        'Idempotency-Key': 'idem-service-api-permission-revoke'
      });
      delete revokeHeaders['If-Match'];

      const revokeResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: revokeHeaders,
        body: JSON.stringify(withRiskConfirmation({
          operation: 'permission.revoke',
          targetId: 'grant-ops-premium-operate',
          targetLabel: 'group:ops-hkg -> group-premium',
          summary: 'Revoke operate permission from ops-hkg',
          permissionChange: {
            subjectType: 'group',
            subjectId: 'ops-hkg',
            resourceType: 'tunnel-group',
            resourceId: 'group-premium',
            permissions: ['read', 'operate'],
            reason: 'ops-hkg offboarding'
          }
        }))
      });
      const revokeEnvelope = await revokeResponse.json();

      expect(revokeResponse.status).toBe(201);
      expect(revokeEnvelope.data).toMatchObject({
        operation: 'permission.revoke',
        status: 'queued'
      });

      const revokedGrantsResponse = await fetch(`${baseUrl}/api/v1/permission-grants`);
      const revokedGrantsEnvelope = await revokedGrantsResponse.json();

      expect(revokedGrantsEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'grant-ops-premium-operate',
            revokedAt: expect.any(String),
            revokedBy: 'admin',
            revokedReason: 'ops-hkg offboarding'
          })
        ])
      );
    });
  });

  it('returns a stable HTTP error code when revoking the final administrative grant path', async () => {
    await withServer(async (baseUrl) => {
      const revokeAdminHeaders = mutationHeaders({
        'X-Request-Id': 'req-service-api-permission-revoke-redundant-admin',
        'Idempotency-Key': 'idem-service-api-permission-revoke-redundant-admin'
      });
      delete revokeAdminHeaders['If-Match'];

      const revokeAdminResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: revokeAdminHeaders,
        body: JSON.stringify(withRiskConfirmation({
          operation: 'permission.revoke',
          targetId: 'grant-bootstrap-owner-tunnel',
          targetLabel: 'operator:bootstrap-owner -> group-premium',
          summary: 'Revoke redundant user owner permission path',
          permissionChange: {
            subjectType: 'user',
            subjectId: 'bootstrap-owner',
            resourceType: 'tunnel-group',
            resourceId: 'group-premium',
            permissions: ['read', 'operate', 'configure', 'grant'],
            reason: 'owner user path replaced by owner group'
          }
        }))
      });
      const revokeAdminEnvelope = await revokeAdminResponse.json();

      expect(revokeAdminResponse.status).toBe(201);
      expect(revokeAdminEnvelope.data).toMatchObject({
        operation: 'permission.revoke',
        status: 'queued'
      });

      const revokeOwnerHeaders = mutationHeaders({
        'X-Request-Id': 'req-service-api-permission-revoke-final-admin',
        'Idempotency-Key': 'idem-service-api-permission-revoke-final-admin'
      });
      delete revokeOwnerHeaders['If-Match'];

      const revokeOwnerResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: revokeOwnerHeaders,
        body: JSON.stringify(withRiskConfirmation({
          operation: 'permission.revoke',
          targetId: 'grant-owner-group-tunnel',
          targetLabel: 'group:owner -> group-premium',
          summary: 'Attempt to revoke final owner permission path',
          permissionChange: {
            subjectType: 'group',
            subjectId: 'owner',
            resourceType: 'tunnel-group',
            resourceId: 'group-premium',
            permissions: ['read', 'operate', 'configure', 'grant'],
            reason: 'dangerous owner offboarding'
          }
        }))
      });
      const revokeOwnerEnvelope = await revokeOwnerResponse.json();

      expect(revokeOwnerResponse.status).toBe(409);
      expect(revokeOwnerEnvelope.error).toMatchObject({
        code: 'permission_grant.last_admin_path',
        message: 'Permission revoke would remove the last administrative grant path for this resource.'
      });
    });
  });

  it('surfaces registered Agents as provisioning managed hosts through the service-backed HTTP API', async () => {
    await withServer(async (baseUrl) => {
      const commandResponse = await fetch(`${baseUrl}/api/v1/agents/install-command`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-service-api-register-host-install',
          'Idempotency-Key': 'idem-service-api-register-host-install'
        }),
        body: JSON.stringify({
          installProfile: [...AGENT_INSTALL_PROFILE],
          publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
        })
      });
      const commandEnvelope = await commandResponse.json();

      expect(commandResponse.status).toBe(201);

      const registerResponse = await fetch(`${baseUrl}/agent/v1/register`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${commandEnvelope.data.installToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId: commandEnvelope.data.agentId,
          requestId: 'req-service-api-register-host',
          sessionId: 'sess-service-api-register-host',
          version: '1.2.3-agent',
          platform: 'linux-x64',
          capabilities: [...AGENT_INSTALL_PROFILE]
        })
      });
      const registerEnvelope = await registerResponse.json();

      expect(registerResponse.status).toBe(201);
      expect(registerEnvelope.data).toEqual(
        expect.objectContaining({
          agentId: commandEnvelope.data.agentId,
          sessionId: 'sess-service-api-register-host'
        })
      );

      const agentsResponse = await fetch(`${baseUrl}/api/v1/agents`);
      const agentsEnvelope = await agentsResponse.json();

      expect(agentsResponse.status).toBe(200);
      expect(agentsEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: commandEnvelope.data.agentId,
            status: 'provisioning',
            version: '1.2.3-agent',
            platform: 'linux-x64',
            capabilities: expect.arrayContaining(['host-agent', 'xray', 'port-forwarding'])
          })
        ])
      );

      const auditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`);
      const auditEnvelope = await auditResponse.json();

      expect(auditResponse.status).toBe(200);
      expect(auditEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'agent.credential.issued',
            actor: `agent:${commandEnvelope.data.agentId}`,
            operation: 'agent.credential.issue',
            targetId: commandEnvelope.data.agentId,
            requestId: 'req-service-api-register-host',
            after: expect.objectContaining({
              credential: expect.objectContaining({
                id: registerEnvelope.data.credentialId,
                purpose: 'runtime'
              })
            })
          })
        ])
      );
      expect(JSON.stringify(auditEnvelope.data)).not.toContain(commandEnvelope.data.installToken);
      expect(JSON.stringify(auditEnvelope.data)).not.toContain(registerEnvelope.data.agentToken);
      expect(JSON.stringify(auditEnvelope.data)).not.toContain('tokenHash');
    });
  });

  it('audits denied Agent registration through the service-backed HTTP API', async () => {
    await withServer(async (baseUrl) => {
      const commandResponse = await fetch(`${baseUrl}/api/v1/agents/install-command`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-service-api-register-denied-install',
          'Idempotency-Key': 'idem-service-api-register-denied-install'
        }),
        body: JSON.stringify({
          installProfile: [...AGENT_INSTALL_PROFILE],
          publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
        })
      });
      const commandEnvelope = await commandResponse.json();

      expect(commandResponse.status).toBe(201);

      const registerResponse = await fetch(`${baseUrl}/agent/v1/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId: commandEnvelope.data.agentId,
          requestId: 'req-service-api-register-denied-missing-token',
          sessionId: 'sess-service-api-register-denied-missing-token',
          version: '1.2.3-agent',
          platform: 'linux-x64',
          capabilities: [...AGENT_INSTALL_PROFILE]
        })
      });
      const registerEnvelope = await registerResponse.json();

      expect(registerResponse.status).toBe(401);
      expect(registerEnvelope.error).toMatchObject({
        code: 'unauthorized'
      });

      const auditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`);
      const auditEnvelope = await auditResponse.json();

      expect(auditResponse.status).toBe(200);
      expect(auditEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'audit.denied',
            operation: 'agent.credential.issue',
            targetId: commandEnvelope.data.agentId,
            requestId: 'req-service-api-register-denied-missing-token',
            denialCode: 'agent_registration.install_token_required',
            after: expect.objectContaining({
              installTokenPresented: false
            })
          })
        ])
      );
      expect(JSON.stringify(auditEnvelope.data)).not.toContain(commandEnvelope.data.installToken);
      expect(JSON.stringify(auditEnvelope.data)).not.toContain('tokenHash');
    });
  });

  it('lets Agent poll and event ingestion advance service-backed tasks', async () => {
    await withServer(async (baseUrl) => {
      const headers = mutationHeaders({
        'X-Request-Id': 'req-service-api-agent-task',
        'Idempotency-Key': 'idem-service-api-agent-task'
      });
      delete headers['If-Match'];

      const taskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-hkg-01',
          targetLabel: 'Agent-A HKG Gateway',
          summary: 'Deploy service-backed Agent config'
        })
      });
      const taskEnvelope = await taskResponse.json();

      const pollResponse = await fetch(`${baseUrl}/agent/v1/poll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId: 'agent-hkg-01',
          requestId: 'req-service-api-agent-poll',
          sessionId: 'sess-service-api-agent-poll',
          lastSeenCommandSeq: 0
        })
      });
      const pollEnvelope = await pollResponse.json();
      const [outboxItem] = pollEnvelope.data.commands;
      expect(outboxItem).toMatchObject({
        leaseOwnerId: 'agent-hkg-01',
        leaseSessionId: 'sess-service-api-agent-poll'
      });
      expect(outboxItem.command).toMatchObject({
        sessionId: 'sess-service-api-agent-poll',
        type: 'apply',
        payload: expect.objectContaining({
          moduleKind: 'host-agent',
          artifact: expect.objectContaining({
            artifactVersion: 'ou-ui.runtime.host-agent.v1',
            action: 'enroll_host',
            desiredState: 'managed',
            hostProfile: expect.objectContaining({
              agentId: 'agent-hkg-01',
              displayName: 'Agent-A HKG Gateway',
              hostName: 'agent-hkg-01'
            }),
            telemetryPlan: expect.objectContaining({
              source: 'agent',
              sampleIntervalSeconds: 30,
              pingProbe: expect.objectContaining({
                target: '1.1.1.1',
                intervalSeconds: 30,
                statusBands: expect.arrayContaining([
                  expect.objectContaining({ status: 'green', minMs: 1, maxMs: 100 }),
                  expect.objectContaining({ status: 'yellow', minMs: 101, maxMs: 200 }),
                  expect.objectContaining({ status: 'red', minMs: 201 })
                ])
              }),
              trafficCounters: expect.objectContaining({
                enabled: true,
                accountingMode: 'both',
                counterDirections: ['ingress', 'egress'],
                monthlyResetDay: 1
              }),
              hardwareProbe: expect.objectContaining({
                enabled: true,
                fields: expect.arrayContaining(['cpu', 'memory', 'disk', 'network'])
              })
            })
          })
        })
      });

      await fetch(`${baseUrl}/agent/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          events: [
            {
              type: 'ack',
              eventId: 'evt-service-api-agent-ack',
              commandId: outboxItem.commandId,
              taskId: taskEnvelope.taskId,
              agentId: 'agent-hkg-01',
              seq: outboxItem.seq + 1,
              sessionId: 'sess-agent-hkg-01',
              observedAt: '2026-06-02T00:00:05.000Z',
              payload: {
                duplicate: false
              }
            },
            {
              type: 'result',
              eventId: 'evt-service-api-agent-result',
              commandId: outboxItem.commandId,
              taskId: taskEnvelope.taskId,
              agentId: 'agent-hkg-01',
              seq: outboxItem.seq + 2,
              sessionId: 'sess-agent-hkg-01',
              observedAt: '2026-06-02T00:00:25.000Z',
              payload: {
                status: 'succeeded',
                appliedConfigRevision: outboxItem.command.payload.configRevision,
                healthSummary: {
                  runtime: 'healthy'
                }
              }
            }
          ]
        })
      });

      const detailResponse = await fetch(`${baseUrl}/api/v1/tasks/${taskEnvelope.taskId}`);
      const detailEnvelope = await detailResponse.json();

      expect(detailEnvelope.data).toMatchObject({
        id: taskEnvelope.taskId,
        status: 'succeeded',
        rollbackAvailable: true
      });
    });
  });
});
