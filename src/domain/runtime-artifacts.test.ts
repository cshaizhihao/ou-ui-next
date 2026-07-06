import type { DeployTask } from './task';
import { buildRuntimeArtifact } from './runtime-artifacts';

type XrayArtifactFixture = {
  clientPolicy: {
    monthlyResetDay?: number;
    manualUsedTrafficBytes?: number;
  };
  xray: {
    inbound: {
      port: number;
      settings: {
        clients: Array<{
          id?: string;
          password?: string;
        }>;
      };
      streamSettings: Record<string, unknown>;
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

function createTunnelTask(metadata: DeployTask['metadata']): DeployTask {
  return {
    id: 'task-tunnel-port-forward',
    operation: 'tunnel.create',
    resourceType: 'tunnel',
    resourceId: 'tunnel-customer-a',
    status: 'queued',
    targetId: 'tunnel-customer-a',
    targetLabel: 'Customer A forwarding tunnel',
    summary: 'Create customer forwarding tunnel',
    createdAt: '2026-06-04T00:00:00.000Z',
    updatedAt: '2026-06-04T00:00:00.000Z',
    actor: 'operator_001',
    requestedBy: 'operator_001',
    requestId: 'req-tunnel-port-forward',
    sourceIp: '127.0.0.1',
    rollbackAvailable: false,
    attempts: 0,
    steps: [],
    metadata
  };
}

function createForwardTask(operation: DeployTask['operation'], metadata: DeployTask['metadata']): DeployTask {
  return {
    id: `task-forward-${operation}`,
    operation,
    resourceType: 'forward',
    resourceId: 'forward-hkg-443',
    status: 'queued',
    targetId: 'forward-hkg-443',
    targetLabel: 'Forwarding HKG 443',
    summary: 'Apply forwarding runtime state',
    createdAt: '2026-06-04T00:00:00.000Z',
    updatedAt: '2026-06-04T00:00:00.000Z',
    actor: 'operator_001',
    requestedBy: 'operator_001',
    requestId: `req-forward-${operation}`,
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
        runtimeHostName: 'edge-runtime-01',
        maxTrafficGb: 2048
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'host-agent'
    });

    expect(artifact).toMatchObject({
      hostProfile: {
        agentId: 'agent-hkg-01',
        displayName: '香港展示名',
        hostName: 'edge-runtime-01',
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

  it('uses a faster telemetry cadence without changing the ping probe cadence', () => {
    const artifact = buildRuntimeArtifact({
      task: createHostUpdateTask({
        agentId: 'agent-hkg-01',
        pingTarget: 'www.cloudflare.com'
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'host-agent'
    });

    expect(artifact).toMatchObject({
      probeConfig: expect.objectContaining({
        pingIntervalSeconds: 30
      }),
      telemetryPlan: expect.objectContaining({
        sampleIntervalSeconds: 1,
        pingProbe: expect.objectContaining({
          intervalSeconds: 30
        }),
        hardwareProbe: expect.objectContaining({
          intervalSeconds: 1
        })
      })
    });
  });

  it('rejects Hysteria2 as an Xray inbound until a dedicated runtime exists', () => {
    expect(() =>
      buildRuntimeArtifact({
        task: createInboundTask({
          agentId: 'agent-hkg-01',
          customerName: 'Acme',
          customerNodeName: 'Acme Hysteria2',
          serverAddress: 'edge.example.com',
          xrayProtocol: 'hysteria',
          listenPort: 443,
          clientIdentity: 'acme-hysteria',
          clientCredential: 'hy2-secret'
        }),
        agentId: 'agent-hkg-01',
        moduleKind: 'xray'
      })
    ).toThrow('Unsupported Xray inbound protocol: hysteria');
  });

  it('compiles Xray inbound deletes into remove artifacts without active runtime clients', () => {
    const artifact = buildRuntimeArtifact({
      task: {
        ...createInboundTask({
          agentId: 'agent-hkg-01',
          customerName: 'Acme',
          customerNodeName: 'Acme Removed Inbound',
          serverAddress: 'edge.example.com',
          xrayProtocol: 'vless',
          listenPort: 443,
          clientIdentity: 'acme-delete',
          clientCredential: 'acme-delete-token',
          clientEmail: 'acme-delete@example.com',
          security: 'tls',
          sni: 'edge.example.com'
        }),
        operation: 'inbound.delete',
        summary: 'Delete customer Xray inbound'
      },
      agentId: 'agent-hkg-01',
      moduleKind: 'xray'
    }) as {
      action: string;
      clientPolicy: {
        clientEmail: string;
        operatorEnabled: boolean;
        enabled: boolean;
        runtimeDisabledByPolicy: boolean;
        guardrailReason: string;
      };
      runtimeCapabilities: { activeClientCount: number; totalClientCount: number };
      subscription: { shareUris: Array<{ enabled: boolean }> };
      xray: { inbound: { settings: { clients: unknown[] } } };
    };

    expect(artifact.action).toBe('remove_inbound');
    expect(artifact.xray.inbound.settings.clients).toEqual([]);
    expect(artifact.clientPolicy).toMatchObject({
      clientEmail: 'acme-delete@example.com',
      operatorEnabled: false,
      enabled: false,
      runtimeDisabledByPolicy: true,
      guardrailReason: 'inbound_deleted'
    });
    expect(artifact.subscription.shareUris).toEqual([expect.objectContaining({ enabled: false })]);
    expect(artifact.runtimeCapabilities).toMatchObject({
      activeClientCount: 0,
      totalClientCount: 1
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
        monthlyResetDay: 9,
        currentUsedTrafficGb: 12.5,
        security: 'tls',
        sni: 'edge.example.com'
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'xray'
    }) as XrayArtifactFixture;
    const clientId = artifact.xray.inbound.settings.clients[0].id;

    expect(clientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(clientId).not.toBe('not-a-uuid');
    expect(artifact.clientPolicy).toMatchObject({
      monthlyResetDay: 9,
      manualUsedTrafficBytes: 12.5 * 1024 * 1024 * 1024
    });
    expect(artifact.subscription.shareUri).toContain(`vless://${clientId}@edge.example.com:443`);
  });

  it('compiles multi-client VLESS inbound artifacts with per-client policies and share URIs', () => {
    const artifact = buildRuntimeArtifact({
      task: createInboundTask({
        agentId: 'agent-hkg-01',
        customerName: 'Acme',
        customerNodeName: 'Acme Shared Inbound',
        serverAddress: 'edge.example.com',
        xrayProtocol: 'vless',
        listenPort: 443,
        security: 'tls',
        sni: 'edge.example.com',
        clients: [
          {
            clientIdentity: 'alice',
            clientCredential: 'alice-token',
            clientEmail: 'alice@example.com',
            trafficLimitGb: 100,
            monthlyResetDay: 5
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
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'xray'
    }) as XrayArtifactFixture & {
      clientPolicy: { clientEmail: string };
      clientPolicies: Array<{ clientEmail: string; trafficLimitBytes: number; monthlyResetDay: number; ipLimit: number }>;
      runtimeCapabilities: { multiClientInbound: boolean; totalClientCount: number; activeClientCount: number };
      subscription: { shareUri: string; shareUris: Array<{ clientEmail: string; shareUri: string }> };
    };

    expect(artifact.xray.inbound.settings.clients).toHaveLength(2);
    expect(artifact.xray.inbound.settings.clients.map((client) => client.id)).toEqual([
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/),
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/)
    ]);
    expect(artifact.clientPolicy.clientEmail).toBe('alice@example.com');
    expect(artifact.clientPolicies).toMatchObject([
      {
        clientEmail: 'alice@example.com',
        trafficLimitBytes: 100 * 1024 * 1024 * 1024,
        monthlyResetDay: 5
      },
      {
        clientEmail: 'bob@example.com',
        trafficLimitBytes: 200 * 1024 * 1024 * 1024,
        monthlyResetDay: 15,
        ipLimit: 2
      }
    ]);
    expect(artifact.subscription.shareUris).toHaveLength(2);
    expect(artifact.subscription.shareUris.map((item) => item.clientEmail)).toEqual(['alice@example.com', 'bob@example.com']);
    expect(artifact.runtimeCapabilities).toMatchObject({
      multiClientInbound: true,
      totalClientCount: 2,
      activeClientCount: 2
    });
  });

  it('adds Xray runtime diagnosis to compiled inbound artifacts without claiming Agent evidence', () => {
    const artifact = buildRuntimeArtifact({
      task: createInboundTask({
        agentId: 'agent-hkg-01',
        customerName: 'Acme',
        customerNodeName: 'Acme Shared Inbound',
        serverAddress: 'edge.example.com',
        xrayProtocol: 'vless',
        listenAddress: '0.0.0.0',
        listenPort: 443,
        security: 'tls',
        sni: 'edge.example.com',
        clients: [
          {
            clientIdentity: 'alice',
            clientCredential: 'alice-token',
            clientEmail: 'alice@example.com'
          },
          {
            clientIdentity: 'bob',
            clientCredential: 'bob-token',
            clientEmail: 'bob@example.com',
            quotaExceeded: true
          }
        ]
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'xray'
    }) as {
      runtimeDiagnosis: {
        state: string;
        reasons: string[];
        nextActions: string[];
        hasRuntimeEvidence: boolean;
        evidenceStage: string;
        plannedBindingStatus: string;
        plannedRuntimeServices: string[];
        plannedInbound: {
          agentId: string;
          listenAddress: string;
          listenPort: number;
          protocol: string;
          network: string;
          security: string;
          action: string;
        };
        clientCounters: {
          total: number;
          active: number;
          disabled: number;
          quotaExceeded: number;
          runtimeDisabledByPolicy: number;
        };
      };
    };

    expect(artifact.runtimeDiagnosis).toMatchObject({
      state: 'degraded',
      hasRuntimeEvidence: false,
      evidenceStage: 'control-plane-compiled',
      plannedBindingStatus: 'deploying',
      plannedRuntimeServices: ['ou-ui-xray.service'],
      plannedInbound: {
        agentId: 'agent-hkg-01',
        listenAddress: '0.0.0.0',
        listenPort: 443,
        protocol: 'vless',
        network: 'tcp',
        security: 'tls',
        action: 'upsert_inbound'
      },
      clientCounters: {
        total: 2,
        active: 1,
        disabled: 1,
        quotaExceeded: 1,
        runtimeDisabledByPolicy: 1
      }
    });
    expect(artifact.runtimeDiagnosis.reasons).toEqual(
      expect.arrayContaining(['deploying', 'quota-exceeded', 'runtime-disabled-by-policy', 'guardrail', 'multi-client', 'tls', 'xray-config-preflight'])
    );
    expect(artifact.runtimeDiagnosis.nextActions).toEqual(
      expect.arrayContaining(['apply', 'reset-quota', 'review-security', 'inspect-agent'])
    );
  });

  it('keeps shared Xray inbounds upsertable when only one client is operator-disabled', () => {
    const artifact = buildRuntimeArtifact({
      task: {
        ...createInboundTask({
          agentId: 'agent-hkg-01',
          customerName: 'Acme',
          customerNodeName: 'Acme Shared Inbound',
          serverAddress: 'edge.example.com',
          xrayProtocol: 'vless',
          listenPort: 443,
          security: 'tls',
          sni: 'edge.example.com',
          enabled: true,
          clients: [
            {
              clientIdentity: 'alice',
              clientCredential: 'alice-token',
              clientEmail: 'alice@example.com',
              enabled: false
            },
            {
              clientIdentity: 'bob',
              clientCredential: 'bob-token',
              clientEmail: 'bob@example.com',
              enabled: true
            }
          ]
        }),
        operation: 'inbound.update'
      },
      agentId: 'agent-hkg-01',
      moduleKind: 'xray'
    }) as XrayArtifactFixture & {
      action: string;
      clientPolicies: Array<{ clientEmail: string; enabled: boolean; operatorEnabled: boolean; clientId: string }>;
      runtimeCapabilities: { activeClientCount: number; totalClientCount: number };
    };

    expect(artifact.action).toBe('upsert_inbound');
    expect(artifact.runtimeCapabilities).toMatchObject({
      activeClientCount: 1,
      totalClientCount: 2
    });
    expect(artifact.clientPolicies).toMatchObject([
      {
        clientEmail: 'alice@example.com',
        enabled: false,
        operatorEnabled: false
      },
      {
        clientEmail: 'bob@example.com',
        enabled: true,
        operatorEnabled: true
      }
    ]);
    expect(artifact.xray.inbound.settings.clients).toEqual([
      expect.objectContaining({
        id: artifact.clientPolicies[1].clientId
      })
    ]);
  });

  it('excludes policy-disabled Xray clients from active settings while preserving quota and expiry evidence', () => {
    const artifact = buildRuntimeArtifact({
      task: createInboundTask({
        agentId: 'agent-hkg-01',
        customerName: 'Acme',
        customerNodeName: 'Acme Guarded Inbound',
        serverAddress: 'edge.example.com',
        xrayProtocol: 'vless',
        listenPort: 443,
        security: 'tls',
        sni: 'edge.example.com',
        clients: [
          {
            clientIdentity: 'alice-active',
            clientCredential: 'alice-token',
            clientEmail: 'alice@example.com',
            enabled: true
          },
          {
            clientIdentity: 'bob-quota-blocked',
            clientCredential: 'bob-token',
            clientEmail: 'bob@example.com',
            enabled: true,
            quotaExceeded: true
          },
          {
            clientIdentity: 'charlie-expired',
            clientCredential: 'charlie-token',
            clientEmail: 'charlie@example.com',
            enabled: true,
            clientExpired: true
          }
        ]
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'xray'
    }) as XrayArtifactFixture & {
      action: string;
      clientPolicies: Array<{
        clientId: string;
        clientEmail: string;
        operatorEnabled: boolean;
        enabled: boolean;
        quotaExceeded: boolean;
        clientExpired: boolean;
        runtimeDisabledByPolicy: boolean;
        guardrailReason?: string;
      }>;
      runtimeCapabilities: { activeClientCount: number; totalClientCount: number };
      subscription: { shareUris: Array<{ clientEmail: string; enabled: boolean; shareUri: string }> };
    };

    expect(artifact.action).toBe('upsert_inbound');
    expect(artifact.xray.inbound.settings.clients).toHaveLength(1);
    expect(artifact.xray.inbound.settings.clients[0].id).toBe(artifact.clientPolicies[0].clientId);
    expect(artifact.clientPolicies).toMatchObject([
      {
        clientEmail: 'alice@example.com',
        operatorEnabled: true,
        enabled: true,
        quotaExceeded: false,
        runtimeDisabledByPolicy: false
      },
      {
        clientEmail: 'bob@example.com',
        operatorEnabled: true,
        enabled: false,
        quotaExceeded: true,
        runtimeDisabledByPolicy: true,
        guardrailReason: 'xray_client_monthly_quota_exceeded'
      },
      {
        clientEmail: 'charlie@example.com',
        operatorEnabled: true,
        enabled: false,
        clientExpired: true,
        runtimeDisabledByPolicy: true,
        guardrailReason: 'xray_client_expired'
      }
    ]);
    expect(artifact.subscription.shareUris).toEqual([
      expect.objectContaining({ clientEmail: 'alice@example.com', enabled: true }),
      expect.objectContaining({ clientEmail: 'bob@example.com', enabled: false }),
      expect.objectContaining({ clientEmail: 'charlie@example.com', enabled: false })
    ]);
    expect(artifact.runtimeCapabilities).toMatchObject({
      activeClientCount: 1,
      totalClientCount: 3
    });
  });

  it('prefers explicit Xray client expiresAt values over relative remaining days', () => {
    const artifact = buildRuntimeArtifact({
      task: createInboundTask({
        agentId: 'agent-hkg-01',
        customerName: 'Acme',
        customerNodeName: 'Acme Explicit Expiry',
        serverAddress: 'edge.example.com',
        xrayProtocol: 'vless',
        listenPort: 443,
        security: 'tls',
        sni: 'edge.example.com',
        clients: [
          {
            clientIdentity: 'alice-expiry',
            clientCredential: 'alice-token',
            clientEmail: 'alice@example.com',
            remainingDays: 3,
            expiresAt: '2026-08-01T00:00:00.000Z'
          },
          {
            clientIdentity: 'bob-expiry',
            clientCredential: 'bob-token',
            clientEmail: 'bob@example.com',
            remainingDays: 4,
            expiresAt: '2026-09-15T12:30:00.000Z'
          }
        ]
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'xray'
    }) as {
      clientPolicies: Array<{ clientEmail: string; remainingDays: number; expiresAt: string }>;
    };

    expect(artifact.clientPolicies).toMatchObject([
      {
        clientEmail: 'alice@example.com',
        remainingDays: 3,
        expiresAt: '2026-08-01T00:00:00.000Z'
      },
      {
        clientEmail: 'bob@example.com',
        remainingDays: 4,
        expiresAt: '2026-09-15T12:30:00.000Z'
      }
    ]);
  });

  it('auto-allocates a high listen port when Xray inbound metadata omits listenPort', () => {
    const artifact = buildRuntimeArtifact({
      task: createInboundTask({
        agentId: 'agent-hkg-01',
        customerName: 'Acme',
        customerNodeName: 'Acme Auto Port',
        serverAddress: 'edge.example.com',
        xrayProtocol: 'vless',
        clientIdentity: 'acme-auto-port',
        clientCredential: 'manual-human-token',
        security: 'tls',
        sni: 'edge.example.com'
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'xray'
    }) as XrayArtifactFixture;

    expect(artifact.xray.inbound.port).toBeGreaterThanOrEqual(20_000);
    expect(artifact.xray.inbound.port).toBeLessThanOrEqual(60_999);
    expect(artifact.xray.inbound.port).not.toBe(443);
    expect(artifact.subscription.shareUri).toContain(`@edge.example.com:${artifact.xray.inbound.port}`);
  });

  it('builds removal artifacts for disabled customer-node updates so Agents remove live Xray inbounds', () => {
    const artifact = buildRuntimeArtifact({
      task: {
        ...createInboundTask({
          agentId: 'agent-hkg-01',
          customerName: 'Acme',
          customerNodeName: 'Acme Disabled',
          serverAddress: 'edge.example.com',
          xrayProtocol: 'vless',
          listenPort: 443,
          clientIdentity: 'acme-disabled',
          clientCredential: 'acme-disabled',
          security: 'tls',
          sni: 'edge.example.com',
          enabled: false
        }),
        operation: 'inbound.update'
      },
      agentId: 'agent-hkg-01',
      moduleKind: 'xray'
    }) as XrayArtifactFixture & { action: string };

    expect(artifact).toMatchObject({
      action: 'remove_inbound',
      clientPolicy: expect.objectContaining({
        enabled: false
      })
    });
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

  it('rejects active Reality artifacts without required key material', () => {
    expect(() =>
      buildRuntimeArtifact({
        task: createInboundTask({
          agentId: 'agent-hkg-01',
          customerName: 'Acme',
          customerNodeName: 'Acme Broken Reality',
          serverAddress: 'edge.example.com',
          xrayProtocol: 'vless',
          listenPort: 443,
          clientIdentity: 'acme-broken-reality',
          clientCredential: 'not-a-uuid',
          security: 'reality',
          streamNetwork: 'tcp'
        }),
        agentId: 'agent-hkg-01',
        moduleKind: 'xray'
      })
    ).toThrow('Active Xray Reality runtime requires metadata.sni, metadata.realityPublicKey, metadata.realityPrivateKey.');
  });

  it('allows disabled Reality updates to remove runtime state without key material', () => {
    const artifact = buildRuntimeArtifact({
      task: {
        ...createInboundTask({
          agentId: 'agent-hkg-01',
          customerName: 'Acme',
          customerNodeName: 'Acme Disabled Reality',
          serverAddress: 'edge.example.com',
          xrayProtocol: 'vless',
          listenPort: 443,
          clientIdentity: 'acme-disabled-reality',
          clientCredential: 'not-a-uuid',
          security: 'reality',
          streamNetwork: 'tcp',
          enabled: false
        }),
        operation: 'inbound.update'
      },
      agentId: 'agent-hkg-01',
      moduleKind: 'xray'
    }) as XrayArtifactFixture & { action: string };

    expect(artifact.action).toBe('remove_inbound');
    expect(artifact.xray.inbound.settings.clients).toEqual([]);
  });

  it('splits Reality server private key config from client subscription public key parameters', () => {
    const artifact = buildRuntimeArtifact({
      task: createInboundTask({
        agentId: 'agent-hkg-01',
        customerName: 'Acme',
        customerNodeName: 'Acme Reality',
        serverAddress: 'edge.example.com',
        xrayProtocol: 'vless',
        listenPort: 443,
        clientIdentity: 'acme-reality',
        clientCredential: 'not-a-uuid',
        security: 'reality',
        streamNetwork: 'grpc',
        sni: 'www.cloudflare.com',
        path: '/grpc-service',
        flow: 'xtls-rprx-vision',
        fingerprint: 'chrome',
        realityPublicKey: 'client-public-key',
        realityPrivateKey: 'server-private-key',
        realityTarget: 'www.cloudflare.com:443',
        realityShortId: 'abcd1234'
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'xray'
    }) as XrayArtifactFixture;

    expect(artifact.xray.inbound.streamSettings).toMatchObject({
      security: 'reality',
      network: 'grpc',
      realitySettings: {
        target: 'www.cloudflare.com:443',
        serverNames: ['www.cloudflare.com'],
        privateKey: 'server-private-key',
        shortIds: ['abcd1234']
      },
      grpcSettings: {
        serviceName: 'grpc-service'
      }
    });
    expect(artifact.xray.inbound.streamSettings.realitySettings).not.toHaveProperty('publicKey');
    expect(artifact.subscription.shareUri).toContain('security=reality');
    expect(artifact.subscription.shareUri).toContain('type=grpc');
    expect(artifact.subscription.shareUri).toContain('serviceName=grpc-service');
    expect(artifact.subscription.shareUri).toContain('pbk=client-public-key');
    expect(artifact.subscription.shareUri).toContain('fp=chrome');
    expect(artifact.subscription.shareUri).toContain('sid=abcd1234');
    expect(artifact.subscription.shareUri).toContain('flow=xtls-rprx-vision');
  });

  it('uses one normalized VLESS Reality credential and Reality material for runtime and share URI', () => {
    const artifact = buildRuntimeArtifact({
      task: createInboundTask({
        agentId: 'agent-hkg-01',
        customerName: 'Acme',
        customerNodeName: 'Acme Reality Default',
        serverAddress: 'edge.example.com',
        xrayProtocol: 'vless',
        listenPort: 443,
        clientIdentity: 'acme-human-label',
        clientCredential: 'not-a-uuid',
        security: 'reality',
        streamNetwork: 'tcp',
        sni: 'www.cloudflare.com',
        flow: 'xtls-rprx-vision',
        fingerprint: 'chrome',
        realityPublicKey: 'client-public-key',
        realityPrivateKey: 'server-private-key',
        realityTarget: 'www.cloudflare.com:443',
        realityShortId: 'abcd1234'
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'xray'
    }) as XrayArtifactFixture & {
      xray: {
        inbound: {
          settings: {
            clients: Array<{ id: string; flow?: string }>;
          };
          streamSettings: {
            security: string;
            network: string;
            sni?: string;
            realitySettings?: {
              target?: string;
              privateKey?: string;
              shortIds?: string[];
              serverNames?: string[];
            };
          };
        };
      };
    };
    const client = artifact.xray.inbound.settings.clients[0];
    const shareUri = new URL(artifact.subscription.shareUri);

    expect(artifact.subscription.shareUri).toContain(`vless://${client.id}@edge.example.com:443`);
    expect(client.flow).toBe('xtls-rprx-vision');
    expect(artifact.xray.inbound.streamSettings).toMatchObject({
      security: 'reality',
      network: 'tcp',
      sni: 'www.cloudflare.com',
      realitySettings: {
        target: 'www.cloudflare.com:443',
        privateKey: 'server-private-key',
        shortIds: ['abcd1234'],
        serverNames: ['www.cloudflare.com']
      }
    });
    expect(shareUri.searchParams.get('security')).toBe(artifact.xray.inbound.streamSettings.security);
    expect(shareUri.searchParams.get('type')).toBe(artifact.xray.inbound.streamSettings.network);
    expect(shareUri.searchParams.get('sni')).toBe(artifact.xray.inbound.streamSettings.sni);
    expect(shareUri.searchParams.get('pbk')).toBe('client-public-key');
    expect(shareUri.searchParams.get('sid')).toBe(artifact.xray.inbound.streamSettings.realitySettings?.shortIds?.[0]);
    expect(shareUri.searchParams.get('flow')).toBe(client.flow);
  });

  it('uses the same default gRPC service name in runtime config and share URIs', () => {
    const artifact = buildRuntimeArtifact({
      task: createInboundTask({
        agentId: 'agent-hkg-01',
        customerName: 'Acme',
        customerNodeName: 'Acme gRPC',
        serverAddress: 'edge.example.com',
        xrayProtocol: 'vless',
        listenPort: 443,
        clientIdentity: 'acme-grpc',
        clientCredential: 'not-a-uuid',
        security: 'tls',
        streamNetwork: 'grpc',
        sni: 'edge.example.com'
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'xray'
    }) as XrayArtifactFixture;

    expect(artifact.xray.inbound.streamSettings).toMatchObject({
      serviceName: 'ou-ui-next',
      grpcSettings: {
        serviceName: 'ou-ui-next'
      }
    });
    expect(artifact.subscription.shareUri).toContain('serviceName=ou-ui-next');
  });

  it('converts executable tunnel tasks into real port-forwarding artifacts for the Agent runtime', () => {
    const artifact = buildRuntimeArtifact({
      task: createTunnelTask({
        name: 'Customer A HTTPS tunnel',
        accountId: 'acct-customer-a',
        type: 'port-forward',
        entryAgentIds: ['agent-hkg-01'],
        exitAgentIds: ['agent-sin-02'],
        listenAddress: '0.0.0.0',
        listenPort: 2443,
        targetAddress: '172.20.8.10',
        targetPort: 9443,
        protocol: 'tcp+udp',
        quotaGb: 1024,
        monthlyResetDay: 15,
        currentUsedTrafficGb: 33.5,
        billingDirection: 'both',
        rateLimitMbps: 600
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'port-forwarding'
    });

    expect(artifact).toMatchObject({
      artifactVersion: 'ou-ui.runtime.port-forwarding.v1',
      moduleKind: 'port-forwarding',
      action: 'create_forward_rule',
      rule: {
        id: 'tunnel-customer-a',
        name: 'Customer A HTTPS tunnel',
        ownerName: 'acct-customer-a',
        tunnelId: 'tunnel-customer-a',
        protocol: 'tcp+udp',
        entryAgentIds: ['agent-hkg-01'],
        binding: {
          agentId: 'agent-hkg-01',
          listenAddress: '0.0.0.0',
          listenPort: 2443,
          targetAddress: '172.20.8.10',
          targetPort: 9443,
          protocol: 'tcp+udp',
          serviceName: 'ou-tunnel-tunnel-customer-a-agent-hkg-01'
        },
        limits: {
          quotaGb: 1024,
          monthlyResetDay: 15,
          manualUsedTrafficGb: 33.5,
          rateLimitMbps: 600,
          rateLimitMode: 'bi-directional',
          rateLimitDirection: 'both'
        },
        billing: {
          direction: 'both'
        },
        tunnel: {
          id: 'tunnel-customer-a',
          accountId: 'acct-customer-a',
          type: 'port-forward',
          entryAgentIds: ['agent-hkg-01'],
          exitAgentIds: ['agent-sin-02']
        }
      },
      servicePlan: {
        serviceName: 'ou-tunnel-tunnel-customer-a-agent-hkg-01',
        bind: '0.0.0.0:2443',
        upstream: '172.20.8.10:9443',
        transport: 'tcp+udp'
      },
      runtimeDiagnosis: {
        state: 'waiting',
        reasons: ['no-runtime-service', 'deploying'],
        nextActions: ['apply', 'inspect-agent'],
        hasRuntimeEvidence: false,
        evidenceStage: 'control-plane-compiled',
        plannedBindingStatus: 'deploying',
        plannedRuntimeServices: ['ou-tunnel-tunnel-customer-a-agent-hkg-01']
      }
    });
  });

  it('compiles explicit one-way forwarding rate limits into runtime artifacts', () => {
    const artifact = buildRuntimeArtifact({
      task: createForwardTask('forward.create', {
        name: 'Customer HTTPS Forward',
        ownerName: 'Customer A',
        listenAddress: '0.0.0.0',
        listenPort: 2443,
        targetAddress: '172.20.8.10',
        targetPort: 9443,
        protocol: 'tcp',
        entryNodeIds: ['agent-hkg-01'],
        billingDirection: 'ingress',
        rateLimitMbps: 600,
        rateLimitMode: 'one-way',
        rateLimitDirection: 'ingress'
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'port-forwarding'
    });

    expect(artifact).toMatchObject({
      artifactVersion: 'ou-ui.runtime.port-forwarding.v1',
      rule: {
        limits: {
          rateLimitMbps: 600,
          rateLimitMode: 'one-way',
          rateLimitDirection: 'ingress'
        },
        billing: {
          direction: 'ingress'
        }
      }
    });
  });

  it('marks forwarding controls that are still blocked by the Agent runtime', () => {
    const artifact = buildRuntimeArtifact({
      task: createForwardTask('forward.create', {
        name: 'Customer HTTPS Forward',
        ownerName: 'Customer A',
        listenAddress: '0.0.0.0',
        listenPort: 2443,
        targetAddress: '172.20.8.10',
        targetPort: 9443,
        protocol: 'tcp',
        entryNodeIds: ['agent-hkg-01'],
        ipRateLimitMbps: 80,
        maxConnections: 2048,
        maxConnectionsPerIp: 32,
        proxyProtocol: true
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'port-forwarding'
    }) as {
      runtimeCapabilities: { status: string; unsupportedControls: string[] };
      runtimeDiagnosis: {
        state: string;
        reasons: string[];
        blockedControls: string[];
        nextActions: string[];
        hasRuntimeEvidence: boolean;
        impactedBindingCount: number;
        evidenceStage: string;
        plannedBindingStatus: string;
        plannedRuntimeServices: string[];
      };
    };

    expect(artifact.runtimeCapabilities).toEqual(
      expect.objectContaining({
        status: 'blocked-by-agent-runtime',
        unsupportedControls: ['ipRateLimitMbps', 'maxConnections', 'maxConnectionsPerIp', 'proxyProtocol']
      })
    );
    expect(artifact.runtimeDiagnosis).toEqual({
      state: 'degraded',
      reasons: ['no-runtime-service', 'blocked-runtime-controls', 'deploying'],
      blockedControls: ['ipRateLimitMbps', 'maxConnections', 'maxConnectionsPerIp', 'proxyProtocol'],
      nextActions: ['apply', 'inspect-agent'],
      hasRuntimeEvidence: false,
      impactedBindingCount: 1,
      evidenceStage: 'control-plane-compiled',
      plannedBindingStatus: 'deploying',
      plannedRuntimeServices: ['ou-forward-forward-hkg-443-agent-hkg-01']
    });
  });

  it('preserves forwarding blocked-control diagnosis from task-safe metadata', () => {
    const artifact = buildRuntimeArtifact({
      task: createForwardTask('forward.apply', {
        name: 'Customer HTTPS Forward',
        ownerName: 'Customer A',
        listenAddress: '0.0.0.0',
        listenPort: 2443,
        targetAddress: '172.20.8.10',
        targetPort: 9443,
        protocol: 'tcp',
        entryNodeIds: ['agent-hkg-01'],
        ipRateLimitMbps: 0,
        maxConnections: 0,
        maxConnectionsPerIp: 0,
        proxyProtocol: false,
        blockedRuntimeControls: ['ipRateLimitMbps', 'proxyProtocol'],
        blockedRuntimeControlValues: {
          ipRateLimitMbps: 80,
          proxyProtocol: true
        }
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'port-forwarding'
    }) as {
      rule: {
        limits: {
          ipRateLimitMbps: number;
          maxConnections: number;
          maxConnectionsPerIp: number;
        };
        proxyProtocol: boolean;
      };
      runtimeCapabilities: { status: string; unsupportedControls: string[] };
      runtimeDiagnosis: {
        state: string;
        reasons: string[];
        blockedControls: string[];
      };
    };

    expect(artifact.rule.limits).toEqual(
      expect.objectContaining({
        ipRateLimitMbps: 0,
        maxConnections: 0,
        maxConnectionsPerIp: 0
      })
    );
    expect(artifact.rule.proxyProtocol).toBe(false);
    expect(artifact.runtimeCapabilities).toEqual(
      expect.objectContaining({
        status: 'blocked-by-agent-runtime',
        unsupportedControls: ['ipRateLimitMbps', 'proxyProtocol']
      })
    );
    expect(artifact.runtimeDiagnosis).toEqual(
      expect.objectContaining({
        state: 'degraded',
        reasons: ['no-runtime-service', 'blocked-runtime-controls', 'deploying'],
        blockedControls: ['ipRateLimitMbps', 'proxyProtocol']
      })
    );
  });

  it('auto-allocates a high listen port for forwarding runtime artifacts when metadata omits listenPort', () => {
    const artifact = buildRuntimeArtifact({
      task: createForwardTask('forward.create', {
        name: 'Customer Auto Port Forward',
        ownerName: 'Customer A',
        listenAddress: '0.0.0.0',
        targetAddress: '172.20.8.10',
        targetPort: 9443,
        protocol: 'tcp+udp',
        entryNodeIds: ['agent-hkg-01']
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'port-forwarding'
    }) as { rule: { binding: { listenPort: number } }; servicePlan: { bind: string } };

    expect(artifact.rule.binding.listenPort).toBeGreaterThanOrEqual(20_000);
    expect(artifact.rule.binding.listenPort).toBeLessThanOrEqual(60_999);
    expect(artifact.rule.binding.listenPort).not.toBe(0);
    expect(artifact.rule.binding.listenPort).not.toBe(443);
    expect(artifact.servicePlan.bind).toBe(`0.0.0.0:${artifact.rule.binding.listenPort}`);
  });

  it('builds disabled forwarding artifacts for pause tasks so Agents remove live bindings without deleting the rule', () => {
    const artifact = buildRuntimeArtifact({
      task: createForwardTask('forward.pause', {
        name: 'Customer HTTPS Forward',
        ownerName: 'Customer A',
        listenAddress: '0.0.0.0',
        listenPort: 2443,
        targetAddress: '172.20.8.10',
        targetPort: 9443,
        protocol: 'tcp+udp',
        entryNodeIds: ['agent-hkg-01'],
        strategy: 'round-robin',
        quotaGb: 1024,
        monthlyResetDay: 15,
        currentUsedTrafficGb: 33.5,
        billingDirection: 'both',
        rateLimitMbps: 600,
        rateLimitMode: 'bi-directional',
        rateLimitDirection: 'both',
        enabled: false
      }),
      agentId: 'agent-hkg-01',
      moduleKind: 'port-forwarding'
    });

    expect(artifact).toMatchObject({
      artifactVersion: 'ou-ui.runtime.port-forwarding.v1',
      moduleKind: 'port-forwarding',
      action: 'apply_forward_rule',
      rule: expect.objectContaining({
        enabled: false,
        binding: expect.objectContaining({
          agentId: 'agent-hkg-01',
          listenPort: 2443,
          targetPort: 9443
        })
      })
    });
  });
});
