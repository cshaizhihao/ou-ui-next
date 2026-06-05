import type { DeployTask } from './task';
import { markTaskAgentRuntimeDeploymentVerified } from './task';
import { applyForwardRuleTask, createForwardRuleFromTask, createXrayInboundFromTask } from './task-read-models';

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

function createForwardTask(overrides: Partial<DeployTask> = {}): DeployTask {
  const defaultMetadata = {
    entryNodeIds: ['agent-edge-01', 'agent-edge-02'],
    listenAddress: '0.0.0.0',
    listenPort: 2443,
    targetAddress: '10.10.0.8',
    targetPort: 9443,
    protocol: 'tcp+udp',
    name: 'Customer HTTPS Forward',
    ownerName: 'Acme Team',
    billingDirection: 'both',
    quotaGb: 100,
    rateLimitMbps: 200,
    currentUsedTrafficGb: 1
  };

  return {
    id: 'task-forward-read-model',
    operation: 'forward.create',
    resourceType: 'forward',
    resourceId: 'forward-custom-2443',
    status: 'queued',
    targetId: 'forward-custom-2443',
    targetLabel: 'Customer HTTPS Forward',
    summary: 'Create customer forwarding rule',
    createdAt: '2026-06-04T00:00:00.000Z',
    updatedAt: '2026-06-04T00:00:00.000Z',
    actor: 'operator_001',
    requestedBy: 'operator_001',
    requestId: 'req-forward-read-model',
    sourceIp: '127.0.0.1',
    rollbackAvailable: false,
    attempts: 0,
    steps: [],
    ...overrides,
    metadata: {
      ...defaultMetadata,
      ...(overrides.metadata ?? {})
    }
  };
}

function withAgentRuntimeProof(task: DeployTask): DeployTask {
  return markTaskAgentRuntimeDeploymentVerified(task, {
    verifiedAt: '2026-06-04T00:01:00.000Z',
    agentIds: ['agent-edge-01', 'agent-edge-02'],
    commandIds: ['cmd-agent-edge-01', 'cmd-agent-edge-02'],
    appliedConfigRevisions: ['cfg-agent-edge-01', 'cfg-agent-edge-02']
  });
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
        clientCredential: 'manual-human-token',
        monthlyResetDay: 11,
        currentUsedTrafficGb: 7,
        security: 'reality',
        sni: 'www.cloudflare.com',
        realityPublicKey: 'client-public-key',
        realityPrivateKey: 'server-private-key',
        realityTarget: 'www.cloudflare.com:443',
        realityShortId: 'abcd1234'
      })
    );

    expect(inbound?.clientIdentity).toBe('acme-human-label');
    expect(inbound?.clients[0].credentialType).toBe('uuid');
    expect(inbound?.clients[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(inbound?.clients[0].id).not.toBe('manual-human-token');
    expect(inbound?.clients[0]).toMatchObject({
      monthlyResetDay: 11,
      manualUsedTrafficBytes: 7 * 1024 * 1024 * 1024,
      usedTrafficBytes: 7 * 1024 * 1024 * 1024
    });
    expect(inbound?.reality).toMatchObject({
      enabled: true,
      publicKey: 'client-public-key',
      privateKey: 'server-private-key',
      target: 'www.cloudflare.com:443',
      shortIds: ['abcd1234']
    });
  });

  it('does not project unsupported Xray inbound protocols into customer-node read models', () => {
    expect(
      createXrayInboundFromTask(
        createInboundTask({
          agentId: 'agent-hkg-01',
          customerName: 'Acme',
          customerNodeName: 'Acme Hysteria2',
          xrayProtocol: 'hysteria',
          clientIdentity: 'acme-hysteria',
          clientCredential: 'hy2-secret'
        })
      )
    ).toBeUndefined();
  });

  it('projects forward create and update tasks with deployment-aware port status', () => {
    const queuedRule = createForwardRuleFromTask(createForwardTask());
    const unverifiedSucceededRule = createForwardRuleFromTask(createForwardTask({ status: 'succeeded' }));
    const succeededRule = createForwardRuleFromTask(withAgentRuntimeProof(createForwardTask({ status: 'succeeded' })));
    const failedRule = createForwardRuleFromTask(createForwardTask({ status: 'failed' }));
    const conflictRule = createForwardRuleFromTask(
      createForwardTask({ status: 'failed', failureReason: 'preflight.port_conflict: listen port is not available' })
    );

    expect(queuedRule).toMatchObject({
      portStatus: 'deploying',
      ports: [expect.objectContaining({ status: 'deploying' }), expect.objectContaining({ status: 'deploying' })]
    });
    expect(unverifiedSucceededRule).toMatchObject({
      portStatus: 'deploying',
      ports: [expect.objectContaining({ status: 'deploying' }), expect.objectContaining({ status: 'deploying' })]
    });
    expect(succeededRule).toMatchObject({
      portStatus: 'allocated',
      ports: [expect.objectContaining({ status: 'allocated' }), expect.objectContaining({ status: 'allocated' })]
    });
    expect(failedRule).toMatchObject({
      portStatus: 'failed',
      ports: [expect.objectContaining({ status: 'failed' }), expect.objectContaining({ status: 'failed' })]
    });
    expect(conflictRule).toMatchObject({
      portStatus: 'conflict',
      ports: [expect.objectContaining({ status: 'conflict' }), expect.objectContaining({ status: 'conflict' })]
    });
  });

  it('updates existing forward rules for apply and delete tasks without claiming early allocation', () => {
    const allocatedRule = createForwardRuleFromTask(withAgentRuntimeProof(createForwardTask({ status: 'succeeded' })));

    expect(allocatedRule).toBeDefined();

    const deployingRules = applyForwardRuleTask(
      [allocatedRule!],
      createForwardTask({
        operation: 'forward.apply',
        status: 'running',
        id: 'task-forward-apply'
      })
    );
    const releasingRules = applyForwardRuleTask(
      deployingRules,
      createForwardTask({
        operation: 'forward.delete',
        status: 'queued',
        id: 'task-forward-delete'
      })
    );
    const deletedRules = applyForwardRuleTask(
      releasingRules,
      withAgentRuntimeProof(
        createForwardTask({
          operation: 'forward.delete',
          status: 'succeeded',
          id: 'task-forward-delete-succeeded'
        })
      )
    );
    const unverifiedDeletedRules = applyForwardRuleTask(
      releasingRules,
      createForwardTask({
        operation: 'forward.delete',
        status: 'succeeded',
        id: 'task-forward-delete-unverified'
      })
    );

    expect(deployingRules[0]).toMatchObject({
      portStatus: 'deploying',
      ports: [expect.objectContaining({ status: 'deploying' }), expect.objectContaining({ status: 'deploying' })]
    });
    expect(releasingRules[0]).toMatchObject({
      portStatus: 'releasing',
      ports: [expect.objectContaining({ status: 'releasing' }), expect.objectContaining({ status: 'releasing' })]
    });
    expect(unverifiedDeletedRules[0]).toMatchObject({
      portStatus: 'releasing',
      ports: [expect.objectContaining({ status: 'releasing' }), expect.objectContaining({ status: 'releasing' })]
    });
    expect(deletedRules).toEqual([]);
  });
});
