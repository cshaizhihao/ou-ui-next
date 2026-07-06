import type { XrayClient, XrayInbound } from '../../domain/protocol';
import type { DeployTask } from '../../domain/task';
import { applyXrayInboundTask } from '../../domain/task-read-models';
import { createXrayClientActionTaskPlan } from './xray-client-action-tasks';

const GB = 1024 ** 3;
const observedAt = '2026-06-04T12:00:00.000Z';

function createClient(patch: Partial<XrayClient>): XrayClient {
  return {
    id: 'client-alice',
    email: 'alice@example.com',
    enabled: true,
    password: 'client-secret',
    trafficLimitBytes: 100 * GB,
    usedTrafficBytes: 10 * GB,
    expiresAt: '2026-12-31T00:00:00.000Z',
    ipLimit: 2,
    ...patch
  };
}

function createInbound(patch: Partial<XrayInbound> = {}): XrayInbound {
  return {
    id: 'inbound-shared',
    nodeId: 'node-hkg-01',
    agentId: 'agent-hkg-01',
    customerName: 'Acme',
    serverAddress: 'edge.example.com',
    clientIdentity: 'legacy-single-client-identity',
    remainingDays: 30,
    subscriptionRule: 'premium',
    protocol: 'vless',
    label: 'Acme Shared Inbound',
    listenAddress: '0.0.0.0',
    listenPort: 443,
    status: 'enabled',
    clients: [
      createClient({ id: 'client-alice', email: 'alice@example.com' }),
      createClient({ id: 'client-bob', email: 'bob@example.com' })
    ],
    streamSettings: {
      network: 'tcp',
      security: 'tls',
      sni: 'edge.example.com'
    },
    tls: {
      enabled: true,
      alpn: ['h2', 'http/1.1']
    },
    reality: {
      enabled: false,
      shortIds: [],
      serverNames: []
    },
    fallbacks: [],
    sniffingEnabled: true,
    configVersion: 'cfg-current',
    ...patch
  };
}

function createTaskFromPlan(plan: ReturnType<typeof createXrayClientActionTaskPlan>): DeployTask {
  return {
    id: 'task-xray-client-action',
    operation: plan.input.operation,
    resourceType: plan.input.resourceType ?? 'inbound',
    resourceId: plan.input.targetId,
    targetId: plan.input.targetId,
    targetLabel: plan.input.targetLabel,
    summary: plan.input.summary,
    status: 'succeeded',
    createdAt: observedAt,
    updatedAt: observedAt,
    actor: 'admin',
    requestedBy: 'admin',
    requestId: 'req-xray-client-action',
    sourceIp: 'ui-preview',
    rollbackAvailable: false,
    attempts: 1,
    progressPercent: 100,
    steps: [],
    metadata: plan.input.metadata
  };
}

describe('xray client action tasks', () => {
  it('adds a client to an existing inbound with a replacement multi-client update', () => {
    const plan = createXrayClientActionTaskPlan({
      inbound: createInbound(),
      request: {
        inboundId: 'inbound-shared',
        action: {
          kind: 'add-client',
          clientIdentity: 'client-carol',
          clientEmail: 'carol@example.com',
          clientCredential: 'carol-secret',
          trafficLimitGb: 50,
          remainingDays: 45,
          ipLimit: 1,
          subscriptionRule: 'premium:client-carol'
        },
        reason: 'operator add shared client'
      },
      observedAt
    });

    expect(plan.input).toMatchObject({
      operation: 'inbound.update',
      resourceType: 'inbound',
      targetId: 'inbound-shared',
      summary: 'Xray client add: carol@example.com',
      metadata: expect.objectContaining({
        enabled: true,
        clientIdentity: 'client-carol',
        clientEmail: 'carol@example.com',
        clientCredential: 'carol-secret',
        trafficLimitGb: 50,
        remainingDays: 45,
        ipLimit: 1,
        subscriptionRule: 'premium:client-carol',
        xrayReplaceClients: true,
        xrayClientAction: 'add-client',
        xrayClientActionTargetIdentity: 'client-carol',
        xrayClientActionTargetEmail: 'carol@example.com',
        xrayClientActionReason: 'operator add shared client'
      })
    });
    expect(plan.input.metadata?.clients).toEqual([
      expect.objectContaining({
        clientIdentity: 'client-alice',
        clientEmail: 'alice@example.com'
      }),
      expect.objectContaining({
        clientIdentity: 'client-bob',
        clientEmail: 'bob@example.com'
      }),
      expect.objectContaining({
        clientIdentity: 'client-carol',
        clientEmail: 'carol@example.com',
        enabled: true
      })
    ]);

    const [updatedInbound] = applyXrayInboundTask([createInbound()], createTaskFromPlan(plan));
    expect(updatedInbound.clients.map((client) => client.email)).toEqual([
      'alice@example.com',
      'bob@example.com',
      'carol@example.com'
    ]);
  });

  it('rejects add-client requests that duplicate an existing client email', () => {
    expect(() =>
      createXrayClientActionTaskPlan({
        inbound: createInbound(),
        request: {
          inboundId: 'inbound-shared',
          action: {
            kind: 'add-client',
            clientIdentity: 'client-carol',
            clientEmail: 'bob@example.com'
          }
        },
        observedAt
      })
    ).toThrow(/client email already exists/);
  });

  it('creates a full peer-preserving inbound.update for a single client disable', () => {
    const plan = createXrayClientActionTaskPlan({
      inbound: createInbound(),
      request: {
        inboundId: 'inbound-shared',
        clientId: 'client-bob',
        action: {
          kind: 'set-enabled',
          enabled: false
        }
      },
      observedAt
    });

    expect(plan.input).toMatchObject({
      operation: 'inbound.update',
      resourceType: 'inbound',
      targetId: 'inbound-shared',
      summary: 'Xray client disable: bob@example.com',
      metadata: expect.objectContaining({
        enabled: true,
        clientIdentity: 'client-bob',
        clientEmail: 'bob@example.com',
        xrayClientAction: 'set-enabled',
        xrayClientActionLabel: 'disable'
      })
    });
    expect(plan.input.metadata?.clients).toEqual([
      expect.objectContaining({
        clientIdentity: 'client-alice',
        clientEmail: 'alice@example.com',
        enabled: true
      }),
      expect.objectContaining({
        clientIdentity: 'client-bob',
        clientEmail: 'bob@example.com',
        enabled: false
      })
    ]);
  });

  it('resets quota traffic and clears quota guardrail evidence for the target client', () => {
    const inbound = createInbound({
      clients: [
        createClient({ id: 'client-alice', email: 'alice@example.com' }),
        createClient({
          id: 'client-bob',
          email: 'bob@example.com',
          enabled: false,
          trafficLimitBytes: 8 * GB,
          manualUsedTrafficBytes: 9 * GB,
          usedTrafficBytes: 9 * GB,
          quotaExceeded: true,
          runtimeDisabledByPolicy: true,
          guardrailReason: 'xray_client_monthly_quota_exceeded'
        })
      ]
    });

    const plan = createXrayClientActionTaskPlan({
      inbound,
      request: {
        inboundId: 'inbound-shared',
        clientEmail: 'bob@example.com',
        action: {
          kind: 'reset-used-traffic'
        }
      },
      observedAt
    });

    expect(plan.input.metadata).toEqual(
      expect.objectContaining({
        clientIdentity: 'client-bob',
        currentUsedTrafficGb: 0,
        quotaExceeded: false,
        runtimeDisabledByPolicy: false,
        guardrailReason: 'ok'
      })
    );
    expect(plan.input.metadata?.clients).toEqual([
      expect.objectContaining({
        clientIdentity: 'client-alice',
        currentUsedTrafficGb: 10,
        enabled: true
      }),
      expect.objectContaining({
        clientIdentity: 'client-bob',
        currentUsedTrafficGb: 0,
        quotaExceeded: false,
        runtimeDisabledByPolicy: false,
        guardrailReason: 'ok'
      })
    ]);
  });

  it('renews an expired client with an absolute expiresAt and clears expiry guardrail evidence', () => {
    const inbound = createInbound({
      clientIdentity: 'client-bob',
      clients: [
        createClient({
          id: 'client-bob',
          email: 'bob@example.com',
          enabled: false,
          expiresAt: '2026-06-01T00:00:00.000Z',
          clientExpired: true,
          runtimeDisabledByPolicy: true,
          guardrailReason: 'xray_client_expired'
        })
      ]
    });

    const plan = createXrayClientActionTaskPlan({
      inbound,
      request: {
        inboundId: 'inbound-shared',
        clientId: 'client-bob',
        action: {
          kind: 'renew',
          addedDays: 30
        }
      },
      observedAt
    });

    expect(plan.input.metadata).toEqual(
      expect.objectContaining({
        enabled: true,
        clientIdentity: 'client-bob',
        remainingDays: 30,
        expiresAt: '2026-07-04T12:00:00.000Z',
        clientExpired: false,
        runtimeDisabledByPolicy: false,
        guardrailReason: 'ok'
      })
    );
  });

  it('deletes one client from a shared inbound with a peer-preserving replacement update', () => {
    const plan = createXrayClientActionTaskPlan({
      inbound: createInbound(),
      request: {
        inboundId: 'inbound-shared',
        clientEmail: 'bob@example.com',
        action: {
          kind: 'delete-client'
        },
        reason: 'operator cleanup'
      },
      observedAt
    });

    expect(plan.input).toMatchObject({
      operation: 'inbound.update',
      resourceType: 'inbound',
      targetId: 'inbound-shared',
      summary: 'Xray client delete: bob@example.com',
      metadata: expect.objectContaining({
        enabled: true,
        clientIdentity: 'client-alice',
        clientEmail: 'alice@example.com',
        xrayReplaceClients: true,
        xrayClientAction: 'delete-client',
        xrayClientActionLabel: 'delete',
        xrayClientActionTargetIdentity: 'client-bob',
        xrayClientActionTargetEmail: 'bob@example.com',
        xrayClientActionReason: 'operator cleanup'
      })
    });
    expect(plan.input).not.toHaveProperty('riskConfirmation');
    expect(plan.input.metadata?.clients).toEqual([
      expect.objectContaining({
        clientIdentity: 'client-alice',
        clientEmail: 'alice@example.com',
        enabled: true
      })
    ]);

    const [updatedInbound] = applyXrayInboundTask([createInbound()], createTaskFromPlan(plan));
    expect(updatedInbound.clients).toHaveLength(1);
    expect(updatedInbound.clients[0].email).toBe('alice@example.com');
  });

  it('deletes the final client as an inbound delete with explicit runtime removal evidence', () => {
    const inbound = createInbound({
      clients: [createClient({ id: 'client-bob', email: 'bob@example.com' })],
      clientIdentity: 'client-bob'
    });

    const plan = createXrayClientActionTaskPlan({
      inbound,
      request: {
        inboundId: 'inbound-shared',
        clientId: 'client-bob',
        action: {
          kind: 'delete-client'
        }
      },
      observedAt
    });

    expect(plan.input).toMatchObject({
      operation: 'inbound.delete',
      resourceType: 'inbound',
      targetId: 'inbound-shared',
      summary: 'Xray client delete: bob@example.com',
      riskConfirmation: {
        operation: 'inbound.delete',
        targetId: 'inbound-shared'
      },
      metadata: expect.objectContaining({
        enabled: false,
        clientIdentity: 'client-bob',
        clientEmail: 'bob@example.com',
        xrayClientAction: 'delete-client',
        xrayClientActionTargetEmail: 'bob@example.com'
      })
    });
    expect(plan.input.metadata?.clients).toEqual([
      expect.objectContaining({
        clientIdentity: 'client-bob',
        clientEmail: 'bob@example.com',
        enabled: false,
        runtimeDisabledByPolicy: true,
        guardrailReason: 'xray_client_deleted'
      })
    ]);
  });
});
