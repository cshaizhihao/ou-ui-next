import { mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type {
  ControlPlaneRepository,
  ControlPlaneRepositoryState,
  ControlPlaneTransaction
} from './control-plane-repository';
import {
  assertControlPlaneRepositoryState,
  clone,
  createControlPlaneTransaction,
  createEmptyControlPlaneRepositoryState
} from './stateful-control-plane-repository';

type CreateSqliteControlPlaneRepositoryInput = {
  databaseFilePath: string;
  legacyStateFilePath?: string;
  seed?: Partial<ControlPlaneRepositoryState>;
};

const SQLITE_SCHEMA_VERSION = 1;
const SQLITE_STATE_ROW_ID = 1;
const SQLITE_STATE_FORMAT = 'json-state-v1';

type SqliteDatabase = InstanceType<typeof Database>;

function parseStatePayload(raw: string, originLabel: string) {
  const parsed = JSON.parse(raw) as unknown;
  assertControlPlaneRepositoryState(parsed, originLabel);
  return clone(parsed);
}

function initializeDatabase(database: SqliteDatabase) {
  database.pragma('journal_mode = WAL');
  database.pragma('synchronous = FULL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');

  database.exec(`
    CREATE TABLE IF NOT EXISTS control_plane_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS control_plane_state (
      id INTEGER PRIMARY KEY CHECK (id = ${SQLITE_STATE_ROW_ID}),
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const upsertMeta = database.prepare(`
    INSERT INTO control_plane_meta (key, value)
    VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  upsertMeta.run({ key: 'schema_version', value: String(SQLITE_SCHEMA_VERSION) });
  upsertMeta.run({ key: 'state_format', value: SQLITE_STATE_FORMAT });
}

function readStateFromDatabase(database: SqliteDatabase, originLabel: string): ControlPlaneRepositoryState {
  const row = database
    .prepare('SELECT payload FROM control_plane_state WHERE id = ?')
    .get(SQLITE_STATE_ROW_ID) as { payload: string } | undefined;

  if (!row) {
    throw new Error(`Missing control-plane database state row: ${originLabel}`);
  }

  return parseStatePayload(row.payload, originLabel);
}

function writeStateToDatabase(database: SqliteDatabase, state: ControlPlaneRepositoryState) {
  database
    .prepare(
      `UPDATE control_plane_state
       SET payload = @payload, updated_at = @updatedAt
       WHERE id = @id`
    )
    .run({
      id: SQLITE_STATE_ROW_ID,
      payload: JSON.stringify(state, null, 2),
      updatedAt: new Date().toISOString()
    });
}

function loadLegacyState(input: CreateSqliteControlPlaneRepositoryInput) {
  if (!input.legacyStateFilePath || !existsSync(input.legacyStateFilePath)) {
    return createEmptyControlPlaneRepositoryState(input.seed);
  }

  const raw = readFileSync(input.legacyStateFilePath, 'utf8');
  return parseStatePayload(raw, input.legacyStateFilePath);
}

async function prepareSqliteDatabase(input: CreateSqliteControlPlaneRepositoryInput) {
  await mkdir(dirname(input.databaseFilePath), { recursive: true });

  const database = new Database(input.databaseFilePath);
  initializeDatabase(database);

  database.exec('BEGIN IMMEDIATE');

  try {
    const existingRow = database
      .prepare('SELECT payload FROM control_plane_state WHERE id = ?')
      .get(SQLITE_STATE_ROW_ID) as { payload: string } | undefined;

    if (!existingRow) {
      const state = loadLegacyState(input);

      database
        .prepare(
          `INSERT INTO control_plane_state (id, payload, updated_at)
           VALUES (@id, @payload, @updatedAt)`
        )
        .run({
          id: SQLITE_STATE_ROW_ID,
          payload: JSON.stringify(state, null, 2),
          updatedAt: new Date().toISOString()
        });
    } else {
      const state = parseStatePayload(existingRow.payload, input.databaseFilePath);
      writeStateToDatabase(database, state);
    }

    database.exec('COMMIT');
    return database;
  } catch (error) {
    if (database.inTransaction) {
      database.exec('ROLLBACK');
    }
    database.close();
    throw error;
  }
}

export async function createSqliteControlPlaneRepository(
  input: CreateSqliteControlPlaneRepositoryInput
): Promise<ControlPlaneRepository> {
  const database = await prepareSqliteDatabase(input);
  let operationQueue: Promise<void> = Promise.resolve();

  const enqueue = <T>(run: () => Promise<T>) => {
    const pending = operationQueue.then(run, run);
    operationQueue = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  };

  const listState = () => enqueue(async () => readStateFromDatabase(database, input.databaseFilePath));

  return {
    async transaction<T>(run: (transaction: ControlPlaneTransaction) => Promise<T>) {
      return enqueue(async () => {
        database.exec('BEGIN IMMEDIATE');

        try {
          const draft = readStateFromDatabase(database, input.databaseFilePath);
          const result = await run(createControlPlaneTransaction(draft));

          writeStateToDatabase(database, draft);
          database.exec('COMMIT');

          return clone(result);
        } catch (error) {
          if (database.inTransaction) {
            database.exec('ROLLBACK');
          }

          throw error;
        }
      });
    },

    async listTasks() {
      return clone((await listState()).tasks);
    },

    async listAuditLogs() {
      return clone((await listState()).auditLogs);
    },

    async listCommandOutbox() {
      return clone((await listState()).commandOutbox);
    },

    async listAgentEvents() {
      return clone((await listState()).agentEvents);
    },

    async listAgentSessions() {
      return clone((await listState()).agentSessions);
    },

    async listOperatorSessions() {
      return clone((await listState()).operatorSessions);
    },

    async listAgentCredentials() {
      return clone((await listState()).agentCredentials);
    },

    async findAgentCredentialById(id: string) {
      return clone((await listState()).agentCredentials.find((record) => record.id === id));
    },

    async findAgentCredentialByTokenHash(tokenHash: string) {
      return clone((await listState()).agentCredentials.find((record) => record.tokenHash === tokenHash));
    },

    async listForwardRules() {
      return clone((await listState()).forwardRules);
    },

    async listSubscriptionSources() {
      return clone((await listState()).subscriptionSources);
    },

    async listSubscriptionClients() {
      return clone((await listState()).subscriptionClients);
    },

    async listSubscriptionExportProfiles() {
      return clone((await listState()).subscriptionExportProfiles);
    },

    async listSubscriptionInventoryNodes() {
      return clone((await listState()).subscriptionInventoryNodes);
    },

    async listSystemAlertRecords() {
      return clone((await listState()).systemAlerts);
    },

    async listSystemAlertNotificationDeliveries() {
      return clone((await listState()).systemAlertNotificationDeliveries);
    },

    async listPermissionGrants() {
      return clone((await listState()).permissionGrants);
    },

    async listConfigRevisions() {
      return clone((await listState()).configRevisions);
    },

    async listPreflightPlans() {
      return clone((await listState()).preflightPlans);
    },

    async listRuntimeSnapshots() {
      return clone((await listState()).runtimeSnapshots);
    },

    async listTrafficRollups() {
      return clone((await listState()).trafficRollups);
    },

    async getAgentLogRetentionPolicy() {
      return clone((await listState()).agentLogRetentionPolicy);
    },

    async getTrafficRollupRetentionPolicy() {
      return clone((await listState()).trafficRollupRetentionPolicy);
    },

    async findIdempotencyRecord(key: string) {
      return clone((await listState()).idempotencyRecords.find((record) => record.key === key));
    }
  };
}
