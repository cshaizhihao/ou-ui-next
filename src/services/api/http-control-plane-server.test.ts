import { createHash } from 'node:crypto';
import { afterAll, beforeAll, vi } from 'vitest';
import { createMockApi } from '../mock/mock-api';
import {
  createHttpControlPlaneServer,
  type ControlPlaneStructuredLogEvent,
  type CreateHttpControlPlaneServerOptions
} from './http-control-plane-server';

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-02T00:05:00.000Z'));
});

afterAll(() => {
  vi.useRealTimers();
});

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

async function withLoggedServer<T>(
  run: (baseUrl: string, logs: ControlPlaneStructuredLogEvent[]) => Promise<T>,
  options: Omit<CreateHttpControlPlaneServerOptions, 'logger'> = {}
) {
  const logs: ControlPlaneStructuredLogEvent[] = [];
  const server = createHttpControlPlaneServer(createMockApi({ seedInventory: true }), {
    ...options,
    logger: {
      write(event) {
        logs.push(event);
      }
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Logged HTTP control-plane test server did not bind to a TCP port');
  }

  try {
    return await run(`http://127.0.0.1:${address.port}`, logs);
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

function subscriptionAccessTokenHash(token: string) {
  return `sha256:${createHash('sha256').update(token).digest('hex')}`;
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
  it('emits structured request, task, and Agent poll logs without sensitive payloads', async () => {
    await withLoggedServer(async (baseUrl, logs) => {
      const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
      const taskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-structured-task',
          'Idempotency-Key': 'idem-http-structured-task',
          traceparent
        }),
        body: JSON.stringify({
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-hkg-01',
          targetLabel: 'Agent HKG 01',
          summary: 'Deploy structured logging task'
        })
      });
      const taskEnvelope = await taskResponse.json();

      expect(taskResponse.status).toBe(201);
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'task.created',
            requestId: 'req-http-structured-task',
            traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
            parentSpanId: '00f067aa0ba902b7',
            taskId: taskEnvelope.taskId,
            operation: 'agent.deploy',
            resourceType: 'agent',
            targetId: 'agent-hkg-01',
            actor: 'admin'
          }),
          expect.objectContaining({
            event: 'http.request.completed',
            requestId: 'req-http-structured-task',
            traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
            method: 'POST',
            path: '/api/v1/tasks',
            statusCode: 201,
            durationMs: expect.any(Number)
          })
        ])
      );
      expect(JSON.stringify(logs)).not.toContain('Authorization');

      const pollResponse = await fetch(`${baseUrl}/agent/v1/poll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId: 'agent-hkg-01',
          sessionId: 'sess-structured-agent',
          requestId: 'req-agent-structured-poll'
        })
      });
      const pollEnvelope = await pollResponse.json();

      expect(pollResponse.status).toBe(200);
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'agent.poll',
            requestId: 'req-agent-structured-poll',
            agentId: 'agent-hkg-01',
            sessionId: 'sess-structured-agent',
            commandCount: 1,
            commandIds: [pollEnvelope.data.commands[0].commandId],
            taskIds: [taskEnvelope.taskId]
          })
        ])
      );
    });
  });

  it('samples routine Agent poll and heartbeat logs while preserving command poll evidence', async () => {
    await withLoggedServer(
      async (baseUrl, logs) => {
        for (let index = 1; index <= 2; index += 1) {
          const pollResponse = await fetch(`${baseUrl}/agent/v1/poll`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              agentId: 'agent-hkg-01',
              sessionId: 'sess-routine-agent',
              requestId: `req-agent-routine-poll-00${index}`
            })
          });

          expect(pollResponse.status).toBe(200);
        }

        expect(logs.some((log) => log.event === 'agent.poll')).toBe(false);
        expect(logs.some((log) => log.event === 'http.request.completed' && log.path === '/agent/v1/poll')).toBe(false);

        const sampledPollResponse = await fetch(`${baseUrl}/agent/v1/poll`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            agentId: 'agent-hkg-01',
            sessionId: 'sess-routine-agent',
            requestId: 'req-agent-routine-poll-003'
          })
        });

        expect(sampledPollResponse.status).toBe(200);
        expect(logs).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              event: 'agent.poll',
              requestId: 'req-agent-routine-poll-003',
              commandCount: 0,
              routineSampled: true
            }),
            expect.objectContaining({
              event: 'http.request.completed',
              path: '/agent/v1/poll',
              statusCode: 200
            })
          ])
        );

        for (let index = 1; index <= 3; index += 1) {
          const heartbeatResponse = await fetch(`${baseUrl}/agent/v1/events`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              events: [
                {
                  type: 'heartbeat',
                  eventId: `evt-routine-heartbeat-00${index}`,
                  agentId: 'agent-hkg-01',
                  seq: 100 + index,
                  sessionId: 'sess-routine-agent',
                  observedAt: `2026-06-02T00:00:0${index}.000Z`,
                  payload: {
                    version: '1.0.0'
                  }
                }
              ]
            })
          });

          expect(heartbeatResponse.status).toBe(202);
        }

        const sampledEvents = logs.filter((log) => log.event === 'agent.events.accepted');
        expect(sampledEvents).toHaveLength(1);
        expect(sampledEvents[0]).toMatchObject({
          routineSampled: true,
          eventIds: ['evt-routine-heartbeat-003'],
          eventTypes: ['heartbeat']
        });
        expect(logs.filter((log) => log.event === 'http.request.completed' && log.path === '/agent/v1/events')).toHaveLength(
          1
        );

        const taskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
          method: 'POST',
          headers: mutationHeaders({
            'X-Request-Id': 'req-http-routine-log-task',
            'Idempotency-Key': 'idem-http-routine-log-task'
          }),
          body: JSON.stringify({
            operation: 'agent.deploy',
            resourceType: 'agent',
            targetId: 'agent-hkg-01',
            targetLabel: 'Agent HKG 01',
            summary: 'Deploy command poll logging task'
          })
        });
        const taskEnvelope = await taskResponse.json();

        expect(taskResponse.status).toBe(201);

        const commandPollResponse = await fetch(`${baseUrl}/agent/v1/poll`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            agentId: 'agent-hkg-01',
            sessionId: 'sess-routine-agent',
            requestId: 'req-agent-command-poll'
          })
        });
        const commandPollEnvelope = await commandPollResponse.json();

        expect(commandPollResponse.status).toBe(200);
        expect(logs).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              event: 'agent.poll',
              requestId: 'req-agent-command-poll',
              commandCount: 1,
              commandIds: [commandPollEnvelope.data.commands[0].commandId],
              taskIds: [taskEnvelope.taskId]
            })
          ])
        );
      },
      {
        agentRoutineLogSampling: {
          sampleEvery: 3
        }
      }
    );
  });

  it('emits structured error logs with request and trace context', async () => {
    await withLoggedServer(async (baseUrl, logs) => {
      const response = await fetch(`${baseUrl}/api/v1/agents/agent-hkg-01/commands`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-structured-error',
          'Idempotency-Key': 'idem-http-structured-error',
          traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01'
        }),
        body: JSON.stringify({
          type: 'health',
          commandId: 'cmd-structured-mismatch',
          requestId: 'req-http-structured-error',
          taskId: 'task-structured-mismatch',
          agentId: 'agent-sin-01',
          seq: 92,
          issuedAt: '2026-06-02T00:00:00.000Z',
          deadlineAt: '2026-06-02T00:05:00.000Z',
          payload: {}
        })
      });

      expect(response.status).toBe(422);
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'http.request.error',
            level: 'warning',
            requestId: 'req-http-structured-error',
            traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            parentSpanId: 'bbbbbbbbbbbbbbbb',
            method: 'POST',
            path: '/api/v1/agents/agent-hkg-01/commands',
            statusCode: 422,
            errorCode: 'validation_error'
          }),
          expect.objectContaining({
            event: 'http.request.completed',
            requestId: 'req-http-structured-error',
            statusCode: 422
          })
        ])
      );
    });
  });

  it('exposes boundary, snapshot, and task creation through REST envelopes', async () => {
    await withServer(async (baseUrl) => {
      const boundaryResponse = await fetch(`${baseUrl}/api/v1/boundary`);
      const boundaryEnvelope = await boundaryResponse.json();

      expect(boundaryResponse.status).toBe(200);
      expect(boundaryEnvelope.data).toMatchObject({
        version: 'v1',
        restBasePath: '/api/v1',
        runtimeCapabilities: {
          xray: {
            supportedProtocols: ['vmess', 'vless', 'trojan', 'shadowsocks']
          },
          forwarding: {
            supportedControls: expect.arrayContaining(['listenPort', 'targetAddress', 'nftablesTrafficCounters']),
            blockedControls: ['ipRateLimitMbps', 'maxConnections', 'maxConnectionsPerIp', 'proxyProtocol']
          }
        }
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
      expect(snapshotEnvelope.data.trafficRollupCompactions).toEqual([]);
      expect(snapshotEnvelope.data.systemAlerts).toEqual(expect.any(Array));
      expect(snapshotEnvelope.data.agentLogRetentionPolicy).toMatchObject({
        maxAgeDays: 7,
        maxEventsPerAgent: 5000
      });
      expect(snapshotEnvelope.data.trafficRollupRetentionPolicy).toMatchObject({
        maxAgeDays: 62,
        maxRecordsPerScope: 200_000
      });
      expect(snapshotEnvelope.data.agentLogChunks).toEqual(expect.any(Array));
      expect(snapshotEnvelope.data.agentLogArchives).toEqual(expect.any(Array));
      expect(snapshotEnvelope.data.telegramBotSettings).toMatchObject({
        id: 'telegram-bot'
      });
      expect(snapshotEnvelope.data.telegramBindings).toEqual(expect.any(Array));
      expect(snapshotEnvelope.data.telegramNotificationPolicies).toEqual([
        expect.objectContaining({
          id: 'telegram-policy-default'
        })
      ]);
      expect(snapshotEnvelope.data.telegramNotificationDeliveries).toEqual(expect.any(Array));
      expect(snapshotEnvelope.data.auditLogs).toEqual([]);

      const agentsResponse = await fetch(`${baseUrl}/api/v1/agents`);
      const agentsEnvelope = await agentsResponse.json();
      const alertsResponse = await fetch(`${baseUrl}/api/v1/system-alerts`);
      const alertsEnvelope = await alertsResponse.json();
      const metricsResponse = await fetch(`${baseUrl}/api/v1/observability-metrics`);
      const metricsEnvelope = await metricsResponse.json();
      const agentLogRetentionResponse = await fetch(`${baseUrl}/api/v1/agent-log-retention-policy`);
      const agentLogRetentionEnvelope = await agentLogRetentionResponse.json();
      const trafficRollupRetentionResponse = await fetch(`${baseUrl}/api/v1/traffic-rollup-retention-policy`);
      const trafficRollupRetentionEnvelope = await trafficRollupRetentionResponse.json();
      const trafficRollupCompactionsResponse = await fetch(`${baseUrl}/api/v1/traffic-rollup-compactions`);
      const trafficRollupCompactionsEnvelope = await trafficRollupCompactionsResponse.json();
      const prometheusMetricsResponse = await fetch(`${baseUrl}/metrics`);
      const prometheusMetricsText = await prometheusMetricsResponse.text();
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
      expect(agentLogRetentionResponse.status).toBe(200);
      expect(agentLogRetentionEnvelope.data).toMatchObject({
        maxAgeDays: 7,
        maxEventsPerAgent: 5000,
        source: 'runtime-config'
      });
      expect(trafficRollupRetentionResponse.status).toBe(200);
      expect(trafficRollupRetentionEnvelope.data).toMatchObject({
        maxAgeDays: 62,
        maxRecordsPerScope: 200_000,
        source: 'runtime-config'
      });
      expect(trafficRollupCompactionsResponse.status).toBe(200);
      expect(trafficRollupCompactionsEnvelope.data).toEqual([]);
      expect(prometheusMetricsResponse.status).toBe(200);
      expect(prometheusMetricsResponse.headers.get('content-type')).toContain('text/plain');
      expect(prometheusMetricsText).toContain('# HELP ou_ui_tasks_total Total number of deploy tasks.');
      expect(prometheusMetricsText).toContain('ou_ui_audit_chain_valid 1');
      expect(permissionGrantsResponse.status).toBe(200);
      expect(permissionGrantsEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'grant-bootstrap-owner-tunnel' }),
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

  it('serves the API snapshot contract without rebuilding a full traffic history in the HTTP layer', async () => {
    const api = createMockApi({ seedInventory: true });
    const getSnapshot = vi.spyOn(api, 'getSnapshot');
    const listTrafficRollups = vi.spyOn(api, 'listTrafficRollups');

    await withServerApi(api, async (baseUrl) => {
      const snapshotResponse = await fetch(`${baseUrl}/api/v1/snapshot`);
      const snapshotEnvelope = await snapshotResponse.json();

      expect(snapshotResponse.status).toBe(200);
      expect(snapshotEnvelope.data).toMatchObject({
        apiBoundary: expect.objectContaining({
          version: 'v1'
        })
      });
    });

    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(listTrafficRollups).toHaveBeenCalledTimes(1);
  });

  it('creates typed Xray client action tasks through the REST adapter', async () => {
    await withServerApi(createMockApi({ seedInventory: true }), async (baseUrl) => {
      const createInboundResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-xray-client-action-inbound',
          'Idempotency-Key': 'idem-http-xray-client-action-inbound'
        }),
        body: JSON.stringify({
          operation: 'inbound.create',
          resourceType: 'inbound',
          targetId: 'inbound-http-client-action',
          targetLabel: 'HTTP client action inbound',
          summary: 'Create inbound for HTTP client action',
          metadata: {
            nodeId: 'inbound-http-client-action',
            agentId: 'agent-hkg-01',
            customerNodeName: 'HTTP client action inbound',
            customerName: 'Acme',
            serverAddress: 'edge.example.com',
            xrayProtocol: 'vless',
            listenPort: 2447,
            streamNetwork: 'tcp',
            security: 'tls',
            sni: 'edge.example.com',
            clients: [
              {
                clientIdentity: '11111111-1111-4111-8111-111111111111',
                clientCredential: '11111111-1111-4111-8111-111111111111',
                clientEmail: 'alice@example.com',
                trafficLimitGb: 100,
                remainingDays: 180,
                enabled: true
              },
              {
                clientIdentity: '22222222-2222-4222-8222-222222222222',
                clientCredential: '22222222-2222-4222-8222-222222222222',
                clientEmail: 'bob@example.com',
                trafficLimitGb: 100,
                remainingDays: 180,
                enabled: true
              }
            ]
          }
        })
      });

      expect(createInboundResponse.status).toBe(201);
      expect(JSON.stringify(await createInboundResponse.clone().json())).not.toContain('clientCredential');

      const actionResponse = await fetch(`${baseUrl}/api/v1/xray-client-actions`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-xray-client-action-disable',
          'Idempotency-Key': 'idem-http-xray-client-action-disable'
        }),
        body: JSON.stringify({
          inboundId: 'inbound-http-client-action',
          clientEmail: 'bob@example.com',
          action: {
            kind: 'set-enabled',
            enabled: false
          }
        })
      });
      const actionEnvelope = await actionResponse.json();

      expect(actionResponse.status).toBe(202);
      expect(actionEnvelope.taskId).toBe(actionEnvelope.data.id);
      expect(actionEnvelope.data).toMatchObject({
        operation: 'inbound.update',
        targetId: 'inbound-http-client-action',
        metadata: expect.objectContaining({
          enabled: true,
          clientEmail: 'bob@example.com',
          xrayClientAction: 'set-enabled'
        })
      });
      expect(actionEnvelope.data.metadata.clients).toEqual([
        expect.objectContaining({
          clientEmail: 'alice@example.com',
          enabled: true
        }),
        expect.objectContaining({
          clientEmail: 'bob@example.com',
          enabled: false
        })
      ]);

      const addClientResponse = await fetch(`${baseUrl}/api/v1/xray-client-actions`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-xray-client-action-add',
          'Idempotency-Key': 'idem-http-xray-client-action-add'
        }),
        body: JSON.stringify({
          inboundId: 'inbound-http-client-action',
          action: {
            kind: 'add-client',
            clientIdentity: '33333333-3333-4333-8333-333333333333',
            clientCredential: '33333333-3333-4333-8333-333333333333',
            clientEmail: 'carol@example.com',
            trafficLimitGb: 50,
            remainingDays: 90,
            subscriptionRule: 'premium:carol'
          }
        })
      });
      const addClientEnvelope = await addClientResponse.json();

      expect(addClientResponse.status).toBe(202);
      expect(addClientEnvelope.data).toMatchObject({
        operation: 'inbound.update',
        targetId: 'inbound-http-client-action',
        metadata: expect.objectContaining({
          xrayReplaceClients: true,
          xrayClientAction: 'add-client',
          xrayClientActionTargetEmail: 'carol@example.com',
          subscriptionRule: 'premium:carol'
        })
      });
      expect(addClientEnvelope.data.metadata.clients).toEqual([
        expect.objectContaining({
          clientEmail: 'alice@example.com'
        }),
        expect.objectContaining({
          clientEmail: 'bob@example.com',
          enabled: false
        }),
        expect.objectContaining({
          clientEmail: 'carol@example.com',
          enabled: true,
          trafficLimitGb: 50
        })
      ]);
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

  it('updates Agent log retention policy through the REST mutation endpoint', async () => {
    await withLoggedServer(async (baseUrl, logs) => {
      const updateResponse = await fetch(`${baseUrl}/api/v1/agent-log-retention-policy`, {
        method: 'PATCH',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-agent-log-retention-update',
          'Idempotency-Key': 'idem-http-agent-log-retention-update'
        }),
        body: JSON.stringify({
          maxAgeDays: 10,
          maxEventsPerAgent: 25,
          reason: 'test retention override'
        })
      });
      const updateEnvelope = await updateResponse.json();
      const readResponse = await fetch(`${baseUrl}/api/v1/agent-log-retention-policy`);
      const readEnvelope = await readResponse.json();

      expect(updateResponse.status).toBe(200);
      expect(updateEnvelope.data).toEqual({
        maxAgeMs: 10 * 24 * 60 * 60 * 1000,
        maxAgeDays: 10,
        maxEventsPerAgent: 25,
        source: 'control-plane'
      });
      expect(readEnvelope.data).toMatchObject({
        maxAgeDays: 10,
        maxEventsPerAgent: 25,
        source: 'control-plane'
      });
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'agent.log_retention.updated',
            requestId: 'req-http-agent-log-retention-update',
            actor: 'admin',
            maxAgeDays: 10,
            maxEventsPerAgent: 25
          })
        ])
      );
    });
  });

  it('updates traffic rollup retention policy through the REST mutation endpoint', async () => {
    await withLoggedServer(async (baseUrl, logs) => {
      const updateResponse = await fetch(`${baseUrl}/api/v1/traffic-rollup-retention-policy`, {
        method: 'PATCH',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-traffic-rollup-retention-update',
          'Idempotency-Key': 'idem-http-traffic-rollup-retention-update'
        }),
        body: JSON.stringify({
          maxAgeDays: 31,
          maxRecordsPerScope: 500,
          reason: 'test traffic retention override'
        })
      });
      const updateEnvelope = await updateResponse.json();
      const readResponse = await fetch(`${baseUrl}/api/v1/traffic-rollup-retention-policy`);
      const readEnvelope = await readResponse.json();

      expect(updateResponse.status).toBe(200);
      expect(updateEnvelope.data).toEqual({
        maxAgeMs: 31 * 24 * 60 * 60 * 1000,
        maxAgeDays: 31,
        maxRecordsPerScope: 500,
        source: 'control-plane',
        runtimeDefault: {
          maxAgeMs: 62 * 24 * 60 * 60 * 1000,
          maxAgeDays: 62,
          maxRecordsPerScope: 200_000
        },
        controlPlaneOverride: {
          maxAgeMs: 31 * 24 * 60 * 60 * 1000,
          maxAgeDays: 31,
          maxRecordsPerScope: 500
        }
      });
      expect(readEnvelope.data).toMatchObject({
        maxAgeDays: 31,
        maxRecordsPerScope: 500,
        source: 'control-plane'
      });
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'traffic.rollup_retention.updated',
            requestId: 'req-http-traffic-rollup-retention-update',
            actor: 'admin',
            maxAgeDays: 31,
            maxRecordsPerScope: 500
          })
        ])
      );
    });
  });

  it('accepts Telegram webhook updates without operator CSRF headers', async () => {
    const api = createMockApi({ seedInventory: true });

    await api.updateTelegramBotSettings(
      {
        enabled: true,
        botToken: '123456:secret-token',
        webhookSecretPath: 'telegram-secret-path'
      },
      {
        actor: 'admin',
        sourceIp: '127.0.0.1',
        requestId: 'req-telegram-webhook-settings'
      }
    );
    const challenge = await api.createTelegramBindingChallenge(
      {
        customerId: 'customer-webhook-route',
        customerName: 'Webhook Route Customer',
        scopeType: 'customer'
      },
      {
        actor: 'admin',
        sourceIp: '127.0.0.1',
        requestId: 'req-telegram-webhook-challenge'
      }
    );

    await withServerApi(api, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/telegram/webhook/telegram-secret-path`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          update_id: 9001,
          message: {
            message_id: 1,
            text: `/start ${challenge.code}`,
            chat: {
              id: 999000111,
              type: 'private'
            },
            from: {
              id: 888000222,
              username: 'webhook_route'
            }
          }
        })
      });
      const envelope = await response.json();

      expect(response.status).toBe(200);
      expect(envelope.data).toMatchObject({
        accepted: true,
        action: 'binding_consumed',
        binding: expect.objectContaining({
          customerBinding: expect.objectContaining({
            customerId: 'customer-webhook-route'
          })
        })
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

      const exportResponse = await fetch(
        `${baseUrl}/api/v1/agent-log-chunks:export?agentId=agent-hkg-01&limit=10&format=json`
      );
      const exportEnvelope = await exportResponse.json();

      expect(exportResponse.status).toBe(200);
      expect(exportEnvelope.data).toMatchObject({
        format: 'json',
        contentType: 'application/json; charset=utf-8',
        count: 1,
        query: {
          agentId: 'agent-hkg-01',
          limit: 10,
          format: 'json'
        },
        chunks: [
          expect.objectContaining({
            eventId: 'evt-http-agent-log-chunk-001',
            content: 'applied port-forwarding unit ou-forward-agent-hkg-01.service'
          })
        ]
      });
      expect(exportEnvelope.data.content).toContain('"eventId": "evt-http-agent-log-chunk-001"');

      const archivesResponse = await fetch(
        `${baseUrl}/api/v1/agent-log-archives?agentId=agent-hkg-01&stream=runtime&limit=10`
      );
      const archivesEnvelope = await archivesResponse.json();

      expect(archivesResponse.status).toBe(200);
      expect(archivesEnvelope.data).toEqual([]);

      const archiveExportResponse = await fetch(
        `${baseUrl}/api/v1/agent-log-archives:export?agentId=agent-hkg-01&limit=10&format=json`
      );
      const archiveExportEnvelope = await archiveExportResponse.json();

      expect(archiveExportResponse.status).toBe(200);
      expect(archiveExportEnvelope.data).toMatchObject({
        format: 'json',
        contentType: 'application/json; charset=utf-8',
        count: 0,
        query: {
          agentId: 'agent-hkg-01',
          limit: 10,
          format: 'json'
        },
        archives: []
      });
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

  it('replays full task status history for bounded task event snapshots', async () => {
    await withServer(async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-task-history-create',
          'Idempotency-Key': 'idem-http-task-history-create'
        }),
        body: JSON.stringify({
          operation: 'subscription.import',
          resourceType: 'subscription',
          targetId: 'source-task-history',
          targetLabel: 'Task History Source',
          summary: 'Create task history source'
        })
      });
      const createEnvelope = await createResponse.json();

      expect(createResponse.status).toBe(201);

      const runningResponse = await fetch(`${baseUrl}/api/v1/tasks/${encodeURIComponent(createEnvelope.data.id)}/transition`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-task-history-running',
          'Idempotency-Key': 'idem-http-task-history-running'
        }),
        body: JSON.stringify({
          status: 'running'
        })
      });

      expect(runningResponse.status).toBe(200);

      const failedResponse = await fetch(`${baseUrl}/api/v1/tasks/${encodeURIComponent(createEnvelope.data.id)}/transition`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-task-history-failed',
          'Idempotency-Key': 'idem-http-task-history-failed'
        }),
        body: JSON.stringify({
          status: 'failed'
        })
      });

      expect(failedResponse.status).toBe(200);

      const eventsResponse = await fetch(
        `${baseUrl}/events/v1/tasks?once=1&taskId=${encodeURIComponent(createEnvelope.data.id)}`,
        {
          headers: {
            Accept: 'text/event-stream'
          }
        }
      );
      const eventStream = await eventsResponse.text();

      expect(eventsResponse.status).toBe(200);
      expect(eventStream).toContain('"status":"queued"');
      expect(eventStream).toContain('"status":"running"');
      expect(eventStream).toContain('"status":"failed"');
      expect((eventStream.match(/event: task\.status\.changed/g) ?? []).length).toBeGreaterThanOrEqual(3);
    });
  });

  it('resumes task history after task status cursors', async () => {
    await withServer(async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-task-history-cursor-create',
          'Idempotency-Key': 'idem-http-task-history-cursor-create'
        }),
        body: JSON.stringify({
          operation: 'subscription.import',
          resourceType: 'subscription',
          targetId: 'source-task-history-cursor',
          targetLabel: 'Task History Cursor Source',
          summary: 'Create task history cursor source'
        })
      });
      const createEnvelope = await createResponse.json();

      expect(createResponse.status).toBe(201);

      const runningResponse = await fetch(`${baseUrl}/api/v1/tasks/${encodeURIComponent(createEnvelope.data.id)}/transition`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-task-history-cursor-running',
          'Idempotency-Key': 'idem-http-task-history-cursor-running'
        }),
        body: JSON.stringify({
          status: 'running'
        })
      });

      expect(runningResponse.status).toBe(200);

      const initialResponse = await fetch(
        `${baseUrl}/events/v1/tasks?once=1&taskId=${encodeURIComponent(createEnvelope.data.id)}`,
        {
          headers: {
            Accept: 'text/event-stream'
          }
        }
      );
      const initialStream = await initialResponse.text();
      const cursor = /^id: (task:[^\n]+)$/m.exec(initialStream)?.[1];

      if (!cursor) {
        throw new Error('Expected task status cursor.');
      }

      const resumedResponse = await fetch(
        `${baseUrl}/events/v1/tasks?once=1&taskId=${encodeURIComponent(createEnvelope.data.id)}`,
        {
          headers: {
            Accept: 'text/event-stream',
            'Last-Event-ID': cursor
          }
        }
      );
      const resumedStream = await resumedResponse.text();

      expect(resumedResponse.status).toBe(200);
      expect(resumedStream).not.toContain('"status":"queued"');
      expect(resumedStream).toContain('"status":"running"');
      expect(resumedStream).toContain(`"cursor":"${cursor}"`);
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
        message: 'A valid operator bearer token or session cookie is required.'
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
        message: 'A valid operator bearer token or session cookie is required.'
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

  it('returns field-level validation details for blocked forwarding runtime controls', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-http-blocked-forward-control',
          'Idempotency-Key': 'idem-http-blocked-forward-control'
        }),
        body: JSON.stringify({
          operation: 'forward.apply',
          resourceType: 'forward',
          targetId: 'forward-blocked-control',
          targetLabel: 'Blocked forwarding control',
          summary: 'Apply blocked forwarding control',
          metadata: {
            name: 'Blocked forwarding control',
            listenAddress: '0.0.0.0',
            listenPort: 2443,
            targetAddress: '172.20.8.10',
            targetPort: 9443,
            protocol: 'tcp',
            entryNodeIds: ['agent-hkg-01'],
            ipRateLimitMbps: 80
          }
        })
      });
      const envelope = await response.json();

      expect(response.status).toBe(422);
      expect(envelope.error).toMatchObject({
        code: 'validation_error',
        message: expect.stringContaining(
          'metadata.ipRateLimitMbps: This port forwarding control is not supported by the current Agent runtime.'
        ),
        details: {
          issues: [
            {
              path: 'metadata.ipRateLimitMbps',
              message: expect.stringContaining('not supported by the current Agent runtime')
            }
          ]
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

      const upgradeCommandResponse = await fetch(
        `${baseUrl}/api/v1/agents/${encodeURIComponent(commandEnvelope.data.agentId)}/upgrade-command`,
        {
          method: 'POST',
          headers: mutationHeaders({
            Authorization: 'Bearer operator-token-001',
            'X-Request-Id': 'req-http-agent-upgrade-command',
            'Idempotency-Key': 'idem-http-agent-upgrade-command'
          }),
          body: JSON.stringify({
            agentId: commandEnvelope.data.agentId,
            reason: 'no_telemetry_sample'
          })
        }
      );
      const upgradeCommandEnvelope = await upgradeCommandResponse.json();

      expect(upgradeCommandResponse.status).toBe(201);
      expect(upgradeCommandEnvelope.data).toMatchObject({
        agentId: commandEnvelope.data.agentId,
        mode: 'update-runtime',
        requiresExistingRuntimeCredential: true,
        scriptUrl: 'https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/public/install/ou-agent.sh'
      });
      expect(upgradeCommandEnvelope.data.command).toContain('OU_AGENT_SUDO');
      expect(upgradeCommandEnvelope.data.command).toContain('ou-agent update');
      expect(upgradeCommandEnvelope.data.command).toContain('OU_AGENT_UPDATE_MODE=1');
      expect(JSON.stringify(upgradeCommandEnvelope.data)).not.toContain(commandEnvelope.data.installToken);
      expect(JSON.stringify(upgradeCommandEnvelope.data)).not.toContain(registerEnvelope.data.agentToken);

      const upgradeAuditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`, {
        headers: {
          Authorization: 'Bearer operator-token-001'
        }
      });
      const upgradeAuditEnvelope = await upgradeAuditResponse.json();

      expect(upgradeAuditEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'agent.upgrade_command.issued',
            operation: 'agent.upgrade',
            targetId: commandEnvelope.data.agentId,
            requestId: 'req-http-agent-upgrade-command',
            after: expect.objectContaining({
              command: expect.objectContaining({
                mode: 'update-runtime'
              }),
              runtimeCredential: expect.objectContaining({
                id: registerEnvelope.data.credentialId,
                tokenPrefix: registerEnvelope.data.tokenPrefix,
                purpose: 'runtime'
              }),
              reason: 'no_telemetry_sample'
            })
          })
        ])
      );
      expect(JSON.stringify(upgradeAuditEnvelope.data)).not.toContain(commandEnvelope.data.installToken);
      expect(JSON.stringify(upgradeAuditEnvelope.data)).not.toContain(registerEnvelope.data.agentToken);

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

      const heartbeatResponse = await fetch(`${baseUrl}/agent/v1/events`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${registerEnvelope.data.agentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          events: [
            {
              type: 'heartbeat',
              eventId: 'evt-agent-runtime-heartbeat-without-capabilities',
              agentId: commandEnvelope.data.agentId,
              seq: 1,
              sessionId: 'sess-agent-runtime-register',
              observedAt: '2026-06-02T00:00:00.000Z',
              payload: {
                version: '0.1.0-test',
                uptimeSeconds: 60,
                lastSeenCommandSeq: 0
              }
            }
          ]
        })
      });
      const agentSessionsResponse = await fetch(`${baseUrl}/api/v1/agent-sessions`, {
        headers: {
          Authorization: 'Bearer operator-token-001'
        }
      });
      const agentSessionsEnvelope = await agentSessionsResponse.json();

      expect(heartbeatResponse.status).toBe(202);
      expect(agentSessionsResponse.status).toBe(200);
      expect(agentSessionsEnvelope.data).toEqual([
        expect.objectContaining({
          agentId: commandEnvelope.data.agentId,
          sessionId: 'sess-agent-runtime-register',
          capabilities: expect.arrayContaining(['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel'])
        })
      ]);

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

      const runtimeTaskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          Authorization: 'Bearer operator-token-001',
          'X-Request-Id': 'req-http-agent-runtime-token-command',
          'Idempotency-Key': 'idem-http-agent-runtime-token-command'
        }),
        body: JSON.stringify({
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: commandEnvelope.data.agentId,
          targetLabel: 'Rotated Runtime Agent',
          summary: 'Deploy command after runtime credential rotation'
        })
      });
      const runtimeTaskEnvelope = await runtimeTaskResponse.json();

      expect(runtimeTaskResponse.status).toBe(201);

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
      const [rotatedOutboxItem] = rotatedPollEnvelope.data.commands;

      expect(rotatedPollResponse.status).toBe(200);
      expect(rotatedPollEnvelope.data).toMatchObject({
        nextPollAfterMs: expect.any(Number)
      });
      expect(rotatedOutboxItem).toMatchObject({
        taskId: runtimeTaskEnvelope.data.id,
        agentId: commandEnvelope.data.agentId,
        status: 'dispatched',
        leaseOwnerId: rotateEnvelope.data.credentialId,
        leaseSessionId: 'sess-agent-runtime-register',
        command: expect.objectContaining({
          sessionId: 'sess-agent-runtime-register'
        }),
        leasedAt: expect.any(String),
        leaseExpiresAt: expect.any(String)
      });
      expect(JSON.stringify(rotatedPollEnvelope.data)).not.toContain(rotateEnvelope.data.agentToken);

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

  it('lets authenticated Agents rotate their own runtime credentials before expiry', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const commandResponse = await fetch(`${baseUrl}/api/v1/agents/install-command`, {
        method: 'POST',
        headers: mutationHeaders({
          Authorization: 'Bearer operator-token-001',
          'X-Request-Id': 'req-http-agent-self-rotate-install',
          'Idempotency-Key': 'idem-http-agent-self-rotate-install'
        }),
        body: JSON.stringify({
          installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel'],
          publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
        })
      });
      const commandEnvelope = await commandResponse.json();
      const registerResponse = await fetch(`${baseUrl}/agent/v1/register`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${commandEnvelope.data.installToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId: commandEnvelope.data.agentId,
          requestId: 'req-agent-self-rotate-register',
          sessionId: 'sess-agent-self-rotate',
          version: '0.1.0-test',
          platform: 'linux-x64',
          capabilities: ['host-agent', 'telemetry', 'command-channel']
        })
      });
      const registerEnvelope = await registerResponse.json();
      const selfRotateResponse = await fetch(`${baseUrl}/agent/v1/credentials/rotate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${registerEnvelope.data.agentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId: commandEnvelope.data.agentId,
          requestId: 'req-agent-self-rotate-runtime',
          sessionId: 'sess-agent-self-rotate',
          reason: 'agent.runtime_credential_renewal'
        })
      });
      const selfRotateEnvelope = await selfRotateResponse.json();

      expect(registerResponse.status).toBe(201);
      expect(selfRotateResponse.status).toBe(201);
      expect(selfRotateEnvelope.data).toEqual(
        expect.objectContaining({
          agentId: commandEnvelope.data.agentId,
          agentToken: expect.stringMatching(/^oat_/),
          credentialId: expect.any(String),
          sessionId: 'sess-agent-self-rotate'
        })
      );
      expect(selfRotateEnvelope.data.credentialId).not.toBe(registerEnvelope.data.credentialId);
      expect(selfRotateEnvelope.data.agentToken).not.toBe(registerEnvelope.data.agentToken);

      const oldTokenPollResponse = await fetch(`${baseUrl}/agent/v1/poll`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${registerEnvelope.data.agentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId: commandEnvelope.data.agentId,
          requestId: 'req-agent-self-rotate-old-token-poll',
          sessionId: 'sess-agent-self-rotate',
          lastSeenCommandSeq: 0
        })
      });
      const rotatedPollResponse = await fetch(`${baseUrl}/agent/v1/poll`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${selfRotateEnvelope.data.agentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId: commandEnvelope.data.agentId,
          requestId: 'req-agent-self-rotate-new-token-poll',
          sessionId: 'sess-agent-self-rotate',
          lastSeenCommandSeq: 0
        })
      });
      const rotatedPollEnvelope = await rotatedPollResponse.json();
      const mismatchRotateResponse = await fetch(`${baseUrl}/agent/v1/credentials/rotate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${selfRotateEnvelope.data.agentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId: commandEnvelope.data.agentId,
          requestId: 'req-agent-self-rotate-session-mismatch',
          sessionId: 'sess-agent-self-rotate-mismatch'
        })
      });
      const mismatchRotateEnvelope = await mismatchRotateResponse.json();
      const auditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`, {
        headers: {
          Authorization: 'Bearer operator-token-001'
        }
      });
      const auditEnvelope = await auditResponse.json();

      expect(oldTokenPollResponse.status).toBe(401);
      expect(rotatedPollResponse.status).toBe(200);
      expect(rotatedPollEnvelope.data).toMatchObject({
        commands: [],
        nextPollAfterMs: expect.any(Number)
      });
      expect(JSON.stringify(rotatedPollEnvelope.data)).not.toContain(selfRotateEnvelope.data.agentToken);
      expect(mismatchRotateResponse.status).toBe(403);
      expect(mismatchRotateEnvelope.error).toMatchObject({
        code: 'identity.mismatch'
      });
      expect(auditEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'audit.denied',
            operation: 'agent.credential.rotate',
            requestId: 'req-agent-self-rotate-session-mismatch'
          })
        ])
      );
    });
  });

  it('audits Agent registration attempts that omit the install token', async () => {
    await withAuthenticatedServer(async (baseUrl) => {
      const commandResponse = await fetch(`${baseUrl}/api/v1/agents/install-command`, {
        method: 'POST',
        headers: mutationHeaders({
          Authorization: 'Bearer operator-token-001',
          'X-Request-Id': 'req-http-register-denied-install-command',
          'Idempotency-Key': 'idem-http-register-denied-install-command'
        }),
        body: JSON.stringify({
          installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
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
          requestId: 'req-http-agent-register-missing-token',
          sessionId: 'sess-http-agent-register-missing-token',
          version: '0.1.0-test',
          platform: 'linux-x64',
          capabilities: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
        })
      });
      const registerEnvelope = await registerResponse.json();

      expect(registerResponse.status).toBe(401);
      expect(registerEnvelope.error).toMatchObject({
        code: 'unauthorized'
      });

      const auditResponse = await fetch(`${baseUrl}/api/v1/audit-logs`, {
        headers: {
          Authorization: 'Bearer operator-token-001'
        }
      });
      const auditEnvelope = await auditResponse.json();

      expect(auditEnvelope.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'audit.denied',
            operation: 'agent.credential.issue',
            targetId: commandEnvelope.data.agentId,
            requestId: 'req-http-agent-register-missing-token',
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
            realityPrivateKey: 'public-sub-reality-private-key',
            realityShortId: 'abcd1234',
            trafficLimitGb: 500,
            currentUsedTrafficGb: 12,
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

      const portalResponse = await fetch(`${baseUrl}/portal/x7K2mP9vL4qR1wDz/sub_public_acme`, {
        headers: {
          'X-Forwarded-Host': 'panel.example.com',
          'X-Forwarded-Proto': 'https'
        }
      });
      const portal = await portalResponse.text();

      expect(portalResponse.status).toBe(200);
      expect(portalResponse.headers.get('content-type')).toContain('text/html');
      expect(portalResponse.headers.get('cache-control')).toBe('no-store');
      expect(portal).toContain('Public Client Subscription');
      expect(portal).toContain('OU-UI Next subscription portal');
      expect(portal).toContain('500.00 GB');
      expect(portal).toContain('12.00 GB');
      expect(portal).toContain('Generated Nodes');
      expect(portal).toContain('Access Status');
      expect(portal).toContain('Active');
      expect(portal).toContain('href="/sub/x7K2mP9vL4qR1wDz/uri/sub_public_acme"');
      expect(portal).toContain('data-format="clash"');
      expect(portal).toContain('data-format="sing-box"');
      expect(portal).toContain('data-format-qr="uri"');
      expect(portal).toContain('data-format-qr="clash"');
      expect(portal).toContain('data-format-qr="sing-box"');
      expect(portal).toContain('data-qr-href="https://panel.example.com/sub/x7K2mP9vL4qR1wDz/uri/sub_public_acme"');
      expect(portal).toContain('<svg');
      expect(portal).not.toContain('/mihomo/sub_public_acme');

      const uriResponse = await fetch(`${baseUrl}/sub/x7K2mP9vL4qR1wDz/uri/sub_public_acme`);
      const uri = await uriResponse.text();

      expect(uriResponse.status).toBe(200);
      expect(uriResponse.headers.get('content-type')).toContain('text/plain');
      expect(uriResponse.headers.get('subscription-userinfo')).toContain(`total=${500 * 1024 * 1024 * 1024}`);
      expect(uriResponse.headers.get('subscription-userinfo')).toContain(`download=${12 * 1024 * 1024 * 1024}`);
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

      const wrongPortalResponse = await fetch(`${baseUrl}/portal/wrongSecurePath000/sub_public_acme`);
      expect(wrongPortalResponse.status).toBe(404);

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

  it('blocks public subscription downloads when subscription-user quota is exhausted and restores them after reset', async () => {
    await withServerApi(createMockApi(), async (baseUrl) => {
      const createInboundResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-public-sub-quota-inbound',
          'Idempotency-Key': 'idem-public-sub-quota-inbound'
        }),
        body: JSON.stringify({
          operation: 'inbound.create',
          resourceType: 'inbound',
          targetId: 'inbound-public-sub-quota',
          targetLabel: 'Quota Limited VLESS',
          summary: 'Create quota limited public subscription inbound',
          metadata: {
            nodeId: 'inbound-public-sub-quota',
            agentId: 'agent-public-sub-quota',
            customerNodeName: 'Quota Limited VLESS',
            customerName: 'Quota Customer',
            serverAddress: 'quota-sub.example.com',
            xrayProtocol: 'vless',
            listenPort: 2443,
            clientIdentity: '33333333-3333-4333-8333-333333333333',
            clientEmail: 'quota@example.com',
            clientCredential: '33333333-3333-4333-8333-333333333333',
            security: 'reality',
            sni: 'quota-sub.example.com',
            realityPublicKey: 'quota-public-key',
            realityPrivateKey: 'quota-private-key',
            realityShortId: 'bcda1234',
            trafficLimitGb: 500,
            currentUsedTrafficGb: 2,
            remainingDays: 365,
            subscriptionRule: 'premium'
          }
        })
      });
      const createClientResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-public-sub-quota-client',
          'Idempotency-Key': 'idem-public-sub-quota-client'
        }),
        body: JSON.stringify({
          operation: 'subscription.generate',
          resourceType: 'subscription',
          targetId: 'sub-client-public-quota',
          targetLabel: 'Quota Limited Subscription',
          summary: 'Create quota limited subscription client',
          metadata: {
            subscriptionClientId: 'sub-client-public-quota',
            customerName: 'Quota Customer',
            displayName: 'Quota Limited Subscription',
            subId: 'sub_public_quota',
            email: 'quota@example.com',
            protocol: 'vless',
            group: 'premium',
            trafficLimitGb: 1,
            remainingDays: 365,
            selectedTags: ['premium'],
            outputFormats: ['uri'],
            formats: ['plain'],
            securePathPreview: '/quotaResetPublicPath',
            generatedNodeCount: 1
          }
        })
      });

      expect(createInboundResponse.status).toBe(201);
      expect(createClientResponse.status).toBe(201);

      const blockedResponse = await fetch(`${baseUrl}/sub/quotaResetPublicPath/uri/sub_public_quota`);
      const blockedEnvelope = await blockedResponse.json();

      expect(blockedResponse.status).toBe(403);
      expect(blockedEnvelope.error).toMatchObject({
        code: 'subscription.quota_exceeded',
        details: expect.objectContaining({
          clientId: 'sub-client-public-quota',
          usedTrafficBytes: 2 * 1024 ** 3,
          trafficLimitBytes: 1024 ** 3,
          guardrailReason: 'subscription_client_quota_exceeded'
        })
      });

      const resetResponse = await fetch(
        `${baseUrl}/api/v1/quota-policies/${encodeURIComponent('user:sub-client-public-quota')}/reset`,
        {
          method: 'POST',
          headers: mutationHeaders({
            'X-Request-Id': 'req-public-sub-quota-reset',
            'Idempotency-Key': 'idem-public-sub-quota-reset'
          })
        }
      );

      expect(resetResponse.status).toBe(202);

      const restoredResponse = await fetch(`${baseUrl}/sub/quotaResetPublicPath/uri/sub_public_quota`);
      const restoredBody = await restoredResponse.text();

      expect(restoredResponse.status).toBe(200);
      expect(restoredResponse.headers.get('subscription-userinfo')).toContain('download=0');
      expect(restoredBody).toContain('vless://33333333-3333-4333-8333-333333333333@quota-sub.example.com:2443');
    });
  });

  it('blocks public subscription downloads and portal when runtime access is disabled by policy', async () => {
    await withServerApi(createMockApi(), async (baseUrl) => {
      const createClientResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-public-sub-runtime-disabled-client',
          'Idempotency-Key': 'idem-public-sub-runtime-disabled-client'
        }),
        body: JSON.stringify({
          operation: 'subscription.generate',
          resourceType: 'subscription',
          targetId: 'sub-client-runtime-disabled',
          targetLabel: 'Runtime Disabled Subscription',
          summary: 'Create runtime disabled subscription client',
          metadata: {
            subscriptionClientId: 'sub-client-runtime-disabled',
            customerName: 'Policy Customer',
            displayName: 'Runtime Disabled Subscription',
            subId: 'sub_public_runtime_disabled',
            email: 'policy@example.com',
            protocol: 'vless',
            group: 'premium',
            trafficLimitGb: 500,
            usedTrafficGb: 1,
            remainingDays: 365,
            selectedTags: ['premium'],
            outputFormats: ['uri'],
            formats: ['plain'],
            securePathPreview: '/runtimeDisabledPublicPath',
            generatedNodeCount: 0,
            runtimeDisabledByPolicy: true,
            guardrailReason: 'manual_subscription_suspend'
          }
        })
      });

      expect(createClientResponse.status).toBe(201);

      const blockedResponse = await fetch(`${baseUrl}/sub/runtimeDisabledPublicPath/uri/sub_public_runtime_disabled`);
      const blockedEnvelope = await blockedResponse.json();
      const blockedPortalResponse = await fetch(`${baseUrl}/portal/runtimeDisabledPublicPath/sub_public_runtime_disabled`);
      const blockedPortalEnvelope = await blockedPortalResponse.json();

      expect(blockedResponse.status).toBe(403);
      expect(blockedEnvelope.error).toMatchObject({
        code: 'subscription.runtime_disabled',
        details: expect.objectContaining({
          clientId: 'sub-client-runtime-disabled',
          usedTrafficBytes: 1024 ** 3,
          trafficLimitBytes: 500 * 1024 ** 3,
          guardrailReason: 'manual_subscription_suspend'
        })
      });
      expect(blockedPortalResponse.status).toBe(403);
      expect(blockedPortalEnvelope.error).toMatchObject({
        code: 'subscription.runtime_disabled',
        details: expect.objectContaining({
          clientId: 'sub-client-runtime-disabled',
          guardrailReason: 'manual_subscription_suspend'
        })
      });
    });
  });

  it('requires matching access token hash for protected public subscription links and portal', async () => {
    await withServerApi(createMockApi(), async (baseUrl) => {
      const rawToken = 'ou_raw_subscription_token_2026';
      const createClientResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-public-sub-token-client',
          'Idempotency-Key': 'idem-public-sub-token-client'
        }),
        body: JSON.stringify({
          operation: 'subscription.generate',
          resourceType: 'subscription',
          targetId: 'sub-client-token-protected',
          targetLabel: 'Token Protected Subscription',
          summary: 'Create token protected subscription client',
          metadata: {
            subscriptionClientId: 'sub-client-token-protected',
            customerName: 'Token Customer',
            displayName: 'Token Protected Subscription',
            subId: 'sub_token_protected',
            email: 'token@example.com',
            protocol: 'vless',
            group: 'premium',
            remainingDays: 30,
            outputFormats: ['uri', 'clash'],
            formats: ['plain', 'clash'],
            accessTokenPreview: 'ou_raw...2026',
            accessTokenHash: subscriptionAccessTokenHash(rawToken),
            securePathPreview: '/tokenProtectedPath2026',
            generatedNodeCount: 0
          }
        })
      });

      expect(createClientResponse.status).toBe(201);

      const missingTokenResponse = await fetch(`${baseUrl}/sub/tokenProtectedPath2026/uri/sub_token_protected`);
      const missingTokenEnvelope = await missingTokenResponse.json();
      const wrongTokenResponse = await fetch(`${baseUrl}/sub/tokenProtectedPath2026/uri/sub_token_protected?token=wrong`);
      const wrongTokenEnvelope = await wrongTokenResponse.json();
      const queryTokenResponse = await fetch(
        `${baseUrl}/sub/tokenProtectedPath2026/uri/sub_token_protected?token=${encodeURIComponent(rawToken)}`
      );
      const bearerTokenResponse = await fetch(`${baseUrl}/sub/tokenProtectedPath2026/clash/sub_token_protected`, {
        headers: {
          Authorization: `Bearer ${rawToken}`
        }
      });
      const portalResponse = await fetch(
        `${baseUrl}/portal/tokenProtectedPath2026/sub_token_protected?token=${encodeURIComponent(rawToken)}`
      );
      const portal = await portalResponse.text();
      const snapshotResponse = await fetch(`${baseUrl}/api/v1/snapshot`);
      const snapshotEnvelope = await snapshotResponse.json();

      expect(missingTokenResponse.status).toBe(401);
      expect(missingTokenEnvelope.error).toMatchObject({
        code: 'unauthorized',
        details: expect.objectContaining({
          tokenRequired: true
        })
      });
      expect(wrongTokenResponse.status).toBe(401);
      expect(wrongTokenEnvelope.error).toMatchObject({
        code: 'unauthorized',
        details: expect.objectContaining({
          tokenRequired: true
        })
      });
      expect(queryTokenResponse.status).toBe(200);
      expect(bearerTokenResponse.status).toBe(200);
      expect(portalResponse.status).toBe(200);
      expect(portal).toContain(
        `href="/sub/tokenProtectedPath2026/uri/sub_token_protected?token=${encodeURIComponent(rawToken)}"`
      );
      expect(portal).toMatch(
        new RegExp(
          `data-qr-href="http://127\\.0\\.0\\.1:\\d+/sub/tokenProtectedPath2026/uri/sub_token_protected\\?token=${encodeURIComponent(rawToken)}"`
        )
      );
      expect(JSON.stringify(snapshotEnvelope.data)).not.toContain('accessTokenHash');
      expect(JSON.stringify(snapshotEnvelope.data)).not.toContain(subscriptionAccessTokenHash(rawToken));
    });
  });

  it('hashes raw subscription access tokens before task persistence', async () => {
    await withServerApi(createMockApi(), async (baseUrl) => {
      const rawToken = 'ou_one_time_raw_token_2026';
      const createClientResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-public-sub-raw-token-client',
          'Idempotency-Key': 'idem-public-sub-raw-token-client'
        }),
        body: JSON.stringify({
          operation: 'subscription.generate',
          resourceType: 'subscription',
          targetId: 'sub-client-raw-token',
          targetLabel: 'Raw Token Subscription',
          summary: 'Create raw token subscription client',
          metadata: {
            subscriptionClientId: 'sub-client-raw-token',
            customerName: 'Raw Token Customer',
            displayName: 'Raw Token Subscription',
            subId: 'sub_raw_token',
            email: 'raw-token@example.com',
            protocol: 'vless',
            group: 'premium',
            remainingDays: 30,
            outputFormats: ['uri'],
            formats: ['plain'],
            accessTokenPreview: 'ou_one...2026',
            accessTokenRaw: rawToken,
            securePathPreview: '/rawTokenProtectedPath2026',
            generatedNodeCount: 0
          }
        })
      });
      const createClientEnvelope = await createClientResponse.json();
      const missingTokenResponse = await fetch(`${baseUrl}/sub/rawTokenProtectedPath2026/uri/sub_raw_token`);
      const tokenResponse = await fetch(
        `${baseUrl}/sub/rawTokenProtectedPath2026/uri/sub_raw_token?token=${encodeURIComponent(rawToken)}`
      );
      const snapshotResponse = await fetch(`${baseUrl}/api/v1/snapshot`);
      const snapshotEnvelope = await snapshotResponse.json();

      expect(createClientResponse.status).toBe(201);
      expect(JSON.stringify(createClientEnvelope.data)).not.toContain(rawToken);
      expect(JSON.stringify(createClientEnvelope.data)).not.toContain('accessTokenRaw');
      expect(missingTokenResponse.status).toBe(401);
      expect(tokenResponse.status).toBe(200);
      expect(JSON.stringify(snapshotEnvelope.data)).not.toContain(rawToken);
      expect(JSON.stringify(snapshotEnvelope.data)).not.toContain('accessTokenRaw');
      expect(JSON.stringify(snapshotEnvelope.data)).not.toContain(subscriptionAccessTokenHash(rawToken));
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

  it('counts public subscription portal visits against the same subscription request limit', async () => {
    await withServerApi(createMockApi(), async (baseUrl) => {
      const createClientResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders({
          'X-Request-Id': 'req-public-sub-portal-rate-limit-client',
          'Idempotency-Key': 'idem-public-sub-portal-rate-limit-client'
        }),
        body: JSON.stringify({
          operation: 'subscription.generate',
          resourceType: 'subscription',
          targetId: 'sub-client-portal-rate-limited',
          targetLabel: 'Portal Rate Limited Subscription',
          summary: 'Create portal rate limited subscription client',
          metadata: {
            subscriptionClientId: 'sub-client-portal-rate-limited',
            customerName: 'Portal Limited Customer',
            displayName: 'Portal Rate Limited Subscription',
            subId: 'sub_portal_rate_limited',
            email: 'portal-limited@example.com',
            protocol: 'vless',
            group: 'premium',
            remainingDays: 30,
            outputFormats: ['uri'],
            formats: ['plain'],
            securePathPreview: '/pL7mN2pQ9sT4vW8xY1zA3bC5',
            requestLimitPerHour: 1,
            generatedNodeCount: 0
          }
        })
      });

      expect(createClientResponse.status).toBe(201);

      const portalResponse = await fetch(`${baseUrl}/portal/pL7mN2pQ9sT4vW8xY1zA3bC5/sub_portal_rate_limited`);
      const downloadResponse = await fetch(`${baseUrl}/sub/pL7mN2pQ9sT4vW8xY1zA3bC5/uri/sub_portal_rate_limited`);
      const downloadEnvelope = await downloadResponse.json();

      expect(portalResponse.status).toBe(200);
      expect(downloadResponse.status).toBe(429);
      expect(downloadEnvelope.error).toMatchObject({
        code: 'subscription.rate_limited',
        details: expect.objectContaining({
          clientId: 'sub-client-portal-rate-limited',
          requestLimitPerHour: 1,
          format: 'uri'
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
        leaseOwnerId: 'agent-hkg-01',
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

      const auditLogsResponse = await fetch(`${baseUrl}/api/v1/audit-logs`);
      const auditLogsEnvelope = await auditLogsResponse.json();
      const exportedVerificationResponse = await fetch(`${baseUrl}/api/v1/audit-logs:verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          auditLogs: auditLogsEnvelope.data
        })
      });
      const exportedVerificationEnvelope = await exportedVerificationResponse.json();

      expect(exportedVerificationResponse.status).toBe(200);
      expect(exportedVerificationEnvelope.data).toMatchObject({
        valid: true,
        checked: auditLogsEnvelope.data.length
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

  it('continues batch Agent event ingest after a stale event conflict', async () => {
    const api = createMockApi({ seedInventory: true });
    const receivedEventIds: string[] = [];
    api.receiveAgentEvent = async (event) => {
      receivedEventIds.push(event.eventId);

      if (event.eventId === 'evt-http-stale-replay') {
        throw new Error('agent_event.sequence_replay');
      }

      return undefined;
    };

    await withServerApi(api, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/agent/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          events: [
            {
              type: 'result',
              eventId: 'evt-http-stale-replay',
              commandId: 'cmd-http-stale-replay',
              taskId: 'task-http-stale-replay',
              agentId: 'agent-hkg-01',
              seq: 9,
              sessionId: 'sess-http-stale-replay',
              observedAt: '2026-06-02T00:06:00.000Z',
              payload: {
                status: 'succeeded'
              }
            },
            {
              type: 'heartbeat',
              eventId: 'evt-http-fresh-heartbeat',
              agentId: 'agent-hkg-01',
              seq: 10,
              sessionId: 'sess-http-stale-replay',
              observedAt: '2026-06-02T00:06:01.000Z',
              payload: {
                version: '1.0.0'
              }
            }
          ]
        })
      });
      const envelope = await response.json();

      expect(response.status).toBe(202);
      expect(envelope.data).toEqual({
        accepted: 1,
        rejected: 1
      });
      expect(receivedEventIds).toEqual(['evt-http-stale-replay', 'evt-http-fresh-heartbeat']);
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
