import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AGENT_INSTALL_PROFILE } from '../../domain';
import { seedForwardRules, seedPermissionGrants } from '../../services/mock/mock-data';
import { createAgentCredentialTokenHash } from './agent-credentials';
import { createControlPlaneService } from './control-plane-service';
import { createFileControlPlaneRepository } from './file-control-plane-repository';

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
            hostName: 'edge-file-01',
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
      await expect(repository.findIdempotencyRecord('missing')).resolves.toBeUndefined();
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
      const service = createControlPlaneService({ repository });
      const task = await service.createTask(
        {
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'FLVX Tunnel Fabric',
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
      await expect(restoredRepository.listConfigRevisions()).resolves.toEqual([
        expect.objectContaining({
          taskId: task.id,
          status: 'compiled',
          artifactUri: `ou-ui://artifacts/config-revisions/cfg-${task.id}.json`
        })
      ]);
      await expect(restoredRepository.listPreflightPlans()).resolves.toEqual([
        expect.objectContaining({
          taskId: task.id,
          configRevisionId: `cfg-${task.id}`,
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
      const service = createControlPlaneService({ repository });

      await expect(
        service.createTask(
          {
            operation: 'forward.apply',
            targetId: 'forward-hkg-443',
            targetLabel: 'FLVX Tunnel Fabric',
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
      const service = createControlPlaneService({ repository });
      const task = await service.createTask(
        {
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'FLVX Tunnel Fabric',
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
      const service = createControlPlaneService({ repository });
      const task = await service.createTask(
        {
          operation: 'forward.apply',
          targetId: 'forward-hkg-443',
          targetLabel: 'FLVX Tunnel Fabric',
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
      const service = createControlPlaneService({ repository });
      const [firstTask, secondTask] = await Promise.all([
        service.createTask(
          {
            operation: 'forward.apply',
            targetId: 'forward-hkg-443',
            targetLabel: 'FLVX Tunnel Fabric',
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
            targetLabel: 'FLVX Tunnel Fabric',
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
