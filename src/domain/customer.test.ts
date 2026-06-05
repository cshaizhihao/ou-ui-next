import type { ForwardRule, SubscriptionClientIdentity, XrayInbound } from '.';
import { createCustomersFromReadModels } from './customer';

const GB = 1024 ** 3;

function createInbound(): XrayInbound {
  return {
    id: 'customer-node-acme-hk',
    nodeId: 'customer-node-acme-hk',
    agentId: 'agent-hk',
    customerName: 'Acme',
    protocol: 'vless',
    label: 'Acme HK',
    listenAddress: '0.0.0.0',
    listenPort: 443,
    status: 'enabled',
    clients: [
      {
        id: 'client-acme-hk',
        email: 'acme@example.com',
        enabled: true,
        trafficLimitBytes: 10 * GB,
        usedTrafficBytes: 4 * GB,
        lastTrafficSampleAt: '2026-06-05T10:00:00.000Z',
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
      shortIds: ['ouui'],
      serverNames: ['edge.example.com']
    },
    fallbacks: [],
    sniffingEnabled: true,
    configVersion: 'cfg-acme-hk'
  };
}

function createSubscriptionClient(): SubscriptionClientIdentity {
  return {
    id: 'sub-client-acme',
    customerName: 'Acme',
    displayName: 'Acme Subscription',
    subId: 'sub_acme',
    email: 'acme@example.com',
    enabled: true,
    protocol: 'vless',
    group: 'premium',
    trafficLimitBytes: 12 * GB,
    usedTrafficBytes: 5 * GB,
    expiresAt: '2026-11-30T00:00:00.000Z',
    ipLimit: 2,
    requestLimitPerHour: 360,
    sourceIds: [],
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
    accessTokenPreview: 'sub_acme',
    securePathPreview: '/sub-acme',
    generatedNodeCount: 1,
    lastGeneratedAt: '2026-06-05T10:05:00.000Z'
  };
}

function createForwardRule(): ForwardRule {
  return {
    id: 'forward-acme-game',
    tunnelId: 'tunnel-acme',
    name: 'Acme Game Forward',
    ownerName: 'Acme',
    strategy: 'fifo',
    enabled: true,
    ports: [
      {
        agentId: 'agent-hk',
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
    quotaPolicyId: 'quota-acme-forwarding',
    rateLimitPolicyId: 'rate-acme-forwarding',
    maxConnections: 100,
    maxConnectionsPerIp: 10,
    proxyProtocol: false,
    tunnelMode: 'direct',
    pricePerGb: 0,
    inboundBytes: 1 * GB,
    outboundBytes: 2 * GB
  };
}

describe('createCustomersFromReadModels', () => {
  it('derives a decoupled customer directory from customer nodes, subscriptions, and forwarding rules', () => {
    expect(
      createCustomersFromReadModels({
        inbounds: [createInbound()],
        subscriptionClients: [createSubscriptionClient()],
        forwardRules: [createForwardRule()],
        nowIso: '2026-06-05T10:15:00.000Z'
      })
    ).toEqual([
      expect.objectContaining({
        id: 'customer:acme',
        name: 'Acme',
        status: 'active',
        sourceKinds: ['customer-node', 'forwarding', 'subscription'],
        customerNodeCount: 1,
        subscriptionClientCount: 1,
        forwardRuleCount: 1,
        agentIds: ['agent-hk'],
        customerNodeIds: ['customer-node-acme-hk'],
        subscriptionClientIds: ['sub-client-acme'],
        forwardRuleIds: ['forward-acme-game'],
        customerNodeUsedTrafficBytes: 4 * GB,
        subscriptionUsedTrafficBytes: 5 * GB,
        forwardingUsedTrafficBytes: 3 * GB,
        usedTrafficBytes: 8 * GB,
        trafficLimitBytes: 20 * GB,
        expiresAt: '2026-11-30T00:00:00.000Z',
        lastActivityAt: '2026-06-05T10:10:00.000Z',
        quotaExceeded: false,
        runtimeDisabledByPolicy: false
      })
    ]);
  });

  it('marks a customer limited when any child resource is quota-disabled', () => {
    expect(
      createCustomersFromReadModels({
        inbounds: [
          {
            ...createInbound(),
            clients: [
              {
                ...createInbound().clients[0],
                quotaExceeded: true,
                runtimeDisabledByPolicy: true
              }
            ]
          }
        ],
        nowIso: '2026-06-05T10:15:00.000Z'
      })[0]
    ).toMatchObject({
      status: 'limited',
      quotaExceeded: true,
      runtimeDisabledByPolicy: true
    });
  });

  it('keeps different non-Latin customer names separate while deduplicating the same customer across sources', () => {
    const customers = createCustomersFromReadModels({
      inbounds: [
        {
          ...createInbound(),
          customerName: '客户甲'
        }
      ],
      subscriptionClients: [
        {
          ...createSubscriptionClient(),
          customerName: '客户甲',
          email: 'alpha@example.com'
        },
        {
          ...createSubscriptionClient(),
          id: 'sub-client-beta',
          customerName: '客户乙',
          email: 'beta@example.com'
        }
      ],
      nowIso: '2026-06-05T10:15:00.000Z'
    });

    expect(customers).toHaveLength(2);
    expect(customers.map((customer) => customer.name)).toEqual(expect.arrayContaining(['客户甲', '客户乙']));
    expect(new Set(customers.map((customer) => customer.id)).size).toBe(2);
    expect(customers.map((customer) => customer.id)).not.toContain('customer:unnamed');
    expect(customers.find((customer) => customer.name === '客户甲')).toMatchObject({
      sourceKinds: ['customer-node', 'subscription'],
      customerNodeCount: 1,
      subscriptionClientCount: 1
    });
  });

  it('uses the read-model clock to mark expired customers', () => {
    expect(
      createCustomersFromReadModels({
        subscriptionClients: [
          {
            ...createSubscriptionClient(),
            expiresAt: '2026-01-01T00:00:00.000Z'
          }
        ],
        nowIso: '2026-06-05T10:15:00.000Z'
      })[0]
    ).toMatchObject({
      status: 'expired'
    });
  });
});
