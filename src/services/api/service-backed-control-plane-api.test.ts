import { createControlPlaneService } from '../../server/control-plane/control-plane-service';
import { createInMemoryControlPlaneRepository } from '../../server/control-plane/in-memory-control-plane-repository';
import { createControlPlaneTestClock } from '../../test/control-plane-clock';
import {
  AGENT_INSTALL_PROFILE,
  type CreateTaskInput,
  type ForwardRule,
  type SubscriptionClientIdentity,
  type SubscriptionInventoryNode,
  type XrayInbound
} from '../../domain';
import { seedForwardRules, seedPermissionGrants } from '../mock/mock-data';
import type { CommandOutboxItem } from './control-plane-api';
import { createServiceBackedControlPlaneApi } from './service-backed-control-plane-api';

const GB = 1024 ** 3;

function mutationContext(id: string) {
  return {
    actor: 'admin',
    operatorGroupId: 'owner',
    resourceGroupId: 'group-premium',
    sourceIp: '127.0.0.1',
    requestId: `req-${id}`,
    idempotencyKey: `idem-${id}`
  };
}

function withRiskConfirmation<T extends CreateTaskInput>(
  input: T
): T & { riskConfirmation: NonNullable<CreateTaskInput['riskConfirmation']> } {
  return {
    ...input,
    riskConfirmation: {
      operation: input.operation,
      targetId: input.targetId
    }
  };
}

function createCommandOutboxItem(overrides: Partial<CommandOutboxItem> = {}): CommandOutboxItem {
  return {
    id: 'outbox-alert-command-001',
    taskId: 'task-alert-command-001',
    commandId: 'cmd-alert-command-001',
    agentId: 'agent-alert-command-01',
    seq: 1,
    status: 'pending',
    transport: 'http-pull',
    command: {} as CommandOutboxItem['command'],
    attempts: 1,
    createdAt: '2026-06-04T04:00:00.000Z',
    updatedAt: '2026-06-04T04:00:10.000Z',
    deadlineAt: '2026-06-04T04:01:00.000Z',
    ...overrides
  };
}

async function importSubscriptionSource(
  api: ReturnType<typeof createServiceBackedControlPlaneApi>,
  input: { sourceId: string; name: string; url: string; fetchTimeoutSeconds?: number; maxBodyBytes?: number }
) {
  await api.createTask(
    {
      operation: 'subscription.import',
      resourceType: 'subscription',
      targetId: input.sourceId,
      targetLabel: input.name,
      summary: `Import ${input.name}`,
      metadata: {
        sourceId: input.sourceId,
        kind: 'clash',
        name: input.name,
        url: input.url,
        refreshIntervalMinutes: 30,
        ...(input.fetchTimeoutSeconds ? { fetchTimeoutSeconds: input.fetchTimeoutSeconds } : {}),
        ...(input.maxBodyBytes ? { maxBodyBytes: input.maxBodyBytes } : {}),
        dedupeKey: 'server-port'
      }
    },
    mutationContext(`subscription-import-${input.sourceId}`)
  );
}

async function allowPublicSubscriptionHostResolver() {
  return [{ address: '93.184.216.34', family: 4 as const }];
}

async function completeTaskCommand(
  api: ReturnType<typeof createServiceBackedControlPlaneApi>,
  taskId: string,
  sessionId: string,
  startSeq: number,
  eventPrefix: string
) {
  const [outboxItem] = (await api.listCommandOutbox()).filter((item) => item.taskId === taskId);

  if (!outboxItem) {
    throw new Error(`Command outbox item not found for task: ${taskId}`);
  }

  const ackObservedAt = new Date(Date.parse(outboxItem.deadlineAt) - 30_000).toISOString();
  const resultObservedAt = new Date(Date.parse(outboxItem.deadlineAt) - 15_000).toISOString();

  await api.receiveAgentEvent({
    type: 'ack',
    eventId: `${eventPrefix}-ack`,
    commandId: outboxItem.commandId,
    taskId,
    agentId: outboxItem.agentId,
    seq: startSeq,
    sessionId,
    observedAt: ackObservedAt,
    payload: {
      duplicate: false
    }
  });

  await api.receiveAgentEvent({
    type: 'result',
    eventId: `${eventPrefix}-result`,
    commandId: outboxItem.commandId,
    taskId,
    agentId: outboxItem.agentId,
    seq: startSeq + 1,
    sessionId,
    observedAt: resultObservedAt,
    payload: {
      status: 'succeeded',
      appliedConfigRevision: outboxItem.command.type === 'apply' ? outboxItem.command.payload.configRevision : undefined
    }
  });

  return startSeq + 2;
}

function createCustomerDirectoryInbound(): XrayInbound {
  return {
    id: 'customer-node-alpha-hkg',
    nodeId: 'customer-node-alpha-hkg',
    agentId: 'agent-hkg-01',
    customerName: '客户甲',
    protocol: 'vless',
    label: '客户甲香港入口',
    listenAddress: '0.0.0.0',
    listenPort: 443,
    status: 'enabled',
    clients: [
      {
        id: 'client-alpha-hkg',
        email: 'alpha-node@example.com',
        enabled: true,
        trafficLimitBytes: 10 * GB,
        usedTrafficBytes: 4 * GB,
        lastTrafficSampleAt: '2026-06-05T10:05:00.000Z',
        expiresAt: '2026-12-31T00:00:00.000Z',
        ipLimit: 2
      }
    ],
    streamSettings: {
      network: 'tcp',
      security: 'reality'
    },
    tls: {
      enabled: false,
      alpn: []
    },
    reality: {
      enabled: true,
      shortIds: ['alpha'],
      serverNames: ['edge.example.com']
    },
    fallbacks: [],
    sniffingEnabled: true,
    configVersion: 'cfg-alpha-hkg'
  };
}

function createCustomerDirectorySubscriptionClient(): SubscriptionClientIdentity {
  return {
    id: 'sub-client-alpha',
    customerName: '客户甲',
    displayName: '客户甲外部订阅',
    subId: 'sub_alpha',
    email: 'alpha-subscription@example.com',
    enabled: true,
    protocol: 'vless',
    group: 'premium',
    trafficLimitBytes: 12 * GB,
    usedTrafficBytes: 6 * GB,
    expiresAt: '2026-11-30T00:00:00.000Z',
    ipLimit: 2,
    requestLimitPerHour: 360,
    sourceIds: ['source-alpha-external'],
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
    accessTokenPreview: 'sub_alpha',
    securePathPreview: '/sub-alpha',
    generatedNodeCount: 1,
    lastGeneratedAt: '2026-06-05T10:07:00.000Z'
  };
}

function createCustomerDirectorySubscriptionNode(): SubscriptionInventoryNode {
  return {
    id: 'external-node-alpha-hkg',
    sourceId: 'source-alpha-external',
    name: '客户甲外部节点',
    protocol: 'vless',
    server: '203.0.113.10',
    port: 443,
    latencyMs: 48,
    tags: ['premium'],
    status: 'online',
    customerName: '客户甲',
    usedTrafficBytes: 6 * GB,
    trafficLimitBytes: 12 * GB,
    expiresAt: '2026-11-30T00:00:00.000Z',
    rawUrl: 'vless://00000000-0000-4000-8000-000000000000@203.0.113.10:443#alpha'
  };
}

function createCustomerDirectoryForwardRule(): ForwardRule {
  return {
    id: 'forward-alpha-game',
    tunnelId: 'tunnel-alpha',
    name: '客户甲游戏端口转发',
    ownerName: '客户甲',
    strategy: 'fifo',
    enabled: true,
    ports: [
      {
        agentId: 'agent-hkg-01',
        listenAddress: '0.0.0.0',
        listenPort: 2443,
        targetAddress: '10.0.0.8',
        targetPort: 9443,
        protocol: 'tcp',
        status: 'allocated',
        inboundBytes: 1 * GB,
        outboundBytes: 2 * GB,
        lastCounterSampleAt: '2026-06-05T10:10:00.000Z'
      }
    ],
    portStatus: 'allocated',
    billingDirection: 'both',
    trafficMultiplier: 1,
    monthlyResetDay: 1,
    manualUsedBytes: 0,
    quotaBytes: 8 * GB,
    quotaPolicyId: 'quota-alpha-forwarding',
    rateLimitPolicyId: 'rate-alpha-forwarding',
    maxConnections: 100,
    maxConnectionsPerIp: 10,
    proxyProtocol: false,
    tunnelMode: 'direct',
    pricePerGb: 0,
    inboundBytes: 1 * GB,
    outboundBytes: 2 * GB
  };
}

describe('service-backed control plane read model hydration', () => {
  it('derives customers from decoupled service-backed read models without seed customer records', async () => {
    const repository = createInMemoryControlPlaneRepository({
      permissionGrants: seedPermissionGrants,
      forwardRules: [createCustomerDirectoryForwardRule()]
    });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => '2026-06-05T10:15:00.000Z',
      inventory: {
        inbounds: [createCustomerDirectoryInbound()],
        subscriptionClients: [createCustomerDirectorySubscriptionClient()],
        subscriptionInventoryNodes: [createCustomerDirectorySubscriptionNode()]
      }
    });

    await expect(api.listCustomers()).resolves.toEqual([
      expect.objectContaining({
        name: '客户甲',
        status: 'active',
        sourceKinds: ['customer-node', 'forwarding', 'subscription'],
        customerNodeCount: 1,
        subscriptionClientCount: 1,
        forwardRuleCount: 1,
        agentIds: ['agent-hkg-01'],
        customerNodeIds: ['customer-node-alpha-hkg'],
        subscriptionClientIds: ['sub-client-alpha'],
        forwardRuleIds: ['forward-alpha-game'],
        customerNodeUsedTrafficBytes: 4 * GB,
        customerNodeTrafficLimitBytes: 10 * GB,
        subscriptionUsedTrafficBytes: 6 * GB,
        subscriptionTrafficLimitBytes: 12 * GB,
        forwardingUsedTrafficBytes: 3 * GB,
        forwardingTrafficLimitBytes: 8 * GB,
        usedTrafficBytes: 9 * GB,
        trafficLimitBytes: 20 * GB,
        expiresAt: '2026-11-30T00:00:00.000Z',
        lastActivityAt: '2026-06-05T10:10:00.000Z',
        quotaExceeded: false,
        runtimeDisabledByPolicy: false
      })
    ]);
  });

  it('derives quota policies from managed-host, customer-node, and forwarding read models', async () => {
    const repository = createInMemoryControlPlaneRepository({
      permissionGrants: seedPermissionGrants,
      forwardRules: [
        {
          id: 'forward-rule-01',
          tunnelId: 'tunnel-01',
          name: 'Tokyo Game Forwarding',
          ownerName: 'Acme',
          strategy: 'fifo',
          enabled: true,
          ports: [
            {
              agentId: 'agent-hkg-01',
              listenAddress: '0.0.0.0',
              listenPort: 2443,
              targetAddress: '10.8.0.10',
              targetPort: 9443,
              protocol: 'tcp',
              status: 'allocated',
              inboundBytes: 4 * 1024 ** 3,
              outboundBytes: 3 * 1024 ** 3,
              lastCounterSampleAt: '2026-06-05T10:10:00.000Z'
            }
          ],
          portStatus: 'allocated',
          billingDirection: 'both',
          trafficMultiplier: 1,
          monthlyResetDay: 9,
          manualUsedBytes: 0,
          quotaBytes: 6 * 1024 ** 3,
          quotaPolicyId: 'quota-acme-account',
          rateLimitPolicyId: 'rate-acme-account',
          maxConnections: 100,
          maxConnectionsPerIp: 10,
          proxyProtocol: false,
          tunnelMode: 'direct',
          pricePerGb: 0,
          inboundBytes: 4 * 1024 ** 3,
          outboundBytes: 3 * 1024 ** 3,
          quotaExceeded: true,
          runtimeDisabledByPolicy: true,
          guardrailReason: 'rule_monthly_quota_exceeded'
        }
      ]
    });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => '2026-06-05T10:15:00.000Z',
      inventory: {
        agents: [
          {
            id: 'agent-hkg-01',
            name: '香港入口主机',
            status: 'online',
            region: 'hk',
            publicAddress: '198.51.100.10',
            connectionMode: 'pull',
            version: '1.0.0-runtime',
            platform: 'linux/amd64',
            capabilities: ['host-agent', 'xray', 'port-forwarding'],
            maxTrafficBytes: 120 * 1024 ** 3,
            monthlyTrafficLimitBytes: 60 * 1024 ** 3,
            expiresAt: '2026-12-31T00:00:00.000Z',
            probeConfig: {
              pingTarget: '1.1.1.1',
              pingIntervalSeconds: 30,
              latencyGreenMaxMs: 100,
              latencyYellowMaxMs: 200
            },
            trafficPolicy: {
              accountingMode: 'both',
              monthlyResetDay: 9,
              manualUsedTrafficBytes: 0,
              telemetrySource: 'agent'
            },
            hardware: {},
            lastHeartbeatAt: '2026-06-05T10:00:00.000Z',
            telemetry: {
              cpuPercent: 12,
              cpuCores: 4,
              memoryPercent: 30,
              memoryUsedBytes: 2 * 1024 ** 3,
              memoryTotalBytes: 8 * 1024 ** 3,
              diskUsedBytes: 12 * 1024 ** 3,
              diskTotalBytes: 64 * 1024 ** 3,
              txBytes: 12 * 1024 ** 3,
              rxBytes: 6 * 1024 ** 3,
              monthlyIngressBytes: 6 * 1024 ** 3,
              monthlyEgressBytes: 12 * 1024 ** 3,
              monthlyTrafficUsedBytes: 18 * 1024 ** 3,
              uploadSpeedBps: 0,
              downloadSpeedBps: 0,
              uploadTotalBytes: 12 * 1024 ** 3,
              downloadTotalBytes: 6 * 1024 ** 3,
              latencyMs: 42,
              latencySamplesMs: [40, 42],
              packetLossPercent: 0,
              packetLossSamplesPercent: [0],
              onlineDays: 12,
              reportedAt: '2026-06-05T10:00:00.000Z'
            }
          }
        ],
        inbounds: [
          {
            id: 'customer-node-01',
            nodeId: 'customer-node-01',
            agentId: 'agent-hkg-01',
            customerName: 'Acme',
            protocol: 'vless',
            label: '客户节点 A',
            listenAddress: '0.0.0.0',
            listenPort: 443,
            status: 'enabled',
            clients: [
              {
                id: 'client-a',
                email: 'customer-a@example.com',
                enabled: true,
                trafficLimitBytes: 8 * 1024 ** 3,
                usedTrafficBytes: 8 * 1024 ** 3,
                monthlyResetDay: 9,
                lastTrafficSampleAt: '2026-06-05T10:05:00.000Z',
                quotaExceeded: true,
                runtimeDisabledByPolicy: true,
                guardrailReason: 'xray_client_monthly_quota_exceeded',
                expiresAt: '2026-12-31T00:00:00.000Z',
                ipLimit: 2,
                resetPolicy: 'monthly'
              }
            ],
            streamSettings: {
              network: 'tcp',
              security: 'reality'
            },
            tls: {
              enabled: false,
              alpn: []
            },
            reality: {
              enabled: true,
              shortIds: ['ouui'],
              serverNames: ['edge.example.com']
            },
            fallbacks: [],
            sniffingEnabled: true,
            configVersion: 'cfg-001'
          }
        ],
        quotaPolicies: [
          {
            id: 'quota-acme-account',
            name: 'Acme Forwarding Account',
            scope: 'forwarding-account',
            limitBytes: 16 * 1024 ** 3,
            usedBytes: 0,
            resetWindow: 'monthly',
            billingDirection: 'both',
            enforcementState: 'active'
          }
        ]
      }
    });

    await expect(api.listQuotaPolicies()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'managed-host:agent-hkg-01',
          scope: 'managed-host',
          usedBytes: 18 * 1024 ** 3
        }),
        expect.objectContaining({
          id: 'customer-node:customer-node-01:client-a',
          scope: 'customer-node',
          enforcementState: 'disabled_by_quota'
        }),
        expect.objectContaining({
          id: 'forward-rule:forward-rule-01',
          scope: 'forward-rule',
          usedBytes: 7 * 1024 ** 3
        }),
        expect.objectContaining({
          id: 'quota-acme-account',
          scope: 'forwarding-account',
          usedBytes: 7 * 1024 ** 3,
          limitBytes: 16 * 1024 ** 3
        })
      ])
    );
  });

  it('resets managed-host quota state and only counts post-reset telemetry', async () => {
    const repository = createInMemoryControlPlaneRepository({
      permissionGrants: seedPermissionGrants
    });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => '2026-06-05T10:15:00.000Z',
      inventory: {
        agents: [
          {
            id: 'agent-hkg-01',
            name: '香港入口主机',
            status: 'online',
            region: 'hk',
            publicAddress: '198.51.100.10',
            connectionMode: 'pull',
            version: '1.0.0-runtime',
            platform: 'linux/amd64',
            capabilities: ['host-agent', 'xray', 'port-forwarding'],
            maxTrafficBytes: 120 * GB,
            monthlyTrafficLimitBytes: 60 * GB,
            expiresAt: '2026-12-31T00:00:00.000Z',
            probeConfig: {
              pingTarget: '1.1.1.1',
              pingIntervalSeconds: 30,
              latencyGreenMaxMs: 100,
              latencyYellowMaxMs: 200
            },
            trafficPolicy: {
              accountingMode: 'both',
              monthlyResetDay: 9,
              manualUsedTrafficBytes: 18 * GB,
              telemetrySource: 'agent'
            },
            hardware: {},
            lastHeartbeatAt: '2026-06-05T10:00:00.000Z',
            telemetry: {
              cpuPercent: 12,
              cpuCores: 4,
              memoryPercent: 30,
              memoryUsedBytes: 2 * GB,
              memoryTotalBytes: 8 * GB,
              diskUsedBytes: 12 * GB,
              diskTotalBytes: 64 * GB,
              txBytes: 12 * GB,
              rxBytes: 6 * GB,
              monthlyIngressBytes: 6 * GB,
              monthlyEgressBytes: 12 * GB,
              monthlyTrafficUsedBytes: 18 * GB,
              uploadSpeedBps: 0,
              downloadSpeedBps: 0,
              uploadTotalBytes: 12 * GB,
              downloadTotalBytes: 6 * GB,
              latencyMs: 42,
              latencySamplesMs: [40, 42],
              packetLossPercent: 0,
              packetLossSamplesPercent: [0],
              onlineDays: 12,
              reportedAt: '2026-06-05T10:00:00.000Z'
            }
          }
        ]
      }
    });

    expect((await api.listQuotaPolicies()).find((policy) => policy.id === 'managed-host:agent-hkg-01')).toMatchObject({
      usedBytes: 18 * GB,
      enforcementState: 'active'
    });

    await api.createTask(
      withRiskConfirmation({
        operation: 'quota.reset',
        resourceType: 'quota',
        targetId: 'managed-host:agent-hkg-01',
        targetLabel: '香港入口主机',
        summary: 'Reset managed-host quota'
      }),
      mutationContext('quota-reset-managed-host')
    );

    expect((await api.listQuotaPolicies()).find((policy) => policy.id === 'managed-host:agent-hkg-01')).toMatchObject({
      usedBytes: 0,
      enforcementState: 'active'
    });

    await expect(api.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'quota.reset',
          before: expect.objectContaining({
            id: 'managed-host:agent-hkg-01',
            usedBytes: 18 * GB
          }),
          after: expect.objectContaining({
            usedBytes: 0
          })
        })
      ])
    );

    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-managed-host-reset-after',
      agentId: 'agent-hkg-01',
      seq: 1,
      sessionId: 'sess-agent-hkg-01',
      observedAt: '2026-06-05T10:20:00.000Z',
      payload: {
        monthlyIngressBytes: 7 * GB,
        monthlyEgressBytes: 13 * GB,
        monthlyTrafficUsedBytes: 20 * GB,
        manualUsedTrafficBytes: 20 * GB,
        trafficAccountingMode: 'both',
        monthlyResetDay: 9,
        reportedAt: '2026-06-05T10:20:00.000Z'
      }
    });

    expect((await api.listQuotaPolicies()).find((policy) => policy.id === 'managed-host:agent-hkg-01')).toMatchObject({
      usedBytes: 2 * GB,
      enforcementState: 'active'
    });
  });

  it('creates system quota-enforcement tasks to pause and resume forwarding rules around quota recovery', async () => {
    const repository = createInMemoryControlPlaneRepository({
      permissionGrants: seedPermissionGrants,
      forwardRules: [
        {
          ...seedForwardRules[0],
          quotaBytes: 1024,
          inboundBytes: 0,
          outboundBytes: 0,
          manualUsedBytes: 0
        }
      ]
    });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => '2026-06-05T10:30:00.000Z',
      inventory: {
        agents: []
      }
    });

    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-forward-auto-quota-telemetry',
      agentId: 'agent-hkg-01',
      seq: 1,
      sessionId: 'sess-forward-auto-quota',
      observedAt: '2026-06-05T10:30:00.000Z',
      payload: {
        forwardingCounters: [
          {
            ruleId: 'forward-hkg-443',
            agentId: 'agent-hkg-01',
            inboundBytes: 600,
            outboundBytes: 600,
            sampledAt: '2026-06-05T10:30:00.000Z',
            source: 'nftables'
          }
        ]
      }
    });

    const pauseTask = (await api.listTasks()).find(
      (task) => task.operation === 'forward.pause' && task.targetId === 'forward-hkg-443' && task.actor === 'system:quota-enforcer'
    );

    expect(pauseTask).toMatchObject({
      operation: 'forward.pause',
      targetId: 'forward-hkg-443',
      actor: 'system:quota-enforcer',
      metadata: expect.objectContaining({
        quotaEnforcementAutomatic: true,
        quotaEnforcementAction: 'pause',
        quotaEnforcementPolicyId: 'forward-rule:forward-hkg-443',
        quotaEnforcementTriggerKind: 'agent-event',
        quotaEnforcementTriggerId: 'evt-forward-auto-quota-telemetry'
      })
    });
    expect((await api.listForwardRules()).find((rule) => rule.id === 'forward-hkg-443')).toMatchObject({
      enabled: false,
      portStatus: 'releasing',
      quotaExceeded: true,
      runtimeDisabledByPolicy: true
    });

    const nextSeq = await completeTaskCommand(
      api,
      pauseTask?.id ?? '',
      'sess-forward-auto-quota',
      2,
      'evt-forward-auto-pause'
    );

    await api.resetQuotaPolicy('forward-rule:forward-hkg-443', mutationContext('forward-rule-quota-reset'));

    const resumeTask = (await api.listTasks()).find(
      (task) =>
        task.operation === 'forward.resume' && task.targetId === 'forward-hkg-443' && task.actor === 'system:quota-enforcer'
    );

    expect(resumeTask).toMatchObject({
      operation: 'forward.resume',
      targetId: 'forward-hkg-443',
      actor: 'system:quota-enforcer',
      metadata: expect.objectContaining({
        quotaEnforcementAutomatic: true,
        quotaEnforcementAction: 'resume',
        quotaEnforcementPolicyId: 'forward-rule:forward-hkg-443',
        quotaEnforcementTriggerKind: 'task'
      })
    });
    expect((await api.listForwardRules()).find((rule) => rule.id === 'forward-hkg-443')).toMatchObject({
      enabled: true,
      portStatus: 'deploying',
      quotaExceeded: false,
      runtimeDisabledByPolicy: false
    });

    await completeTaskCommand(
      api,
      resumeTask?.id ?? '',
      'sess-forward-auto-quota',
      nextSeq,
      'evt-forward-auto-resume'
    );

    expect((await api.listForwardRules()).find((rule) => rule.id === 'forward-hkg-443')).toMatchObject({
      enabled: true,
      portStatus: 'allocated',
      quotaExceeded: false,
      runtimeDisabledByPolicy: false,
      guardrailReason: 'ok'
    });
  });

  it('creates forwarding-account quota-enforcement tasks for member forwarding rules', async () => {
    const repository = createInMemoryControlPlaneRepository({
      permissionGrants: seedPermissionGrants,
      forwardRules: [
        {
          ...seedForwardRules[0],
          quotaBytes: 32 * GB,
          inboundBytes: 0,
          outboundBytes: 0,
          manualUsedBytes: 0
        }
      ]
    });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => '2026-06-05T10:45:00.000Z',
      inventory: {
        agents: [],
        quotaPolicies: [
          {
            id: 'quota-forwarding-01',
            name: '端口转发账号高级配额',
            scope: 'forwarding-account',
            limitBytes: 1024,
            usedBytes: 0,
            resetWindow: 'monthly',
            billingDirection: 'both',
            enforcementState: 'active'
          }
        ]
      }
    });

    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-forward-account-auto-quota-telemetry',
      agentId: 'agent-hkg-01',
      seq: 1,
      sessionId: 'sess-forward-account-auto-quota',
      observedAt: '2026-06-05T10:45:00.000Z',
      payload: {
        forwardingCounters: [
          {
            ruleId: 'forward-hkg-443',
            agentId: 'agent-hkg-01',
            inboundBytes: 600,
            outboundBytes: 600,
            sampledAt: '2026-06-05T10:45:00.000Z',
            source: 'nftables'
          }
        ]
      }
    });

    const pauseTask = (await api.listTasks()).find(
      (task) =>
        task.operation === 'forward.pause'
        && task.targetId === 'forward-hkg-443'
        && task.actor === 'system:quota-enforcer'
        && task.metadata?.quotaEnforcementPolicyId === 'quota-forwarding-01'
    );

    expect(pauseTask).toMatchObject({
      operation: 'forward.pause',
      targetId: 'forward-hkg-443',
      actor: 'system:quota-enforcer',
      metadata: expect.objectContaining({
        quotaEnforcementAutomatic: true,
        quotaEnforcementAction: 'pause',
        quotaEnforcementPolicyId: 'quota-forwarding-01',
        quotaEnforcementPolicyScope: 'forwarding-account',
        quotaEnforcementTriggerKind: 'agent-event',
        quotaEnforcementTriggerId: 'evt-forward-account-auto-quota-telemetry'
      })
    });
    expect((await api.listQuotaPolicies()).find((policy) => policy.id === 'quota-forwarding-01')).toMatchObject({
      enforcementState: 'exceeded',
      guardrailReason: 'forwarding_account_monthly_quota_exceeded'
    });

    const nextSeq = await completeTaskCommand(
      api,
      pauseTask?.id ?? '',
      'sess-forward-account-auto-quota',
      2,
      'evt-forward-account-auto-pause'
    );

    await api.resetQuotaPolicy('quota-forwarding-01', mutationContext('forward-account-quota-reset'));

    const resumeTask = (await api.listTasks()).find(
      (task) =>
        task.operation === 'forward.resume'
        && task.targetId === 'forward-hkg-443'
        && task.actor === 'system:quota-enforcer'
        && task.metadata?.quotaEnforcementPolicyId === 'quota-forwarding-01'
    );

    expect(resumeTask).toMatchObject({
      operation: 'forward.resume',
      targetId: 'forward-hkg-443',
      actor: 'system:quota-enforcer',
      metadata: expect.objectContaining({
        quotaEnforcementAutomatic: true,
        quotaEnforcementAction: 'resume',
        quotaEnforcementPolicyId: 'quota-forwarding-01',
        quotaEnforcementPolicyScope: 'forwarding-account',
        quotaEnforcementTriggerKind: 'task'
      })
    });

    await completeTaskCommand(
      api,
      resumeTask?.id ?? '',
      'sess-forward-account-auto-quota',
      nextSeq,
      'evt-forward-account-auto-resume'
    );

    expect((await api.listForwardRules()).find((rule) => rule.id === 'forward-hkg-443')).toMatchObject({
      enabled: true,
      portStatus: 'allocated',
      quotaExceeded: false,
      runtimeDisabledByPolicy: false
    });
    expect((await api.listQuotaPolicies()).find((policy) => policy.id === 'quota-forwarding-01')).toMatchObject({
      enforcementState: 'active',
      usedBytes: 0
    });
  });

  it('creates system inbound guardrail tasks for customer-node quota disable and recovery', async () => {
    const repository = createInMemoryControlPlaneRepository({
      permissionGrants: seedPermissionGrants
    });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => '2026-06-05T11:00:00.000Z',
      inventory: {
        inbounds: [
          {
            id: 'customer-node-hkg-01',
            nodeId: 'customer-node-hkg-01',
            agentId: 'agent-hkg-01',
            customerName: 'Acme',
            protocol: 'vless',
            label: 'Acme Premium HK',
            listenAddress: '0.0.0.0',
            listenPort: 443,
            status: 'enabled',
            clients: [
              {
                id: 'client-a',
                email: 'acme@example.com',
                enabled: true,
                trafficLimitBytes: 8 * GB,
                usedTrafficBytes: 0,
                manualUsedTrafficBytes: 0,
                monthlyResetDay: 9,
                expiresAt: '2026-12-31T00:00:00.000Z',
                ipLimit: 2,
                resetPolicy: 'monthly'
              }
            ],
            streamSettings: {
              network: 'tcp',
              security: 'reality',
              sni: 'edge.example.com',
              fingerprint: 'chrome'
            },
            tls: {
              enabled: false,
              alpn: []
            },
            reality: {
              enabled: true,
              publicKey: 'reality-public-key',
              shortIds: ['ouui'],
              serverNames: ['edge.example.com']
            },
            fallbacks: [],
            sniffingEnabled: true,
            configVersion: 'cfg-customer-node-hkg-01'
          }
        ]
      }
    });

    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-customer-node-auto-quota-telemetry',
      agentId: 'agent-hkg-01',
      seq: 1,
      sessionId: 'sess-customer-node-auto-quota',
      observedAt: '2026-06-05T11:00:00.000Z',
      payload: {
        xrayClientCounters: [
          {
            inboundId: 'customer-node-hkg-01',
            clientEmail: 'acme@example.com',
            usedTrafficBytes: 9 * GB,
            uplinkBytes: 4 * GB,
            downlinkBytes: 5 * GB,
            trafficLimitBytes: 8 * GB,
            monthlyResetDay: 9,
            quotaExceeded: true,
            runtimeDisabledByPolicy: true,
            guardrailReason: 'xray_client_monthly_quota_exceeded',
            sampledAt: '2026-06-05T11:00:00.000Z',
            source: 'xray-stats'
          }
        ]
      }
    });

    const disableTask = (await api.listTasks()).find(
      (task) =>
        task.operation === 'inbound.update'
        && task.targetId === 'customer-node-hkg-01'
        && task.actor === 'system:quota-enforcer'
        && task.metadata?.xrayGuardrailPolicyId === 'customer-node:customer-node-hkg-01:client-a'
    );

    expect(disableTask).toMatchObject({
      operation: 'inbound.update',
      targetId: 'customer-node-hkg-01',
      actor: 'system:quota-enforcer',
      metadata: expect.objectContaining({
        enabled: false,
        xrayGuardrailAutomatic: true,
        xrayGuardrailAction: 'disable',
        xrayGuardrailPolicyId: 'customer-node:customer-node-hkg-01:client-a',
        xrayGuardrailPolicyScope: 'customer-node',
        xrayGuardrailTriggerKind: 'agent-event',
        xrayGuardrailTriggerId: 'evt-customer-node-auto-quota-telemetry',
        xrayGuardrailReason: 'xray_client_monthly_quota_exceeded'
      })
    });
    expect((await api.listCommandOutbox()).find((item) => item.taskId === disableTask?.id)).toMatchObject({
      taskId: disableTask?.id,
      agentId: 'agent-hkg-01',
      command: {
        type: 'apply',
        payload: expect.objectContaining({
          moduleKind: 'xray'
        })
      }
    });
    expect((await api.listInbounds()).find((inbound) => inbound.id === 'customer-node-hkg-01')).toMatchObject({
      status: 'disabled',
      clients: [
        expect.objectContaining({
          enabled: false,
          quotaExceeded: true,
          runtimeDisabledByPolicy: true,
          guardrailReason: 'xray_client_monthly_quota_exceeded'
        })
      ]
    });

    const nextSeq = await completeTaskCommand(
      api,
      disableTask?.id ?? '',
      'sess-customer-node-auto-quota',
      2,
      'evt-customer-node-auto-disable'
    );

    await api.resetQuotaPolicy('customer-node:customer-node-hkg-01:client-a', mutationContext('customer-node-quota-reset'));

    const resumeTask = (await api.listTasks()).find(
      (task) =>
        task.operation === 'inbound.update'
        && task.targetId === 'customer-node-hkg-01'
        && task.actor === 'system:quota-enforcer'
        && task.metadata?.xrayGuardrailAction === 'resume'
    );

    expect(resumeTask).toMatchObject({
      operation: 'inbound.update',
      targetId: 'customer-node-hkg-01',
      actor: 'system:quota-enforcer',
      metadata: expect.objectContaining({
        enabled: true,
        xrayGuardrailAutomatic: true,
        xrayGuardrailAction: 'resume',
        xrayGuardrailPolicyId: 'customer-node:customer-node-hkg-01:client-a',
        xrayGuardrailPolicyScope: 'customer-node',
        xrayGuardrailTriggerKind: 'task'
      })
    });
    expect((await api.listInbounds()).find((inbound) => inbound.id === 'customer-node-hkg-01')).toMatchObject({
      status: 'applying',
      clients: [
        expect.objectContaining({
          enabled: true,
          quotaExceeded: false,
          runtimeDisabledByPolicy: false,
          guardrailReason: 'ok'
        })
      ]
    });

    await completeTaskCommand(
      api,
      resumeTask?.id ?? '',
      'sess-customer-node-auto-quota',
      nextSeq,
      'evt-customer-node-auto-resume'
    );

    expect((await api.listInbounds()).find((inbound) => inbound.id === 'customer-node-hkg-01')).toMatchObject({
      status: 'enabled',
      clients: [
        expect.objectContaining({
          enabled: true,
          quotaExceeded: false,
          runtimeDisabledByPolicy: false,
          guardrailReason: 'ok'
        })
      ]
    });
  });

  it('projects observability metrics from tasks, command outbox, Agents, alerts, and audit state', async () => {
    const repository = createInMemoryControlPlaneRepository({
      permissionGrants: seedPermissionGrants
    });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => '2026-06-02T00:00:00.000Z',
      inventory: {
        agents: []
      }
    });

    const task = await api.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent HKG 01',
        summary: 'Deploy Agent config for observability metrics'
      },
      mutationContext('observability-metrics-task')
    );

    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-observability-runtime-service-alert',
      agentId: 'agent-observability-alert-01',
      seq: 1,
      sessionId: 'sess-observability-alert-01',
      observedAt: '2026-06-02T00:00:00.000Z',
      payload: {
        reportedAt: '2026-06-02T00:00:00.000Z',
        runtimeServices: [
          {
            name: 'ou-ui-xray.service',
            moduleKind: 'xray',
            status: 'failed',
            enabled: true,
            required: true,
            checkedAt: '2026-06-02T00:00:00.000Z'
          }
        ]
      }
    });

    await expect(
      api.createTask(
        {
          operation: 'agent.deploy',
          resourceType: 'agent',
          targetId: 'agent-hkg-denied',
          targetLabel: 'Agent HKG denied',
          summary: 'Denied Agent config for observability metrics'
        },
        {
          ...mutationContext('observability-metrics-denied'),
          actor: 'operator:bob',
          operatorGroupId: 'ops-viewer'
        }
      )
    ).rejects.toMatchObject({ code: 'permission.denied' });

    await expect(api.getObservabilityMetrics()).resolves.toMatchObject({
      generatedAt: '2026-06-02T00:00:00.000Z',
      tasks: {
        total: 1,
        active: 1,
        failed: 0,
        byStatus: expect.objectContaining({
          queued: 1,
          failed: 0
        })
      },
      commandOutbox: {
        total: 1,
        backlog: 1,
        byStatus: expect.objectContaining({
          pending: 1,
          completed: 0
        })
      },
      audit: expect.objectContaining({
        valid: true,
        denied: 1,
        quotaExceeded: 0,
        writeFailures: 0
      }),
      systemAlerts: {
        total: 1,
        warning: 0,
        critical: 1,
        byKind: expect.objectContaining({
          'agent.runtime_service_unhealthy': 1,
          'agent.telemetry_sampling_gap': 0,
          'agent.offline': 0,
          'agent.high_latency': 0,
          'command_outbox.overdue': 0,
          'command_outbox.dead_letter': 0,
          'quota.exceeded': 0
        }),
        bySeverity: expect.objectContaining({
          critical: 1,
          warning: 0
        })
      }
    });
    await expect(repository.listCommandOutbox()).resolves.toEqual([
      expect.objectContaining({
        taskId: task.id,
        status: 'pending'
      })
    ]);
  });

  it('retrieves retained Agent log chunks from persisted Agent events', async () => {
    const repository = createInMemoryControlPlaneRepository({
      permissionGrants: seedPermissionGrants
    });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => '2026-06-05T10:00:00.000Z',
      inventory: {
        agents: []
      }
    });

    const task = await api.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent HKG 01',
        summary: 'Deploy Agent config with log streaming'
      },
      mutationContext('agent-log-chunk-task')
    );
    const [outboxItem] = await api.listCommandOutbox();
    const observedAt = new Date(Date.parse(outboxItem.deadlineAt) - 30_000).toISOString();

    await api.receiveAgentEvent({
      type: 'log_chunk',
      eventId: 'evt-agent-hkg-log-chunk-001',
      commandId: outboxItem.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: outboxItem.seq + 1,
      sessionId: 'sess-agent-hkg-log-01',
      observedAt,
      payload: {
        chunkSeq: 1,
        stream: 'stderr',
        content: 'xray reload warning: certificate chain checked'
      }
    });

    await expect(api.listAgentLogChunks({ agentId: 'agent-hkg-01', limit: 10 })).resolves.toEqual([
      {
        eventId: 'evt-agent-hkg-log-chunk-001',
        agentId: 'agent-hkg-01',
        sessionId: 'sess-agent-hkg-log-01',
        seq: outboxItem.seq + 1,
        observedAt,
        commandId: outboxItem.commandId,
        taskId: task.id,
        chunkSeq: 1,
        stream: 'stderr',
        content: 'xray reload warning: certificate chain checked'
      }
    ]);
    await expect(api.exportAgentLogChunks({ agentId: 'agent-hkg-01', limit: 10, format: 'jsonl' })).resolves.toEqual(
      expect.objectContaining({
        format: 'jsonl',
        contentType: 'application/x-ndjson; charset=utf-8',
        filename: 'ou-ui-agent-runtime-logs-2026-06-05T10-00-00-000Z.jsonl',
        generatedAt: '2026-06-05T10:00:00.000Z',
        count: 1,
        query: expect.objectContaining({
          agentId: 'agent-hkg-01',
          limit: 10,
          format: 'jsonl'
        }),
        chunks: [
          expect.objectContaining({
            eventId: 'evt-agent-hkg-log-chunk-001',
            content: 'xray reload warning: certificate chain checked'
          })
        ],
        content: expect.stringContaining('"eventId":"evt-agent-hkg-log-chunk-001"')
      })
    );
  });

  it('prunes Agent log chunks by retention window and per-Agent cap when events are received', async () => {
    const repository = createInMemoryControlPlaneRepository({
      permissionGrants: seedPermissionGrants
    });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({
        repository,
        now: createControlPlaneTestClock(),
        agentLogRetention: {
          maxAgeMs: 60_000,
          maxEventsPerAgent: 2
        }
      }),
      agentLogRetention: {
        maxAgeMs: 60_000,
        maxEventsPerAgent: 2
      },
      inventory: {
        agents: []
      }
    });

    await expect(api.getAgentLogRetentionPolicy()).resolves.toEqual({
      maxAgeMs: 60_000,
      maxAgeDays: 60_000 / 24 / 60 / 60 / 1000,
      maxEventsPerAgent: 2,
      source: 'runtime-config'
    });

    const task = await api.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent HKG 01',
        summary: 'Deploy Agent config with retained log cleanup'
      },
      mutationContext('agent-log-retention-task')
    );
    const [outboxItem] = await api.listCommandOutbox();
    const baseObservedMs = Date.parse(outboxItem.deadlineAt) - 180_000;
    const sessionId = 'sess-agent-hkg-log-retention';

    for (const [index, offsetMs] of [0, 80_000, 100_000, 110_000].entries()) {
      await api.receiveAgentEvent({
        type: 'log_chunk',
        eventId: `evt-agent-hkg-retained-log-${index + 1}`,
        commandId: outboxItem.commandId,
        taskId: task.id,
        agentId: 'agent-hkg-01',
        seq: outboxItem.seq + index + 1,
        sessionId,
        observedAt: new Date(baseObservedMs + offsetMs).toISOString(),
        payload: {
          chunkSeq: index + 1,
          stream: 'stderr',
          content: `retention chunk ${index + 1}`
        }
      });
    }

    await expect(api.listAgentLogChunks({ agentId: 'agent-hkg-01', limit: 10 })).resolves.toEqual([
      expect.objectContaining({
        eventId: 'evt-agent-hkg-retained-log-4',
        content: 'retention chunk 4'
      }),
      expect.objectContaining({
        eventId: 'evt-agent-hkg-retained-log-3',
        content: 'retention chunk 3'
      })
    ]);
    await expect(repository.listAgentEvents()).resolves.toEqual([
      expect.objectContaining({ eventId: 'evt-agent-hkg-retained-log-4' }),
      expect.objectContaining({ eventId: 'evt-agent-hkg-retained-log-3' })
    ]);
  });

  it('persists Agent log retention policy updates and uses them for runtime pruning', async () => {
    const repository = createInMemoryControlPlaneRepository({
      permissionGrants: seedPermissionGrants
    });
    const runtimeRetention = {
      maxAgeMs: 24 * 60 * 60 * 1000,
      maxEventsPerAgent: 3
    };
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({
        repository,
        now: createControlPlaneTestClock(),
        agentLogRetention: runtimeRetention
      }),
      agentLogRetention: runtimeRetention,
      readModelNow: () => '2026-06-05T09:30:00.000Z',
      inventory: {
        agents: []
      }
    });

    await expect(
      api.updateAgentLogRetentionPolicy(
        {
          maxAgeDays: 1,
          maxEventsPerAgent: 1,
          reason: 'keep only the newest diagnostic chunk'
        },
        mutationContext('agent-log-retention-update')
      )
    ).resolves.toEqual({
      maxAgeMs: 24 * 60 * 60 * 1000,
      maxAgeDays: 1,
      maxEventsPerAgent: 1,
      source: 'control-plane'
    });
    await expect(repository.getAgentLogRetentionPolicy()).resolves.toEqual({
      maxAgeMs: 24 * 60 * 60 * 1000,
      maxEventsPerAgent: 1
    });
    await expect(repository.listAuditLogs()).resolves.toEqual([
      expect.objectContaining({
        action: 'agent.log_retention.updated',
        operation: 'agent.log_retention.update',
        targetId: 'agent-log-retention-policy',
        before: expect.objectContaining({
          maxEventsPerAgent: 3,
          source: 'runtime-config'
        }),
        after: expect.objectContaining({
          maxEventsPerAgent: 1,
          reason: 'keep only the newest diagnostic chunk',
          source: 'control-plane'
        })
      })
    ]);

    const restartedApi = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({
        repository,
        now: createControlPlaneTestClock(),
        agentLogRetention: {
          maxAgeMs: 60_000,
          maxEventsPerAgent: 99
        }
      }),
      agentLogRetention: {
        maxAgeMs: 60_000,
        maxEventsPerAgent: 99
      },
      inventory: {
        agents: []
      }
    });

    await expect(restartedApi.getAgentLogRetentionPolicy()).resolves.toEqual({
      maxAgeMs: 24 * 60 * 60 * 1000,
      maxAgeDays: 1,
      maxEventsPerAgent: 1,
      source: 'control-plane'
    });

    const task = await restartedApi.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent HKG 01',
        summary: 'Deploy Agent config with persisted log cleanup'
      },
      mutationContext('agent-log-retention-persisted-task')
    );
    const [outboxItem] = await restartedApi.listCommandOutbox();
    const baseObservedMs = Date.parse(outboxItem.deadlineAt) - 120_000;

    for (const index of [0, 1, 2]) {
      await restartedApi.receiveAgentEvent({
        type: 'log_chunk',
        eventId: `evt-agent-hkg-persisted-retention-${index + 1}`,
        commandId: outboxItem.commandId,
        taskId: task.id,
        agentId: 'agent-hkg-01',
        seq: outboxItem.seq + index + 1,
        sessionId: 'sess-agent-hkg-persisted-retention',
        observedAt: new Date(baseObservedMs + index * 10_000).toISOString(),
        payload: {
          chunkSeq: index + 1,
          stream: 'stderr',
          content: `persisted retention chunk ${index + 1}`
        }
      });
    }

    await expect(restartedApi.listAgentLogChunks({ agentId: 'agent-hkg-01', limit: 10 })).resolves.toEqual([
      expect.objectContaining({
        eventId: 'evt-agent-hkg-persisted-retention-3',
        content: 'persisted retention chunk 3'
      })
    ]);
  });

  it('keeps new forwarding rules deploying until the Agent result succeeds', async () => {
    const repository = createInMemoryControlPlaneRepository({
      permissionGrants: seedPermissionGrants
    });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => '2026-06-04T04:01:00.000Z',
      inventory: {
        agents: []
      }
    });

    const task = await api.createTask(
      {
        operation: 'forward.create',
        resourceType: 'forward',
        targetId: 'forward-runtime-gated-2443',
        targetLabel: 'Runtime gated HTTPS forwarding',
        summary: 'Create runtime gated forwarding',
        metadata: {
          agentIds: ['agent-hkg-01'],
          listenAddress: '0.0.0.0',
          listenPort: 2443,
          targetAddress: '10.10.0.8',
          targetPort: 9443,
          protocol: 'tcp+udp',
          name: 'Runtime gated HTTPS forwarding',
          ownerName: 'Acme Team',
          billingDirection: 'both'
        }
      },
      mutationContext('forward-runtime-gated')
    );

    expect(await api.listForwardRules()).toEqual([
      expect.objectContaining({
        id: 'forward-runtime-gated-2443',
        portStatus: 'deploying',
        ports: [expect.objectContaining({ status: 'deploying' })]
      })
    ]);

    await expect(
      api.transitionTask(task.id, 'running', mutationContext('forward-runtime-gated-manual-running'))
    ).resolves.toMatchObject({
      id: task.id,
      status: 'running'
    });
    await expect(
      api.transitionTask(task.id, 'succeeded', mutationContext('forward-runtime-gated-manual-succeeded'))
    ).rejects.toMatchObject({
      code: 'agent_result.required'
    });
    expect(await api.listForwardRules()).toEqual([
      expect.objectContaining({
        id: 'forward-runtime-gated-2443',
        portStatus: 'deploying',
        ports: [expect.objectContaining({ status: 'deploying' })]
      })
    ]);

    const [outboxItem] = await api.listCommandOutbox();
    const ackObservedAt = new Date(Date.parse(outboxItem.deadlineAt) - 30_000).toISOString();
    const resultObservedAt = new Date(Date.parse(outboxItem.deadlineAt) - 15_000).toISOString();

    await api.receiveAgentEvent({
      type: 'ack',
      eventId: 'evt-forward-runtime-gated-ack',
      commandId: outboxItem.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: outboxItem.seq + 1,
      sessionId: 'sess-agent-hkg-01',
      observedAt: ackObservedAt,
      payload: {
        duplicate: false
      }
    });
    await api.receiveAgentEvent({
      type: 'result',
      eventId: 'evt-forward-runtime-gated-result',
      commandId: outboxItem.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: outboxItem.seq + 2,
      sessionId: 'sess-agent-hkg-01',
      observedAt: resultObservedAt,
      payload: {
        status: 'succeeded',
        appliedConfigRevision: outboxItem.command.type === 'apply' ? outboxItem.command.payload.configRevision : undefined
      }
    });

    expect(await api.listForwardRules()).toEqual([
      expect.objectContaining({
        id: 'forward-runtime-gated-2443',
        portStatus: 'allocated',
        ports: [expect.objectContaining({ status: 'allocated' })]
      })
    ]);
  });

  it('projects Agent-reported port conflicts into forwarding rule status', async () => {
    const repository = createInMemoryControlPlaneRepository({
      permissionGrants: seedPermissionGrants
    });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => '2026-06-04T04:01:00.000Z',
      inventory: {
        agents: []
      }
    });

    const task = await api.createTask(
      {
        operation: 'forward.create',
        resourceType: 'forward',
        targetId: 'forward-conflict-2443',
        targetLabel: 'Conflicting HTTPS forwarding',
        summary: 'Create conflicting forwarding',
        metadata: {
          agentIds: ['agent-hkg-01'],
          listenAddress: '0.0.0.0',
          listenPort: 2443,
          targetAddress: '10.10.0.8',
          targetPort: 9443,
          protocol: 'tcp+udp',
          name: 'Conflicting HTTPS forwarding',
          ownerName: 'Acme Team',
          billingDirection: 'both'
        }
      },
      mutationContext('forward-conflict')
    );
    const [outboxItem] = await api.listCommandOutbox();
    const ackObservedAt = new Date(Date.parse(outboxItem.deadlineAt) - 30_000).toISOString();
    const resultObservedAt = new Date(Date.parse(outboxItem.deadlineAt) - 15_000).toISOString();

    await api.receiveAgentEvent({
      type: 'ack',
      eventId: 'evt-forward-conflict-ack',
      commandId: outboxItem.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: outboxItem.seq + 1,
      sessionId: 'sess-agent-hkg-01',
      observedAt: ackObservedAt,
      payload: {
        duplicate: false
      }
    });
    await expect(
      api.receiveAgentEvent({
        type: 'result',
        eventId: 'evt-forward-conflict-result',
        commandId: outboxItem.commandId,
        taskId: task.id,
        agentId: 'agent-hkg-01',
        seq: outboxItem.seq + 2,
        sessionId: 'sess-agent-hkg-01',
        observedAt: resultObservedAt,
        payload: {
          status: 'failed',
          failureReason: 'preflight.port_conflict: address already in use',
          retryable: false
        }
      })
    ).resolves.toMatchObject({
      id: task.id,
      status: 'failed',
      failureReason: 'preflight.port_conflict: address already in use'
    });

    expect(await api.listForwardRules()).toEqual([
      expect.objectContaining({
        id: 'forward-conflict-2443',
        portStatus: 'conflict',
        ports: [expect.objectContaining({ status: 'conflict' })]
      })
    ]);
  });

  it('replays persisted Agent telemetry into host and forwarding read models after restart', async () => {
    const repository = createInMemoryControlPlaneRepository({
      forwardRules: seedForwardRules,
      agentEvents: [
        {
          type: 'telemetry_sample',
          eventId: 'evt-restart-telemetry-agent-hkg-01',
          agentId: 'agent-hkg-01',
          seq: 12,
          sessionId: 'sess-agent-hkg-01',
          observedAt: '2026-06-04T04:00:30.000Z',
          payload: {
            cpuPercent: 37,
            cpuCores: 4,
            memoryPercent: 58,
            memoryUsedBytes: 3_200_000_000,
            memoryTotalBytes: 8_000_000_000,
            diskPercent: 41,
            diskUsedBytes: 24_000_000_000,
            diskTotalBytes: 64_000_000_000,
            latencyMs: 86,
            latencySamplesMs: [72, 86],
            packetLossPercent: 0,
            monthlyIngressBytes: 1_500,
            monthlyEgressBytes: 500,
            trafficAccountingMode: 'both',
            monthlyResetDay: 7,
            manualUsedTrafficBytes: 200,
            trafficTelemetrySource: 'agent',
            cpuModel: 'AMD EPYC 7B13',
            kernelVersion: '6.8.0-ou',
            virtualization: 'kvm',
            primaryNetworkInterface: 'eth0',
            hardwareDetectedAt: '2026-06-04T04:00:25.000Z',
            hardwareTelemetrySource: 'agent',
            forwardingCounters: [
              {
                ruleId: 'forward-hkg-443',
                agentId: 'agent-hkg-01',
                serviceName: 'ou-forward-forward-hkg-443-agent-hkg-01',
                listenPort: 443,
                targetAddress: '10.12.0.8',
                targetPort: 8443,
                protocol: 'tcp+udp',
                inboundBytes: 900,
                outboundBytes: 1_100,
                sampledAt: '2026-06-04T04:00:30.000Z',
                source: 'nftables'
              }
            ]
          }
        }
      ]
    });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => '2026-06-04T04:01:00.000Z',
      inventory: {
        agents: []
      }
    });

    const agents = await api.listAgents();
    const rules = await api.listForwardRules();

    expect(agents).toEqual([
      expect.objectContaining({
        id: 'agent-hkg-01',
        status: 'online',
        trafficPolicy: expect.objectContaining({
          accountingMode: 'both',
          monthlyResetDay: 7,
          manualUsedTrafficBytes: 200
        }),
        hardware: expect.objectContaining({
          cpuModel: 'AMD EPYC 7B13',
          kernelVersion: '6.8.0-ou',
          virtualization: 'kvm',
          primaryNetworkInterface: 'eth0'
        }),
        telemetry: expect.objectContaining({
          cpuPercent: 37,
          cpuCores: 4,
          memoryPercent: 58,
          diskPercent: 41,
          latencyMs: 86,
          monthlyIngressBytes: 1_500,
          monthlyEgressBytes: 500,
          monthlyTrafficUsedBytes: 2_000,
          sampleGapDetected: false,
          expectedSamplingIntervalSeconds: 30
        })
      })
    ]);
    expect(rules.find((rule) => rule.id === 'forward-hkg-443')).toMatchObject({
      inboundBytes: 900,
      outboundBytes: 1_100,
      ports: [
        expect.objectContaining({
          agentId: 'agent-hkg-01',
          inboundBytes: 900,
          outboundBytes: 1_100,
          counterSource: 'nftables',
          lastCounterSampleAt: '2026-06-04T04:00:30.000Z'
        })
      ]
    });
  });

  it('derives degraded and offline managed-host status from stale Agent runtime signals', async () => {
    const repository = createInMemoryControlPlaneRepository({
      agentEvents: [
        {
          type: 'heartbeat',
          eventId: 'evt-stale-heartbeat-agent-edge-01',
          agentId: 'agent-edge-01',
          seq: 1,
          sessionId: 'sess-agent-edge-01',
          observedAt: '2026-06-04T04:00:00.000Z',
          payload: {
            version: '1.0.0-runtime',
            uptimeSeconds: 3600,
            capabilities: ['host-agent', 'xray', 'port-forwarding'],
            lastSeenCommandSeq: 0
          }
        }
      ]
    });

    const degradedApi = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => '2026-06-04T04:01:30.000Z',
      inventory: {
        agents: []
      }
    });
    await expect(degradedApi.listAgents()).resolves.toEqual([
      expect.objectContaining({
        id: 'agent-edge-01',
        status: 'degraded',
        telemetry: expect.objectContaining({
          sampleGapDetected: true,
          sampleGapSeconds: 90,
          sampleGapReason: 'no_telemetry_sample'
        })
      })
    ]);
    await expect(degradedApi.listSystemAlerts()).resolves.toEqual([
      expect.objectContaining({
        kind: 'agent.telemetry_sampling_gap',
        severity: 'warning',
        status: 'active',
        resourceId: 'agent-edge-01'
      })
    ]);

    const offlineApi = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => '2026-06-04T04:05:00.000Z',
      inventory: {
        agents: []
      }
    });
    await expect(offlineApi.listAgents()).resolves.toEqual([
      expect.objectContaining({
        id: 'agent-edge-01',
        status: 'offline'
      })
    ]);
    await expect(offlineApi.listSystemAlerts()).resolves.toEqual([
      expect.objectContaining({
        kind: 'agent.offline',
        severity: 'critical',
        status: 'active',
        resourceId: 'agent-edge-01',
        observedAt: '2026-06-04T04:05:00.000Z',
        metadata: expect.objectContaining({
          lastRuntimeSignalAt: '2026-06-04T04:00:00.000Z',
          offlineAfterSeconds: 300
        })
      }),
      expect.objectContaining({
        kind: 'agent.telemetry_sampling_gap',
        severity: 'critical',
        status: 'active',
        resourceId: 'agent-edge-01'
      })
    ]);
  });

  it('persists active and resolved system alert lifecycle records as Agent telemetry recovers', async () => {
    const repository = createInMemoryControlPlaneRepository({
      agentEvents: [
        {
          type: 'heartbeat',
          eventId: 'evt-alert-lifecycle-heartbeat',
          agentId: 'agent-alert-lifecycle-01',
          seq: 1,
          sessionId: 'sess-alert-lifecycle-01',
          observedAt: '2026-06-04T04:00:00.000Z',
          payload: {
            version: '1.0.0-runtime',
            uptimeSeconds: 3600,
            capabilities: ['host-agent', 'xray', 'port-forwarding'],
            lastSeenCommandSeq: 0
          }
        }
      ]
    });
    let nowIso = '2026-06-04T04:01:30.000Z';
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => nowIso,
      inventory: {
        agents: []
      }
    });

    await expect(api.listSystemAlerts()).resolves.toEqual([
      expect.objectContaining({
        kind: 'agent.telemetry_sampling_gap',
        status: 'active',
        severity: 'warning',
        resourceId: 'agent-alert-lifecycle-01'
      })
    ]);
    await expect(repository.listSystemAlertRecords()).resolves.toEqual([
      expect.objectContaining({
        id: 'alert-agent-telemetry-sampling-gap-agent-alert-lifecycle-01',
        status: 'active',
        firstObservedAt: '2026-06-04T04:00:00.000Z',
        lastChangedAt: '2026-06-04T04:01:30.000Z'
      })
    ]);

    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-alert-lifecycle-telemetry-recovered',
      agentId: 'agent-alert-lifecycle-01',
      seq: 2,
      sessionId: 'sess-alert-lifecycle-01',
      observedAt: '2026-06-04T04:01:45.000Z',
      payload: {
        reportedAt: '2026-06-04T04:01:45.000Z',
        latencyMs: 42,
        cpuPercent: 18
      }
    });

    nowIso = '2026-06-04T04:02:00.000Z';

    await expect(api.listSystemAlerts()).resolves.toEqual([]);
    await expect(repository.listSystemAlertRecords()).resolves.toEqual([
      expect.objectContaining({
        id: 'alert-agent-telemetry-sampling-gap-agent-alert-lifecycle-01',
        status: 'resolved',
        firstObservedAt: '2026-06-04T04:00:00.000Z',
        resolvedAt: '2026-06-04T04:02:00.000Z',
        lastChangedAt: '2026-06-04T04:02:00.000Z'
      })
    ]);
  });

  it('persists and notifies high latency system alert lifecycle records as Agent latency recovers', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const notificationBatches: unknown[] = [];
    const systemAlertNotifier = {
      notify: vi.fn(async (batch) => {
        notificationBatches.push(batch);
      })
    };
    let nowIso = '2026-06-04T04:10:05.000Z';
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => nowIso,
      systemAlertNotifier,
      inventory: {
        agents: []
      }
    });

    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-alert-high-latency-red',
      agentId: 'agent-alert-high-latency-01',
      seq: 1,
      sessionId: 'sess-alert-high-latency-01',
      observedAt: '2026-06-04T04:10:00.000Z',
      payload: {
        reportedAt: '2026-06-04T04:10:00.000Z',
        latencyMs: 260,
        latencyStatus: 'red',
        cpuPercent: 14
      }
    });

    await expect(api.listSystemAlerts()).resolves.toEqual([
      expect.objectContaining({
        id: 'alert-agent-high-latency-agent-alert-high-latency-01',
        kind: 'agent.high_latency',
        severity: 'critical',
        status: 'active',
        resourceId: 'agent-alert-high-latency-01',
        metadata: expect.objectContaining({
          latencyMs: 260,
          latencyStatus: 'red',
          latencyYellowMaxMs: 200
        })
      })
    ]);
    await expect(repository.listSystemAlertRecords()).resolves.toEqual([
      expect.objectContaining({
        id: 'alert-agent-high-latency-agent-alert-high-latency-01',
        status: 'active',
        firstObservedAt: '2026-06-04T04:10:00.000Z',
        lastChangedAt: '2026-06-04T04:10:05.000Z'
      })
    ]);

    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-alert-high-latency-recovered',
      agentId: 'agent-alert-high-latency-01',
      seq: 2,
      sessionId: 'sess-alert-high-latency-01',
      observedAt: '2026-06-04T04:10:30.000Z',
      payload: {
        reportedAt: '2026-06-04T04:10:30.000Z',
        latencyMs: 85,
        latencyStatus: 'green',
        cpuPercent: 12
      }
    });

    nowIso = '2026-06-04T04:10:35.000Z';

    await expect(api.listSystemAlerts()).resolves.toEqual([]);
    await expect(repository.listSystemAlertRecords()).resolves.toEqual([
      expect.objectContaining({
        id: 'alert-agent-high-latency-agent-alert-high-latency-01',
        status: 'resolved',
        firstObservedAt: '2026-06-04T04:10:00.000Z',
        resolvedAt: '2026-06-04T04:10:35.000Z',
        lastChangedAt: '2026-06-04T04:10:35.000Z'
      })
    ]);
    expect(systemAlertNotifier.notify).toHaveBeenCalledTimes(2);
    expect(notificationBatches).toEqual([
      expect.objectContaining({
        generatedAt: '2026-06-04T04:10:05.000Z',
        events: [
          expect.objectContaining({
            type: 'activated',
            alert: expect.objectContaining({
              kind: 'agent.high_latency',
              status: 'active',
              resourceId: 'agent-alert-high-latency-01'
            })
          })
        ]
      }),
      expect.objectContaining({
        generatedAt: '2026-06-04T04:10:35.000Z',
        events: [
          expect.objectContaining({
            type: 'resolved',
            alert: expect.objectContaining({
              kind: 'agent.high_latency',
              status: 'resolved',
              resourceId: 'agent-alert-high-latency-01'
            }),
            resolvedAt: '2026-06-04T04:10:35.000Z'
          })
        ]
      })
    ]);
  });

  it('persists and notifies offline Agent system alert lifecycle records as the Agent reconnects', async () => {
    const repository = createInMemoryControlPlaneRepository({
      agentEvents: [
        {
          type: 'heartbeat',
          eventId: 'evt-alert-offline-heartbeat',
          agentId: 'agent-alert-offline-01',
          seq: 1,
          sessionId: 'sess-alert-offline-01',
          observedAt: '2026-06-04T04:00:00.000Z',
          payload: {
            version: '1.0.0-runtime',
            uptimeSeconds: 3600,
            capabilities: ['host-agent', 'xray', 'port-forwarding'],
            lastSeenCommandSeq: 0
          }
        }
      ]
    });
    const notificationBatches: unknown[] = [];
    const systemAlertNotifier = {
      notify: vi.fn(async (batch) => {
        notificationBatches.push(batch);
      })
    };
    let nowIso = '2026-06-04T04:05:00.000Z';
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => nowIso,
      systemAlertNotifier,
      inventory: {
        agents: []
      }
    });

    await expect(api.listSystemAlerts()).resolves.toEqual([
      expect.objectContaining({
        id: 'alert-agent-offline-agent-alert-offline-01',
        kind: 'agent.offline',
        status: 'active',
        severity: 'critical',
        resourceId: 'agent-alert-offline-01',
        observedAt: '2026-06-04T04:05:00.000Z',
        metadata: expect.objectContaining({
          lastRuntimeSignalAt: '2026-06-04T04:00:00.000Z',
          offlineAfterSeconds: 300
        })
      }),
      expect.objectContaining({
        id: 'alert-agent-telemetry-sampling-gap-agent-alert-offline-01',
        kind: 'agent.telemetry_sampling_gap',
        status: 'active',
        severity: 'critical',
        resourceId: 'agent-alert-offline-01'
      })
    ]);
    await expect(repository.listSystemAlertRecords()).resolves.toEqual([
      expect.objectContaining({
        id: 'alert-agent-offline-agent-alert-offline-01',
        status: 'active',
        firstObservedAt: '2026-06-04T04:05:00.000Z',
        lastChangedAt: '2026-06-04T04:05:00.000Z'
      }),
      expect.objectContaining({
        id: 'alert-agent-telemetry-sampling-gap-agent-alert-offline-01',
        status: 'active',
        firstObservedAt: '2026-06-04T04:00:00.000Z',
        lastChangedAt: '2026-06-04T04:05:00.000Z'
      })
    ]);

    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-alert-offline-reconnected',
      agentId: 'agent-alert-offline-01',
      seq: 2,
      sessionId: 'sess-alert-offline-01',
      observedAt: '2026-06-04T04:05:30.000Z',
      payload: {
        reportedAt: '2026-06-04T04:05:30.000Z',
        latencyMs: 52,
        latencyStatus: 'green',
        cpuPercent: 12
      }
    });

    nowIso = '2026-06-04T04:05:35.000Z';

    await expect(api.listSystemAlerts()).resolves.toEqual([]);
    await expect(repository.listSystemAlertRecords()).resolves.toEqual([
      expect.objectContaining({
        id: 'alert-agent-offline-agent-alert-offline-01',
        status: 'resolved',
        resolvedAt: '2026-06-04T04:05:35.000Z',
        lastChangedAt: '2026-06-04T04:05:35.000Z'
      }),
      expect.objectContaining({
        id: 'alert-agent-telemetry-sampling-gap-agent-alert-offline-01',
        status: 'resolved',
        resolvedAt: '2026-06-04T04:05:35.000Z',
        lastChangedAt: '2026-06-04T04:05:35.000Z'
      })
    ]);
    expect(systemAlertNotifier.notify).toHaveBeenCalledTimes(2);
    expect(notificationBatches).toEqual([
      expect.objectContaining({
        generatedAt: '2026-06-04T04:05:00.000Z',
        events: expect.arrayContaining([
          expect.objectContaining({
            type: 'activated',
            alert: expect.objectContaining({
              kind: 'agent.offline',
              status: 'active',
              resourceId: 'agent-alert-offline-01'
            })
          })
        ])
      }),
      expect.objectContaining({
        generatedAt: '2026-06-04T04:05:35.000Z',
        events: expect.arrayContaining([
          expect.objectContaining({
            type: 'resolved',
            alert: expect.objectContaining({
              kind: 'agent.offline',
              status: 'resolved',
              resourceId: 'agent-alert-offline-01'
            }),
            resolvedAt: '2026-06-04T04:05:35.000Z'
          })
        ])
      })
    ]);
  });

  it('persists command outbox system alert lifecycle records as command backlog clears', async () => {
    const repository = createInMemoryControlPlaneRepository({
      commandOutbox: [
        createCommandOutboxItem({
          id: 'outbox-alert-command-overdue',
          commandId: 'cmd-alert-command-overdue',
          status: 'pending',
          createdAt: '2026-06-04T04:00:00.000Z',
          updatedAt: '2026-06-04T04:00:10.000Z',
          deadlineAt: '2026-06-04T04:01:00.000Z'
        }),
        createCommandOutboxItem({
          id: 'outbox-alert-command-dead-letter',
          commandId: 'cmd-alert-command-dead-letter',
          status: 'dead_letter',
          createdAt: '2026-06-04T04:00:30.000Z',
          updatedAt: '2026-06-04T04:02:30.000Z',
          deadlineAt: '2026-06-04T04:01:30.000Z',
          lastError: 'Agent result timed out'
        })
      ]
    });
    let nowIso = '2026-06-04T04:03:00.000Z';
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => nowIso,
      inventory: {
        agents: []
      }
    });

    await expect(api.listSystemAlerts()).resolves.toEqual([
      expect.objectContaining({
        kind: 'command_outbox.dead_letter',
        severity: 'critical',
        resourceType: 'command_outbox',
        resourceId: 'command-outbox',
        metadata: expect.objectContaining({
          deadLetterCount: 1,
          sampleCommandId: 'cmd-alert-command-dead-letter'
        })
      }),
      expect.objectContaining({
        kind: 'command_outbox.overdue',
        severity: 'warning',
        resourceType: 'command_outbox',
        resourceId: 'command-outbox',
        metadata: expect.objectContaining({
          overdueCount: 1,
          sampleCommandId: 'cmd-alert-command-overdue'
        })
      })
    ]);
    await expect(repository.listSystemAlertRecords()).resolves.toEqual([
      expect.objectContaining({
        kind: 'command_outbox.dead_letter',
        status: 'active'
      }),
      expect.objectContaining({
        kind: 'command_outbox.overdue',
        status: 'active'
      })
    ]);
    await expect(api.getObservabilityMetrics()).resolves.toMatchObject({
      systemAlerts: {
        total: 2,
        warning: 1,
        critical: 1,
        byKind: expect.objectContaining({
          'command_outbox.overdue': 1,
          'command_outbox.dead_letter': 1
        })
      }
    });

    await repository.transaction(async (transaction) => {
      const items = await transaction.listCommandOutbox();
      for (const item of items) {
        await transaction.updateCommandOutboxItem({
          ...item,
          status: 'completed',
          updatedAt: '2026-06-04T04:03:30.000Z',
          resultAt: '2026-06-04T04:03:30.000Z'
        });
      }
    });
    nowIso = '2026-06-04T04:04:00.000Z';

    await expect(api.listSystemAlerts()).resolves.toEqual([]);
    await expect(repository.listSystemAlertRecords()).resolves.toEqual([
      expect.objectContaining({
        kind: 'command_outbox.dead_letter',
        status: 'resolved',
        resolvedAt: '2026-06-04T04:04:00.000Z'
      }),
      expect.objectContaining({
        kind: 'command_outbox.overdue',
        status: 'resolved',
        resolvedAt: '2026-06-04T04:04:00.000Z'
      })
    ]);
  });

  it('persists quota exceeded system alert lifecycle records as quota usage recovers', async () => {
    const repository = createInMemoryControlPlaneRepository();
    let nowIso = '2026-06-04T04:20:05.000Z';
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => nowIso,
      inventory: {
        agents: []
      }
    });

    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-alert-quota-exceeded',
      agentId: 'agent-alert-quota-01',
      seq: 1,
      sessionId: 'sess-alert-quota-01',
      observedAt: '2026-06-04T04:20:00.000Z',
      payload: {
        reportedAt: '2026-06-04T04:20:00.000Z',
        monthlyTrafficLimitBytes: 1000,
        monthlyTrafficUsedBytes: 1200,
        quotaExceeded: true,
        runtimeDisabledByPolicy: true,
        guardrailReason: 'monthly_traffic_quota_exceeded',
        latencyMs: 42
      }
    });

    await expect(api.listSystemAlerts()).resolves.toEqual([
      expect.objectContaining({
        id: 'alert-quota-exceeded-managed-host-agent-alert-quota-01',
        kind: 'quota.exceeded',
        severity: 'critical',
        status: 'active',
        resourceType: 'quota_policy',
        resourceId: 'managed-host:agent-alert-quota-01',
        metadata: expect.objectContaining({
          quotaPolicyId: 'managed-host:agent-alert-quota-01',
          quotaScope: 'managed-host',
          enforcementState: 'disabled_by_quota',
          limitBytes: 1000,
          usedBytes: 1200,
          guardrailReason: 'monthly_traffic_quota_exceeded'
        })
      })
    ]);
    await expect(repository.listSystemAlertRecords()).resolves.toEqual([
      expect.objectContaining({
        id: 'alert-quota-exceeded-managed-host-agent-alert-quota-01',
        status: 'active',
        firstObservedAt: '2026-06-04T04:20:00.000Z',
        lastChangedAt: '2026-06-04T04:20:05.000Z'
      })
    ]);

    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-alert-quota-recovered',
      agentId: 'agent-alert-quota-01',
      seq: 2,
      sessionId: 'sess-alert-quota-01',
      observedAt: '2026-06-04T04:20:30.000Z',
      payload: {
        reportedAt: '2026-06-04T04:20:30.000Z',
        monthlyTrafficLimitBytes: 1000,
        monthlyTrafficUsedBytes: 100,
        quotaExceeded: false,
        runtimeDisabledByPolicy: false,
        guardrailReason: 'ok',
        latencyMs: 40
      }
    });
    nowIso = '2026-06-04T04:20:35.000Z';

    await expect(api.listSystemAlerts()).resolves.toEqual([]);
    await expect(repository.listSystemAlertRecords()).resolves.toEqual([
      expect.objectContaining({
        id: 'alert-quota-exceeded-managed-host-agent-alert-quota-01',
        status: 'resolved',
        resolvedAt: '2026-06-04T04:20:35.000Z',
        lastChangedAt: '2026-06-04T04:20:35.000Z'
      })
    ]);
  });

  it('notifies external channels when system alerts activate and resolve', async () => {
    const repository = createInMemoryControlPlaneRepository({
      agentEvents: [
        {
          type: 'heartbeat',
          eventId: 'evt-alert-notification-heartbeat',
          agentId: 'agent-alert-notification-01',
          seq: 1,
          sessionId: 'sess-alert-notification-01',
          observedAt: '2026-06-04T05:00:00.000Z',
          payload: {
            version: '1.0.0-runtime',
            uptimeSeconds: 7200,
            capabilities: ['host-agent', 'xray', 'port-forwarding'],
            lastSeenCommandSeq: 0
          }
        }
      ]
    });
    const notificationBatches: unknown[] = [];
    const systemAlertNotifier = {
      notify: vi.fn(async (batch) => {
        notificationBatches.push(batch);
      })
    };
    let nowIso = '2026-06-04T05:01:30.000Z';
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => nowIso,
      systemAlertNotifier,
      inventory: {
        agents: []
      }
    });

    await expect(api.listSystemAlerts()).resolves.toEqual([
      expect.objectContaining({
        kind: 'agent.telemetry_sampling_gap',
        status: 'active',
        resourceId: 'agent-alert-notification-01'
      })
    ]);
    await expect(api.listSystemAlerts()).resolves.toEqual([
      expect.objectContaining({
        kind: 'agent.telemetry_sampling_gap',
        status: 'active',
        resourceId: 'agent-alert-notification-01'
      })
    ]);

    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-alert-notification-recovered',
      agentId: 'agent-alert-notification-01',
      seq: 2,
      sessionId: 'sess-alert-notification-01',
      observedAt: '2026-06-04T05:01:45.000Z',
      payload: {
        reportedAt: '2026-06-04T05:01:45.000Z',
        latencyMs: 35,
        cpuPercent: 12
      }
    });

    nowIso = '2026-06-04T05:02:00.000Z';

    await expect(api.listSystemAlerts()).resolves.toEqual([]);
    expect(systemAlertNotifier.notify).toHaveBeenCalledTimes(2);
    expect(notificationBatches).toEqual([
      expect.objectContaining({
        schemaVersion: 'ou-ui-next.system-alerts.v1',
        generatedAt: '2026-06-04T05:01:30.000Z',
        events: [
          expect.objectContaining({
            type: 'activated',
            alert: expect.objectContaining({
              status: 'active',
              resourceId: 'agent-alert-notification-01'
            })
          })
        ]
      }),
      expect.objectContaining({
        schemaVersion: 'ou-ui-next.system-alerts.v1',
        generatedAt: '2026-06-04T05:02:00.000Z',
        events: [
          expect.objectContaining({
            type: 'resolved',
            alert: expect.objectContaining({
              status: 'resolved',
              resourceId: 'agent-alert-notification-01'
            }),
            resolvedAt: '2026-06-04T05:02:00.000Z'
          })
        ]
      })
    ]);
  });

  it('notifies external channels only for meaningful active system alert updates', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const notificationBatches: unknown[] = [];
    const systemAlertNotifier = {
      notify: vi.fn(async (batch) => {
        notificationBatches.push(batch);
      })
    };
    let nowIso = '2026-06-04T05:03:10.000Z';
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => nowIso,
      systemAlertNotifier,
      inventory: {
        agents: []
      }
    });

    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-alert-notification-runtime-service-missing',
      agentId: 'agent-alert-notification-update-01',
      seq: 1,
      sessionId: 'sess-alert-notification-update-01',
      observedAt: '2026-06-04T05:03:00.000Z',
      payload: {
        reportedAt: '2026-06-04T05:03:00.000Z',
        runtimeServices: [
          {
            name: 'ou-ui-xray.service',
            moduleKind: 'xray',
            status: 'missing',
            enabled: false,
            required: true,
            checkedAt: '2026-06-04T05:03:00.000Z',
            detail: 'unit file not found'
          }
        ]
      }
    });
    await expect(api.listSystemAlerts()).resolves.toEqual([
      expect.objectContaining({
        kind: 'agent.runtime_service_unhealthy',
        resourceId: 'agent-alert-notification-update-01'
      })
    ]);

    nowIso = '2026-06-04T05:03:20.000Z';
    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-alert-notification-runtime-service-still-missing',
      agentId: 'agent-alert-notification-update-01',
      seq: 2,
      sessionId: 'sess-alert-notification-update-01',
      observedAt: '2026-06-04T05:03:15.000Z',
      payload: {
        reportedAt: '2026-06-04T05:03:15.000Z',
        runtimeServices: [
          {
            name: 'ou-ui-xray.service',
            moduleKind: 'xray',
            status: 'missing',
            enabled: false,
            required: true,
            checkedAt: '2026-06-04T05:03:15.000Z',
            detail: 'unit file not found'
          }
        ]
      }
    });
    await expect(api.listSystemAlerts()).resolves.toHaveLength(1);

    nowIso = '2026-06-04T05:03:30.000Z';
    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-alert-notification-runtime-service-masked',
      agentId: 'agent-alert-notification-update-01',
      seq: 3,
      sessionId: 'sess-alert-notification-update-01',
      observedAt: '2026-06-04T05:03:25.000Z',
      payload: {
        reportedAt: '2026-06-04T05:03:25.000Z',
        runtimeServices: [
          {
            name: 'ou-ui-xray.service',
            moduleKind: 'xray',
            status: 'missing',
            enabled: false,
            required: true,
            checkedAt: '2026-06-04T05:03:25.000Z',
            detail: 'unit masked by operator'
          }
        ]
      }
    });
    await expect(api.listSystemAlerts()).resolves.toHaveLength(1);

    expect(systemAlertNotifier.notify).toHaveBeenCalledTimes(2);
    expect(notificationBatches).toEqual([
      expect.objectContaining({
        generatedAt: '2026-06-04T05:03:10.000Z',
        events: [
          expect.objectContaining({
            type: 'activated',
            alert: expect.objectContaining({
              metadata: expect.objectContaining({
                serviceDetail: 'unit file not found'
              })
            })
          })
        ]
      }),
      expect.objectContaining({
        generatedAt: '2026-06-04T05:03:30.000Z',
        events: [
          expect.objectContaining({
            type: 'updated',
            alert: expect.objectContaining({
              metadata: expect.objectContaining({
                serviceDetail: 'unit masked by operator'
              })
            })
          })
        ]
      })
    ]);
  });

  it('persists failed system alert notifications and retries due deliveries', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const systemAlertNotifier = {
      notify: vi.fn(async () => {
        if (systemAlertNotifier.notify.mock.calls.length === 1) {
          throw new Error('delivery failed for https://alerts.example.com/ou-ui?token=secret');
        }
      })
    };
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => '2026-06-04T05:04:10.000Z',
      systemAlertNotifier,
      systemAlertNotificationRetry: {
        retryDelayMs: 1000,
        maxAttempts: 3,
        maxDeliveriesPerSweep: 5
      },
      inventory: {
        agents: []
      }
    });

    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-alert-notification-retry-missing',
      agentId: 'agent-alert-notification-retry-01',
      seq: 1,
      sessionId: 'sess-alert-notification-retry-01',
      observedAt: '2026-06-04T05:04:00.000Z',
      payload: {
        reportedAt: '2026-06-04T05:04:00.000Z',
        runtimeServices: [
          {
            name: 'ou-ui-xray.service',
            moduleKind: 'xray',
            status: 'missing',
            enabled: false,
            required: true,
            checkedAt: '2026-06-04T05:04:00.000Z'
          }
        ]
      }
    });

    await expect(api.listSystemAlerts()).resolves.toHaveLength(1);
    await expect(repository.listSystemAlertNotificationDeliveries()).resolves.toEqual([
      expect.objectContaining({
        status: 'failed',
        attemptCount: 1,
        nextAttemptAt: '2026-06-04T05:04:11.000Z',
        lastErrorMessage: 'delivery failed for [redacted-url]'
      })
    ]);

    if (!api.retrySystemAlertNotifications) {
      throw new Error('Expected retrySystemAlertNotifications to be available.');
    }

    await expect(
      api.retrySystemAlertNotifications({
        now: '2026-06-04T05:04:10.500Z'
      })
    ).resolves.toEqual({
      attempted: 0,
      delivered: 0,
      failed: 0,
      deadLettered: 0
    });

    await expect(
      api.retrySystemAlertNotifications({
        now: '2026-06-04T05:04:11.000Z'
      })
    ).resolves.toEqual({
      attempted: 1,
      delivered: 1,
      failed: 0,
      deadLettered: 0
    });
    expect(systemAlertNotifier.notify).toHaveBeenCalledTimes(2);
    await expect(repository.listSystemAlertNotificationDeliveries()).resolves.toEqual([
      expect.objectContaining({
        status: 'delivered',
        attemptCount: 2,
        deliveredAt: '2026-06-04T05:04:11.000Z'
      })
    ]);

    await expect(api.getObservabilityMetrics()).resolves.toMatchObject({
      systemAlertNotifications: {
        total: 1,
        delivered: 1,
        failed: 0,
        deadLetters: 0
      }
    });
  });

  it('dead-letters system alert notifications after the configured attempts are exhausted', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const systemAlertNotifier = {
      notify: vi.fn(async () => {
        throw new Error('webhook target unavailable');
      })
    };
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => '2026-06-04T05:05:10.000Z',
      systemAlertNotifier,
      systemAlertNotificationRetry: {
        retryDelayMs: 1000,
        maxAttempts: 2,
        maxDeliveriesPerSweep: 5
      },
      inventory: {
        agents: []
      }
    });

    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-alert-notification-dead-letter-missing',
      agentId: 'agent-alert-notification-dead-letter-01',
      seq: 1,
      sessionId: 'sess-alert-notification-dead-letter-01',
      observedAt: '2026-06-04T05:05:00.000Z',
      payload: {
        reportedAt: '2026-06-04T05:05:00.000Z',
        runtimeServices: [
          {
            name: 'ou-ui-xray.service',
            moduleKind: 'xray',
            status: 'missing',
            enabled: false,
            required: true,
            checkedAt: '2026-06-04T05:05:00.000Z'
          }
        ]
      }
    });

    await expect(api.listSystemAlerts()).resolves.toHaveLength(1);

    if (!api.retrySystemAlertNotifications) {
      throw new Error('Expected retrySystemAlertNotifications to be available.');
    }

    await expect(
      api.retrySystemAlertNotifications({
        now: '2026-06-04T05:05:11.000Z'
      })
    ).resolves.toEqual({
      attempted: 1,
      delivered: 0,
      failed: 0,
      deadLettered: 1
    });
    await expect(repository.listSystemAlertNotificationDeliveries()).resolves.toEqual([
      expect.objectContaining({
        status: 'dead_letter',
        attemptCount: 2,
        deadLetteredAt: '2026-06-04T05:05:11.000Z',
        lastErrorMessage: 'webhook target unavailable'
      })
    ]);
  });

  it('persists active and resolved system alert lifecycle records as Agent runtime services recover', async () => {
    const repository = createInMemoryControlPlaneRepository();
    let nowIso = '2026-06-04T04:01:10.000Z';
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => nowIso,
      inventory: {
        agents: []
      }
    });

    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-runtime-service-alert-missing',
      agentId: 'agent-runtime-service-alert-01',
      seq: 1,
      sessionId: 'sess-runtime-service-alert-01',
      observedAt: '2026-06-04T04:01:00.000Z',
      payload: {
        reportedAt: '2026-06-04T04:01:00.000Z',
        runtimeServices: [
          {
            name: 'ou-ui-xray.service',
            moduleKind: 'xray',
            status: 'missing',
            enabled: false,
            required: true,
            checkedAt: '2026-06-04T04:01:00.000Z',
            detail: 'unit file not found'
          }
        ]
      }
    });

    await expect(api.listSystemAlerts()).resolves.toEqual([
      expect.objectContaining({
        id: 'alert-agent-runtime-service-agent-runtime-service-alert-01-ou-ui-xray.service',
        kind: 'agent.runtime_service_unhealthy',
        status: 'active',
        severity: 'critical',
        resourceId: 'agent-runtime-service-alert-01',
        metadata: expect.objectContaining({
          serviceName: 'ou-ui-xray.service',
          serviceStatus: 'missing'
        })
      })
    ]);
    await expect(repository.listSystemAlertRecords()).resolves.toEqual([
      expect.objectContaining({
        id: 'alert-agent-runtime-service-agent-runtime-service-alert-01-ou-ui-xray.service',
        status: 'active',
        firstObservedAt: '2026-06-04T04:01:00.000Z',
        lastChangedAt: '2026-06-04T04:01:10.000Z'
      })
    ]);

    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-runtime-service-alert-recovered',
      agentId: 'agent-runtime-service-alert-01',
      seq: 2,
      sessionId: 'sess-runtime-service-alert-01',
      observedAt: '2026-06-04T04:01:45.000Z',
      payload: {
        reportedAt: '2026-06-04T04:01:45.000Z',
        runtimeServices: [
          {
            name: 'ou-ui-xray.service',
            moduleKind: 'xray',
            status: 'active',
            enabled: true,
            required: true,
            checkedAt: '2026-06-04T04:01:45.000Z'
          }
        ]
      }
    });

    nowIso = '2026-06-04T04:02:00.000Z';

    await expect(api.listSystemAlerts()).resolves.toEqual([]);
    await expect(repository.listSystemAlertRecords()).resolves.toEqual([
      expect.objectContaining({
        id: 'alert-agent-runtime-service-agent-runtime-service-alert-01-ou-ui-xray.service',
        status: 'resolved',
        firstObservedAt: '2026-06-04T04:01:00.000Z',
        resolvedAt: '2026-06-04T04:02:00.000Z',
        lastChangedAt: '2026-06-04T04:02:00.000Z'
      })
    ]);
  });

  it('does not resurrect a removed managed host when stale Agent telemetry keeps arriving', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      inventory: {
        agents: [
          {
            id: 'agent-removed-01',
            name: 'Removed Host',
            status: 'online',
            region: 'custom',
            publicAddress: '198.51.100.20',
            connectionMode: 'pull',
            version: '1.0.0-runtime',
            platform: 'linux/amd64',
            capabilities: ['host-agent', 'xray', 'port-forwarding'],
            maxTrafficBytes: 0,
            monthlyTrafficLimitBytes: 0,
            expiresAt: '',
            probeConfig: {
              pingTarget: '1.1.1.1',
              pingIntervalSeconds: 30,
              latencyGreenMaxMs: 100,
              latencyYellowMaxMs: 200
            },
            trafficPolicy: {
              accountingMode: 'both',
              monthlyResetDay: 1,
              manualUsedTrafficBytes: 0,
              telemetrySource: 'agent'
            },
            hardware: {},
            lastHeartbeatAt: '2026-06-04T04:00:00.000Z',
            telemetry: {
              cpuPercent: 0,
              memoryPercent: 0,
              memoryUsedBytes: 0,
              memoryTotalBytes: 0,
              diskUsedBytes: 0,
              diskTotalBytes: 0,
              txBytes: 0,
              rxBytes: 0,
              uploadSpeedBps: 0,
              downloadSpeedBps: 0,
              uploadTotalBytes: 0,
              downloadTotalBytes: 0,
              monthlyTrafficUsedBytes: 0,
              latencyMs: 0,
              latencySamplesMs: [],
              packetLossPercent: 0,
              packetLossSamplesPercent: [],
              onlineDays: 0
            }
          }
        ]
      }
    });

    await api.createTask(withRiskConfirmation({
      operation: 'agent.delete',
      resourceType: 'agent',
      targetId: 'agent-removed-01',
      targetLabel: 'Removed Host',
      summary: 'Remove stale managed host',
      metadata: {
        agentId: 'agent-removed-01',
        displayName: 'Removed Host'
      }
    }));
    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-stale-telemetry-agent-removed-01',
      agentId: 'agent-removed-01',
      seq: 2,
      sessionId: 'sess-agent-removed-01',
      observedAt: '2026-06-04T04:01:00.000Z',
      payload: {
        latencyMs: 42,
        cpuPercent: 20
      }
    });

    await expect(api.listAgents()).resolves.toEqual([]);
  });

  it('hydrates registered runtime credentials into provisioning managed hosts', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      inventory: {
        agents: []
      }
    });
    const command = await api.createAgentInstallCommand(
      {
        installProfile: [...AGENT_INSTALL_PROFILE],
        publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
      },
      mutationContext('service-api-agent-register-install')
    );

    const registration = await api.registerAgent(
      {
        agentId: command.agentId,
        requestId: 'req-service-api-agent-register',
        sessionId: 'sess-service-api-agent-register',
        version: '1.2.3-agent',
        platform: 'linux-x64',
        capabilities: [...AGENT_INSTALL_PROFILE]
      },
      command.installToken,
      {
        sourceIp: '198.51.100.70',
        userAgent: 'ou-agent-register-test'
      }
    );

    await expect(repository.listAgentCredentials()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: registration.credentialId,
          metadata: expect.objectContaining({
            registrationVersion: '1.2.3-agent',
            registrationPlatform: 'linux-x64',
            registrationCapabilities: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
          })
        })
      ])
    );
    await expect(api.listAgents()).resolves.toEqual([
      expect.objectContaining({
        id: command.agentId,
        name: command.agentId,
        status: 'provisioning',
        publicAddress: '198.51.100.70',
        connectionMode: 'pull',
        version: '1.2.3-agent',
        platform: 'linux-x64',
        capabilities: expect.arrayContaining(['host-agent', 'xray', 'port-forwarding'])
      })
    ]);
  });

  it('records denied Agent poll requests in the service-backed audit chain', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => '2026-06-02T00:00:00.000Z'
    });

    const auditLog = await api.recordAgentRequestDenied({
      endpoint: 'poll',
      requestId: 'req-service-api-agent-poll-denied',
      sourceIp: '198.51.100.80',
      userAgent: 'ou-agent-auth-test',
      denialCode: 'identity.mismatch',
      denialReason: 'Agent bearer token is bound to a different Agent identity.',
      tokenPresented: true,
      agentIds: ['agent-sin-01'],
      sessionIds: ['sess-agent-sin-01'],
      authenticatedAgentId: 'agent-hkg-01',
      authenticatedSessionId: 'sess-agent-hkg-01',
      credentialId: 'agent-credential-hkg-01'
    });

    expect(auditLog).toEqual(
      expect.objectContaining({
        action: 'audit.denied',
        operation: 'agent.poll',
        actor: 'agent:agent-hkg-01',
        targetId: 'agent-sin-01',
        requestId: 'req-service-api-agent-poll-denied',
        denialCode: 'identity.mismatch',
        before: {
          authenticatedAgent: {
            agentId: 'agent-hkg-01',
            sessionId: 'sess-agent-hkg-01',
            credentialId: 'agent-credential-hkg-01'
          }
        },
        after: {
          endpoint: 'poll',
          agentIds: ['agent-sin-01'],
          sessionIds: ['sess-agent-sin-01'],
          tokenPresented: true
        },
        hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
      })
    );
    await expect(api.verifyAuditLogChain()).resolves.toEqual({
      valid: true,
      checked: 1
    });
    expect(JSON.stringify(await repository.listAuditLogs())).not.toContain('agent-token');
    expect(JSON.stringify(await repository.listAuditLogs())).not.toContain('tokenHash');
  });

  it('records denied operator requests in the service-backed audit chain', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => '2026-06-02T00:00:00.000Z'
    });

    const auditLog = await api.recordOperatorRequestDenied({
      method: 'POST',
      path: '/api/v1/tasks',
      requestId: 'req-service-api-operator-auth-denied',
      sourceIp: '198.51.100.90',
      userAgent: 'operator-auth-test',
      denialCode: 'unauthorized',
      denialReason: 'A valid operator bearer token is required.',
      tokenPresented: true
    });

    expect(auditLog).toEqual(
      expect.objectContaining({
        action: 'audit.denied',
        operation: 'operator.auth',
        actor: 'operator:unauthenticated',
        resourceType: 'permission',
        targetId: 'POST /api/v1/tasks',
        requestId: 'req-service-api-operator-auth-denied',
        denialCode: 'unauthorized',
        after: {
          method: 'POST',
          path: '/api/v1/tasks',
          tokenPresented: true
        },
        hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
      })
    );
    await expect(api.verifyAuditLogChain()).resolves.toEqual({
      valid: true,
      checked: 1
    });
    expect(JSON.stringify(await repository.listAuditLogs())).not.toContain('operator-token');
    expect(JSON.stringify(await repository.listAuditLogs())).not.toContain('tokenHash');
  });

  it('replays subscription source deletion across restarts and filters stale inventory nodes', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await api.createTask(
      {
        operation: 'subscription.import',
        resourceType: 'subscription',
        targetId: 'source-restart-delete',
        targetLabel: 'Restart Delete Source',
        summary: 'Import restart delete source',
        metadata: {
          sourceId: 'source-restart-delete',
          kind: 'clash',
          name: 'Restart Delete Source',
          url: 'https://provider.example.com/restart.yaml',
          refreshIntervalMinutes: 30,
          dedupeKey: 'server-port'
        }
      },
      mutationContext('subscription-import-restart-delete')
    );
    await api.createTask(
      withRiskConfirmation({
        operation: 'subscription.delete',
        resourceType: 'subscription',
        targetId: 'source-restart-delete',
        targetLabel: 'Restart Delete Source',
        summary: 'Delete restart source',
        metadata: {
          sourceId: 'source-restart-delete'
        }
      }),
      mutationContext('subscription-delete-restart-delete')
    );
    await repository.transaction((transaction) =>
      transaction.replaceSubscriptionInventoryNodesForSource('source-restart-delete', [
        {
          id: 'inventory-source-restart-delete-vless-01',
          sourceId: 'source-restart-delete',
          name: 'Restart Deleted Node',
          protocol: 'vless',
          server: '198.51.100.22',
          port: 443,
          latencyMs: 82,
          tags: ['region:hk'],
          rawUrl: 'vless://11111111-1111-4111-8111-111111111111@198.51.100.22:443#Restart',
          inboundTag: 'source-restart-delete-vless-01'
        }
      ])
    );

    const restartedApi = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await expect(restartedApi.listSubscriptionSources()).resolves.toEqual([]);
    await expect(restartedApi.listSubscriptionInventoryNodes()).resolves.toEqual([]);
  });

  it('persists subscription source sync state across service-backed API restarts', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const fetcher: typeof fetch = async () =>
      new Response(
        [
          'proxies:',
          '  - name: "HK Persisted Sync 01"',
          '    type: vless',
          '    server: persisted-hk.example.com',
          '    port: 443',
          '    uuid: 11111111-1111-4111-8111-111111111111'
        ].join('\n'),
        {
          status: 200,
          headers: {
            'Content-Type': 'text/yaml',
            'subscription-userinfo': `upload=${2 * 1024 * 1024}; download=${4 * 1024 * 1024}; total=${500 * 1024 * 1024}; expire=1798761600`
          }
        }
      );
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      fetcher,
      subscriptionSourceHostResolver: allowPublicSubscriptionHostResolver,
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await api.createTask(
      {
        operation: 'subscription.import',
        resourceType: 'subscription',
        targetId: 'source-persisted-sync',
        targetLabel: 'Persisted Sync Source',
        summary: 'Import persisted sync source',
        metadata: {
          sourceId: 'source-persisted-sync',
          kind: 'clash',
          name: 'Persisted Sync Source',
          url: 'https://provider.example.com/persisted.yaml',
          refreshIntervalMinutes: 30,
          dedupeKey: 'server-port'
        }
      },
      mutationContext('subscription-import-persisted-sync')
    );
    await expect(api.syncSubscriptionSource('source-persisted-sync')).resolves.toMatchObject({
      status: 'synced',
      nodeCount: 1,
      traffic: {
        sourceId: 'source-persisted-sync',
        uploadBytes: 2 * 1024 * 1024,
        downloadBytes: 4 * 1024 * 1024,
        totalBytes: 500 * 1024 * 1024,
        expiresAt: '2027-01-01T00:00:00.000Z'
      }
    });
    await expect(repository.listSubscriptionSources()).resolves.toEqual([
      expect.objectContaining({
        id: 'source-persisted-sync',
        status: 'synced',
        nodeCount: 1,
        traffic: {
          sourceId: 'source-persisted-sync',
          uploadBytes: 2 * 1024 * 1024,
          downloadBytes: 4 * 1024 * 1024,
          totalBytes: 500 * 1024 * 1024,
          expiresAt: '2027-01-01T00:00:00.000Z'
        }
      })
    ]);
    await api.createTask(
      {
        operation: 'subscription.generate',
        resourceType: 'subscription',
        targetId: 'sub-client-persisted-count',
        targetLabel: 'Persisted Count Client',
        summary: 'Create persisted count client',
        metadata: {
          subscriptionClientId: 'sub-client-persisted-count',
          displayName: 'Persisted Count Client',
          subId: 'persisted_count',
          email: 'count@example.com',
          protocol: 'vless',
          sourceIds: ['source-persisted-sync'],
          formats: ['plain', 'clash'],
          outputFormats: ['uri', 'clash'],
          generatedNodeCount: 999,
          remainingDays: 30
        }
      },
      mutationContext('subscription-client-persisted-count')
    );
    await expect(repository.listSubscriptionClients()).resolves.toEqual([
      expect.objectContaining({
        id: 'sub-client-persisted-count',
        generatedNodeCount: 1
      })
    ]);

    const restartedApi = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      fetcher,
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await expect(restartedApi.listSubscriptionSources()).resolves.toEqual([
      expect.objectContaining({
        id: 'source-persisted-sync',
        status: 'synced',
        nodeCount: 1,
        traffic: expect.objectContaining({
          downloadBytes: 4 * 1024 * 1024,
          totalBytes: 500 * 1024 * 1024
        })
      })
    ]);
    await expect(restartedApi.listSubscriptionInventoryNodes()).resolves.toEqual([
      expect.objectContaining({
        sourceId: 'source-persisted-sync',
        name: 'HK Persisted Sync 01',
        server: 'persisted-hk.example.com'
      })
    ]);
    await expect(restartedApi.listSubscriptionClients()).resolves.toEqual([
      expect.objectContaining({
        id: 'sub-client-persisted-count',
        generatedNodeCount: 1
      })
    ]);
    await expect(restartedApi.listSubscriptionBundles()).resolves.toEqual([
      expect.objectContaining({
        id: 'sub-global-premium',
        sources: [expect.objectContaining({ id: 'source-persisted-sync', nodeCount: 1, status: 'ok' })],
        generatedNodeCount: 1,
        healthScore: 100
      })
    ]);
  });

  it('marks external subscription source syncs warning when imported nodes duplicate another source', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      const name = url.includes('backup') ? 'HK Backup Duplicate' : 'HK Primary Node';

      return new Response(
        [
          'proxies:',
          `  - name: "${name}"`,
          '    type: vless',
          '    server: duplicate-hk.example.com',
          '    port: 443',
          '    uuid: 11111111-1111-4111-8111-111111111111'
        ].join('\n'),
        {
          status: 200,
          headers: {
            'Content-Type': 'text/yaml'
          }
        }
      );
    };
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      fetcher,
      subscriptionSourceHostResolver: allowPublicSubscriptionHostResolver,
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    for (const sourceId of ['source-primary-sync', 'source-backup-sync']) {
      await api.createTask(
        {
          operation: 'subscription.import',
          resourceType: 'subscription',
          targetId: sourceId,
          targetLabel: sourceId,
          summary: `Import ${sourceId}`,
          metadata: {
            sourceId,
            kind: 'clash',
            name: sourceId,
            url: `https://provider.example.com/${sourceId.includes('backup') ? 'backup' : 'primary'}.yaml`,
            refreshIntervalMinutes: 30,
            dedupeKey: 'server-port'
          }
        },
        mutationContext(`subscription-import-${sourceId}`)
      );
    }

    await expect(api.syncSubscriptionSource('source-primary-sync')).resolves.toMatchObject({
      status: 'synced',
      warnings: []
    });
    await expect(api.syncSubscriptionSource('source-backup-sync')).resolves.toMatchObject({
      status: 'warning',
      nodeCount: 1,
      warnings: ['subscription_source.cross_source_duplicates:1']
    });
    await expect(repository.listSubscriptionSources()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'source-primary-sync', status: 'synced', nodeCount: 1, syncWarnings: [] }),
      expect.objectContaining({
        id: 'source-backup-sync',
        status: 'warning',
        nodeCount: 1,
        syncWarnings: ['subscription_source.cross_source_duplicates:1']
      })
    ]));
    await expect(repository.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'subscription.source.synced',
          operation: 'subscription.sync',
          targetId: 'source-primary-sync',
          result: 'succeeded',
          severity: 'info'
        }),
        expect.objectContaining({
          action: 'subscription.source.synced',
          operation: 'subscription.sync',
          targetId: 'source-backup-sync',
          result: 'succeeded',
          severity: 'warning',
          after: expect.objectContaining({
            warnings: ['subscription_source.cross_source_duplicates:1']
          })
        })
      ])
    );
    await expect(api.verifyAuditLogChain()).resolves.toMatchObject({ valid: true });
  });

  it('audits failed service-backed external subscription source syncs', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const fetcher: typeof fetch = async () =>
      new Response('upstream unavailable', {
        status: 503,
        statusText: 'Service Unavailable'
      });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      fetcher,
      subscriptionSourceHostResolver: allowPublicSubscriptionHostResolver,
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await api.createTask(
      {
        operation: 'subscription.import',
        resourceType: 'subscription',
        targetId: 'source-failed-sync',
        targetLabel: 'Failed Sync Source',
        summary: 'Import failed sync source',
        metadata: {
          sourceId: 'source-failed-sync',
          kind: 'clash',
          name: 'Failed Sync Source',
          url: 'https://provider.example.com/failed.yaml',
          refreshIntervalMinutes: 30,
          dedupeKey: 'server-port'
        }
      },
      mutationContext('subscription-import-failed-sync')
    );

    await expect(api.syncSubscriptionSource('source-failed-sync')).resolves.toMatchObject({
      status: 'failed',
      nodeCount: 0,
      warnings: ['subscription_source.sync_failed:remote responded 503 Service Unavailable']
    });
    await expect(repository.listSubscriptionSources()).resolves.toEqual([
      expect.objectContaining({
        id: 'source-failed-sync',
        status: 'failed',
        nodeCount: 0,
        syncWarnings: ['subscription_source.sync_failed:remote responded 503 Service Unavailable']
      })
    ]);
    await expect(repository.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'subscription.source.sync_failed',
          operation: 'subscription.sync',
          targetId: 'source-failed-sync',
          result: 'failed',
          severity: 'warning',
          after: expect.objectContaining({
            warnings: ['subscription_source.sync_failed:remote responded 503 Service Unavailable']
          })
        })
      ])
    );
    await expect(api.verifyAuditLogChain()).resolves.toMatchObject({ valid: true });
  });

  it('rejects unsupported external subscription source URL protocols without remote fetch', async () => {
    const repository = createInMemoryControlPlaneRepository();
    let fetchCalled = false;
    const fetcher: typeof fetch = async () => {
      fetchCalled = true;
      return new Response('');
    };
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      fetcher,
      subscriptionSourceHostResolver: allowPublicSubscriptionHostResolver,
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await importSubscriptionSource(api, {
      sourceId: 'source-unsupported-url-sync',
      name: 'Unsupported URL Sync Source',
      url: 'file:///etc/passwd'
    });

    await expect(api.syncSubscriptionSource('source-unsupported-url-sync')).resolves.toMatchObject({
      status: 'failed',
      nodeCount: 0,
      warnings: ['subscription_source.sync_failed:subscription source url protocol must be http or https']
    });
    expect(fetchCalled).toBe(false);
    await expect(repository.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'subscription.source.sync_failed',
          targetId: 'source-unsupported-url-sync',
          after: expect.objectContaining({
            warnings: ['subscription_source.sync_failed:subscription source url protocol must be http or https']
          })
        })
      ])
    );
    await expect(api.verifyAuditLogChain()).resolves.toMatchObject({ valid: true });
  });

  it('rejects local and private external subscription source hosts without remote fetch', async () => {
    const repository = createInMemoryControlPlaneRepository();
    let fetchCalled = false;
    const resolvedHostnames: string[] = [];
    const fetcher: typeof fetch = async () => {
      fetchCalled = true;
      return new Response('');
    };
    const hostResolver = async (hostname: string) => {
      resolvedHostnames.push(hostname);
      return allowPublicSubscriptionHostResolver();
    };
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      fetcher,
      subscriptionSourceHostResolver: hostResolver,
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });
    const blockedSources = [
      ['source-localhost-sync', 'https://localhost/sub.yaml'],
      ['source-private-ip-sync', 'http://192.168.1.10/sub.yaml'],
      ['source-short-loopback-ip-sync', 'http://127.1/sub.yaml'],
      ['source-cgnat-ip-sync', 'http://100.64.1.10/sub.yaml'],
      ['source-ipv6-loopback-sync', 'http://[::1]/sub.yaml'],
      ['source-ipv6-ula-sync', 'http://[fd00::1]/sub.yaml'],
      ['source-ipv6-link-local-sync', 'http://[fe80::1]/sub.yaml'],
      ['source-ipv6-multicast-sync', 'http://[ff02::1]/sub.yaml'],
      ['source-ipv6-mapped-private-sync', 'http://[::ffff:192.168.1.10]/sub.yaml']
    ] as const;

    for (const [sourceId, url] of blockedSources) {
      await importSubscriptionSource(api, {
        sourceId,
        name: sourceId,
        url
      });

      await expect(api.syncSubscriptionSource(sourceId)).resolves.toMatchObject({
        status: 'failed',
        nodeCount: 0,
        warnings: ['subscription_source.sync_failed:subscription source host is not allowed for remote fetch']
      });
    }

    expect(fetchCalled).toBe(false);
    expect(resolvedHostnames).toEqual([]);
    await expect(repository.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining(
        blockedSources.map(([sourceId]) =>
          expect.objectContaining({
            action: 'subscription.source.sync_failed',
            targetId: sourceId,
            after: expect.objectContaining({
              warnings: ['subscription_source.sync_failed:subscription source host is not allowed for remote fetch']
            })
          })
        )
      )
    );
    await expect(api.verifyAuditLogChain()).resolves.toMatchObject({ valid: true });
  });

  it('rejects external subscription source hosts that resolve to private addresses without remote fetch', async () => {
    const repository = createInMemoryControlPlaneRepository();
    let fetchCalled = false;
    const resolvedHostnames: string[] = [];
    const fetcher: typeof fetch = async () => {
      fetchCalled = true;
      return new Response('');
    };
    const hostResolver = async (hostname: string) => {
      resolvedHostnames.push(hostname);
      return [
        { address: '93.184.216.34', family: 4 as const },
        { address: '10.2.3.4', family: 4 as const }
      ];
    };
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      fetcher,
      subscriptionSourceHostResolver: hostResolver,
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await importSubscriptionSource(api, {
      sourceId: 'source-resolved-private-sync',
      name: 'Resolved Private Sync Source',
      url: 'https://updates.example.test/sub.yaml'
    });

    await expect(api.syncSubscriptionSource('source-resolved-private-sync')).resolves.toMatchObject({
      status: 'failed',
      nodeCount: 0,
      warnings: ['subscription_source.sync_failed:subscription source resolved host is not allowed for remote fetch']
    });
    expect(resolvedHostnames).toEqual(['updates.example.test']);
    expect(fetchCalled).toBe(false);
    await expect(repository.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'subscription.source.sync_failed',
          targetId: 'source-resolved-private-sync',
          after: expect.objectContaining({
            warnings: [
              'subscription_source.sync_failed:subscription source resolved host is not allowed for remote fetch'
            ]
          })
        })
      ])
    );
    await expect(api.verifyAuditLogChain()).resolves.toMatchObject({ valid: true });
  });

  it('enforces the external subscription source egress allowlist before DNS and remote fetch', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const resolvedHostnames: string[] = [];
    const fetchedUrls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      fetchedUrls.push(String(input));
      return new Response(
        [
          'proxies:',
          '  - name: "Allowlisted HK 01"',
          '    type: vless',
          '    server: allowlisted-hk.example.com',
          '    port: 443',
          '    uuid: 11111111-1111-4111-8111-111111111111'
        ].join('\n'),
        {
          status: 200,
          headers: {
            'Content-Type': 'text/yaml'
          }
        }
      );
    };
    const hostResolver = async (hostname: string) => {
      resolvedHostnames.push(hostname);
      return allowPublicSubscriptionHostResolver();
    };
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      fetcher,
      subscriptionSourceHostResolver: hostResolver,
      subscriptionSourceEgress: {
        allowedHosts: ['*.trusted.example.com']
      },
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await importSubscriptionSource(api, {
      sourceId: 'source-allowlisted-sync',
      name: 'Allowlisted Sync Source',
      url: 'https://edge.trusted.example.com/sub.yaml'
    });
    await importSubscriptionSource(api, {
      sourceId: 'source-not-allowlisted-sync',
      name: 'Not Allowlisted Sync Source',
      url: 'https://blocked.example.com/sub.yaml'
    });

    await expect(api.syncSubscriptionSource('source-allowlisted-sync')).resolves.toMatchObject({
      status: 'synced',
      nodeCount: 1
    });
    await expect(api.syncSubscriptionSource('source-not-allowlisted-sync')).resolves.toMatchObject({
      status: 'failed',
      nodeCount: 0,
      warnings: ['subscription_source.sync_failed:subscription source host is not in the egress allowlist']
    });
    expect(resolvedHostnames).toEqual(['edge.trusted.example.com']);
    expect(fetchedUrls).toEqual(['https://edge.trusted.example.com/sub.yaml']);
    await expect(repository.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'subscription.source.synced',
          targetId: 'source-allowlisted-sync',
          result: 'succeeded'
        }),
        expect.objectContaining({
          action: 'subscription.source.sync_failed',
          targetId: 'source-not-allowlisted-sync',
          after: expect.objectContaining({
            warnings: ['subscription_source.sync_failed:subscription source host is not in the egress allowlist']
          })
        })
      ])
    );
    await expect(api.verifyAuditLogChain()).resolves.toMatchObject({ valid: true });
  });

  it('pins external subscription source fetches to the DNS-resolved public address', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const resolvedHostnames: string[] = [];
    const remoteFetches: Array<{
      url: string;
      resolvedAddress: string;
      resolvedAddresses: string[];
      accept: string;
    }> = [];
    const hostResolver = async (hostname: string) => {
      resolvedHostnames.push(hostname);
      return [
        { address: '93.184.216.34', family: 4 as const },
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 as const }
      ];
    };
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      subscriptionSourceHostResolver: hostResolver,
      subscriptionSourceRemoteFetcher: async ({ target, headers }) => {
        remoteFetches.push({
          url: target.url.toString(),
          resolvedAddress: target.resolvedAddress.address,
          resolvedAddresses: target.resolvedAddresses.map((record) => record.address),
          accept: headers.Accept
        });

        return {
          body: [
            'proxies:',
            '  - name: "Pinned HK 01"',
            '    type: vless',
            '    server: pinned-hk.example.com',
            '    port: 443',
            '    uuid: 11111111-1111-4111-8111-111111111111'
          ].join('\n')
        };
      },
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await importSubscriptionSource(api, {
      sourceId: 'source-pinned-sync',
      name: 'Pinned Sync Source',
      url: 'https://updates.example.test/sub.yaml'
    });

    await expect(api.syncSubscriptionSource('source-pinned-sync')).resolves.toMatchObject({
      status: 'synced',
      nodeCount: 1
    });
    expect(resolvedHostnames).toEqual(['updates.example.test']);
    expect(remoteFetches).toEqual([
      {
        url: 'https://updates.example.test/sub.yaml',
        resolvedAddress: '93.184.216.34',
        resolvedAddresses: ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'],
        accept: 'text/yaml,application/yaml,text/plain,*/*'
      }
    ]);
    await expect(repository.listSubscriptionInventoryNodes()).resolves.toEqual([
      expect.objectContaining({
        sourceId: 'source-pinned-sync',
        name: 'Pinned HK 01'
      })
    ]);
    await expect(api.verifyAuditLogChain()).resolves.toMatchObject({ valid: true });
  });

  it('rate limits concurrent external subscription syncs through a persisted sync lease', async () => {
    const repository = createInMemoryControlPlaneRepository();
    let releaseFirstFetch!: () => void;
    let secondRemoteFetchCalled = false;
    let markFirstFetchStarted!: () => void;
    const firstFetchStarted = new Promise<void>((resolve) => {
      markFirstFetchStarted = resolve;
    });
    const firstApi = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      subscriptionSourceHostResolver: allowPublicSubscriptionHostResolver,
      subscriptionSourceRemoteFetcher: async () => {
        markFirstFetchStarted();
        await new Promise<void>((release) => {
          releaseFirstFetch = release;
        });

        return {
          body: [
            'proxies:',
            '  - name: "Lease HK 01"',
            '    type: vless',
            '    server: lease-hk.example.com',
            '    port: 443',
            '    uuid: 11111111-1111-4111-8111-111111111111'
          ].join('\n')
        };
      },
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });
    const secondApi = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      subscriptionSourceHostResolver: allowPublicSubscriptionHostResolver,
      subscriptionSourceRemoteFetcher: async () => {
        secondRemoteFetchCalled = true;
        return { body: 'proxies: []' };
      },
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await importSubscriptionSource(firstApi, {
      sourceId: 'source-lease-sync',
      name: 'Lease Sync Source',
      url: 'https://lease.example.test/sub.yaml'
    });
    const firstSync = firstApi.syncSubscriptionSource('source-lease-sync');

    await firstFetchStarted;
    await expect(repository.listSubscriptionSources()).resolves.toEqual([
      expect.objectContaining({
        id: 'source-lease-sync',
        status: 'syncing',
        syncLeaseOwnerId: expect.stringMatching(/^subscription-sync-source-lease-sync-/),
        syncLeaseExpiresAt: expect.any(String)
      })
    ]);

    await expect(secondApi.syncSubscriptionSource('source-lease-sync')).rejects.toMatchObject({
      code: 'subscription_source.rate_limited',
      details: expect.objectContaining({
        sourceId: 'source-lease-sync'
      })
    });
    expect(secondRemoteFetchCalled).toBe(false);

    releaseFirstFetch();
    await expect(firstSync).resolves.toMatchObject({
      status: 'synced',
      nodeCount: 1
    });
    const [syncedSource] = await repository.listSubscriptionSources();
    expect(syncedSource.syncLeaseOwnerId).toBeUndefined();
    expect(syncedSource.syncLeaseExpiresAt).toBeUndefined();
  });

  it('enforces a provider-host fetch budget across different external subscription sources', async () => {
    const repository = createInMemoryControlPlaneRepository();
    let releaseFirstFetch!: () => void;
    let markFirstFetchStarted!: () => void;
    let secondRemoteFetchCalled = false;
    const firstFetchStarted = new Promise<void>((resolve) => {
      markFirstFetchStarted = resolve;
    });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      subscriptionSourceHostResolver: allowPublicSubscriptionHostResolver,
      subscriptionSourceProviderBudget: {
        maxConcurrentFetchesPerHost: 1
      },
      subscriptionSourceRemoteFetcher: async ({ source }) => {
        if (source.id === 'source-provider-budget-primary') {
          markFirstFetchStarted();
          await new Promise<void>((release) => {
            releaseFirstFetch = release;
          });

          return {
            body: [
              'proxies:',
              '  - name: "Provider Budget Primary"',
              '    type: vless',
              '    server: provider-budget-primary.example.com',
              '    port: 443',
              '    uuid: 11111111-1111-4111-8111-111111111111'
            ].join('\n')
          };
        }

        secondRemoteFetchCalled = true;
        return { body: 'proxies: []' };
      },
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await importSubscriptionSource(api, {
      sourceId: 'source-provider-budget-primary',
      name: 'Provider Budget Primary',
      url: 'https://shared-provider.example.test/primary.yaml'
    });
    await importSubscriptionSource(api, {
      sourceId: 'source-provider-budget-secondary',
      name: 'Provider Budget Secondary',
      url: 'https://shared-provider.example.test/secondary.yaml'
    });

    const firstSync = api.syncSubscriptionSource('source-provider-budget-primary');

    await firstFetchStarted;
    await expect(api.syncSubscriptionSource('source-provider-budget-secondary')).rejects.toMatchObject({
      code: 'subscription_source.rate_limited',
      details: expect.objectContaining({
        sourceId: 'source-provider-budget-secondary',
        providerHost: 'shared-provider.example.test',
        maxConcurrentFetchesPerHost: 1,
        activeSyncCount: 1,
        activeSourceIds: ['source-provider-budget-primary']
      })
    });
    expect(secondRemoteFetchCalled).toBe(false);

    releaseFirstFetch();
    await expect(firstSync).resolves.toMatchObject({
      status: 'synced',
      nodeCount: 1
    });
  });

  it('fails external subscription source syncs that exceed the configured body limit', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const fetcher: typeof fetch = async () =>
      new Response('x'.repeat(11), {
        status: 200,
        headers: {
          'Content-Type': 'text/yaml',
          'Content-Length': '11'
        }
      });
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      fetcher,
      subscriptionSourceHostResolver: allowPublicSubscriptionHostResolver,
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await importSubscriptionSource(api, {
      sourceId: 'source-oversized-sync',
      name: 'Oversized Sync Source',
      url: 'https://provider.example.com/oversized.yaml',
      maxBodyBytes: 10
    });

    await expect(api.syncSubscriptionSource('source-oversized-sync')).resolves.toMatchObject({
      status: 'failed',
      nodeCount: 0,
      warnings: ['subscription_source.sync_failed:remote response exceeds 10 bytes']
    });
    await expect(repository.listSubscriptionSources()).resolves.toEqual([
      expect.objectContaining({
        id: 'source-oversized-sync',
        status: 'failed',
        nodeCount: 0,
        maxBodyBytes: 10,
        syncWarnings: ['subscription_source.sync_failed:remote response exceeds 10 bytes']
      })
    ]);
    await expect(api.verifyAuditLogChain()).resolves.toMatchObject({ valid: true });
  });

  it('times out external subscription source fetches and records sync failure state', async () => {
    const repository = createInMemoryControlPlaneRepository();
    let observedSignal: AbortSignal | undefined;
    const fetcher: typeof fetch = async (_input, init) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    };
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      fetcher,
      subscriptionSourceHostResolver: allowPublicSubscriptionHostResolver,
      subscriptionSourceFetch: {
        timeoutMs: 5
      },
      inventory: {
        subscriptionSources: [],
        subscriptionInventoryNodes: []
      }
    });

    await importSubscriptionSource(api, {
      sourceId: 'source-timeout-sync',
      name: 'Timeout Sync Source',
      url: 'https://provider.example.com/timeout.yaml'
    });

    await expect(api.syncSubscriptionSource('source-timeout-sync')).resolves.toMatchObject({
      status: 'failed',
      nodeCount: 0,
      warnings: ['subscription_source.sync_failed:remote fetch timed out after 5ms']
    });
    expect(observedSignal?.aborted).toBe(true);
    await expect(repository.listSubscriptionSources()).resolves.toEqual([
      expect.objectContaining({
        id: 'source-timeout-sync',
        status: 'failed',
        nodeCount: 0,
        syncWarnings: ['subscription_source.sync_failed:remote fetch timed out after 5ms']
      })
    ]);
    await expect(api.verifyAuditLogChain()).resolves.toMatchObject({ valid: true });
  });

  it('projects service-backed subscription client traffic from matched Xray clients', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const inbounds: XrayInbound[] = [
      {
        id: 'inbound-acme-hk-vless',
        nodeId: 'node-hk',
        agentId: 'agent-hk',
        customerName: 'Acme',
        serverAddress: 'edge.example.com',
        clientIdentity: '11111111-1111-4111-8111-111111111111',
        subscriptionRule: 'premium',
        protocol: 'vless',
        label: 'Acme HK VLESS',
        listenAddress: '0.0.0.0',
        listenPort: 443,
        status: 'enabled',
        clients: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            email: 'acme@example.com',
            enabled: true,
            credentialType: 'uuid',
            subId: 'sub_acme_hk',
            trafficLimitBytes: 500 * 1024 * 1024 * 1024,
            usedTrafficBytes: 40 * 1024 * 1024 * 1024,
            expiresAt: '2026-12-31T23:59:59.000Z',
            ipLimit: 3
          }
        ],
        streamSettings: {
          network: 'tcp',
          security: 'reality',
          sni: 'edge.example.com',
          fingerprint: 'chrome'
        },
        tls: {
          enabled: true,
          certificateId: 'cert-edge',
          alpn: ['h2', 'http/1.1']
        },
        reality: {
          enabled: true,
          publicKey: 'reality-public-key',
          fingerprint: 'chrome',
          shortIds: ['a1b2c3d4'],
          serverNames: ['edge.example.com']
        },
        fallbacks: [],
        sniffingEnabled: true,
        configVersion: 'cfg-acme-vless'
      }
    ];
    const subscriptionClients: SubscriptionClientIdentity[] = [
      {
        id: 'sub-client-acme-hk',
        customerName: 'Acme',
        displayName: 'Acme HK',
        subId: 'sub_acme_hk',
        email: 'acme@example.com',
        enabled: true,
        protocol: 'vless',
        group: 'premium',
        trafficLimitBytes: 500 * 1024 * 1024 * 1024,
        usedTrafficBytes: 2 * 1024 * 1024 * 1024,
        expiresAt: '2026-12-31T23:59:59.000Z',
        ipLimit: 3,
        requestLimitPerHour: 360,
        sourceIds: [],
        selectedTags: ['premium'],
        includeFilter: '',
        excludeFilter: '',
        regionFilter: [],
        routingRule: 'tag:premium',
        maxLatencyMs: 0,
        sortStrategy: 'latency',
        formats: ['plain', 'clash'],
        outputFormats: ['uri', 'clash'],
        templateName: 'mihomo-compatible.yaml',
        accessTokenPreview: 'sub_acme...hk',
        generatedNodeCount: 99,
        lastGeneratedAt: '2026-06-04T00:00:00.000Z'
      }
    ];
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      inventory: {
        inbounds,
        subscriptionClients
      }
    });

    await expect(api.listSubscriptionClients()).resolves.toEqual([
      expect.objectContaining({
        id: 'sub-client-acme-hk',
        usedTrafficBytes: 40 * 1024 * 1024 * 1024,
        generatedNodeCount: 1
      })
    ]);
  });

  it('resets subscription-user quota from the live projected baseline and counts only post-reset traffic', async () => {
    const repository = createInMemoryControlPlaneRepository({
      permissionGrants: seedPermissionGrants
    });
    const inbounds: XrayInbound[] = [
      {
        id: 'inbound-acme-reset-vless',
        nodeId: 'node-hk',
        agentId: 'agent-hk',
        customerName: 'Acme',
        serverAddress: 'edge.example.com',
        clientIdentity: '11111111-1111-4111-8111-111111111111',
        subscriptionRule: 'premium',
        protocol: 'vless',
        label: 'Acme Reset VLESS',
        listenAddress: '0.0.0.0',
        listenPort: 443,
        status: 'enabled',
        clients: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            email: 'acme-reset@example.com',
            enabled: true,
            credentialType: 'uuid',
            subId: 'sub_acme_reset',
            trafficLimitBytes: 500 * GB,
            usedTrafficBytes: 40 * GB,
            lastTrafficSampleAt: '2026-06-05T12:00:00.000Z',
            expiresAt: '2026-12-31T23:59:59.000Z',
            ipLimit: 3
          }
        ],
        streamSettings: {
          network: 'tcp',
          security: 'reality',
          sni: 'edge.example.com',
          fingerprint: 'chrome'
        },
        tls: {
          enabled: true,
          certificateId: 'cert-edge',
          alpn: ['h2', 'http/1.1']
        },
        reality: {
          enabled: true,
          publicKey: 'reality-public-key',
          fingerprint: 'chrome',
          shortIds: ['a1b2c3d4'],
          serverNames: ['edge.example.com']
        },
        fallbacks: [],
        sniffingEnabled: true,
        configVersion: 'cfg-acme-reset-vless'
      }
    ];
    const subscriptionClients: SubscriptionClientIdentity[] = [
      {
        id: 'sub-client-acme-reset',
        customerName: 'Acme',
        displayName: 'Acme Reset Subscription',
        subId: 'sub_acme_reset',
        email: 'acme-reset@example.com',
        enabled: true,
        protocol: 'vless',
        group: 'premium',
        trafficLimitBytes: 50 * GB,
        usedTrafficBytes: 2 * GB,
        expiresAt: '2026-12-31T23:59:59.000Z',
        ipLimit: 3,
        requestLimitPerHour: 360,
        sourceIds: [],
        selectedTags: ['premium'],
        includeFilter: '',
        excludeFilter: '',
        regionFilter: [],
        routingRule: 'tag:premium',
        maxLatencyMs: 0,
        sortStrategy: 'latency',
        formats: ['plain', 'clash'],
        outputFormats: ['uri', 'clash'],
        templateName: 'mihomo-compatible.yaml',
        accessTokenPreview: 'sub_acme...set',
        securePathPreview: '/subscription/acme-reset',
        generatedNodeCount: 99,
        lastGeneratedAt: '2026-06-05T11:00:00.000Z'
      }
    ];
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      readModelNow: () => '2026-06-05T12:05:00.000Z',
      inventory: {
        inbounds,
        subscriptionClients
      }
    });

    expect((await api.listQuotaPolicies()).find((policy) => policy.id === 'user:sub-client-acme-reset')).toMatchObject({
      scope: 'user',
      usedBytes: 40 * GB,
      enforcementState: 'active'
    });

    await api.resetQuotaPolicy('user:sub-client-acme-reset', mutationContext('subscription-user-quota-reset'));

    const resetTask = (await api.listTasks()).find((task) => task.operation === 'quota.reset');
    expect(resetTask).toMatchObject({
      targetId: 'user:sub-client-acme-reset',
      metadata: expect.objectContaining({
        quotaResetSubscriptionClientDescriptors: [
          expect.objectContaining({
            subscriptionClientId: 'sub-client-acme-reset',
            resetAt: '2026-06-05T12:05:00.000Z',
            baselineUsedTrafficBytes: 40 * GB
          })
        ]
      })
    });
    await expect(api.listSubscriptionClients()).resolves.toEqual([
      expect.objectContaining({
        id: 'sub-client-acme-reset',
        usedTrafficBytes: 0,
        quotaResetAt: '2026-06-05T12:05:00.000Z',
        quotaResetBaselineUsedTrafficBytes: 40 * GB,
        quotaExceeded: false,
        guardrailReason: 'ok'
      })
    ]);
    expect((await api.listQuotaPolicies()).find((policy) => policy.id === 'user:sub-client-acme-reset')).toMatchObject({
      usedBytes: 0,
      enforcementState: 'active'
    });

    await api.receiveAgentEvent({
      type: 'telemetry_sample',
      eventId: 'evt-subscription-user-post-reset',
      agentId: 'agent-hk',
      seq: 1,
      sessionId: 'sess-subscription-user-post-reset',
      observedAt: '2026-06-05T12:10:00.000Z',
      payload: {
        xrayClientCounters: [
          {
            inboundId: 'inbound-acme-reset-vless',
            clientId: '11111111-1111-4111-8111-111111111111',
            clientEmail: 'acme-reset@example.com',
            usedTrafficBytes: 43 * GB,
            uplinkBytes: 20 * GB,
            downlinkBytes: 23 * GB,
            trafficLimitBytes: 500 * GB,
            sampledAt: '2026-06-05T12:10:00.000Z',
            source: 'xray-stats'
          }
        ]
      }
    });

    await expect(api.listSubscriptionClients()).resolves.toEqual([
      expect.objectContaining({
        id: 'sub-client-acme-reset',
        usedTrafficBytes: 3 * GB,
        quotaResetBaselineUsedTrafficBytes: 40 * GB
      })
    ]);
    expect((await api.listQuotaPolicies()).find((policy) => policy.id === 'user:sub-client-acme-reset')).toMatchObject({
      usedBytes: 3 * GB,
      enforcementState: 'active'
    });
  });

  it('persists subscription export profiles across service-backed API restarts', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const api = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      inventory: {
        subscriptionExportProfiles: []
      }
    });

    await api.createTask(
      {
        operation: 'subscription.profile.upsert',
        resourceType: 'subscription',
        targetId: 'profile-mihomo-premium',
        targetLabel: 'Mihomo Premium',
        summary: 'Save subscription export profile',
        metadata: {
          profileId: 'profile-mihomo-premium',
          name: 'Mihomo Premium',
          client: 'mihomo',
          sourceIds: ['source-premium'],
          includeFilter: 'premium|streaming',
          excludeFilter: 'expired|test',
          regionFilter: ['hk', 'sg'],
          outputFormats: ['mihomo', 'clash', 'uri'],
          templateName: 'mihomo-compatible.yaml',
          includeTrafficHeaders: true,
          proxyGroups: [
            {
              id: 'proxy-group-premium-auto',
              name: 'Premium Auto',
              strategy: 'url-test',
              filterTags: ['premium', 'streaming']
            }
          ]
        }
      },
      mutationContext('subscription-profile-upsert')
    );

    await expect(repository.listSubscriptionExportProfiles()).resolves.toEqual([
      expect.objectContaining({
        id: 'profile-mihomo-premium',
        client: 'mihomo',
        outputFormats: ['mihomo', 'clash', 'uri']
      })
    ]);

    const restartedApi = createServiceBackedControlPlaneApi({
      repository,
      service: createControlPlaneService({ repository, now: createControlPlaneTestClock() }),
      inventory: {
        subscriptionExportProfiles: []
      }
    });

    await expect(restartedApi.listSubscriptionExportProfiles()).resolves.toEqual([
      expect.objectContaining({
        id: 'profile-mihomo-premium',
        proxyGroups: [
          expect.objectContaining({
            name: 'Premium Auto',
            strategy: 'url-test'
          })
        ]
      })
    ]);

    await restartedApi.createTask(
      withRiskConfirmation({
        operation: 'subscription.profile.delete',
        resourceType: 'subscription',
        targetId: 'profile-mihomo-premium',
        targetLabel: 'Mihomo Premium',
        summary: 'Delete subscription export profile',
        metadata: {
          profileId: 'profile-mihomo-premium'
        }
      }),
      mutationContext('subscription-profile-delete')
    );

    await expect(repository.listSubscriptionExportProfiles()).resolves.toEqual([]);
  });
});
