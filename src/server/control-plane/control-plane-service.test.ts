import { createHash } from 'node:crypto';
import { AGENT_INSTALL_PROFILE, type CreateTaskInput } from '../../domain';
import { seedForwardRules, seedPermissionGrants } from '../../services/mock/mock-data';
import { createControlPlaneTestClock } from '../../test/control-plane-clock';
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

const forwardApplyMetadata = {
  ownerName: 'Acme Team',
  listenAddress: '0.0.0.0',
  listenPort: 2443,
  targetAddress: '172.20.8.10',
  targetPort: 9443,
  entryNodeIds: ['agent-hkg-01'],
  protocol: 'tcp',
  billingDirection: 'both',
  monthlyResetDay: 15,
  currentUsedTrafficGb: 33.5
};

function withRiskConfirmation<T extends CreateTaskInput>(
  input: T
): T & { riskConfirmation: NonNullable<CreateTaskInput['riskConfirmation']> } {
  return {
    ...input,
    riskConfirmation: {
      operation: input.operation,
      targetId: input.targetId
    }
  };
}

function createService() {
  const repository = createInMemoryControlPlaneRepository({
    forwardRules: seedForwardRules,
    permissionGrants: seedPermissionGrants
  });

  return {
    repository,
    service: createControlPlaneService({ repository, now: createControlPlaneTestClock() })
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
    service: createControlPlaneService({ repository, now: createControlPlaneTestClock() })
  };
}

function createServiceWithoutPermissionGrants() {
  const repository = createInMemoryControlPlaneRepository({
    forwardRules: seedForwardRules,
    permissionGrants: []
  });

  return {
    repository,
    service: createControlPlaneService({ repository, now: createControlPlaneTestClock() })
  };
}

function isRepeatedSeedHash(hash: string) {
  const digest = hash.replace(/^sha256:/, '');
  return digest.length === 64 && digest.slice(0, 16).repeat(4) === digest;
}

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForHash(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeForHash(item)])
    );
  }

  return value;
}

function createExpectedArtifactChecksum(value: unknown) {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(normalizeForHash(value)) ?? 'null')
    .digest('hex')}`;
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
    await expect(repository.listAuditLogs()).resolves.toEqual([
      expect.objectContaining({
        action: 'agent.credential.issued',
        operation: 'agent.credential.issue',
        targetId: command.agentId,
        requestId: 'req-service-agent-install-command',
        requestBodyHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        after: expect.objectContaining({
          credential: expect.objectContaining({
            agentId: command.agentId,
            purpose: 'install',
            status: 'active'
          }),
          installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
        })
      })
    ]);
    expect(JSON.stringify(await repository.listAuditLogs())).not.toContain(command.installToken);

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
        lastUsedAt: registration.expiresAt,
        metadata: expect.objectContaining({
          installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel'],
          registrationVersion: '0.1.0-test',
          registrationPlatform: 'linux-x64',
          registrationCapabilities: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
        })
      }),
      expect.objectContaining({
        agentId: command.agentId,
        purpose: 'install',
        status: 'revoked',
        revokedReason: 'agent.install_token_redeemed',
        replacedByCredentialId: registration.credentialId
      })
    ]);
    await expect(repository.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'agent.credential.issued',
          operation: 'agent.credential.issue',
          actor: `agent:${command.agentId}`,
          targetId: command.agentId,
          requestId: 'req-service-agent-register',
          requestBodyHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          after: expect.objectContaining({
            credential: expect.objectContaining({
              id: registration.credentialId,
              agentId: command.agentId,
              purpose: 'runtime',
              status: 'active',
              tokenPrefix: expect.stringMatching(/^oat_/)
            }),
            installCredential: expect.objectContaining({
              agentId: command.agentId,
              purpose: 'install',
              status: 'revoked',
              replacedByCredentialId: registration.credentialId
            }),
            registration: {
              agentId: command.agentId,
              sessionId: 'sess-edge-custom-01',
              version: '0.1.0-test',
              platform: 'linux-x64',
              capabilities: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
            }
          })
        })
      ])
    );
    await expect(repository.listAgentCredentials()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ tokenHash: command.installToken })])
    );
    expect(JSON.stringify(await repository.listAgentCredentials())).not.toContain(registration.agentToken);
    expect(JSON.stringify(await repository.listAuditLogs())).not.toContain(command.installToken);
    expect(JSON.stringify(await repository.listAuditLogs())).not.toContain(registration.agentToken);
    expect(JSON.stringify(await repository.listAuditLogs())).not.toContain('tokenHash');
  });

  it('audits failed Agent runtime registration without leaking token material', async () => {
    const repository = createInMemoryControlPlaneRepository({
      forwardRules: seedForwardRules,
      permissionGrants: seedPermissionGrants
    });
    let now = '2026-06-02T00:00:00.000Z';
    const service = createControlPlaneService({ repository, now: () => now });
    const command = await service.createAgentInstallCommand(
      {
        installProfile: [...AGENT_INSTALL_PROFILE],
        publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
      },
      {
        ...context,
        requestId: 'req-service-agent-register-denied-install',
        idempotencyKey: 'idem-service-agent-register-denied-install'
      }
    );
    const registrationContext = {
      sourceIp: '198.51.100.30',
      userAgent: 'ou-agent-registration-denied-test'
    };
    const createRegistrationInput = (requestId: string, agentId = command.agentId) => ({
      agentId,
      requestId,
      sessionId: `sess-${requestId}`,
      version: '0.1.0-test',
      platform: 'linux-x64',
      capabilities: [...AGENT_INSTALL_PROFILE]
    });
    const invalidInstallToken = 'oit_invalid_registration_token_000000';

    await expect(
      service.registerAgent(
        createRegistrationInput('req-service-agent-register-missing-token'),
        '',
        registrationContext
      )
    ).rejects.toMatchObject({
      code: 'agent_registration.install_token_required'
    });
    await expect(
      service.registerAgent(
        createRegistrationInput('req-service-agent-register-invalid-token'),
        invalidInstallToken,
        registrationContext
      )
    ).rejects.toMatchObject({
      code: 'agent_registration.install_token_invalid'
    });
    await expect(
      service.registerAgent(
        createRegistrationInput('req-service-agent-register-agent-mismatch', 'agent-mismatched-registration'),
        command.installToken,
        registrationContext
      )
    ).rejects.toMatchObject({
      code: 'agent_registration.agent_mismatch'
    });

    now = new Date(Date.parse(command.expiresAt) + 1000).toISOString();

    await expect(
      service.registerAgent(
        createRegistrationInput('req-service-agent-register-expired-token'),
        command.installToken,
        registrationContext
      )
    ).rejects.toMatchObject({
      code: 'agent_registration.install_token_expired'
    });

    const auditLogs = await repository.listAuditLogs();
    const deniedLogs = auditLogs.filter((log) => log.action === 'audit.denied');

    expect(deniedLogs).toHaveLength(4);
    expect(deniedLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'audit.denied',
          operation: 'agent.credential.issue',
          targetId: command.agentId,
          requestId: 'req-service-agent-register-missing-token',
          denialCode: 'agent_registration.install_token_required',
          after: expect.objectContaining({
            installTokenPresented: false
          })
        }),
        expect.objectContaining({
          action: 'audit.denied',
          operation: 'agent.credential.issue',
          targetId: command.agentId,
          requestId: 'req-service-agent-register-invalid-token',
          denialCode: 'agent_registration.install_token_invalid',
          after: expect.objectContaining({
            installTokenPresented: true
          })
        }),
        expect.objectContaining({
          action: 'audit.denied',
          operation: 'agent.credential.issue',
          targetId: 'agent-mismatched-registration',
          requestId: 'req-service-agent-register-agent-mismatch',
          denialCode: 'agent_registration.agent_mismatch',
          before: {
            installCredential: expect.objectContaining({
              agentId: command.agentId,
              purpose: 'install',
              status: 'active'
            })
          }
        }),
        expect.objectContaining({
          action: 'audit.denied',
          operation: 'agent.credential.issue',
          targetId: command.agentId,
          requestId: 'req-service-agent-register-expired-token',
          denialCode: 'agent_registration.install_token_expired',
          before: {
            installCredential: expect.objectContaining({
              agentId: command.agentId,
              purpose: 'install',
              status: 'expired'
            })
          }
        })
      ])
    );
    await expect(repository.listAgentCredentials()).resolves.toEqual([
      expect.objectContaining({
        agentId: command.agentId,
        purpose: 'install',
        status: 'expired'
      })
    ]);

    const auditJson = JSON.stringify(auditLogs);
    expect(auditJson).not.toContain(command.installToken);
    expect(auditJson).not.toContain(invalidInstallToken);
    expect(auditJson).not.toContain(createAgentCredentialTokenHash(command.installToken));
    expect(auditJson).not.toContain('tokenHash');
    expect(auditJson).not.toContain('oat_');
  });

  it('requires explicit Agent configure permission before issuing install credentials', async () => {
    const repository = createInMemoryControlPlaneRepository({
      forwardRules: seedForwardRules,
      permissionGrants: [
        {
          id: 'grant-forwarding-only',
          subjectType: 'group',
          subjectId: 'ops-forwarding',
          resourceType: 'tunnel-group',
          resourceId: 'group-premium',
          permissions: ['read', 'operate', 'configure'],
          grantedBy: 'system:bootstrap',
          reason: 'forwarding-only operator baseline',
          resourceVersion: 'permv-forwarding-only',
          createdAt: '2026-06-02T00:00:00.000Z',
          updatedAt: '2026-06-02T00:00:00.000Z'
        }
      ]
    });
    const service = createControlPlaneService({ repository, now: createControlPlaneTestClock() });

    await expect(
      service.createAgentInstallCommand(
        {
          installProfile: [...AGENT_INSTALL_PROFILE],
          publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
        },
        {
          ...context,
          actor: 'operator:forwarding',
          operatorGroupId: 'ops-forwarding',
          requestId: 'req-service-agent-install-denied',
          idempotencyKey: 'idem-service-agent-install-denied'
        }
      )
    ).rejects.toMatchObject({
      code: 'permission.denied',
      details: {
        after: {
          requiredPermission: 'configure',
          resourceId: 'group-premium'
        }
      }
    });

    await expect(repository.listAgentCredentials()).resolves.toEqual([]);
    await expect(repository.listAuditLogs()).resolves.toEqual([
      expect.objectContaining({
        action: 'audit.denied',
        operation: 'agent.credential.issue',
        resourceType: 'agent',
        requestId: 'req-service-agent-install-denied',
        denialCode: 'permission.denied',
        before: {
          actorPermissions: []
        }
      })
    ]);
  });

  it('prevents idempotent Agent install command replays from issuing duplicate one-time credentials', async () => {
    const { repository, service } = createService();
    const input = {
      installProfile: [...AGENT_INSTALL_PROFILE],
      publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
    };
    const replayContext = {
      ...context,
      requestId: 'req-service-agent-install-idempotent',
      idempotencyKey: 'idem-service-agent-install-idempotent'
    };

    const command = await service.createAgentInstallCommand(input, replayContext);

    await expect(service.createAgentInstallCommand(input, replayContext)).rejects.toMatchObject({
      code: 'idempotency.replay_unavailable',
      details: expect.objectContaining({
        reason: expect.stringContaining('one-time secret')
      })
    });
    await expect(repository.listAgentCredentials()).resolves.toEqual([
      expect.objectContaining({
        agentId: command.agentId,
        purpose: 'install',
        status: 'active'
      })
    ]);

    await expect(
      service.createAgentInstallCommand(
        {
          ...input,
          publicBaseUrl: 'https://panel.example.com/anotherSecurePath'
        },
        replayContext
      )
    ).rejects.toMatchObject({
      code: 'idempotency.conflict'
    });
    await expect(repository.listAgentCredentials()).resolves.toHaveLength(1);
    await expect(repository.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'audit.denied',
          operation: 'agent.credential.issue',
          requestId: 'req-service-agent-install-idempotent',
          denialCode: 'idempotency.conflict'
        }),
        expect.objectContaining({
          action: 'agent.credential.issued',
          operation: 'agent.credential.issue',
          targetId: command.agentId
        })
      ])
    );
    expect(JSON.stringify(await repository.listAuditLogs())).not.toContain(command.installToken);
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
    await expect(repository.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
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
      ])
    );
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
    await expect(repository.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
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
      ])
    );
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
        summary: 'Apply service forwarding policy',
        metadata: forwardApplyMetadata
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
    const [auditLog] = await repository.listAuditLogs();
    expect(auditLog.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(isRepeatedSeedHash(auditLog.hash ?? '')).toBe(false);
  });

  it('compiles runtime apply commands with artifact, preflight, and snapshot metadata', async () => {
    const { repository, service } = createService();
    const task = await service.createTask(
      {
        operation: 'forward.apply',
        targetId: 'forward-hkg-443',
        targetLabel: 'Port Forwarding Fabric',
        summary: 'Apply compiled forwarding policy',
        metadata: forwardApplyMetadata
      },
      {
        ...context,
        requestId: 'req-service-compiled-forward',
        idempotencyKey: 'idem-service-compiled-forward'
      }
    );
    const [outboxItem] = await repository.listCommandOutbox();
    const configRevisionId = outboxItem.command.type === 'apply' ? outboxItem.command.payload.configRevision : '';
    const artifactUri = outboxItem.command.type === 'apply' ? outboxItem.command.payload.artifactUri : '';
    const preflightPlanId = outboxItem.command.type === 'apply' ? outboxItem.command.payload.preflightPlanId : '';
    const snapshotBeforeId = outboxItem.command.type === 'apply' ? outboxItem.command.payload.snapshotBeforeId : '';
    const artifact = outboxItem.command.type === 'apply' ? outboxItem.command.payload.artifact : undefined;
    const artifactChecksum = createExpectedArtifactChecksum(artifact);

    expect(outboxItem.command).toMatchObject({
      type: 'apply',
      taskId: task.id,
      payload: {
        configRevision: configRevisionId,
        moduleKind: 'port-forwarding',
        artifactUri,
        checksum: artifactChecksum,
        signature: `sig-v1:${artifactChecksum.replace('sha256:', '').slice(0, 32)}`,
        preflightPlanId,
        snapshotBeforeId,
        applyMode: 'graceful_restart',
        dryRun: false,
        rollbackTaskId: null
      }
    });
    await expect(repository.listConfigRevisions()).resolves.toEqual([
      expect.objectContaining({
        id: configRevisionId,
        taskId: task.id,
        targetId: task.targetId,
        moduleKind: 'port-forwarding',
        artifactUri,
        checksum: outboxItem.command.type === 'apply' ? outboxItem.command.payload.checksum : '',
        signature: outboxItem.command.type === 'apply' ? outboxItem.command.payload.signature : '',
        preflightPlanId,
        snapshotBeforeId,
        status: 'compiled'
      })
    ]);
    await expect(repository.listPreflightPlans()).resolves.toEqual([
      expect.objectContaining({
        id: preflightPlanId,
        taskId: task.id,
        configRevisionId,
        status: 'pending',
        checks: [
          expect.objectContaining({ id: 'artifact-integrity', status: 'pending' }),
          expect.objectContaining({ id: 'schema', status: 'pending' }),
          expect.objectContaining({ id: 'port-conflict', status: 'pending' }),
          expect.objectContaining({ id: 'runtime-availability', status: 'pending' }),
          expect.objectContaining({ id: 'result-verification', status: 'pending' }),
          expect.objectContaining({ id: 'rollback-snapshot', status: 'pending' })
        ]
      })
    ]);
    await expect(repository.listRuntimeSnapshots()).resolves.toEqual([
      expect.objectContaining({
        id: snapshotBeforeId,
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
            displayName: 'edge-renamed-01',
            hostName: 'agent-hkg-01',
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
                ipRateLimitMbps: 0,
                maxConnections: 0,
                maxConnectionsPerIp: 0
              }),
              billing: expect.objectContaining({
                direction: 'both'
              }),
              proxyProtocol: false
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

  it('creates Agent runtime commands for executable port-forwarding tunnel tasks', async () => {
    const { repository, service } = createService();

    const task = await service.createTask(
      {
        operation: 'tunnel.create',
        resourceType: 'tunnel',
        targetId: 'tunnel-customer-a',
        targetLabel: 'Customer A forwarding tunnel',
        summary: 'Create customer forwarding tunnel',
        metadata: {
          name: 'Customer A forwarding tunnel',
          accountId: 'acct-customer-a',
          type: 'port-forward',
          protocol: 'tcp+udp',
          entryAgentIds: ['agent-hkg-01'],
          exitAgentIds: ['agent-sin-02'],
          listenAddress: '0.0.0.0',
          listenPort: 2443,
          targetAddress: '172.20.8.10',
          targetPort: 9443,
          quotaGb: 1024,
          billingDirection: 'both'
        }
      },
      {
        ...context,
        requestId: 'req-service-tunnel-create',
        idempotencyKey: 'idem-service-tunnel-create',
        ifMatch: undefined
      }
    );

    await expect(repository.listCommandOutbox()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: task.id,
          agentId: 'agent-hkg-01',
          commandId: `cmd-${task.id}-agent-hkg-01`
        })
      ])
    );
    await expect(repository.listCommandOutbox()).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: task.id,
          agentId: 'agent-sin-02'
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
              name: 'Customer A forwarding tunnel',
              ownerName: 'acct-customer-a',
              binding: expect.objectContaining({
                listenPort: 2443,
                targetAddress: '172.20.8.10',
                targetPort: 9443
              }),
              tunnel: expect.objectContaining({
                type: 'port-forward',
                entryAgentIds: ['agent-hkg-01'],
                exitAgentIds: ['agent-sin-02']
              })
            }),
            servicePlan: expect.objectContaining({
              serviceName: 'ou-tunnel-tunnel-customer-a-agent-hkg-01',
              bind: '0.0.0.0:2443',
              upstream: '172.20.8.10:9443'
            })
          })
        })
      ])
    );
  });

  it('rejects runtime tasks that cannot resolve any target Agent', async () => {
    const { repository, service } = createService();

    await expect(
      service.createTask(
        {
          operation: 'config.apply',
          resourceType: 'module',
          targetId: 'runtime-missing-agent',
          targetLabel: 'Missing runtime target',
          summary: 'Apply runtime config without a target Agent'
        },
        {
          ...context,
          requestId: 'req-service-forward-missing-target',
          idempotencyKey: 'idem-service-forward-missing-target',
          ifMatch: undefined
        }
      )
    ).rejects.toMatchObject({
      code: 'agent_target.required'
    });

    await expect(repository.listTasks()).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetId: 'runtime-missing-agent'
        })
      ])
    );
    await expect(repository.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'audit.denied',
          denialCode: 'agent_target.required',
          targetId: 'runtime-missing-agent'
        })
      ])
    );
  });

  it('hydrates forwarding apply tasks from the persisted rule when runtime metadata is omitted', async () => {
    const { repository, service } = createService();

    const task = await service.createTask(
      {
        operation: 'forward.apply',
        resourceType: 'forward',
        targetId: 'forward-hkg-443',
        targetLabel: 'Port Forwarding Fabric',
        summary: 'Re-apply persisted forwarding rule'
      },
      {
        ...context,
        requestId: 'req-service-forward-apply-hydrated',
        idempotencyKey: 'idem-service-forward-apply-hydrated'
      }
    );
    const [outboxItem] = await repository.listCommandOutbox();

    expect(task.metadata).toMatchObject({
      listenAddress: '0.0.0.0',
      listenPort: 443,
      targetAddress: '10.12.0.8',
      targetPort: 8443,
      entryNodeIds: ['agent-hkg-01'],
      protocol: 'tcp+udp'
    });
    expect(outboxItem.command).toMatchObject({
      type: 'apply',
      payload: {
        moduleKind: 'port-forwarding',
        artifact: expect.objectContaining({
          rule: expect.objectContaining({
            binding: expect.objectContaining({
              listenPort: 443,
              targetAddress: '10.12.0.8',
              targetPort: 8443
            })
          })
        })
      }
    });
  });

  it('hydrates forwarding pause tasks from the persisted rule as disabled runtime metadata when metadata is omitted', async () => {
    const { repository, service } = createService();

    const task = await service.createTask(
      withRiskConfirmation({
        operation: 'forward.pause',
        resourceType: 'forward',
        targetId: 'forward-hkg-443',
        targetLabel: 'Port Forwarding Fabric',
        summary: 'Pause persisted forwarding rule'
      }),
      {
        ...context,
        requestId: 'req-service-forward-pause-hydrated',
        idempotencyKey: 'idem-service-forward-pause-hydrated'
      }
    );
    const [outboxItem] = await repository.listCommandOutbox();

    expect(task.metadata).toMatchObject({
      enabled: false,
      listenAddress: '0.0.0.0',
      listenPort: 443,
      targetAddress: '10.12.0.8',
      targetPort: 8443,
      entryNodeIds: ['agent-hkg-01'],
      protocol: 'tcp+udp'
    });
    expect(outboxItem.command).toMatchObject({
      type: 'apply',
      payload: {
        moduleKind: 'port-forwarding',
        artifact: expect.objectContaining({
          rule: expect.objectContaining({
            enabled: false,
            binding: expect.objectContaining({
              listenPort: 443,
              targetAddress: '10.12.0.8',
              targetPort: 8443
            })
          })
        })
      }
    });
  });

  it('hydrates forwarding resume tasks from the persisted rule as enabled runtime metadata when metadata is omitted', async () => {
    const { repository, service } = createService();

    const task = await service.createTask(
      withRiskConfirmation({
        operation: 'forward.resume',
        resourceType: 'forward',
        targetId: 'forward-hkg-443',
        targetLabel: 'Port Forwarding Fabric',
        summary: 'Resume persisted forwarding rule'
      }),
      {
        ...context,
        requestId: 'req-service-forward-resume-hydrated',
        idempotencyKey: 'idem-service-forward-resume-hydrated'
      }
    );
    const [outboxItem] = await repository.listCommandOutbox();

    expect(task.metadata).toMatchObject({
      enabled: true,
      listenAddress: '0.0.0.0',
      listenPort: 443,
      targetAddress: '10.12.0.8',
      targetPort: 8443,
      entryNodeIds: ['agent-hkg-01'],
      protocol: 'tcp+udp'
    });
    expect(outboxItem.command).toMatchObject({
      type: 'apply',
      payload: {
        moduleKind: 'port-forwarding',
        artifact: expect.objectContaining({
          rule: expect.objectContaining({
            enabled: true,
            binding: expect.objectContaining({
              listenPort: 443,
              targetAddress: '10.12.0.8',
              targetPort: 8443
            })
          })
        })
      }
    });
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
      rollbackAvailable: true,
      metadata: {
        runtimeDeployment: expect.objectContaining({
          source: 'agent-result',
          agentIds: ['agent-hkg-01', 'agent-sin-02'],
          commandIds: [hkgCommand!.commandId, sinCommand!.commandId]
        })
      }
    });
  });

  it('rejects Agent command events whose taskId does not match the command outbox item', async () => {
    const { repository, service } = createService();
    const commandTask = await service.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A HKG Gateway',
        summary: 'Deploy service Agent config'
      },
      {
        ...context,
        requestId: 'req-service-agent-command-binding-source',
        idempotencyKey: 'idem-service-agent-command-binding-source',
        ifMatch: undefined
      }
    );
    const wrongTask = await service.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-sin-02',
        targetLabel: 'Agent-B SIN Gateway',
        summary: 'Deploy unrelated service Agent config'
      },
      {
        ...context,
        requestId: 'req-service-agent-command-binding-wrong-task',
        idempotencyKey: 'idem-service-agent-command-binding-wrong-task',
        ifMatch: undefined
      }
    );
    const sourceCommand = (await repository.listCommandOutbox()).find((item) => item.taskId === commandTask.id);

    expect(sourceCommand).toBeDefined();

    await expect(
      service.receiveAgentEvent({
        type: 'result',
        eventId: 'evt-service-agent-command-task-mismatch',
        commandId: sourceCommand!.commandId,
        taskId: wrongTask.id,
        agentId: sourceCommand!.agentId,
        seq: sourceCommand!.seq + 1,
        sessionId: 'sess-agent-command-task-mismatch',
        observedAt: '2026-06-02T00:00:25.000Z',
        payload: {
          status: 'succeeded',
          appliedConfigRevision:
            sourceCommand!.command.type === 'apply' ? sourceCommand!.command.payload.configRevision : undefined,
          healthSummary: {
            runtime: 'healthy'
          }
        }
      })
    ).rejects.toMatchObject({
      code: 'agent_event.command_task_mismatch'
    });

    await expect(repository.listCommandOutbox()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          commandId: sourceCommand!.commandId,
          taskId: commandTask.id,
          status: 'pending'
        })
      ])
    );
    await expect(repository.listTasks()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: commandTask.id, status: 'queued' }),
        expect.objectContaining({ id: wrongTask.id, status: 'queued' })
      ])
    );
    await expect(repository.listAgentEvents()).resolves.toEqual([]);
  });

  it('compiles reload and rollback tasks into matching Agent command types', async () => {
    const { repository, service } = createService();
    const reloadTask = await service.createTask(
      withRiskConfirmation({
        operation: 'runtime.reload',
        resourceType: 'module',
        targetId: 'xray-runtime-hkg',
        targetLabel: 'Xray Runtime HKG',
        summary: 'Reload Xray runtime after config release',
        metadata: {
          agentId: 'agent-hkg-01'
        }
      }),
      {
        ...context,
        requestId: 'req-service-runtime-reload',
        idempotencyKey: 'idem-service-runtime-reload',
        ifMatch: undefined
      }
    );
    const rollbackTask = await service.createTask(
      withRiskConfirmation({
        operation: 'agent.rollback',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A HKG Gateway',
        summary: 'Rollback Agent release after failed health check'
      }),
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

  it('requires Agent results before command-backed runtime tasks can succeed', async () => {
    const { repository, service } = createService();
    const commandBackedInputs: CreateTaskInput[] = [
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A HKG Gateway',
        summary: 'Deploy host-agent runtime config'
      },
      {
        operation: 'inbound.create',
        resourceType: 'inbound',
        targetId: 'customer-node-result-gated-01',
        targetLabel: 'Result gated Xray inbound',
        summary: 'Create Xray inbound through Agent result',
        metadata: {
          agentId: 'agent-hkg-01',
          customerName: 'Result Gated Customer',
          customerNodeName: 'Result Gated HK 01',
          listenPort: 2443
        }
      },
      withRiskConfirmation({
        operation: 'runtime.reload',
        resourceType: 'module',
        targetId: 'xray-runtime-result-gated',
        targetLabel: 'Result gated Xray runtime',
        summary: 'Reload runtime through Agent result',
        metadata: {
          agentId: 'agent-hkg-01'
        }
      })
    ];

    for (const [index, input] of commandBackedInputs.entries()) {
      const requestSuffix = `${input.operation.replace(/\./g, '-')}-${index}`;
      const task = await service.createTask(input, {
        ...context,
        requestId: `req-service-result-gated-${requestSuffix}`,
        idempotencyKey: `idem-service-result-gated-${requestSuffix}`,
        ifMatch: undefined
      });

      await expect(
        service.transitionTask(task.id, 'running', {
          ...context,
          requestId: `req-service-result-gated-running-${requestSuffix}`,
          idempotencyKey: `idem-service-result-gated-running-${requestSuffix}`,
          ifMatch: undefined
        })
      ).resolves.toMatchObject({
        id: task.id,
        status: 'running'
      });
      await expect(
        service.transitionTask(task.id, 'succeeded', {
          ...context,
          requestId: `req-service-result-gated-success-${requestSuffix}`,
          idempotencyKey: `idem-service-result-gated-success-${requestSuffix}`,
          ifMatch: undefined
        })
      ).rejects.toMatchObject({
        code: 'agent_result.required',
        details: {
          operation: input.operation,
          taskId: task.id,
          targetId: input.targetId,
          denialReason: 'Runtime command success must be recorded from Agent result events.'
        }
      });
    }

    await expect(repository.listTasks()).resolves.toEqual(
      expect.arrayContaining(
        commandBackedInputs.map((input) =>
          expect.objectContaining({
            operation: input.operation,
            targetId: input.targetId,
            status: 'running'
          })
        )
      )
    );
  });

  it('replays idempotent task creation with the same body', async () => {
    const { repository, service } = createService();
    const input = {
      operation: 'forward.apply' as const,
      targetId: 'forward-hkg-443',
      targetLabel: 'Port Forwarding Fabric',
      summary: 'Apply service forwarding policy',
      metadata: forwardApplyMetadata
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
        summary: 'Apply service forwarding policy',
        metadata: forwardApplyMetadata
      },
      context
    );

    await expect(
      service.createTask(
        {
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Apply conflicting service forwarding policy',
          metadata: forwardApplyMetadata
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
          summary: 'Apply stale service forwarding policy',
          metadata: forwardApplyMetadata
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

  it('requires explicit matching confirmation before creating high-risk tasks', async () => {
    const { repository, service } = createService();
    const input: CreateTaskInput = {
      operation: 'agent.delete',
      resourceType: 'agent',
      targetId: 'agent-hkg-01',
      targetLabel: 'Agent-A HKG Gateway',
      summary: 'Remove managed host after offboarding'
    };

    await expect(
      service.createTask(input, {
        ...context,
        requestId: 'req-service-high-risk-missing',
        idempotencyKey: 'idem-service-high-risk-missing',
        ifMatch: undefined
      })
    ).rejects.toMatchObject({
      code: 'high_risk_confirmation.required',
      details: expect.objectContaining({
        denialReason: 'High-risk operations require explicit confirmation that matches the operation and target.',
        before: {
          operation: 'agent.delete',
          targetId: 'agent-hkg-01'
        }
      })
    });

    await expect(
      service.createTask(
        {
          ...input,
          riskConfirmation: {
            operation: 'agent.rollback',
            targetId: 'agent-hkg-01'
          }
        },
        {
          ...context,
          requestId: 'req-service-high-risk-operation-mismatch',
          idempotencyKey: 'idem-service-high-risk-operation-mismatch',
          ifMatch: undefined
        }
      )
    ).rejects.toMatchObject({
      code: 'high_risk_confirmation.required'
    });

    await expect(
      service.createTask(
        {
          ...input,
          riskConfirmation: {
            operation: 'agent.delete',
            targetId: 'agent-sin-02'
          }
        },
        {
          ...context,
          requestId: 'req-service-high-risk-target-mismatch',
          idempotencyKey: 'idem-service-high-risk-target-mismatch',
          ifMatch: undefined
        }
      )
    ).rejects.toMatchObject({
      code: 'high_risk_confirmation.required'
    });

    await expect(
      service.createTask(withRiskConfirmation(input), {
        ...context,
        requestId: 'req-service-high-risk-confirmed',
        idempotencyKey: 'idem-service-high-risk-confirmed',
        ifMatch: undefined
      })
    ).resolves.toMatchObject({
      operation: 'agent.delete',
      status: 'queued'
    });

    const auditLogs = await repository.listAuditLogs();
    expect(auditLogs.filter((log) => log.action === 'audit.denied')).toHaveLength(3);
    expect(auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'audit.denied',
          denialCode: 'high_risk_confirmation.required',
          operation: 'agent.delete',
          targetId: 'agent-hkg-01'
        }),
        expect.objectContaining({
          action: 'task.created',
          operation: 'agent.delete',
          targetId: 'agent-hkg-01'
        })
      ])
    );
    await expect(repository.listTasks()).resolves.toHaveLength(1);
  });

  it('revokes active Agent runtime credentials after a managed host delete result succeeds', async () => {
    const { repository, service } = createService();
    const command = await service.createAgentInstallCommand(
      {
        installProfile: [...AGENT_INSTALL_PROFILE],
        publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
      },
      {
        ...context,
        requestId: 'req-service-agent-delete-install-command',
        idempotencyKey: 'idem-service-agent-delete-install-command',
        ifMatch: undefined
      }
    );
    const registration = await service.registerAgent(
      {
        agentId: command.agentId,
        requestId: 'req-service-agent-delete-register',
        sessionId: 'sess-service-agent-delete-register',
        version: '1.2.3-agent',
        platform: 'linux-x64',
        capabilities: [...AGENT_INSTALL_PROFILE]
      },
      command.installToken,
      {
        sourceIp: '198.51.100.72',
        userAgent: 'ou-agent-delete-test'
      }
    );

    await expect(service.resolveAgentToken(registration.agentToken)).resolves.toEqual({
      agentId: command.agentId,
      credentialId: registration.credentialId,
      sessionId: 'sess-service-agent-delete-register'
    });

    const deleteTask = await service.createTask(
      withRiskConfirmation({
        operation: 'agent.delete',
        resourceType: 'agent',
        targetId: command.agentId,
        targetLabel: 'Registered Agent',
        summary: 'Remove registered managed host'
      }),
      {
        ...context,
        requestId: 'req-service-agent-delete-revokes-runtime',
        idempotencyKey: 'idem-service-agent-delete-revokes-runtime',
        ifMatch: undefined
      }
    );
    const [outboxItem] = await repository.listCommandOutbox();

    expect(deleteTask).toMatchObject({
      operation: 'agent.delete',
      status: 'queued'
    });
    await expect(service.resolveAgentToken(registration.agentToken)).resolves.toEqual({
      agentId: command.agentId,
      credentialId: registration.credentialId,
      sessionId: 'sess-service-agent-delete-register'
    });
    await expect(
      service.transitionTask(deleteTask.id, 'succeeded', {
        ...context,
        requestId: 'req-service-agent-delete-manual-success',
        idempotencyKey: 'idem-service-agent-delete-manual-success',
        ifMatch: undefined
      })
    ).rejects.toMatchObject({
      code: 'agent_result.required'
    });

    await service.receiveAgentEvent({
      type: 'ack',
      eventId: 'evt-service-agent-delete-ack',
      commandId: outboxItem.commandId,
      taskId: deleteTask.id,
      agentId: command.agentId,
      seq: outboxItem.seq + 1,
      sessionId: 'sess-service-agent-delete-register',
      observedAt: '2026-06-02T00:00:05.000Z',
      payload: {
        duplicate: false
      }
    });
    await service.receiveAgentEvent({
      type: 'result',
      eventId: 'evt-service-agent-delete-result',
      commandId: outboxItem.commandId,
      taskId: deleteTask.id,
      agentId: command.agentId,
      seq: outboxItem.seq + 2,
      sessionId: 'sess-service-agent-delete-register',
      observedAt: '2026-06-02T00:00:08.000Z',
      payload: {
        status: 'succeeded',
        appliedConfigRevision: outboxItem.command.type === 'apply' ? outboxItem.command.payload.configRevision : undefined
      }
    });

    await expect(service.resolveAgentToken(registration.agentToken)).resolves.toBeUndefined();
    await expect(repository.listAgentCredentials()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: registration.credentialId,
          agentId: command.agentId,
          purpose: 'runtime',
          status: 'revoked',
          revokedReason: 'agent.deleted'
        })
      ])
    );
    await expect(repository.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'task.created',
          operation: 'agent.delete',
          targetId: command.agentId
        }),
        expect.objectContaining({
          action: 'agent.credential.revoked',
          operation: 'agent.credential.revoke',
          targetId: command.agentId,
          after: expect.objectContaining({
            id: registration.credentialId,
            status: 'revoked',
            revokedReason: 'agent.deleted'
          })
        })
      ])
    );
  });

  it('does not synthesize a demo Agent command when a runtime task has no explicit host target', async () => {
    const { repository, service } = createService();

    await expect(
      service.createTask(
        {
          operation: 'system.tune',
          targetId: 'tuning-bbr-default',
          targetLabel: 'BBR tuning',
          summary: 'Apply tuning without selected managed host'
        },
        {
          ...context,
          requestId: 'req-service-system-tune-no-agent',
          idempotencyKey: 'idem-service-system-tune-no-agent',
          ifMatch: undefined
        }
      )
    ).rejects.toMatchObject({
      code: 'agent_target.required'
    });
    await expect(repository.listCommandOutbox()).resolves.toEqual([]);
    await expect(repository.listConfigRevisions()).resolves.toEqual([]);
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

  it('deduplicates Agent log chunks by command and chunk sequence even when event IDs differ', async () => {
    const { repository, service } = createService();
    const task = await service.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A HKG Gateway',
        summary: 'Deploy service Agent config with log chunks'
      },
      {
        ...context,
        requestId: 'req-service-agent-log-chunk-dedupe',
        idempotencyKey: 'idem-service-agent-log-chunk-dedupe',
        ifMatch: undefined
      }
    );
    const [outboxItem] = await repository.listCommandOutbox();

    await expect(
      service.receiveAgentEvent({
        type: 'log_chunk',
        eventId: 'evt-service-agent-log-chunk-first',
        commandId: outboxItem.commandId,
        taskId: task.id,
        agentId: 'agent-hkg-01',
        seq: outboxItem.seq + 1,
        sessionId: 'sess-agent-log-chunk-dedupe',
        observedAt: '2026-06-02T00:00:06.000Z',
        payload: {
          chunkSeq: 1,
          stream: 'stdout',
          content: 'first retained command output'
        }
      })
    ).resolves.toMatchObject({
      id: task.id
    });

    await expect(
      service.receiveAgentEvent({
        type: 'log_chunk',
        eventId: 'evt-service-agent-log-chunk-duplicate',
        commandId: outboxItem.commandId,
        taskId: task.id,
        agentId: 'agent-hkg-01',
        seq: outboxItem.seq + 2,
        sessionId: 'sess-agent-log-chunk-dedupe',
        observedAt: '2026-06-02T00:00:07.000Z',
        payload: {
          chunkSeq: 1,
          stream: 'stderr',
          content: 'duplicate command output must not be retained'
        }
      })
    ).resolves.toMatchObject({
      id: task.id
    });

    await expect(repository.listAgentEvents()).resolves.toEqual([
      expect.objectContaining({
        eventId: 'evt-service-agent-log-chunk-first',
        type: 'log_chunk',
        payload: expect.objectContaining({
          chunkSeq: 1,
          stream: 'stdout',
          content: 'first retained command output'
        })
      })
    ]);
  });

  it('ignores late ACK and result events after a command reaches a terminal state', async () => {
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
        requestId: 'req-service-agent-terminal-events',
        idempotencyKey: 'idem-service-agent-terminal-events',
        ifMatch: undefined
      }
    );
    const [outboxItem] = await repository.listCommandOutbox();

    await service.receiveAgentEvent({
      type: 'ack',
      eventId: 'evt-service-agent-terminal-ack',
      commandId: outboxItem.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: outboxItem.seq + 1,
      sessionId: 'sess-agent-terminal-events',
      observedAt: '2026-06-02T00:00:05.000Z',
      payload: {}
    });
    await service.receiveAgentEvent({
      type: 'result',
      eventId: 'evt-service-agent-terminal-result',
      commandId: outboxItem.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: outboxItem.seq + 2,
      sessionId: 'sess-agent-terminal-events',
      observedAt: '2026-06-02T00:00:25.000Z',
      payload: {
        status: 'succeeded',
        appliedConfigRevision: outboxItem.command.type === 'apply' ? outboxItem.command.payload.configRevision : undefined,
        healthSummary: {
          runtime: 'healthy'
        }
      }
    });

    await expect(
      service.receiveAgentEvent({
        type: 'ack',
        eventId: 'evt-service-agent-terminal-late-ack',
        commandId: outboxItem.commandId,
        taskId: task.id,
        agentId: 'agent-hkg-01',
        seq: outboxItem.seq + 3,
        sessionId: 'sess-agent-terminal-events',
        observedAt: '2026-06-02T00:00:35.000Z',
        payload: {
          duplicate: true
        }
      })
    ).resolves.toMatchObject({
      id: task.id,
      status: 'succeeded'
    });
    await expect(
      service.receiveAgentEvent({
        type: 'result',
        eventId: 'evt-service-agent-terminal-late-result',
        commandId: outboxItem.commandId,
        taskId: task.id,
        agentId: 'agent-hkg-01',
        seq: outboxItem.seq + 4,
        sessionId: 'sess-agent-terminal-events',
        observedAt: '2026-06-02T00:00:40.000Z',
        payload: {
          status: 'failed',
          failureReason: 'late agent retry reported stale failure',
          healthSummary: {
            runtime: 'command_failed'
          }
        }
      })
    ).resolves.toMatchObject({
      id: task.id,
      status: 'succeeded'
    });

    const [persistedTask] = await repository.listTasks();
    const [persistedOutboxItem] = await repository.listCommandOutbox();

    expect(persistedTask).toMatchObject({
      id: task.id,
      status: 'succeeded'
    });
    expect(persistedTask.failureReason).toBeUndefined();
    expect(persistedOutboxItem).toMatchObject({
      commandId: outboxItem.commandId,
      status: 'completed',
      ackedAt: '2026-06-02T00:00:05.000Z',
      resultAt: '2026-06-02T00:00:25.000Z'
    });
    expect(persistedOutboxItem.lastError).toBeUndefined();
    await expect(repository.listAgentEvents()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId: 'evt-service-agent-terminal-late-ack' }),
        expect.objectContaining({ eventId: 'evt-service-agent-terminal-late-result' })
      ])
    );
    expect((await repository.listAuditLogs()).filter((log) => log.action === 'task.failed')).toHaveLength(0);
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

  it('persists Agent telemetry traffic rollups without duplicating replayed events', async () => {
    const { repository, service } = createService();
    const telemetryEvent = {
      type: 'telemetry_sample' as const,
      eventId: 'evt-service-traffic-rollup-001',
      agentId: 'agent-hkg-01',
      seq: 8,
      sessionId: 'sess-agent-hkg-traffic',
      observedAt: '2026-06-02T00:00:08.000Z',
      payload: {
        trafficAccountingMode: 'ingress' as const,
        monthlyResetDay: 15,
        monthlyIngressBytes: 12_000,
        monthlyEgressBytes: 4_000,
        trafficBillingPeriod: '2026-06-reset-15',
        forwardingCounters: [
          {
            ruleId: 'forward-hkg-443',
            serviceName: 'ou-forward-forward-hkg-443-agent-hkg-01',
            inboundBytes: 2000,
            outboundBytes: 3000,
            sampledAt: '2026-06-02T00:00:08.000Z',
            source: 'nftables' as const,
            trafficBillingPeriod: '2026-06-reset-15'
          }
        ],
        xrayClientCounters: [
          {
            inboundId: 'inbound-hkg-vless',
            clientEmail: 'customer@example.com',
            uplinkBytes: 5000,
            downlinkBytes: 7000,
            usedTrafficBytes: 12_000,
            sampledAt: '2026-06-02T00:00:08.000Z',
            trafficBillingPeriod: '2026-06-reset-15',
            source: 'xray-stats' as const
          }
        ]
      }
    };

    await service.receiveAgentEvent(telemetryEvent);
    await service.receiveAgentEvent(telemetryEvent);

    await expect(repository.listTrafficRollups()).resolves.toEqual([
      expect.objectContaining({
        id: 'traffic-evt-service-traffic-rollup-001-xray-1',
        dimension: 'xray-client',
        subjectId: 'inbound-hkg-vless:customer@example.com',
        meteredBytes: 12_000
      }),
      expect.objectContaining({
        id: 'traffic-evt-service-traffic-rollup-001-forward-1',
        dimension: 'forward-rule',
        subjectId: 'forward-hkg-443',
        meteredBytes: 5000
      }),
      expect.objectContaining({
        id: 'traffic-evt-service-traffic-rollup-001-agent',
        dimension: 'agent',
        subjectId: 'agent-hkg-01',
        accountingMode: 'ingress',
        meteredBytes: 12_000
      })
    ]);
    await expect(repository.listAgentEvents()).resolves.toHaveLength(1);
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

  it('accepts multiple command results and heartbeat on one monotonic Agent event stream', async () => {
    const { repository, service } = createService();
    const firstTask = await service.createTask(
      {
        operation: 'agent.update',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A HKG Gateway',
        summary: 'Apply first host update'
      },
      {
        ...context,
        requestId: 'req-service-agent-stream-first',
        idempotencyKey: 'idem-service-agent-stream-first',
        ifMatch: undefined
      }
    );
    const secondTask = await service.createTask(
      {
        operation: 'agent.update',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A HKG Gateway',
        summary: 'Apply second host update'
      },
      {
        ...context,
        requestId: 'req-service-agent-stream-second',
        idempotencyKey: 'idem-service-agent-stream-second',
        ifMatch: undefined
      }
    );
    const streamOutbox = await repository.listCommandOutbox();
    const firstOutboxItem = streamOutbox.find((item) => item.taskId === firstTask.id);
    const secondOutboxItem = streamOutbox.find((item) => item.taskId === secondTask.id);

    expect(firstOutboxItem).toBeDefined();
    expect(secondOutboxItem).toBeDefined();

    await service.receiveAgentEvent({
      type: 'ack',
      eventId: 'evt-agent-stream-first-ack',
      commandId: firstOutboxItem!.commandId,
      taskId: firstTask.id,
      agentId: 'agent-hkg-01',
      seq: 101,
      sessionId: 'sess-agent-hkg-stream',
      observedAt: '2026-06-02T00:01:41.000Z',
      payload: {}
    });

    await service.receiveAgentEvent({
      type: 'result',
      eventId: 'evt-agent-stream-first-result',
      commandId: firstOutboxItem!.commandId,
      taskId: firstTask.id,
      agentId: 'agent-hkg-01',
      seq: 102,
      sessionId: 'sess-agent-hkg-stream',
      observedAt: '2026-06-02T00:01:42.000Z',
      payload: {
        status: 'succeeded'
      }
    });

    await service.receiveAgentEvent({
      type: 'ack',
      eventId: 'evt-agent-stream-second-ack',
      commandId: secondOutboxItem!.commandId,
      taskId: secondTask.id,
      agentId: 'agent-hkg-01',
      seq: 103,
      sessionId: 'sess-agent-hkg-stream',
      observedAt: '2026-06-02T00:01:43.000Z',
      payload: {}
    });

    await service.receiveAgentEvent({
      type: 'result',
      eventId: 'evt-agent-stream-second-result',
      commandId: secondOutboxItem!.commandId,
      taskId: secondTask.id,
      agentId: 'agent-hkg-01',
      seq: 104,
      sessionId: 'sess-agent-hkg-stream',
      observedAt: '2026-06-02T00:01:44.000Z',
      payload: {
        status: 'succeeded'
      }
    });

    await service.receiveAgentEvent({
      type: 'heartbeat',
      eventId: 'evt-agent-stream-heartbeat',
      agentId: 'agent-hkg-01',
      seq: 105,
      sessionId: 'sess-agent-hkg-stream',
      observedAt: '2026-06-02T00:01:45.000Z',
      payload: {
        version: '1.0.0',
        lastSeenCommandSeq: secondOutboxItem!.seq
      }
    });

    await expect(repository.listAgentSessions()).resolves.toEqual([
      expect.objectContaining({
        agentId: 'agent-hkg-01',
        sessionId: 'sess-agent-hkg-stream',
        lastSeq: 105,
        lastSeenCommandSeq: secondOutboxItem!.seq
      })
    ]);
    await expect(repository.listAgentEvents()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId: 'evt-agent-stream-first-result', seq: 102 }),
        expect.objectContaining({ eventId: 'evt-agent-stream-second-ack', seq: 103 }),
        expect.objectContaining({ eventId: 'evt-agent-stream-heartbeat', seq: 105 })
      ])
    );
  });

  it('advances runtime release artifacts when apply commands succeed', async () => {
    const { repository, service } = createService();
    const task = await service.createTask(
      {
        operation: 'forward.apply',
        targetId: 'forward-hkg-443',
        targetLabel: 'Port Forwarding Fabric',
        summary: 'Apply runtime release and verify state',
        metadata: forwardApplyMetadata
      },
      {
        ...context,
        requestId: 'req-service-release-result',
        idempotencyKey: 'idem-service-release-result'
      }
    );
    const [outboxItem] = await repository.listCommandOutbox();
    const configRevisionId = outboxItem.command.type === 'apply' ? outboxItem.command.payload.configRevision : '';
    const preflightPlanId = outboxItem.command.type === 'apply' ? outboxItem.command.payload.preflightPlanId : '';
    const snapshotBeforeId = outboxItem.command.type === 'apply' ? outboxItem.command.payload.snapshotBeforeId : '';

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
        id: configRevisionId,
        status: 'applied',
        appliedAt: '2026-06-02T00:00:25.000Z',
        healthSummary: {
          runtime: 'healthy',
          activeConfigRevision: configRevisionId
        }
      })
    ]);
    await expect(repository.listPreflightPlans()).resolves.toEqual([
      expect.objectContaining({
        id: preflightPlanId,
        status: 'passed',
        checks: [
          expect.objectContaining({ id: 'artifact-integrity', status: 'passed' }),
          expect.objectContaining({ id: 'schema', status: 'passed' }),
          expect.objectContaining({ id: 'port-conflict', status: 'passed' }),
          expect.objectContaining({ id: 'runtime-availability', status: 'passed' }),
          expect.objectContaining({ id: 'result-verification', status: 'passed' }),
          expect.objectContaining({ id: 'rollback-snapshot', status: 'passed' })
        ]
      })
    ]);
    await expect(repository.listRuntimeSnapshots()).resolves.toEqual([
      expect.objectContaining({
        id: snapshotBeforeId,
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
        summary: 'Apply runtime release and fail health check',
        metadata: forwardApplyMetadata
      },
      {
        ...context,
        requestId: 'req-service-release-failed',
        idempotencyKey: 'idem-service-release-failed'
      }
    );
    const [outboxItem] = await repository.listCommandOutbox();
    const configRevisionId = outboxItem.command.type === 'apply' ? outboxItem.command.payload.configRevision : '';
    const preflightPlanId = outboxItem.command.type === 'apply' ? outboxItem.command.payload.preflightPlanId : '';

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
        id: configRevisionId,
        status: 'failed',
        failedAt: '2026-06-02T00:00:25.000Z',
        failureReason: 'preflight.port_conflict'
      })
    ]);
    await expect(repository.listPreflightPlans()).resolves.toEqual([
      expect.objectContaining({
        id: preflightPlanId,
        status: 'failed',
        checks: [
          expect.objectContaining({ id: 'artifact-integrity', status: 'pending' }),
          expect.objectContaining({ id: 'schema', status: 'pending' }),
          expect.objectContaining({ id: 'port-conflict', status: 'failed' }),
          expect.objectContaining({ id: 'runtime-availability', status: 'pending' }),
          expect.objectContaining({ id: 'result-verification', status: 'pending' }),
          expect.objectContaining({ id: 'rollback-snapshot', status: 'pending' })
        ]
      })
    ]);
  });

  it('maps artifact integrity failures to the artifact preflight check and stores failed health summaries', async () => {
    const { repository, service } = createService();
    const task = await service.createTask(
      {
        operation: 'forward.apply',
        targetId: 'forward-hkg-443',
        targetLabel: 'Port Forwarding Fabric',
        summary: 'Apply runtime release with tamper detection',
        metadata: forwardApplyMetadata
      },
      {
        ...context,
        requestId: 'req-service-release-artifact-integrity-failed',
        idempotencyKey: 'idem-service-release-artifact-integrity-failed'
      }
    );
    const [outboxItem] = await repository.listCommandOutbox();
    const configRevisionId = outboxItem.command.type === 'apply' ? outboxItem.command.payload.configRevision : '';
    const preflightPlanId = outboxItem.command.type === 'apply' ? outboxItem.command.payload.preflightPlanId : '';

    await service.receiveAgentEvent({
      type: 'ack',
      eventId: 'evt-service-release-artifact-integrity-ack',
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
      eventId: 'evt-service-release-artifact-integrity-result',
      commandId: outboxItem.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: outboxItem.seq + 2,
      sessionId: 'sess-agent-hkg-01',
      observedAt: '2026-06-02T00:00:25.000Z',
      payload: {
        status: 'failed',
        failureReason: 'runtime artifact checksum mismatch: expected sha256:old, got sha256:new',
        retryable: false,
        healthSummary: {
          runtime: 'command_failed',
          commandType: 'apply',
          failureReason: 'runtime artifact checksum mismatch: expected sha256:old, got sha256:new'
        }
      }
    });

    await expect(repository.listConfigRevisions()).resolves.toEqual([
      expect.objectContaining({
        id: configRevisionId,
        status: 'failed',
        healthSummary: {
          runtime: 'command_failed',
          commandType: 'apply',
          failureReason: 'runtime artifact checksum mismatch: expected sha256:old, got sha256:new'
        }
      })
    ]);
    await expect(repository.listPreflightPlans()).resolves.toEqual([
      expect.objectContaining({
        id: preflightPlanId,
        status: 'failed',
        failureReason: 'runtime artifact checksum mismatch: expected sha256:old, got sha256:new',
        checks: [
          expect.objectContaining({ id: 'artifact-integrity', status: 'failed' }),
          expect.objectContaining({ id: 'schema', status: 'pending' }),
          expect.objectContaining({ id: 'port-conflict', status: 'pending' }),
          expect.objectContaining({ id: 'runtime-availability', status: 'pending' }),
          expect.objectContaining({ id: 'result-verification', status: 'pending' }),
          expect.objectContaining({ id: 'rollback-snapshot', status: 'pending' })
        ]
      })
    ]);
  });

  it('fails apply results that report a different applied config revision than the command', async () => {
    const { repository, service } = createService();
    const task = await service.createTask(
      {
        operation: 'forward.apply',
        targetId: 'forward-hkg-443',
        targetLabel: 'Port Forwarding Fabric',
        summary: 'Apply runtime release and verify applied revision',
        metadata: forwardApplyMetadata
      },
      {
        ...context,
        requestId: 'req-service-release-revision-mismatch',
        idempotencyKey: 'idem-service-release-revision-mismatch'
      }
    );
    const [outboxItem] = await repository.listCommandOutbox();
    const configRevisionId = outboxItem.command.type === 'apply' ? outboxItem.command.payload.configRevision : '';
    const preflightPlanId = outboxItem.command.type === 'apply' ? outboxItem.command.payload.preflightPlanId : '';

    await service.receiveAgentEvent({
      type: 'ack',
      eventId: 'evt-service-release-revision-mismatch-ack',
      commandId: outboxItem.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: outboxItem.seq + 1,
      sessionId: 'sess-agent-hkg-01',
      observedAt: '2026-06-02T00:00:05.000Z',
      payload: {}
    });

    const updatedTask = await service.receiveAgentEvent({
      type: 'result',
      eventId: 'evt-service-release-revision-mismatch-result',
      commandId: outboxItem.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: outboxItem.seq + 2,
      sessionId: 'sess-agent-hkg-01',
      observedAt: '2026-06-02T00:00:25.000Z',
      payload: {
        status: 'succeeded',
        appliedConfigRevision: 'cfg-unexpected-runtime',
        healthSummary: {
          runtime: 'running',
          activeConfigRevision: 'cfg-unexpected-runtime'
        }
      }
    });

    expect(updatedTask).toEqual(
      expect.objectContaining({
        id: task.id,
        status: 'failed',
        failureReason: expect.stringContaining('agent_result.config_revision_mismatch')
      })
    );
    await expect(repository.listCommandOutbox()).resolves.toEqual([
      expect.objectContaining({
        commandId: outboxItem.commandId,
        status: 'failed',
        lastError: expect.stringContaining('agent_result.config_revision_mismatch')
      })
    ]);
    await expect(repository.listConfigRevisions()).resolves.toEqual([
      expect.objectContaining({
        id: configRevisionId,
        status: 'failed',
        failureReason: expect.stringContaining('agent_result.config_revision_mismatch'),
        healthSummary: expect.objectContaining({
          runtime: 'command_failed',
          commandType: 'apply',
          expectedConfigRevision: configRevisionId,
          appliedConfigRevision: 'cfg-unexpected-runtime'
        })
      })
    ]);
    await expect(repository.listPreflightPlans()).resolves.toEqual([
      expect.objectContaining({
        id: preflightPlanId,
        status: 'failed',
        checks: [
          expect.objectContaining({ id: 'artifact-integrity', status: 'pending' }),
          expect.objectContaining({ id: 'schema', status: 'pending' }),
          expect.objectContaining({ id: 'port-conflict', status: 'pending' }),
          expect.objectContaining({ id: 'runtime-availability', status: 'pending' }),
          expect.objectContaining({ id: 'result-verification', status: 'failed' }),
          expect.objectContaining({ id: 'rollback-snapshot', status: 'pending' })
        ]
      })
    ]);
    await expect(repository.listAgentEvents()).resolves.toEqual([
      expect.objectContaining({
        eventId: 'evt-service-release-revision-mismatch-result',
        type: 'result',
        payload: expect.objectContaining({
          status: 'failed',
          failureReason: expect.stringContaining('agent_result.config_revision_mismatch')
        })
      }),
      expect.objectContaining({ eventId: 'evt-service-release-revision-mismatch-ack', type: 'ack' })
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
      withRiskConfirmation({
        operation: 'agent.rollback',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A HKG Gateway',
        summary: 'Restore Agent release snapshot'
      }),
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
        appliedConfigRevision:
          rollbackOutboxItem.command.type === 'rollback' ? rollbackOutboxItem.command.payload.targetConfigRevision : '',
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
    await expect(repository.listCommandOutbox()).resolves.toEqual([
      expect.objectContaining({
        commandId: rollbackOutboxItem.commandId,
        status: 'completed'
      }),
      expect.any(Object)
    ]);
    expect((await repository.listTasks()).find((item) => item.id === rollbackTask.id)).toEqual(
      expect.objectContaining({
        id: rollbackTask.id,
        status: 'succeeded'
      })
    );
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
        leaseOwnerId: 'agent-hkg-01',
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
        leaseOwnerId: 'agent-hkg-01',
        leasedAt: '2026-06-02T00:00:40.000Z',
        leaseExpiresAt: '2026-06-02T00:01:10.000Z'
      })
    ]);

    await expect(repository.listCommandOutbox()).resolves.toEqual([
      expect.objectContaining({
        taskId: task.id,
        status: 'dispatched',
        attempts: 2,
        leaseOwnerId: 'agent-hkg-01',
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

  it('rejects Agent ACKs observed after command deadline and writes a task failure audit', async () => {
    const { repository, service } = createService();
    const task = await service.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A HKG Gateway',
        summary: 'Reject stale Agent ACK after deadline'
      },
      {
        ...context,
        requestId: 'req-service-stale-ack-task',
        idempotencyKey: 'idem-service-stale-ack-task',
        ifMatch: undefined
      }
    );
    const [outboxItem] = await repository.listCommandOutbox();

    await expect(
      service.receiveAgentEvent({
        type: 'ack',
        eventId: 'evt-service-stale-ack',
        commandId: outboxItem.commandId,
        taskId: task.id,
        agentId: 'agent-hkg-01',
        seq: outboxItem.seq + 1,
        sessionId: 'sess-agent-hkg-deadline',
        observedAt: '2026-06-02T00:06:00.000Z',
        payload: {}
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
        leaseOwnerId: 'agent-credential-runtime-hkg-01',
        sessionId: 'sess-agent-hkg-lease',
        lastSeenCommandSeq: pendingOutboxItem.seq - 1,
        now: '2026-06-02T00:00:12.000Z',
        leaseDurationMs: 30_000
      })
    ).resolves.toEqual([
      expect.objectContaining({
        taskId: task.id,
        status: 'dispatched',
        leaseOwnerId: 'agent-credential-runtime-hkg-01',
        leaseSessionId: 'sess-agent-hkg-lease',
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
    await expect(repository.listCommandOutbox()).resolves.toEqual([
      expect.objectContaining({
        taskId: task.id,
        leaseOwnerId: 'agent-credential-runtime-hkg-01',
        leaseSessionId: 'sess-agent-hkg-lease',
        leasedAt: '2026-06-02T00:00:12.000Z'
      })
    ]);
  });

  it('replays an unacknowledged dispatched command when the polling session has not seen its seq', async () => {
    const { repository, service } = createService();
    const task = await service.createTask(
      {
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A HKG Gateway',
        summary: 'Replay unseen session command'
      },
      {
        ...context,
        requestId: 'req-service-session-replay-task',
        idempotencyKey: 'idem-service-session-replay-task',
        ifMatch: undefined
      }
    );
    const [pendingOutboxItem] = await repository.listCommandOutbox();

    await expect(
      service.leaseAgentCommands('agent-hkg-01', {
        requestId: 'req-agent-session-replay-first',
        sessionId: 'sess-agent-hkg-replay',
        lastSeenCommandSeq: pendingOutboxItem.seq - 1,
        now: '2026-06-02T00:00:05.000Z',
        leaseDurationMs: 30_000
      })
    ).resolves.toEqual([
      expect.objectContaining({
        taskId: task.id,
        status: 'dispatched',
        attempts: 1,
        leaseSessionId: 'sess-agent-hkg-replay',
        leasedAt: '2026-06-02T00:00:05.000Z',
        leaseExpiresAt: '2026-06-02T00:00:35.000Z'
      })
    ]);

    await expect(
      service.leaseAgentCommands('agent-hkg-01', {
        requestId: 'req-agent-session-replay-unseen',
        sessionId: 'sess-agent-hkg-replay',
        lastSeenCommandSeq: pendingOutboxItem.seq - 1,
        now: '2026-06-02T00:00:10.000Z',
        leaseDurationMs: 30_000
      })
    ).resolves.toEqual([
      expect.objectContaining({
        taskId: task.id,
        status: 'dispatched',
        attempts: 2,
        leaseSessionId: 'sess-agent-hkg-replay',
        leasedAt: '2026-06-02T00:00:10.000Z',
        leaseExpiresAt: '2026-06-02T00:00:40.000Z'
      })
    ]);

    await expect(
      service.leaseAgentCommands('agent-hkg-01', {
        requestId: 'req-agent-session-replay-seen',
        sessionId: 'sess-agent-hkg-replay',
        lastSeenCommandSeq: pendingOutboxItem.seq,
        now: '2026-06-02T00:00:15.000Z',
        leaseDurationMs: 30_000
      })
    ).resolves.toEqual([]);

    await service.receiveAgentEvent({
      type: 'ack',
      eventId: 'evt-service-session-replay-ack',
      commandId: pendingOutboxItem.commandId,
      taskId: task.id,
      agentId: 'agent-hkg-01',
      seq: pendingOutboxItem.seq + 1,
      sessionId: 'sess-agent-hkg-replay',
      observedAt: '2026-06-02T00:00:20.000Z',
      payload: {}
    });

    await expect(
      service.leaseAgentCommands('agent-hkg-01', {
        requestId: 'req-agent-session-replay-after-ack',
        sessionId: 'sess-agent-hkg-replay',
        lastSeenCommandSeq: pendingOutboxItem.seq - 1,
        now: '2026-06-02T00:00:25.000Z',
        leaseDurationMs: 30_000
      })
    ).resolves.toEqual([]);
  });

  it('enforces operation permission matrix before task creation', async () => {
    const { repository, service } = createServiceWithOpsViewer();

    await expect(
      service.createTask(
        {
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Apply RBAC protected forwarding policy',
          metadata: forwardApplyMetadata
        },
        {
          ...context,
          actor: 'operator:bob',
          operatorGroupId: 'ops-viewer',
          requestId: 'req-service-rbac-denied',
          idempotencyKey: 'idem-service-rbac-denied'
        }
      )
    ).rejects.toMatchObject({
      code: 'permission.denied',
      details: {
        before: {
          actorPermissions: ['operate', 'read']
        },
        after: {
          requiredPermission: 'configure',
          resourceId: 'group-premium'
        }
      }
    });

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
          summary: 'Apply admin forwarding policy',
          metadata: forwardApplyMetadata
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

  it('ignores expired permission grants during task authorization', async () => {
    const repository = createInMemoryControlPlaneRepository({
      forwardRules: seedForwardRules,
      permissionGrants: [
        {
          id: 'grant-expired-forward-configure',
          subjectType: 'group',
          subjectId: 'ops-expired',
          resourceType: 'tunnel-group',
          resourceId: 'group-premium',
          permissions: ['read', 'operate', 'configure'],
          expiresAt: '2026-06-01T23:59:59.000Z',
          grantedBy: 'system:bootstrap',
          reason: 'expired temporary forwarding access',
          resourceVersion: 'permv-expired-forward',
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z'
        }
      ]
    });
    const service = createControlPlaneService({ repository, now: createControlPlaneTestClock() });

    await expect(
      service.createTask(
        {
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Apply forwarding with expired grant',
          metadata: forwardApplyMetadata
        },
        {
          ...context,
          actor: 'operator:expired',
          operatorGroupId: 'ops-expired',
          requestId: 'req-service-rbac-expired-grant',
          idempotencyKey: 'idem-service-rbac-expired-grant',
          ifMatch: undefined
        }
      )
    ).rejects.toMatchObject({
      code: 'permission.denied',
      details: {
        before: {
          actorPermissions: []
        },
        after: {
          requiredPermission: 'configure',
          resourceId: 'group-premium'
        }
      }
    });
    await expect(repository.listTasks()).resolves.toEqual([]);
  });

  it('scopes permission grant authorization by permissionChange resource type', async () => {
    const repository = createInMemoryControlPlaneRepository({
      permissionGrants: [
        {
          id: 'grant-agent-only-delegator',
          subjectType: 'group',
          subjectId: 'ops-agent-delegator',
          resourceType: 'agent',
          resourceId: 'group-premium',
          permissions: ['read', 'operate', 'configure', 'grant'],
          grantedBy: 'system:bootstrap',
          reason: 'Agent enrollment delegation only',
          resourceVersion: 'permv-agent-only-delegator',
          createdAt: '2026-06-02T00:00:00.000Z',
          updatedAt: '2026-06-02T00:00:00.000Z'
        }
      ]
    });
    const service = createControlPlaneService({ repository, now: createControlPlaneTestClock() });

    await expect(
      service.createTask(
        {
          operation: 'permission.grant',
          targetId: 'grant-cross-type-forwarding',
          targetLabel: 'group:ops-agent-delegator -> group-premium',
          summary: 'Attempt to grant forwarding access with Agent-only grant',
          permissionChange: {
            subjectType: 'group',
            subjectId: 'ops-forwarding',
            resourceType: 'tunnel-group',
            resourceId: 'group-premium',
            permissions: ['read', 'operate'],
            reason: 'cross-type escalation attempt'
          }
        },
        {
          ...context,
          actor: 'operator:agent-delegator',
          operatorGroupId: 'ops-agent-delegator',
          requestId: 'req-service-rbac-cross-type-grant',
          idempotencyKey: 'idem-service-rbac-cross-type-grant',
          ifMatch: undefined
        }
      )
    ).rejects.toMatchObject({
      code: 'permission.denied',
      details: {
        before: {
          actorPermissions: []
        },
        after: {
          requiredPermission: 'grant',
          resourceId: 'group-premium'
        }
      }
    });
    await expect(repository.listPermissionGrants()).resolves.toEqual([
      expect.objectContaining({ id: 'grant-agent-only-delegator' })
    ]);
  });

  it('lets the bootstrap admin execute task mutations without explicit grants', async () => {
    const { service } = createServiceWithoutPermissionGrants();

    await expect(
      service.createTask(
        {
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Apply admin forwarding policy',
          metadata: forwardApplyMetadata
        },
        {
          ...context,
          requestId: 'req-service-admin-bypass',
          idempotencyKey: 'idem-service-admin-bypass'
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
        withRiskConfirmation({
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
        }),
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

  it('rejects revoking the final administrative grant path for a resource', async () => {
    const { repository, service } = createService();

    await expect(
      service.createTask(
        withRiskConfirmation({
          operation: 'permission.revoke',
          targetId: 'grant-bootstrap-owner-tunnel',
          targetLabel: 'operator:bootstrap-owner -> group-premium',
          summary: 'Revoke one redundant owner permission path',
          permissionChange: {
            subjectType: 'user',
            subjectId: 'bootstrap-owner',
            resourceType: 'tunnel-group',
            resourceId: 'group-premium',
            permissions: ['read', 'operate', 'configure', 'grant'],
            reason: 'owner user path replaced by owner group'
          }
        }),
        {
          ...context,
          requestId: 'req-service-permission-revoke-redundant-admin',
          idempotencyKey: 'idem-service-permission-revoke-redundant-admin',
          ifMatch: undefined
        }
      )
    ).resolves.toMatchObject({
      operation: 'permission.revoke',
      status: 'queued'
    });

    await expect(
      service.createTask(
        withRiskConfirmation({
          operation: 'permission.revoke',
          targetId: 'grant-owner-group-tunnel',
          targetLabel: 'group:owner -> group-premium',
          summary: 'Attempt to revoke final owner permission path',
          permissionChange: {
            subjectType: 'group',
            subjectId: 'owner',
            resourceType: 'tunnel-group',
            resourceId: 'group-premium',
            permissions: ['read', 'operate', 'configure', 'grant'],
            reason: 'dangerous owner offboarding'
          }
        }),
        {
          ...context,
          requestId: 'req-service-permission-revoke-final-admin',
          idempotencyKey: 'idem-service-permission-revoke-final-admin',
          ifMatch: undefined
        }
      )
    ).rejects.toMatchObject({
      code: 'permission_grant.last_admin_path',
      details: expect.objectContaining({
        denialReason: 'Permission revoke would remove the last administrative grant path for this resource.'
      })
    });

    const ownerGroupGrant = (await repository.listPermissionGrants()).find((grant) => grant.id === 'grant-owner-group-tunnel');

    expect(ownerGroupGrant).toEqual(expect.objectContaining({ id: 'grant-owner-group-tunnel' }));
    expect(ownerGroupGrant?.revokedAt).toBeUndefined();
    await expect(repository.listAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'audit.denied',
          denialCode: 'permission_grant.last_admin_path',
          targetId: 'grant-owner-group-tunnel'
        })
      ])
    );
  });
});
