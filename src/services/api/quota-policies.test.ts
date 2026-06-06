import type { Agent } from '../../domain/agent';
import type { ForwardRule } from '../../domain/forwarding';
import type { XrayInbound } from '../../domain/protocol';
import type { QuotaPolicy } from '../../domain/quota';
import type { SubscriptionClientIdentity } from '../../domain/subscription';
import { createQuotaPoliciesFromReadModels } from './quota-policies';

const GB = 1024 ** 3;

function createAgent(): Agent {
  return {
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
      manualUsedTrafficBytes: 0,
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
      monthlyTrafficLimitBytes: 60 * GB,
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
  };
}

function createInbound(): XrayInbound {
  return {
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
        trafficLimitBytes: 10 * GB,
        usedTrafficBytes: 10 * GB,
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
  };
}

function createForwardRule(): ForwardRule {
  return {
    id: 'forward-rule-01',
    tunnelId: 'tunnel-01',
    name: '东京游戏转发',
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
        inboundBytes: 4 * GB,
        outboundBytes: 3 * GB,
        lastCounterSampleAt: '2026-06-05T10:10:00.000Z'
      }
    ],
    portStatus: 'allocated',
    billingDirection: 'both',
    trafficMultiplier: 1,
    monthlyResetDay: 9,
    manualUsedBytes: 0,
    quotaBytes: 6 * GB,
    quotaPolicyId: 'quota-acme-account',
    rateLimitPolicyId: 'rate-acme-account',
    rateLimitMode: 'bi-directional',
    rateLimitDirection: 'both',
    maxConnections: 100,
    maxConnectionsPerIp: 10,
    proxyProtocol: false,
    tunnelMode: 'direct',
    pricePerGb: 0,
    inboundBytes: 4 * GB,
    outboundBytes: 3 * GB,
    quotaExceeded: true,
    runtimeDisabledByPolicy: true,
    guardrailReason: 'rule_monthly_quota_exceeded'
  };
}

function createSubscriptionClient(): SubscriptionClientIdentity {
  return {
    id: 'sub-client-acme-premium',
    customerName: 'Acme',
    displayName: 'Acme Premium Subscription',
    subId: 'sub_acme_premium',
    email: 'subscriber@example.com',
    enabled: true,
    protocol: 'vless',
    group: 'premium',
    trafficLimitBytes: 20 * GB,
    usedTrafficBytes: 21 * GB,
    expiresAt: '2026-12-31T00:00:00.000Z',
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
    accessTokenPreview: 'sub_acme...ium',
    securePathPreview: '/subscription/acme',
    generatedNodeCount: 1,
    lastGeneratedAt: '2026-06-05T10:20:00.000Z',
    quotaExceeded: true,
    runtimeDisabledByPolicy: true,
    guardrailReason: 'subscription_client_quota_exceeded'
  };
}

describe('createQuotaPoliciesFromReadModels', () => {
  it('derives managed-host, customer-node, subscription-user, forwarding-account, tunnel, and forward-rule quotas from live read models', () => {
    const quotaPolicies = createQuotaPoliciesFromReadModels({
      agents: [createAgent()],
      inbounds: [createInbound()],
      forwardRules: [createForwardRule()],
      subscriptionClients: [createSubscriptionClient()],
      quotaPolicies: [
        {
          id: 'quota-acme-account',
          name: 'Acme 团队转发配额',
          scope: 'forwarding-account',
          limitBytes: 16 * GB,
          usedBytes: 0,
          resetWindow: 'monthly',
          billingDirection: 'both',
          enforcementState: 'active'
        } satisfies QuotaPolicy,
        {
          id: 'quota-tunnel-01',
          name: '东京链路配额',
          scope: 'tunnel',
          resourceId: 'tunnel-01',
          limitBytes: 8 * GB,
          usedBytes: 0,
          resetWindow: 'monthly',
          billingDirection: 'both',
          enforcementState: 'active'
        } satisfies QuotaPolicy
      ]
    });

    expect(quotaPolicies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'managed-host:agent-hkg-01',
          name: '香港入口主机',
          scope: 'managed-host',
          limitBytes: 60 * GB,
          usedBytes: 18 * GB,
          resetDay: 9,
          billingDirection: 'both',
          enforcementState: 'active'
        }),
        expect.objectContaining({
          id: 'customer-node:customer-node-01:client-a',
          name: '客户节点 A',
          scope: 'customer-node',
          detail: 'Acme · customer-a@example.com',
          limitBytes: 10 * GB,
          usedBytes: 10 * GB,
          enforcementState: 'disabled_by_quota',
          guardrailReason: 'xray_client_monthly_quota_exceeded'
        }),
        expect.objectContaining({
          id: 'user:sub-client-acme-premium',
          name: 'Acme Premium Subscription',
          scope: 'user',
          detail: 'Acme · subscriber@example.com',
          limitBytes: 20 * GB,
          usedBytes: 21 * GB,
          enforcementState: 'disabled_by_quota',
          guardrailReason: 'subscription_client_quota_exceeded'
        }),
        expect.objectContaining({
          id: 'forward-rule:forward-rule-01',
          name: '东京游戏转发',
          scope: 'forward-rule',
          limitBytes: 6 * GB,
          usedBytes: 7 * GB,
          enforcementState: 'disabled_by_quota'
        }),
        expect.objectContaining({
          id: 'quota-acme-account',
          name: 'Acme 团队转发配额',
          scope: 'forwarding-account',
          limitBytes: 16 * GB,
          usedBytes: 7 * GB,
          sourceCount: 1,
          enforcementState: 'disabled_by_quota'
        }),
        expect.objectContaining({
          id: 'quota-tunnel-01',
          name: '东京链路配额',
          scope: 'tunnel',
          resourceId: 'tunnel-01',
          limitBytes: 8 * GB,
          usedBytes: 7 * GB,
          sourceCount: 1,
          enforcementState: 'disabled_by_quota'
        })
      ])
    );
  });

  it('does not let managed-host quota usage fall below manual traffic calibration', () => {
    const agent = {
      ...createAgent(),
      monthlyTrafficLimitBytes: 8 * GB,
      trafficPolicy: {
        ...createAgent().trafficPolicy,
        manualUsedTrafficBytes: 9 * GB
      },
      telemetry: {
        ...createAgent().telemetry,
        monthlyTrafficUsedBytes: 2 * GB,
        monthlyIngressBytes: 1 * GB,
        monthlyEgressBytes: 1 * GB,
        quotaExceeded: undefined,
        runtimeDisabledByPolicy: undefined,
        guardrailReason: undefined
      }
    };
    const quotaPolicies = createQuotaPoliciesFromReadModels({
      agents: [agent],
      inbounds: [],
      forwardRules: []
    });

    expect(quotaPolicies).toEqual([
      expect.objectContaining({
        id: 'managed-host:agent-hkg-01',
        limitBytes: 8 * GB,
        usedBytes: 9 * GB,
        enforcementState: 'exceeded'
      })
    ]);
  });

  it('keeps uncovered explicit quota policies when no live read model is attached', () => {
    expect(
      createQuotaPoliciesFromReadModels({
        agents: [],
        inbounds: [],
        forwardRules: [],
        quotaPolicies: [
          {
            id: 'quota-manual-only',
            name: 'Manual only quota',
            scope: 'user',
            limitBytes: 4 * GB,
            usedBytes: 1 * GB,
            resetWindow: 'manual',
            billingDirection: 'single',
            enforcementState: 'reset_pending'
          }
        ]
      })
    ).toEqual([
      expect.objectContaining({
        id: 'quota-manual-only',
        enforcementState: 'reset_pending'
      })
    ]);
  });
});
