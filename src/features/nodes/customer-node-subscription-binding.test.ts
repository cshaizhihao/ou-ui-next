import { describe, expect, it } from 'vitest';
import type { XrayInbound } from '../../domain/protocol';
import type { CustomerNodeConfigMetadata } from './nodes-page';
import {
  createAddedCustomerNodeClientSubscriptionMetadata,
  createCustomerNodeAllSubscriptionText,
  createCustomerNodeSubscriptionMetadata
} from './customer-node-subscription-binding';

const baseMetadata: CustomerNodeConfigMetadata = {
  nodeId: 'inbound-vless-acme',
  agentId: 'agent-hkg-01',
  customerNodeName: 'Acme VLESS',
  customerName: 'Acme',
  serverAddress: 'edge.example.com',
  xrayProtocol: 'vless',
  listenPort: 443,
  clientIdentity: 'acme-client',
  clientEmail: 'acme@example.com',
  clientCredential: 'acme-client',
  clientLevel: 0,
  clientComment: '',
  telegramId: '',
  resetPolicy: 'monthly',
  vmessSecurity: 'auto',
  shadowsocksMethod: '2022-blake3-aes-128-gcm',
  hysteriaAuth: '',
  streamNetwork: 'tcp',
  security: 'reality',
  sni: 'www.cloudflare.com',
  path: '',
  flow: 'xtls-rprx-vision',
  fingerprint: 'chrome',
  alpn: [],
  realityPublicKey: 'client-public-key',
  realityPrivateKey: 'server-private-key',
  realityTarget: 'www.cloudflare.com:443',
  realityShortId: 'abcd1234',
  fallbackName: '',
  fallbackDestination: '',
  fallbackXver: 0,
  sniffingEnabled: true,
  ipLimit: 2,
  trafficMultiplier: 1,
  trafficLimitGb: 100,
  monthlyResetDay: 1,
  currentUsedTrafficGb: 12,
  remainingDays: 30,
  expiresAt: '2026-08-01T00:00:00.000Z',
  subscriptionRule: 'premium-hk',
  enabled: true
};

const inbound: XrayInbound = {
  id: 'inbound-vless-acme',
  nodeId: 'node-hkg-01',
  agentId: 'agent-hkg-01',
  customerName: 'Shared Premium',
  serverAddress: 'edge.example.com',
  clientIdentity: 'acme-client',
  remainingDays: 30,
  subscriptionRule: 'premium-hk',
  path: '',
  flow: 'xtls-rprx-vision',
  protocol: 'vless',
  label: 'Acme VLESS',
  listenAddress: '0.0.0.0',
  listenPort: 443,
  status: 'enabled',
  clients: [],
  streamSettings: {
    network: 'tcp',
    security: 'reality',
    sni: 'www.cloudflare.com',
    fingerprint: 'chrome'
  },
  tls: {
    enabled: false,
    alpn: []
  },
  reality: {
    enabled: true,
    publicKey: 'client-public-key',
    privateKey: 'server-private-key',
    target: 'www.cloudflare.com:443',
    fingerprint: 'chrome',
    shortIds: ['abcd1234'],
    serverNames: ['www.cloudflare.com']
  },
  fallbacks: [],
  sniffingEnabled: true,
  configVersion: 'cfg-1'
};

describe('customer node subscription binding', () => {
  it('creates traceable subscription metadata for customer-node generated Xray clients', () => {
    const metadata = createCustomerNodeSubscriptionMetadata(baseMetadata, 'https://panel.example.com/ou');

    expect(metadata).toMatchObject({
      subscriptionClientId: 'sub-client-acme-premium-hk',
      customerName: 'Acme',
      subId: 'premium-hk',
      email: 'acme@example.com',
      protocol: 'vless',
      group: 'agent-hkg-01',
      trafficLimitGb: 100,
      usedTrafficGb: 12,
      remainingDays: 30,
      ipLimit: 2,
      enabled: true,
      outputFormats: ['uri', 'v2ray', 'clash', 'mihomo', 'sing-box', 'shadowrocket', 'stash'],
      formats: ['plain', 'json', 'clash', 'mihomo', 'sing-box'],
      templateName: 'mihomo-compatible.yaml'
    });
    expect(metadata.securePathPreview).toMatch(/^\/[a-z0-9]{24}$/);
    expect(metadata.accessTokenPreview).toMatch(/^ou_[a-z0-9]{10}$/);
    expect(metadata.subscriptionUrlPreview.uri).toBe(
      `https://panel.example.com/ou/sub${metadata.securePathPreview}/uri/premium-hk`
    );
    expect(metadata.subscriptionUrlPreview.shadowrocket).toBe(
      `https://panel.example.com/ou/sub${metadata.securePathPreview}/shadowrocket/premium-hk`
    );
    expect(metadata.clientRule.trafficConstraint).toMatchObject({
      limitGb: 100,
      usedGb: 12,
      remainingDays: 30,
      ipLimit: 2,
      requestLimitPerHour: 360
    });
  });

  it('preserves existing binding identity and secure path while rendering all copy links', () => {
    const metadata = createCustomerNodeSubscriptionMetadata(
      {
        ...baseMetadata,
        subscriptionClientId: 'sub-client-existing',
        subId: 'sub_existing',
        securePathPreview: '/ExistingSecurePath001122',
        subscriptionUrlPreview: {
          ...(baseMetadata.subscriptionUrlPreview ?? {}),
          uri: 'https://old.example.com/sub/uri'
        }
      },
      'https://panel.example.com'
    );
    const allLinks = createCustomerNodeAllSubscriptionText(metadata);

    expect(metadata.subscriptionClientId).toBe('sub-client-existing');
    expect(metadata.subId).toBe('sub_existing');
    expect(metadata.securePathPreview).toBe('/ExistingSecurePath001122');
    expect(metadata.subscriptionUrlPreview.uri).toBe('https://old.example.com/sub/uri');
    expect(allLinks).toContain('URI: https://old.example.com/sub/uri');
    expect(allLinks).toContain('Stash: https://panel.example.com/sub/ExistingSecurePath001122/stash/sub_existing');
  });

  it('creates subscription metadata for an added shared-inbound Xray client', () => {
    const metadata = createAddedCustomerNodeClientSubscriptionMetadata({
      inbound,
      publicBaseUrl: 'https://panel.example.com',
      observedAt: '2026-07-01T00:00:00.000Z',
      action: {
        kind: 'add-client',
        clientIdentity: 'client-carol',
        clientEmail: 'carol@example.com',
        clientCredential: 'carol-secret',
        trafficLimitGb: 50,
        currentUsedTrafficGb: 5,
        remainingDays: 45,
        ipLimit: 1,
        subscriptionRule: 'premium-hk:carol'
      }
    });

    expect(metadata).toMatchObject({
      subscriptionClientId: 'sub-client-carol-example-com-premium-hk-carol',
      customerName: 'carol@example.com',
      subId: 'premium-hk:carol',
      email: 'carol@example.com',
      protocol: 'vless',
      group: 'agent-hkg-01',
      trafficLimitGb: 50,
      usedTrafficGb: 5,
      remainingDays: 45,
      ipLimit: 1,
      enabled: true,
      outputFormats: ['uri', 'v2ray', 'clash', 'mihomo', 'sing-box', 'shadowrocket', 'stash']
    });
    expect(metadata.subscriptionUrlPreview.uri).toBe(
      `https://panel.example.com/sub${metadata.securePathPreview}/uri/premium-hk%3Acarol`
    );
    expect(metadata.clientRule.access.subId).toBe('premium-hk:carol');
  });

  it('derives the same default added-client identity used by the runtime action builder', () => {
    const metadata = createAddedCustomerNodeClientSubscriptionMetadata({
      inbound,
      publicBaseUrl: 'https://panel.example.com',
      observedAt: '2026-07-01T00:00:00.000Z',
      action: {
        kind: 'add-client',
        clientEmail: 'dave@example.com'
      }
    });

    expect(metadata.subId).toBe('premium-hk:client-dave');
    expect(metadata.email).toBe('dave@example.com');
    expect(metadata.trafficLimitGb).toBe(100);
    expect(metadata.remainingDays).toBe(30);
    expect(metadata.clientRule.routingRule).toBe('premium-hk:client-dave');
  });
});
