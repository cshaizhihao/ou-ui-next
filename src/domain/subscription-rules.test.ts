import {
  applySubscriptionSourceRules,
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
    tags: ['region:hk', 'premium', 'streaming'],
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
    tags: ['region:hk', 'premium'],
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
    tags: ['region:sg', 'test', 'expired'],
    rawUrl: 'trojan://secret@198.51.100.8:8443'
  },
  {
    id: 'node-sg-vmess',
    sourceId: 'source-relay',
    name: 'Singapore Relay 01',
    protocol: 'vmess',
    server: '198.51.100.20',
    port: 443,
    tags: ['region:sg', 'relay']
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
    ).toEqual(['node-test-trojan', 'node-sg-vmess']);
  });
});
