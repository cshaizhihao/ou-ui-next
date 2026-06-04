import type { DeployTask } from './task';
import { createXrayInboundFromTask } from './task-read-models';

function createInboundTask(metadata: DeployTask['metadata']): DeployTask {
  return {
    id: 'task-read-model-vless',
    operation: 'inbound.create',
    resourceType: 'inbound',
    resourceId: 'customer-node-read-model',
    status: 'queued',
    targetId: 'customer-node-read-model',
    targetLabel: 'Read Model VLESS',
    summary: 'Create read model customer inbound',
    createdAt: '2026-06-04T00:00:00.000Z',
    updatedAt: '2026-06-04T00:00:00.000Z',
    actor: 'operator_001',
    requestedBy: 'operator_001',
    requestId: 'req-read-model-vless',
    sourceIp: '127.0.0.1',
    rollbackAvailable: false,
    attempts: 0,
    steps: [],
    metadata
  };
}

describe('task read models', () => {
  it('stores valid UUID client IDs for VLESS customer nodes even when the label is human-readable', () => {
    const inbound = createXrayInboundFromTask(
      createInboundTask({
        agentId: 'agent-hkg-01',
        customerName: 'Acme',
        customerNodeName: 'Acme VLESS',
        xrayProtocol: 'vless',
        clientIdentity: 'acme-human-label',
        clientCredential: 'manual-human-token'
      })
    );

    expect(inbound?.clientIdentity).toBe('acme-human-label');
    expect(inbound?.clients[0].credentialType).toBe('uuid');
    expect(inbound?.clients[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(inbound?.clients[0].id).not.toBe('manual-human-token');
  });
});
