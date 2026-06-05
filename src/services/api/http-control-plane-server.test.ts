import { createMockApi } from '../mock/mock-api';
import { createHttpControlPlaneServer } from './http-control-plane-server';

async function withServer<T>(run: (baseUrl: string) => Promise<T>) {
  const server = createHttpControlPlaneServer(createMockApi({ seedInventory: true }));

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
  const server = createHttpControlPlaneServer(createMockApi({ seedInventory: true }), {
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

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 2000) {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function readStreamUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  expected: string,
  initial = ''
) {
  const decoder = new TextDecoder();
  let output = initial;

  while (!output.includes(expected)) {
    const chunk = await withTimeout(reader.read(), expected);

    if (chunk.done) {
      throw new Error(`Stream ended before ${expected}`);
    }

    output += decoder.decode(chunk.value, { stream: true });
  }

  return output;
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
      expect(snapshotEnvelope.data.subscriptionClients[0]).toMatchObject({
        id: 'sub-client-acme-hkg'
      });
      expect(snapshotEnvelope.data.trafficRollups).toEqual([]);
      expect(snapshotEnvelope.data.systemAlerts).toEqual(expect.any(Array));
      expect(snapshotEnvelope.data.auditLogs).toEqual([]);

      const agentsResponse = await fetch(`${baseUrl}/api/v1/agents`);
      const agentsEnvelope = await agentsResponse.json();
      const alertsResponse = await fetch(`${baseUrl}/api/v1/system-alerts`);
      const alertsEnvelope = await alertsResponse.json();
      const metricsResponse = await fetch(`${baseUrl}/api/v1/observability-metrics`);
      const metricsEnvelope = await metricsResponse.json();
      const permissionGrantsResponse = await fetch(`${baseUrl}/api/v1/permission-grants`);
      const permissionGrantsEnvelope = await permissionGrantsResponse.json();

      expect(agentsResponse.status).toBe(200);
      expect(agentsEnvelope.data).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'agent-hkg-01' })])
      );
      expect(alertsResponse.status).toBe(200);
      expect(alertsEnvelope.data).toEqual(expect.any(Array));
      expect(metricsResponse.status).toBe(200);
      expect(metricsEnvelope.data).toMatchObject({
        tasks: expect.objectContaining({
          total: expect.any(Number),
          byStatus: expect.objectContaining({
            queued: expect.any(Number)
          })
        }),
        commandOutbox: expect.objectContaining({
          backlog: expect.any(Number)
        }),
        audit: expect.objectContaining({
          valid: true
        })
      });
      expect(permissionGrantsResponse.status).toBe(200);
      expect(permissionGrantsEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'grant-admin-tunnel' }),
          expect.objectContaining({ id: 'grant-owner-group-tunnel' })
        ])
      );

      const taskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders(),
        body: JSON.stringify({
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
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

  it('returns actionable permission denial details for rejected mutations', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Actor': 'operator:bob',
          'X-Operator-Group-Id': 'ops-viewer',
          'X-Request-Id': 'req-http-rbac-denied',
          'Idempotency-Key': 'idem-http-rbac-denied'
        }),
        body: JSON.stringify({
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Apply RBAC protected forwarding policy'
        })
      });
      const envelope = await response.json();

      expect(response.status).toBe(403);
      expect(envelope.error).toMatchObject({
        code: 'permission.denied',
        message: 'Actor does not hold configure permission on the target resource group.',
        details: {
          denialReason: 'Actor does not hold configure permission on the target resource group.',
          after: {
            requiredPermission: 'configure',
            resourceId: 'group-premium'
          }
        }
      });
    });
  });

  it('exposes retained Agent log chunks through an operator read route', async () => {
    await withServer(async (baseUrl) => {
      const taskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-agent-log-task',
          'Idempotency-Key': 'idem-http-agent-log-task'
        }),
        body: JSON.stringify({
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-hkg-01',
          targetLabel: 'Agent HKG 01',
          summary: 'Deploy Agent config with runtime logs'
        })
      });
      const taskEnvelope = await taskResponse.json();

      expect(taskResponse.status).toBe(201);

      const outboxResponse = await fetch(`${baseUrl}/api/v1/command-outbox`);
      const outboxEnvelope = await outboxResponse.json();
      const [outboxItem] = outboxEnvelope.data;

      const eventsResponse = await fetch(`${baseUrl}/agent/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-http-agent-log-event'
        },
        body: JSON.stringify({
          events: [
            {
              type: 'log_chunk',
              eventId: 'evt-http-agent-log-chunk-001',
              commandId: outboxItem.commandId,
              taskId: taskEnvelope.data.id,
              agentId: 'agent-hkg-01',
              seq: outboxItem.seq + 1,
              sessionId: 'sess-http-agent-log-01',
              observedAt: '2026-06-04T06:00:00.000Z',
              payload: {
                chunkSeq: 7,
                stream: 'runtime',
                content: 'applied port-forwarding unit ou-forward-agent-hkg-01.service'
              }
            }
          ]
        })
      });

      expect(eventsResponse.status).toBe(202);

      const logsResponse = await fetch(`${baseUrl}/api/v1/agent-log-chunks?agentId=agent-hkg-01&limit=10`);
      const logsEnvelope = await logsResponse.json();

      expect(logsResponse.status).toBe(200);
      expect(logsEnvelope.data).toEqual([
        expect.objectContaining({
          eventId: 'evt-http-agent-log-chunk-001',
          agentId: 'agent-hkg-01',
          commandId: outboxItem.commandId,
          taskId: taskEnvelope.data.id,
          chunkSeq: 7,
          stream: 'runtime',
          content: 'applied port-forwarding unit ou-forward-agent-hkg-01.service'
        })
      ]);
    });
  });

  it('streams task status and audit summaries as server-sent events', async () => {
    await withServer(async (baseUrl) => {
      const taskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-task-events-create',
          'Idempotency-Key': 'idem-http-task-events-create'
        }),
        body: JSON.stringify({
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-hkg-01',
          targetLabel: 'Agent HKG 01',
          summary: 'Deploy Agent config before opening task event stream'
        })
      });
      const taskEnvelope = await taskResponse.json();

      expect(taskResponse.status).toBe(201);

      const eventsResponse = await fetch(
        `${baseUrl}/events/v1/tasks?once=1&taskId=${encodeURIComponent(taskEnvelope.data.id)}`,
        {
          headers: {
            Accept: 'text/event-stream'
          }
        }
      );
      const eventStream = await eventsResponse.text();

      expect(eventsResponse.status).toBe(200);
      expect(eventsResponse.headers.get('content-type')).toContain('text/event-stream');
      expect(eventStream).toContain('event: task.status.changed');
      expect(eventStream).toContain(`"taskId":"${taskEnvelope.data.id}"`);
      expect(eventStream).toContain('"status":"queued"');
      expect(eventStream).toContain('event: audit.summary');
      expect(eventStream).toContain('event: stream.ready');
    });
  });

  it('keeps task event streams open and publishes live task and audit events', async () => {
    await withServer(async (baseUrl) => {
      const eventsResponse = await fetch(`${baseUrl}/events/v1/tasks`, {
        headers: {
          Accept: 'text/event-stream'
        }
      });
      const reader = eventsResponse.body?.getReader();

      expect(eventsResponse.status).toBe(200);
      expect(eventsResponse.headers.get('content-type')).toContain('text/event-stream');
      expect(reader).toBeDefined();

      if (!reader) {
        throw new Error('Expected readable SSE response body');
      }

      try {
        let eventStream = await readStreamUntil(reader, 'event: stream.ready');
        const taskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
          method: 'POST',
          headers: mutationHeaders({
            'X-Request-Id': 'req-http-task-events-live-create',
            'Idempotency-Key': 'idem-http-task-events-live-create'
          }),
          body: JSON.stringify({
            operation: 'agent.deploy',
            resourceType: 'agent',
            targetId: 'agent-hkg-01',
            targetLabel: 'Agent HKG 01',
            summary: 'Deploy Agent config while task event stream is open'
          })
        });
        const taskEnvelope = await taskResponse.json();

        expect(taskResponse.status).toBe(201);

        eventStream = await readStreamUntil(reader, `"taskId":"${taskEnvelope.data.id}"`, eventStream);

        expect(eventStream).toContain('event: task.status.changed');
        expect(eventStream).toContain('"status":"queued"');
        expect(eventStream).toContain('event: audit.summary');
      } finally {
        await reader.cancel();
      }
    });
  });

  it('resumes task event snapshots after Last-Event-ID cursors', async () => {
    await withServer(async (baseUrl) => {
      const firstTaskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-task-events-cursor-first',
          'Idempotency-Key': 'idem-http-task-events-cursor-first'
        }),
        body: JSON.stringify({
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-hkg-01',
          targetLabel: 'Agent HKG 01',
          summary: 'Deploy Agent config before cursor checkpoint'
        })
      });
      const firstTaskEnvelope = await firstTaskResponse.json();

      expect(firstTaskResponse.status).toBe(201);

      const auditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`);
      const auditEnvelope = await auditResponse.json();
      const firstAudit = auditEnvelope.data.find((auditLog: { taskId?: string }) => auditLog.taskId === firstTaskEnvelope.data.id);

      if (!firstAudit) {
        throw new Error('Expected first task audit log for SSE cursor test');
      }

      const secondTaskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-task-events-cursor-second',
          'Idempotency-Key': 'idem-http-task-events-cursor-second'
        }),
        body: JSON.stringify({
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-hkg-01',
          targetLabel: 'Agent HKG 01',
          summary: 'Deploy Agent config after cursor checkpoint'
        })
      });
      const secondTaskEnvelope = await secondTaskResponse.json();
      const cursor = `audit:${firstAudit.id}`;

      expect(secondTaskResponse.status).toBe(201);

      const eventsResponse = await fetch(`${baseUrl}/events/v1/tasks?once=1`, {
        headers: {
          Accept: 'text/event-stream',
          'Last-Event-ID': cursor
        }
      });
      const eventStream = await eventsResponse.text();

      expect(eventsResponse.status).toBe(200);
      expect(eventStream).not.toContain(`"taskId":"${firstTaskEnvelope.data.id}"`);
      expect(eventStream).toContain(`"taskId":"${secondTaskEnvelope.data.id}"`);
      expect(eventStream).toContain(`"cursor":"${cursor}"`);
      expect(eventStream).toContain('"lastEventId"');
      expect(eventStream).toContain('event: stream.ready');
    });
  });

  it('streams current system alerts as server-sent event snapshots', async () => {
    await withServer(async (baseUrl) => {
      const eventsResponse = await fetch(`${baseUrl}/events/v1/system-alerts?once=1`, {
        headers: {
          Accept: 'text/event-stream'
        }
      });
      const eventStream = await eventsResponse.text();

      expect(eventsResponse.status).toBe(200);
      expect(eventsResponse.headers.get('content-type')).toContain('text/event-stream');
      expect(eventStream).toContain('event: system_alert.snapshot');
      expect(eventStream).toContain('"alerts":');
      expect(eventStream).toContain('"count":');
      expect(eventStream).toContain('"criticalCount":');
      expect(eventStream).toContain('event: stream.ready');
      expect(eventStream).toContain('"live":false');
    });
  });

  it('resumes system alert event snapshots after Last-Event-ID cursors', async () => {
    await withServer(async (baseUrl) => {
      const initialResponse = await fetch(`${baseUrl}/events/v1/system-alerts?once=1`, {
        headers: {
          Accept: 'text/event-stream'
        }
      });
      const initialStream = await initialResponse.text();
      const cursor = /^id: (system-alerts:[^\n]+)$/m.exec(initialStream)?.[1];

      if (!cursor) {
        throw new Error('Expected system alert snapshot cursor.');
      }

      const resumedResponse = await fetch(`${baseUrl}/events/v1/system-alerts?once=1`, {
        headers: {
          Accept: 'text/event-stream',
          'Last-Event-ID': cursor
        }
      });
      const resumedStream = await resumedResponse.text();

      expect(resumedResponse.status).toBe(200);
      expect(resumedStream).not.toContain('event: system_alert.snapshot');
      expect(resumedStream).toContain('event: stream.ready');
      expect(resumedStream).toContain(`"cursor":"${cursor}"`);
      expect(resumedStream).toContain(`"lastEventId":"${cursor}"`);
    });
  });

  it('requires operator authentication for task event streams when auth is configured', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/events/v1/tasks`, {
        headers: {
          Accept: 'text/event-stream'
        }
      });
      const envelope = await response.json();

      expect(response.status).toBe(401);
      expect(envelope.error).toMatchObject({
        code: 'unauthorized',
        message: 'A valid operator bearer token is required.'
      });
    });
  });

  it('requires operator authentication for system alert event streams when auth is configured', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/events/v1/system-alerts`, {
        headers: {
          Accept: 'text/event-stream'
        }
      });
      const envelope = await response.json();

      expect(response.status).toBe(401);
      expect(envelope.error).toMatchObject({
        code: 'unauthorized',
        message: 'A valid operator bearer token is required.'
      });
    });
  });

  it('returns validation details when a runtime task has no target Agent', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-missing-agent-target',
          'Idempotency-Key': 'idem-http-missing-agent-target'
        }),
        body: JSON.stringify({
          operation: 'forward.apply',
          resourceType: 'forward',
          targetId: 'forward-missing-target',
          targetLabel: 'Missing forwarding target',
          summary: 'Apply missing forwarding target'
        })
      });
      const envelope = await response.json();

      expect(response.status).toBe(422);
      expect(envelope.error).toMatchObject({
        code: 'validation_error',
        message: 'This runtime operation requires at least one target Agent before it can be dispatched.',
        details: {
          operation: 'forward.apply',
          targetId: 'forward-missing-target'
        }
      });
    });
  });

  it('maps mutation failures to production HTTP errors and keeps denied audit visible', async () => {
    await withServer(async (baseUrl) => {
      const firstBody = {
        operation: 'forward.apply',
        targetId: 'forward-hkg-443',
        targetLabel: 'Port Forwarding Fabric',
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

  it('creates Agent install commands from forwarded public URLs and registers runtime Agent tokens', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const body = {
        installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
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
        masterEndpoint: 'https://panel.example.com/x7K2mP9vL4qR1wDz/agent/v1/poll',
        scriptUrl: 'https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/public/install/ou-agent.sh'
      });
      expect(commandEnvelope.data.agentId).toMatch(/^agent-[a-f0-9]{12}$/);
      expect(commandEnvelope.data.command).toContain(
        "curl -fsSL 'https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/public/install/ou-agent.sh'"
      );
      expect(commandEnvelope.data.command).not.toContain('OU_HOST_NAME=');
      expect(commandEnvelope.data.command).not.toContain('OU_INSTALL_PROFILE=');
      expect(commandEnvelope.data.command).not.toContain('master.example.com');

      const installAuditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`, {
        headers: {
          Authorization: 'Bearer operator-token-001'
        }
      });
      const installAuditEnvelope = await installAuditResponse.json();

      expect(installAuditEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'agent.credential.issued',
            operation: 'agent.credential.issue',
            resourceType: 'agent',
            targetId: commandEnvelope.data.agentId,
            requestId: 'req-http-install-command'
          })
        ])
      );
      expect(JSON.stringify(installAuditEnvelope.data)).not.toContain(commandEnvelope.data.installToken);

      const replayResponse = await fetch(`${baseUrl}/api/v1/agents/install-command`, {
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
      const replayEnvelope = await replayResponse.json();

      expect(replayResponse.status).toBe(409);
      expect(replayEnvelope.error).toMatchObject({
        code: 'idempotency.replay_unavailable'
      });

      const conflictResponse = await fetch(`${baseUrl}/api/v1/agents/install-command`, {
        method: 'POST',
        headers: mutationHeaders({
          Authorization: 'Bearer operator-token-001',
          'X-Request-Id': 'req-http-install-command',
          'Idempotency-Key': 'idem-http-install-command'
        }),
        body: JSON.stringify({
          ...body,
          publicBaseUrl: 'https://panel.example.com/anotherSecurePath'
        })
      });
      const conflictEnvelope = await conflictResponse.json();

      expect(conflictResponse.status).toBe(409);
      expect(conflictEnvelope.error).toMatchObject({
        code: 'idempotency.conflict'
      });

      const registerResponse = await fetch(`${baseUrl}/agent/v1/register`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${commandEnvelope.data.installToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId: commandEnvelope.data.agentId,
          requestId: 'req-agent-runtime-register',
          sessionId: 'sess-agent-runtime-register',
          version: '0.1.0-test',
          platform: 'linux-x64',
          capabilities: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
        })
      });
      const registerEnvelope = await registerResponse.json();

      expect(registerResponse.status).toBe(201);
      expect(registerEnvelope.data).toEqual(
        expect.objectContaining({
          agentId: commandEnvelope.data.agentId,
          agentToken: expect.stringMatching(/^oat_/),
          credentialId: expect.any(String),
          sessionId: 'sess-agent-runtime-register'
        })
      );

      const pollResponse = await fetch(`${baseUrl}/agent/v1/poll`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${registerEnvelope.data.agentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId: commandEnvelope.data.agentId,
          requestId: 'req-agent-runtime-token-poll',
          sessionId: 'sess-agent-runtime-register',
          lastSeenCommandSeq: 0
        })
      });
      const pollEnvelope = await pollResponse.json();

      expect(pollResponse.status).toBe(200);
      expect(pollEnvelope.data).toMatchObject({
        commands: [],
        nextPollAfterMs: expect.any(Number)
      });

      const rotateResponse = await fetch(
        `${baseUrl}/api/v1/agent-credentials/${encodeURIComponent(registerEnvelope.data.credentialId)}/rotate`,
        {
          method: 'POST',
          headers: mutationHeaders({
            Authorization: 'Bearer operator-token-001',
            'X-Request-Id': 'req-http-agent-runtime-token-rotate',
            'Idempotency-Key': 'idem-http-agent-runtime-token-rotate'
          }),
          body: JSON.stringify({
            reason: 'scheduled runtime credential rotation'
          })
        }
      );
      const rotateEnvelope = await rotateResponse.json();

      expect(rotateResponse.status).toBe(201);
      expect(rotateEnvelope.data).toEqual(
        expect.objectContaining({
          agentId: commandEnvelope.data.agentId,
          agentToken: expect.stringMatching(/^oat_/),
          credentialId: expect.any(String),
          sessionId: 'sess-agent-runtime-register'
        })
      );
      expect(rotateEnvelope.data.credentialId).not.toBe(registerEnvelope.data.credentialId);

      const oldTokenPollResponse = await fetch(`${baseUrl}/agent/v1/poll`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${registerEnvelope.data.agentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId: commandEnvelope.data.agentId,
          requestId: 'req-agent-runtime-token-old-after-rotate',
          sessionId: 'sess-agent-runtime-register',
          lastSeenCommandSeq: 0
        })
      });
      const oldTokenPollEnvelope = await oldTokenPollResponse.json();

      expect(oldTokenPollResponse.status).toBe(401);
      expect(oldTokenPollEnvelope.error).toMatchObject({
        code: 'unauthorized'
      });

      const rotatedPollResponse = await fetch(`${baseUrl}/agent/v1/poll`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${rotateEnvelope.data.agentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId: commandEnvelope.data.agentId,
          requestId: 'req-agent-runtime-token-rotated-poll',
          sessionId: 'sess-agent-runtime-register',
          lastSeenCommandSeq: 0
        })
      });
      const rotatedPollEnvelope = await rotatedPollResponse.json();

      expect(rotatedPollResponse.status).toBe(200);
      expect(rotatedPollEnvelope.data).toMatchObject({
        commands: [],
        nextPollAfterMs: expect.any(Number)
      });

      const mismatchedSessionResponse = await fetch(`${baseUrl}/agent/v1/poll`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${rotateEnvelope.data.agentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId: commandEnvelope.data.agentId,
          requestId: 'req-agent-runtime-token-session-mismatch',
          sessionId: 'sess-agent-runtime-mismatch',
          lastSeenCommandSeq: 0
        })
      });
      const mismatchedSessionEnvelope = await mismatchedSessionResponse.json();

      expect(mismatchedSessionResponse.status).toBe(403);
      expect(mismatchedSessionEnvelope.error).toMatchObject({
        code: 'identity.mismatch'
      });
    });
  });

  it('rejects Agent install command issuance for operators without Agent configure permission', async () => {
    const server = createHttpControlPlaneServer(createMockApi({ seedInventory: false }), {
      auth: {
        operatorTokens: {
          'viewer-token-001': {
            actor: 'operator:viewer',
            operatorGroupId: 'ops-viewer',
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
      throw new Error('RBAC HTTP control-plane test server did not bind to a TCP port');
    }

    try {
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const response = await fetch(`${baseUrl}/api/v1/agents/install-command`, {
        method: 'POST',
        headers: mutationHeaders({
          Authorization: 'Bearer viewer-token-001',
          'X-Request-Id': 'req-http-install-command-denied',
          'Idempotency-Key': 'idem-http-install-command-denied'
        }),
        body: JSON.stringify({
          installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
        })
      });
      const envelope = await response.json();

      expect(response.status).toBe(403);
      expect(envelope.error).toMatchObject({
        code: 'permission.denied'
      });

      const auditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`, {
        headers: {
          Authorization: 'Bearer viewer-token-001'
        }
      });
      const auditEnvelope = await auditResponse.json();

      expect(auditEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'audit.denied',
            operation: 'agent.credential.issue',
            resourceType: 'agent',
            requestId: 'req-http-install-command-denied',
            denialCode: 'permission.denied'
          })
        ])
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('serves public subscription outputs from saved customer Xray inbounds', async () => {
    await withServerApi(createMockApi(), async (baseUrl) => {
      const createInboundResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-public-sub-inbound',
          'Idempotency-Key': 'idem-public-sub-inbound'
        }),
        body: JSON.stringify({
          operation: 'inbound.create',
          resourceType: 'inbound',
          targetId: 'inbound-public-sub-vless',
          targetLabel: 'Public Sub VLESS',
          summary: 'Create public subscription inbound',
          metadata: {
            nodeId: 'inbound-public-sub-vless',
            agentId: 'agent-public-sub',
            customerNodeName: 'Public Sub VLESS',
            customerName: 'Acme',
            serverAddress: 'edge-sub.example.com',
            xrayProtocol: 'vless',
            listenPort: 2443,
            clientIdentity: '22222222-2222-4222-8222-222222222222',
            clientEmail: 'acme@example.com',
            clientCredential: '22222222-2222-4222-8222-222222222222',
            flow: 'xtls-rprx-vision',
            security: 'reality',
            sni: 'edge-sub.example.com',
            realityPublicKey: 'public-sub-reality-key',
            realityShortId: 'abcd1234',
            trafficLimitGb: 500,
            remainingDays: 365,
            subscriptionRule: 'premium'
          }
        })
      });

      expect(createInboundResponse.status).toBe(201);

      const createClientResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-public-sub-client',
          'Idempotency-Key': 'idem-public-sub-client'
        }),
        body: JSON.stringify({
          operation: 'subscription.generate',
          resourceType: 'subscription',
          targetId: 'sub-client-public',
          targetLabel: 'Public Client Subscription',
          summary: 'Create public subscription client',
          metadata: {
            subscriptionClientId: 'sub-client-public',
            customerName: 'Acme',
            displayName: 'Public Client Subscription',
            subId: 'sub_public_acme',
            email: 'acme@example.com',
            protocol: 'vless',
            group: 'premium',
            trafficLimitGb: 500,
            remainingDays: 365,
            selectedTags: ['premium'],
            outputFormats: ['uri', 'clash', 'sing-box'],
            formats: ['plain', 'clash', 'sing-box'],
            securePathPreview: '/x7K2mP9vL4qR1wDz',
            generatedNodeCount: 1
          }
        })
      });

      expect(createClientResponse.status).toBe(201);

      const uriResponse = await fetch(`${baseUrl}/sub/x7K2mP9vL4qR1wDz/uri/sub_public_acme`);
      const uri = await uriResponse.text();

      expect(uriResponse.status).toBe(200);
      expect(uriResponse.headers.get('content-type')).toContain('text/plain');
      expect(uriResponse.headers.get('subscription-userinfo')).toContain(`total=${500 * 1024 * 1024 * 1024}`);
      expect(uri).toContain('vless://22222222-2222-4222-8222-222222222222@edge-sub.example.com:2443');
      expect(uri).toContain('security=reality');

      const clashResponse = await fetch(`${baseUrl}/sub/x7K2mP9vL4qR1wDz/clash/sub_public_acme`);
      const clash = await clashResponse.text();

      expect(clashResponse.status).toBe(200);
      expect(clashResponse.headers.get('content-type')).toContain('text/yaml');
      expect(clash).toContain('Public Sub VLESS');
      expect(clash).toContain('edge-sub.example.com');

      const wrongPathResponse = await fetch(`${baseUrl}/sub/wrongSecurePath000/clash/sub_public_acme`);
      expect(wrongPathResponse.status).toBe(404);

      const disabledMihomoResponse = await fetch(`${baseUrl}/sub/x7K2mP9vL4qR1wDz/mihomo/sub_public_acme`);
      const disabledMihomoEnvelope = await disabledMihomoResponse.json();

      expect(disabledMihomoResponse.status).toBe(403);
      expect(disabledMihomoEnvelope.error).toMatchObject({
        code: 'permission.denied'
      });

      const enableMihomoResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-public-sub-client-mihomo',
          'Idempotency-Key': 'idem-public-sub-client-mihomo'
        }),
        body: JSON.stringify({
          operation: 'subscription.generate',
          resourceType: 'subscription',
          targetId: 'sub-client-public',
          targetLabel: 'Public Client Subscription',
          summary: 'Enable Mihomo output for public subscription client',
          metadata: {
            subscriptionClientId: 'sub-client-public',
            customerName: 'Acme',
            displayName: 'Public Client Subscription',
            subId: 'sub_public_acme',
            email: 'acme@example.com',
            protocol: 'vless',
            group: 'premium',
            trafficLimitGb: 500,
            remainingDays: 365,
            selectedTags: ['premium'],
            outputFormats: ['uri', 'clash', 'mihomo', 'sing-box'],
            formats: ['plain', 'clash', 'mihomo', 'sing-box'],
            securePathPreview: '/x7K2mP9vL4qR1wDz',
            generatedNodeCount: 1
          }
        })
      });

      expect(enableMihomoResponse.status).toBe(201);

      const mihomoResponse = await fetch(`${baseUrl}/sub/x7K2mP9vL4qR1wDz/mihomo/sub_public_acme`);
      const mihomo = await mihomoResponse.text();

      expect(mihomoResponse.status).toBe(200);
      expect(mihomoResponse.headers.get('content-type')).toContain('text/yaml');
      expect(mihomo).toContain('mihomo-compatible subscription generated by OU-UI Next');
      expect(mihomo).toContain('Public Sub VLESS');
    });
  });

  it('rate limits public subscription downloads per subscription identity', async () => {
    await withServerApi(createMockApi(), async (baseUrl) => {
      const createClientResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-public-sub-rate-limit-client',
          'Idempotency-Key': 'idem-public-sub-rate-limit-client'
        }),
        body: JSON.stringify({
          operation: 'subscription.generate',
          resourceType: 'subscription',
          targetId: 'sub-client-rate-limited',
          targetLabel: 'Rate Limited Subscription',
          summary: 'Create rate limited subscription client',
          metadata: {
            subscriptionClientId: 'sub-client-rate-limited',
            customerName: 'Rate Limited Customer',
            displayName: 'Rate Limited Subscription',
            subId: 'sub_rate_limited',
            email: 'limited@example.com',
            protocol: 'vless',
            group: 'premium',
            remainingDays: 30,
            outputFormats: ['uri'],
            formats: ['plain'],
            securePathPreview: '/rL7mN2pQ9sT4vW8xY1zA3bC5',
            requestLimitPerHour: 1,
            generatedNodeCount: 0
          }
        })
      });

      expect(createClientResponse.status).toBe(201);

      const firstResponse = await fetch(`${baseUrl}/sub/rL7mN2pQ9sT4vW8xY1zA3bC5/uri/sub_rate_limited`);
      const secondResponse = await fetch(`${baseUrl}/sub/rL7mN2pQ9sT4vW8xY1zA3bC5/uri/sub_rate_limited`);
      const secondEnvelope = await secondResponse.json();

      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(429);
      expect(secondEnvelope.error).toMatchObject({
        code: 'subscription.rate_limited',
        details: expect.objectContaining({
          clientId: 'sub-client-rate-limited',
          requestLimitPerHour: 1
        })
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
    const api = createMockApi({ seedInventory: true });
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
