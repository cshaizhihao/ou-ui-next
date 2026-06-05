// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { AGENT_INSTALL_PROFILE } from '../../domain';
import { createAgentCredentialTokenHash } from './agent-credentials';
import { createSqliteControlPlaneRepository } from './sqlite-control-plane-repository';
import { createEmptyControlPlaneRepositoryState } from './stateful-control-plane-repository';

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

function writeControlPlaneDatabaseMetadataFixture(databaseFilePath: string, schemaVersion: string) {
  const database = new Database(databaseFilePath);

  try {
    database.exec(`
      CREATE TABLE control_plane_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE control_plane_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    database.prepare('INSERT INTO control_plane_meta (key, value) VALUES (?, ?)').run('schema_version', schemaVersion);
    database.prepare('INSERT INTO control_plane_meta (key, value) VALUES (?, ?)').run('state_format', 'json-state-v1');
    database
      .prepare('INSERT INTO control_plane_state (id, payload, updated_at) VALUES (?, ?, ?)')
      .run(1, JSON.stringify(createEmptyControlPlaneRepositoryState(), null, 2), '2026-06-05T00:00:00.000Z');
  } finally {
    database.close();
  }
}

function readSchemaVersion(databaseFilePath: string) {
  const database = new Database(databaseFilePath, { readonly: true });

  try {
    const row = database
      .prepare("SELECT value FROM control_plane_meta WHERE key = 'schema_version'")
      .get() as { value: string };

    return row.value;
  } finally {
    database.close();
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

  it('rejects future sqlite schema versions without downgrading metadata', async () => {
    await withDatabaseFile(async (databaseFilePath) => {
      writeControlPlaneDatabaseMetadataFixture(databaseFilePath, '2');

      await expect(createSqliteControlPlaneRepository({ databaseFilePath })).rejects.toThrow(
        'Unsupported control-plane sqlite schema_version 2'
      );
      expect(readSchemaVersion(databaseFilePath)).toBe('2');
    });
  });

  it('persists runtime Agent log retention policy overrides', async () => {
    await withDatabaseFile(async (databaseFilePath) => {
      const repository = await createSqliteControlPlaneRepository({ databaseFilePath });

      await repository.transaction(async (transaction) => {
        await transaction.setAgentLogRetentionPolicy({
          maxAgeMs: 3 * 24 * 60 * 60 * 1000,
          maxEventsPerAgent: 300
        });
      });

      const restoredRepository = await createSqliteControlPlaneRepository({ databaseFilePath });

      await expect(restoredRepository.getAgentLogRetentionPolicy()).resolves.toEqual({
        maxAgeMs: 3 * 24 * 60 * 60 * 1000,
        maxEventsPerAgent: 300
      });
    });
  });

  it('persists runtime traffic rollup retention policy overrides', async () => {
    await withDatabaseFile(async (databaseFilePath) => {
      const repository = await createSqliteControlPlaneRepository({ databaseFilePath });

      await repository.transaction(async (transaction) => {
        await transaction.setTrafficRollupRetentionPolicy({
          maxAgeMs: 45 * 24 * 60 * 60 * 1000,
          maxRecordsPerScope: 8000
        });
      });

      const restoredRepository = await createSqliteControlPlaneRepository({ databaseFilePath });

      await expect(restoredRepository.getTrafficRollupRetentionPolicy()).resolves.toEqual({
        maxAgeMs: 45 * 24 * 60 * 60 * 1000,
        maxRecordsPerScope: 8000
      });
    });
  });
});
