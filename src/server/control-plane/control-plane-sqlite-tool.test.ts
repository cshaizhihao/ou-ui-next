// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createSqliteControlPlaneRepository } from './sqlite-control-plane-repository';
import { createEmptyControlPlaneRepositoryState } from './stateful-control-plane-repository';

async function withTempDirectory<T>(run: (directory: string) => Promise<T>) {
  const directory = await mkdtemp(join(tmpdir(), 'ou-ui-next-sqlite-tool-'));

  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function runSqliteTool(...args: string[]) {
  return execFileSync(process.execPath, [resolve(process.cwd(), 'scripts', 'control-plane-sqlite-tool.cjs'), ...args], {
    encoding: 'utf8'
  });
}

function runSqliteToolExpectFailure(...args: string[]) {
  try {
    runSqliteTool(...args);
  } catch (error) {
    return String((error as Error & { stderr?: string | Buffer }).stderr ?? '');
  }

  throw new Error(`Expected sqlite tool to fail for arguments: ${args.join(' ')}`);
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

describe('control-plane sqlite tool', () => {
  it('backs up and restores a control-plane sqlite database', async () => {
    await withTempDirectory(async (directory) => {
      const databaseFilePath = join(directory, 'control-plane.sqlite');
      const backupFilePath = join(directory, 'backups', 'control-plane-backup.sqlite');
      const restoredDatabaseFilePath = join(directory, 'restored', 'control-plane.sqlite');
      const repository = await createSqliteControlPlaneRepository({ databaseFilePath });

      await repository.transaction(async (transaction) => {
        await transaction.upsertPermissionGrant({
          id: 'grant-sqlite-tool-backup',
          subjectType: 'user',
          subjectId: 'operator-backup',
          resourceType: 'tunnel-group',
          resourceId: 'group-premium',
          permissions: ['read', 'operate', 'configure', 'grant'],
          grantedBy: 'system:test',
          reason: 'sqlite tool backup/restore coverage'
        });
      });

      runSqliteTool('backup', databaseFilePath, backupFilePath);
      runSqliteTool('validate', backupFilePath);
      runSqliteTool('restore', backupFilePath, restoredDatabaseFilePath);

      const restoredRepository = await createSqliteControlPlaneRepository({
        databaseFilePath: restoredDatabaseFilePath
      });

      expect(existsSync(backupFilePath)).toBe(true);
      await expect(restoredRepository.listPermissionGrants()).resolves.toEqual([
        expect.objectContaining({
          id: 'grant-sqlite-tool-backup',
          subjectId: 'operator-backup',
          resourceId: 'group-premium'
        })
      ]);
    });
  });

  it('rejects sqlite files that are not valid control-plane stores', async () => {
    await withTempDirectory(async (directory) => {
      const invalidDatabaseFilePath = join(directory, 'invalid.sqlite');
      const database = new Database(invalidDatabaseFilePath);

      try {
        database.exec(`
          CREATE TABLE random_table (
            id INTEGER PRIMARY KEY,
            label TEXT NOT NULL
          );
        `);
      } finally {
        database.close();
      }

      expect(runSqliteToolExpectFailure('validate', invalidDatabaseFilePath)).toContain(
        'sqlite database is not a valid control-plane store'
      );
    });
  });

  it('rejects sqlite control-plane stores with unsupported schema versions', async () => {
    await withTempDirectory(async (directory) => {
      const futureDatabaseFilePath = join(directory, 'future.sqlite');

      writeControlPlaneDatabaseMetadataFixture(futureDatabaseFilePath, '2');

      expect(runSqliteToolExpectFailure('validate', futureDatabaseFilePath)).toContain(
        'unsupported control-plane schema_version 2'
      );
    });
  });
});
