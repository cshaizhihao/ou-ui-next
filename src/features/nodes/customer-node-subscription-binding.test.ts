import { describe, expect, it } from 'vitest';
import type { CustomerNodeConfigMetadata } from './nodes-page';
import {
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
});
