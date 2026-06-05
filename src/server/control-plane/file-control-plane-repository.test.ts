import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AGENT_INSTALL_PROFILE, type AuditLog } from '../../domain';
import { seedForwardRules, seedPermissionGrants } from '../../services/mock/mock-data';
import { createControlPlaneTestClock } from '../../test/control-plane-clock';
import { createAgentCredentialTokenHash } from './agent-credentials';
import { createControlPlaneService } from './control-plane-service';
import { createFileControlPlaneRepository } from './file-control-plane-repository';
import { createInMemoryControlPlaneRepository } from './in-memory-control-plane-repository';

const context = {
  actor: 'admin',
  operatorGroupId: 'owner',
  resourceGroupId: 'group-premium',
  sourceIp: '203.0.113.10',
  userAgent: 'vitest-file-repository',
  requestId: 'req-file-forward-001',
  idempotencyKey: 'idem-file-forward-001',
  ifMatch: 'forward-forward-hkg-443-v1'
};

async function withDataFile<T>(run: (filePath: string) => Promise<T>) {
  const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-control-plane-'));
  const filePath = join(directory, 'control-plane-state.json');

  try {
    return await run(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function createRepositoryAuditLog(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: 'audit-file-append-only',
    action: 'task.created',
    actor: 'admin',
    operatorGroupId: 'owner',
    resourceGroupId: 'group-premium',
    scope: 'control-plane',
    resourceType: 'forward',
    operation: 'forward.apply',
    result: 'accepted',
    targetId: 'forward-hkg-443',
    targetLabel: 'Port Forwarding Fabric',
    taskId: 'task-file-append-only',
    severity: 'info',
    message: 'Append-only baseline audit',
    createdAt: '2026-06-02T00:00:00.000Z',
    sourceIp: '203.0.113.10',
    requestId: 'req-file-audit-append-only',
    ...overrides
  };
}

describe('file control-plane repository', () => {
  it('persists Agent credentials as digests without writing raw tokens', async () => {
    await withDataFile(async (filePath) => {
      const token = 'oit_file_repository_secret_token_001';
      const repository = await createFileControlPlaneRepository({ filePath });

      await repository.transaction(async (transaction) => {
        await transaction.upsertAgentCredential({
          id: 'agent-credential-file-001',
          agentId: 'agent-edge-file-01',
          tokenHash: createAgentCredentialTokenHash(token),
          tokenPrefix: 'oit_file...001',
          status: 'active',
          purpose: 'install',
          issuedAt: '2026-06-02T00:00:00.000Z',
          expiresAt: '2026-06-02T00:15:00.000Z',
          issuedBy: 'admin',
          sourceIp: '203.0.113.10',
          requestId: 'req-file-agent-credential',
          metadata: {
            installProfile: [...AGENT_INSTALL_PROFILE]
          }
        });
      });

      const restoredRepository = await createFileControlPlaneRepository({ filePath });
      const rawState = await readFile(filePath, 'utf8');

      await expect(restoredRepository.findAgentCredentialByTokenHash(createAgentCredentialTokenHash(token))).resolves.toEqual(
        expect.objectContaining({
          agentId: 'agent-edge-file-01',
          tokenHash: createAgentCredentialTokenHash(token),
          status: 'active'
        })
      );
      await expect(restoredRepository.listAgentCredentials()).resolves.toEqual([
        expect.objectContaining({
          id: 'agent-credential-file-001'
        })
      ]);
      expect(rawState).not.toContain(token);
    });
  });

  it('loads old state files that do not yet contain Agent credentials', async () => {
    await withDataFile(async (filePath) => {
      await writeFile(
        filePath,
        `${JSON.stringify(
          {
            tasks: [],
            auditLogs: [],
            commandOutbox: [],
            agentEvents: [],
            forwardRules: [],
            permissionGrants: [],
            configRevisions: [],
            preflightPlans: [],
            runtimeSnapshots: []
          },
          null,
          2
        )}\n`,
        'utf8'
      );

      const repository = await createFileControlPlaneRepository({ filePath });

      await expect(repository.listAgentCredentials()).resolves.toEqual([]);
      await expect(repository.listAgentSessions()).resolves.toEqual([]);
      await expect(repository.listSubscriptionSources()).resolves.toEqual([]);
      await expect(repository.listSubscriptionClients()).resolves.toEqual([]);
      await expect(repository.listSubscriptionInventoryNodes()).resolves.toEqual([]);
      await expect(repository.listTrafficRollups()).resolves.toEqual([]);
      await expect(repository.findIdempotencyRecord('missing')).resolves.toBeUndefined();
    });
  });

  it('persists Agent log retention cleanup to the state file', async () => {
    await withDataFile(async (filePath) => {
      const repository = await createFileControlPlaneRepository({ filePath });

      await repository.transaction(async (transaction) => {
        await transaction.insertAgentEvent({
          type: 'heartbeat',
          eventId: 'evt-file-heartbeat-kept',
          agentId: 'agent-file-log-01',
          seq: 1,
          sessionId: 'sess-file-log-retention',
          observedAt: '2026-06-04T00:00:00.000Z',
          payload: {}
        });
        await transaction.insertAgentEvent({
          type: 'log_chunk',
          eventId: 'evt-file-log-too-old',
          commandId: 'cmd-file-log-retention',
          taskId: 'task-file-log-retention',
          agentId: 'agent-file-log-01',
          seq: 2,
          sessionId: 'sess-file-log-retention',
          observedAt: '2026-06-04T00:00:00.000Z',
          payload: {
            chunkSeq: 1,
            stream: 'stderr',
            content: 'old retained log should be pruned'
          }
        });
        await transaction.insertAgentEvent({
          type: 'log_chunk',
          eventId: 'evt-file-log-within-window',
          commandId: 'cmd-file-log-retention',
          taskId: 'task-file-log-retention',
          agentId: 'agent-file-log-01',
          seq: 3,
          sessionId: 'sess-file-log-retention',
          observedAt: '2026-06-04T00:01:20.000Z',
          payload: {
            chunkSeq: 2,
            stream: 'stderr',
            content: 'middle retained log should be capped'
          }
        });
        await transaction.insertAgentEvent({
          type: 'log_chunk',
          eventId: 'evt-file-log-newest',
          commandId: 'cmd-file-log-retention',
          taskId: 'task-file-log-retention',
          agentId: 'agent-file-log-01',
          seq: 4,
          sessionId: 'sess-file-log-retention',
          observedAt: '2026-06-04T00:01:40.000Z',
          payload: {
            chunkSeq: 3,
            stream: 'stderr',
            content: 'newest retained log'
          }
        });

        await expect(
          transaction.pruneAgentLogEvents(
            {
              maxAgeMs: 90_000,
              maxEventsPerAgent: 1
            },
            '2026-06-04T00:01:40.000Z'
          )
        ).resolves.toMatchObject({
          removed: 2,
          retained: 1
        });
      });

      const restoredRepository = await createFileControlPlaneRepository({ filePath });
      const rawState = await readFile(filePath, 'utf8');

      await expect(restoredRepository.listAgentEvents()).resolves.toEqual([
        expect.objectContaining({ eventId: 'evt-file-log-newest' }),
        expect.objectContaining({ eventId: 'evt-file-heartbeat-kept' })
      ]);
      expect(rawState).toContain('evt-file-log-newest');
      expect(rawState).toContain('evt-file-heartbeat-kept');
      expect(rawState).not.toContain('evt-file-log-too-old');
      expect(rawState).not.toContain('evt-file-log-within-window');
    });
  });

  it('persists synced external subscription inventory nodes across repository instances', async () => {
    await withDataFile(async (filePath) => {
      const repository = await createFileControlPlaneRepository({ filePath });

      await repository.transaction(async (transaction) => {
        await transaction.replaceSubscriptionInventoryNodesForSource('source-premium-sync', [
          {
            id: 'source-premium-sync-vless-hk1',
            sourceId: 'source-premium-sync',
            name: 'HK Premium 01',
            protocol: 'vless',
            server: 'hk1.example.com',
            port: 443,
            latencyMs: 0,
            tags: ['external-subscription', 'source:source-premium-sync', 'vless'],
            rawUrl: 'vless://11111111-1111-4111-8111-111111111111@hk1.example.com:443#HK%20Premium%2001',
            clashConfig: {
              name: 'HK Premium 01',
              type: 'vless',
              server: 'hk1.example.com',
              port: 443,
              uuid: '11111111-1111-4111-8111-111111111111'
            }
          }
        ]);
      });

      const restoredRepository = await createFileControlPlaneRepository({ filePath });
      const rawState = await readFile(filePath, 'utf8');

      await expect(restoredRepository.listSubscriptionInventoryNodes()).resolves.toEqual([
        expect.objectContaining({
          id: 'source-premium-sync-vless-hk1',
          sourceId: 'source-premium-sync',
          server: 'hk1.example.com',
          port: 443
        })
      ]);
      expect(rawState).toContain('subscriptionInventoryNodes');
      expect(rawState).toContain('HK Premium 01');
    });
  });

  it('persists subscription sources and client identities across repository instances', async () => {
    await withDataFile(async (filePath) => {
      const repository = await createFileControlPlaneRepository({ filePath });

      await repository.transaction(async (transaction) => {
        await transaction.upsertSubscriptionSource({
          id: 'source-file-premium',
          kind: 'clash',
          name: 'File Premium Source',
          url: 'https://provider.example.com/file-premium.yaml',
          status: 'synced',
          nodeCount: 3,
          dedupeKey: 'server-port',
          lastSyncAt: '2026-06-04T00:00:00.000Z',
          rateLimitPerMinute: 60,
          refreshIntervalMinutes: 60,
          includeFilter: 'premium',
          excludeFilter: 'expired',
          syncLeaseOwnerId: 'subscription-sync-source-file-premium-test',
          syncLeaseExpiresAt: '2026-06-04T00:01:00.000Z'
        });
        await transaction.upsertSubscriptionClient({
          id: 'sub-client-file-premium',
          customerName: 'File Customer',
          ruleName: 'File Premium Rule',
          displayName: 'File Premium Rule',
          subId: 'file_premium',
          email: 'ops@example.com',
          enabled: true,
          protocol: 'vless',
          group: 'premium',
          trafficLimitBytes: 600 * 1024 * 1024 * 1024,
          usedTrafficBytes: 42 * 1024 * 1024 * 1024,
          expiresAt: '2026-07-04T00:00:00.000Z',
          ipLimit: 2,
          requestLimitPerHour: 120,
          sourceIds: ['source-file-premium'],
          selectedTags: ['premium'],
          includeFilter: 'HK|Premium',
          excludeFilter: 'expired|test',
          regionFilter: ['hk'],
          routingRule: 'tag:premium',
          maxLatencyMs: 180,
          sortStrategy: 'latency',
          formats: ['plain', 'clash'],
          outputFormats: ['uri', 'clash'],
          templateName: 'mihomo-compatible.yaml',
          accessTokenPreview: 'ou_file...ium1',
          securePathPreview: '/A1b2C3d4E5f6G7h8',
          generatedNodeCount: 3,
          lastGeneratedAt: '2026-06-04T00:00:00.000Z'
        });
      });

      const restoredRepository = await createFileControlPlaneRepository({ filePath });
      const rawState = await readFile(filePath, 'utf8');

      await expect(restoredRepository.listSubscriptionSources()).resolves.toEqual([
        expect.objectContaining({
          id: 'source-file-premium',
          status: 'synced',
          nodeCount: 3,
          syncLeaseOwnerId: 'subscription-sync-source-file-premium-test',
          syncLeaseExpiresAt: '2026-06-04T00:01:00.000Z'
        })
      ]);
      await expect(restoredRepository.listSubscriptionClients()).resolves.toEqual([
        expect.objectContaining({
          id: 'sub-client-file-premium',
          sourceIds: ['source-file-premium'],
          securePathPreview: '/A1b2C3d4E5f6G7h8'
        })
      ]);
      expect(rawState).toContain('subscriptionSources');
      expect(rawState).toContain('subscriptionClients');
      expect(rawState).toContain('File Premium Source');
      expect(rawState).toContain('File Premium Rule');
    });
  });

  it('persists task, audit, idempotency, and outbox state across repository instances', async () => {
    await withDataFile(async (filePath) => {
      const repository = await createFileControlPlaneRepository({
        filePath,
        seed: {
          forwardRules: seedForwardRules,
          permissionGrants: seedPermissionGrants
        }
      });
      const service = createControlPlaneService({ repository, now: createControlPlaneTestClock() });
      const task = await service.createTask(
        {
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Apply durable forwarding policy'
        },
        context
      );

      const restoredRepository = await createFileControlPlaneRepository({
        filePath,
        seed: {
          forwardRules: [],
          permissionGrants: []
        }
      });

      await expect(restoredRepository.listTasks()).resolves.toEqual([expect.objectContaining({ id: task.id })]);
      await expect(restoredRepository.listCommandOutbox()).resolves.toEqual([
        expect.objectContaining({
          taskId: task.id,
          status: 'pending'
        })
      ]);
      await expect(restoredRepository.listAuditLogs()).resolves.toEqual([
        expect.objectContaining({
          action: 'task.created',
          taskId: task.id
        })
      ]);
      await expect(restoredRepository.findIdempotencyRecord('admin:POST:/api/v1/tasks:idem-file-forward-001')).resolves.toEqual(
        expect.objectContaining({
          taskId: task.id
        })
      );
      await expect(restoredRepository.listForwardRules()).resolves.toEqual(seedForwardRules);
      await expect(restoredRepository.listPermissionGrants()).resolves.toEqual(seedPermissionGrants);
      const [configRevision] = await restoredRepository.listConfigRevisions();
      expect(configRevision).toBeDefined();
      if (!configRevision) throw new Error('expected persisted config revision');
      expect(configRevision).toMatchObject({
        taskId: task.id,
        status: 'compiled',
        artifactUri: `ou-ui://artifacts/config-revisions/${configRevision.id}.json`,
        artifact: expect.objectContaining({
          rule: expect.objectContaining({
            binding: expect.objectContaining({
              listenPort: 443,
              targetAddress: '10.12.0.8',
              targetPort: 8443
            })
          })
        })
      });
      await expect(restoredRepository.listPreflightPlans()).resolves.toEqual([
        expect.objectContaining({
          taskId: task.id,
          configRevisionId: configRevision.id,
          status: 'pending'
        })
      ]);
      await expect(restoredRepository.listRuntimeSnapshots()).resolves.toEqual([
        expect.objectContaining({
          taskId: task.id,
          status: 'captured',
          reason: 'pre_apply'
        })
      ]);
    });
  });

  it('rejects duplicate audit log IDs in memory-backed transactions', async () => {
    const repository = createInMemoryControlPlaneRepository();
    const originalAudit = createRepositoryAuditLog();

    await repository.transaction(async (transaction) => {
      await transaction.insertAuditLog(originalAudit);
    });

    await expect(
      repository.transaction(async (transaction) => {
        await transaction.insertAuditLog({
          ...originalAudit,
          message: 'Tampered duplicate audit'
        });
      })
    ).rejects.toThrow('audit_log.append_only_violation');

    await expect(repository.listAuditLogs()).resolves.toEqual([
      expect.objectContaining({
        id: originalAudit.id,
        message: originalAudit.message
      })
    ]);
  });

  it('rejects duplicate audit log IDs in file-backed transactions without overwriting the original', async () => {
    await withDataFile(async (filePath) => {
      const repository = await createFileControlPlaneRepository({ filePath });
      const originalAudit = createRepositoryAuditLog();

      await repository.transaction(async (transaction) => {
        await transaction.insertAuditLog(originalAudit);
      });

      await expect(
        repository.transaction(async (transaction) => {
          await transaction.insertAuditLog({
            ...originalAudit,
            message: 'Tampered duplicate audit'
          });
        })
      ).rejects.toThrow('audit_log.append_only_violation');

      await expect(repository.listAuditLogs()).resolves.toEqual([
        expect.objectContaining({
          id: originalAudit.id,
          message: originalAudit.message
        })
      ]);

      const rawState = await readFile(filePath, 'utf8');

      expect(rawState).toContain(originalAudit.message);
      expect(rawState).not.toContain('Tampered duplicate audit');
    });
  });

  it('rejects persisted state files with duplicate audit log IDs', async () => {
    await withDataFile(async (filePath) => {
      const duplicatedAudit = createRepositoryAuditLog({
        id: 'audit-duplicate-state'
      });

      await writeFile(
        filePath,
        `${JSON.stringify(
          {
            tasks: [],
            auditLogs: [
              duplicatedAudit,
              {
                ...duplicatedAudit,
                message: 'Duplicate audit in state file'
              }
            ],
            commandOutbox: [],
            agentEvents: [],
            forwardRules: [],
            permissionGrants: [],
            configRevisions: [],
            preflightPlans: [],
            runtimeSnapshots: []
          },
          null,
          2
        )}\n`,
        'utf8'
      );

      await expect(createFileControlPlaneRepository({ filePath })).rejects.toThrow(
        'contains duplicate audit log "audit-duplicate-state"'
      );
    });
  });

  it('persists denied audit records for rejected mutations', async () => {
    await withDataFile(async (filePath) => {
      const repository = await createFileControlPlaneRepository({
        filePath,
        seed: {
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
        }
      });
      const service = createControlPlaneService({ repository, now: createControlPlaneTestClock() });

      await expect(
        service.createTask(
          {
            operation: 'forward.apply',
            targetId: 'forward-hkg-443',
            targetLabel: 'Port Forwarding Fabric',
            summary: 'Apply denied durable forwarding policy'
          },
          {
            ...context,
            actor: 'operator:bob',
            operatorGroupId: 'ops-viewer',
            requestId: 'req-file-rbac-denied',
            idempotencyKey: 'idem-file-rbac-denied'
          }
        )
      ).rejects.toThrow('permission.denied');

      const restoredRepository = await createFileControlPlaneRepository({ filePath });

      await expect(restoredRepository.listTasks()).resolves.toEqual([]);
      await expect(restoredRepository.listAuditLogs()).resolves.toEqual([
        expect.objectContaining({
          action: 'audit.denied',
          denialCode: 'permission.denied',
          actor: 'operator:bob'
        })
      ]);
    });
  });

  it('rolls back rejected transactions without writing the draft state file', async () => {
    await withDataFile(async (filePath) => {
      const repository = await createFileControlPlaneRepository({
        filePath,
        seed: {
          forwardRules: seedForwardRules,
          permissionGrants: seedPermissionGrants
        }
      });
      const service = createControlPlaneService({ repository, now: createControlPlaneTestClock() });
      const task = await service.createTask(
        {
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Apply rollback test forwarding policy'
        },
        {
          ...context,
          requestId: 'req-file-rollback-seed',
          idempotencyKey: 'idem-file-rollback-seed'
        }
      );

      await expect(
        repository.transaction(async (transaction) => {
          await transaction.updateTask({
            ...task,
            status: 'failed',
            updatedAt: '2026-06-02T00:05:00.000Z'
          });

          throw new Error('force rollback');
        })
      ).rejects.toThrow('force rollback');

      const restoredRepository = await createFileControlPlaneRepository({ filePath });

      await expect(restoredRepository.listTasks()).resolves.toEqual([
        expect.objectContaining({
          id: task.id,
          status: 'queued'
        })
      ]);
    });
  });

  it('prevents caller-side object mutation from polluting stored state', async () => {
    await withDataFile(async (filePath) => {
      const repository = await createFileControlPlaneRepository({
        filePath,
        seed: {
          forwardRules: seedForwardRules,
          permissionGrants: seedPermissionGrants
        }
      });
      const service = createControlPlaneService({ repository, now: createControlPlaneTestClock() });
      const task = await service.createTask(
        {
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'Port Forwarding Fabric',
          summary: 'Apply clone isolation test forwarding policy'
        },
        {
          ...context,
          requestId: 'req-file-clone-isolation',
          idempotencyKey: 'idem-file-clone-isolation'
        }
      );
      const listedTasks = await repository.listTasks();

      listedTasks[0].status = 'failed';
      task.status = 'failed';

      await expect(repository.listTasks()).resolves.toEqual([
        expect.objectContaining({
          id: task.id,
          status: 'queued'
        })
      ]);
    });
  });

  it('serializes concurrent task creation without losing committed writes', async () => {
    await withDataFile(async (filePath) => {
      const repository = await createFileControlPlaneRepository({
        filePath,
        seed: {
          forwardRules: seedForwardRules,
          permissionGrants: seedPermissionGrants
        }
      });
      const service = createControlPlaneService({ repository, now: createControlPlaneTestClock() });
      const [firstTask, secondTask] = await Promise.all([
        service.createTask(
          {
            operation: 'forward.apply',
            targetId: 'forward-hkg-443',
            targetLabel: 'Port Forwarding Fabric',
            summary: 'Apply first concurrent forwarding policy'
          },
          {
            ...context,
            requestId: 'req-file-concurrent-001',
            idempotencyKey: 'idem-file-concurrent-001'
          }
        ),
        service.createTask(
          {
            operation: 'forward.apply',
            targetId: 'forward-hkg-443',
            targetLabel: 'Port Forwarding Fabric',
            summary: 'Apply second concurrent forwarding policy'
          },
          {
            ...context,
            requestId: 'req-file-concurrent-002',
            idempotencyKey: 'idem-file-concurrent-002'
          }
        )
      ]);

      const restoredRepository = await createFileControlPlaneRepository({ filePath });

      await expect(restoredRepository.listTasks()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: firstTask.id }),
          expect.objectContaining({ id: secondTask.id })
        ])
      );
      await expect(restoredRepository.listAuditLogs()).resolves.toHaveLength(2);
      await expect(restoredRepository.listCommandOutbox()).resolves.toHaveLength(2);
    });
  });
});
