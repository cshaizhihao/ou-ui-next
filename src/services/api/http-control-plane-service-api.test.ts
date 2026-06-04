import { seedAgents, seedForwardRules, seedPermissionGrants } from '../mock/mock-data';
import { createHttpControlPlaneServer } from './http-control-plane-server';
import { createServiceBackedControlPlaneApi } from './service-backed-control-plane-api';
import { createControlPlaneService } from '../../server/control-plane/control-plane-service';
import { createInMemoryControlPlaneRepository } from '../../server/control-plane/in-memory-control-plane-repository';
import { createControlPlaneTestClock } from '../../test/control-plane-clock';

function createServiceApi(options: { fetcher?: typeof fetch } = {}) {
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
    ...(options.fetcher ? { fetcher: options.fetcher } : {})
  });
}

async function withServer<T>(run: (baseUrl: string) => Promise<T>, options: { fetcher?: typeof fetch } = {}) {
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
          body: JSON.stringify({
            operation: 'subscription.delete',
            resourceType: 'subscription',
            targetId: 'source-premium-sync',
            targetLabel: 'Premium External Source',
            summary: 'Delete premium external source',
            metadata: {
              sourceId: 'source-premium-sync'
            }
          })
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
      { fetcher }
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
      { fetcher }
    );
  });

  it('persists inbound and forwarding task changes into service-backed read models', async () => {
    await withServer(async (baseUrl) => {
      const transitionTask = async (taskId: string, status: 'running' | 'succeeded', id: string) => {
        const headers = mutationHeaders({
          'X-Request-Id': `req-service-api-${id}`,
          'Idempotency-Key': `idem-service-api-${id}`
        });
        delete headers['If-Match'];

        const response = await fetch(`${baseUrl}/api/v1/tasks/${taskId}/transition`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ status })
        });

        expect(response.status).toBe(200);
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
        body: JSON.stringify({
          operation: 'inbound.delete',
          resourceType: 'inbound',
          targetId: 'customer-node-service-read-model',
          targetLabel: 'Service Read Model Inbound',
          summary: 'Delete customer Xray inbound',
          metadata: {
            agentId: 'agent-hkg-01',
            customerNodeName: 'Service Read Model Inbound'
          }
        })
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

      await transitionTask(forwardTaskEnvelope.taskId, 'running', 'forward-read-model-running');
      await transitionTask(forwardTaskEnvelope.taskId, 'succeeded', 'forward-read-model-succeeded');

      const deleteForwardHeaders = mutationHeaders({
        'X-Request-Id': 'req-service-api-forward-delete-read-model',
        'Idempotency-Key': 'idem-service-api-forward-delete-read-model'
      });
      delete deleteForwardHeaders['If-Match'];

      const deleteForwardTaskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: deleteForwardHeaders,
        body: JSON.stringify({
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
        })
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

      await transitionTask(deleteForwardTaskEnvelope.taskId, 'running', 'forward-delete-running');
      await transitionTask(deleteForwardTaskEnvelope.taskId, 'succeeded', 'forward-delete-succeeded');

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
        body: JSON.stringify({
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
        })
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
