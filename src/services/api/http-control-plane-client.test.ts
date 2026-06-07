import { vi } from 'vitest';

import { createMockApi } from '../mock/mock-api';
import { createHttpControlPlaneClient } from './http-control-plane-client';
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

const mutationContext = {
  actor: 'admin',
  operatorGroupId: 'owner',
  resourceGroupId: 'group-premium',
  sourceIp: '203.0.113.10',
  userAgent: 'vitest-http-client',
  requestId: 'req-http-client-task-001',
  idempotencyKey: 'idem-http-client-task-001'
};

function expectAsciiHeaderValue(value: string | null) {
  expect(value).toEqual(expect.any(String));
  expect(value).toMatch(/^[\x20-\x7e]*$/);
}

describe('HTTP control-plane client', () => {
  it('sends CSRF headers for operator mutations without adding them to Agent registration', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'task-csrf-client',
              status: 'queued'
            },
            requestId: 'req-http-client-csrf-task'
          }),
          {
            status: 201,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              agentId: 'agent-hkg-01',
              agentToken: 'agent-runtime-token',
              credentialId: 'credential-agent-hkg-01',
              tokenPrefix: 'agent...',
              issuedAt: '2026-06-05T00:00:00.000Z',
              expiresAt: '2026-07-05T00:00:00.000Z'
            },
            requestId: 'req-http-client-agent-register'
          }),
          {
            status: 201,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        )
      );
    const api = createHttpControlPlaneClient({
      baseUrl: 'https://panel.example',
      getCsrfToken: () => 'csrf-client-token',
      fetcher
    });

    await api.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A HKG Gateway',
        summary: 'Deploy with CSRF header'
      },
      mutationContext
    );
    await api.registerAgent(
      {
        agentId: 'agent-hkg-01',
        requestId: 'req-http-client-agent-register',
        sessionId: 'session-hkg-01'
      },
      'install-token'
    );

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'https://panel.example/api/v1/tasks',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf-client-token'
        })
      })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://panel.example/agent/v1/register',
      expect.objectContaining({
        headers: expect.not.objectContaining({
          'X-CSRF-Token': expect.any(String)
        })
      })
    );
  });

  it('keeps Unicode mutation payloads out of fetch headers while preserving the JSON body', async () => {
    let body: unknown;
    let firstRequestId = '';
    let firstIdempotencyKey = '';
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      body = await request.json();

      firstRequestId = request.headers.get('x-request-id') ?? '';
      firstIdempotencyKey = request.headers.get('idempotency-key') ?? '';

      for (const headerName of [
        'x-actor',
        'x-operator-group-id',
        'x-resource-group-id',
        'x-request-id',
        'x-forwarded-for',
        'user-agent',
        'idempotency-key',
        'if-match'
      ]) {
        expectAsciiHeaderValue(request.headers.get(headerName));
      }

      return new Response(
        JSON.stringify({
          data: {
            id: 'task-unicode-header-safe',
            status: 'queued'
          },
          requestId: 'req-http-client-unicode-safe'
        }),
        {
          status: 201,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }) as typeof fetch;
    const api = createHttpControlPlaneClient({
      baseUrl: 'https://panel.example',
      fetcher
    });

    await api.createTask(
      {
        operation: 'inbound.create',
        resourceType: 'inbound',
        targetId: 'inbound-customer-zhangsan',
        targetLabel: '客户节点-张三',
        summary: '提交中文任务标题',
        metadata: {
          customerName: '张三客户',
          displayName: '香港入口-张三'
        }
      },
      {
        actor: '操作员 张三',
        operatorGroupId: '运维组',
        resourceGroupId: '资源组甲',
        sourceIp: 'ui-预览',
        userAgent: 'OU 控制台',
        requestId: '请求-中文-001',
        idempotencyKey: '幂等-张三客户-001',
        ifMatch: '版本-甲'
      }
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({
      targetLabel: '客户节点-张三',
      summary: '提交中文任务标题',
      metadata: {
        customerName: '张三客户',
        displayName: '香港入口-张三'
      }
    });
    expect(firstRequestId).not.toContain('请求');
    expect(firstIdempotencyKey).not.toContain('幂等');
  });

  it('uses stable ASCII mutation headers for repeated Unicode contexts', async () => {
    const observedHeaders: Array<{ requestId: string; idempotencyKey: string; actor: string }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      observedHeaders.push({
        requestId: request.headers.get('x-request-id') ?? '',
        idempotencyKey: request.headers.get('idempotency-key') ?? '',
        actor: request.headers.get('x-actor') ?? ''
      });

      return new Response(
        JSON.stringify({
          data: {
            id: `task-unicode-stable-${observedHeaders.length}`,
            status: 'queued'
          },
          requestId: `req-http-client-unicode-stable-${observedHeaders.length}`
        }),
        {
          status: 201,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }) as typeof fetch;
    const api = createHttpControlPlaneClient({
      baseUrl: 'https://panel.example',
      fetcher
    });
    const unicodeContext = {
      actor: '操作员 张三',
      operatorGroupId: '运维组',
      resourceGroupId: '资源组甲',
      sourceIp: 'ui-预览',
      requestId: '请求-中文-001',
      idempotencyKey: '幂等-张三客户-001'
    };

    await api.createTask(
      {
        operation: 'subscription.generate',
        resourceType: 'subscription',
        targetId: 'sub-client-zhangsan',
        targetLabel: '张三订阅',
        summary: '生成中文订阅'
      },
      unicodeContext
    );
    await api.createTask(
      {
        operation: 'subscription.generate',
        resourceType: 'subscription',
        targetId: 'sub-client-zhangsan',
        targetLabel: '张三订阅',
        summary: '生成中文订阅'
      },
      unicodeContext
    );

    expect(observedHeaders).toHaveLength(2);
    expect(observedHeaders[0]).toEqual(observedHeaders[1]);
    expect(observedHeaders[0]?.actor).not.toContain('操作员');
    expect(observedHeaders[0]?.requestId).toMatch(/^[\x20-\x7e]+$/);
    expect(observedHeaders[0]?.idempotencyKey).toMatch(/^[\x20-\x7e]+$/);
  });

  it('lists and revokes operator sessions through the HTTP client adapter', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'operator-session-current-001',
                username: 'operator_001',
                actor: 'operator:alice',
                status: 'active',
                issuedAt: '2026-06-05T00:00:00.000Z',
                expiresAt: '2026-06-05T08:00:00.000Z',
                sourceIp: '203.0.113.10',
                requestId: 'req-http-client-session-list'
              }
            ],
            requestId: 'req-http-client-session-list'
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'operator-session-current-001',
              username: 'operator_001',
              actor: 'operator:alice',
              status: 'revoked',
              issuedAt: '2026-06-05T00:00:00.000Z',
              expiresAt: '2026-06-05T08:00:00.000Z',
              sourceIp: '203.0.113.10',
              requestId: 'req-http-client-session-list',
              revokedAt: '2026-06-05T00:10:00.000Z',
              revokedBy: 'operator:alice',
              revokedReason: 'security rotation'
            },
            requestId: 'req-http-client-session-revoke'
          }),
          {
            status: 202,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        )
      );
    const api = createHttpControlPlaneClient({
      baseUrl: 'https://panel.example',
      getCsrfToken: () => 'csrf-client-token',
      fetcher
    });

    await expect(api.listOperatorSessions()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'operator-session-current-001',
          status: 'active'
        })
      ])
    );
    await expect(
      api.revokeOperatorSession(
        'operator-session-current-001',
        {
          reason: 'security rotation'
        },
        mutationContext
      )
    ).resolves.toMatchObject({
      id: 'operator-session-current-001',
      status: 'revoked',
      revokedReason: 'security rotation'
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://panel.example/api/v1/operator-sessions/operator-session-current-001/revoke',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf-client-token'
        })
      })
    );
  });

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
      await expect(api.listCustomers()).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'Acme Team' })])
      );
      await expect(api.listNodes()).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'node-hkg-edge-01' })])
      );
      await expect(api.listPermissionGrants()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'grant-bootstrap-owner-tunnel' }),
          expect.objectContaining({ id: 'grant-owner-group-tunnel' })
        ])
      );
      await expect(api.listTrafficRollups()).resolves.toEqual([]);
      await expect(api.listSystemAlerts()).resolves.toEqual(expect.any(Array));
      await expect(api.getAgentLogRetentionPolicy()).resolves.toMatchObject({
        maxAgeDays: 7,
        maxEventsPerAgent: 5000,
        source: 'runtime-config'
      });
      await expect(api.getTrafficRollupRetentionPolicy()).resolves.toMatchObject({
        maxAgeDays: 62,
        maxRecordsPerScope: 200_000,
        source: 'runtime-config'
      });
      await expect(api.listAuditLogs()).resolves.toEqual([]);
    });
  });

  it('implements Telegram notification endpoints against REST envelopes', async () => {
    await withServer(async (baseUrl) => {
      const api = createHttpControlPlaneClient({ baseUrl });

      await expect(api.getTelegramBotSettings()).resolves.toMatchObject({
        id: 'telegram-bot',
        enabled: false,
        botTokenSet: false
      });
      const settings = await api.updateTelegramBotSettings(
        {
          enabled: true,
          botToken: '123456:secret-token',
          adminChatIds: ['999000111'],
          reason: 'enable telegram'
        },
        mutationContext
      );

      expect(settings).toMatchObject({
        enabled: true,
        botTokenSet: true
      });
      expect(JSON.stringify(settings)).not.toContain('secret-token');

      const binding = await api.createTelegramBinding(
        {
          telegramChatId: '999000111',
          telegramUserId: '888000222',
          customerId: 'customer-acme',
          customerName: 'Acme Team',
          scopeType: 'customer'
        },
        mutationContext
      );
      const challenge = await api.createTelegramBindingChallenge(
        {
          customerId: 'customer-acme',
          customerName: 'Acme Team',
          scopeType: 'customer',
          expiresInSeconds: 120
        },
        mutationContext
      );
      const policy = await api.updateTelegramNotificationPolicy(
        'telegram-policy-default',
        {
          allowSubscriptionLinks: true,
          maxMessagesPerHour: 3,
          reason: 'test policy'
        },
        mutationContext
      );
      const delivery = await api.testTelegramBotNotification(
        {
          target: {
            kind: 'admin-chat',
            chatId: '999000111'
          },
          language: 'en'
        },
        mutationContext
      );
      const pollResult = await api.pollTelegramBotUpdates(mutationContext);
      const retriedDelivery = await api.retryTelegramNotificationDelivery(delivery.id, mutationContext);
      const revoked = await api.revokeTelegramBinding(
        binding.id,
        {
          reason: 'cleanup'
        },
        mutationContext
      );

      await expect(api.listTelegramBindings()).resolves.toEqual([
        expect.objectContaining({
          id: binding.id,
          customerBinding: expect.objectContaining({
            status: 'revoked'
          })
        })
      ]);
      await expect(api.listTelegramBindingChallenges()).resolves.toEqual([
        expect.objectContaining({
          id: challenge.challenge.id,
          codePreview: expect.stringMatching(/^OU-/)
        })
      ]);
      await expect(api.listTelegramNotificationPolicies()).resolves.toEqual([
        expect.objectContaining({
          id: policy.id,
          allowSubscriptionLinks: true,
          maxMessagesPerHour: 3
        })
      ]);
      await expect(api.listTelegramNotificationDeliveries()).resolves.toEqual([
        expect.objectContaining({
          id: delivery.id,
          status: retriedDelivery.status
        })
      ]);
      expect(pollResult).toMatchObject({
        fetchedCount: 0,
        handledCount: 0,
        errors: []
      });
      expect(revoked.customerBinding).toMatchObject({
        status: 'revoked',
        revokeReason: 'cleanup'
      });
    });
  });

  it('updates Agent log retention policy through REST envelopes', async () => {
    await withServer(async (baseUrl) => {
      const api = createHttpControlPlaneClient({ baseUrl });

      await expect(
        api.updateAgentLogRetentionPolicy(
          {
            maxAgeDays: 21,
            maxEventsPerAgent: 42,
            reason: 'client retention update'
          },
          mutationContext
        )
      ).resolves.toEqual({
        maxAgeMs: 21 * 24 * 60 * 60 * 1000,
        maxAgeDays: 21,
        maxEventsPerAgent: 42,
        source: 'control-plane'
      });
      await expect(api.getAgentLogRetentionPolicy()).resolves.toMatchObject({
        maxAgeDays: 21,
        maxEventsPerAgent: 42,
        source: 'control-plane'
      });
    });
  });

  it('updates traffic rollup retention policy through REST envelopes', async () => {
    await withServer(async (baseUrl) => {
      const api = createHttpControlPlaneClient({ baseUrl });

      await expect(
        api.updateTrafficRollupRetentionPolicy(
          {
            maxAgeDays: 31,
            maxRecordsPerScope: 250,
            reason: 'client traffic retention update'
          },
          mutationContext
        )
      ).resolves.toEqual({
        maxAgeMs: 31 * 24 * 60 * 60 * 1000,
        maxAgeDays: 31,
        maxRecordsPerScope: 250,
        source: 'control-plane',
        runtimeDefault: {
          maxAgeMs: 62 * 24 * 60 * 60 * 1000,
          maxAgeDays: 62,
          maxRecordsPerScope: 200_000
        },
        controlPlaneOverride: {
          maxAgeMs: 31 * 24 * 60 * 60 * 1000,
          maxAgeDays: 31,
          maxRecordsPerScope: 250
        }
      });
      await expect(api.getTrafficRollupRetentionPolicy()).resolves.toMatchObject({
        maxAgeDays: 31,
        maxRecordsPerScope: 250,
        source: 'control-plane'
      });
    });
  });

  it('requests Agent log chunks with bounded diagnostic query parameters', async () => {
    const requestedUrls: string[] = [];
    const api = createHttpControlPlaneClient({
      baseUrl: 'https://panel.example.com/root/',
      fetcher: (async (input) => {
        requestedUrls.push(String(input));
        return new Response(
          JSON.stringify({
            data: [],
            requestId: 'req-http-client-agent-log-chunks'
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
      }) as typeof fetch
    });

    await expect(
      api.listAgentLogChunks({
        agentId: 'agent-hkg-01',
        taskId: 'task-agent-log-01',
        commandId: 'cmd-agent-log-01',
        since: '2026-06-04T06:00:00.000Z',
        limit: 50
      })
    ).resolves.toEqual([]);
    await expect(
      api.exportAgentLogChunks({
        agentId: 'agent-hkg-01',
        limit: 1000,
        format: 'jsonl'
      })
    ).resolves.toEqual([]);

    expect(requestedUrls).toEqual([
      'https://panel.example.com/root/api/v1/agent-log-chunks?agentId=agent-hkg-01&taskId=task-agent-log-01&commandId=cmd-agent-log-01&since=2026-06-04T06%3A00%3A00.000Z&limit=50',
      'https://panel.example.com/root/api/v1/agent-log-chunks:export?agentId=agent-hkg-01&limit=1000&format=jsonl'
    ]);
  });

  it('requests Agent log archives with bounded diagnostic query parameters', async () => {
    const requestedUrls: string[] = [];
    const api = createHttpControlPlaneClient({
      baseUrl: 'https://panel.example.com/root/',
      fetcher: (async (input) => {
        requestedUrls.push(String(input));
        return new Response(
          JSON.stringify({
            data: [],
            requestId: 'req-http-client-agent-log-archives'
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
      }) as typeof fetch
    });

    await expect(
      api.listAgentLogArchives({
        agentId: 'agent-hkg-01',
        taskId: 'task-agent-log-01',
        commandId: 'cmd-agent-log-01',
        stream: 'stderr',
        since: '2026-06-04T00:00:00.000Z',
        until: '2026-06-05T00:00:00.000Z',
        limit: 25
      })
    ).resolves.toEqual([]);
    await expect(
      api.exportAgentLogArchives({
        agentId: 'agent-hkg-01',
        limit: 1000,
        format: 'jsonl'
      })
    ).resolves.toEqual([]);

    expect(requestedUrls).toEqual([
      'https://panel.example.com/root/api/v1/agent-log-archives?agentId=agent-hkg-01&taskId=task-agent-log-01&commandId=cmd-agent-log-01&stream=stderr&since=2026-06-04T00%3A00%3A00.000Z&until=2026-06-05T00%3A00%3A00.000Z&limit=25',
      'https://panel.example.com/root/api/v1/agent-log-archives:export?agentId=agent-hkg-01&limit=1000&format=jsonl'
    ]);
  });

  it('requests traffic rollups with bounded diagnostic query parameters', async () => {
    const requestedUrls: string[] = [];
    const api = createHttpControlPlaneClient({
      baseUrl: 'https://panel.example.com/root/',
      fetcher: (async (input) => {
        requestedUrls.push(String(input));
        return new Response(
          JSON.stringify({
            data: [],
            requestId: 'req-http-client-traffic-rollups'
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
      }) as typeof fetch
    });

    await expect(
      api.listTrafficRollups({
        dimension: 'forward-rule',
        agentId: 'agent-hkg-01',
        subjectId: 'forward-hkg-443',
        since: '2026-06-04T06:00:00.000Z',
        until: '2026-06-04T07:00:00.000Z',
        limit: 50
      })
    ).resolves.toEqual([]);
    await expect(
      api.exportTrafficRollups({
        dimension: 'forward-rule',
        agentId: 'agent-hkg-01',
        limit: 1000,
        format: 'json'
      })
    ).resolves.toEqual([]);

    expect(requestedUrls).toEqual([
      'https://panel.example.com/root/api/v1/traffic-rollups?dimension=forward-rule&agentId=agent-hkg-01&subjectId=forward-hkg-443&since=2026-06-04T06%3A00%3A00.000Z&until=2026-06-04T07%3A00%3A00.000Z&limit=50',
      'https://panel.example.com/root/api/v1/traffic-rollups:export?dimension=forward-rule&agentId=agent-hkg-01&limit=1000&format=json'
    ]);
  });

  it('requests traffic rollup compactions with bounded diagnostic query parameters', async () => {
    const requestedUrls: string[] = [];
    const api = createHttpControlPlaneClient({
      baseUrl: 'https://panel.example.com/root/',
      fetcher: (async (input) => {
        requestedUrls.push(String(input));
        return new Response(
          JSON.stringify({
            data: [],
            requestId: 'req-http-client-traffic-rollup-compactions'
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
      }) as typeof fetch
    });

    await expect(
      api.listTrafficRollupCompactions({
        dimension: 'agent',
        agentId: 'agent-hkg-01',
        subjectId: 'agent-hkg-01',
        periodKey: '2026-06-reset-01',
        since: '2026-06-01T00:00:00.000Z',
        until: '2026-06-30T00:00:00.000Z',
        limit: 25
      })
    ).resolves.toEqual([]);
    await expect(
      api.exportTrafficRollupCompactions({
        dimension: 'agent',
        agentId: 'agent-hkg-01',
        periodKey: '2026-06-reset-01',
        limit: 100,
        format: 'jsonl'
      })
    ).resolves.toEqual([]);

    expect(requestedUrls).toEqual([
      'https://panel.example.com/root/api/v1/traffic-rollup-compactions?dimension=agent&agentId=agent-hkg-01&subjectId=agent-hkg-01&periodKey=2026-06-reset-01&since=2026-06-01T00%3A00%3A00.000Z&until=2026-06-30T00%3A00%3A00.000Z&limit=25',
      'https://panel.example.com/root/api/v1/traffic-rollup-compactions:export?dimension=agent&agentId=agent-hkg-01&periodKey=2026-06-reset-01&limit=100&format=jsonl'
    ]);
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
      await expect(api.listAgentCredentials()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: registration.credentialId,
            status: 'active',
            tokenPrefix: expect.stringMatching(/^oat_/)
          }),
          expect.objectContaining({
            agentId: command.agentId,
            purpose: 'install',
            status: 'revoked',
            replacedByCredentialId: registration.credentialId
          })
        ])
      );

      const upgradeCommand = await api.createAgentUpgradeCommand(
        {
          agentId: command.agentId,
          reason: 'no_telemetry_sample'
        },
        {
          ...mutationContext,
          requestId: 'req-http-client-agent-upgrade-command',
          idempotencyKey: 'idem-http-client-agent-upgrade-command'
        }
      );

      expect(upgradeCommand).toMatchObject({
        agentId: command.agentId,
        mode: 'update-runtime',
        requiresExistingRuntimeCredential: true,
        scriptUrl: 'https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/public/install/ou-agent.sh'
      });
      expect(upgradeCommand.command).toContain('OU_AGENT_SUDO');
      expect(upgradeCommand.command).toContain('ou-agent update');
      expect(upgradeCommand.command).toContain('OU_AGENT_UPDATE_MODE=1');
      expect(JSON.stringify(upgradeCommand)).not.toContain(command.installToken);
      expect(JSON.stringify(upgradeCommand)).not.toContain(registration.agentToken);

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
      await expect(api.listAgentCredentials()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: rotated.credentialId,
            status: 'active'
          }),
          expect.objectContaining({
            id: registration.credentialId,
            status: 'revoked',
            replacedByCredentialId: rotated.credentialId
          }),
          expect.objectContaining({
            agentId: command.agentId,
            purpose: 'install',
            status: 'revoked',
            replacedByCredentialId: registration.credentialId
          })
        ])
      );
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

  it('verifies exported audit logs through the HTTP client', async () => {
    await withServer(async (baseUrl) => {
      const api = createHttpControlPlaneClient({ baseUrl });

      await api.createTask(
        {
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-hkg-01',
          targetLabel: 'Agent-A HKG Gateway',
          summary: 'Deploy HTTP client Agent config for audit export'
        },
        mutationContext
      );

      const auditLogs = await api.listAuditLogs();

      await expect(api.verifyAuditLogChain(auditLogs)).resolves.toMatchObject({
        valid: true,
        checked: auditLogs.length
      });

      const tamperedAuditLogs = auditLogs.map((log, index) =>
        index === 0
          ? {
              ...log,
              message: 'Tampered exported audit log'
            }
          : log
      );

      await expect(api.verifyAuditLogChain(tamperedAuditLogs)).resolves.toMatchObject({
        valid: false,
        brokenAt: auditLogs[0]?.id,
        reason: 'hash.mismatch'
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
        leaseOwnerId: 'agent-hkg-01',
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
