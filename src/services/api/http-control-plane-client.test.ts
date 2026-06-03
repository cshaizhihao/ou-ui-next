import { createMockApi } from '../mock/mock-api';
import { createHttpControlPlaneClient } from './http-control-plane-client';
import { createHttpControlPlaneServer } from './http-control-plane-server';

async function withServer<T>(run: (baseUrl: string) => Promise<T>) {
  const server = createHttpControlPlaneServer(createMockApi());

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

const mutationContext = {
  actor: 'admin',
  operatorGroupId: 'owner',
  resourceGroupId: 'group-premium',
  sourceIp: '203.0.113.10',
  userAgent: 'vitest-http-client',
  requestId: 'req-http-client-task-001',
  idempotencyKey: 'idem-http-client-task-001'
};

describe('HTTP control-plane client', () => {
  it('implements the read-model methods against REST envelopes', async () => {
    await withServer(async (baseUrl) => {
      const api = createHttpControlPlaneClient({ baseUrl });

      await expect(api.getApiBoundary()).resolves.toMatchObject({
        version: 'v1',
        restBasePath: '/api/v1'
      });
      await expect(api.listAgents()).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'agent-hkg-01' })])
      );
      await expect(api.listNodes()).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'node-hkg-edge-01' })])
      );
      await expect(api.listPermissionGrants()).resolves.toEqual([
        expect.objectContaining({ id: 'grant-admin-tunnel' })
      ]);
      await expect(api.listAuditLogs()).resolves.toEqual([]);
    });
  });

  it('creates and transitions tasks through mutation headers', async () => {
    await withServer(async (baseUrl) => {
      const api = createHttpControlPlaneClient({ baseUrl });

      const task = await api.createTask(
        {
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Apply HTTP client forwarding policy'
        },
        mutationContext
      );

      expect(task).toMatchObject({
        actor: 'admin',
        operation: 'forward.apply',
        status: 'queued'
      });

      await expect(
        api.transitionTask(task.id, 'running', {
          ...mutationContext,
          requestId: 'req-http-client-transition-001',
          idempotencyKey: 'idem-http-client-transition-001'
        })
      ).resolves.toMatchObject({
        id: task.id,
        status: 'running'
      });
    });
  });

  it('requests Agent install commands through the HTTP client adapter', async () => {
    await withServer(async (baseUrl) => {
      const api = createHttpControlPlaneClient({ baseUrl });

      const command = await api.createAgentInstallCommand(
        {
          hostName: 'edge-custom-01',
          installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel'],
          publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
        },
        {
          ...mutationContext,
          requestId: 'req-http-client-install-command',
          idempotencyKey: 'idem-http-client-install-command'
        }
      );

      expect(command).toMatchObject({
        masterEndpoint: 'https://panel.example.com/x7K2mP9vL4qR1wDz/agent/v1/poll',
        scriptUrl: 'https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/public/install/ou-agent.sh'
      });
      expect(command.agentId).toMatch(/^agent-[a-f0-9]{12}$/);
      expect(command.command).toContain(
        "curl -fsSL 'https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/public/install/ou-agent.sh'"
      );
      expect(command.command).not.toContain('OU_HOST_NAME=');
      expect(command.command).not.toContain('OU_INSTALL_PROFILE=');
      expect(command.command).not.toContain('master.example.com');

      const registration = await api.registerAgent(
        {
          agentId: command.agentId,
          requestId: 'req-http-client-agent-register',
          sessionId: 'sess-http-client-agent-register',
          version: '0.1.0-test',
          platform: 'linux-x64',
          capabilities: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
        },
        command.installToken
      );

      expect(registration).toEqual(
        expect.objectContaining({
          agentId: command.agentId,
          agentToken: expect.stringMatching(/^oat_/),
          sessionId: 'sess-http-client-agent-register'
        })
      );
      await expect(api.listAgentCredentials()).resolves.toEqual([
        expect.objectContaining({
          id: registration.credentialId,
          status: 'active',
          tokenPrefix: expect.stringMatching(/^oat_/)
        })
      ]);

      const rotated = await api.rotateAgentCredential(
        registration.credentialId,
        {
          reason: 'scheduled runtime credential rotation'
        },
        {
          ...mutationContext,
          requestId: 'req-http-client-agent-credential-rotate',
          idempotencyKey: 'idem-http-client-agent-credential-rotate'
        }
      );

      expect(rotated).toEqual(
        expect.objectContaining({
          agentId: command.agentId,
          agentToken: expect.stringMatching(/^oat_/),
          credentialId: expect.any(String),
          sessionId: 'sess-http-client-agent-register'
        })
      );
      expect(rotated.credentialId).not.toBe(registration.credentialId);
      await expect(api.listAgentCredentials()).resolves.toEqual([
        expect.objectContaining({
          id: rotated.credentialId,
          status: 'active'
        }),
        expect.objectContaining({
          id: registration.credentialId,
          status: 'revoked',
          replacedByCredentialId: rotated.credentialId
        })
      ]);
      await expect(
        api.revokeAgentCredential(
          rotated.credentialId,
          {
            reason: 'operator initiated runtime credential rotation'
          },
          {
            ...mutationContext,
            requestId: 'req-http-client-agent-credential-revoke',
            idempotencyKey: 'idem-http-client-agent-credential-revoke'
          }
        )
      ).resolves.toEqual(
        expect.objectContaining({
          id: rotated.credentialId,
          status: 'revoked',
          revokedReason: 'operator initiated runtime credential rotation'
        })
      );
    });
  });

  it('surfaces REST error envelopes as typed client errors', async () => {
    await withServer(async (baseUrl) => {
      const api = createHttpControlPlaneClient({ baseUrl });
      const input = {
        operation: 'forward.apply' as const,
        targetId: 'forward-hkg-443',
        targetLabel: 'Port Forwarding Fabric',
        summary: 'Apply HTTP client forwarding policy'
      };

      await api.createTask(input, {
        ...mutationContext,
        requestId: 'req-http-client-conflict',
        idempotencyKey: 'idem-http-client-conflict'
      });

      await expect(
        api.createTask(
          {
            ...input,
            summary: 'Apply conflicting HTTP client forwarding policy'
          },
          {
            ...mutationContext,
            requestId: 'req-http-client-conflict',
            idempotencyKey: 'idem-http-client-conflict'
          }
        )
      ).rejects.toMatchObject({
        code: 'idempotency.conflict',
        status: 409
      });
    });
  });

  it('polls Agent command outbox and submits Agent events', async () => {
    await withServer(async (baseUrl) => {
      const api = createHttpControlPlaneClient({ baseUrl, defaultAgentId: 'agent-hkg-01' });
      const task = await api.createTask(
        {
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-hkg-01',
          targetLabel: 'Agent-A HKG Gateway',
          summary: 'Deploy HTTP client Agent config'
        },
        mutationContext
      );
      const [outboxItem] = await api.listCommandOutbox();

      expect(outboxItem).toMatchObject({
        taskId: task.id,
        agentId: 'agent-hkg-01',
        status: 'dispatched',
        attempts: 1,
        leasedAt: expect.any(String),
        leaseExpiresAt: expect.any(String)
      });

      await api.receiveAgentEvent({
        type: 'ack',
        eventId: 'evt-http-client-agent-ack',
        commandId: outboxItem.commandId,
        taskId: task.id,
        agentId: 'agent-hkg-01',
        seq: outboxItem.seq + 1,
        sessionId: 'sess-agent-hkg-01',
        observedAt: '2026-06-02T00:00:05.000Z',
        payload: {
          duplicate: false
        }
      });

      await expect(api.listTasks()).resolves.toEqual([expect.objectContaining({ id: task.id, status: 'running' })]);
    });
  });

  it('queues explicit Agent commands through the HTTP client adapter', async () => {
    await withServer(async (baseUrl) => {
      const api = createHttpControlPlaneClient({ baseUrl, defaultAgentId: 'agent-hkg-01' });
      const outboxItem = await api.issueAgentCommand(
        'agent-hkg-01',
        {
          type: 'health',
          commandId: 'cmd-http-client-health-001',
          requestId: 'req-http-client-command-001',
          taskId: 'task-http-client-health-001',
          agentId: 'agent-hkg-01',
          seq: 101,
          issuedAt: '2026-06-02T00:00:00.000Z',
          deadlineAt: '2026-06-02T00:05:00.000Z',
          payload: {
            checks: ['process'],
            timeoutMs: 15000
          }
        },
        {
          ...mutationContext,
          requestId: 'req-http-client-command-001',
          idempotencyKey: 'idem-http-client-command-001'
        }
      );

      expect(outboxItem).toMatchObject({
        commandId: 'cmd-http-client-health-001',
        agentId: 'agent-hkg-01',
        status: 'pending'
      });
      await expect(api.listCommandOutbox()).resolves.toEqual([
        expect.objectContaining({
          commandId: 'cmd-http-client-health-001'
        })
      ]);
    });
  });

  it('sends operator and Agent bearer tokens to authenticated HTTP servers', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const api = createHttpControlPlaneClient({
        baseUrl,
        defaultAgentId: 'agent-hkg-01',
        operatorBearerToken: 'operator-token-001',
        agentBearerToken: 'agent-token-hkg-001'
      });

      await expect(api.listAgents()).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'agent-hkg-01' })])
      );

      const task = await api.createTask(
        {
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-hkg-01',
          targetLabel: 'Agent-A HKG Gateway',
          summary: 'Deploy authenticated HTTP client Agent config'
        },
        {
          ...mutationContext,
          actor: 'operator:bob',
          operatorGroupId: 'ops-viewer',
          resourceGroupId: 'group-lab',
          requestId: 'req-http-client-auth-task',
          idempotencyKey: 'idem-http-client-auth-task'
        }
      );
      const [outboxItem] = await api.listCommandOutbox();

      expect(task).toMatchObject({
        actor: 'admin',
        status: 'queued'
      });
      expect(outboxItem).toMatchObject({
        taskId: task.id,
        agentId: 'agent-hkg-01'
      });
    });
  });
});
