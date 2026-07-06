import type { SubscriptionClientIdentity, SubscriptionExportProfile, SubscriptionInventoryNode, XrayInbound } from '../../domain';
import { projectSubscriptionClientRuntimeState, renderPublicSubscriptionOutput } from './subscription-output';

const inbound: XrayInbound = {
  id: 'inbound-real-vless-2443',
  nodeId: 'node-real-hkg',
  agentId: 'agent-real-hkg',
  customerName: 'Acme',
  serverAddress: 'edge.example.com',
  clientIdentity: '11111111-1111-4111-8111-111111111111',
  subscriptionRule: 'premium',
  protocol: 'vless',
  label: 'Acme HK VLESS',
  listenAddress: '0.0.0.0',
  listenPort: 2443,
  status: 'enabled',
  clients: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'acme@example.com',
      enabled: true,
      credentialType: 'uuid',
      flow: 'xtls-rprx-vision',
      trafficLimitBytes: 500 * 1024 * 1024 * 1024,
      usedTrafficBytes: 12 * 1024 * 1024 * 1024,
      expiresAt: '2027-12-31T23:59:59.000Z',
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
  configVersion: 'cfg-real-vless-2443'
};

const client: SubscriptionClientIdentity = {
  id: 'sub-client-acme',
  customerName: 'Acme',
  displayName: 'Acme Premium',
  subId: 'sub_acme_premium',
  email: 'acme@example.com',
  enabled: true,
  protocol: 'vless',
  group: 'premium',
  trafficLimitBytes: 500 * 1024 * 1024 * 1024,
  usedTrafficBytes: 12 * 1024 * 1024 * 1024,
  expiresAt: '2027-12-31T23:59:59.000Z',
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
  formats: ['plain', 'clash', 'sing-box'],
  outputFormats: ['uri', 'clash', 'sing-box'],
  templateName: 'mihomo-compatible.yaml',
  accessTokenPreview: 'ou_acme...mium',
  securePathPreview: '/x7K2mP9vL4qR1wDz',
  generatedNodeCount: 1
};

describe('subscription-output', () => {
  it('renders real URI links from Xray inbound clients', () => {
    const output = renderPublicSubscriptionOutput({
      client,
      format: 'uri',
      inbounds: [inbound]
    });

    expect(output.contentType).toBe('text/plain; charset=utf-8');
    expect(output.body).toContain('vless://11111111-1111-4111-8111-111111111111@edge.example.com:2443');
    expect(output.body).toContain('security=reality');
    expect(output.body).toContain('flow=xtls-rprx-vision');
    expect(output.body).toContain('#Acme+HK+VLESS');
    expect(output.headers['subscription-userinfo']).toContain(`total=${500 * 1024 * 1024 * 1024}`);
    expect(output.headers['x-ou-ui-selected-node-count']).toBe('1');
    expect(output.headers['x-ou-ui-converted-uri-count']).toBe('1');
    expect(output.headers['x-ou-ui-unconverted-node-count']).toBe('0');
    expect(output.nodeCount).toBe(1);
  });

  it('projects subscription traffic from selected Xray clients instead of static client metadata', () => {
    const staleClient = {
      ...client,
      usedTrafficBytes: 1 * 1024 * 1024 * 1024,
      generatedNodeCount: 99
    };
    const projection = projectSubscriptionClientRuntimeState({
      client: staleClient,
      inbounds: [inbound]
    });
    const output = renderPublicSubscriptionOutput({
      client: staleClient,
      format: 'uri',
      inbounds: [inbound]
    });

    expect(projection.client).toMatchObject({
      usedTrafficBytes: 12 * 1024 * 1024 * 1024,
      generatedNodeCount: 1
    });
    expect(projection.matchedXrayClientCount).toBe(1);
    expect(output.headers['subscription-userinfo']).toContain(`download=${12 * 1024 * 1024 * 1024}`);
    expect(output.headers['x-ou-ui-node-count']).toBe('1');
  });

  it('expands multi-client local Xray inbounds per subscription identity', () => {
    const secondClientId = '22222222-2222-4222-8222-222222222222';
    const multiClientInbound: XrayInbound = {
      ...inbound,
      label: 'Shared HK VLESS',
      flow: 'legacy-inbound-flow',
      clients: [
        inbound.clients[0],
        {
          id: secondClientId,
          email: 'beta@example.com',
          subId: 'sub_beta_premium',
          enabled: true,
          credentialType: 'uuid',
          flow: 'xtls-rprx-vision',
          trafficLimitBytes: 800 * 1024 * 1024 * 1024,
          usedTrafficBytes: 34 * 1024 * 1024 * 1024,
          expiresAt: '2027-12-31T23:59:59.000Z',
          ipLimit: 2
        }
      ]
    };
    const betaClient: SubscriptionClientIdentity = {
      ...client,
      id: 'sub-client-beta',
      customerName: 'Beta',
      displayName: 'Beta Premium',
      subId: 'sub_beta_premium',
      email: 'beta@example.com',
      usedTrafficBytes: 0,
      generatedNodeCount: 0
    };
    const uri = renderPublicSubscriptionOutput({
      client: betaClient,
      format: 'uri',
      inbounds: [multiClientInbound]
    });
    const mihomo = renderPublicSubscriptionOutput({
      client: betaClient,
      format: 'mihomo',
      inbounds: [multiClientInbound]
    });

    expect(uri.nodeCount).toBe(1);
    expect(uri.body).toContain(`vless://${secondClientId}@edge.example.com:2443`);
    expect(uri.body).toContain('flow=xtls-rprx-vision');
    expect(uri.body).not.toContain('legacy-inbound-flow');
    expect(uri.body).toContain('beta%40example.com');
    expect(uri.body).not.toContain(inbound.clients[0].id);
    expect(uri.headers['subscription-userinfo']).toContain(`download=${34 * 1024 * 1024 * 1024}`);
    expect(mihomo.body).toContain(secondClientId);
    expect(mihomo.body).not.toContain(inbound.clients[0].id);
  });

  it('excludes quota-disabled and expired Xray clients from public output while projecting guardrail state', () => {
    const quotaDisabledInbound: XrayInbound = {
      ...inbound,
      clients: [
        {
          ...inbound.clients[0],
          quotaExceeded: true,
          runtimeDisabledByPolicy: false,
          guardrailReason: ''
        }
      ]
    };
    const expiredInbound: XrayInbound = {
      ...inbound,
      id: 'inbound-expired-vless-2443',
      clients: [
        {
          ...inbound.clients[0],
          id: 'expired-client-id',
          email: 'expired@example.com',
          subId: 'sub_expired',
          clientExpired: true,
          runtimeDisabledByPolicy: false,
          guardrailReason: ''
        }
      ]
    };
    const expiredClient: SubscriptionClientIdentity = {
      ...client,
      id: 'sub-client-expired',
      subId: 'sub_expired',
      email: 'expired@example.com',
      usedTrafficBytes: 0
    };

    const quotaProjection = projectSubscriptionClientRuntimeState({
      client,
      inbounds: [quotaDisabledInbound]
    });
    const quotaOutput = renderPublicSubscriptionOutput({
      client,
      format: 'uri',
      inbounds: [quotaDisabledInbound]
    });
    const expiredProjection = projectSubscriptionClientRuntimeState({
      client: expiredClient,
      inbounds: [expiredInbound]
    });
    const expiredOutput = renderPublicSubscriptionOutput({
      client: expiredClient,
      format: 'uri',
      inbounds: [expiredInbound]
    });

    expect(quotaOutput.nodeCount).toBe(0);
    expect(quotaOutput.body).toBe('');
    expect(quotaOutput.headers['x-ou-ui-selected-node-count']).toBe('0');
    expect(quotaProjection.client).toMatchObject({
      quotaExceeded: true,
      runtimeDisabledByPolicy: true,
      guardrailReason: 'xray_client_monthly_quota_exceeded'
    });
    expect(expiredOutput.nodeCount).toBe(0);
    expect(expiredOutput.body).toBe('');
    expect(expiredProjection.client).toMatchObject({
      quotaExceeded: false,
      runtimeDisabledByPolicy: true,
      guardrailReason: 'xray_client_expired'
    });
  });

  it('subtracts subscription-client quota reset baseline from public traffic headers', () => {
    const resetAt = '2026-06-05T10:00:00.000Z';
    const postResetInbound: XrayInbound = {
      ...inbound,
      clients: [
        {
          ...inbound.clients[0],
          usedTrafficBytes: 15 * 1024 * 1024 * 1024,
          lastTrafficSampleAt: '2026-06-05T10:10:00.000Z'
        }
      ]
    };
    const resetAwareClient: SubscriptionClientIdentity = {
      ...client,
      usedTrafficBytes: 0,
      quotaResetAt: resetAt,
      quotaResetBaselineUsedTrafficBytes: 12 * 1024 * 1024 * 1024,
      lastGeneratedAt: resetAt
    };
    const projection = projectSubscriptionClientRuntimeState({
      client: resetAwareClient,
      inbounds: [postResetInbound],
      nowIso: '2026-06-05T10:15:00.000Z'
    });
    const output = renderPublicSubscriptionOutput({
      client: resetAwareClient,
      format: 'uri',
      inbounds: [postResetInbound]
    });

    expect(projection.client).toMatchObject({
      usedTrafficBytes: 3 * 1024 * 1024 * 1024,
      quotaExceeded: false,
      guardrailReason: 'ok'
    });
    expect(output.headers['subscription-userinfo']).toContain(`download=${3 * 1024 * 1024 * 1024}`);
  });

  it('filters local Xray subscription nodes by host, status, customer and traffic rules', () => {
    const runtimeFilteredClient: SubscriptionClientIdentity = {
      ...client,
      routingRule: 'host:agent-real-hkg AND customer:Acme AND status:online AND traffic:available'
    };
    const selected = renderPublicSubscriptionOutput({
      client: runtimeFilteredClient,
      format: 'uri',
      inbounds: [inbound]
    });
    const rejected = renderPublicSubscriptionOutput({
      client: {
        ...runtimeFilteredClient,
        routingRule: 'traffic:quota-exceeded'
      },
      format: 'uri',
      inbounds: [inbound]
    });

    expect(selected.nodeCount).toBe(1);
    expect(selected.body).toContain('Acme+HK+VLESS');
    expect(rejected.nodeCount).toBe(0);
    expect(rejected.body).toBe('');
  });

  it('renders Clash/Mihomo and sing-box configs without placeholder nodes', () => {
    const grpcRealityInbound: XrayInbound = {
      ...inbound,
      path: '/grpc-service',
      streamSettings: {
        ...inbound.streamSettings,
        network: 'grpc',
        serviceName: 'grpc-service'
      },
      reality: {
        ...inbound.reality,
        privateKey: 'server-private-key'
      }
    };
    const clash = renderPublicSubscriptionOutput({
      client,
      format: 'mihomo',
      inbounds: [grpcRealityInbound]
    });
    const singBox = renderPublicSubscriptionOutput({
      client,
      format: 'sing-box',
      inbounds: [grpcRealityInbound]
    });
    const singBoxDocument = JSON.parse(singBox.body);
    const vlessOutbound = singBoxDocument.outbounds[0];

    expect(clash.body).toContain('mihomo-compatible subscription generated by OU-UI Next');
    expect(clash.body).toContain('Acme HK VLESS');
    expect(clash.body).toContain('edge.example.com');
    expect(clash.body).not.toContain('203.0.');

    expect(singBoxDocument).toMatchObject({
      outbounds: [
        expect.objectContaining({
          type: 'vless',
          tag: 'Acme HK VLESS',
          server: 'edge.example.com',
          server_port: 2443,
          flow: 'xtls-rprx-vision',
          tls: {
            enabled: true,
            server_name: 'edge.example.com',
            utls: {
              enabled: true,
              fingerprint: 'chrome'
            },
            reality: {
              enabled: true,
              public_key: 'reality-public-key',
              short_id: 'a1b2c3d4'
            }
          },
          transport: {
            type: 'grpc',
            service_name: 'grpc-service'
          }
        }),
        expect.objectContaining({
          type: 'direct'
        })
      ]
    });
    expect(JSON.stringify(vlessOutbound)).not.toContain('private');
    expect(JSON.stringify(vlessOutbound)).not.toContain('server-private-key');
  });

  it('uses persisted export profile proxy groups and traffic-header settings for Mihomo output', () => {
    const exportProfile: SubscriptionExportProfile = {
      id: 'profile-mihomo-premium',
      name: 'Mihomo Premium',
      client: 'mihomo',
      sourceIds: [],
      includeFilter: 'premium',
      excludeFilter: '',
      regionFilter: [],
      outputFormats: ['mihomo', 'clash'],
      templateName: 'mihomo-compatible.yaml',
      proxyGroups: [
        {
          id: 'proxy-group-premium-auto',
          name: 'Premium Auto',
          strategy: 'url-test',
          filterTags: ['premium']
        }
      ],
      includeTrafficHeaders: false,
      updatedAt: '2026-06-04T00:00:00.000Z'
    };
    const output = renderPublicSubscriptionOutput({
      client,
      exportProfile,
      format: 'mihomo',
      inbounds: [inbound]
    });

    expect(output.body).toContain('Premium Auto');
    expect(output.body).toMatch(/type:\s+["']?url-test["']?/);
    expect(output.headers).not.toHaveProperty('subscription-userinfo');
    expect(output.headers['x-ou-ui-node-count']).toBe('1');
  });

  it('pins export profile proxy groups to explicit inventory node ids before tag filters', () => {
    const hkNode: SubscriptionInventoryNode = {
      id: 'node-hk-selected',
      sourceId: 'source-hk-premium',
      name: 'HK Selected VLESS',
      protocol: 'vless',
      server: '198.51.100.18',
      port: 443,
      latencyMs: 76,
      tags: ['premium', 'streaming'],
      status: 'online',
      rawUrl: 'vless://00000000-0000-4000-8000-000000000010@198.51.100.18:443#HK%20Selected'
    };
    const testNode: SubscriptionInventoryNode = {
      ...hkNode,
      id: 'node-hk-not-selected',
      name: 'HK Not Selected Test',
      tags: ['premium', 'test'],
      rawUrl: 'vless://00000000-0000-4000-8000-000000000011@198.51.100.19:443#HK%20Not%20Selected'
    };
    const output = renderPublicSubscriptionOutput({
      client,
      externalNodes: [hkNode, testNode],
      exportProfile: {
        id: 'profile-pinned-group',
        name: 'Pinned Group Profile',
        client: 'mihomo',
        sourceIds: [],
        includeFilter: '',
        excludeFilter: '',
        regionFilter: [],
        outputFormats: ['mihomo'],
        templateName: 'pinned-group.yaml',
        proxyGroups: [
          {
            id: 'proxy-group-selected',
            name: 'Selected Inventory Nodes',
            strategy: 'select',
            filterTags: ['premium'],
            nodeIds: ['node-hk-selected']
          }
        ],
        includeTrafficHeaders: true,
        updatedAt: '2026-06-04T00:00:00.000Z'
      },
      format: 'mihomo',
      inbounds: []
    });

    const selectedGroup = output.body.slice(output.body.indexOf('name: "Selected Inventory Nodes"'));

    expect(selectedGroup).toContain('HK Selected VLESS');
    expect(selectedGroup).not.toContain('HK Not Selected Test');
  });

  it('applies export profile source, include, exclude and region filters to final subscription nodes', () => {
    const hkNode: SubscriptionInventoryNode = {
      id: 'inventory-source-hk-premium-vless-01',
      sourceId: 'source-hk-premium',
      name: 'HK Premium VLESS 01',
      protocol: 'vless',
      server: '198.51.100.18',
      port: 443,
      latencyMs: 76,
      tags: ['region:hk', 'premium', 'streaming'],
      rawUrl: 'vless://00000000-0000-4000-8000-000000000001@198.51.100.18:443#HK%20Premium%2001',
      inboundTag: 'source-hk-premium-vless-01'
    };
    const sgNode: SubscriptionInventoryNode = {
      ...hkNode,
      id: 'inventory-source-sg-standard-vless-01',
      sourceId: 'source-sg-standard',
      name: 'SG Standard VLESS 01',
      server: '198.51.100.28',
      latencyMs: 88,
      tags: ['region:sg', 'standard'],
      rawUrl: 'vless://00000000-0000-4000-8000-000000000002@198.51.100.28:443#SG%20Standard%2001',
      inboundTag: 'source-sg-standard-vless-01'
    };
    const output = renderPublicSubscriptionOutput({
      client: {
        ...client,
        selectedTags: [],
        includeFilter: '',
        excludeFilter: '',
        regionFilter: [],
        sourceIds: []
      },
      exportProfile: {
        id: 'profile-hk-premium-only',
        name: 'HK Premium Only',
        client: 'mihomo',
        sourceIds: ['source-hk-premium'],
        includeFilter: 'premium',
        excludeFilter: 'expired',
        regionFilter: ['hk'],
        outputFormats: ['mihomo'],
        templateName: 'hk-premium.yaml',
        proxyGroups: [],
        includeTrafficHeaders: true,
        updatedAt: '2026-06-04T00:00:00.000Z'
      },
      format: 'mihomo',
      inbounds: [],
      externalNodes: [sgNode, hkNode]
    });

    expect(output.nodeCount).toBe(1);
    expect(output.body).toContain('HK Premium VLESS 01');
    expect(output.body).not.toContain('SG Standard VLESS 01');
  });

  it('emits health-check settings for fallback and load-balance proxy groups', () => {
    const output = renderPublicSubscriptionOutput({
      client,
      exportProfile: {
        id: 'profile-health-checked-groups',
        name: 'Health Checked Groups',
        client: 'mihomo',
        sourceIds: [],
        includeFilter: '',
        excludeFilter: '',
        regionFilter: [],
        outputFormats: ['mihomo'],
        templateName: 'health-checked.yaml',
        proxyGroups: [
          {
            id: 'proxy-group-fallback',
            name: 'Fallback Group',
            strategy: 'fallback',
            filterTags: []
          },
          {
            id: 'proxy-group-balance',
            name: 'Balance Group',
            strategy: 'load-balance',
            filterTags: []
          }
        ],
        includeTrafficHeaders: true,
        updatedAt: '2026-06-04T00:00:00.000Z'
      },
      format: 'mihomo',
      inbounds: [inbound]
    });

    expect(output.body).toMatch(/type:\s+["']?fallback["']?/);
    expect(output.body).toMatch(/type:\s+["']?load-balance["']?/);
    expect(output.body.match(/url:\s+"https:\/\/www\.gstatic\.com\/generate_204"/g)).toHaveLength(2);
    expect(output.body.match(/interval:\s+300/g)).toHaveLength(2);
  });

  it('uses the normalized client UUID instead of the customer label in VLESS subscription URIs', () => {
    const normalizedInbound: XrayInbound = {
      ...inbound,
      clientIdentity: 'acme-human-label',
      clients: [
        {
          ...inbound.clients[0],
          id: '22222222-2222-4222-8222-222222222222'
        }
      ]
    };
    const output = renderPublicSubscriptionOutput({
      client,
      format: 'uri',
      inbounds: [normalizedInbound]
    });

    expect(output.body).toContain('vless://22222222-2222-4222-8222-222222222222@edge.example.com:2443');
    expect(output.body).not.toContain('vless://acme-human-label@edge.example.com:2443');
  });

  it('rebuilds URI and V2Ray output for imported Clash nodes without rawUrl', () => {
    const externalClient: SubscriptionClientIdentity = {
      ...client,
      sourceIds: ['source-clash-hk'],
      selectedTags: ['premium'],
      protocol: 'vless',
      routingRule: ''
    };
    const externalNode: SubscriptionInventoryNode = {
      id: 'source-clash-hk-vless-01',
      sourceId: 'source-clash-hk',
      name: 'HK Premium Clash VLESS',
      protocol: 'vless',
      server: 'hk-clash.example.com',
      port: 443,
      latencyMs: 58,
      tags: ['premium', 'region:hk'],
      clashConfig: {
        name: 'HK Premium Clash VLESS',
        type: 'vless',
        server: 'hk-clash.example.com',
        port: 443,
        uuid: '33333333-3333-4333-8333-333333333333',
        tls: true,
        servername: 'hk-clash.example.com',
        network: 'tcp'
      }
    };

    const uri = renderPublicSubscriptionOutput({
      client: externalClient,
      format: 'uri',
      inbounds: [],
      externalNodes: [externalNode]
    });
    const v2ray = renderPublicSubscriptionOutput({
      client: externalClient,
      format: 'v2ray',
      inbounds: [],
      externalNodes: [externalNode]
    });
    const decodedV2ray = Buffer.from(v2ray.body, 'base64').toString('utf8');

    expect(uri.nodeCount).toBe(1);
    expect(uri.body).toContain('vless://33333333-3333-4333-8333-333333333333@hk-clash.example.com:443');
    expect(uri.body).toContain('security=tls');
    expect(uri.body).toContain('#HK+Premium+Clash+VLESS');
    expect(decodedV2ray).toBe(uri.body);
  });

  it('reports subscription output conversion diagnostics when selected nodes cannot produce URIs', () => {
    const externalClient: SubscriptionClientIdentity = {
      ...client,
      sourceIds: ['source-incomplete'],
      selectedTags: ['premium'],
      protocol: 'vless',
      routingRule: ''
    };
    const incompleteNode: SubscriptionInventoryNode = {
      id: 'source-incomplete-vless-01',
      sourceId: 'source-incomplete',
      name: 'Incomplete VLESS',
      protocol: 'vless',
      server: 'incomplete.example.com',
      port: 443,
      latencyMs: 0,
      tags: ['premium', 'region:hk']
    };

    const output = renderPublicSubscriptionOutput({
      client: externalClient,
      format: 'uri',
      inbounds: [],
      externalNodes: [incompleteNode]
    });

    expect(output.nodeCount).toBe(1);
    expect(output.body).toBe('');
    expect(output.headers['x-ou-ui-selected-node-count']).toBe('1');
    expect(output.headers['x-ou-ui-converted-uri-count']).toBe('0');
    expect(output.headers['x-ou-ui-unconverted-node-count']).toBe('1');
    expect(output.headers['x-ou-ui-conversion-warning']).toBe('subscription_output.unconverted_nodes:1');
  });

  it('renders Shadowrocket subscriptions as raw URI lists with client-specific headers', () => {
    const output = renderPublicSubscriptionOutput({
      client,
      format: 'shadowrocket',
      inbounds: [inbound]
    });

    expect(output.contentType).toBe('text/plain; charset=utf-8');
    expect(output.body).toBe(
      [
        'vless://11111111-1111-4111-8111-111111111111@edge.example.com:2443?encryption=none&type=tcp&security=reality&sni=edge.example.com&host=edge.example.com&flow=xtls-rprx-vision&pbk=reality-public-key&sid=a1b2c3d4&fp=chrome#Acme+HK+VLESS'
      ].join('\n')
    );
    expect(output.headers['profile-web-page-url']).toBe('https://ou-ui-next.local/sub/sub_acme_premium');
    expect(output.headers['x-ou-ui-producer']).toBe('shadowrocket');
    expect(output.nodeCount).toBe(1);
  });

  it('renders Stash subscriptions through the producer registry as Clash-compatible YAML', () => {
    const output = renderPublicSubscriptionOutput({
      client,
      exportProfile: {
        id: 'profile-stash',
        name: 'Stash Premium',
        client: 'stash',
        sourceIds: [],
        includeFilter: '',
        excludeFilter: '',
        regionFilter: [],
        outputFormats: ['stash'],
        templateName: 'stash-compatible.yaml',
        proxyGroups: [
          {
            id: 'proxy-group-stash-auto',
            name: 'Stash Auto',
            strategy: 'url-test',
            filterTags: ['premium']
          }
        ],
        includeTrafficHeaders: true,
        updatedAt: '2026-06-14T00:00:00.000Z'
      },
      format: 'stash',
      inbounds: [inbound]
    });

    expect(output.contentType).toBe('text/yaml; charset=utf-8');
    expect(output.body).toContain('# stash-compatible subscription generated by OU-UI Next');
    expect(output.body).toContain('name: "Stash Auto"');
    expect(output.body).toContain('Acme HK VLESS');
    expect(output.body).toContain('edge.example.com');
    expect(output.headers['x-ou-ui-producer']).toBe('stash');
    expect(output.nodeCount).toBe(1);
  });
});
