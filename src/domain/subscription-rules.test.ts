import {
  applySubscriptionSourceRules,
  countCrossSourceSubscriptionInventoryDuplicates,
  dedupeSubscriptionInventoryNodes,
  selectSubscriptionInventoryNodes
} from './subscription-rules';
import type { SubscriptionInventoryNode } from './subscription';

const nodes: SubscriptionInventoryNode[] = [
  {
    id: 'node-hkg-vless-a',
    sourceId: 'source-premium',
    name: 'Hong Kong Premium 01',
    protocol: 'vless',
    server: '203.0.113.10',
    port: 443,
    latencyMs: 42,
    tags: ['region:hk', 'premium', 'streaming'],
    status: 'online',
    customerName: 'Acme',
    hostId: 'agent-hkg-01',
    hostName: 'Hong Kong Entry',
    usedTrafficBytes: 120 * 1024 * 1024 * 1024,
    trafficLimitBytes: 500 * 1024 * 1024 * 1024,
    rawUrl: 'vless://uuid-a@203.0.113.10:443',
    clashConfig: {
      uuid: 'uuid-a'
    }
  },
  {
    id: 'node-hkg-vless-b',
    sourceId: 'source-premium',
    name: 'Hong Kong Premium Duplicate',
    protocol: 'vless',
    server: '203.0.113.10',
    port: 443,
    latencyMs: 76,
    tags: ['region:hk', 'premium'],
    status: 'quota-exceeded',
    customerName: 'Acme',
    hostId: 'agent-hkg-02',
    hostName: 'Hong Kong Overflow',
    usedTrafficBytes: 640 * 1024 * 1024 * 1024,
    trafficLimitBytes: 500 * 1024 * 1024 * 1024,
    rawUrl: 'vless://uuid-b@203.0.113.10:443',
    clashConfig: {
      uuid: 'uuid-b'
    }
  },
  {
    id: 'node-test-trojan',
    sourceId: 'source-premium',
    name: 'Expired Test Trojan',
    protocol: 'trojan',
    server: '198.51.100.8',
    port: 8443,
    latencyMs: 168,
    tags: ['region:sg', 'test', 'expired'],
    status: 'expired',
    customerName: 'Beta',
    hostId: 'agent-sg-01',
    rawUrl: 'trojan://secret@198.51.100.8:8443'
  },
  {
    id: 'node-sg-vmess',
    sourceId: 'source-relay',
    name: 'Singapore Relay 01',
    protocol: 'vmess',
    server: '198.51.100.20',
    port: 443,
    latencyMs: 118,
    tags: ['region:sg', 'relay'],
    status: 'online',
    hostId: 'agent-sg-01'
  }
];

describe('subscription rule engine', () => {
  it('applies miaomiaowu-style include/exclude filters and server-port dedupe', () => {
    expect(
      applySubscriptionSourceRules(nodes, {
        includeFilter: 'premium|streaming',
        excludeFilter: 'expired|test',
        dedupeKey: 'server-port'
      }).map((node) => node.id)
    ).toEqual(['node-hkg-vless-a']);
  });

  it('supports uuid dedupe without collapsing same endpoint clients', () => {
    expect(dedupeSubscriptionInventoryNodes(nodes, 'uuid').map((node) => node.id)).toEqual([
      'node-hkg-vless-a',
      'node-hkg-vless-b',
      'node-test-trojan',
      'node-sg-vmess'
    ]);
  });

  it('counts cross-source duplicate inventory nodes without exposing credential keys', () => {
    expect(
      countCrossSourceSubscriptionInventoryDuplicates(
        [
          {
            ...nodes[0],
            id: 'node-hkg-vless-from-other-provider',
            sourceId: 'source-backup',
            name: 'Hong Kong Backup Provider'
          }
        ],
        nodes,
        'server-port'
      )
    ).toBe(1);
    expect(countCrossSourceSubscriptionInventoryDuplicates([nodes[3]], nodes.slice(0, 3), 'server-port')).toBe(0);
  });

  it('selects client-visible nodes with tag, protocol, AND, OR, and negation rules', () => {
    expect(
      selectSubscriptionInventoryNodes(nodes, {
        selectedTags: ['premium'],
        protocol: 'vless',
        routingRule: 'tag:region:hk AND !tag:test'
      }).map((node) => node.id)
    ).toEqual(['node-hkg-vless-a', 'node-hkg-vless-b']);

    expect(
      selectSubscriptionInventoryNodes(nodes, {
        routingRule: 'tag:relay OR protocol:trojan'
      }).map((node) => node.id)
    ).toEqual(['node-sg-vmess', 'node-test-trojan']);
  });

  it('selects client-visible nodes by source, region, include/exclude keywords, max latency and sort order', () => {
    expect(
      selectSubscriptionInventoryNodes(nodes, {
        sourceIds: ['source-premium'],
        regionFilter: ['hk'],
        includeFilter: 'Premium',
        excludeFilter: 'Duplicate',
        maxLatencyMs: 100,
        sortStrategy: 'latency'
      }).map((node) => node.id)
    ).toEqual(['node-hkg-vless-a']);
  });

  it('selects client-visible nodes by host, status, customer and traffic rules', () => {
    expect(
      selectSubscriptionInventoryNodes(nodes, {
        routingRule: 'host:agent-hkg-01 AND customer:acme AND status:online AND traffic:available'
      }).map((node) => node.id)
    ).toEqual(['node-hkg-vless-a']);

    expect(
      selectSubscriptionInventoryNodes(nodes, {
        routingRule: 'traffic:quota-exceeded OR traffic:>=600gb'
      }).map((node) => node.id)
    ).toEqual(['node-hkg-vless-b']);

    expect(
      selectSubscriptionInventoryNodes(nodes, {
        routingRule: 'status:expired OR host:agent-sg-01'
      }).map((node) => node.id)
    ).toEqual(['node-sg-vmess', 'node-test-trojan']);
  });
});
