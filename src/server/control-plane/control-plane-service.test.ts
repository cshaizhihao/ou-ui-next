import { AGENT_INSTALL_PROFILE } from '../../domain';
import { seedForwardRules, seedPermissionGrants } from '../../services/mock/mock-data';
import { createAgentCredentialTokenHash } from './agent-credentials';
import { createControlPlaneService } from './control-plane-service';
import { createInMemoryControlPlaneRepository } from './in-memory-control-plane-repository';

const context = {
  actor: 'admin',
  operatorGroupId: 'owner',
  resourceGroupId: 'group-premium',
  sourceIp: '203.0.113.10',
  userAgent: 'vitest-control-plane-service',
  requestId: 'req-service-forward-001',
  idempotencyKey: 'idem-service-forward-001',
  ifMatch: 'forward-forward-hkg-443-v1'
};

function createService() {
  const repository = createInMemoryControlPlaneRepository({
    forwardRules: seedForwardRules,
    permissionGrants: seedPermissionGrants
  });

  return {
    repository,
    service: createControlPlaneService({ repository })
  };
}

function createServiceWithOpsViewer() {
  const repository = createInMemoryControlPlaneRepository({
    forwardRules: seedForwardRules,
    permissionGrants: [
      ...seedPermissionGrants,
      {
        id: 'grant-ops-viewer-tunnel',
        subjectType: 'group',
        subjectId: 'ops-viewer',
        resourceType: 'tunnel-group',
        resourceId: 'group-premium',
        permissions: ['read', 'operate'],
        grantedBy: 'system:bootstrap',
        reason: 'viewer operations baseline',
        resourceVersion: 'permv-ops-viewer',
        createdAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z'
      }
    ]
  });

  return {
    repository,
    service: createControlPlaneService({ repository })
  };
}

describe('control-plane service', () => {
  it('redeems Agent install credentials into runtime credentials without storing raw tokens', async () => {
    const { repository, service } = createService();

    const command = await service.createAgentInstallCommand(
      {
        installProfile: [...AGENT_INSTALL_PROFILE],
        publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
      },
      {
        ...context,
        requestId: 'req-service-agent-install-command',
        idempotencyKey: 'idem-service-agent-install-command'
      }
    );
    const credentials = await repository.listAgentCredentials();

    expect(command.agentId).toMatch(/^agent-[a-f0-9]{12}$/);
    expect(credentials).toEqual([
      expect.objectContaining({
        agentId: command.agentId,
        purpose: 'install',
        status: 'active',
        tokenHash: createAgentCredentialTokenHash(command.installToken),
        metadata: expect.objectContaining({
          installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
        })
      })
    ]);
    expect(JSON.stringify(credentials)).not.toContain(command.installToken);
    await expect(service.resolveAgentToken(command.installToken)).resolves.toBeUndefined();

    const registration = await service.registerAgent(
      {
        agentId: command.agentId,
        requestId: 'req-service-agent-register',
        sessionId: 'sess-edge-custom-01',
        version: '0.1.0-test',
        platform: 'linux-x64',
        capabilities: [...AGENT_INSTALL_PROFILE]
      },
      command.installToken,
      {
        sourceIp: '198.51.100.20',
        userAgent: 'ou-agent-test'
      }
    );
    const beforeRuntimeExpiry = new Date(Date.parse(registration.expiresAt) - 1000).toISOString();

    expect(registration).toEqual(
      expect.objectContaining({
        agentId: command.agentId,
        agentToken: expect.stringMatching(/^oat_/),
        sessionId: 'sess-edge-custom-01'
      })
    );
    await expect(service.resolveAgentToken(registration.agentToken, beforeRuntimeExpiry)).resolves.toEqual({
      agentId: command.agentId,
      credentialId: registration.credentialId,
      sessionId: 'sess-edge-custom-01'
    });
    await expect(service.resolveAgentToken(command.installToken, beforeRuntimeExpiry)).resolves.toBeUndefined();
    await expect(service.resolveAgentToken(registration.agentToken, registration.expiresAt)).resolves.toBeUndefined();
    await expect(repository.listAgentCredentials()).resolves.toEqual([
      expect.objectContaining({
        agentId: command.agentId,
        purpose: 'runtime',
        status: 'expired',
        lastUsedAt: registration.expiresAt
      }),
      expect.objectContaining({
        agentId: command.agentId,
        purpose: 'install',
        status: 'revoked',
        revokedReason: 'agent.install_token_redeemed',
        replacedByCredentialId: registration.credentialId
      })
    ]);
    await expect(repository.listAgentCredentials()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ tokenHash: command.installToken })])
    );
    expect(JSON.stringify(await repository.listAgentCredentials())).not.toContain(registration.agentToken);
  });

  it('lists sanitized Agent credential summaries and revokes runtime credentials with audit', async () => {
    const { repository, service } = createService();
    const command = await service.createAgentInstallCommand(
      {
        installProfile: [...AGENT_INSTALL_PROFILE],
        publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
      },
      {
        ...context,
        requestId: 'req-service-agent-revoke-install',
        idempotencyKey: 'idem-service-agent-revoke-install'
      }
    );
    const registration = await service.registerAgent(
      {
        agentId: command.agentId,
        requestId: 'req-service-agent-revoke-register',
        sessionId: 'sess-edge-revoke-01'
      },
      command.installToken,
      {
        sourceIp: '198.51.100.30',
        userAgent: 'ou-agent-revoke-test'
      }
    );

    await expect(service.resolveAgentToken(registration.agentToken)).resolves.toEqual({
      agentId: command.agentId,
      credentialId: registration.credentialId,
      sessionId: 'sess-edge-revoke-01'
    });
    await expect(service.listAgentCredentials()).resolves.toEqual([
      expect.objectContaining({
        id: registration.credentialId,
        agentId: command.agentId,
        purpose: 'runtime',
        status: 'active',
        tokenPrefix: expect.stringMatching(/^oat_/)
      }),
      expect.objectContaining({
        agentId: command.agentId,
        purpose: 'install',
        status: 'revoked'
      })
    ]);
    expect(JSON.stringify(await service.listAgentCredentials())).not.toContain('tokenHash');

    const revoked = await service.revokeAgentCredential(
      registration.credentialId,
      {
        reason: 'operator initiated runtime credential rotation'
      },
      {
        ...context,
        requestId: 'req-service-agent-revoke-runtime',
        idempotencyKey: 'idem-service-agent-revoke-runtime'
      }
    );

    expect(revoked).toEqual(
      expect.objectContaining({
        id: registration.credentialId,
        status: 'revoked',
        revokedBy: 'admin',
        revokedReason: 'operator initiated runtime credential rotation'
      })
    );
    await expect(service.resolveAgentToken(registration.agentToken)).resolves.toBeUndefined();
    await expect(repository.listAuditLogs()).resolves.toEqual([
      expect.objectContaining({
        action: 'agent.credential.revoked',
        operation: 'agent.credential.revoke',
        requestId: 'req-service-agent-revoke-runtime',
        before: expect.objectContaining({
          status: 'active'
        }),
        after: expect.objectContaining({
          status: 'revoked'
        })
      })
    ]);
    expect(JSON.stringify(await repository.listAuditLogs())).not.toContain(registration.agentToken);
  });

  it('rotates active runtime Agent credentials and records audit evidence without raw token leakage', async () => {
    const { repository, service } = createService();
    const command = await service.createAgentInstallCommand(
      {
        installProfile: [...AGENT_INSTALL_PROFILE],
        publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
      },
      {
        ...context,
        requestId: 'req-service-agent-rotate-install',
        idempotencyKey: 'idem-service-agent-rotate-install'
      }
    );
    const registration = await service.registerAgent(
      {
        agentId: command.agentId,
        requestId: 'req-service-agent-rotate-register',
        sessionId: 'sess-edge-rotate-01'
      },
      command.installToken,
      {
        sourceIp: '198.51.100.40',
        userAgent: 'ou-agent-rotate-test'
      }
    );

    const rotated = await service.rotateAgentCredential(
      registration.credentialId,
      {
        reason: 'scheduled runtime credential rotation'
      },
      {
        ...context,
        requestId: 'req-service-agent-rotate-runtime',
        idempotencyKey: 'idem-service-agent-rotate-runtime'
      }
    );

    expect(rotated).toEqual(
      expect.objectContaining({
        agentId: command.agentId,
        agentToken: expect.stringMatching(/^oat_/),
        credentialId: expect.not.stringMatching(registration.credentialId),
        sessionId: 'sess-edge-rotate-01'
      })
    );
    expect(rotated.agentToken).not.toBe(registration.agentToken);
    await expect(service.resolveAgentToken(registration.agentToken)).resolves.toBeUndefined();
    await expect(service.resolveAgentToken(rotated.agentToken)).resolves.toEqual({
      agentId: command.agentId,
      credentialId: rotated.credentialId,
      sessionId: 'sess-edge-rotate-01'
    });
    await expect(repository.listAgentCredentials()).resolves.toEqual([
      expect.objectContaining({
        id: rotated.credentialId,
        purpose: 'runtime',
        status: 'active',
        tokenHash: createAgentCredentialTokenHash(rotated.agentToken),
        sessionId: 'sess-edge-rotate-01'
      }),
      expect.objectContaining({
        id: registration.credentialId,
        purpose: 'runtime',
        status: 'revoked',
        revokedReason: 'scheduled runtime credential rotation',
        replacedByCredentialId: rotated.credentialId
      }),
      expect.objectContaining({
        purpose: 'install',
        status: 'revoked'
      })
    ]);
    await expect(repository.listAuditLogs()).resolves.toEqual([
      expect.objectContaining({
        action: 'agent.credential.rotated',
        operation: 'agent.credential.rotate',
        requestId: 'req-service-agent-rotate-runtime',
        before: expect.objectContaining({
          id: registration.credentialId,
          status: 'active'
        }),
        after: expect.objectContaining({
          revokedCredential: expect.objectContaining({
            id: registration.credentialId,
            status: 'revoked'
          }),
          issuedCredential: expect.objectContaining({
            id: rotated.credentialId,
            status: 'active'
          })
        })
      })
    ]);
    expect(JSON.stringify(await repository.listAgentCredentials())).not.toContain(registration.agentToken);
    expect(JSON.stringify(await repository.listAuditLogs())).not.toContain(rotated.agentToken);
  });

  it('commits task, audit, idempotency record, and command outbox atomically', async () => {
    const { repository, service } = createService();

    const task = await service.createTask(
      {
        operation: 'forward.apply',
        targetId: 'forward-hkg-443',
        targetLabel: 'Port Forwarding Fabric',
        summary: 'Apply service forwarding policy'
      },
      context
    );

    await expect(repository.listTasks()).resolves.toEqual([expect.objectContaining({ id: task.id })]);
    await expect(repository.listCommandOutbox()).resolves.toEqual([
      expect.objectContaining({
        taskId: task.id,
        agentId: 'agent-hkg-01',
        status: 'pending'
      })
    ]);
    await expect(repository.listAuditLogs()).resolves.toEqual([
      expect.objectContaining({
        action: 'task.created',
        taskId: task.id,
        requestId: 'req-service-forward-001'
      })
    ]);
    await expect(repository.findIdempotencyRecord('admin:POST:/api/v1/tasks:idem-service-forward-001')).resolves.toEqual(
      expect.objectContaining({
        taskId: task.id,
        requestBodyHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
      })
    );
  });

  it('compiles runtime apply commands with artifact, preflight, and snapshot metadata', async () => {
    const { repository, service } = createService();
    const task = await service.createTask(
      {
        operation: 'forward.apply',
        targetId: 'forward-hkg-443',
        targetLabel: 'Port Forwarding Fabric',
        summary: 'Apply compiled forwarding policy'
      },
      {
        ...context,
        requestId: 'req-service-compiled-forward',
        idempotencyKey: 'idem-service-compiled-forward'
      }
    );
    const [outboxItem] = await repository.listCommandOutbox();

    expect(outboxItem.command).toMatchObject({
      type: 'apply',
      taskId: task.id,
      payload: {
        configRevision: `cfg-${task.id}`,
        moduleKind: 'port-forwarding',
        artifactUri: `ou-ui://artifacts/config-revisions/cfg-${task.id}.json`,
        checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        signature: expect.stringMatching(/^sig-v1:/),
        preflightPlanId: `preflight-${task.id}`,
        snapshotBeforeId: `snapshot-before-${task.targetId}`,
        applyMode: 'graceful_restart',
        dryRun: false,
        rollbackTaskId: null
      }
    });
    await expect(repository.listConfigRevisions()).resolves.toEqual([
      expect.objectContaining({
        id: `cfg-${task.id}`,
        taskId: task.id,
        targetId: task.targetId,
        moduleKind: 'port-forwarding',
        artifactUri: `ou-ui://artifacts/config-revisions/cfg-${task.id}.json`,
        checksum: outboxItem.command.type === 'apply' ? outboxItem.command.payload.checksum : '',
        signature: outboxItem.command.type === 'apply' ? outboxItem.command.payload.signature : '',
        preflightPlanId: `preflight-${task.id}`,
        snapshotBeforeId: `snapshot-before-${task.targetId}`,
        status: 'compiled'
      })
    ]);
    await expect(repository.listPreflightPlans()).resolves.toEqual([
      expect.objectContaining({
        id: `preflight-${task.id}`,
        taskId: task.id,
        configRevisionId: `cfg-${task.id}`,
        status: 'pending',
        checks: [
          expect.objectContaining({ id: 'schema', status: 'pending' }),
          expect.objectContaining({ id: 'port-conflict', status: 'pending' }),
          expect.objectContaining({ id: 'rollback-snapshot', status: 'pending' })
        ]
      })
    ]);
    await expect(repository.listRuntimeSnapshots()).resolves.toEqual([
      expect.objectContaining({
        id: `snapshot-before-${task.targetId}`,
        taskId: task.id,
        targetId: task.targetId,
        agentId: 'agent-hkg-01',
        moduleKind: 'port-forwarding',
        reason: 'pre_apply',
        status: 'captured'
      })
    ]);
  });

  it('dispatches managed host profile changes through the host-agent runtime module', async () => {
    const { repository, service } = createService();

    const task = await service.createTask(
      {
        operation: 'agent.update',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'edge-renamed-01',
        summary: 'Update managed host profile',
        metadata: {
          agentId: 'agent-hkg-01',
          hostName: 'edge-renamed-01',
          maxTrafficGb: 2048,
          monthlyTrafficGb: 512,
          trafficAccountingMode: 'egress',
          monthlyResetDay: 7,
          currentUsedTrafficGb: 256,
          expiresAt: '2026-12-31T23:59:59.000Z',
          pingTarget: 'www.cloudflare.com',
          pingIntervalSeconds: 30
        }
      },
      {
        ...context,
        requestId: 'req-service-agent-update',
        idempotencyKey: 'idem-service-agent-update',
        ifMatch: undefined
      }
    );

    const [outboxItem] = await repository.listCommandOutbox();

    expect(outboxItem).toMatchObject({
      taskId: task.id,
      agentId: 'agent-hkg-01',
      command: {
        type: 'apply',
        payload: expect.objectContaining({
          moduleKind: 'host-agent',
          configRevision: `cfg-${task.id}`
        })
      }
    });
    await expect(repository.listConfigRevisions()).resolves.toEqual([
      expect.objectContaining({
        taskId: task.id,
        agentId: 'agent-hkg-01',
        moduleKind: 'host-agent',
        artifact: expect.objectContaining({
          artifactVersion: 'ou-ui.runtime.host-agent.v1',
          action: 'update_host_profile',
          desiredState: 'managed',
          hostProfile: expect.objectContaining({
            agentId: 'agent-hkg-01',
            hostName: 'edge-renamed-01',
            maxTrafficGb: 2048,
            maxTrafficBytes: 2048 * 1024 * 1024 * 1024,
            monthlyTrafficGb: 512,
            monthlyTrafficLimitBytes: 512 * 1024 * 1024 * 1024,
            trafficPolicy: expect.objectContaining({
              accountingMode: 'egress',
              monthlyResetDay: 7,
              manualUsedTrafficGb: 256,
              manualUsedTrafficBytes: 256 * 1024 * 1024 * 1024
            }),
            expiresAt: '2026-12-31T23:59:59.000Z'
          }),
          probeConfig: expect.objectContaining({
            pingTarget: 'www.cloudflare.com',
            pingIntervalSeconds: 30,
            latencyGreenMaxMs: 100,
            latencyYellowMaxMs: 200
          }),
          telemetryPlan: expect.objectContaining({
            source: 'agent',
            sampleIntervalSeconds: 30,
            pingProbe: expect.objectContaining({
              target: 'www.cloudflare.com',
              intervalSeconds: 30,
              latencyGreenMaxMs: 100,
              latencyYellowMaxMs: 200
            }),
            trafficCounters: expect.objectContaining({
              accountingMode: 'egress',
              counterDirections: ['egress'],
              monthlyResetDay: 7,
              manualUsedTrafficBytes: 256 * 1024 * 1024 * 1024
            }),
            hardwareProbe: expect.objectContaining({
              enabled: true,
              fields: expect.arrayContaining(['cpu', 'memory', 'disk', 'network', 'kernel', 'virtualization'])
            })
          })
        })
      })
    ]);
  });

  it('dispatches customer node inbound changes to the selected Xray host Agent', async () => {
    const { repository, service } = createService();

    const task = await service.createTask(
      {
        operation: 'inbound.create',
        resourceType: 'inbound',
        targetId: 'customer-node-premium-01',
        targetLabel: 'Premium customer node',
        summary: 'Create customer Xray inbound',
        metadata: {
          nodeId: 'node-hkg-01',
          agentId: 'agent-sin-02',
          customerNodeName: 'Premium HK 01',
          customerName: 'Customer A',
          serverAddress: 'edge.example.com',
          xrayProtocol: 'vless',
          listenPort: 443,
          clientIdentity: 'customer-a-main',
          streamNetwork: 'ws',
          security: 'tls',
          sni: 'edge.example.com',
          path: '/customer-a',
          flow: 'xtls-rprx-vision',
          ipLimit: 3,
          trafficLimitGb: 500,
          remainingDays: 30,
          subscriptionRule: 'tag:premium-hkg'
        }
      },
      {
        ...context,
        requestId: 'req-service-inbound-create',
        idempotencyKey: 'idem-service-inbound-create',
        ifMatch: undefined
      }
    );

    const [outboxItem] = await repository.listCommandOutbox();

    expect(outboxItem).toMatchObject({
      taskId: task.id,
      agentId: 'agent-sin-02',
      command: {
        type: 'apply',
        agentId: 'agent-sin-02',
        payload: expect.objectContaining({
          moduleKind: 'xray',
          configRevision: `cfg-${task.id}`
        })
      }
    });
    await expect(repository.listConfigRevisions()).resolves.toEqual([
      expect.objectContaining({
        taskId: task.id,
        agentId: 'agent-sin-02',
        moduleKind: 'xray',
        artifact: expect.objectContaining({
          artifactVersion: 'ou-ui.runtime.xray-inbound.v1',
          operation: 'inbound.create',
          moduleKind: 'xray',
          action: 'upsert_inbound',
          customer: expect.objectContaining({
            name: 'Customer A',
            nodeName: 'Premium HK 01',
            subscriptionRule: 'tag:premium-hkg'
          }),
          clientPolicy: expect.objectContaining({
            clientIdentity: 'customer-a-main',
            ipLimit: 3,
            trafficLimitGb: 500,
            trafficLimitBytes: 500 * 1024 * 1024 * 1024
          }),
          xray: expect.objectContaining({
            inbound: expect.objectContaining({
              listen: '0.0.0.0',
              port: 443,
              protocol: 'vless',
              settings: expect.objectContaining({
                clients: [
                  expect.objectContaining({
                    email: 'customer-a-main@ou-ui.local',
                    flow: 'xtls-rprx-vision',
                    limitIp: 3
                  })
                ],
                decryption: 'none'
              }),
              streamSettings: expect.objectContaining({
                network: 'ws',
                security: 'tls',
                wsSettings: expect.objectContaining({
                  path: '/customer-a',
                  headers: {
                    Host: 'edge.example.com'
                  }
                })
              })
            })
          }),
          subscription: expect.objectContaining({
            serverAddress: 'edge.example.com',
            shareUri: expect.stringMatching(/^vless:\/\/.+@edge\.example\.com:443\?/),
            formats: ['plain', 'json', 'clash']
          })
        })
      })
    ]);
    await expect(repository.listRuntimeSnapshots()).resolves.toEqual([
      expect.objectContaining({
        taskId: task.id,
        agentId: 'agent-sin-02',
        moduleKind: 'xray'
      })
    ]);
  });

  it('fans out multi-host forwarding creation into one command per target Agent', async () => {
    const { repository, service } = createService();

    const task = await service.createTask(
      {
        operation: 'forward.create',
        resourceType: 'forward',
        targetId: 'forward-custom-2443',
        targetLabel: '多主机端口转发 2443',
        summary: '创建多主机端口转发',
        metadata: {
          name: 'custom forward',
          ownerName: 'Customer A',
          tunnelId: 'tunnel-relay-hkg',
          listenAddress: '0.0.0.0',
          listenPort: 2443,
          targetAddress: '172.20.8.10',
          targetPort: 9443,
          protocol: 'tcp+udp',
          entryNodeIds: ['agent-hkg-01', 'agent-sin-02'],
          strategy: 'round-robin',
          quotaGb: 1024,
          rateLimitMbps: 600,
          ipRateLimitMbps: 80,
          maxConnections: 2048,
          maxConnectionsPerIp: 32,
          proxyProtocol: true,
          billingDirection: 'both',
          tunnelMode: 'direct'
        }
      },
      {
        ...context,
        requestId: 'req-service-forward-create-multi-host',
        idempotencyKey: 'idem-service-forward-create-multi-host',
        ifMatch: undefined
      }
    );

    const outbox = await repository.listCommandOutbox();

    expect(outbox).toHaveLength(2);
    expect(outbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: task.id,
          agentId: 'agent-hkg-01',
          commandId: `cmd-${task.id}-agent-hkg-01`,
          command: expect.objectContaining({
            agentId: 'agent-hkg-01',
            type: 'apply',
            payload: expect.objectContaining({
              moduleKind: 'port-forwarding',
              configRevision: `cfg-${task.id}-agent-hkg-01`
            })
          })
        }),
        expect.objectContaining({
          taskId: task.id,
          agentId: 'agent-sin-02',
          commandId: `cmd-${task.id}-agent-sin-02`,
          command: expect.objectContaining({
            agentId: 'agent-sin-02',
            type: 'apply',
            payload: expect.objectContaining({
              moduleKind: 'port-forwarding',
              configRevision: `cfg-${task.id}-agent-sin-02`
            })
          })
        })
      ])
    );
    await expect(repository.listConfigRevisions()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `cfg-${task.id}-agent-hkg-01`,
          agentId: 'agent-hkg-01',
          moduleKind: 'port-forwarding',
          artifact: expect.objectContaining({
            artifactVersion: 'ou-ui.runtime.port-forwarding.v1',
            action: 'create_forward_rule',
            rule: expect.objectContaining({
              name: 'custom forward',
              ownerName: 'Customer A',
              tunnelId: 'tunnel-relay-hkg',
              protocol: 'tcp+udp',
              strategy: 'round-robin',
              tunnelMode: 'direct',
              entryAgentIds: ['agent-hkg-01', 'agent-sin-02'],
              binding: expect.objectContaining({
                agentId: 'agent-hkg-01',
                listenAddress: '0.0.0.0',
                listenPort: 2443,
                targetAddress: '172.20.8.10',
                targetPort: 9443
              }),
              limits: expect.objectContaining({
                quotaGb: 1024,
                rateLimitMbps: 600,
                ipRateLimitMbps: 80,
                maxConnections: 2048,
                maxConnectionsPerIp: 32
              }),
              billing: expect.objectContaining({
                direction: 'both'
              }),
              proxyProtocol: true
            }),
            servicePlan: expect.objectContaining({
              bind: '0.0.0.0:2443',
              upstream: '172.20.8.10:9443',
              transport: 'tcp+udp'
            })
          })
        }),
        expect.objectContaining({
          id: `cfg-${task.id}-agent-sin-02`,
          agentId: 'agent-sin-02',
          artifact: expect.objectContaining({
            rule: expect.objectContaining({
              binding: expect.objectContaining({
                agentId: 'agent-sin-02',
                listenPort: 2443,
                targetPort: 9443
              })
            })
          })
        })
      ])
    );

    await expect(
      service.leaseAgentCommands('agent-hkg-01', {
        requestId: 'req-agent-hkg-forward-create-poll',
        now: '2026-06-02T00:00:05.000Z'
      })
    ).resolves.toEqual([expect.objectContaining({ agentId: 'agent-hkg-01', taskId: task.id })]);
    await expect(
      service.leaseAgentCommands('agent-sin-02', {
        requestId: 'req-agent-sin-forward-create-poll',
        now: '2026-06-02T00:00:05.000Z'
      })
    ).resolves.toEqual([expect.objectContaining({ agentId: 'agent-sin-02', taskId: task.id })]);
  });

  it('keeps multi-host forwarding tasks running until every Agent command succeeds', async () => {
    const { repository, service } = createService();

    const task = await service.createTask(
      {
        operation: 'forward.create',
        resourceType: 'forward',
        targetId: 'forward-custom-2443',
        targetLabel: '多主机端口转发 2443',
        summary: '创建多主机端口转发',
        metadata: {
          listenPort: 2443,
          targetAddress: '172.20.8.10',
          targetPort: 9443,
          agentIds: ['agent-hkg-01', 'agent-sin-02']
        }
      },
      {
        ...context,
        requestId: 'req-service-forward-create-aggregate',
        idempotencyKey: 'idem-service-forward-create-aggregate',
        ifMatch: undefined
      }
    );
    const outbox = await repository.listCommandOutbox();
    const hkgCommand = outbox.find((item) => item.agentId === 'agent-hkg-01');
    const sinCommand = outbox.find((item) => item.agentId === 'agent-sin-02');

    expect(hkgCommand).toBeDefined();
    expect(sinCommand).toBeDefined();

    await service.receiveAgentEvent({
      type: 'ack',
      eventId: 'evt-forward-hkg-ack',
      commandId: hkgCommand!.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: hkgCommand!.seq + 1,
      sessionId: 'sess-agent-hkg-forward',
      observedAt: '2026-06-02T00:00:05.000Z',
      payload: {
        duplicate: false
      }
    });
    await service.receiveAgentEvent({
      type: 'ack',
      eventId: 'evt-forward-sin-ack',
      commandId: sinCommand!.commandId,
      taskId: task.id,
      agentId: 'agent-sin-02',
      seq: sinCommand!.seq + 1,
      sessionId: 'sess-agent-sin-forward',
      observedAt: '2026-06-02T00:00:06.000Z',
      payload: {
        duplicate: false
      }
    });

    await expect(
      service.receiveAgentEvent({
        type: 'result',
        eventId: 'evt-forward-hkg-result',
        commandId: hkgCommand!.commandId,
        taskId: task.id,
        agentId: 'agent-hkg-01',
        seq: hkgCommand!.seq + 2,
        sessionId: 'sess-agent-hkg-forward',
        observedAt: '2026-06-02T00:00:25.000Z',
        payload: {
          status: 'succeeded',
          appliedConfigRevision: hkgCommand!.command.type === 'apply' ? hkgCommand!.command.payload.configRevision : '',
          healthSummary: {
            runtime: 'healthy'
          }
        }
      })
    ).resolves.toMatchObject({
      id: task.id,
      status: 'running'
    });

    await expect(
      service.receiveAgentEvent({
        type: 'result',
        eventId: 'evt-forward-sin-result',
        commandId: sinCommand!.commandId,
        taskId: task.id,
        agentId: 'agent-sin-02',
        seq: sinCommand!.seq + 2,
        sessionId: 'sess-agent-sin-forward',
        observedAt: '2026-06-02T00:00:30.000Z',
        payload: {
          status: 'succeeded',
          appliedConfigRevision: sinCommand!.command.type === 'apply' ? sinCommand!.command.payload.configRevision : '',
          healthSummary: {
            runtime: 'healthy'
          }
        }
      })
    ).resolves.toMatchObject({
      id: task.id,
      status: 'succeeded',
      rollbackAvailable: true
    });
  });

  it('compiles reload and rollback tasks into matching Agent command types', async () => {
    const { repository, service } = createService();
    const reloadTask = await service.createTask(
      {
        operation: 'runtime.reload',
        resourceType: 'module',
        targetId: 'xray-runtime-hkg',
        targetLabel: 'Xray Runtime HKG',
        summary: 'Reload Xray runtime after config release'
      },
      {
        ...context,
        requestId: 'req-service-runtime-reload',
        idempotencyKey: 'idem-service-runtime-reload',
        ifMatch: undefined
      }
    );
    const rollbackTask = await service.createTask(
      {
        operation: 'agent.rollback',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A HKG Gateway',
        summary: 'Rollback Agent release after failed health check'
      },
      {
        ...context,
        requestId: 'req-service-agent-rollback',
        idempotencyKey: 'idem-service-agent-rollback',
        ifMatch: undefined
      }
    );
    const commandOutbox = await repository.listCommandOutbox();

    expect(commandOutbox).toEqual([
      expect.objectContaining({
        taskId: rollbackTask.id,
        command: expect.objectContaining({
          type: 'rollback',
          payload: expect.objectContaining({
            snapshotId: 'snapshot-before-agent-hkg-01',
            targetConfigRevision: `cfg-rollback-${rollbackTask.id}`,
            rollbackReason: rollbackTask.summary,
            rollbackMode: 'graceful_restart'
          })
        })
      }),
      expect.objectContaining({
        taskId: reloadTask.id,
        command: expect.objectContaining({
          type: 'reload',
          payload: expect.objectContaining({
            moduleKind: 'system',
            moduleId: 'xray-runtime-hkg',
            configRevision: `cfg-${reloadTask.id}`,
            reloadMode: 'graceful_restart'
          })
        })
      })
    ]);
  });

  it('replays idempotent task creation with the same body', async () => {
    const { repository, service } = createService();
    const input = {
      operation: 'forward.apply' as const,
      targetId: 'forward-hkg-443',
      targetLabel: 'Port Forwarding Fabric',
      summary: 'Apply service forwarding policy'
    };

    const firstTask = await service.createTask(input, context);
    const replayedTask = await service.createTask(input, context);

    await expect(repository.listTasks()).resolves.toHaveLength(1);
    await expect(repository.listAuditLogs()).resolves.toHaveLength(1);
    expect(replayedTask).toEqual(firstTask);
  });

  it('rejects idempotency body conflicts and writes denied audit without creating a task', async () => {
    const { repository, service } = createService();

    await service.createTask(
      {
        operation: 'forward.apply',
        targetId: 'forward-hkg-443',
        targetLabel: 'Port Forwarding Fabric',
        summary: 'Apply service forwarding policy'
      },
      context
    );

    await expect(
      service.createTask(
        {
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Apply conflicting service forwarding policy'
        },
        context
      )
    ).rejects.toThrow('idempotency.conflict');

    await expect(repository.listTasks()).resolves.toHaveLength(1);
    await expect(repository.listAuditLogs()).resolves.toEqual([
      expect.objectContaining({
        action: 'audit.denied',
        denialCode: 'idempotency.conflict'
      }),
      expect.objectContaining({
        action: 'task.created'
      })
    ]);
  });

  it('rejects stale resource versions before creating task and outbox entries', async () => {
    const { repository, service } = createService();

    await expect(
      service.createTask(
        {
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Apply stale service forwarding policy'
        },
        {
          ...context,
          requestId: 'req-service-forward-stale',
          idempotencyKey: 'idem-service-forward-stale',
          ifMatch: 'forward-version-stale'
        }
      )
    ).rejects.toThrow('resource_version.conflict');

    await expect(repository.listTasks()).resolves.toEqual([]);
    await expect(repository.listCommandOutbox()).resolves.toEqual([]);
    await expect(repository.listAuditLogs()).resolves.toEqual([
      expect.objectContaining({
        action: 'audit.denied',
        denialCode: 'resource_version.conflict',
        after: {
          currentResourceVersion: 'forward-forward-hkg-443-v1'
        }
      })
    ]);
  });

  it('deduplicates Agent events and lets ACK/result drive task state once', async () => {
    const { repository, service } = createService();
    const task = await service.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A HKG Gateway',
        summary: 'Deploy service Agent config'
      },
      {
        ...context,
        requestId: 'req-service-agent-task',
        idempotencyKey: 'idem-service-agent-task',
        ifMatch: undefined
      }
    );
    const [outboxItem] = await repository.listCommandOutbox();

    await expect(
      service.receiveAgentEvent({
        type: 'ack',
        eventId: 'evt-service-agent-ack',
        commandId: outboxItem.commandId,
        taskId: task.id,
        agentId: 'agent-hkg-01',
        seq: outboxItem.seq + 1,
        sessionId: 'sess-agent-hkg-01',
        observedAt: '2026-06-02T00:00:05.000Z',
        payload: {
          duplicate: false
        }
      })
    ).resolves.toMatchObject({
      id: task.id,
      status: 'running'
    });

    await expect(
      service.receiveAgentEvent({
        type: 'ack',
        eventId: 'evt-service-agent-ack',
        commandId: outboxItem.commandId,
        taskId: task.id,
        agentId: 'agent-hkg-01',
        seq: outboxItem.seq + 1,
        sessionId: 'sess-agent-hkg-01',
        observedAt: '2026-06-02T00:00:05.000Z',
        payload: {
          duplicate: true
        }
      })
    ).resolves.toMatchObject({
      id: task.id,
      status: 'running'
    });

    await expect(
      service.receiveAgentEvent({
        type: 'result',
        eventId: 'evt-service-agent-result',
        commandId: outboxItem.commandId,
        taskId: task.id,
        agentId: 'agent-hkg-01',
        seq: outboxItem.seq + 2,
        sessionId: 'sess-agent-hkg-01',
        observedAt: '2026-06-02T00:00:25.000Z',
        payload: {
          status: 'succeeded',
          appliedConfigRevision: outboxItem.command.type === 'apply' ? outboxItem.command.payload.configRevision : '',
          healthSummary: {
            runtime: 'healthy'
          }
        }
      })
    ).resolves.toMatchObject({
      id: task.id,
      status: 'succeeded',
      rollbackAvailable: true
    });

    await expect(repository.listTasks()).resolves.toEqual([
      expect.objectContaining({
        id: task.id,
        status: 'succeeded',
        attempts: 1
      })
    ]);
    await expect(repository.listCommandOutbox()).resolves.toEqual([
      expect.objectContaining({
        status: 'completed',
        ackedAt: '2026-06-02T00:00:05.000Z',
        resultAt: '2026-06-02T00:00:25.000Z'
      })
    ]);
    await expect(repository.listAuditLogs()).resolves.toEqual([
      expect.objectContaining({ action: 'task.succeeded' }),
      expect.objectContaining({ action: 'task.running' }),
      expect.objectContaining({ action: 'task.created' })
    ]);
  });

  it('persists heartbeat events and updates Agent session liveness', async () => {
    const { repository, service } = createService();

    await expect(
      service.receiveAgentEvent({
        type: 'heartbeat',
        eventId: 'evt-service-heartbeat-001',
        agentId: 'agent-hkg-01',
        seq: 7,
        sessionId: 'sess-agent-hkg-01',
        observedAt: '2026-06-02T00:00:07.000Z',
        payload: {
          version: '1.0.0',
          uptimeSeconds: 120,
          capabilities: ['xray', 'port-forwarding'],
          lastSeenCommandSeq: 6
        }
      })
    ).resolves.toBeUndefined();

    await expect(repository.listAgentEvents()).resolves.toEqual([
      expect.objectContaining({
        eventId: 'evt-service-heartbeat-001',
        type: 'heartbeat',
        seq: 7,
        sessionId: 'sess-agent-hkg-01'
      })
    ]);
    await expect(repository.listAgentSessions()).resolves.toEqual([
      expect.objectContaining({
        agentId: 'agent-hkg-01',
        sessionId: 'sess-agent-hkg-01',
        status: 'online',
        lastSeq: 7,
        lastSeenCommandSeq: 6,
        lastHeartbeatAt: '2026-06-02T00:00:07.000Z',
        version: '1.0.0',
        capabilities: ['xray', 'port-forwarding']
      })
    ]);
  });

  it('rejects stale Agent events for the same session sequence window', async () => {
    const { repository, service } = createService();
    const task = await service.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A HKG Gateway',
        summary: 'Deploy monotonic Agent config'
      },
      {
        ...context,
        requestId: 'req-service-agent-monotonic',
        idempotencyKey: 'idem-service-agent-monotonic',
        ifMatch: undefined
      }
    );
    const [outboxItem] = await repository.listCommandOutbox();

    await service.receiveAgentEvent({
      type: 'ack',
      eventId: 'evt-service-agent-monotonic-ack',
      commandId: outboxItem.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: 10,
      sessionId: 'sess-agent-hkg-01',
      observedAt: '2026-06-02T00:00:10.000Z',
      payload: {}
    });

    await expect(
      service.receiveAgentEvent({
        type: 'result',
        eventId: 'evt-service-agent-monotonic-stale-result',
        commandId: outboxItem.commandId,
        taskId: task.id,
        agentId: 'agent-hkg-01',
        seq: 10,
        sessionId: 'sess-agent-hkg-01',
        observedAt: '2026-06-02T00:00:11.000Z',
        payload: {
          status: 'succeeded'
        }
      })
    ).rejects.toThrow('agent_event.sequence_replay');

    await expect(repository.listAgentEvents()).resolves.toHaveLength(1);
    await expect(repository.listAgentSessions()).resolves.toEqual([
      expect.objectContaining({
        agentId: 'agent-hkg-01',
        sessionId: 'sess-agent-hkg-01',
        lastSeq: 10
      })
    ]);
  });

  it('advances runtime release artifacts when apply commands succeed', async () => {
    const { repository, service } = createService();
    const task = await service.createTask(
      {
        operation: 'forward.apply',
        targetId: 'forward-hkg-443',
        targetLabel: 'Port Forwarding Fabric',
        summary: 'Apply runtime release and verify state'
      },
      {
        ...context,
        requestId: 'req-service-release-result',
        idempotencyKey: 'idem-service-release-result'
      }
    );
    const [outboxItem] = await repository.listCommandOutbox();

    await service.receiveAgentEvent({
      type: 'ack',
      eventId: 'evt-service-release-ack',
      commandId: outboxItem.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: outboxItem.seq + 1,
      sessionId: 'sess-agent-hkg-01',
      observedAt: '2026-06-02T00:00:05.000Z',
      payload: {}
    });

    await service.receiveAgentEvent({
      type: 'result',
      eventId: 'evt-service-release-result',
      commandId: outboxItem.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: outboxItem.seq + 2,
      sessionId: 'sess-agent-hkg-01',
      observedAt: '2026-06-02T00:00:25.000Z',
      payload: {
        status: 'succeeded',
        appliedConfigRevision: outboxItem.command.type === 'apply' ? outboxItem.command.payload.configRevision : '',
        healthSummary: {
          runtime: 'healthy',
          activeConfigRevision: outboxItem.command.type === 'apply' ? outboxItem.command.payload.configRevision : ''
        }
      }
    });

    await expect(repository.listConfigRevisions()).resolves.toEqual([
      expect.objectContaining({
        id: `cfg-${task.id}`,
        status: 'applied',
        appliedAt: '2026-06-02T00:00:25.000Z',
        healthSummary: {
          runtime: 'healthy',
          activeConfigRevision: `cfg-${task.id}`
        }
      })
    ]);
    await expect(repository.listPreflightPlans()).resolves.toEqual([
      expect.objectContaining({
        id: `preflight-${task.id}`,
        status: 'passed',
        checks: [
          expect.objectContaining({ id: 'schema', status: 'passed' }),
          expect.objectContaining({ id: 'port-conflict', status: 'passed' }),
          expect.objectContaining({ id: 'rollback-snapshot', status: 'passed' })
        ]
      })
    ]);
    await expect(repository.listRuntimeSnapshots()).resolves.toEqual([
      expect.objectContaining({
        id: 'snapshot-before-forward-hkg-443',
        status: 'verified',
        verifiedAt: '2026-06-02T00:00:25.000Z'
      })
    ]);
  });

  it('marks runtime release artifacts failed when apply commands fail', async () => {
    const { repository, service } = createService();
    const task = await service.createTask(
      {
        operation: 'forward.apply',
        targetId: 'forward-hkg-443',
        targetLabel: 'Port Forwarding Fabric',
        summary: 'Apply runtime release and fail health check'
      },
      {
        ...context,
        requestId: 'req-service-release-failed',
        idempotencyKey: 'idem-service-release-failed'
      }
    );
    const [outboxItem] = await repository.listCommandOutbox();

    await service.receiveAgentEvent({
      type: 'ack',
      eventId: 'evt-service-release-failed-ack',
      commandId: outboxItem.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: outboxItem.seq + 1,
      sessionId: 'sess-agent-hkg-01',
      observedAt: '2026-06-02T00:00:05.000Z',
      payload: {}
    });

    await service.receiveAgentEvent({
      type: 'result',
      eventId: 'evt-service-release-failed-result',
      commandId: outboxItem.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: outboxItem.seq + 2,
      sessionId: 'sess-agent-hkg-01',
      observedAt: '2026-06-02T00:00:25.000Z',
      payload: {
        status: 'failed',
        failureReason: 'preflight.port_conflict',
        retryable: false
      }
    });

    await expect(repository.listConfigRevisions()).resolves.toEqual([
      expect.objectContaining({
        id: `cfg-${task.id}`,
        status: 'failed',
        failedAt: '2026-06-02T00:00:25.000Z',
        failureReason: 'preflight.port_conflict'
      })
    ]);
    await expect(repository.listPreflightPlans()).resolves.toEqual([
      expect.objectContaining({
        id: `preflight-${task.id}`,
        status: 'failed'
      })
    ]);
  });

  it('marks referenced runtime snapshots restored when rollback commands succeed', async () => {
    const { repository, service } = createService();
    await service.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A HKG Gateway',
        summary: 'Create rollback snapshot for Agent release'
      },
      {
        ...context,
        requestId: 'req-service-rollback-source',
        idempotencyKey: 'idem-service-rollback-source',
        ifMatch: undefined
      }
    );
    const rollbackTask = await service.createTask(
      {
        operation: 'agent.rollback',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A HKG Gateway',
        summary: 'Restore Agent release snapshot'
      },
      {
        ...context,
        requestId: 'req-service-rollback-result',
        idempotencyKey: 'idem-service-rollback-result',
        ifMatch: undefined
      }
    );
    const [rollbackOutboxItem] = await repository.listCommandOutbox();

    await service.receiveAgentEvent({
      type: 'ack',
      eventId: 'evt-service-rollback-ack',
      commandId: rollbackOutboxItem.commandId,
      taskId: rollbackTask.id,
      agentId: 'agent-hkg-01',
      seq: rollbackOutboxItem.seq + 1,
      sessionId: 'sess-agent-hkg-01',
      observedAt: '2026-06-02T00:00:05.000Z',
      payload: {}
    });

    await service.receiveAgentEvent({
      type: 'result',
      eventId: 'evt-service-rollback-result',
      commandId: rollbackOutboxItem.commandId,
      taskId: rollbackTask.id,
      agentId: 'agent-hkg-01',
      seq: rollbackOutboxItem.seq + 2,
      sessionId: 'sess-agent-hkg-01',
      observedAt: '2026-06-02T00:00:25.000Z',
      payload: {
        status: 'rolled_back',
        healthSummary: {
          runtime: 'restored'
        }
      }
    });

    await expect(repository.listRuntimeSnapshots()).resolves.toEqual([
      expect.objectContaining({
        id: 'snapshot-before-agent-hkg-01',
        status: 'restored',
        restoredAt: '2026-06-02T00:00:25.000Z',
        restoredByTaskId: rollbackTask.id
      })
    ]);
  });

  it('leases Agent commands, suppresses in-flight duplicate polls, and retries expired leases', async () => {
    const { repository, service } = createService();
    const task = await service.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A HKG Gateway',
        summary: 'Deploy leased Agent config'
      },
      {
        ...context,
        requestId: 'req-service-lease-task',
        idempotencyKey: 'idem-service-lease-task',
        ifMatch: undefined
      }
    );

    await expect(
      service.leaseAgentCommands('agent-hkg-01', {
        requestId: 'req-agent-lease-001',
        now: '2026-06-02T00:00:05.000Z',
        leaseDurationMs: 30_000
      })
    ).resolves.toEqual([
      expect.objectContaining({
        taskId: task.id,
        status: 'dispatched',
        attempts: 1,
        leasedAt: '2026-06-02T00:00:05.000Z',
        leaseExpiresAt: '2026-06-02T00:00:35.000Z'
      })
    ]);

    await expect(
      service.leaseAgentCommands('agent-hkg-01', {
        requestId: 'req-agent-lease-duplicate',
        now: '2026-06-02T00:00:20.000Z',
        leaseDurationMs: 30_000
      })
    ).resolves.toEqual([]);

    await expect(
      service.leaseAgentCommands('agent-hkg-01', {
        requestId: 'req-agent-lease-retry',
        now: '2026-06-02T00:00:40.000Z',
        leaseDurationMs: 30_000
      })
    ).resolves.toEqual([
      expect.objectContaining({
        taskId: task.id,
        status: 'dispatched',
        attempts: 2,
        leasedAt: '2026-06-02T00:00:40.000Z',
        leaseExpiresAt: '2026-06-02T00:01:10.000Z'
      })
    ]);

    await expect(repository.listCommandOutbox()).resolves.toEqual([
      expect.objectContaining({
        taskId: task.id,
        status: 'dispatched',
        attempts: 2,
        leasedAt: '2026-06-02T00:00:40.000Z',
        leaseExpiresAt: '2026-06-02T00:01:10.000Z'
      })
    ]);
  });

  it('expires overdue Agent commands during polling and fails the related task with audit trail', async () => {
    const { repository, service } = createService();
    const task = await service.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A HKG Gateway',
        summary: 'Deploy Agent config that misses command deadline'
      },
      {
        ...context,
        requestId: 'req-service-deadline-task',
        idempotencyKey: 'idem-service-deadline-task',
        ifMatch: undefined
      }
    );

    await expect(
      service.leaseAgentCommands('agent-hkg-01', {
        requestId: 'req-agent-deadline-expiry',
        now: '2026-06-02T00:06:00.000Z',
        leaseDurationMs: 30_000
      })
    ).resolves.toEqual([]);

    await expect(repository.listCommandOutbox()).resolves.toEqual([
      expect.objectContaining({
        taskId: task.id,
        status: 'expired',
        updatedAt: '2026-06-02T00:06:00.000Z',
        lastError: 'command.deadline.expired'
      })
    ]);
    await expect(repository.listTasks()).resolves.toEqual([
      expect.objectContaining({
        id: task.id,
        status: 'failed',
        failureReason: 'command.deadline.expired',
        rollbackAvailable: false
      })
    ]);
    await expect(repository.listAuditLogs()).resolves.toEqual([
      expect.objectContaining({
        action: 'task.failed',
        taskId: task.id,
        after: expect.objectContaining({
          status: 'failed',
          failureReason: 'command.deadline.expired'
        })
      }),
      expect.objectContaining({ action: 'task.created' })
    ]);
  });

  it('rejects Agent results observed after command deadline and preserves failed deadline state', async () => {
    const { repository, service } = createService();
    const task = await service.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A HKG Gateway',
        summary: 'Reject stale Agent result after deadline'
      },
      {
        ...context,
        requestId: 'req-service-stale-result-task',
        idempotencyKey: 'idem-service-stale-result-task',
        ifMatch: undefined
      }
    );
    const [outboxItem] = await repository.listCommandOutbox();

    await expect(
      service.receiveAgentEvent({
        type: 'result',
        eventId: 'evt-service-stale-result',
        commandId: outboxItem.commandId,
        taskId: task.id,
        agentId: 'agent-hkg-01',
        seq: outboxItem.seq + 1,
        sessionId: 'sess-agent-hkg-deadline',
        observedAt: '2026-06-02T00:06:00.000Z',
        payload: {
          status: 'succeeded',
          healthSummary: {
            runtime: 'healthy'
          }
        }
      })
    ).rejects.toThrow('agent_event.command_deadline_expired');

    await expect(repository.listCommandOutbox()).resolves.toEqual([
      expect.objectContaining({
        taskId: task.id,
        status: 'expired',
        lastError: 'command.deadline.expired'
      })
    ]);
    await expect(repository.listTasks()).resolves.toEqual([
      expect.objectContaining({
        id: task.id,
        status: 'failed',
        failureReason: 'command.deadline.expired',
        rollbackAvailable: false
      })
    ]);
  });

  it('sweeps ACK timeouts into dead-letter state and fails the related task', async () => {
    const { repository, service } = createService();
    const task = await service.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A HKG Gateway',
        summary: 'Dead-letter deploy command without ACK'
      },
      {
        ...context,
        requestId: 'req-service-ack-timeout-task',
        idempotencyKey: 'idem-service-ack-timeout-task',
        ifMatch: undefined
      }
    );

    await service.leaseAgentCommands('agent-hkg-01', {
      requestId: 'req-agent-ack-timeout-lease',
      now: '2026-06-02T00:00:05.000Z',
      leaseDurationMs: 30_000
    });

    await expect(
      service.sweepCommandTimeouts({
        requestId: 'req-command-timeout-sweep-ack',
        now: '2026-06-02T00:00:16.000Z',
        ackTimeoutMs: 10_000,
        resultTimeoutMs: 60_000
      })
    ).resolves.toEqual({
      scanned: 1,
      expired: 0,
      deadLettered: 1,
      taskFailures: 1
    });

    await expect(repository.listCommandOutbox()).resolves.toEqual([
      expect.objectContaining({
        taskId: task.id,
        status: 'dead_letter',
        lastError: 'command.ack.timeout',
        updatedAt: '2026-06-02T00:00:16.000Z'
      })
    ]);
    await expect(repository.listTasks()).resolves.toEqual([
      expect.objectContaining({
        id: task.id,
        status: 'failed',
        failureReason: 'command.ack.timeout'
      })
    ]);
    await expect(repository.listAuditLogs()).resolves.toEqual([
      expect.objectContaining({
        action: 'task.failed',
        taskId: task.id,
        after: expect.objectContaining({
          failureReason: 'command.ack.timeout'
        })
      }),
      expect.objectContaining({ action: 'task.created' })
    ]);
  });

  it('sweeps result timeouts into dead-letter state after ACK without final result', async () => {
    const { repository, service } = createService();
    const task = await service.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A HKG Gateway',
        summary: 'Dead-letter deploy command without result'
      },
      {
        ...context,
        requestId: 'req-service-result-timeout-task',
        idempotencyKey: 'idem-service-result-timeout-task',
        ifMatch: undefined
      }
    );
    const [outboxItem] = await repository.listCommandOutbox();

    await service.receiveAgentEvent({
      type: 'ack',
      eventId: 'evt-service-result-timeout-ack',
      commandId: outboxItem.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: outboxItem.seq + 1,
      sessionId: 'sess-agent-hkg-result-timeout',
      observedAt: '2026-06-02T00:00:05.000Z',
      payload: {}
    });

    await expect(
      service.sweepCommandTimeouts({
        requestId: 'req-command-timeout-sweep-result',
        now: '2026-06-02T00:00:36.000Z',
        ackTimeoutMs: 10_000,
        resultTimeoutMs: 30_000
      })
    ).resolves.toEqual({
      scanned: 1,
      expired: 0,
      deadLettered: 1,
      taskFailures: 1
    });

    await expect(repository.listCommandOutbox()).resolves.toEqual([
      expect.objectContaining({
        taskId: task.id,
        status: 'dead_letter',
        ackedAt: '2026-06-02T00:00:05.000Z',
        lastError: 'command.result.timeout',
        updatedAt: '2026-06-02T00:00:36.000Z'
      })
    ]);
    await expect(repository.listTasks()).resolves.toEqual([
      expect.objectContaining({
        id: task.id,
        status: 'failed',
        failureReason: 'command.result.timeout'
      })
    ]);
  });

  it('binds leased commands to the polling Agent session and records poll progress', async () => {
    const { repository, service } = createService();
    const task = await service.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A HKG Gateway',
        summary: 'Deploy session-bound Agent config'
      },
      {
        ...context,
        requestId: 'req-service-session-lease-task',
        idempotencyKey: 'idem-service-session-lease-task',
        ifMatch: undefined
      }
    );
    const [pendingOutboxItem] = await repository.listCommandOutbox();

    await expect(
      service.leaseAgentCommands('agent-hkg-01', {
        requestId: 'req-agent-session-lease',
        sessionId: 'sess-agent-hkg-lease',
        lastSeenCommandSeq: pendingOutboxItem.seq - 1,
        now: '2026-06-02T00:00:12.000Z',
        leaseDurationMs: 30_000
      })
    ).resolves.toEqual([
      expect.objectContaining({
        taskId: task.id,
        status: 'dispatched',
        command: expect.objectContaining({
          sessionId: 'sess-agent-hkg-lease'
        })
      })
    ]);

    await expect(repository.listAgentSessions()).resolves.toEqual([
      expect.objectContaining({
        agentId: 'agent-hkg-01',
        sessionId: 'sess-agent-hkg-lease',
        status: 'online',
        lastSeq: 0,
        lastSeenCommandSeq: pendingOutboxItem.seq - 1,
        updatedAt: '2026-06-02T00:00:12.000Z'
      })
    ]);
  });

  it('enforces operation permission matrix before task creation', async () => {
    const { repository, service } = createServiceWithOpsViewer();

    await expect(
      service.createTask(
        {
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Apply RBAC protected forwarding policy'
        },
        {
          ...context,
          actor: 'operator:bob',
          operatorGroupId: 'ops-viewer',
          requestId: 'req-service-rbac-denied',
          idempotencyKey: 'idem-service-rbac-denied'
        }
      )
    ).rejects.toThrow('permission.denied');

    await expect(repository.listTasks()).resolves.toEqual([]);
    await expect(repository.listAuditLogs()).resolves.toEqual([
      expect.objectContaining({
        action: 'audit.denied',
        denialCode: 'permission.denied',
        before: {
          actorPermissions: ['operate', 'read']
        },
        after: expect.objectContaining({
          requiredPermission: 'configure'
        })
      })
    ]);

    await expect(
      service.createTask(
        {
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Apply admin forwarding policy'
        },
        {
          ...context,
          requestId: 'req-service-rbac-allowed',
          idempotencyKey: 'idem-service-rbac-allowed'
        }
      )
    ).resolves.toMatchObject({
      operation: 'forward.apply',
      status: 'queued'
    });
  });

  it('persists permission grants after authorized permission.grant tasks', async () => {
    const { repository, service } = createService();

    await expect(
      service.createTask(
        {
          operation: 'permission.grant',
          targetId: 'grant-ops-premium-operate',
          targetLabel: 'group:ops-hkg -> group-premium',
          summary: 'Grant operate permission to ops-hkg',
          permissionChange: {
            subjectType: 'group',
            subjectId: 'ops-hkg',
            resourceType: 'tunnel-group',
            resourceId: 'group-premium',
            permissions: ['read', 'operate'],
            reason: 'handoff premium tunnel operations'
          }
        },
        {
          ...context,
          requestId: 'req-service-permission-grant',
          idempotencyKey: 'idem-service-permission-grant',
          ifMatch: undefined
        }
      )
    ).resolves.toMatchObject({
      operation: 'permission.grant',
      status: 'queued'
    });

    await expect(repository.listPermissionGrants()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'grant-ops-premium-operate',
          subjectType: 'group',
          subjectId: 'ops-hkg',
          resourceId: 'group-premium',
          permissions: ['read', 'operate'],
          grantedBy: 'admin',
          reason: 'handoff premium tunnel operations'
        })
      ])
    );
  });

  it('revokes permission grants and removes them from future authorization decisions', async () => {
    const { repository, service } = createService();

    await service.createTask(
      {
        operation: 'permission.grant',
        targetId: 'grant-ops-premium-operate',
        targetLabel: 'group:ops-hkg -> group-premium',
        summary: 'Grant operate permission to ops-hkg',
        permissionChange: {
          subjectType: 'group',
          subjectId: 'ops-hkg',
          resourceType: 'tunnel-group',
          resourceId: 'group-premium',
          permissions: ['read', 'operate'],
          reason: 'handoff premium tunnel operations'
        }
      },
      {
        ...context,
        requestId: 'req-service-permission-grant-before-revoke',
        idempotencyKey: 'idem-service-permission-grant-before-revoke',
        ifMatch: undefined
      }
    );

    await expect(
      service.createTask(
        {
          operation: 'forward.pause',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Pause forwarding before permission revoke'
        },
        {
          ...context,
          actor: 'operator:bob',
          operatorGroupId: 'ops-hkg',
          requestId: 'req-service-ops-hkg-before-revoke',
          idempotencyKey: 'idem-service-ops-hkg-before-revoke',
          ifMatch: undefined
        }
      )
    ).resolves.toMatchObject({
      operation: 'forward.pause',
      status: 'queued'
    });

    await expect(
      service.createTask(
        {
          operation: 'permission.revoke',
          targetId: 'grant-ops-premium-operate',
          targetLabel: 'group:ops-hkg -> group-premium',
          summary: 'Revoke operate permission from ops-hkg',
          permissionChange: {
            subjectType: 'group',
            subjectId: 'ops-hkg',
            resourceType: 'tunnel-group',
            resourceId: 'group-premium',
            permissions: ['read', 'operate'],
            reason: 'ops-hkg offboarding'
          }
        },
        {
          ...context,
          requestId: 'req-service-permission-revoke',
          idempotencyKey: 'idem-service-permission-revoke',
          ifMatch: undefined
        }
      )
    ).resolves.toMatchObject({
      operation: 'permission.revoke',
      status: 'queued'
    });

    await expect(repository.listPermissionGrants()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'grant-ops-premium-operate',
          revokedAt: expect.any(String),
          revokedBy: 'admin',
          revokedReason: 'ops-hkg offboarding'
        })
      ])
    );

    await expect(
      service.createTask(
        {
          operation: 'forward.pause',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Pause forwarding after permission revoke'
        },
        {
          ...context,
          actor: 'operator:bob',
          operatorGroupId: 'ops-hkg',
          requestId: 'req-service-ops-hkg-after-revoke',
          idempotencyKey: 'idem-service-ops-hkg-after-revoke',
          ifMatch: undefined
        }
      )
    ).rejects.toThrow('permission.denied');
  });
});
