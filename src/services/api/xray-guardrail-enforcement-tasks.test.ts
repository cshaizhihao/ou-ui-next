import type { XrayClient, XrayInbound } from '../../domain/protocol';
import type { DeployTask } from '../../domain/task';
import { deriveXrayGuardrailTaskIntents } from './xray-guardrail-enforcement-tasks';

const observedAt = '2026-06-04T12:00:00.000Z';

function createClient(patch: Partial<XrayClient>): XrayClient {
  return {
    id: 'client-alice',
    email: 'alice@example.com',
    enabled: true,
    password: 'client-secret',
    trafficLimitBytes: 100 * 1024 ** 3,
    usedTrafficBytes: 10 * 1024 ** 3,
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

function createAutomaticGuardrailTask(patch: Partial<DeployTask>): DeployTask {
  return {
    id: 'task-existing-guardrail',
    operation: 'inbound.update',
    resourceType: 'inbound',
    resourceId: 'inbound-shared',
    status: 'succeeded',
    targetId: 'inbound-shared',
    targetLabel: 'Acme Shared Inbound',
    summary: 'Existing guardrail task',
    createdAt: '2026-06-04T11:00:00.000Z',
    updatedAt: '2026-06-04T11:01:00.000Z',
    actor: 'system:quota-enforcer',
    requestedBy: 'system:quota-enforcer',
    requestId: 'req-existing-guardrail',
    sourceIp: '127.0.0.1',
    rollbackAvailable: false,
    attempts: 1,
    steps: [],
    metadata: {
      xrayGuardrailAutomatic: true,
      xrayGuardrailAction: 'disable',
      xrayGuardrailPolicyId: 'customer-node:inbound-shared:client-bob'
    },
    ...patch
  };
}

describe('xray guardrail enforcement tasks', () => {
  it('derives per-client disable intents for multi-client Xray inbounds', () => {
    const inbound = createInbound({
      clients: [
        createClient({ id: 'client-alice', email: 'alice@example.com' }),
        createClient({
          id: 'client-bob',
          email: 'bob@example.com',
          quotaExceeded: true,
          runtimeDisabledByPolicy: true,
          guardrailReason: 'xray_client_monthly_quota_exceeded'
        })
      ]
    });

    const [intent] = deriveXrayGuardrailTaskIntents([], [inbound], {
      kind: 'agent-event',
      id: 'evt-xray-guardrail-bob',
      observedAt
    });

    expect(intent).toMatchObject({
      requestId: 'req:xray-guardrail:disable:inbound-shared:client-bob:agent-event:evt-xray-guardrail-bob',
      idempotencyKey:
        'system:quota-enforcer:inbound.update:inbound-shared:client-bob:disable:agent-event:evt-xray-guardrail-bob',
      input: {
        operation: 'inbound.update',
        targetId: 'inbound-shared',
        metadata: expect.objectContaining({
          xrayGuardrailAction: 'disable',
          xrayGuardrailPolicyId: 'customer-node:inbound-shared:client-bob',
          xrayGuardrailReason: 'xray_client_monthly_quota_exceeded',
          enabled: true,
          clientIdentity: 'client-bob'
        })
      }
    });
    expect(intent?.input.metadata?.clients).toEqual([
      expect.objectContaining({
        clientIdentity: 'client-alice',
        clientEmail: 'alice@example.com',
        enabled: true,
        runtimeDisabledByPolicy: false
      }),
      expect.objectContaining({
        clientIdentity: 'client-bob',
        clientEmail: 'bob@example.com',
        enabled: false,
        quotaExceeded: true,
        runtimeDisabledByPolicy: true,
        guardrailReason: 'xray_client_monthly_quota_exceeded'
      })
    ]);
  });

  it('derives per-client resume intents after a multi-client guardrail disable succeeds', () => {
    const inbound = createInbound({
      clients: [
        createClient({ id: 'client-alice', email: 'alice@example.com' }),
        createClient({
          id: 'client-bob',
          email: 'bob@example.com',
          enabled: false,
          quotaExceeded: false,
          runtimeDisabledByPolicy: false,
          guardrailReason: 'ok'
        })
      ]
    });
    const disableTask = createAutomaticGuardrailTask({
      id: 'task-disable-bob',
      createdAt: '2026-06-04T11:00:00.000Z',
      metadata: {
        xrayGuardrailAutomatic: true,
        xrayGuardrailAction: 'disable',
        xrayGuardrailPolicyId: 'customer-node:inbound-shared:client-bob'
      }
    });

    const [intent] = deriveXrayGuardrailTaskIntents([disableTask], [inbound], {
      kind: 'agent-event',
      id: 'evt-xray-guardrail-bob-recovered',
      observedAt
    });

    expect(intent).toMatchObject({
      requestId: 'req:xray-guardrail:resume:inbound-shared:client-bob:agent-event:evt-xray-guardrail-bob-recovered',
      input: {
        operation: 'inbound.update',
        targetId: 'inbound-shared',
        metadata: expect.objectContaining({
          xrayGuardrailAction: 'resume',
          xrayGuardrailPolicyId: 'customer-node:inbound-shared:client-bob',
          enabled: true,
          clientIdentity: 'client-bob'
        })
      }
    });
    expect(intent?.input.metadata?.clients).toEqual([
      expect.objectContaining({
        clientIdentity: 'client-alice',
        enabled: true
      }),
      expect.objectContaining({
        clientIdentity: 'client-bob',
        enabled: true,
        runtimeDisabledByPolicy: false
      })
    ]);
  });
});
