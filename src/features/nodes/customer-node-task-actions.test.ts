import { describe, expect, it } from 'vitest';
import type { CustomerNodeConfigMetadata } from './nodes-page';
import {
  createCustomerNodeEnabledUpdate,
  createCustomerNodeRenewalUpdate,
  createCustomerNodeTrafficUpdate
} from './customer-node-task-actions';

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
  ipLimit: 0,
  trafficMultiplier: 1,
  trafficLimitGb: 100,
  monthlyResetDay: 1,
  currentUsedTrafficGb: 0,
  remainingDays: 30,
  expiresAt: '2026-08-01T00:00:00.000Z',
  subscriptionRule: 'premium',
  enabled: true
};

describe('customer node task actions', () => {
  it('creates deterministic enabled, traffic, and renewal metadata updates', () => {
    expect(createCustomerNodeEnabledUpdate(baseMetadata, false)).toMatchObject({
      enabled: false,
      clientIdentity: 'acme-client'
    });
    expect(createCustomerNodeTrafficUpdate(baseMetadata, 25.4)).toMatchObject({
      trafficLimitGb: 125
    });
    expect(createCustomerNodeTrafficUpdate(baseMetadata, -10)).toMatchObject({
      trafficLimitGb: 100
    });
    expect(
      createCustomerNodeRenewalUpdate(baseMetadata, 15, new Date('2026-06-01T00:00:00.000Z'))
    ).toMatchObject({
      remainingDays: 45,
      expiresAt: '2026-07-16T00:00:00.000Z'
    });
  });
});
