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
const SQLITE_DEFAULT_MAX_HIGH_FREQUENCY_AGENT_EVENTS_PER_TYPE = 30;
const SQLITE_MAX_HIGH_FREQUENCY_AGENT_EVENTS_PER_TYPE_ENV = 'OU_UI_SQLITE_HIGH_FREQUENCY_AGENT_EVENTS_PER_TYPE';
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
type EntityIndexMutation =
  | { kind: 'upsert'; createRow: (fallbackUpdatedAt: string) => EntityIndexRow | undefined }
  | { kind: 'delete'; entityType: string; entityId: string }
  | { kind: 'deleteByParent'; entityType: string; parentId: string }
  | { kind: 'rebuild' };

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

function stateRowExists(database: SqliteDatabase) {
  return (
    database
      .prepare('SELECT 1 FROM control_plane_state WHERE id = ?')
      .get(SQLITE_STATE_ROW_ID) as { '1': number } | undefined
  ) !== undefined;
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
  const appliedVersions: number[] = [];
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
      appliedVersions.push(migration.version);
      continue;
    }

    if (existingRow.name !== migration.name || existingRow.checksum !== migration.checksum) {
      throw new Error(`Invalid control-plane sqlite migration ${migration.version}: ${originLabel}`);
    }
  }

  return appliedVersions;
}

function initializeDatabase(database: SqliteDatabase, originLabel: string) {
  database.pragma('busy_timeout = 5000');

  const hasMetaTable = tableExists(database, 'control_plane_meta');
  const hasStateTable = tableExists(database, 'control_plane_state');

  if (hasMetaTable) {
    assertSupportedDatabaseMetadata(database, originLabel);
    configureDatabaseConnection(database);
    createDatabaseTables(database);
    const appliedMigrations = applySupportedMigrations(database, originLabel);
    upsertDatabaseMetadata(database);
    assertSupportedMigrationLedger(database, originLabel);
    return { appliedMigrations };
  }

  if (hasStateTable) {
    throw new Error(`Missing control-plane sqlite metadata: ${originLabel}`);
  }

  configureDatabaseConnection(database);
  createDatabaseTables(database);
  const appliedMigrations = applySupportedMigrations(database, originLabel);
  upsertDatabaseMetadata(database);
  assertSupportedMigrationLedger(database, originLabel);
  return { appliedMigrations };
}

function createEntityIndexRow(
  input: Omit<EntityIndexRow, 'payload'> & { payload: Record<string, unknown> },
  fallbackUpdatedAt: string
): EntityIndexRow {
  return {
    ...input,
    parentId: input.parentId || '',
    status: input.status || '',
    label: input.label || '',
    updatedAt: input.updatedAt || fallbackUpdatedAt,
    payload: JSON.stringify(input.payload)
  };
}

function createTaskEntityIndexRow(state: ControlPlaneRepositoryState, taskId: string, fallbackUpdatedAt: string) {
  const task = state.tasks.find((item) => item.id === taskId);

  return task
    ? createEntityIndexRow({
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
      }, fallbackUpdatedAt)
    : undefined;
}

function createAuditLogEntityIndexRow(state: ControlPlaneRepositoryState, auditLogId: string, fallbackUpdatedAt: string) {
  const auditLog = state.auditLogs.find((item) => item.id === auditLogId);

  return auditLog
    ? createEntityIndexRow({
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
      }, fallbackUpdatedAt)
    : undefined;
}

function createCommandOutboxEntityIndexRow(
  state: ControlPlaneRepositoryState,
  commandOutboxItemId: string,
  fallbackUpdatedAt: string
) {
  const command = state.commandOutbox.find((item) => item.id === commandOutboxItemId);

  return command
    ? createEntityIndexRow({
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
      }, fallbackUpdatedAt)
    : undefined;
}

function createForwardRuleEntityIndexRow(state: ControlPlaneRepositoryState, ruleId: string, fallbackUpdatedAt: string) {
  const rule = state.forwardRules.find((item) => item.id === ruleId);

  return rule
    ? createEntityIndexRow({
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
      }, fallbackUpdatedAt)
    : undefined;
}

function createSubscriptionSourceEntityIndexRow(
  state: ControlPlaneRepositoryState,
  sourceId: string,
  fallbackUpdatedAt: string
) {
  const source = state.subscriptionSources.find((item) => item.id === sourceId);

  return source
    ? createEntityIndexRow({
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
      }, fallbackUpdatedAt)
    : undefined;
}

function createSubscriptionInventoryNodeEntityIndexRow(
  node: ControlPlaneRepositoryState['subscriptionInventoryNodes'][number],
  fallbackUpdatedAt: string
) {
  return createEntityIndexRow({
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
  }, fallbackUpdatedAt);
}

function createSubscriptionClientEntityIndexRow(
  state: ControlPlaneRepositoryState,
  clientId: string,
  fallbackUpdatedAt: string
) {
  const client = state.subscriptionClients.find((item) => item.id === clientId);

  return client
    ? createEntityIndexRow({
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
      }, fallbackUpdatedAt)
    : undefined;
}

function createConfigRevisionEntityIndexRow(
  state: ControlPlaneRepositoryState,
  revisionId: string,
  fallbackUpdatedAt: string
) {
  const revision = state.configRevisions.find((item) => item.id === revisionId);

  return revision
    ? createEntityIndexRow({
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
      }, fallbackUpdatedAt)
    : undefined;
}

function createPreflightPlanEntityIndexRow(state: ControlPlaneRepositoryState, planId: string, fallbackUpdatedAt: string) {
  const plan = state.preflightPlans.find((item) => item.id === planId);

  return plan
    ? createEntityIndexRow({
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
      }, fallbackUpdatedAt)
    : undefined;
}

function createRuntimeSnapshotEntityIndexRow(
  state: ControlPlaneRepositoryState,
  snapshotId: string,
  fallbackUpdatedAt: string
) {
  const snapshot = state.runtimeSnapshots.find((item) => item.id === snapshotId);

  return snapshot
    ? createEntityIndexRow({
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
      }, fallbackUpdatedAt)
    : undefined;
}

function createTrafficRollupEntityIndexRow(
  state: ControlPlaneRepositoryState,
  trafficRollupId: string,
  fallbackUpdatedAt: string
) {
  const rollup = state.trafficRollups.find((item) => item.id === trafficRollupId);

  return rollup
    ? createEntityIndexRow({
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
      }, fallbackUpdatedAt)
    : undefined;
}

function createEntityIndexRows(state: ControlPlaneRepositoryState, fallbackUpdatedAt: string): EntityIndexRow[] {
  const rows: EntityIndexRow[] = [];
  const pushDefinedRow = (row: EntityIndexRow | undefined) => {
    if (row) {
      rows.push(row);
    }
  };

  state.tasks.forEach((task) => {
    pushDefinedRow(createTaskEntityIndexRow(state, task.id, fallbackUpdatedAt));
  });

  state.auditLogs.forEach((auditLog) => {
    pushDefinedRow(createAuditLogEntityIndexRow(state, auditLog.id, fallbackUpdatedAt));
  });

  state.commandOutbox.forEach((command) => {
    pushDefinedRow(createCommandOutboxEntityIndexRow(state, command.id, fallbackUpdatedAt));
  });

  state.forwardRules.forEach((rule) => {
    pushDefinedRow(createForwardRuleEntityIndexRow(state, rule.id, fallbackUpdatedAt));
  });

  state.subscriptionSources.forEach((source) => {
    pushDefinedRow(createSubscriptionSourceEntityIndexRow(state, source.id, fallbackUpdatedAt));
  });

  state.subscriptionInventoryNodes.forEach((node) => {
    pushDefinedRow(createSubscriptionInventoryNodeEntityIndexRow(node, fallbackUpdatedAt));
  });

  state.subscriptionClients.forEach((client) => {
    pushDefinedRow(createSubscriptionClientEntityIndexRow(state, client.id, fallbackUpdatedAt));
  });

  state.configRevisions.forEach((revision) => {
    pushDefinedRow(createConfigRevisionEntityIndexRow(state, revision.id, fallbackUpdatedAt));
  });

  state.preflightPlans.forEach((plan) => {
    pushDefinedRow(createPreflightPlanEntityIndexRow(state, plan.id, fallbackUpdatedAt));
  });

  state.runtimeSnapshots.forEach((snapshot) => {
    pushDefinedRow(createRuntimeSnapshotEntityIndexRow(state, snapshot.id, fallbackUpdatedAt));
  });

  state.trafficRollups.forEach((rollup) => {
    pushDefinedRow(createTrafficRollupEntityIndexRow(state, rollup.id, fallbackUpdatedAt));
  });

  return rows;
}

function createEntityIndexMutationTracker(state: ControlPlaneRepositoryState) {
  const mutations: EntityIndexMutation[] = [];
  const upsert = (createRow: (fallbackUpdatedAt: string) => EntityIndexRow | undefined) => {
    mutations.push({
      kind: 'upsert',
      createRow
    });
  };

  return {
    mutations,
    rebuild() {
      mutations.push({ kind: 'rebuild' });
    },
    task(taskId: string) {
      upsert((fallbackUpdatedAt) => createTaskEntityIndexRow(state, taskId, fallbackUpdatedAt));
    },
    auditLog(auditLogId: string) {
      upsert((fallbackUpdatedAt) => createAuditLogEntityIndexRow(state, auditLogId, fallbackUpdatedAt));
    },
    commandOutboxItem(commandOutboxItemId: string) {
      upsert((fallbackUpdatedAt) => createCommandOutboxEntityIndexRow(state, commandOutboxItemId, fallbackUpdatedAt));
    },
    subscriptionSource(sourceId: string) {
      upsert((fallbackUpdatedAt) => createSubscriptionSourceEntityIndexRow(state, sourceId, fallbackUpdatedAt));
    },
    deleteSubscriptionSource(sourceId: string) {
      mutations.push({ kind: 'delete', entityType: 'subscription-source', entityId: sourceId });
      mutations.push({ kind: 'deleteByParent', entityType: 'subscription-inventory-node', parentId: sourceId });
    },
    subscriptionClient(clientId: string) {
      upsert((fallbackUpdatedAt) => createSubscriptionClientEntityIndexRow(state, clientId, fallbackUpdatedAt));
    },
    deleteSubscriptionClient(clientId: string) {
      mutations.push({ kind: 'delete', entityType: 'subscription-client', entityId: clientId });
    },
    replaceSubscriptionInventoryNodes(sourceId: string, nodes: ControlPlaneRepositoryState['subscriptionInventoryNodes']) {
      mutations.push({ kind: 'deleteByParent', entityType: 'subscription-inventory-node', parentId: sourceId });
      nodes.forEach((node) => {
        upsert((fallbackUpdatedAt) => createSubscriptionInventoryNodeEntityIndexRow(node, fallbackUpdatedAt));
      });
    },
    configRevision(revisionId: string) {
      upsert((fallbackUpdatedAt) => createConfigRevisionEntityIndexRow(state, revisionId, fallbackUpdatedAt));
    },
    preflightPlan(planId: string) {
      upsert((fallbackUpdatedAt) => createPreflightPlanEntityIndexRow(state, planId, fallbackUpdatedAt));
    },
    runtimeSnapshot(snapshotId: string) {
      upsert((fallbackUpdatedAt) => createRuntimeSnapshotEntityIndexRow(state, snapshotId, fallbackUpdatedAt));
    },
    trafficRollup(trafficRollupId: string) {
      upsert((fallbackUpdatedAt) => createTrafficRollupEntityIndexRow(state, trafficRollupId, fallbackUpdatedAt));
    },
    trafficRollupIds() {
      return new Set(state.trafficRollups.map((rollup) => rollup.id));
    },
    prunedTrafficRollups(previousRollupIds: Set<string>) {
      const retainedRollupIds = new Set(state.trafficRollups.map((rollup) => rollup.id));

      for (const rollupId of previousRollupIds) {
        if (!retainedRollupIds.has(rollupId)) {
          mutations.push({ kind: 'delete', entityType: 'traffic-rollup', entityId: rollupId });
        }
      }
    }
  };
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

function applyEntityIndexMutations(
  database: SqliteDatabase,
  state: ControlPlaneRepositoryState,
  mutations: EntityIndexMutation[],
  updatedAt: string
) {
  if (mutations.length === 0) {
    return;
  }

  if (mutations.some((mutation) => mutation.kind === 'rebuild')) {
    rebuildEntityIndex(database, state, updatedAt);
    return;
  }

  const upsertRow = database.prepare(`
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
    ON CONFLICT(entity_type, entity_id) DO UPDATE SET
      parent_id = excluded.parent_id,
      status = excluded.status,
      label = excluded.label,
      updated_at = excluded.updated_at,
      payload = excluded.payload
  `);
  const deleteRow = database.prepare(`
    DELETE FROM control_plane_entity_index
    WHERE entity_type = @entityType AND entity_id = @entityId
  `);
  const deleteRowsByParent = database.prepare(`
    DELETE FROM control_plane_entity_index
    WHERE entity_type = @entityType AND parent_id = @parentId
  `);

  for (const mutation of mutations) {
    if (mutation.kind === 'upsert') {
      const row = mutation.createRow(updatedAt);

      if (row) {
        upsertRow.run(row);
      }
      continue;
    }

    if (mutation.kind === 'delete') {
      deleteRow.run({
        entityType: mutation.entityType,
        entityId: mutation.entityId
      });
      continue;
    }

    if (mutation.kind === 'deleteByParent') {
      deleteRowsByParent.run({
        entityType: mutation.entityType,
        parentId: mutation.parentId
      });
    }
  }
}

function createEntityIndexingTransaction(
  transaction: ControlPlaneTransaction,
  tracker: ReturnType<typeof createEntityIndexMutationTracker>
): ControlPlaneTransaction {
  return {
    ...transaction,
    async insertTask(task) {
      await transaction.insertTask(task);
      tracker.task(task.id);
    },
    async updateTask(task) {
      await transaction.updateTask(task);
      tracker.task(task.id);
    },
    async insertAuditLog(auditLog) {
      await transaction.insertAuditLog(auditLog);
      tracker.auditLog(auditLog.id);
    },
    async updateCommandOutboxItem(item) {
      await transaction.updateCommandOutboxItem(item);
      tracker.commandOutboxItem(item.id);
    },
    async insertCommandOutbox(item) {
      await transaction.insertCommandOutbox(item);
      tracker.commandOutboxItem(item.id);
    },
    async upsertSubscriptionSource(source) {
      await transaction.upsertSubscriptionSource(source);
      tracker.subscriptionSource(source.id);
    },
    async deleteSubscriptionSource(sourceId) {
      await transaction.deleteSubscriptionSource(sourceId);
      tracker.deleteSubscriptionSource(sourceId);
    },
    async upsertSubscriptionClient(client) {
      await transaction.upsertSubscriptionClient(client);
      tracker.subscriptionClient(client.id);
    },
    async deleteSubscriptionClient(clientId) {
      await transaction.deleteSubscriptionClient(clientId);
      tracker.deleteSubscriptionClient(clientId);
    },
    async replaceSubscriptionInventoryNodesForSource(sourceId, nodes) {
      await transaction.replaceSubscriptionInventoryNodesForSource(sourceId, nodes);
      tracker.replaceSubscriptionInventoryNodes(sourceId, nodes);
    },
    async pruneTrafficRollups(policy, now) {
      const previousRollupIds = tracker.trafficRollupIds();
      const result = await transaction.pruneTrafficRollups(policy, now);
      tracker.prunedTrafficRollups(previousRollupIds);
      return result;
    },
    async insertConfigRevision(configRevision) {
      await transaction.insertConfigRevision(configRevision);
      tracker.configRevision(configRevision.id);
    },
    async updateConfigRevision(configRevision) {
      await transaction.updateConfigRevision(configRevision);
      tracker.configRevision(configRevision.id);
    },
    async insertPreflightPlan(preflightPlan) {
      await transaction.insertPreflightPlan(preflightPlan);
      tracker.preflightPlan(preflightPlan.id);
    },
    async updatePreflightPlan(preflightPlan) {
      await transaction.updatePreflightPlan(preflightPlan);
      tracker.preflightPlan(preflightPlan.id);
    },
    async insertRuntimeSnapshot(runtimeSnapshot) {
      await transaction.insertRuntimeSnapshot(runtimeSnapshot);
      tracker.runtimeSnapshot(runtimeSnapshot.id);
    },
    async updateRuntimeSnapshot(runtimeSnapshot) {
      await transaction.updateRuntimeSnapshot(runtimeSnapshot);
      tracker.runtimeSnapshot(runtimeSnapshot.id);
    },
    async insertTrafficRollup(trafficRollup) {
      await transaction.insertTrafficRollup(trafficRollup);
      tracker.trafficRollup(trafficRollup.id);
    }
  };
}

const CONTROL_PLANE_MUTATION_METHODS: Array<keyof ControlPlaneTransaction> = [
  'insertTask',
  'updateTask',
  'insertAuditLog',
  'updateCommandOutboxItem',
  'insertCommandOutbox',
  'insertAgentEvent',
  'setAgentLogRetentionPolicy',
  'pruneAgentLogEvents',
  'setTrafficRollupRetentionPolicy',
  'pruneTrafficRollups',
  'upsertAgentSession',
  'upsertOperatorSession',
  'upsertAgentCredential',
  'insertIdempotencyRecord',
  'upsertSubscriptionSource',
  'deleteSubscriptionSource',
  'upsertSubscriptionClient',
  'deleteSubscriptionClient',
  'upsertSubscriptionExportProfile',
  'deleteSubscriptionExportProfile',
  'replaceSubscriptionInventoryNodesForSource',
  'replaceSystemAlertRecords',
  'replaceSystemAlertNotificationDeliveries',
  'setTelegramBotSettings',
  'setTelegramBotSecrets',
  'upsertTelegramChatBinding',
  'upsertTelegramCustomerBinding',
  'upsertTelegramBindingChallenge',
  'upsertTelegramBindingChallengeSecret',
  'upsertTelegramNotificationPolicy',
  'replaceTelegramNotificationDeliveries',
  'upsertTelegramNotificationDelivery',
  'upsertPermissionGrant',
  'insertConfigRevision',
  'updateConfigRevision',
  'insertPreflightPlan',
  'updatePreflightPlan',
  'insertRuntimeSnapshot',
  'updateRuntimeSnapshot',
  'insertTrafficRollup',
  'upsertTrafficRollupCompactions'
];

function createDirtyTrackingTransaction(
  transaction: ControlPlaneTransaction,
  markDirty: () => void
): ControlPlaneTransaction {
  const tracked = { ...transaction } as Record<keyof ControlPlaneTransaction, unknown>;

  for (const methodName of CONTROL_PLANE_MUTATION_METHODS) {
    const method = transaction[methodName] as (...args: unknown[]) => Promise<unknown>;

    tracked[methodName] = async (...args: unknown[]) => {
      markDirty();
      return method(...args);
    };
  }

  return tracked as ControlPlaneTransaction;
}

function readMaxHighFrequencyAgentEventsPerType() {
  const rawValue = process.env[SQLITE_MAX_HIGH_FREQUENCY_AGENT_EVENTS_PER_TYPE_ENV];
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : NaN;

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return SQLITE_DEFAULT_MAX_HIGH_FREQUENCY_AGENT_EVENTS_PER_TYPE;
  }

  return Math.min(parsedValue, 500);
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
  const maxEventsPerType = readMaxHighFrequencyAgentEventsPerType();
  const agentEvents = state.agentEvents.filter((event) => {
    if (!SQLITE_HIGH_FREQUENCY_AGENT_EVENT_TYPES.has(event.type)) {
      return true;
    }

    const key = `${event.agentId}\0${event.type}`;
    const count = counters.get(key) ?? 0;
    counters.set(key, count + 1);

    return count < maxEventsPerType;
  });

  return agentEvents.length === state.agentEvents.length ? state : { ...state, agentEvents };
}

function writeStateToDatabase(
  database: SqliteDatabase,
  state: ControlPlaneRepositoryState,
  originLabel: string,
  entityIndexMutations?: EntityIndexMutation[]
) {
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
  if (entityIndexMutations) {
    applyEntityIndexMutations(database, persistedState, entityIndexMutations, updatedAt);
  } else {
    rebuildEntityIndex(database, persistedState, updatedAt);
  }
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
    const initialization = initializeDatabase(database, input.databaseFilePath);
    database.exec('BEGIN IMMEDIATE');
    assertSupportedDatabaseMetadata(database, input.databaseFilePath);
    const hasStateRow = stateRowExists(database);

    if (!hasStateRow) {
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
    } else if (initialization.appliedMigrations.includes(2)) {
      const state = readStateFromDatabase(database, input.databaseFilePath);
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
          const tracker = createEntityIndexMutationTracker(draft);
          let dirty = false;
          const transaction = createDirtyTrackingTransaction(createControlPlaneTransaction(draft), () => {
            dirty = true;
          });
          const result = await run(createEntityIndexingTransaction(transaction, tracker));

          if (dirty) {
            writeStateToDatabase(database, draft, input.databaseFilePath, tracker.mutations);
          }
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

    async readStateSnapshot() {
      return listState();
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
