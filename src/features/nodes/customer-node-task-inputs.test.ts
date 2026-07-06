import { describe, expect, it } from 'vitest';
import { createTaskRequestSchema } from '../../services/api/api-contract';
import type { CustomerNodeConfigMetadata } from './nodes-page';
import {
  createCustomerNodeDeleteTaskInput,
  createCustomerNodeInboundIdempotencyKey,
  createCustomerNodeInboundTargetId,
  createCustomerNodeInboundTaskInput
} from './customer-node-task-inputs';

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
  clientCredential: 'not-a-uuid',
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
  trafficMultiplier: 1.5,
  trafficLimitGb: 100,
  monthlyResetDay: 1,
  currentUsedTrafficGb: 0,
  remainingDays: 30,
  expiresAt: '2026-08-01T00:00:00.000Z',
  subscriptionRule: '',
  enabled: true
};

describe('customer node task inputs', () => {
  it('creates API-valid inbound upsert tasks with structured client metadata', () => {
    const input = createCustomerNodeInboundTaskInput(baseMetadata, 'create', {
      create: 'Create customer node',
      update: 'Update customer node'
    });

    expect(createTaskRequestSchema.safeParse(input).success).toBe(true);
    expect(input).toMatchObject({
      operation: 'inbound.create',
      resourceType: 'inbound',
      targetId: 'inbound-vless-acme',
      targetLabel: 'Acme VLESS',
      summary: 'Create customer node'
    });
    expect(input.metadata).toEqual(
      expect.objectContaining({
        agentId: 'agent-hkg-01',
        xrayProtocol: 'vless',
        listenPort: 443,
        clients: [
          expect.objectContaining({
            clientIdentity: 'acme-client',
            clientEmail: 'acme@example.com',
            enabled: true
          })
        ]
      })
    );
  });

  it('keeps readable upsert idempotency prefixes while changing on runtime-affecting fields', () => {
    const key = createCustomerNodeInboundIdempotencyKey(baseMetadata, 'inbound.update');
    const disabledKey = createCustomerNodeInboundIdempotencyKey({ ...baseMetadata, enabled: false }, 'inbound.update');
    const quotaKey = createCustomerNodeInboundIdempotencyKey(
      { ...baseMetadata, trafficLimitGb: 200 },
      'inbound.update'
    );

    expect(key).toContain('ui:inbound.update:agent-hkg-01:inbound-vless-acme:443:vless:Acme');
    expect(key).not.toBe(disabledKey);
    expect(key).not.toBe(quotaKey);
    expect(key).not.toContain('server-private-key');
    expect(key.length).toBeLessThan(190);
  });

  it('creates API-valid delete tasks with minimal metadata and risk confirmation', () => {
    const input = createCustomerNodeDeleteTaskInput(baseMetadata, 'Delete customer node');

    expect(createTaskRequestSchema.safeParse(input).success).toBe(true);
    expect(input).toMatchObject({
      operation: 'inbound.delete',
      resourceType: 'inbound',
      targetId: 'inbound-vless-acme',
      targetLabel: 'Acme VLESS',
      riskConfirmation: {
        operation: 'inbound.delete',
        targetId: 'inbound-vless-acme'
      }
    });
    expect(input.metadata).toEqual({
      agentId: 'agent-hkg-01',
      nodeId: 'inbound-vless-acme',
      customerNodeName: 'Acme VLESS',
      customerName: 'Acme',
      xrayProtocol: 'vless',
      listenPort: 443,
      clientIdentity: 'acme-client',
      clientEmail: 'acme@example.com'
    });
    expect(createCustomerNodeInboundIdempotencyKey(baseMetadata, 'inbound.delete')).toBe(
      'ui:inbound.delete:agent-hkg-01:inbound-vless-acme'
    );
  });

  it('derives stable inbound target ids for new nodes without mutating metadata', () => {
    const metadata = { ...baseMetadata, nodeId: '', customerNodeName: 'Acme Singapore Gateway' };

    expect(createCustomerNodeInboundTargetId(metadata)).toBe('inbound-acme-singapore-gateway');
    expect(metadata.nodeId).toBe('');
  });
});
