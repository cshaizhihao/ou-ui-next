import {
  applySubscriptionTemplate,
  getSubscriptionProducer,
  listSubscriptionProducers,
  resolveSubscriptionOutputFormatAlias
} from './subscription-producers';
import type { SubscriptionInventoryNode } from './subscription';

const nodes: SubscriptionInventoryNode[] = [
  {
    id: 'node-hk-vless',
    sourceId: 'source-premium',
    name: 'HK Premium VLESS',
    protocol: 'vless',
    server: 'hk.example.com',
    port: 443,
    latencyMs: 42,
    tags: ['region:hk', 'premium', 'streaming'],
    rawUrl: 'vless://uuid-hk@hk.example.com:443#HK'
  },
  {
    id: 'node-sg-vmess',
    sourceId: 'source-premium',
    name: 'SG Standard VMess',
    protocol: 'vmess',
    server: 'sg.example.com',
    port: 443,
    latencyMs: 88,
    tags: ['region:sg', 'standard'],
    rawUrl: 'vmess://encoded-sg'
  },
  {
    id: 'node-us-test',
    sourceId: 'source-lab',
    name: 'US Test Trojan',
    protocol: 'trojan',
    server: 'us.example.com',
    port: 443,
    latencyMs: 120,
    tags: ['region:us', 'premium', 'test'],
    rawUrl: 'trojan://secret@us.example.com:443#US'
  }
];

describe('subscription producer registry', () => {
  it('registers core producers, client aliases and template capabilities', () => {
    expect(listSubscriptionProducers().map((producer) => producer.id)).toEqual([
      'uri',
      'v2ray',
      'clash',
      'mihomo',
      'sing-box',
      'shadowrocket',
      'stash'
    ]);

    expect(resolveSubscriptionOutputFormatAlias('plain')).toBe('uri');
    expect(resolveSubscriptionOutputFormatAlias('shadowrocket')).toBe('shadowrocket');
    expect(resolveSubscriptionOutputFormatAlias('stash')).toBe('stash');
    expect(resolveSubscriptionOutputFormatAlias('surge')).toBeUndefined();
    expect(getSubscriptionProducer('stash')).toMatchObject({
      id: 'stash',
      format: 'stash',
      contentType: 'text/yaml; charset=utf-8'
    });
  });

  it('applies the minimal template DSL for include-all, filters, region groups and provider markers', () => {
    const applied = applySubscriptionTemplate(
      {
        id: 'premium-regions',
        name: 'Premium Regions',
        instructions: [
          { type: 'include-all' },
          { type: 'filter', value: 'premium|standard' },
          { type: 'exclude-filter', value: 'test' },
          { type: 'include-region-proxy-groups', regions: ['hk', 'sg'] },
          { type: 'provider-marker', value: 'external-provider:premium' }
        ]
      },
      nodes
    );

    expect(applied.nodes.map((node) => node.id)).toEqual(['node-hk-vless', 'node-sg-vmess']);
    expect(applied.proxyGroups).toEqual([
      {
        id: 'template-region-hk',
        name: 'HK',
        strategy: 'select',
        filterTags: ['region:hk', 'geo:hk']
      },
      {
        id: 'template-region-sg',
        name: 'SG',
        strategy: 'select',
        filterTags: ['region:sg', 'geo:sg']
      }
    ]);
    expect(applied.providerMarkers).toEqual(['external-provider:premium']);
  });
});
