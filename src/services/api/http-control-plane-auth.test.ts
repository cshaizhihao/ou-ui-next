import { createMockApi } from '../mock/mock-api';
import { createHttpControlPlaneServer } from './http-control-plane-server';

async function withAuthenticatedServer<T>(run: (baseUrl: string) => Promise<T>) {
  const server = createHttpControlPlaneServer(createMockApi({ seedInventory: true }), {
    auth: {
      operatorTokens: {
        'operator-token-001': {
          actor: 'admin',
          operatorGroupId: 'owner',
          resourceGroupId: 'group-premium'
        }
      },
      agentTokens: {
        'agent-token-hkg-001': {
          agentId: 'agent-hkg-01'
        }
      }
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Authenticated HTTP control-plane test server did not bind to a TCP port');
  }

  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe('HTTP control-plane authentication boundary', () => {
  it('rejects protected mutations without an operator bearer token', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor': 'admin',
          'X-Operator-Group-Id': 'owner',
          'X-Request-Id': 'req-auth-missing-token',
          'Idempotency-Key': 'idem-auth-missing-token'
        },
        body: JSON.stringify({
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Attempt unauthenticated forwarding policy'
        })
      });
      const envelope = await response.json();

      expect(response.status).toBe(401);
      expect(envelope.error).toMatchObject({
        code: 'unauthorized'
      });
    });
  });

  it('protects sensitive read routes when operator tokens are configured', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const openBoundaryResponse = await fetch(`${baseUrl}/api/v1/boundary`);
      const protectedSnapshotResponse = await fetch(`${baseUrl}/api/v1/snapshot`);
      const protectedMetricsResponse = await fetch(`${baseUrl}/api/v1/observability-metrics`);
      const protectedPrometheusMetricsResponse = await fetch(`${baseUrl}/metrics`);
      const protectedOutboxResponse = await fetch(`${baseUrl}/api/v1/command-outbox`);
      const protectedSubscriptionNodesResponse = await fetch(`${baseUrl}/api/v1/subscription-nodes`);
      const protectedRevisionsResponse = await fetch(`${baseUrl}/api/v1/config-revisions`);
      const authorizedSnapshotResponse = await fetch(`${baseUrl}/api/v1/snapshot`, {
        headers: {
          Authorization: 'Bearer operator-token-001'
        }
      });

      expect(openBoundaryResponse.status).toBe(200);
      expect(protectedSnapshotResponse.status).toBe(401);
      expect(protectedMetricsResponse.status).toBe(401);
      expect(protectedPrometheusMetricsResponse.status).toBe(401);
      expect(protectedOutboxResponse.status).toBe(401);
      expect(protectedSubscriptionNodesResponse.status).toBe(401);
      expect(protectedRevisionsResponse.status).toBe(401);
      expect(authorizedSnapshotResponse.status).toBe(200);
    });
  });

  it('derives mutation actor and groups from the operator bearer token instead of spoofable headers', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer operator-token-001',
          'X-Actor': 'operator:bob',
          'X-Operator-Group-Id': 'ops-viewer',
          'X-Resource-Group-Id': 'group-lab',
          'X-Request-Id': 'req-auth-token-derived',
          'Idempotency-Key': 'idem-auth-token-derived',
          'If-Match': 'forward-forward-hkg-443-v1'
        },
        body: JSON.stringify({
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Apply authenticated forwarding policy'
        })
      });
      const envelope = await response.json();

      expect(response.status).toBe(201);
      expect(envelope.data).toMatchObject({
        actor: 'admin',
        status: 'queued'
      });
    });
  });

  it('requires Agent bearer tokens and binds them to the requested agentId', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const missingTokenResponse = await fetch(`${baseUrl}/agent/v1/poll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-agent-auth-missing-http'
        },
        body: JSON.stringify({
          agentId: 'agent-hkg-01',
          requestId: 'req-agent-auth-missing'
        })
      });
      const missingTokenEnvelope = await missingTokenResponse.json();

      const mismatchResponse = await fetch(`${baseUrl}/agent/v1/poll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer agent-token-hkg-001'
        },
        body: JSON.stringify({
          agentId: 'agent-sin-01',
          requestId: 'req-agent-auth-mismatch'
        })
      });
      const mismatchEnvelope = await mismatchResponse.json();

      const validResponse = await fetch(`${baseUrl}/agent/v1/poll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer agent-token-hkg-001'
        },
        body: JSON.stringify({
          agentId: 'agent-hkg-01',
          requestId: 'req-agent-auth-valid'
        })
      });
      const validEnvelope = await validResponse.json();

      expect(missingTokenResponse.status).toBe(401);
      expect(missingTokenEnvelope.error).toMatchObject({
        code: 'unauthorized'
      });
      expect(mismatchResponse.status).toBe(403);
      expect(mismatchEnvelope.error).toMatchObject({
        code: 'identity.mismatch'
      });
      expect(validResponse.status).toBe(200);
      expect(validEnvelope.data).toMatchObject({
        commands: [],
        nextPollAfterMs: 1000
      });

      const auditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`, {
        headers: {
          Authorization: 'Bearer operator-token-001'
        }
      });
      const auditEnvelope = await auditResponse.json();
      const agentPollDenials = auditEnvelope.data.filter(
        (log: { action: string; operation: string }) => log.action === 'audit.denied' && log.operation === 'agent.poll'
      );

      expect(agentPollDenials).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actor: 'agent:unauthenticated',
            targetId: 'agent-authentication',
            requestId: 'req-agent-auth-missing-http',
            denialCode: 'unauthorized',
            after: expect.objectContaining({
              endpoint: 'poll',
              tokenPresented: false
            })
          }),
          expect.objectContaining({
            actor: 'agent:agent-hkg-01',
            targetId: 'agent-sin-01',
            requestId: 'req-agent-auth-mismatch',
            denialCode: 'identity.mismatch',
            before: {
              authenticatedAgent: expect.objectContaining({
                agentId: 'agent-hkg-01'
              })
            },
            after: expect.objectContaining({
              endpoint: 'poll',
              agentIds: ['agent-sin-01'],
              tokenPresented: true
            })
          })
        ])
      );
      expect(JSON.stringify(agentPollDenials)).not.toContain('agent-token-hkg-001');
      expect(JSON.stringify(agentPollDenials)).not.toContain('operator-token-001');
    });
  });

  it('audits denied Agent event ingestion without exposing bearer tokens', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const event = {
        eventId: 'event-auth-mismatch-001',
        agentId: 'agent-sin-01',
        seq: 1,
        sessionId: 'sess-agent-sin-01',
        observedAt: '2026-06-02T00:00:01.000Z',
        type: 'heartbeat',
        payload: {
          version: '0.1.0-test'
        }
      };
      const missingTokenResponse = await fetch(`${baseUrl}/agent/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-agent-events-auth-missing-http'
        },
        body: JSON.stringify({
          events: [event]
        })
      });
      const mismatchResponse = await fetch(`${baseUrl}/agent/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer agent-token-hkg-001',
          'X-Request-Id': 'req-agent-events-auth-mismatch-http'
        },
        body: JSON.stringify({
          events: [event]
        })
      });

      expect(missingTokenResponse.status).toBe(401);
      expect(mismatchResponse.status).toBe(403);

      const auditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`, {
        headers: {
          Authorization: 'Bearer operator-token-001'
        }
      });
      const auditEnvelope = await auditResponse.json();
      const agentEventDenials = auditEnvelope.data.filter(
        (log: { action: string; operation: string }) => log.action === 'audit.denied' && log.operation === 'agent.events'
      );

      expect(agentEventDenials).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actor: 'agent:unauthenticated',
            targetId: 'agent-authentication',
            requestId: 'req-agent-events-auth-missing-http',
            denialCode: 'unauthorized',
            after: expect.objectContaining({
              endpoint: 'events',
              tokenPresented: false
            })
          }),
          expect.objectContaining({
            actor: 'agent:agent-hkg-01',
            targetId: 'agent-sin-01',
            requestId: 'req-agent-events-auth-mismatch-http',
            denialCode: 'identity.mismatch',
            before: {
              authenticatedAgent: expect.objectContaining({
                agentId: 'agent-hkg-01'
              })
            },
            after: expect.objectContaining({
              endpoint: 'events',
              agentIds: ['agent-sin-01'],
              sessionIds: ['sess-agent-sin-01'],
              tokenPresented: true
            })
          })
        ])
      );
      expect(JSON.stringify(agentEventDenials)).not.toContain('agent-token-hkg-001');
      expect(JSON.stringify(agentEventDenials)).not.toContain('operator-token-001');
    });
  });

  it('does not allow operator and Agent tokens to cross runtime boundaries', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const agentTokenMutationResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer agent-token-hkg-001',
          'X-Request-Id': 'req-auth-agent-token-mutation',
          'Idempotency-Key': 'idem-auth-agent-token-mutation'
        },
        body: JSON.stringify({
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Attempt Agent token mutation'
        })
      });

      const operatorTokenPollResponse = await fetch(`${baseUrl}/agent/v1/poll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer operator-token-001'
        },
        body: JSON.stringify({
          agentId: 'agent-hkg-01',
          requestId: 'req-auth-operator-token-poll'
        })
      });

      expect(agentTokenMutationResponse.status).toBe(401);
      expect(operatorTokenPollResponse.status).toBe(401);
    });
  });
});
