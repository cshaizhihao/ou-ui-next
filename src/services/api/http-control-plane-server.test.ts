import { createMockApi } from '../mock/mock-api';
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

async function withServerApi<T>(api: ReturnType<typeof createMockApi>, run: (baseUrl: string) => Promise<T>) {
  const server = createHttpControlPlaneServer(api);

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
      agentTokens: {}
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

function mutationHeaders(overrides: Record<string, string> = {}) {
  return {
    'Content-Type': 'application/json',
    'X-Actor': 'admin',
    'X-Operator-Group-Id': 'owner',
    'X-Resource-Group-Id': 'group-premium',
    'X-Request-Id': 'req-http-task-001',
    'Idempotency-Key': 'idem-http-task-001',
    ...overrides
  };
}

describe('HTTP control-plane server', () => {
  it('exposes boundary, snapshot, and task creation through REST envelopes', async () => {
    await withServer(async (baseUrl) => {
      const boundaryResponse = await fetch(`${baseUrl}/api/v1/boundary`);
      const boundaryEnvelope = await boundaryResponse.json();

      expect(boundaryResponse.status).toBe(200);
      expect(boundaryEnvelope.data).toMatchObject({
        version: 'v1',
        restBasePath: '/api/v1'
      });

      const snapshotResponse = await fetch(`${baseUrl}/api/v1/snapshot`);
      const snapshotEnvelope = await snapshotResponse.json();

      expect(snapshotResponse.status).toBe(200);
      expect(snapshotEnvelope.data.agents[0]).toMatchObject({
        id: 'agent-hkg-01'
      });
      expect(snapshotEnvelope.data.auditLogs).toEqual([]);

      const agentsResponse = await fetch(`${baseUrl}/api/v1/agents`);
      const agentsEnvelope = await agentsResponse.json();
      const permissionGrantsResponse = await fetch(`${baseUrl}/api/v1/permission-grants`);
      const permissionGrantsEnvelope = await permissionGrantsResponse.json();

      expect(agentsResponse.status).toBe(200);
      expect(agentsEnvelope.data).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'agent-hkg-01' })])
      );
      expect(permissionGrantsResponse.status).toBe(200);
      expect(permissionGrantsEnvelope.data).toEqual([expect.objectContaining({ id: 'grant-admin-tunnel' })]);

      const taskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders(),
        body: JSON.stringify({
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'FLVX Tunnel Fabric',
          summary: 'Apply HTTP forwarding policy'
        })
      });
      const taskEnvelope = await taskResponse.json();

      expect(taskResponse.status).toBe(201);
      expect(taskEnvelope.requestId).toBe('req-http-task-001');
      expect(taskEnvelope.taskId).toBe(taskEnvelope.data.id);
      expect(taskEnvelope.data).toMatchObject({
        operation: 'forward.apply',
        actor: 'admin',
        status: 'queued'
      });
    });
  });

  it('maps mutation failures to production HTTP errors and keeps denied audit visible', async () => {
    await withServer(async (baseUrl) => {
      const firstBody = {
        operation: 'forward.apply',
        targetId: 'forward-hkg-443',
        targetLabel: 'FLVX Tunnel Fabric',
        summary: 'Apply HTTP forwarding policy'
      };
      const conflictBody = {
        ...firstBody,
        summary: 'Apply conflicting HTTP forwarding policy'
      };

      await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-conflict',
          'Idempotency-Key': 'idem-http-conflict'
        }),
        body: JSON.stringify(firstBody)
      });

      const conflictResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-conflict',
          'Idempotency-Key': 'idem-http-conflict'
        }),
        body: JSON.stringify(conflictBody)
      });
      const conflictEnvelope = await conflictResponse.json();

      expect(conflictResponse.status).toBe(409);
      expect(conflictEnvelope.error).toMatchObject({
        code: 'idempotency.conflict'
      });

      const auditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`);
      const auditEnvelope = await auditResponse.json();

      expect(auditEnvelope.data[0]).toMatchObject({
        action: 'audit.denied',
        denialCode: 'idempotency.conflict'
      });
    });
  });

  it('creates Agent install commands from forwarded public URLs and registers the install token', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const body = {
        hostName: 'edge-custom-01',
        maxTrafficGb: 12,
        customerNodeName: '香港高级节点 01',
        customerName: 'Acme Team',
        remainingDays: 45,
        installProfile: ['probe', 'xray', 'flvx', 'forwarding', 'telemetry', 'command-channel']
      };
      const commandResponse = await fetch(`${baseUrl}/api/v1/agents/install-command`, {
        method: 'POST',
        headers: mutationHeaders({
          Authorization: 'Bearer operator-token-001',
          'X-Forwarded-Host': 'panel.example.com',
          'X-Forwarded-Proto': 'https',
          'X-Forwarded-Prefix': '/x7K2mP9vL4qR1wDz',
          'X-Request-Id': 'req-http-install-command',
          'Idempotency-Key': 'idem-http-install-command'
        }),
        body: JSON.stringify(body)
      });
      const commandEnvelope = await commandResponse.json();

      expect(commandResponse.status).toBe(201);
      expect(commandEnvelope.data).toMatchObject({
        agentId: 'agent-edge-custom-01',
        masterEndpoint: 'https://panel.example.com/x7K2mP9vL4qR1wDz/agent/v1/poll',
        scriptUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz/install/ou-agent.sh'
      });
      expect(commandEnvelope.data.command).not.toContain('master.example.com');

      const pollResponse = await fetch(`${baseUrl}/agent/v1/poll`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${commandEnvelope.data.installToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId: 'agent-edge-custom-01',
          requestId: 'req-agent-install-token-poll'
        })
      });
      const pollEnvelope = await pollResponse.json();

      expect(pollResponse.status).toBe(200);
      expect(pollEnvelope.data).toMatchObject({
        commands: [],
        nextPollAfterMs: expect.any(Number)
      });
    });
  });

  it('supports Agent polling, Agent event ingestion, and audit chain verification', async () => {
    await withServer(async (baseUrl) => {
      const taskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-agent-task',
          'Idempotency-Key': 'idem-http-agent-task'
        }),
        body: JSON.stringify({
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-hkg-01',
          targetLabel: 'Agent-A HKG Gateway',
          summary: 'Deploy HTTP Agent config'
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
          requestId: 'req-agent-poll-001'
        })
      });
      const pollEnvelope = await pollResponse.json();
      const [outboxItem] = pollEnvelope.data.commands;

      expect(pollResponse.status).toBe(200);
      expect(outboxItem).toMatchObject({
        taskId: taskEnvelope.taskId,
        agentId: 'agent-hkg-01',
        status: 'dispatched',
        attempts: 1,
        leasedAt: expect.any(String),
        leaseExpiresAt: expect.any(String)
      });

      const eventResponse = await fetch(`${baseUrl}/agent/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          events: [
            {
              type: 'ack',
              eventId: 'evt-http-agent-ack',
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
              eventId: 'evt-http-agent-result',
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
      const eventEnvelope = await eventResponse.json();

      expect(eventResponse.status).toBe(202);
      expect(eventEnvelope.data).toEqual({
        accepted: 2,
        rejected: 0
      });

      const taskDetailResponse = await fetch(`${baseUrl}/api/v1/tasks/${taskEnvelope.taskId}`);
      const taskDetailEnvelope = await taskDetailResponse.json();

      expect(taskDetailEnvelope.data.status).toBe('succeeded');

      const verificationResponse = await fetch(`${baseUrl}/api/v1/audit-logs:verify`);
      const verificationEnvelope = await verificationResponse.json();

      expect(verificationResponse.status).toBe(200);
      expect(verificationEnvelope.data).toMatchObject({
        valid: true,
        checked: 3
      });
    });
  });

  it('maps Agent event ordering and deadline conflicts to HTTP conflict errors', async () => {
    const api = createMockApi();
    let errorCode = 'agent_event.command_deadline_expired';
    api.receiveAgentEvent = async () => {
      throw new Error(errorCode);
    };

    await withServerApi(api, async (baseUrl) => {
      const createEventRequest = () => ({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          events: [
            {
              type: 'result',
              eventId: `evt-http-${errorCode}`,
              commandId: 'cmd-http-conflict',
              taskId: 'task-http-conflict',
              agentId: 'agent-hkg-01',
              seq: 9,
              sessionId: 'sess-http-conflict',
              observedAt: '2026-06-02T00:06:00.000Z',
              payload: {
                status: 'succeeded'
              }
            }
          ]
        })
      });

      const deadlineResponse = await fetch(`${baseUrl}/agent/v1/events`, createEventRequest());
      const deadlineEnvelope = await deadlineResponse.json();

      expect(deadlineResponse.status).toBe(409);
      expect(deadlineEnvelope.error).toMatchObject({
        code: 'agent_event.command_deadline_expired'
      });

      errorCode = 'agent_event.sequence_replay';
      const replayResponse = await fetch(`${baseUrl}/agent/v1/events`, createEventRequest());
      const replayEnvelope = await replayResponse.json();

      expect(replayResponse.status).toBe(409);
      expect(replayEnvelope.error).toMatchObject({
        code: 'agent_event.sequence_replay'
      });
    });
  });

  it('queues explicit Master-to-Agent commands through the command endpoint', async () => {
    await withServer(async (baseUrl) => {
      const commandResponse = await fetch(`${baseUrl}/api/v1/agents/agent-hkg-01/commands`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-command-001',
          'Idempotency-Key': 'idem-http-command-001'
        }),
        body: JSON.stringify({
          type: 'health',
          commandId: 'cmd-explicit-health-001',
          requestId: 'req-http-command-001',
          taskId: 'task-explicit-health-001',
          agentId: 'agent-hkg-01',
          seq: 91,
          issuedAt: '2026-06-02T00:00:00.000Z',
          deadlineAt: '2026-06-02T00:05:00.000Z',
          payload: {
            checks: ['process', 'module_api'],
            timeoutMs: 30000
          }
        })
      });
      const commandEnvelope = await commandResponse.json();

      expect(commandResponse.status).toBe(202);
      expect(commandEnvelope.data).toMatchObject({
        commandId: 'cmd-explicit-health-001',
        agentId: 'agent-hkg-01',
        status: 'pending',
        transport: 'http-pull'
      });

      const pollResponse = await fetch(`${baseUrl}/agent/v1/poll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId: 'agent-hkg-01',
          requestId: 'req-agent-poll-explicit'
        })
      });
      const pollEnvelope = await pollResponse.json();

      expect(pollEnvelope.data.commands).toEqual([
        expect.objectContaining({
          commandId: 'cmd-explicit-health-001'
        })
      ]);
    });
  });

  it('rejects command endpoint path/body agent mismatches', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/agents/agent-hkg-01/commands`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-command-mismatch',
          'Idempotency-Key': 'idem-http-command-mismatch'
        }),
        body: JSON.stringify({
          type: 'health',
          commandId: 'cmd-explicit-health-mismatch',
          requestId: 'req-http-command-mismatch',
          taskId: 'task-explicit-health-mismatch',
          agentId: 'agent-sin-01',
          seq: 92,
          issuedAt: '2026-06-02T00:00:00.000Z',
          deadlineAt: '2026-06-02T00:05:00.000Z',
          payload: {}
        })
      });
      const envelope = await response.json();

      expect(response.status).toBe(422);
      expect(envelope.error).toMatchObject({
        code: 'validation_error'
      });
    });
  });

  it('validates transition and Agent runtime request bodies', async () => {
    await withServer(async (baseUrl) => {
      const taskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-validation-task',
          'Idempotency-Key': 'idem-http-validation-task'
        }),
        body: JSON.stringify({
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-hkg-01',
          targetLabel: 'Agent-A HKG Gateway',
          summary: 'Deploy validation task'
        })
      });
      const taskEnvelope = await taskResponse.json();

      const invalidTransitionResponse = await fetch(`${baseUrl}/api/v1/tasks/${taskEnvelope.taskId}/transition`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-invalid-transition',
          'Idempotency-Key': 'idem-http-invalid-transition'
        }),
        body: JSON.stringify({
          status: 'unknown'
        })
      });
      const invalidTransitionEnvelope = await invalidTransitionResponse.json();

      expect(invalidTransitionResponse.status).toBe(422);
      expect(invalidTransitionEnvelope.error).toMatchObject({
        code: 'validation_error'
      });

      const invalidPollResponse = await fetch(`${baseUrl}/agent/v1/poll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId: 'agent-hkg-01'
        })
      });
      const invalidPollEnvelope = await invalidPollResponse.json();

      expect(invalidPollResponse.status).toBe(422);
      expect(invalidPollEnvelope.error).toMatchObject({
        code: 'validation_error'
      });

      const emptyEventsResponse = await fetch(`${baseUrl}/agent/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          events: []
        })
      });
      const emptyEventsEnvelope = await emptyEventsResponse.json();

      expect(emptyEventsResponse.status).toBe(422);
      expect(emptyEventsEnvelope.error).toMatchObject({
        code: 'validation_error'
      });
    });
  });
});
