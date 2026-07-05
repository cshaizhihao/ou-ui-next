import type { CustomerNodeConfigMetadata } from './nodes-page';
import { createTaskRequestSchema } from '../../services/api/api-contract';
import { createCustomerNodeTaskMetadata } from './customer-node-task-metadata';

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

function createTaskRequest(operation: 'inbound.create' | 'inbound.update' | 'inbound.delete') {
  return {
    operation,
    resourceType: 'inbound' as const,
    targetId: baseMetadata.nodeId,
    targetLabel: baseMetadata.customerNodeName,
    summary: `${operation} ${baseMetadata.customerNodeName}`,
    metadata: createCustomerNodeTaskMetadata(baseMetadata, operation),
    ...(operation === 'inbound.delete'
      ? {
          riskConfirmation: {
            operation,
            targetId: baseMetadata.nodeId
          }
        }
      : {})
  };
}

describe('customer node task metadata', () => {
  it('omits empty optional fields and non-Hysteria auth from VLESS upsert tasks', () => {
    const request = createTaskRequest('inbound.create');

    expect(createTaskRequestSchema.safeParse(request).success).toBe(true);
    expect(request.metadata).toEqual(
      expect.objectContaining({
        xrayProtocol: 'vless',
        security: 'reality',
        trafficMultiplier: 1.5,
        expiresAt: '2026-08-01T00:00:00.000Z',
        realityPrivateKey: 'server-private-key'
      })
    );
    expect(request.metadata).not.toHaveProperty('hysteriaAuth');
    expect(request.metadata).not.toHaveProperty('clientComment');
    expect(request.metadata).not.toHaveProperty('telegramId');
    expect(request.metadata).not.toHaveProperty('path');
    expect(request.metadata).not.toHaveProperty('subscriptionRule');
  });

  it('builds minimal delete metadata that still passes createTask validation', () => {
    const request = createTaskRequest('inbound.delete');

    expect(createTaskRequestSchema.safeParse(request).success).toBe(true);
    expect(request.metadata).toEqual({
      agentId: 'agent-hkg-01',
      nodeId: 'inbound-vless-acme',
      customerNodeName: 'Acme VLESS',
      customerName: 'Acme',
      xrayProtocol: 'vless',
      listenPort: 443,
      clientIdentity: 'acme-client',
      clientEmail: 'acme@example.com'
    });
  });
});
