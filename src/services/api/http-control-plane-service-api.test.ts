import { seedForwardRules, seedPermissionGrants } from '../mock/mock-data';
import { createHttpControlPlaneServer } from './http-control-plane-server';
import { createServiceBackedControlPlaneApi } from './service-backed-control-plane-api';
import { createControlPlaneService } from '../../server/control-plane/control-plane-service';
import { createInMemoryControlPlaneRepository } from '../../server/control-plane/in-memory-control-plane-repository';

function createServiceApi() {
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
    service: createControlPlaneService({ repository })
  });
}

async function withServer<T>(run: (baseUrl: string) => Promise<T>) {
  const server = createHttpControlPlaneServer(createServiceApi());

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
    });
  });

  it('persists inbound and forwarding task changes into service-backed read models', async () => {
    await withServer(async (baseUrl) => {
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

      await fetch(`${baseUrl}/api/v1/tasks`, {
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
            ipRateLimitMbps: 80,
            maxConnections: 2048,
            maxConnectionsPerIp: 32,
            billingDirection: 'both',
            tunnelMode: 'encrypted'
          }
        })
      });

      const forwardRulesResponse = await fetch(`${baseUrl}/api/v1/forward-rules`);
      const forwardRulesEnvelope = await forwardRulesResponse.json();

      expect(forwardRulesEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'forward-service-read-model-2443',
            quotaBytes: 1024 * 1024 * 1024 * 1024,
            rateLimitMbps: 600,
            ipRateLimitMbps: 80,
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

      const deleteForwardHeaders = mutationHeaders({
        'X-Request-Id': 'req-service-api-forward-delete-read-model',
        'Idempotency-Key': 'idem-service-api-forward-delete-read-model'
      });
      delete deleteForwardHeaders['If-Match'];

      await fetch(`${baseUrl}/api/v1/tasks`, {
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

      const deletedForwardRulesResponse = await fetch(`${baseUrl}/api/v1/forward-rules`);
      const deletedForwardRulesEnvelope = await deletedForwardRulesResponse.json();

      expect(deletedForwardRulesEnvelope.data).not.toEqual(
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
              hostName: 'Agent-A HKG Gateway'
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
