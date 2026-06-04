import type { SubscriptionSource } from '../../domain';
import { parseSubscriptionSourceContent } from './subscription-source-parser';

const syncedAt = '2026-06-04T00:00:00.000Z';

function createSource(patch: Partial<SubscriptionSource>): SubscriptionSource {
  return {
    id: 'source-external-hk',
    kind: 'v2ray-uri',
    name: 'External HK',
    url: 'https://provider.example.com/sub',
    status: 'syncing',
    nodeCount: 0,
    dedupeKey: 'server-port',
    lastSyncAt: syncedAt,
    rateLimitPerMinute: 60,
    ...patch
  };
}

describe('subscription source parser', () => {
  it('parses base64 v2ray URI subscriptions into inventory nodes', () => {
    const source = createSource({
      kind: 'v2ray-uri',
      includeFilter: 'HK|Premium',
      excludeFilter: 'Expired'
    });
    const vmessPayload = Buffer.from(
      JSON.stringify({
        v: '2',
        ps: 'HK Premium VMess',
        add: 'hk-vmess.example.com',
        port: '443',
        id: '4b7cf6e5-ec9f-446b-8f6d-2aa778b65b6f',
        aid: '0',
        scy: 'auto',
        net: 'ws',
        tls: 'tls',
        sni: 'hk-vmess.example.com'
      }),
      'utf8'
    ).toString('base64');
    const rawSubscription = [
      `vmess://${vmessPayload}`,
      'vless://b6dcba68-6949-45ea-a3ef-e45e5778d7aa@hk-vless.example.com:8443?type=tcp&security=tls&sni=hk-vless.example.com#HK%20Premium%20VLESS',
      'trojan://expired@example.com:443?security=tls#Expired%20Node'
    ].join('\n');
    const encodedSubscription = Buffer.from(rawSubscription, 'utf8').toString('base64');

    const result = parseSubscriptionSourceContent({
      source,
      body: encodedSubscription,
      syncedAt
    });

    expect(result).toMatchObject({
      sourceId: 'source-external-hk',
      status: 'synced',
      nodeCount: 2,
      syncedAt,
      warnings: []
    });
    expect(result.nodes).toEqual([
      expect.objectContaining({
        name: 'HK Premium VMess',
        protocol: 'vmess',
        server: 'hk-vmess.example.com',
        port: 443,
        rawUrl: expect.stringContaining('vmess://'),
        clashConfig: expect.objectContaining({
          type: 'vmess',
          uuid: '4b7cf6e5-ec9f-446b-8f6d-2aa778b65b6f'
        })
      }),
      expect.objectContaining({
        name: 'HK Premium VLESS',
        protocol: 'vless',
        server: 'hk-vless.example.com',
        port: 8443,
        rawUrl: expect.stringContaining('vless://'),
        clashConfig: expect.objectContaining({
          type: 'vless',
          uuid: 'b6dcba68-6949-45ea-a3ef-e45e5778d7aa'
        })
      })
    ]);
  });

  it('parses Clash and Mihomo provider YAML with source filters and dedupe', () => {
    const source = createSource({
      kind: 'mihomo-provider',
      includeFilter: 'Premium',
      excludeFilter: 'Test',
      dedupeKey: 'server-port'
    });

    const result = parseSubscriptionSourceContent({
      source,
      syncedAt,
      body: `
proxies:
  - name: HK Premium VLESS
    type: vless
    server: hk-vless.example.com
    port: 443
    uuid: b6dcba68-6949-45ea-a3ef-e45e5778d7aa
    tls: true
  - name: HK Premium Duplicate
    type: vless
    server: hk-vless.example.com
    port: 443
    uuid: duplicate
  - name: SG Test Trojan
    type: trojan
    server: sg-test.example.com
    port: 443
    password: secret
`
    });

    expect(result).toMatchObject({
      sourceId: 'source-external-hk',
      status: 'synced',
      nodeCount: 1,
      warnings: []
    });
    expect(result.nodes).toEqual([
      expect.objectContaining({
        name: 'HK Premium VLESS',
        protocol: 'vless',
        server: 'hk-vless.example.com',
        port: 443,
        clashConfig: expect.objectContaining({
          name: 'HK Premium VLESS',
          type: 'vless',
          uuid: 'b6dcba68-6949-45ea-a3ef-e45e5778d7aa'
        })
      })
    ]);
  });
});
