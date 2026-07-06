// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AGENT_INSTALL_PROFILE, type PermissionGrant, type SubscriptionClientIdentity } from '../../domain';
import { seedForwardRules, seedPermissionGrants } from '../../services/mock/mock-data';
import { createControlPlaneTestClock } from '../../test/control-plane-clock';
import { createFileControlPlaneAuditAnchorSink, type ControlPlaneAuditAnchorSink } from './audit-anchor-sink';
import { createFileControlPlaneArchiveSink, type ControlPlaneArchiveSink } from './archive-sink';
import { createServiceBackedControlPlane } from './create-service-backed-control-plane';

async function withControlPlane<T>(run: (baseUrl: string) => Promise<T>) {
  const { server } = await createServiceBackedControlPlane();

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Service-backed control plane did not bind to a TCP port');
  }

  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function waitFor<T>(read: () => Promise<T>, predicate: (value: T) => boolean, label: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = await read();

    if (predicate(value)) {
      return value;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out waiting for ${label}`);
}

async function postJson(baseUrl: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  const url = new URL(path, baseUrl);

  return await new Promise<{ status: number; json: () => Promise<{ data: unknown }> }>((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode ?? 0,
            json: async () => JSON.parse(text)
          });
        });
      }
    );

    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
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
  initial = '',
  timeoutMs = 2000
) {
  const decoder = new TextDecoder();
  let output = initial;

  while (!output.includes(expected)) {
    const chunk = await withTimeout(reader.read(), expected, timeoutMs);

    if (chunk.done) {
      throw new Error(`Stream ended before ${expected}`);
    }

    output += decoder.decode(chunk.value, { stream: true });
  }

  return output;
}

const mutationContext = {
  actor: 'admin',
  operatorGroupId: 'owner',
  resourceGroupId: 'group-premium',
  sourceIp: '127.0.0.1',
  requestId: 'req-background-timeout-sweep',
  idempotencyKey: 'idem-background-timeout-sweep'
};

describe('createServiceBackedControlPlane', () => {
  it('starts a service-backed HTTP control plane with empty durable state and empty production inventory', async () => {
    await withControlPlane(async (baseUrl) => {
      const boundaryResponse = await fetch(`${baseUrl}/api/v1/boundary`);
      const boundaryEnvelope = await boundaryResponse.json();
      const snapshotResponse = await fetch(`${baseUrl}/api/v1/snapshot`);
      const snapshotEnvelope = await snapshotResponse.json();

      expect(boundaryResponse.status).toBe(200);
      expect(boundaryEnvelope.data).toMatchObject({
        version: 'v1',
        restBasePath: '/api/v1'
      });
      expect(snapshotResponse.status).toBe(200);
      expect(snapshotEnvelope.data).toMatchObject({
        tasks: [],
        auditLogs: [],
        agents: [],
        nodes: []
      });
    });
  });

  it('runs the configured background command timeout sweep job', async () => {
    const controlPlane = await createServiceBackedControlPlane({
      seed: {
        permissionGrants: seedPermissionGrants
      },
      now: createControlPlaneTestClock(),
      commandTimeoutSweep: {
        enabled: true,
        intervalMs: 10,
        now: () => '2026-06-02T00:06:00.000Z'
      }
    });

    try {
      const task = await controlPlane.service.createTask(
        {
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-hkg-01',
          targetLabel: 'Agent HKG 01',
          summary: 'Background sweep should expire this command'
        },
        mutationContext
      );
      const tasks = await waitFor(
        () => controlPlane.repository.listTasks(),
        (items) => items.some((item) => item.id === task.id && item.status === 'failed'),
        'background command timeout sweep'
      );

      expect(tasks).toEqual([
        expect.objectContaining({
          id: task.id,
          status: 'failed',
          failureReason: 'command.deadline.expired'
        })
      ]);
      await expect(controlPlane.repository.listCommandOutbox()).resolves.toEqual([
        expect.objectContaining({
          taskId: task.id,
          status: 'expired',
          lastError: 'command.deadline.expired'
        })
      ]);
      await expect(controlPlane.repository.listAuditLogs()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            taskId: task.id,
            action: 'task.failed',
            result: 'failed',
            after: expect.objectContaining({
              failureReason: 'command.deadline.expired'
            })
          })
        ])
      );
    } finally {
      controlPlane.stopBackgroundJobs();
    }
  });

  it('runs the configured background system alert notification retry job', async () => {
    const systemAlertNotifier = {
      notify: vi.fn(async () => {
        if (systemAlertNotifier.notify.mock.calls.length === 1) {
          throw new Error('temporary webhook failure');
        }
      })
    };
    const controlPlane = await createServiceBackedControlPlane({
      systemAlertNotifier,
      systemAlertNotificationRetry: {
        retryDelayMs: 1,
        maxAttempts: 3,
        maxDeliveriesPerSweep: 5
      },
      systemAlertNotificationRetryJob: {
        enabled: true,
        intervalMs: 10,
        maxDeliveries: 5,
        now: () => '2026-06-04T05:06:01.000Z'
      },
      readModelNow: () => '2026-06-04T05:06:00.000Z',
      inventory: {
        agents: []
      }
    });

    try {
      await controlPlane.api.receiveAgentEvent({
        type: 'telemetry_sample',
        eventId: 'evt-background-alert-notification-retry',
        agentId: 'agent-background-alert-notification-retry-01',
        seq: 1,
        sessionId: 'sess-background-alert-notification-retry-01',
        observedAt: '2026-06-04T05:06:00.000Z',
        payload: {
          reportedAt: '2026-06-04T05:06:00.000Z',
          runtimeServices: [
            {
              name: 'ou-ui-xray.service',
              moduleKind: 'xray',
              status: 'missing',
              enabled: false,
              required: true,
              checkedAt: '2026-06-04T05:06:00.000Z'
            }
          ]
        }
      });
      await expect(controlPlane.api.listSystemAlerts()).resolves.toHaveLength(1);

      const deliveries = await waitFor(
        () => controlPlane.repository.listSystemAlertNotificationDeliveries(),
        (items) => items.some((item) => item.status === 'delivered' && item.attemptCount === 2),
        'background system alert notification retry'
      );

      expect(systemAlertNotifier.notify).toHaveBeenCalledTimes(2);
      expect(deliveries).toEqual([
        expect.objectContaining({
          status: 'delivered',
          attemptCount: 2,
          deliveredAt: '2026-06-04T05:06:01.000Z'
        })
      ]);
    } finally {
      controlPlane.stopBackgroundJobs();
    }
  });

  it('runs the configured background Telegram long-polling job', async () => {
    const getUpdatesBodies: unknown[] = [];
    const sendMessageBodies: unknown[] = [];
    let challengeCode = '';
    let updateSent = false;
    const fetcher = vi.fn(async (input, init) => {
      const url = String(input);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;

      if (url.endsWith('/getUpdates')) {
        getUpdatesBodies.push(body);

        return new Response(
          JSON.stringify({
            ok: true,
            result:
              challengeCode && !updateSent
                ? [
                    {
                      update_id: 1200,
                      message: {
                        message_id: 1,
                        text: `/start ${challengeCode}`,
                        chat: {
                          id: 999000111,
                          type: 'private'
                        },
                        from: {
                          id: 888000222,
                          username: 'background_poll_user'
                        }
                      }
                    }
                  ]
                : []
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
      }

      updateSent = true;
      sendMessageBodies.push(body);

      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            message_id: 1201
          }
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }) as typeof fetch;
    const controlPlane = await createServiceBackedControlPlane({
      fetcher,
      readModelNow: () => '2026-06-05T10:15:00.000Z',
      telegramLongPollingJob: {
        enabled: true,
        intervalMs: 10
      }
    });

    try {
      await controlPlane.api.updateTelegramBotSettings(
        {
          enabled: true,
          mode: 'long_polling',
          botToken: '123456:secret-token',
          customApiBaseUrl: 'https://telegram.example',
          allowedUpdates: ['message']
        },
        {
          ...mutationContext,
          requestId: 'req-background-telegram-settings',
          idempotencyKey: 'idem-background-telegram-settings'
        }
      );
      const challenge = await controlPlane.api.createTelegramBindingChallenge(
        {
          customerId: 'customer-background-poll',
          customerName: 'Background Poll Customer',
          scopeType: 'customer'
        },
        {
          ...mutationContext,
          requestId: 'req-background-telegram-challenge',
          idempotencyKey: 'idem-background-telegram-challenge'
        }
      );
      challengeCode = challenge.code;

      const bindings = await waitFor(
        () => controlPlane.api.listTelegramBindings(),
        (items) => items.some((item) => item.customerBinding.customerId === 'customer-background-poll'),
        'background Telegram long-polling'
      );

      expect(bindings).toEqual([
        expect.objectContaining({
          customerBinding: expect.objectContaining({
            customerId: 'customer-background-poll',
            status: 'active'
          }),
          chat: expect.objectContaining({
            status: 'active'
          })
        })
      ]);
      expect(getUpdatesBodies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            allowed_updates: ['message'],
            timeout: 0
          })
        ])
      );
      expect(sendMessageBodies).toEqual([
        expect.objectContaining({
          chat_id: '999000111',
          text: 'Telegram 已绑定到 Background Poll Customer。'
        })
      ]);
    } finally {
      controlPlane.stopBackgroundJobs();
    }
  });

  it('runs the configured background Telegram delivery retry job', async () => {
    const sendMessageBodies: unknown[] = [];
    const fetcher = vi.fn(async (_input, init) => {
      sendMessageBodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : undefined);

      if (sendMessageBodies.length === 2) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 1302
            }
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
      }

      return new Response(
        JSON.stringify({
          ok: false,
          description: 'temporary Telegram delivery failure',
          parameters: {
            retry_after: 1
          }
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }) as typeof fetch;
    const sweeps: unknown[] = [];
    const controlPlane = await createServiceBackedControlPlane({
      fetcher,
      readModelNow: () => '2026-06-05T10:15:00.000Z',
      telegramNotificationDeliveryRetryJob: {
        enabled: true,
        intervalMs: 10,
        now: () => '2026-06-05T10:15:01.000Z',
        onSweep: (result) => sweeps.push(result)
      }
    });

    try {
      await controlPlane.api.updateTelegramBotSettings(
        {
          enabled: true,
          botToken: '123456:secret-token',
          retry: {
            maxAttempts: 2,
            initialDelayMs: 1000,
            maxDeliveriesPerSweep: 5
          }
        },
        {
          ...mutationContext,
          requestId: 'req-background-telegram-retry-settings',
          idempotencyKey: 'idem-background-telegram-retry-settings'
        }
      );
      const delivery = await controlPlane.api.testTelegramBotNotification(
        {
          target: {
            kind: 'admin-chat',
            chatId: '999000111'
          }
        },
        {
          ...mutationContext,
          requestId: 'req-background-telegram-retry-create',
          idempotencyKey: 'idem-background-telegram-retry-create'
        }
      );
      expect(delivery).toMatchObject({
        status: 'failed',
        nextAttemptAt: '2026-06-05T10:15:01.000Z'
      });

      const deliveries = await waitFor(
        () => controlPlane.repository.listTelegramNotificationDeliveries(),
        (items) => items.some((item) => item.id === delivery.id && item.status === 'delivered' && item.attemptCount === 2),
        'background Telegram delivery retry'
      );

      expect(deliveries).toEqual([
        expect.objectContaining({
          id: delivery.id,
          status: 'delivered',
          attemptCount: 2,
          deliveredAt: '2026-06-05T10:15:01.000Z'
        })
      ]);
      expect(sendMessageBodies).toEqual([
        expect.objectContaining({
          chat_id: '999000111'
        }),
        expect.objectContaining({
          chat_id: '999000111'
        })
      ]);
      expect(sweeps).toEqual(
        expect.arrayContaining([
          {
            attempted: 1,
            delivered: 1,
            failed: 0,
            deadLettered: 0
          }
        ])
      );
    } finally {
      controlPlane.stopBackgroundJobs();
    }
  });

  it('runs the configured background Telegram notification schedule scan job', async () => {
    const now = '2026-06-05T10:15:00.000Z';
    const subscriptionClient: SubscriptionClientIdentity = {
      id: 'sub-client-background-telegram-scan',
      customerName: 'Background Scan Customer',
      displayName: 'Background Scan Subscription',
      subId: 'sub_background_telegram_scan',
      email: 'background-scan@example.com',
      enabled: true,
      protocol: 'vless',
      group: 'premium',
      trafficLimitBytes: 12 * 1024 ** 3,
      usedTrafficBytes: 11 * 1024 ** 3,
      expiresAt: '2026-06-08T10:15:00.000Z',
      ipLimit: 2,
      requestLimitPerHour: 360,
      sourceIds: ['source-background-scan'],
      selectedTags: ['premium'],
      includeFilter: '',
      excludeFilter: '',
      regionFilter: [],
      routingRule: 'tag:premium',
      maxLatencyMs: 0,
      sortStrategy: 'latency',
      formats: ['plain'],
      outputFormats: ['uri'],
      templateName: 'mihomo-compatible.yaml',
      accessTokenPreview: 'sub_background_telegram_scan',
      generatedNodeCount: 1,
      lastGeneratedAt: now
    };
    const scans: unknown[] = [];
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 1501 } }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      })
    ) as typeof fetch;
    const controlPlane = await createServiceBackedControlPlane({
      fetcher,
      readModelNow: () => now,
      inventory: {
        subscriptionClients: [subscriptionClient]
      },
      telegramNotificationScheduleScanJob: {
        enabled: true,
        intervalMs: 10,
        now: () => now,
        maxDeliveries: 5,
        onScan: (result) => scans.push(result)
      }
    });

    try {
      await controlPlane.api.updateTelegramBotSettings(
        {
          enabled: true,
          botToken: '123456:secret-token'
        },
        {
          ...mutationContext,
          requestId: 'req-background-telegram-schedule-settings',
          idempotencyKey: 'idem-background-telegram-schedule-settings'
        }
      );
      const binding = await controlPlane.api.createTelegramBinding(
        {
          telegramChatId: '999000111',
          telegramUserId: '888000222',
          customerId: 'customer-background-telegram-scan',
          customerName: 'Background Scan Customer',
          scopeType: 'subscription-user',
          scopeId: subscriptionClient.id,
          scopeLabel: subscriptionClient.displayName
        },
        {
          ...mutationContext,
          requestId: 'req-background-telegram-schedule-binding',
          idempotencyKey: 'idem-background-telegram-schedule-binding'
        }
      );

      const deliveries = await waitFor(
        () => controlPlane.repository.listTelegramNotificationDeliveries(),
        (items) =>
          items.some((item) => item.customerBindingId === binding.id && item.notificationType === 'traffic.threshold')
          && items.some((item) => item.customerBindingId === binding.id && item.notificationType === 'subscription.expiring')
          && items.some((item) => item.customerBindingId === binding.id && item.notificationType === 'subscription.updated'),
        'background Telegram notification schedule scan'
      );

      expect(deliveries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            customerBindingId: binding.id,
            notificationType: 'traffic.threshold',
            status: 'pending'
          }),
          expect.objectContaining({
            customerBindingId: binding.id,
            notificationType: 'subscription.expiring',
            status: 'pending'
          }),
          expect.objectContaining({
            customerBindingId: binding.id,
            notificationType: 'subscription.updated',
            status: 'pending'
          })
        ])
      );
      expect(fetcher).not.toHaveBeenCalled();
      expect(scans).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            scannedBindings: 1,
            enqueuedDeliveries: 3,
            trafficThresholdDeliveries: 1,
            expiryReminderDeliveries: 1,
            subscriptionUpdatedDeliveries: 1
          })
        ])
      );
    } finally {
      controlPlane.stopBackgroundJobs();
    }
  });

  it('writes retention-produced log and traffic archives to the configured external archive sink', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-external-archive-'));
    const controlPlane = await createServiceBackedControlPlane({
      seed: {
        permissionGrants: seedPermissionGrants
      },
      now: createControlPlaneTestClock(),
      agentLogRetention: {
        maxAgeMs: 60_000,
        maxEventsPerAgent: 1
      },
      trafficRollupRetention: {
        maxAgeMs: 60_000,
        maxRecordsPerScope: 1
      },
      archiveSink: createFileControlPlaneArchiveSink({ directory }),
      inventory: {
        agents: []
      }
    });

    try {
      const task = await controlPlane.service.createTask(
        {
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-archive-log-01',
          targetLabel: 'Agent Archive Log 01',
          summary: 'Create external archive sink evidence'
        },
        mutationContext
      );
      const [outboxItem] = await controlPlane.repository.listCommandOutbox();

      for (const index of [0, 1]) {
        await controlPlane.api.receiveAgentEvent({
          type: 'log_chunk',
          eventId: `evt-external-archive-log-${index + 1}`,
          commandId: outboxItem.commandId,
          taskId: task.id,
          agentId: outboxItem.agentId,
          seq: outboxItem.seq + index + 1,
          sessionId: 'sess-external-archive-log',
          observedAt: new Date(Date.parse('2026-06-02T00:01:00.000Z') + index * 1000).toISOString(),
          payload: {
            chunkSeq: index + 1,
            stream: 'stderr',
            content: `external archive log chunk ${index + 1}`
          }
        });
      }

      for (const index of [0, 4]) {
        await controlPlane.api.receiveAgentEvent({
          type: 'telemetry_sample',
          eventId: `evt-external-archive-traffic-${index + 1}`,
          agentId: 'agent-archive-traffic-01',
          seq: index + 1,
          sessionId: 'sess-external-archive-traffic',
          observedAt: new Date(Date.parse('2026-06-02T00:02:00.000Z') + index * 1000).toISOString(),
          payload: {
            monthlyResetDay: 1,
            monthlyIngressBytes: 1024 * (index + 1),
            monthlyEgressBytes: 2048 * (index + 1),
            trafficBillingPeriod: '2026-06-reset-01'
          }
        });
      }

      const agentLogArchiveLines = (await readFile(join(directory, 'agent-log-archives.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { kind: string; record: { eventId?: string; chunkCount?: number } });
      const trafficArchiveLines = (await readFile(join(directory, 'traffic-rollup-compactions.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { kind: string; record: { sampleCount?: number; meteredBytesTotal?: number } });

      expect(agentLogArchiveLines).toEqual([
        expect.objectContaining({
          kind: 'agent-log-archive',
          record: expect.objectContaining({
            chunkCount: 1
          })
        })
      ]);
      expect(trafficArchiveLines).toEqual([
        expect.objectContaining({
          kind: 'traffic-rollup-compaction',
          record: expect.objectContaining({
            sampleCount: 1,
            meteredBytesTotal: 3072
          })
        })
      ]);
    } finally {
      controlPlane.stopBackgroundJobs();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('surfaces external archive sink failures through runtime metrics and HTTP alerts', async () => {
    const failingArchiveSink: ControlPlaneArchiveSink = {
      writeAgentLogArchives: vi.fn(async () => {
        throw new Error('external archive target unavailable');
      }),
      writeTrafficRollupCompactions: vi.fn(async () => undefined)
    };
    const onArchiveSinkError = vi.fn();
    const controlPlane = await createServiceBackedControlPlane({
      seed: {
        permissionGrants: seedPermissionGrants
      },
      now: createControlPlaneTestClock(),
      agentLogRetention: {
        maxAgeMs: 60_000,
        maxEventsPerAgent: 1
      },
      archiveSink: failingArchiveSink,
      onArchiveSinkError,
      inventory: {
        agents: []
      }
    });

    await new Promise<void>((resolve) => {
      controlPlane.server.listen(0, '127.0.0.1', resolve);
    });

    const address = controlPlane.server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Service-backed control plane did not bind to a TCP port');
    }

    try {
      const task = await controlPlane.service.createTask(
        {
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-archive-failure-01',
          targetLabel: 'Agent Archive Failure 01',
          summary: 'Create failing external archive evidence'
        },
        {
          ...mutationContext,
          requestId: 'req-external-archive-failure',
          idempotencyKey: 'idem-external-archive-failure'
        }
      );
      const [outboxItem] = await controlPlane.repository.listCommandOutbox();

      for (const index of [0, 1]) {
        await controlPlane.api.receiveAgentEvent({
          type: 'log_chunk',
          eventId: `evt-external-archive-failure-log-${index + 1}`,
          commandId: outboxItem.commandId,
          taskId: task.id,
          agentId: outboxItem.agentId,
          seq: outboxItem.seq + index + 1,
          sessionId: 'sess-external-archive-failure-log',
          observedAt: new Date(Date.parse('2026-06-02T00:01:00.000Z') + index * 1000).toISOString(),
          payload: {
            chunkSeq: index + 1,
            stream: 'stderr',
            content: `external archive failure log chunk ${index + 1}`
          }
        });
      }

      expect(failingArchiveSink.writeAgentLogArchives).toHaveBeenCalledTimes(1);
      expect(onArchiveSinkError).toHaveBeenCalledTimes(1);
      expect(controlPlane.runtimeMetrics).toMatchObject({
        externalArchiveSinkFailures: 1,
        externalArchiveFailedRecords: 1,
        firstExternalArchiveSinkFailureAt: '2026-06-02T00:01:01.000Z',
        lastExternalArchiveSinkFailureAt: '2026-06-02T00:01:01.000Z',
        lastExternalArchiveSinkFailureKind: 'agent-log-archive'
      });

      const baseUrl = `http://127.0.0.1:${address.port}`;
      const alertsResponse = await fetch(`${baseUrl}/api/v1/system-alerts`);
      const alertsEnvelope = await alertsResponse.json();
      const metricsResponse = await fetch(`${baseUrl}/api/v1/observability-metrics`);
      const metricsEnvelope = await metricsResponse.json();

      expect(alertsResponse.status).toBe(200);
      expect(alertsEnvelope.data).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'external_archive.sink_failed',
          severity: 'critical',
          resourceType: 'external_archive',
          resourceId: 'external-archive-sink',
          observedAt: '2026-06-02T00:01:01.000Z',
          metadata: expect.objectContaining({
            sinkFailures: 1,
            failedRecords: 1,
            firstFailureAt: '2026-06-02T00:01:01.000Z',
            lastFailureAt: '2026-06-02T00:01:01.000Z',
            lastFailureKind: 'agent-log-archive'
          })
        })
      ]));
      expect(metricsResponse.status).toBe(200);
      expect(metricsEnvelope.data).toMatchObject({
        externalArchive: {
          sinkFailures: 1,
          failedRecords: 1
        },
        systemAlerts: {
          byKind: expect.objectContaining({
            'external_archive.sink_failed': 1
          })
        }
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        controlPlane.server.close((error) => (error ? reject(error) : resolve()));
      });
      controlPlane.stopBackgroundJobs();
    }
  });

  it('writes committed audit hash anchors to the configured external audit anchor sink', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-audit-anchor-control-plane-'));
    const controlPlane = await createServiceBackedControlPlane({
      seed: {
        permissionGrants: seedPermissionGrants
      },
      now: createControlPlaneTestClock(),
      auditAnchorSink: createFileControlPlaneAuditAnchorSink({ directory }),
      inventory: {
        agents: []
      }
    });

    try {
      const task = await controlPlane.service.createTask(
        {
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-audit-anchor-01',
          targetLabel: 'Agent Audit Anchor 01',
          summary: 'Create audit anchor evidence'
        },
        {
          ...mutationContext,
          requestId: 'req-audit-anchor-control-plane',
          idempotencyKey: 'idem-audit-anchor-control-plane'
        }
      );
      const [line] = (await readFile(join(directory, 'audit-anchors.jsonl'), 'utf8')).trim().split('\n');
      const envelope = JSON.parse(line) as { audit: { hash: string; requestId: string; taskId: string } };

      expect(envelope).toMatchObject({
        schemaVersion: 'ou-ui-next.audit-anchor.v1',
        audit: {
          taskId: task.id,
          requestId: 'req-audit-anchor-control-plane',
          hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
        }
      });
    } finally {
      controlPlane.stopBackgroundJobs();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('surfaces audit anchor sink failures through runtime metrics and HTTP alerts', async () => {
    const failingAuditAnchorSink: ControlPlaneAuditAnchorSink = {
      writeAuditAnchors: vi.fn(async () => {
        throw new Error('audit anchor target unavailable');
      })
    };
    const onAuditAnchorSinkError = vi.fn();
    const controlPlane = await createServiceBackedControlPlane({
      seed: {
        permissionGrants: seedPermissionGrants
      },
      now: () => '2026-06-02T00:02:30.000Z',
      auditAnchorSink: failingAuditAnchorSink,
      onAuditAnchorSinkError,
      inventory: {
        agents: []
      }
    });

    await new Promise<void>((resolve) => {
      controlPlane.server.listen(0, '127.0.0.1', resolve);
    });

    const address = controlPlane.server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Service-backed control plane did not bind to a TCP port');
    }

    try {
      await controlPlane.service.createTask(
        {
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-audit-anchor-failure-01',
          targetLabel: 'Agent Audit Anchor Failure 01',
          summary: 'Create failing audit anchor evidence'
        },
        {
          ...mutationContext,
          requestId: 'req-audit-anchor-failure',
          idempotencyKey: 'idem-audit-anchor-failure'
        }
      );

      expect(failingAuditAnchorSink.writeAuditAnchors).toHaveBeenCalledTimes(1);
      expect(onAuditAnchorSinkError).toHaveBeenCalledTimes(1);
      expect(controlPlane.runtimeMetrics).toMatchObject({
        externalArchiveSinkFailures: 1,
        externalArchiveFailedRecords: 1,
        firstExternalArchiveSinkFailureAt: '2026-06-02T00:02:30.000Z',
        lastExternalArchiveSinkFailureAt: '2026-06-02T00:02:30.000Z',
        lastExternalArchiveSinkFailureKind: 'audit-anchor'
      });

      const baseUrl = `http://127.0.0.1:${address.port}`;
      const alertsResponse = await fetch(`${baseUrl}/api/v1/system-alerts`);
      const alertsEnvelope = await alertsResponse.json();
      const metricsResponse = await fetch(`${baseUrl}/api/v1/observability-metrics`);
      const metricsEnvelope = await metricsResponse.json();

      expect(alertsResponse.status).toBe(200);
      expect(alertsEnvelope.data).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'external_archive.sink_failed',
          severity: 'critical',
          resourceType: 'external_archive',
          resourceId: 'external-archive-sink',
          observedAt: '2026-06-02T00:02:30.000Z',
          metadata: expect.objectContaining({
            sinkFailures: 1,
            failedRecords: 1,
            firstFailureAt: '2026-06-02T00:02:30.000Z',
            lastFailureAt: '2026-06-02T00:02:30.000Z',
            lastFailureKind: 'audit-anchor'
          })
        })
      ]));
      expect(metricsResponse.status).toBe(200);
      expect(metricsEnvelope.data).toMatchObject({
        externalArchive: {
          sinkFailures: 1,
          failedRecords: 1
        },
        systemAlerts: {
          byKind: expect.objectContaining({
            'external_archive.sink_failed': 1
          })
        }
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        controlPlane.server.close((error) => (error ? reject(error) : resolve()));
      });
      controlPlane.stopBackgroundJobs();
    }
  });

  it('returns unauthorized protected sqlite-backed reads without blocking on denied audit writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-auth-denied-'));
    const controlPlane = await createServiceBackedControlPlane({
      storage: 'sqlite',
      databaseFilePath: join(directory, 'control-plane.sqlite'),
      auth: {
        operatorTokens: {
          'operator-token-denied-read': {
            actor: 'operator_denied_read',
            operatorGroupId: 'owner',
            resourceGroupId: 'group-premium'
          }
        },
        agentTokens: {}
      }
    });

    await new Promise<void>((resolve) => {
      controlPlane.server.listen(0, '127.0.0.1', resolve);
    });

    const address = controlPlane.server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Service-backed control plane did not bind to a TCP port');
    }

    try {
      const response = await withTimeout(
        fetch(`http://127.0.0.1:${address.port}/api/v1/snapshot`),
        'sqlite-backed unauthorized protected read',
        1000
      );
      const envelope = await response.json();

      expect(response.status).toBe(401);
      expect(envelope.error).toMatchObject({
        code: 'unauthorized'
      });
      await expect(controlPlane.repository.listAuditLogs()).resolves.toEqual([
        expect.objectContaining({
          action: 'audit.denied',
          operation: 'operator.auth',
          denialCode: 'unauthorized',
          after: expect.objectContaining({
            path: '/api/v1/snapshot',
            tokenPresented: false
          })
        })
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        controlPlane.server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('audits successful operator session login and browser logout through service-backed HTTP routes', async () => {
    const controlPlane = await createServiceBackedControlPlane({
      auth: {
        operatorSession: {
          username: 'operator_001',
          password: 'operator-password-001',
          sessionSecret: 'operator-session-secret-001',
          actor: 'operator:alice',
          operatorGroupId: 'owner',
          resourceGroupId: 'group-premium'
        },
        agentTokens: {}
      }
    });

    await new Promise<void>((resolve) => {
      controlPlane.server.listen(0, '127.0.0.1', resolve);
    });

    const address = controlPlane.server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Service-backed control plane did not bind to a TCP port');
    }

    try {
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const loginResponse = await fetch(`${baseUrl}/api/v1/auth/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.41',
          'X-Request-Id': 'req-operator-session-login-audit',
          'User-Agent': 'vitest-login-logout'
        },
        body: JSON.stringify({
          username: 'operator_001',
          password: 'operator-password-001'
        })
      });
      const loginEnvelope = await loginResponse.json();
      const sessionCookie = (loginResponse.headers.get('set-cookie') ?? '').split(';')[0];
      const sessionId = loginEnvelope.data.sessionId;

      expect(loginResponse.status).toBe(201);

      const logoutResponse = await fetch(`${baseUrl}/api/v1/auth/session`, {
        method: 'DELETE',
        headers: {
          Cookie: sessionCookie,
          'X-Forwarded-For': '203.0.113.41',
          'X-Request-Id': 'req-operator-session-logout-audit',
          'User-Agent': 'vitest-login-logout'
        }
      });
      const logoutEnvelope = await logoutResponse.json();

      expect(logoutResponse.status).toBe(200);
      expect(logoutEnvelope.data).toMatchObject({
        authenticated: false
      });
      await expect(controlPlane.repository.listOperatorSessions()).resolves.toEqual([
        expect.objectContaining({
          id: sessionId,
          status: 'revoked',
          revokedBy: 'operator:alice',
          revokedReason: 'operator_logout'
        })
      ]);

      const auditLogs = await controlPlane.repository.listAuditLogs();
      expect(auditLogs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'operator.session.issued',
            operation: 'operator.session.issue',
            targetId: sessionId,
            actor: 'operator:alice',
            sourceIp: '203.0.113.41',
            userAgent: 'vitest-login-logout',
            requestId: 'req-operator-session-login-audit'
          }),
          expect.objectContaining({
            action: 'operator.session.revoked',
            operation: 'operator.session.revoke',
            targetId: sessionId,
            actor: 'operator:alice',
            sourceIp: '203.0.113.41',
            userAgent: 'vitest-login-logout',
            requestId: 'req-operator-session-logout-audit',
            after: {
              session: expect.objectContaining({
                id: sessionId,
                status: 'revoked',
                revokedReason: 'operator_logout'
              })
            }
          })
        ])
      );
      expect(JSON.stringify(auditLogs)).not.toContain('operator-password-001');
      expect(JSON.stringify(auditLogs)).not.toContain(sessionCookie);
    } finally {
      await new Promise<void>((resolve, reject) => {
        controlPlane.server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('audits operator sessions that expire during protected session authentication', async () => {
    let now = new Date().toISOString();
    const controlPlane = await createServiceBackedControlPlane({
      now: () => now,
      auth: {
        operatorSession: {
          username: 'operator_001',
          password: 'operator-password-001',
          sessionSecret: 'operator-session-secret-001',
          actor: 'operator:alice',
          operatorGroupId: 'owner',
          resourceGroupId: 'group-premium',
          ttlMs: 1_000
        },
        agentTokens: {}
      }
    });

    await new Promise<void>((resolve) => {
      controlPlane.server.listen(0, '127.0.0.1', resolve);
    });

    const address = controlPlane.server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Service-backed control plane did not bind to a TCP port');
    }

    try {
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const loginResponse = await fetch(`${baseUrl}/api/v1/auth/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-operator-session-expiring-login'
        },
        body: JSON.stringify({
          username: 'operator_001',
          password: 'operator-password-001'
        })
      });
      const loginEnvelope = await loginResponse.json();
      const sessionCookie = (loginResponse.headers.get('set-cookie') ?? '').split(';')[0];
      const sessionId = loginEnvelope.data.sessionId;
      now = new Date(Date.parse(loginEnvelope.data.expiresAt) + 1).toISOString();

      const expiredResponse = await fetch(`${baseUrl}/api/v1/snapshot`, {
        headers: {
          Cookie: sessionCookie,
          'X-Forwarded-For': '203.0.113.42',
          'X-Request-Id': 'req-operator-session-expired-snapshot',
          'User-Agent': 'vitest-expired-session'
        }
      });
      const expiredEnvelope = await expiredResponse.json();

      expect(expiredResponse.status).toBe(401);
      expect(expiredEnvelope.error).toMatchObject({
        code: 'unauthorized'
      });
      await expect(controlPlane.repository.listOperatorSessions()).resolves.toEqual([
        expect.objectContaining({
          id: sessionId,
          status: 'expired'
        })
      ]);

      const auditLogs = await controlPlane.repository.listAuditLogs();
      expect(auditLogs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'operator.session.issued',
            targetId: sessionId,
            requestId: 'req-operator-session-expiring-login'
          }),
          expect.objectContaining({
            action: 'operator.session.expired',
            operation: 'operator.session.expire',
            actor: 'system:operator-session-expiry',
            targetId: sessionId,
            sourceIp: '203.0.113.42',
            userAgent: 'vitest-expired-session',
            requestId: 'req-operator-session-expired-snapshot',
            before: {
              session: expect.objectContaining({
                id: sessionId,
                status: 'active'
              })
            },
            after: {
              session: expect.objectContaining({
                id: sessionId,
                status: 'expired'
              })
            }
          }),
          expect.objectContaining({
            action: 'audit.denied',
            operation: 'operator.auth',
            requestId: 'req-operator-session-expired-snapshot',
            denialCode: 'unauthorized'
          })
        ])
      );
      expect(JSON.stringify(auditLogs)).not.toContain('operator-password-001');
      expect(JSON.stringify(auditLogs)).not.toContain(sessionCookie);
    } finally {
      await new Promise<void>((resolve, reject) => {
        controlPlane.server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('does not expire freshly created commands when the background sweep uses the production clock', async () => {
    let sweepCount = 0;
    const controlPlane = await createServiceBackedControlPlane({
      seed: {
        permissionGrants: seedPermissionGrants
      },
      commandTimeoutSweep: {
        enabled: true,
        intervalMs: 10,
        onSweep: () => {
          sweepCount += 1;
        }
      }
    });

    try {
      const task = await controlPlane.service.createTask(
        {
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-hkg-01',
          targetLabel: 'Agent HKG 01',
          summary: 'Fresh command should survive the production clock sweep'
        },
        {
          ...mutationContext,
          requestId: 'req-background-timeout-fresh-task',
          idempotencyKey: 'idem-background-timeout-fresh-task'
        }
      );
      const sweepCountAfterTask = sweepCount;

      await waitFor(
        () => Promise.resolve(sweepCount),
        (count) => count > sweepCountAfterTask,
        'fresh command background sweep'
      );

      const [taskRecord] = await controlPlane.repository.listTasks();
      const [outboxItem] = await controlPlane.repository.listCommandOutbox();

      expect(taskRecord).toEqual(expect.objectContaining({ id: task.id, status: 'queued' }));
      expect(taskRecord?.failureReason).toBeUndefined();
      expect(outboxItem).toEqual(expect.objectContaining({ taskId: task.id, status: 'pending' }));
      expect(outboxItem?.lastError).toBeUndefined();
    } finally {
      controlPlane.stopBackgroundJobs();
    }
  });

  it('can boot with an empty operator inventory while preserving bootstrap task permissions', async () => {
    const auth = {
      operatorTokens: {
        'operator-token-empty': {
          actor: 'operator_001',
          operatorGroupId: 'owner',
          resourceGroupId: 'group-premium'
        }
      },
      agentTokens: {}
    };

    const controlPlane = await createServiceBackedControlPlane({
      auth,
      seed: {
        tasks: [],
        auditLogs: [],
        forwardRules: [],
        permissionGrants: [
          {
            id: 'grant-bootstrap-operator_001',
            subjectType: 'user',
            subjectId: 'operator_001',
            resourceType: 'tunnel-group',
            resourceId: 'group-premium',
            permissions: ['read', 'operate', 'configure', 'grant'],
            grantedBy: 'system:bootstrap',
            reason: 'bootstrap owner permissions'
          },
          {
            id: 'grant-bootstrap-operator_001-agent',
            subjectType: 'user',
            subjectId: 'operator_001',
            resourceType: 'agent',
            resourceId: 'group-premium',
            permissions: ['read', 'operate', 'configure', 'grant'],
            grantedBy: 'system:bootstrap',
            reason: 'bootstrap Agent enrollment permissions'
          }
        ]
      },
      inventory: {
        agents: [],
        nodes: [],
        inbounds: [],
        subscriptionSources: [],
        subscriptionBundles: [],
        subscriptionClients: [],
        quotaPolicies: [],
        rateLimitPolicies: [],
        routingPolicies: [],
        tuningProfiles: []
      }
    });

    await new Promise<void>((resolve) => {
      controlPlane.server.listen(0, '127.0.0.1', resolve);
    });

    const address = controlPlane.server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Empty-inventory control plane did not bind to a TCP port');
    }

    try {
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const snapshotResponse = await fetch(`${baseUrl}/api/v1/snapshot`, {
        headers: {
          Authorization: 'Bearer operator-token-empty'
        }
      });
      const snapshotEnvelope = await snapshotResponse.json();

      expect(snapshotResponse.status).toBe(200);
      expect(snapshotEnvelope.data.agents).toEqual([]);
      expect(snapshotEnvelope.data.nodes).toEqual([]);
      expect(snapshotEnvelope.data.permissionGrants).toHaveLength(2);

      const commandResponse = await fetch(`${baseUrl}/api/v1/agents/install-command`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer operator-token-empty',
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-empty-inventory-install-command',
          'Idempotency-Key': 'idem-empty-inventory-install-command'
        },
        body: JSON.stringify({
          installProfile: [...AGENT_INSTALL_PROFILE],
          publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
        })
      });
      const commandEnvelope = await commandResponse.json();

      expect(commandResponse.status).toBe(201);
      expect(commandEnvelope.data.command).toContain('public/install/ou-agent.sh');
      expect(commandEnvelope.data.command).toContain("OU_AGENT_ID='");
      expect(commandEnvelope.data.command).toContain("OU_INSTALL_TOKEN='");
      expect(commandEnvelope.data.command).not.toContain('OU_HOST_NAME=');
      expect(commandEnvelope.data.command).not.toContain('OU_CUSTOMER_NODE');
      expect(commandEnvelope.data.command).not.toContain('OU_INSTALL_PROFILE=');
      expect(commandEnvelope.data.command).not.toContain('master.example.com');

      const registerResponse = await fetch(`${baseUrl}/agent/v1/register`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${commandEnvelope.data.installToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId: commandEnvelope.data.agentId,
          requestId: 'req-empty-inventory-register',
          sessionId: 'sess-empty-inventory-register',
          version: '1.0.0-runtime',
          platform: 'linux-x64',
          capabilities: [...AGENT_INSTALL_PROFILE]
        })
      });
      const registerEnvelope = await registerResponse.json();

      expect(registerResponse.status).toBe(201);
      expect(registerEnvelope.data.agentId).toBe(commandEnvelope.data.agentId);

      const agentsResponse = await fetch(`${baseUrl}/api/v1/agents`, {
        headers: {
          Authorization: 'Bearer operator-token-empty'
        }
      });
      const agentsEnvelope = await agentsResponse.json();

      expect(agentsResponse.status).toBe(200);
      expect(agentsEnvelope.data).toEqual([
        expect.objectContaining({
          id: commandEnvelope.data.agentId,
          name: commandEnvelope.data.agentId,
          status: 'provisioning',
          capabilities: expect.arrayContaining(['host-agent', 'xray', 'port-forwarding'])
        })
      ]);

      const taskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer operator-token-empty',
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-empty-inventory-task',
          'Idempotency-Key': 'idem-empty-inventory-task'
        },
        body: JSON.stringify({
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-edge-empty-01',
          targetLabel: 'Edge Empty 01',
          summary: 'Generate one-click host enrollment command',
          metadata: {
            hostName: 'edge-empty-01',
            installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
          }
        })
      });
      const taskEnvelope = await taskResponse.json();

      expect(taskResponse.status).toBe(201);
      expect(taskEnvelope.data).toMatchObject({
        operation: 'agent.deploy',
        status: 'queued',
        targetId: 'agent-edge-empty-01'
      });

      const updateResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer operator-token-empty',
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-empty-inventory-host-update',
          'Idempotency-Key': 'idem-empty-inventory-host-update'
        },
        body: JSON.stringify({
          operation: 'agent.update',
          resourceType: 'agent',
          targetId: commandEnvelope.data.agentId,
          targetLabel: '自定义主机名称',
          summary: 'Update managed host profile',
          metadata: {
            agentId: commandEnvelope.data.agentId,
            hostName: '自定义主机名称',
            maxTrafficGb: 1024,
            monthlyTrafficGb: 1024,
            trafficAccountingMode: 'both',
            monthlyResetDay: 1,
            currentUsedTrafficGb: 0,
            expiresAt: '2026-12-31T00:00:00.000Z',
            pingTarget: '1.1.1.1',
            pingIntervalSeconds: 30
          }
        })
      });
      const updateEnvelope = await updateResponse.json();

      expect(updateResponse.status).toBe(201);
      expect(updateEnvelope.data).toMatchObject({
        operation: 'agent.update',
        status: 'queued',
        targetId: commandEnvelope.data.agentId,
        targetLabel: '自定义主机名称'
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        controlPlane.server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('repairs bootstrap operator permissions when an update preserves an older empty state file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-old-state-'));
    const stateFilePath = join(directory, 'control-plane-state.json');
    const bootstrapPermissionGrant: PermissionGrant = {
      id: 'grant-bootstrap-owner-operator_legacy',
      subjectType: 'user' as const,
      subjectId: 'operator_legacy',
      resourceType: 'tunnel-group' as const,
      resourceId: 'group-premium',
      permissions: ['read', 'operate', 'configure', 'grant'],
      grantedBy: 'system:bootstrap',
      reason: 'bootstrap owner permissions'
    };

    await writeFile(
      stateFilePath,
      `${JSON.stringify(
        {
          tasks: [],
          auditLogs: [],
          commandOutbox: [],
          agentEvents: [],
          agentSessions: [],
          agentCredentials: [],
          idempotencyRecords: [],
          forwardRules: [],
          permissionGrants: [],
          configRevisions: [],
          preflightPlans: [],
          runtimeSnapshots: []
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    const controlPlane = await createServiceBackedControlPlane({
      storage: 'file',
      stateFilePath,
      auth: {
        operatorTokens: {
          'operator-token-legacy': {
            actor: 'operator_legacy',
            operatorGroupId: 'owner',
            resourceGroupId: 'group-premium'
          }
        },
        agentTokens: {}
      },
      seed: {
        tasks: [],
        auditLogs: [],
        forwardRules: [],
        permissionGrants: [bootstrapPermissionGrant]
      },
      inventory: {
        agents: [],
        nodes: [],
        inbounds: [],
        subscriptionSources: [],
        subscriptionBundles: [],
        subscriptionClients: [],
        quotaPolicies: [],
        rateLimitPolicies: [],
        routingPolicies: [],
        tuningProfiles: []
      }
    });

    await new Promise<void>((resolve) => {
      controlPlane.server.listen(0, '127.0.0.1', resolve);
    });

    const address = controlPlane.server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Legacy-state control plane did not bind to a TCP port');
    }

    try {
      await expect(controlPlane.repository.listPermissionGrants()).resolves.toEqual([
        expect.objectContaining({
          id: bootstrapPermissionGrant.id,
          subjectId: 'operator_legacy',
          resourceId: 'group-premium',
          permissions: ['read', 'operate', 'configure', 'grant']
        })
      ]);

      const taskResponse = await postJson(
        `http://127.0.0.1:${address.port}`,
        '/api/v1/tasks',
        {
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-legacy-install',
          targetLabel: 'Agent one-click installer',
          summary: 'Generate one-click host enrollment command',
          metadata: {
            installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
          }
        },
        {
          Authorization: 'Bearer operator-token-legacy',
          'X-Request-Id': 'req-legacy-state-agent-install',
          'Idempotency-Key': 'idem-legacy-state-agent-install'
        }
      );
      const taskEnvelope = await taskResponse.json();

      expect(taskResponse.status).toBe(201);
      expect(taskEnvelope.data).toMatchObject({
        operation: 'agent.deploy',
        status: 'queued',
        targetId: 'agent-legacy-install'
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        controlPlane.server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('rebuilds service-backed business read models from persisted tasks after a file-backed restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-read-model-replay-'));
    const stateFilePath = join(directory, 'control-plane-state.json');
    const auth = {
      operatorTokens: {
        'operator-token-replay': {
          actor: 'admin',
          operatorGroupId: 'owner',
          resourceGroupId: 'group-premium'
        }
      },
      agentTokens: {}
    };
    const bootstrapGrant: PermissionGrant = {
      id: 'grant-bootstrap-owner-replay',
      subjectType: 'user',
      subjectId: 'bootstrap-owner',
      resourceType: 'tunnel-group',
      resourceId: 'group-premium',
      permissions: ['read', 'operate', 'configure', 'grant'],
      grantedBy: 'system:bootstrap',
      reason: 'bootstrap owner permissions'
    };
    const createFileBackedControlPlane = () =>
      createServiceBackedControlPlane({
        storage: 'file',
        stateFilePath,
        auth,
        seed: {
          tasks: [],
          auditLogs: [],
          forwardRules: [],
          permissionGrants: [bootstrapGrant]
        },
        inventory: {
          agents: [],
          nodes: [],
          inbounds: [],
          subscriptionSources: [],
          subscriptionBundles: [],
          subscriptionClients: [],
          quotaPolicies: [],
          rateLimitPolicies: [],
          routingPolicies: [],
          tuningProfiles: []
        }
      });

    try {
      const firstControlPlane = await createFileBackedControlPlane();

      await new Promise<void>((resolve) => {
        firstControlPlane.server.listen(0, '127.0.0.1', resolve);
      });

      const firstAddress = firstControlPlane.server.address();

      if (!firstAddress || typeof firstAddress === 'string') {
        throw new Error('Read-model replay control plane did not bind to a TCP port');
      }

      const firstBaseUrl = `http://127.0.0.1:${firstAddress.port}`;
      const mutationHeaders = (requestId: string) => ({
        Authorization: 'Bearer operator-token-replay',
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
        'Idempotency-Key': requestId.replace('req-', 'idem-')
      });
      const createTask = async (requestId: string, body: unknown) => {
        const response = await fetch(`${firstBaseUrl}/api/v1/tasks`, {
          method: 'POST',
          headers: mutationHeaders(requestId),
          body: JSON.stringify(body)
        });
        const envelope = await response.json();

        expect(response.status).toBe(201);
        return envelope.data;
      };
      const commandResponse = await fetch(`${firstBaseUrl}/api/v1/agents/install-command`, {
        method: 'POST',
        headers: mutationHeaders('req-replay-install-command'),
        body: JSON.stringify({
          installProfile: [...AGENT_INSTALL_PROFILE],
          publicBaseUrl: 'https://panel.example.com/replaySecurePath'
        })
      });
      const commandEnvelope = await commandResponse.json();
      const agentId = commandEnvelope.data.agentId as string;
      const registerResponse = await fetch(`${firstBaseUrl}/agent/v1/register`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${commandEnvelope.data.installToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId,
          requestId: 'req-replay-agent-register',
          sessionId: 'sess-replay-agent-register',
          version: '1.0.0-runtime',
          platform: 'linux-x64',
          capabilities: [...AGENT_INSTALL_PROFILE]
        })
      });

      expect(registerResponse.status).toBe(201);

      await createTask('req-replay-agent-update', {
        operation: 'agent.update',
        resourceType: 'agent',
        targetId: agentId,
        targetLabel: 'Persisted Edge 01',
        summary: 'Update managed host profile',
        metadata: {
          agentId,
          hostName: 'Persisted Edge 01',
          maxTrafficGb: 2048,
          monthlyTrafficGb: 1024,
          trafficAccountingMode: 'egress',
          monthlyResetDay: 9,
          currentUsedTrafficGb: 128,
          expiresAt: '2026-12-31T00:00:00.000Z',
          pingTarget: '1.1.1.1',
          pingIntervalSeconds: 30
        }
      });
      await createTask('req-replay-inbound-create', {
        operation: 'inbound.create',
        resourceType: 'inbound',
        targetId: 'customer-node-replay-vless',
        targetLabel: 'Replay VLESS Inbound',
        summary: 'Create replay customer Xray inbound',
        metadata: {
          nodeId: 'customer-node-replay-vless',
          agentId,
          customerNodeName: 'Replay VLESS Inbound',
          customerName: 'Replay Customer',
          serverAddress: 'edge-replay.example.com',
          xrayProtocol: 'vless',
          listenPort: 2443,
          clientIdentity: 'replay-client-id',
          clientEmail: 'replay@example.com',
          clientCredential: 'replay-client-id',
          trafficLimitGb: 500,
          remainingDays: 45,
          subscriptionRule: 'tag:replay'
        }
      });
      await createTask('req-replay-subscription-import', {
        operation: 'subscription.import',
        resourceType: 'subscription',
        targetId: 'source-replay-hkg',
        targetLabel: 'Replay HKG Source',
        summary: 'Import replay subscription source',
        metadata: {
          sourceId: 'source-replay-hkg',
          kind: 'mihomo-provider',
          name: 'Replay HKG Source',
          url: 'https://provider.example.com/replay.yaml',
          refreshIntervalMinutes: 30,
          includeFilter: 'premium|hk',
          excludeFilter: 'expired',
          dedupeKey: 'uuid'
        }
      });
      await createTask('req-replay-subscription-client', {
        operation: 'subscription.generate',
        resourceType: 'subscription',
        targetId: 'sub-client-replay',
        targetLabel: 'Replay Client Subscription',
        summary: 'Create replay client subscription rule',
        metadata: {
          subscriptionClientId: 'sub-client-replay',
          customerName: 'Replay Customer',
          displayName: 'Replay Client Subscription',
          subId: 'sub_replay_hkg',
          email: 'replay@example.com',
          protocol: 'vless',
          group: 'premium',
          trafficLimitGb: 500,
          remainingDays: 45,
          sourceIds: ['source-replay-hkg'],
          selectedTags: ['premium'],
          outputFormats: ['uri', 'clash'],
          generatedNodeCount: 1
        }
      });
      await createTask('req-replay-forward-create', {
        operation: 'forward.create',
        resourceType: 'forward',
        targetId: 'forward-replay-2443',
        targetLabel: 'Replay Port Forwarding',
        summary: 'Create replay port forwarding rule',
        metadata: {
          name: 'Replay Port Forwarding',
          ownerName: 'Replay Customer',
          listenAddress: '0.0.0.0',
          listenPort: 2443,
          targetAddress: '10.8.0.10',
          targetPort: 9443,
          protocol: 'tcp',
          entryNodeIds: [agentId],
          quotaGb: 500,
          billingDirection: 'both',
          monthlyResetDay: 9,
          currentUsedTrafficGb: 12,
          rateLimitMbps: 100
        }
      });

      await new Promise<void>((resolve, reject) => {
        firstControlPlane.server.close((error) => (error ? reject(error) : resolve()));
      });

      const secondControlPlane = await createFileBackedControlPlane();

      await new Promise<void>((resolve) => {
        secondControlPlane.server.listen(0, '127.0.0.1', resolve);
      });

      const secondAddress = secondControlPlane.server.address();

      if (!secondAddress || typeof secondAddress === 'string') {
        throw new Error('Restored read-model replay control plane did not bind to a TCP port');
      }

      try {
        const snapshotResponse = await fetch(`http://127.0.0.1:${secondAddress.port}/api/v1/snapshot`, {
          headers: {
            Authorization: 'Bearer operator-token-replay'
          }
        });
        const snapshotEnvelope = await snapshotResponse.json();

        expect(snapshotResponse.status).toBe(200);
        expect(snapshotEnvelope.data.agents).toEqual([
          expect.objectContaining({
            id: agentId,
            name: 'Persisted Edge 01',
            trafficPolicy: expect.objectContaining({
              accountingMode: 'egress',
              monthlyResetDay: 9
            })
          })
        ]);
        expect(snapshotEnvelope.data.inbounds).toEqual([
          expect.objectContaining({
            id: 'customer-node-replay-vless',
            agentId,
            customerName: 'Replay Customer',
            protocol: 'vless',
            listenPort: 2443
          })
        ]);
        expect(snapshotEnvelope.data.subscriptionSources).toEqual([
          expect.objectContaining({
            id: 'source-replay-hkg',
            name: 'Replay HKG Source',
            url: 'https://provider.example.com/replay.yaml'
          })
        ]);
        expect(snapshotEnvelope.data.subscriptionClients).toEqual([
          expect.objectContaining({
            id: 'sub-client-replay',
            customerName: 'Replay Customer',
            subId: 'sub_replay_hkg'
          })
        ]);
        expect(snapshotEnvelope.data.forwardRules).toEqual([
          expect.objectContaining({
            id: 'forward-replay-2443',
            ownerName: 'Replay Customer',
            ports: [
              expect.objectContaining({
                agentId,
                listenPort: 2443,
                targetAddress: '10.8.0.10',
                targetPort: 9443
              })
            ]
          })
        ]);
      } finally {
        await new Promise<void>((resolve, reject) => {
          secondControlPlane.server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('persists Agent install credentials so enrolled hosts can poll after a file-backed restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-agent-credential-'));
    const stateFilePath = join(directory, 'control-plane-state.json');
    const auth = {
      operatorTokens: {
        'operator-token-001': {
          actor: 'admin',
          operatorGroupId: 'owner',
          resourceGroupId: 'group-premium'
        }
      },
      agentTokens: {}
    };

    try {
      const firstControlPlane = await createServiceBackedControlPlane({
        storage: 'file',
        stateFilePath,
        auth
      });

      await new Promise<void>((resolve) => {
        firstControlPlane.server.listen(0, '127.0.0.1', resolve);
      });

      const firstAddress = firstControlPlane.server.address();

      if (!firstAddress || typeof firstAddress === 'string') {
        throw new Error('File-backed control plane did not bind to a TCP port');
      }

      const firstBaseUrl = `http://127.0.0.1:${firstAddress.port}`;
      const commandResponse = await fetch(`${firstBaseUrl}/api/v1/agents/install-command`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer operator-token-001',
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-file-backed-install-command',
          'Idempotency-Key': 'idem-file-backed-install-command'
        },
        body: JSON.stringify({
          installProfile: [...AGENT_INSTALL_PROFILE],
          publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
        })
      });
      const commandEnvelope = await commandResponse.json();
      const registerResponse = await fetch(`${firstBaseUrl}/agent/v1/register`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${commandEnvelope.data.installToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId: commandEnvelope.data.agentId,
          requestId: 'req-file-backed-agent-register',
          sessionId: 'sess-file-backed-agent-register',
          version: '0.1.0-test',
          platform: 'linux-x64',
          capabilities: [...AGENT_INSTALL_PROFILE]
        })
      });
      const registerEnvelope = await registerResponse.json();

      await new Promise<void>((resolve, reject) => {
        firstControlPlane.server.close((error) => (error ? reject(error) : resolve()));
      });

      const secondControlPlane = await createServiceBackedControlPlane({
        storage: 'file',
        stateFilePath,
        auth
      });

      await new Promise<void>((resolve) => {
        secondControlPlane.server.listen(0, '127.0.0.1', resolve);
      });

      const secondAddress = secondControlPlane.server.address();

      if (!secondAddress || typeof secondAddress === 'string') {
        throw new Error('Restored file-backed control plane did not bind to a TCP port');
      }

      try {
        const pollResponse = await fetch(`http://127.0.0.1:${secondAddress.port}/agent/v1/poll`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${registerEnvelope.data.agentToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            agentId: commandEnvelope.data.agentId,
            requestId: 'req-file-backed-agent-poll-after-restart',
            sessionId: 'sess-file-backed-agent-register',
            lastSeenCommandSeq: 0
          })
        });
        const pollEnvelope = await pollResponse.json();
        const mismatchedSessionResponse = await fetch(`http://127.0.0.1:${secondAddress.port}/agent/v1/poll`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${registerEnvelope.data.agentToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            agentId: commandEnvelope.data.agentId,
            requestId: 'req-file-backed-agent-poll-session-mismatch',
            sessionId: 'sess-file-backed-agent-mismatch',
            lastSeenCommandSeq: 0
          })
        });
        const mismatchedSessionEnvelope = await mismatchedSessionResponse.json();
        const mismatchedEventSessionResponse = await fetch(`http://127.0.0.1:${secondAddress.port}/agent/v1/events`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${registerEnvelope.data.agentToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            events: [
              {
                type: 'heartbeat',
                eventId: 'evt-file-backed-session-mismatch',
                agentId: commandEnvelope.data.agentId,
                seq: 1,
                sessionId: 'sess-file-backed-agent-mismatch',
                observedAt: new Date().toISOString(),
                payload: {
                  version: '0.1.0-test',
                  uptimeSeconds: 30,
                  capabilities: ['xray'],
                  lastSeenCommandSeq: 0
                }
              }
            ]
          })
        });
        const mismatchedEventSessionEnvelope = await mismatchedEventSessionResponse.json();
        const listCredentialsResponse = await fetch(`http://127.0.0.1:${secondAddress.port}/api/v1/agent-credentials`, {
          headers: {
            Authorization: 'Bearer operator-token-001'
          }
        });
        const listCredentialsEnvelope = await listCredentialsResponse.json();
        const revokeResponse = await fetch(
          `http://127.0.0.1:${secondAddress.port}/api/v1/agent-credentials/${encodeURIComponent(registerEnvelope.data.credentialId)}/revoke`,
          {
            method: 'POST',
            headers: {
              Authorization: 'Bearer operator-token-001',
              'Content-Type': 'application/json',
              'X-Request-Id': 'req-file-backed-agent-credential-revoke',
              'Idempotency-Key': 'idem-file-backed-agent-credential-revoke'
            },
            body: JSON.stringify({
              reason: 'operator initiated runtime credential rotation'
            })
          }
        );
        const revokeEnvelope = await revokeResponse.json();
        const pollAfterRevokeResponse = await fetch(`http://127.0.0.1:${secondAddress.port}/agent/v1/poll`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${registerEnvelope.data.agentToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            agentId: commandEnvelope.data.agentId,
            requestId: 'req-file-backed-agent-poll-after-revoke',
            sessionId: 'sess-file-backed-agent-register',
            lastSeenCommandSeq: 0
          })
        });
        const credentials = await secondControlPlane.repository.listAgentCredentials();
        const auditLogs = await secondControlPlane.repository.listAuditLogs();

        expect(commandResponse.status).toBe(201);
        expect(registerResponse.status).toBe(201);
        expect(pollResponse.status).toBe(200);
        expect(pollEnvelope.data).toMatchObject({
          commands: [],
          nextPollAfterMs: expect.any(Number)
        });
        expect(mismatchedSessionResponse.status).toBe(403);
        expect(mismatchedSessionEnvelope.error).toMatchObject({
          code: 'identity.mismatch'
        });
        expect(mismatchedEventSessionResponse.status).toBe(403);
        expect(mismatchedEventSessionEnvelope.error).toMatchObject({
          code: 'identity.mismatch'
        });
        expect(listCredentialsResponse.status).toBe(200);
        expect(JSON.stringify(listCredentialsEnvelope.data)).not.toContain('tokenHash');
        expect(revokeResponse.status).toBe(202);
        expect(revokeEnvelope.data).toEqual(
          expect.objectContaining({
            id: registerEnvelope.data.credentialId,
            status: 'revoked',
            revokedReason: 'operator initiated runtime credential rotation'
          })
        );
        expect(pollAfterRevokeResponse.status).toBe(401);
        expect(JSON.stringify(credentials)).not.toContain(commandEnvelope.data.installToken);
        expect(JSON.stringify(credentials)).not.toContain(registerEnvelope.data.agentToken);
        expect(credentials).toEqual([
          expect.objectContaining({
            agentId: commandEnvelope.data.agentId,
            purpose: 'runtime',
            lastUsedAt: expect.any(String),
            sessionId: 'sess-file-backed-agent-register',
            status: 'revoked'
          }),
          expect.objectContaining({
            agentId: commandEnvelope.data.agentId,
            purpose: 'install',
            status: 'revoked',
            replacedByCredentialId: registerEnvelope.data.credentialId
          })
        ]);
        expect(auditLogs).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              action: 'agent.credential.revoked',
              requestId: 'req-file-backed-agent-credential-revoke'
            }),
            expect.objectContaining({
              action: 'agent.credential.issued',
              requestId: 'req-file-backed-install-command'
            })
          ])
        );
      } finally {
        await new Promise<void>((resolve, reject) => {
          secondControlPlane.server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('persists service-backed HTTP mutation state when file storage is selected', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-service-backed-'));
    const stateFilePath = join(directory, 'control-plane-state.json');

    try {
      const firstControlPlane = await createServiceBackedControlPlane({
        storage: 'file',
        stateFilePath,
        seed: {
          forwardRules: seedForwardRules,
          permissionGrants: seedPermissionGrants
        }
      });

      await new Promise<void>((resolve) => {
        firstControlPlane.server.listen(0, '127.0.0.1', resolve);
      });

      const firstAddress = firstControlPlane.server.address();

      if (!firstAddress || typeof firstAddress === 'string') {
        throw new Error('File-backed control plane did not bind to a TCP port');
      }

      const firstBaseUrl = `http://127.0.0.1:${firstAddress.port}`;

      const createResponse = await fetch(`${firstBaseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor': 'admin',
          'X-Operator-Group-Id': 'owner',
          'X-Resource-Group-Id': 'group-premium',
          'X-Request-Id': 'req-file-factory-forward-001',
          'Idempotency-Key': 'idem-file-factory-forward-001',
          'If-Match': 'forward-forward-hkg-443-v1'
        },
        body: JSON.stringify({
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Apply file-backed forwarding policy'
        })
      });
      const createEnvelope = await createResponse.json();

      await new Promise<void>((resolve, reject) => {
        firstControlPlane.server.close((error) => (error ? reject(error) : resolve()));
      });

      const secondControlPlane = await createServiceBackedControlPlane({
        storage: 'file',
        stateFilePath
      });

      await new Promise<void>((resolve) => {
        secondControlPlane.server.listen(0, '127.0.0.1', resolve);
      });

      const secondAddress = secondControlPlane.server.address();

      if (!secondAddress || typeof secondAddress === 'string') {
        throw new Error('Restored file-backed control plane did not bind to a TCP port');
      }

      try {
        const snapshotResponse = await fetch(`http://127.0.0.1:${secondAddress.port}/api/v1/snapshot`);
        const snapshotEnvelope = await snapshotResponse.json();
        const outboxResponse = await fetch(`http://127.0.0.1:${secondAddress.port}/api/v1/command-outbox`);
        const outboxEnvelope = await outboxResponse.json();

        expect(createResponse.status).toBe(201);
        expect(snapshotEnvelope.data).toMatchObject({
          tasks: [expect.objectContaining({ id: createEnvelope.data.id })],
          auditLogs: [expect.objectContaining({ taskId: createEnvelope.data.id })]
        });
        expect(outboxEnvelope.data).toEqual([expect.objectContaining({ taskId: createEnvelope.data.id })]);
      } finally {
        await new Promise<void>((resolve, reject) => {
          secondControlPlane.server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('persists service-backed HTTP mutation state when sqlite storage is selected', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-service-backed-sqlite-'));
    const databaseFilePath = join(directory, 'control-plane.sqlite');

    try {
      const firstControlPlane = await createServiceBackedControlPlane({
        storage: 'sqlite',
        databaseFilePath,
        seed: {
          forwardRules: seedForwardRules,
          permissionGrants: seedPermissionGrants
        }
      });

      await new Promise<void>((resolve) => {
        firstControlPlane.server.listen(0, '127.0.0.1', resolve);
      });

      const firstAddress = firstControlPlane.server.address();

      if (!firstAddress || typeof firstAddress === 'string') {
        throw new Error('Sqlite-backed control plane did not bind to a TCP port');
      }

      const firstBaseUrl = `http://127.0.0.1:${firstAddress.port}`;

      const createResponse = await fetch(`${firstBaseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor': 'admin',
          'X-Operator-Group-Id': 'owner',
          'X-Resource-Group-Id': 'group-premium',
          'X-Request-Id': 'req-sqlite-factory-forward-001',
          'Idempotency-Key': 'idem-sqlite-factory-forward-001',
          'If-Match': 'forward-forward-hkg-443-v1'
        },
        body: JSON.stringify({
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Apply sqlite-backed forwarding policy'
        })
      });
      const createEnvelope = await createResponse.json();

      await new Promise<void>((resolve, reject) => {
        firstControlPlane.server.close((error) => (error ? reject(error) : resolve()));
      });

      const secondControlPlane = await createServiceBackedControlPlane({
        storage: 'sqlite',
        databaseFilePath
      });

      await new Promise<void>((resolve) => {
        secondControlPlane.server.listen(0, '127.0.0.1', resolve);
      });

      const secondAddress = secondControlPlane.server.address();

      if (!secondAddress || typeof secondAddress === 'string') {
        throw new Error('Restored sqlite-backed control plane did not bind to a TCP port');
      }

      try {
        const snapshotResponse = await fetch(`http://127.0.0.1:${secondAddress.port}/api/v1/snapshot`);
        const snapshotEnvelope = await snapshotResponse.json();
        const outboxResponse = await fetch(`http://127.0.0.1:${secondAddress.port}/api/v1/command-outbox`);
        const outboxEnvelope = await outboxResponse.json();

        expect(createResponse.status).toBe(201);
        expect(snapshotEnvelope.data).toMatchObject({
          tasks: [expect.objectContaining({ id: createEnvelope.data.id })],
          auditLogs: [expect.objectContaining({ taskId: createEnvelope.data.id })]
        });
        expect(outboxEnvelope.data).toEqual([expect.objectContaining({ taskId: createEnvelope.data.id })]);
      } finally {
        await new Promise<void>((resolve, reject) => {
          secondControlPlane.server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('persists system alert lifecycle records across sqlite-backed restarts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-sqlite-alert-lifecycle-'));
    const databaseFilePath = join(directory, 'control-plane.sqlite');
    let nowIso = '2026-06-04T04:01:30.000Z';

    try {
      const firstControlPlane = await createServiceBackedControlPlane({
        storage: 'sqlite',
        databaseFilePath,
        readModelNow: () => nowIso,
        seed: {
          permissionGrants: seedPermissionGrants,
          agentEvents: [
            {
              type: 'heartbeat',
              eventId: 'evt-sqlite-alert-lifecycle-heartbeat',
              agentId: 'agent-sqlite-alert-01',
              seq: 1,
              sessionId: 'sess-sqlite-alert-01',
              observedAt: '2026-06-04T04:00:00.000Z',
              payload: {
                version: '1.0.0-runtime',
                uptimeSeconds: 3600,
                capabilities: ['host-agent', 'xray', 'port-forwarding'],
                lastSeenCommandSeq: 0
              }
            }
          ]
        },
        inventory: {
          agents: []
        }
      });

      try {
        await expect(firstControlPlane.api.listSystemAlerts()).resolves.toEqual([
          expect.objectContaining({
            resourceId: 'agent-sqlite-alert-01',
            status: 'active'
          })
        ]);
        await expect(firstControlPlane.repository.listSystemAlertRecords()).resolves.toEqual([
          expect.objectContaining({
            id: 'alert-agent-telemetry-sampling-gap-agent-sqlite-alert-01',
            status: 'active',
            firstObservedAt: '2026-06-04T04:00:00.000Z'
          })
        ]);
      } finally {
        if (firstControlPlane.server.listening) {
          await new Promise<void>((resolve, reject) => {
            firstControlPlane.server.close((error) => (error ? reject(error) : resolve()));
          });
        }
      }

      const secondControlPlane = await createServiceBackedControlPlane({
        storage: 'sqlite',
        databaseFilePath,
        readModelNow: () => nowIso,
        inventory: {
          agents: []
        }
      });

      try {
        await expect(secondControlPlane.repository.listSystemAlertRecords()).resolves.toEqual([
          expect.objectContaining({
            id: 'alert-agent-telemetry-sampling-gap-agent-sqlite-alert-01',
            status: 'active',
            firstObservedAt: '2026-06-04T04:00:00.000Z'
          })
        ]);

        await secondControlPlane.api.receiveAgentEvent({
          type: 'telemetry_sample',
          eventId: 'evt-sqlite-alert-lifecycle-telemetry-recovered',
          agentId: 'agent-sqlite-alert-01',
          seq: 2,
          sessionId: 'sess-sqlite-alert-01',
          observedAt: '2026-06-04T04:01:45.000Z',
          payload: {
            reportedAt: '2026-06-04T04:01:45.000Z',
            latencyMs: 38,
            cpuPercent: 14
          }
        });
        nowIso = '2026-06-04T04:02:00.000Z';

        await expect(secondControlPlane.api.listSystemAlerts()).resolves.toEqual([]);
        await expect(secondControlPlane.repository.listSystemAlertRecords()).resolves.toEqual([
          expect.objectContaining({
            id: 'alert-agent-telemetry-sampling-gap-agent-sqlite-alert-01',
            status: 'resolved',
            resolvedAt: '2026-06-04T04:02:00.000Z',
            lastChangedAt: '2026-06-04T04:02:00.000Z'
          })
        ]);
      } finally {
        if (secondControlPlane.server.listening) {
          await new Promise<void>((resolve, reject) => {
            secondControlPlane.server.close((error) => (error ? reject(error) : resolve()));
          });
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('replays persisted task status history across sqlite-backed restarts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-sqlite-task-history-'));
    const databaseFilePath = join(directory, 'control-plane.sqlite');

    try {
      const firstControlPlane = await createServiceBackedControlPlane({
        storage: 'sqlite',
        databaseFilePath,
        seed: {
          permissionGrants: seedPermissionGrants
        }
      });

      await new Promise<void>((resolve) => {
        firstControlPlane.server.listen(0, '127.0.0.1', resolve);
      });

      const firstAddress = firstControlPlane.server.address();

      if (!firstAddress || typeof firstAddress === 'string') {
        throw new Error('First sqlite task-history control plane did not bind to a TCP port');
      }

      const firstBaseUrl = `http://127.0.0.1:${firstAddress.port}`;
      const mutationHeaders = (requestId: string) => ({
        'Content-Type': 'application/json',
        'X-Actor': 'admin',
        'X-Operator-Group-Id': 'owner',
        'X-Resource-Group-Id': 'group-premium',
        'X-Request-Id': requestId,
        'Idempotency-Key': requestId.replace('req-', 'idem-')
      });
      const createResponse = await fetch(`${firstBaseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: mutationHeaders('req-sqlite-task-history-create'),
        body: JSON.stringify({
          operation: 'subscription.import',
          resourceType: 'subscription',
          targetId: 'source-sqlite-task-history',
          targetLabel: 'SQLite Task History Source',
          summary: 'Create sqlite task history source'
        })
      });
      const createEnvelope = await createResponse.json();

      expect(createResponse.status).toBe(201);

      const runningResponse = await fetch(`${firstBaseUrl}/api/v1/tasks/${encodeURIComponent(createEnvelope.data.id)}/transition`, {
        method: 'POST',
        headers: mutationHeaders('req-sqlite-task-history-running'),
        body: JSON.stringify({
          status: 'running'
        })
      });
      const failedResponse = await fetch(`${firstBaseUrl}/api/v1/tasks/${encodeURIComponent(createEnvelope.data.id)}/transition`, {
        method: 'POST',
        headers: mutationHeaders('req-sqlite-task-history-failed'),
        body: JSON.stringify({
          status: 'failed'
        })
      });

      expect(runningResponse.status).toBe(200);
      expect(failedResponse.status).toBe(200);

      await new Promise<void>((resolve, reject) => {
        firstControlPlane.server.close((error) => (error ? reject(error) : resolve()));
      });

      const secondControlPlane = await createServiceBackedControlPlane({
        storage: 'sqlite',
        databaseFilePath,
        seed: {
          permissionGrants: seedPermissionGrants
        }
      });

      await new Promise<void>((resolve) => {
        secondControlPlane.server.listen(0, '127.0.0.1', resolve);
      });

      const secondAddress = secondControlPlane.server.address();

      if (!secondAddress || typeof secondAddress === 'string') {
        throw new Error('Second sqlite task-history control plane did not bind to a TCP port');
      }

      try {
        const eventsResponse = await fetch(
          `http://127.0.0.1:${secondAddress.port}/events/v1/tasks?once=1&taskId=${encodeURIComponent(createEnvelope.data.id)}`,
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
      } finally {
        await new Promise<void>((resolve, reject) => {
          secondControlPlane.server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rebuilds snapshot read models across live sqlite-backed control-plane instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-sqlite-cross-instance-snapshot-'));
    const databaseFilePath = join(directory, 'control-plane.sqlite');

    try {
      const firstControlPlane = await createServiceBackedControlPlane({
        storage: 'sqlite',
        databaseFilePath,
        seed: {
          permissionGrants: seedPermissionGrants
        },
        inventory: {
          agents: [],
          nodes: [],
          inbounds: [],
          subscriptionSources: [],
          subscriptionBundles: [],
          subscriptionClients: [],
          quotaPolicies: [],
          rateLimitPolicies: [],
          routingPolicies: [],
          tuningProfiles: []
        }
      });

      await new Promise<void>((resolve) => {
        firstControlPlane.server.listen(0, '127.0.0.1', resolve);
      });

      const firstAddress = firstControlPlane.server.address();

      if (!firstAddress || typeof firstAddress === 'string') {
        throw new Error('First sqlite cross-instance snapshot control plane did not bind to a TCP port');
      }

      const secondControlPlane = await createServiceBackedControlPlane({
        storage: 'sqlite',
        databaseFilePath,
        seed: {
          permissionGrants: seedPermissionGrants
        },
        inventory: {
          agents: [],
          nodes: [],
          inbounds: [],
          subscriptionSources: [],
          subscriptionBundles: [],
          subscriptionClients: [],
          quotaPolicies: [],
          rateLimitPolicies: [],
          routingPolicies: [],
          tuningProfiles: []
        }
      });

      await new Promise<void>((resolve) => {
        secondControlPlane.server.listen(0, '127.0.0.1', resolve);
      });

      const secondAddress = secondControlPlane.server.address();

      if (!secondAddress || typeof secondAddress === 'string') {
        throw new Error('Second sqlite cross-instance snapshot control plane did not bind to a TCP port');
      }

      const firstBaseUrl = `http://127.0.0.1:${firstAddress.port}`;
      const secondBaseUrl = `http://127.0.0.1:${secondAddress.port}`;
      const mutationHeaders = (requestId: string) => ({
        'Content-Type': 'application/json',
        'X-Actor': 'admin',
        'X-Operator-Group-Id': 'owner',
        'X-Resource-Group-Id': 'group-premium',
        'X-Request-Id': requestId,
        'Idempotency-Key': requestId.replace('req-', 'idem-')
      });
      const createTask = async (requestId: string, body: unknown) => {
        const response = await fetch(`${secondBaseUrl}/api/v1/tasks`, {
          method: 'POST',
          headers: mutationHeaders(requestId),
          body: JSON.stringify(body)
        });
        const envelope = await response.json();

        expect(response.status).toBe(201);
        return envelope.data;
      };
      const readSnapshot = async () => {
        const response = await fetch(`${firstBaseUrl}/api/v1/snapshot`);
        const envelope = await response.json();

        expect(response.status).toBe(200);
        return envelope.data;
      };

      try {
        const commandResponse = await fetch(`${secondBaseUrl}/api/v1/agents/install-command`, {
          method: 'POST',
          headers: mutationHeaders('req-cross-instance-install-command'),
          body: JSON.stringify({
            installProfile: [...AGENT_INSTALL_PROFILE],
            publicBaseUrl: 'https://panel.example.com/crossInstanceSecurePath'
          })
        });
        const commandEnvelope = await commandResponse.json();
        const agentId = commandEnvelope.data.agentId as string;

        expect(commandResponse.status).toBe(201);

        const registerResponse = await fetch(`${secondBaseUrl}/agent/v1/register`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${commandEnvelope.data.installToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            agentId,
            requestId: 'req-cross-instance-agent-register',
            sessionId: 'sess-cross-instance-agent-register',
            version: '1.0.0-runtime',
            platform: 'linux-x64',
            capabilities: [...AGENT_INSTALL_PROFILE]
          })
        });

        expect(registerResponse.status).toBe(201);

        await createTask('req-cross-instance-agent-update', {
          operation: 'agent.update',
          resourceType: 'agent',
          targetId: agentId,
          targetLabel: 'Cross Instance Edge 01',
          summary: 'Update cross-instance managed host profile',
          metadata: {
            agentId,
            hostName: 'Cross Instance Edge 01',
            maxTrafficGb: 1024,
            monthlyTrafficGb: 512,
            trafficAccountingMode: 'egress',
            monthlyResetDay: 12,
            currentUsedTrafficGb: 64,
            expiresAt: '2026-12-31T00:00:00.000Z',
            pingTarget: '1.1.1.1',
            pingIntervalSeconds: 30
          }
        });
        await createTask('req-cross-instance-inbound-create', {
          operation: 'inbound.create',
          resourceType: 'inbound',
          targetId: 'customer-node-cross-instance-vless',
          targetLabel: 'Cross Instance VLESS Inbound',
          summary: 'Create cross-instance customer Xray inbound',
          metadata: {
            nodeId: 'customer-node-cross-instance-vless',
            agentId,
            customerNodeName: 'Cross Instance VLESS Inbound',
            customerName: 'Cross Instance Customer',
            serverAddress: 'edge-cross-instance.example.com',
            xrayProtocol: 'vless',
            listenPort: 2443,
            clientIdentity: 'cross-instance-client-id',
            clientEmail: 'cross-instance@example.com',
            clientCredential: 'cross-instance-client-id',
            trafficLimitGb: 256,
            remainingDays: 60,
            subscriptionRule: 'tag:cross-instance'
          }
        });
        await createTask('req-cross-instance-subscription-import', {
          operation: 'subscription.import',
          resourceType: 'subscription',
          targetId: 'source-cross-instance-hkg',
          targetLabel: 'Cross Instance HKG Source',
          summary: 'Import cross-instance subscription source',
          metadata: {
            sourceId: 'source-cross-instance-hkg',
            kind: 'mihomo-provider',
            name: 'Cross Instance HKG Source',
            url: 'https://provider.example.com/cross-instance.yaml',
            refreshIntervalMinutes: 30,
            includeFilter: 'premium|hk',
            excludeFilter: 'expired',
            dedupeKey: 'uuid'
          }
        });
        await createTask('req-cross-instance-subscription-client', {
          operation: 'subscription.generate',
          resourceType: 'subscription',
          targetId: 'sub-client-cross-instance',
          targetLabel: 'Cross Instance Client Subscription',
          summary: 'Create cross-instance client subscription rule',
          metadata: {
            subscriptionClientId: 'sub-client-cross-instance',
            customerName: 'Cross Instance Customer',
            displayName: 'Cross Instance Client Subscription',
            subId: 'sub_cross_instance_hkg',
            email: 'cross-instance@example.com',
            protocol: 'vless',
            group: 'premium',
            trafficLimitGb: 256,
            remainingDays: 60,
            sourceIds: ['source-cross-instance-hkg'],
            selectedTags: ['premium'],
            outputFormats: ['uri', 'clash'],
            generatedNodeCount: 1
          }
        });
        await createTask('req-cross-instance-forward-create', {
          operation: 'forward.create',
          resourceType: 'forward',
          targetId: 'forward-cross-instance-2443',
          targetLabel: 'Cross Instance Port Forwarding',
          summary: 'Create cross-instance port forwarding rule',
          metadata: {
            name: 'Cross Instance Port Forwarding',
            ownerName: 'Cross Instance Customer',
            listenAddress: '0.0.0.0',
            listenPort: 2443,
            targetAddress: '10.8.0.10',
            targetPort: 9443,
            protocol: 'tcp',
            entryNodeIds: [agentId],
            quotaGb: 256,
            billingDirection: 'both',
            monthlyResetDay: 12,
            currentUsedTrafficGb: 8,
            rateLimitMbps: 100
          }
        });

        const snapshot = await waitFor(
          readSnapshot,
          (data) =>
            data.agents.some((item: { id: string }) => item.id === agentId) &&
            data.inbounds.some((item: { id: string }) => item.id === 'customer-node-cross-instance-vless') &&
            data.subscriptionSources.some((item: { id: string }) => item.id === 'source-cross-instance-hkg') &&
            data.subscriptionClients.some((item: { id: string }) => item.id === 'sub-client-cross-instance') &&
            data.forwardRules.some((item: { id: string }) => item.id === 'forward-cross-instance-2443'),
          'cross-instance snapshot read-model rebuild'
        );

        expect(snapshot.agents).toEqual([
          expect.objectContaining({
            id: agentId,
            name: 'Cross Instance Edge 01',
            trafficPolicy: expect.objectContaining({
              accountingMode: 'egress',
              monthlyResetDay: 12
            })
          })
        ]);
        expect(snapshot.inbounds).toEqual([
          expect.objectContaining({
            id: 'customer-node-cross-instance-vless',
            agentId,
            customerName: 'Cross Instance Customer',
            protocol: 'vless',
            listenPort: 2443
          })
        ]);
        expect(snapshot.subscriptionSources).toEqual([
          expect.objectContaining({
            id: 'source-cross-instance-hkg',
            name: 'Cross Instance HKG Source',
            url: 'https://provider.example.com/cross-instance.yaml'
          })
        ]);
        expect(snapshot.subscriptionClients).toEqual([
          expect.objectContaining({
            id: 'sub-client-cross-instance',
            customerName: 'Cross Instance Customer',
            subId: 'sub_cross_instance_hkg'
          })
        ]);
        expect(snapshot.forwardRules).toEqual([
          expect.objectContaining({
            id: 'forward-cross-instance-2443',
            ownerName: 'Cross Instance Customer',
            ports: [
              expect.objectContaining({
                agentId,
                listenPort: 2443,
                targetAddress: '10.8.0.10',
                targetPort: 9443
              })
            ]
          })
        ]);
      } finally {
        await new Promise<void>((resolve, reject) => {
          secondControlPlane.server.close((error) => (error ? reject(error) : resolve()));
        });
        await new Promise<void>((resolve, reject) => {
          firstControlPlane.server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('streams live system alert snapshots across sqlite-backed control-plane instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-sqlite-system-alert-stream-'));
    const databaseFilePath = join(directory, 'control-plane.sqlite');
    const readModelNow = () => '2026-06-04T04:01:30.000Z';

    try {
      const firstControlPlane = await createServiceBackedControlPlane({
        storage: 'sqlite',
        databaseFilePath,
        readModelNow,
        seed: {
          permissionGrants: seedPermissionGrants
        },
        inventory: {
          agents: []
        }
      });

      await new Promise<void>((resolve) => {
        firstControlPlane.server.listen(0, '127.0.0.1', resolve);
      });

      const firstAddress = firstControlPlane.server.address();

      if (!firstAddress || typeof firstAddress === 'string') {
        throw new Error('First sqlite system-alert-stream control plane did not bind to a TCP port');
      }

      const secondControlPlane = await createServiceBackedControlPlane({
        storage: 'sqlite',
        databaseFilePath,
        readModelNow,
        seed: {
          permissionGrants: seedPermissionGrants
        },
        inventory: {
          agents: []
        }
      });

      const eventsResponse = await fetch(`http://127.0.0.1:${firstAddress.port}/events/v1/system-alerts`, {
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
        await secondControlPlane.api.receiveAgentEvent({
          type: 'heartbeat',
          eventId: 'evt-sqlite-cross-instance-alert-heartbeat',
          agentId: 'agent-cross-instance-alert-01',
          seq: 1,
          sessionId: 'sess-cross-instance-alert-01',
          observedAt: '2026-06-04T04:00:00.000Z',
          payload: {
            version: '1.0.0-runtime',
            uptimeSeconds: 1800,
            capabilities: ['host-agent', 'xray'],
            lastSeenCommandSeq: 0
          }
        });

        eventStream = await readStreamUntil(reader, '"resourceId":"agent-cross-instance-alert-01"', eventStream, 7000);

        expect(eventStream).toContain('event: system_alert.snapshot');
        expect(eventStream).toContain('"kind":"agent.telemetry_sampling_gap"');
      } finally {
        await reader.cancel();
        if (firstControlPlane.server.listening) {
          await new Promise<void>((resolve, reject) => {
            firstControlPlane.server.close((error) => (error ? reject(error) : resolve()));
          });
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 12_000);

  it('streams live task and audit events across sqlite-backed control-plane instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-sqlite-task-stream-'));
    const databaseFilePath = join(directory, 'control-plane.sqlite');

    try {
      const firstControlPlane = await createServiceBackedControlPlane({
        storage: 'sqlite',
        databaseFilePath,
        seed: {
          permissionGrants: seedPermissionGrants
        }
      });

      await new Promise<void>((resolve) => {
        firstControlPlane.server.listen(0, '127.0.0.1', resolve);
      });

      const firstAddress = firstControlPlane.server.address();

      if (!firstAddress || typeof firstAddress === 'string') {
        throw new Error('First sqlite task-stream control plane did not bind to a TCP port');
      }

      const secondControlPlane = await createServiceBackedControlPlane({
        storage: 'sqlite',
        databaseFilePath,
        seed: {
          permissionGrants: seedPermissionGrants
        }
      });

      await new Promise<void>((resolve) => {
        secondControlPlane.server.listen(0, '127.0.0.1', resolve);
      });

      const secondAddress = secondControlPlane.server.address();

      if (!secondAddress || typeof secondAddress === 'string') {
        throw new Error('Second sqlite task-stream control plane did not bind to a TCP port');
      }

      const firstBaseUrl = `http://127.0.0.1:${firstAddress.port}`;
      const secondBaseUrl = `http://127.0.0.1:${secondAddress.port}`;
      const eventsResponse = await fetch(`${firstBaseUrl}/events/v1/tasks`, {
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
        const createResponse = await fetch(`${secondBaseUrl}/api/v1/tasks`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Actor': 'admin',
            'X-Operator-Group-Id': 'owner',
            'X-Resource-Group-Id': 'group-premium',
            'X-Request-Id': 'req-sqlite-cross-instance-task-stream',
            'Idempotency-Key': 'idem-sqlite-cross-instance-task-stream'
          },
          body: JSON.stringify({
            operation: 'subscription.import',
            resourceType: 'subscription',
            targetId: 'source-cross-instance-stream',
            targetLabel: 'Cross Instance Stream Source',
            summary: 'Create task from a sibling sqlite-backed instance',
            metadata: {
              sourceId: 'source-cross-instance-stream',
              kind: 'mihomo-provider',
              name: 'Cross Instance Stream Source',
              url: 'https://provider.example.com/cross-instance.yaml',
              refreshIntervalMinutes: 30,
              dedupeKey: 'uuid'
            }
          })
        });
        const createEnvelope = await createResponse.json();

        expect(createResponse.status).toBe(201);

        eventStream = await readStreamUntil(reader, `"taskId":"${createEnvelope.data.id}"`, eventStream);

        expect(eventStream).toContain('event: task.status.changed');
        expect(eventStream).toContain('event: audit.summary');
      } finally {
        await reader.cancel();
        await new Promise<void>((resolve, reject) => {
          secondControlPlane.server.close((error) => (error ? reject(error) : resolve()));
        });
        await new Promise<void>((resolve, reject) => {
          firstControlPlane.server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
