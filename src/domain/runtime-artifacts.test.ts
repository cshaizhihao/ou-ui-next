import type { DeployTask } from './task';
import { buildRuntimeArtifact } from './runtime-artifacts';

type XrayArtifactFixture = {
  xray: {
    inbound: {
      settings: {
        clients: Array<{
          id?: string;
          password?: string;
        }>;
      };
    };
  };
  subscription: {
    shareUri: string;
  };
};

function createHostUpdateTask(metadata: DeployTask['metadata']): DeployTask {
  return {
    id: 'task-host-display-name',
    operation: 'agent.update',
    resourceType: 'agent',
    resourceId: 'agent-hkg-01',
    status: 'queued',
    targetId: 'agent-hkg-01',
    targetLabel: '香港展示名',
    summary: 'Update managed host profile',
    createdAt: '2026-06-04T00:00:00.000Z',
    updatedAt: '2026-06-04T00:00:00.000Z',
    actor: 'operator_001',
    requestedBy: 'operator_001',
    requestId: 'req-host-display-name',
    sourceIp: '127.0.0.1',
    rollbackAvailable: false,
    attempts: 0,
    steps: [],
    metadata
  };
}

function createInboundTask(metadata: DeployTask['metadata']): DeployTask {
  return {
    id: 'task-customer-vless',
    operation: 'inbound.create',
    resourceType: 'inbound',
    resourceId: 'customer-node-acme',
    status: 'queued',
    targetId: 'customer-node-acme',
    targetLabel: 'Acme Premium',
    summary: 'Create customer Xray inbound',
    createdAt: '2026-06-04T00:00:00.000Z',
    updatedAt: '2026-06-04T00:00:00.000Z',
    actor: 'operator_001',
    requestedBy: 'operator_001',
    requestId: 'req-customer-vless',
    sourceIp: '127.0.0.1',
    rollbackAvailable: false,
    attempts: 0,
    steps: [],
    metadata
  };
}

describe('runtime artifacts', () => {
  it('keeps managed host display names separate from runtime host identity', () => {
    const artifact = buildRuntimeArtifact({
      task: createHostUpdateTask({
        agentId: 'agent-hkg-01',
        displayName: '香港展示名',
        maxTrafficGb: 2048
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'host-agent'
    });

    expect(artifact).toMatchObject({
      hostProfile: {
        agentId: 'agent-hkg-01',
        displayName: '香港展示名',
        hostName: 'agent-hkg-01',
        maxTrafficGb: 2048
      }
    });
  });

  it('keeps legacy hostName metadata as a display name only', () => {
    const artifact = buildRuntimeArtifact({
      task: createHostUpdateTask({
        agentId: 'agent-hkg-01',
        hostName: 'legacy-renamed-host'
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'host-agent'
    });

    expect(artifact).toMatchObject({
      hostProfile: {
        displayName: 'legacy-renamed-host',
        hostName: 'agent-hkg-01'
      }
    });
  });

  it('normalizes VLESS and VMess credentials into valid UUIDs for real Xray configs', () => {
    const artifact = buildRuntimeArtifact({
      task: createInboundTask({
        agentId: 'agent-hkg-01',
        customerName: 'Acme',
        customerNodeName: 'Acme Premium',
        serverAddress: 'edge.example.com',
        xrayProtocol: 'vless',
        listenPort: 443,
        clientIdentity: 'acme-premium-human-label',
        clientCredential: 'not-a-uuid',
        security: 'tls',
        sni: 'edge.example.com'
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'xray'
    }) as XrayArtifactFixture;
    const clientId = artifact.xray.inbound.settings.clients[0].id;

    expect(clientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(clientId).not.toBe('not-a-uuid');
    expect(artifact.subscription.shareUri).toContain(`vless://${clientId}@edge.example.com:443`);
  });

  it('keeps password credentials for Trojan clients instead of rewriting them as UUIDs', () => {
    const artifact = buildRuntimeArtifact({
      task: createInboundTask({
        agentId: 'agent-hkg-01',
        customerName: 'Acme',
        customerNodeName: 'Acme Trojan',
        serverAddress: 'edge.example.com',
        xrayProtocol: 'trojan',
        listenPort: 8443,
        clientIdentity: 'acme-trojan',
        clientCredential: 'trojan-secret',
        security: 'tls',
        sni: 'edge.example.com'
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'xray'
    }) as XrayArtifactFixture;

    expect(artifact.xray.inbound.settings.clients[0].password).toBe('trojan-secret');
    expect(artifact.subscription.shareUri).toContain('trojan://trojan-secret@edge.example.com:8443');
  });
});
