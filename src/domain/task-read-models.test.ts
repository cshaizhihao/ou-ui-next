import type { DeployTask } from './task';
import { markTaskAgentRuntimeDeploymentVerified } from './task';
import { applyForwardRuleTask, applyXrayInboundTask, createForwardRuleFromTask, createXrayInboundFromTask } from './task-read-models';

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
    rateLimitMode: 'bi-directional',
    rateLimitDirection: 'both',
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

  it('projects multiple Xray clients from customer-node task metadata', () => {
    const inbound = createXrayInboundFromTask(
      createInboundTask({
        agentId: 'agent-hkg-01',
        customerName: 'Acme',
        customerNodeName: 'Acme Shared Inbound',
        xrayProtocol: 'vless',
        clientIdentity: 'acme-shared',
        clientCredential: 'fallback-token',
        clients: [
          {
            clientIdentity: 'alice',
            clientCredential: 'alice-token',
            clientEmail: 'alice@example.com',
            trafficLimitGb: 100,
            monthlyResetDay: 5,
            trafficMultiplier: 1.5
          },
          {
            clientIdentity: 'bob',
            clientCredential: 'bob-token',
            clientEmail: 'bob@example.com',
            trafficLimitGb: 200,
            monthlyResetDay: 15,
            ipLimit: 2
          }
        ]
      })
    );

    expect(inbound?.clients).toHaveLength(2);
    expect(inbound?.clients.map((client) => client.email)).toEqual(['alice@example.com', 'bob@example.com']);
    expect(inbound?.clients[0]).toMatchObject({
      trafficLimitBytes: 100 * 1024 * 1024 * 1024,
      monthlyResetDay: 5,
      trafficMultiplier: 1.5
    });
    expect(inbound?.clients[1]).toMatchObject({
      trafficLimitBytes: 200 * 1024 * 1024 * 1024,
      monthlyResetDay: 15,
      ipLimit: 2
    });
  });

  it('preserves per-client telemetry when multi-client Xray inbounds are updated', () => {
    const initialInbound = createXrayInboundFromTask(
      createInboundTask({
        agentId: 'agent-hkg-01',
        customerName: 'Acme',
        customerNodeName: 'Acme Shared Inbound',
        xrayProtocol: 'vless',
        clients: [
          {
            clientIdentity: 'alice',
            clientCredential: 'alice-token',
            clientEmail: 'alice@example.com'
          },
          {
            clientIdentity: 'bob',
            clientCredential: 'bob-token',
            clientEmail: 'bob@example.com'
          }
        ]
      })
    );

    expect(initialInbound).toBeDefined();

    const existingInbound = {
      ...initialInbound!,
      clients: initialInbound!.clients.map((client, index) => ({
        ...client,
        uplinkBytes: index === 0 ? 1024 : 2048,
        downlinkBytes: index === 0 ? 4096 : 8192,
        lastTrafficSampleAt: '2026-06-04T00:10:00.000Z',
        trafficBillingPeriod: '2026-06'
      }))
    };
    const [updatedInbound] = applyXrayInboundTask(
      [existingInbound],
      {
        ...createInboundTask({
          agentId: 'agent-hkg-01',
          customerName: 'Acme',
          customerNodeName: 'Acme Shared Inbound Updated',
          xrayProtocol: 'vless',
          clients: [
            {
              clientIdentity: 'alice',
              clientCredential: 'alice-token',
              clientEmail: 'alice@example.com',
              trafficLimitGb: 300
            },
            {
              clientIdentity: 'bob',
              clientCredential: 'bob-token',
              clientEmail: 'bob@example.com',
              trafficLimitGb: 400
            }
          ]
        }),
        operation: 'inbound.update'
      }
    );

    expect(updatedInbound.clients.map((client) => client.uplinkBytes)).toEqual([1024, 2048]);
    expect(updatedInbound.clients.map((client) => client.downlinkBytes)).toEqual([4096, 8192]);
    expect(updatedInbound.clients.map((client) => client.trafficLimitBytes)).toEqual([
      300 * 1024 * 1024 * 1024,
      400 * 1024 * 1024 * 1024
    ]);
  });

  it('applies explicit Xray client policy evidence from update tasks instead of keeping stale guardrail state', () => {
    const initialInbound = createXrayInboundFromTask(
      createInboundTask({
        agentId: 'agent-hkg-01',
        customerName: 'Acme',
        customerNodeName: 'Acme Guardrail Inbound',
        xrayProtocol: 'vless',
        clients: [
          {
            clientIdentity: 'alice',
            clientCredential: 'alice-token',
            clientEmail: 'alice@example.com',
            trafficLimitGb: 100,
            currentUsedTrafficGb: 100,
            quotaExceeded: true,
            runtimeDisabledByPolicy: true,
            guardrailReason: 'xray_client_monthly_quota_exceeded',
            enabled: false
          }
        ]
      })
    );

    expect(initialInbound).toBeDefined();

    const [updatedInbound] = applyXrayInboundTask(
      [initialInbound!],
      {
        ...createInboundTask({
          agentId: 'agent-hkg-01',
          customerName: 'Acme',
          customerNodeName: 'Acme Guardrail Inbound',
          xrayProtocol: 'vless',
          clients: [
            {
              clientIdentity: 'alice',
              clientCredential: 'alice-token',
              clientEmail: 'alice@example.com',
              trafficLimitGb: 150,
              currentUsedTrafficGb: 0,
              quotaExceeded: false,
              clientExpired: false,
              runtimeDisabledByPolicy: false,
              guardrailReason: 'ok',
              enabled: true
            }
          ]
        }),
        operation: 'inbound.update'
      }
    );

    expect(updatedInbound.clients[0]).toMatchObject({
      email: 'alice@example.com',
      enabled: true,
      trafficLimitBytes: 150 * 1024 * 1024 * 1024,
      usedTrafficBytes: 0,
      quotaExceeded: false,
      clientExpired: false,
      runtimeDisabledByPolicy: false,
      guardrailReason: 'ok'
    });
  });

  it('auto-allocates a high listen port when customer-node metadata omits listenPort', () => {
    const inbound = createXrayInboundFromTask(
      createInboundTask({
        agentId: 'agent-hkg-01',
        customerName: 'Acme',
        customerNodeName: 'Acme Auto Port',
        xrayProtocol: 'vless',
        clientIdentity: 'acme-auto-port',
        clientCredential: 'manual-human-token',
        security: 'tls',
        sni: 'edge.example.com'
      })
    );

    expect(inbound?.listenPort).toBeGreaterThanOrEqual(20_000);
    expect(inbound?.listenPort).toBeLessThanOrEqual(60_999);
    expect(inbound?.listenPort).not.toBe(443);
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

  it('projects disabled customer-node updates into a disabled read-model state', () => {
    const inbound = createXrayInboundFromTask(
      createInboundTask({
        agentId: 'agent-hkg-01',
        customerName: 'Acme',
        customerNodeName: 'Acme Disabled',
        xrayProtocol: 'vless',
        clientIdentity: 'acme-disabled',
        clientCredential: 'acme-disabled',
        enabled: false
      })
    );

    expect(inbound).toMatchObject({
      status: 'disabled',
      clients: [expect.objectContaining({ enabled: false })]
    });
  });

  it('projects forward create and update tasks with deployment-aware port status', () => {
    const queuedRule = createForwardRuleFromTask(createForwardTask());
    const unverifiedSucceededRule = createForwardRuleFromTask(createForwardTask({ status: 'succeeded' }));
    const succeededRule = createForwardRuleFromTask(withAgentRuntimeProof(createForwardTask({ status: 'succeeded' })));
    const failedRule = createForwardRuleFromTask(createForwardTask({ status: 'failed' }));
    const conflictRule = createForwardRuleFromTask(
      createForwardTask({ status: 'failed', failureReason: 'preflight.port_conflict: listen port is not available' })
    );
    const oneWayRateLimitedRule = createForwardRuleFromTask(
      createForwardTask({
        metadata: {
          billingDirection: 'ingress',
          rateLimitMode: 'one-way',
          rateLimitDirection: 'ingress'
        }
      })
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
      rateLimitMode: 'bi-directional',
      rateLimitDirection: 'both',
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
    expect(oneWayRateLimitedRule).toMatchObject({
      billingDirection: 'ingress',
      rateLimitMode: 'one-way',
      rateLimitDirection: 'ingress'
    });
  });

  it('auto-allocates a high listen port when forwarding metadata omits listenPort', () => {
    const rule = createForwardRuleFromTask(
      createForwardTask({
        targetId: 'forward-auto-port',
        targetLabel: 'Customer Auto Port Forward',
        metadata: {
          listenPort: undefined,
          targetAddress: '10.10.0.8',
          targetPort: 9443,
          protocol: 'tcp+udp',
          entryNodeIds: ['agent-edge-01', 'agent-edge-02']
        }
      })
    );

    expect(rule?.ports).toHaveLength(2);
    expect(rule?.ports[0].listenPort).toBeGreaterThanOrEqual(20_000);
    expect(rule?.ports[0].listenPort).toBeLessThanOrEqual(60_999);
    expect(rule?.ports[0].listenPort).toBe(rule?.ports[1].listenPort);
    expect(rule?.ports[0].listenPort).not.toBe(1);
    expect(rule?.ports[0].listenPort).not.toBe(443);
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
    const pausedRules = applyForwardRuleTask(
      [allocatedRule!],
      createForwardTask({
        operation: 'forward.pause',
        status: 'queued',
        id: 'task-forward-pause',
        metadata: {
          enabled: false
        }
      })
    );
    const pausedSucceededRules = applyForwardRuleTask(
      pausedRules,
      withAgentRuntimeProof(
        createForwardTask({
          operation: 'forward.pause',
          status: 'succeeded',
          id: 'task-forward-pause-succeeded',
          metadata: {
            enabled: false
          }
        })
      )
    );
    const resumedRules = applyForwardRuleTask(
      pausedSucceededRules,
      createForwardTask({
        operation: 'forward.resume',
        status: 'running',
        id: 'task-forward-resume',
        metadata: {
          enabled: true
        }
      })
    );
    const resumedSucceededRules = applyForwardRuleTask(
      resumedRules,
      withAgentRuntimeProof(
        createForwardTask({
          operation: 'forward.resume',
          status: 'succeeded',
          id: 'task-forward-resume-succeeded',
          metadata: {
            enabled: true
          }
        })
      )
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
    expect(pausedRules[0]).toMatchObject({
      enabled: false,
      portStatus: 'releasing',
      ports: [expect.objectContaining({ status: 'releasing' }), expect.objectContaining({ status: 'releasing' })]
    });
    expect(pausedSucceededRules[0]).toMatchObject({
      enabled: false,
      portStatus: 'paused',
      ports: [expect.objectContaining({ status: 'paused' }), expect.objectContaining({ status: 'paused' })]
    });
    expect(resumedRules[0]).toMatchObject({
      enabled: true,
      portStatus: 'deploying',
      ports: [expect.objectContaining({ status: 'deploying' }), expect.objectContaining({ status: 'deploying' })]
    });
    expect(resumedSucceededRules[0]).toMatchObject({
      enabled: true,
      portStatus: 'allocated',
      ports: [expect.objectContaining({ status: 'allocated' }), expect.objectContaining({ status: 'allocated' })]
    });
    expect(unverifiedDeletedRules[0]).toMatchObject({
      portStatus: 'releasing',
      ports: [expect.objectContaining({ status: 'releasing' }), expect.objectContaining({ status: 'releasing' })]
    });
    expect(deletedRules).toEqual([]);
  });
});
