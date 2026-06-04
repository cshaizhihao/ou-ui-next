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

  it('normalizes Chinese region names into stable tags for customer subscription filters', () => {
    const source = createSource({
      kind: 'clash',
      dedupeKey: 'name-region'
    });

    const result = parseSubscriptionSourceContent({
      source,
      syncedAt,
      body: `
proxies:
  - name: 香港 Premium VLESS
    type: vless
    server: hk.example.com
    port: 443
    uuid: b6dcba68-6949-45ea-a3ef-e45e5778d7aa
  - name: 新加坡 Trojan
    type: trojan
    server: sg.example.com
    port: 443
    password: sg-secret
  - name: 美国 Shadowsocks
    type: ss
    server: us.example.com
    port: 8388
    cipher: 2022-blake3-aes-128-gcm
    password: ss-secret
`
    });

    expect(result.nodes).toEqual([
      expect.objectContaining({
        name: '香港 Premium VLESS',
        tags: expect.arrayContaining(['region:hk'])
      }),
      expect.objectContaining({
        name: '新加坡 Trojan',
        tags: expect.arrayContaining(['region:sg'])
      }),
      expect.objectContaining({
        name: '美国 Shadowsocks',
        tags: expect.arrayContaining(['region:us'])
      })
    ]);
  });

  it('parses sing-box outbound subscriptions instead of treating them as empty YAML sources', () => {
    const source = createSource({
      kind: 'sing-box',
      dedupeKey: 'server-port'
    });

    const result = parseSubscriptionSourceContent({
      source,
      syncedAt,
      body: JSON.stringify({
        outbounds: [
          {
            type: 'vless',
            tag: 'HK Sing-box VLESS',
            server: 'hk-singbox.example.com',
            server_port: 443,
            uuid: '6dfb3f2e-46c1-4d25-9d73-6d8f36f40f01',
            flow: 'xtls-rprx-vision',
            tls: {
              enabled: true,
              server_name: 'hk-singbox.example.com',
              reality: {
                enabled: true,
                public_key: 'REALITY_PUBLIC_KEY',
                short_id: 'a1b2c3d4'
              }
            }
          },
          {
            type: 'direct',
            tag: 'DIRECT'
          },
          {
            type: 'hysteria2',
            tag: 'SG Hysteria2',
            server: 'sg-hy2.example.com',
            server_port: 8443,
            password: 'hy2-secret'
          }
        ]
      })
    });

    expect(result).toMatchObject({
      sourceId: 'source-external-hk',
      status: 'synced',
      nodeCount: 2,
      warnings: []
    });
    expect(result.nodes).toEqual([
      expect.objectContaining({
        name: 'HK Sing-box VLESS',
        protocol: 'vless',
        server: 'hk-singbox.example.com',
        port: 443,
        clashConfig: expect.objectContaining({
          type: 'vless',
          uuid: '6dfb3f2e-46c1-4d25-9d73-6d8f36f40f01',
          flow: 'xtls-rprx-vision',
          tls: true,
          servername: 'hk-singbox.example.com',
          'reality-opts': {
            'public-key': 'REALITY_PUBLIC_KEY',
            'short-id': 'a1b2c3d4'
          }
        })
      }),
      expect.objectContaining({
        name: 'SG Hysteria2',
        protocol: 'hysteria',
        server: 'sg-hy2.example.com',
        port: 8443,
        clashConfig: expect.objectContaining({
          type: 'hysteria2',
          password: 'hy2-secret'
        })
      })
    ]);
    expect(result.nodes).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'DIRECT' })]));
  });
});
