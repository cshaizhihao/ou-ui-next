import { createMockApi } from '../mock/mock-api';
import { createHttpControlPlaneServer } from './http-control-plane-server';

async function withAuthenticatedServer<T>(run: (baseUrl: string) => Promise<T>) {
  const server = createHttpControlPlaneServer(createMockApi(), {
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
          targetLabel: 'FLVX Tunnel Fabric',
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
      const protectedOutboxResponse = await fetch(`${baseUrl}/api/v1/command-outbox`);
      const protectedRevisionsResponse = await fetch(`${baseUrl}/api/v1/config-revisions`);
      const authorizedSnapshotResponse = await fetch(`${baseUrl}/api/v1/snapshot`, {
        headers: {
          Authorization: 'Bearer operator-token-001'
        }
      });

      expect(openBoundaryResponse.status).toBe(200);
      expect(protectedSnapshotResponse.status).toBe(401);
      expect(protectedOutboxResponse.status).toBe(401);
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
          targetLabel: 'FLVX Tunnel Fabric',
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
          'Content-Type': 'application/json'
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
          targetLabel: 'FLVX Tunnel Fabric',
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
