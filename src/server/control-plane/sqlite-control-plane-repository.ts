import { mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
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

const SQLITE_SCHEMA_VERSION = 2;
const SQLITE_STATE_ROW_ID = 1;
const SQLITE_STATE_FORMAT = 'json-state-v1';
const SQLITE_MAX_HIGH_FREQUENCY_AGENT_EVENTS_PER_TYPE = 120;
const SQLITE_HIGH_FREQUENCY_AGENT_EVENT_TYPES = new Set(['heartbeat', 'telemetry_sample']);
const SQLITE_MIGRATIONS = [
  {
    version: 1,
    name: '001_json_state_v1',
    checksum: createMigrationChecksum(1, '001_json_state_v1', SQLITE_STATE_FORMAT)
  },
  {
    version: 2,
    name: '002_domain_entity_index_v1',
    checksum: createMigrationChecksum(2, '002_domain_entity_index_v1', SQLITE_STATE_FORMAT)
  }
] as const;

type SqliteDatabase = InstanceType<typeof Database>;
type EntityIndexRow = {
  entityType: string;
  entityId: string;
  parentId: string;
  status: string;
  label: string;
  updatedAt: string;
  payload: string;
};

function createMigrationChecksum(version: number, name: string, stateFormat: string) {
  return `sha256:${createHash('sha256')
    .update(`ou-ui-next.control-plane.sqlite:${version}:${name}:${stateFormat}`)
    .digest('hex')}`;
}

function tableExists(database: SqliteDatabase, tableName: string) {
  const row = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { '1': number } | undefined;

  return row !== undefined;
}

function readMetaValue(database: SqliteDatabase, key: string) {
  const row = database
    .prepare('SELECT value FROM control_plane_meta WHERE key = ?')
    .get(key) as { value: string } | undefined;

  return row?.value;
}

function readExistingStateRow(database: SqliteDatabase) {
  return database
    .prepare('SELECT payload FROM control_plane_state WHERE id = ?')
    .get(SQLITE_STATE_ROW_ID) as { payload: string } | undefined;
}

function readMigrationRows(database: SqliteDatabase) {
  return database
    .prepare('SELECT version, name, checksum, applied_at FROM control_plane_migrations ORDER BY version ASC')
    .all() as Array<{ version: number; name: string; checksum: string; applied_at: string }>;
}

function parseSchemaVersion(rawVersion: string, originLabel: string) {
  if (!/^\d+$/.test(rawVersion)) {
    throw new Error(`Invalid control-plane sqlite schema_version "${rawVersion}": ${originLabel}`);
  }

  const schemaVersion = Number(rawVersion);

  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error(`Invalid control-plane sqlite schema_version "${rawVersion}": ${originLabel}`);
  }

  return schemaVersion;
}

function assertSupportedDatabaseMetadata(database: SqliteDatabase, originLabel: string) {
  const rawSchemaVersion = readMetaValue(database, 'schema_version');
  const stateFormat = readMetaValue(database, 'state_format');

  if (rawSchemaVersion === undefined || stateFormat === undefined) {
    throw new Error(`Missing control-plane sqlite metadata: ${originLabel}`);
  }

  const schemaVersion = parseSchemaVersion(rawSchemaVersion, originLabel);

  if (schemaVersion > SQLITE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported control-plane sqlite schema_version ${schemaVersion}: this build supports ${SQLITE_SCHEMA_VERSION}. ` +
      `Upgrade OU-UI before opening ${originLabel}.`
    );
  }

  if (stateFormat !== SQLITE_STATE_FORMAT) {
    throw new Error(
      `Unsupported control-plane sqlite state_format "${stateFormat}": this build supports "${SQLITE_STATE_FORMAT}".`
    );
  }
}

function assertSupportedMigrationLedger(database: SqliteDatabase, originLabel: string) {
  if (!tableExists(database, 'control_plane_migrations')) {
    throw new Error(`Missing control-plane sqlite migration ledger: ${originLabel}`);
  }

  const rows = readMigrationRows(database);
  const latestVersion = Math.max(0, ...rows.map((row) => row.version));

  if (latestVersion > SQLITE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported control-plane sqlite migration version ${latestVersion}: this build supports ${SQLITE_SCHEMA_VERSION}. ` +
      `Upgrade OU-UI before opening ${originLabel}.`
    );
  }

  for (const migration of SQLITE_MIGRATIONS) {
    const row = rows.find((item) => item.version === migration.version);

    if (!row) {
      throw new Error(`Missing control-plane sqlite migration ${migration.version} (${migration.name}): ${originLabel}`);
    }

    if (row.name !== migration.name || row.checksum !== migration.checksum) {
      throw new Error(`Invalid control-plane sqlite migration ${migration.version}: ${originLabel}`);
    }
  }
}

function parseStatePayload(raw: string, originLabel: string) {
  const parsed = JSON.parse(raw) as unknown;
  assertControlPlaneRepositoryState(parsed, originLabel);
  return clone(parsed);
}

function configureDatabaseConnection(database: SqliteDatabase) {
  database.pragma('journal_mode = WAL');
  database.pragma('synchronous = FULL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
}

function createDatabaseTables(database: SqliteDatabase) {
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

    CREATE TABLE IF NOT EXISTS control_plane_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS control_plane_entity_index (
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      parent_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (entity_type, entity_id)
    );

    CREATE INDEX IF NOT EXISTS idx_control_plane_entity_index_type
      ON control_plane_entity_index (entity_type);

    CREATE INDEX IF NOT EXISTS idx_control_plane_entity_index_parent
      ON control_plane_entity_index (entity_type, parent_id);

    CREATE INDEX IF NOT EXISTS idx_control_plane_entity_index_status
      ON control_plane_entity_index (entity_type, status);
  `);
}

function upsertDatabaseMetadata(database: SqliteDatabase) {
  const upsertMeta = database.prepare(`
    INSERT INTO control_plane_meta (key, value)
    VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  upsertMeta.run({ key: 'schema_version', value: String(SQLITE_SCHEMA_VERSION) });
  upsertMeta.run({ key: 'state_format', value: SQLITE_STATE_FORMAT });
}

function applySupportedMigrations(database: SqliteDatabase, originLabel: string, now = new Date().toISOString()) {
  const existingRows = tableExists(database, 'control_plane_migrations') ? readMigrationRows(database) : [];
  const insertMigration = database.prepare(`
    INSERT INTO control_plane_migrations (version, name, checksum, applied_at)
    VALUES (@version, @name, @checksum, @appliedAt)
  `);

  for (const migration of SQLITE_MIGRATIONS) {
    const existingRow = existingRows.find((row) => row.version === migration.version);

    if (!existingRow) {
      insertMigration.run({
        version: migration.version,
        name: migration.name,
        checksum: migration.checksum,
        appliedAt: now
      });
      continue;
    }

    if (existingRow.name !== migration.name || existingRow.checksum !== migration.checksum) {
      throw new Error(`Invalid control-plane sqlite migration ${migration.version}: ${originLabel}`);
    }
  }
}

function initializeDatabase(database: SqliteDatabase, originLabel: string) {
  database.pragma('busy_timeout = 5000');

  const hasMetaTable = tableExists(database, 'control_plane_meta');
  const hasStateTable = tableExists(database, 'control_plane_state');

  if (hasMetaTable) {
    assertSupportedDatabaseMetadata(database, originLabel);
    configureDatabaseConnection(database);
    createDatabaseTables(database);
    applySupportedMigrations(database, originLabel);
    upsertDatabaseMetadata(database);
    assertSupportedMigrationLedger(database, originLabel);
    return;
  }

  if (hasStateTable) {
    throw new Error(`Missing control-plane sqlite metadata: ${originLabel}`);
  }

  configureDatabaseConnection(database);
  createDatabaseTables(database);
  applySupportedMigrations(database, originLabel);
  upsertDatabaseMetadata(database);
  assertSupportedMigrationLedger(database, originLabel);
}

function createEntityIndexRows(state: ControlPlaneRepositoryState, fallbackUpdatedAt: string): EntityIndexRow[] {
  const rows: EntityIndexRow[] = [];
  const pushRow = (input: Omit<EntityIndexRow, 'payload'> & { payload: Record<string, unknown> }) => {
    rows.push({
      ...input,
      parentId: input.parentId || '',
      status: input.status || '',
      label: input.label || '',
      updatedAt: input.updatedAt || fallbackUpdatedAt,
      payload: JSON.stringify(input.payload)
    });
  };

  state.tasks.forEach((task) => {
    pushRow({
      entityType: 'task',
      entityId: task.id,
      parentId: task.resourceId ?? task.targetId,
      status: task.status,
      label: task.targetLabel,
      updatedAt: task.updatedAt || task.createdAt,
      payload: {
        operation: task.operation,
        resourceType: task.resourceType,
        targetId: task.targetId,
        requestId: task.requestId,
        actor: task.actor
      }
    });
  });

  state.auditLogs.forEach((auditLog) => {
    pushRow({
      entityType: 'audit-log',
      entityId: auditLog.id,
      parentId: auditLog.targetId,
      status: auditLog.result,
      label: auditLog.action,
      updatedAt: auditLog.createdAt,
      payload: {
        action: auditLog.action,
        resourceType: auditLog.resourceType,
        actor: auditLog.actor,
        requestId: auditLog.requestId
      }
    });
  });

  state.commandOutbox.forEach((command) => {
    pushRow({
      entityType: 'command-outbox',
      entityId: command.id,
      parentId: command.taskId,
      status: command.status,
      label: command.commandId,
      updatedAt: command.updatedAt || command.createdAt,
      payload: {
        taskId: command.taskId,
        commandId: command.commandId,
        agentId: command.agentId,
        transport: command.transport,
        seq: command.seq
      }
    });
  });

  state.forwardRules.forEach((rule) => {
    pushRow({
      entityType: 'forward-rule',
      entityId: rule.id,
      parentId: rule.tunnelId,
      status: rule.enabled ? 'enabled' : 'disabled',
      label: rule.name,
      updatedAt: fallbackUpdatedAt,
      payload: {
        ownerName: rule.ownerName,
        protocol: rule.ports[0]?.protocol,
        listenPort: rule.ports[0]?.listenPort,
        targetAddress: rule.ports[0]?.targetAddress,
        targetPort: rule.ports[0]?.targetPort
      }
    });
  });

  state.subscriptionSources.forEach((source) => {
    pushRow({
      entityType: 'subscription-source',
      entityId: source.id,
      parentId: source.providerAccountId ?? '',
      status: source.status,
      label: source.name,
      updatedAt: source.lastSyncAt || fallbackUpdatedAt,
      payload: {
        kind: source.kind,
        nodeCount: source.nodeCount,
        dedupeKey: source.dedupeKey
      }
    });
  });

  state.subscriptionInventoryNodes.forEach((node) => {
    pushRow({
      entityType: 'subscription-inventory-node',
      entityId: `${node.sourceId}:${node.id}`,
      parentId: node.sourceId,
      status: node.status ?? 'unknown',
      label: node.name,
      updatedAt: fallbackUpdatedAt,
      payload: {
        nodeId: node.id,
        protocol: node.protocol,
        server: node.server,
        port: node.port,
        tags: node.tags,
        customerName: node.customerName,
        hostId: node.hostId,
        probeAgentId: node.probeAgentId
      }
    });
  });

  state.subscriptionClients.forEach((client) => {
    pushRow({
      entityType: 'subscription-client',
      entityId: client.id,
      parentId: client.subId,
      status: client.enabled ? 'enabled' : 'disabled',
      label: client.displayName,
      updatedAt: client.lastGeneratedAt ?? fallbackUpdatedAt,
      payload: {
        subId: client.subId,
        email: client.email,
        group: client.group,
        outputFormats: client.outputFormats ?? client.formats
      }
    });
  });

  state.configRevisions.forEach((revision) => {
    pushRow({
      entityType: 'runtime-config-revision',
      entityId: revision.id,
      parentId: revision.taskId,
      status: revision.status,
      label: revision.targetLabel,
      updatedAt: revision.appliedAt ?? revision.failedAt ?? revision.createdAt,
      payload: {
        operation: revision.operation,
        targetId: revision.targetId,
        agentId: revision.agentId,
        moduleKind: revision.moduleKind,
        checksum: revision.checksum,
        preflightPlanId: revision.preflightPlanId,
        snapshotBeforeId: revision.snapshotBeforeId,
        diffSummary: revision.diffSummary
      }
    });
  });

  state.preflightPlans.forEach((plan) => {
    pushRow({
      entityType: 'runtime-preflight-plan',
      entityId: plan.id,
      parentId: plan.configRevisionId,
      status: plan.status,
      label: plan.targetId,
      updatedAt: plan.completedAt ?? plan.createdAt,
      payload: {
        taskId: plan.taskId,
        targetId: plan.targetId,
        agentId: plan.agentId,
        moduleKind: plan.moduleKind,
        checkCount: plan.checks.length,
        criticalFailureCount: plan.checks.filter((check) => check.severity === 'critical' && check.status === 'failed').length
      }
    });
  });

  state.runtimeSnapshots.forEach((snapshot) => {
    pushRow({
      entityType: 'runtime-snapshot',
      entityId: snapshot.id,
      parentId: snapshot.taskId,
      status: snapshot.status,
      label: snapshot.targetLabel,
      updatedAt: snapshot.restoredAt ?? snapshot.verifiedAt ?? snapshot.capturedAt,
      payload: {
        targetId: snapshot.targetId,
        agentId: snapshot.agentId,
        moduleKind: snapshot.moduleKind,
        reason: snapshot.reason,
        checksum: snapshot.checksum,
        restoredByTaskId: snapshot.restoredByTaskId
      }
    });
  });

  state.trafficRollups.forEach((rollup) => {
    pushRow({
      entityType: 'traffic-rollup',
      entityId: rollup.id,
      parentId: rollup.subjectId,
      status: rollup.dimension,
      label: rollup.subjectLabel,
      updatedAt: rollup.observedAt,
      payload: {
        agentId: rollup.agentId,
        periodKey: rollup.periodKey,
        meteredBytes: rollup.meteredBytes,
        source: rollup.source
      }
    });
  });

  return rows;
}

function rebuildEntityIndex(database: SqliteDatabase, state: ControlPlaneRepositoryState, updatedAt: string) {
  const rows = createEntityIndexRows(state, updatedAt);
  const insertRow = database.prepare(`
    INSERT INTO control_plane_entity_index (
      entity_type,
      entity_id,
      parent_id,
      status,
      label,
      updated_at,
      payload
    )
    VALUES (
      @entityType,
      @entityId,
      @parentId,
      @status,
      @label,
      @updatedAt,
      @payload
    )
  `);

  database.prepare('DELETE FROM control_plane_entity_index').run();

  for (const row of rows) {
    insertRow.run(row);
  }
}

function readStateFromDatabase(database: SqliteDatabase, originLabel: string): ControlPlaneRepositoryState {
  assertSupportedDatabaseMetadata(database, originLabel);
  assertSupportedMigrationLedger(database, originLabel);

  const row = readExistingStateRow(database);

  if (!row) {
    throw new Error(`Missing control-plane database state row: ${originLabel}`);
  }

  return parseStatePayload(row.payload, originLabel);
}

function compactHighFrequencyAgentEventsForPersistence(
  state: ControlPlaneRepositoryState
): ControlPlaneRepositoryState {
  const counters = new Map<string, number>();
  const agentEvents = state.agentEvents.filter((event) => {
    if (!SQLITE_HIGH_FREQUENCY_AGENT_EVENT_TYPES.has(event.type)) {
      return true;
    }

    const key = `${event.agentId}\0${event.type}`;
    const count = counters.get(key) ?? 0;
    counters.set(key, count + 1);

    return count < SQLITE_MAX_HIGH_FREQUENCY_AGENT_EVENTS_PER_TYPE;
  });

  return agentEvents.length === state.agentEvents.length ? state : { ...state, agentEvents };
}

function writeStateToDatabase(database: SqliteDatabase, state: ControlPlaneRepositoryState, originLabel: string) {
  assertSupportedDatabaseMetadata(database, originLabel);
  assertSupportedMigrationLedger(database, originLabel);
  const updatedAt = new Date().toISOString();
  const persistedState = compactHighFrequencyAgentEventsForPersistence(state);

  database
    .prepare(
      `UPDATE control_plane_state
       SET payload = @payload, updated_at = @updatedAt
       WHERE id = @id`
    )
    .run({
      id: SQLITE_STATE_ROW_ID,
      payload: JSON.stringify(persistedState),
      updatedAt
    });
  rebuildEntityIndex(database, persistedState, updatedAt);
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

  try {
    initializeDatabase(database, input.databaseFilePath);
    database.exec('BEGIN IMMEDIATE');
    assertSupportedDatabaseMetadata(database, input.databaseFilePath);
    const existingRow = readExistingStateRow(database);

    if (!existingRow) {
      const state = loadLegacyState(input);
      const persistedState = compactHighFrequencyAgentEventsForPersistence(state);
      const updatedAt = new Date().toISOString();

      database
        .prepare(
          `INSERT INTO control_plane_state (id, payload, updated_at)
           VALUES (@id, @payload, @updatedAt)`
        )
        .run({
          id: SQLITE_STATE_ROW_ID,
          payload: JSON.stringify(persistedState),
          updatedAt
        });
      rebuildEntityIndex(database, persistedState, updatedAt);
    } else {
      const state = parseStatePayload(existingRow.payload, input.databaseFilePath);
      writeStateToDatabase(database, state, input.databaseFilePath);
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

          writeStateToDatabase(database, draft, input.databaseFilePath);
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

    async listAgentLogArchives() {
      return clone((await listState()).agentLogArchives);
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

    async getTelegramBotSettings() {
      return clone((await listState()).telegramBotSettings);
    },

    async getTelegramBotSecrets() {
      return clone((await listState()).telegramBotSecrets);
    },

    async listTelegramChatBindings() {
      return clone((await listState()).telegramChatBindings);
    },

    async listTelegramCustomerBindings() {
      return clone((await listState()).telegramCustomerBindings);
    },

    async listTelegramBindingChallenges() {
      return clone((await listState()).telegramBindingChallenges);
    },

    async listTelegramNotificationPolicies() {
      return clone((await listState()).telegramNotificationPolicies);
    },

    async listTelegramNotificationDeliveries() {
      return clone((await listState()).telegramNotificationDeliveries);
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

    async listTrafficRollupCompactions() {
      return clone((await listState()).trafficRollupCompactions);
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
