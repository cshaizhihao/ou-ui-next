// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AGENT_INSTALL_PROFILE } from '../../domain';
import { createAgentCredentialTokenHash } from './agent-credentials';
import { createSqliteControlPlaneRepository } from './sqlite-control-plane-repository';

async function withDatabaseFile<T>(run: (databaseFilePath: string, legacyStateFilePath: string) => Promise<T>) {
  const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-control-plane-sqlite-'));
  const databaseFilePath = join(directory, 'control-plane.sqlite');
  const legacyStateFilePath = join(directory, 'control-plane-state.json');

  try {
    return await run(databaseFilePath, legacyStateFilePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('sqlite control-plane repository', () => {
  it('persists Agent credentials as digests without writing raw tokens into the sqlite database', async () => {
    await withDatabaseFile(async (databaseFilePath) => {
      const token = 'oit_sqlite_repository_secret_token_001';
      const repository = await createSqliteControlPlaneRepository({ databaseFilePath });

      await repository.transaction(async (transaction) => {
        await transaction.upsertAgentCredential({
          id: 'agent-credential-sqlite-001',
          agentId: 'agent-edge-sqlite-01',
          tokenHash: createAgentCredentialTokenHash(token),
          tokenPrefix: 'oit_sqlit...001',
          status: 'active',
          purpose: 'install',
          issuedAt: '2026-06-05T00:00:00.000Z',
          expiresAt: '2026-06-05T00:15:00.000Z',
          issuedBy: 'admin',
          sourceIp: '203.0.113.10',
          requestId: 'req-sqlite-agent-credential',
          metadata: {
            installProfile: [...AGENT_INSTALL_PROFILE]
          }
        });
      });

      const restoredRepository = await createSqliteControlPlaneRepository({ databaseFilePath });
      const rawDatabase = await readFile(databaseFilePath);

      await expect(
        restoredRepository.findAgentCredentialByTokenHash(createAgentCredentialTokenHash(token))
      ).resolves.toEqual(
        expect.objectContaining({
          agentId: 'agent-edge-sqlite-01',
          tokenHash: createAgentCredentialTokenHash(token),
          status: 'active'
        })
      );
      await expect(restoredRepository.listAgentCredentials()).resolves.toEqual([
        expect.objectContaining({
          id: 'agent-credential-sqlite-001'
        })
      ]);
      expect(rawDatabase.toString('utf8')).not.toContain(token);
    });
  });

  it('imports legacy json state into sqlite when the database does not exist yet', async () => {
    await withDatabaseFile(async (databaseFilePath, legacyStateFilePath) => {
      await writeFile(
        legacyStateFilePath,
        `${JSON.stringify(
          {
            tasks: [],
            auditLogs: [],
            commandOutbox: [],
            agentEvents: [],
            agentSessions: [],
            agentCredentials: [],
            idempotencyRecords: [],
            forwardRules: [],
            subscriptionSources: [],
            subscriptionClients: [],
            subscriptionExportProfiles: [],
            subscriptionInventoryNodes: [],
            permissionGrants: [
              {
                id: 'grant-bootstrap-owner-operator_legacy',
                subjectType: 'user',
                subjectId: 'operator_legacy',
                resourceType: 'tunnel-group',
                resourceId: 'group-premium',
                permissions: ['read', 'operate', 'configure', 'grant'],
                grantedBy: 'system:bootstrap',
                reason: 'bootstrap owner permissions'
              }
            ],
            configRevisions: [],
            preflightPlans: [],
            runtimeSnapshots: [],
            trafficRollups: []
          },
          null,
          2
        )}\n`,
        'utf8'
      );

      const repository = await createSqliteControlPlaneRepository({
        databaseFilePath,
        legacyStateFilePath
      });

      await expect(repository.listPermissionGrants()).resolves.toEqual([
        expect.objectContaining({
          id: 'grant-bootstrap-owner-operator_legacy',
          subjectId: 'operator_legacy',
          resourceId: 'group-premium'
        })
      ]);
    });
  });
});
