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
          targetLabel: 'FLVX Tunnel Fabric',
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
          targetLabel: 'FLVX Tunnel Fabric',
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
        sessionId: 'sess-service-api-agent-poll'
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
