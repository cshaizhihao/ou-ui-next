#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');

const SQLITE_SCHEMA_VERSION = 2;
const SQLITE_STATE_ROW_ID = 1;
const SQLITE_STATE_FORMAT = 'json-state-v1';
const BACKUP_MANIFEST_SCHEMA_VERSION = 'ou-ui-next.control-plane-backup.v1';
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
];
const USAGE = [
  'usage:',
  '  control-plane-sqlite-tool.cjs backup <source-file> <destination-file>',
  '  control-plane-sqlite-tool.cjs restore <backup-file> <destination-file>',
  '  control-plane-sqlite-tool.cjs validate <sqlite-file>'
].join('\n');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalizePath(filePath) {
  return path.resolve(filePath);
}

function createMigrationChecksum(version, name, stateFormat) {
  return `sha256:${createHash('sha256')
    .update(`ou-ui-next.control-plane.sqlite:${version}:${name}:${stateFormat}`)
    .digest('hex')}`;
}

function backupManifestPath(filePath) {
  return `${filePath}.manifest.json`;
}

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readFileSize(filePath) {
  return fs.statSync(filePath).size;
}

function tableExists(database, tableName) {
  const row = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);

  return row !== undefined;
}

function readMigrationRows(database) {
  return database
    .prepare('SELECT version, name, checksum, applied_at FROM control_plane_migrations ORDER BY version ASC')
    .all();
}

function createEntityIndexTables(database) {
  database.exec(`
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

function upsertDatabaseMetadata(database) {
  const upsertMeta = database.prepare(`
    INSERT INTO control_plane_meta (key, value)
    VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  upsertMeta.run({ key: 'schema_version', value: String(SQLITE_SCHEMA_VERSION) });
  upsertMeta.run({ key: 'state_format', value: SQLITE_STATE_FORMAT });
}

function applySupportedMigrations(database, sourceFile) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS control_plane_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  createEntityIndexTables(database);

  const existingRows = readMigrationRows(database);
  const insertMigration = database.prepare(`
    INSERT INTO control_plane_migrations (version, name, checksum, applied_at)
    VALUES (@version, @name, @checksum, @appliedAt)
  `);
  const appliedAt = new Date().toISOString();

  for (const migration of SQLITE_MIGRATIONS) {
    const existingRow = existingRows.find((row) => row.version === migration.version);

    if (!existingRow) {
      insertMigration.run({
        version: migration.version,
        name: migration.name,
        checksum: migration.checksum,
        appliedAt
      });
      continue;
    }

    if (existingRow.name !== migration.name || existingRow.checksum !== migration.checksum) {
      fail(`sqlite database has invalid control-plane migration ${migration.version}: ${sourceFile}`);
    }
  }

  upsertDatabaseMetadata(database);
}

function validateMigrationLedger(database, sourceFile, options = {}) {
  if (!tableExists(database, 'control_plane_migrations')) {
    if (options.allowMissingMigrationLedger) {
      return;
    }

    fail(`sqlite database is missing control-plane migration ledger: ${sourceFile}`);
  }

  const rows = readMigrationRows(database);
  const latestVersion = Math.max(0, ...rows.map((row) => row.version));

  if (latestVersion > SQLITE_SCHEMA_VERSION) {
    fail(
      `sqlite database uses unsupported control-plane migration version ${latestVersion}; ` +
      `this tool supports ${SQLITE_SCHEMA_VERSION}: ${sourceFile}`
    );
  }

  for (const migration of SQLITE_MIGRATIONS) {
    const row = rows.find((item) => item.version === migration.version);

    if (!row) {
      fail(`sqlite database is missing control-plane migration ${migration.version}: ${sourceFile}`);
    }

    if (row.name !== migration.name || row.checksum !== migration.checksum) {
      fail(`sqlite database has invalid control-plane migration ${migration.version}: ${sourceFile}`);
    }
  }
}

function validateBackupManifestIfPresent(backupFile) {
  const manifestPath = backupManifestPath(backupFile);

  if (!fs.existsSync(manifestPath)) {
    return;
  }

  let manifest;

  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`control-plane backup manifest is not valid JSON: ${manifestPath}\n${message}`);
  }

  if (!manifest || typeof manifest !== 'object') {
    fail(`control-plane backup manifest is not a JSON object: ${manifestPath}`);
  }

  if (manifest.schemaVersion !== BACKUP_MANIFEST_SCHEMA_VERSION) {
    fail(
      `control-plane backup manifest uses unsupported schemaVersion "${manifest.schemaVersion}"; ` +
      `this tool supports "${BACKUP_MANIFEST_SCHEMA_VERSION}": ${manifestPath}`
    );
  }

  if (typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(manifest.sha256)) {
    fail(`control-plane backup manifest is missing a valid sha256 digest: ${manifestPath}`);
  }

  if (!Number.isSafeInteger(manifest.sizeBytes) || manifest.sizeBytes < 0) {
    fail(`control-plane backup manifest is missing a valid sizeBytes value: ${manifestPath}`);
  }

  const actualSha256 = sha256File(backupFile);
  const actualSizeBytes = readFileSize(backupFile);

  if (actualSha256 !== manifest.sha256.toLowerCase()) {
    fail(`control-plane backup manifest SHA-256 mismatch: ${backupFile}`);
  }

  if (actualSizeBytes !== manifest.sizeBytes) {
    fail(`control-plane backup manifest size mismatch: ${backupFile}`);
  }
}

function writeBackupManifest(sourceFile, backupFile) {
  const manifestPath = backupManifestPath(backupFile);
  const database = new Database(backupFile, { fileMustExist: true, readonly: true });
  let sqliteMigrations;

  try {
    sqliteMigrations = readMigrationRows(database).map((row) => ({
      version: row.version,
      name: row.name,
      checksum: row.checksum,
      appliedAt: row.applied_at
    }));
  } finally {
    database.close();
  }

  const manifest = {
    schemaVersion: BACKUP_MANIFEST_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    storageMode: 'sqlite',
    sourceFile,
    backupFile,
    sizeBytes: readFileSize(backupFile),
    sha256: sha256File(backupFile),
    sqliteSchemaVersion: SQLITE_SCHEMA_VERSION,
    stateFormat: SQLITE_STATE_FORMAT,
    sqliteMigrations,
    tool: 'control-plane-sqlite-tool.cjs'
  };

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(manifestPath, 0o600);
  } catch {
    // Best-effort on filesystems that do not support chmod.
  }
}

function parseSchemaVersion(rawVersion, sourceFile) {
  if (typeof rawVersion !== 'string' || !/^\d+$/.test(rawVersion)) {
    fail(`sqlite database has invalid control-plane schema_version "${rawVersion}": ${sourceFile}`);
  }

  const schemaVersion = Number(rawVersion);

  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    fail(`sqlite database has invalid control-plane schema_version "${rawVersion}": ${sourceFile}`);
  }

  return schemaVersion;
}

function ensureSourceExists(sourceFile) {
  if (!sourceFile) {
    fail(USAGE);
  }

  if (!fs.existsSync(sourceFile)) {
    fail(`sqlite source file does not exist: ${sourceFile}`);
  }
}

function validateControlPlaneDatabase(database, sourceFile, options = {}) {
  try {
    const schemaVersion = database
      .prepare("SELECT value FROM control_plane_meta WHERE key = 'schema_version'")
      .get();
    const stateFormat = database
      .prepare("SELECT value FROM control_plane_meta WHERE key = 'state_format'")
      .get();
    const stateRow = database
      .prepare('SELECT payload FROM control_plane_state WHERE id = ?')
      .get(SQLITE_STATE_ROW_ID);

    if (!schemaVersion || !stateFormat) {
      fail(`sqlite database is missing control-plane metadata: ${sourceFile}`);
    }

    const parsedSchemaVersion = parseSchemaVersion(schemaVersion.value, sourceFile);

    if (parsedSchemaVersion > SQLITE_SCHEMA_VERSION) {
      fail(
        `sqlite database uses unsupported control-plane schema_version ${parsedSchemaVersion}; ` +
        `this tool supports ${SQLITE_SCHEMA_VERSION}: ${sourceFile}`
      );
    }

    if (stateFormat.value !== SQLITE_STATE_FORMAT) {
      fail(
        `sqlite database uses unsupported control-plane state_format "${stateFormat.value}"; ` +
        `this tool supports "${SQLITE_STATE_FORMAT}": ${sourceFile}`
      );
    }

    if (!stateRow || typeof stateRow.payload !== 'string') {
      fail(`sqlite database is missing control-plane state row ${SQLITE_STATE_ROW_ID}: ${sourceFile}`);
    }

    validateMigrationLedger(database, sourceFile, {
      allowMissingMigrationLedger: options.allowMissingMigrationLedger === true
    });

    const payload = JSON.parse(stateRow.payload);
    if (!payload || typeof payload !== 'object') {
      fail(`sqlite control-plane payload is not a JSON object: ${sourceFile}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`sqlite database is not a valid control-plane store: ${sourceFile}\n${message}`);
  }
}

async function cloneSqliteDatabase(sourceFile, destinationFile, options = {}) {
  ensureSourceExists(sourceFile);

  if (!destinationFile) {
    fail(USAGE);
  }

  const normalizedSource = normalizePath(sourceFile);
  const normalizedDestination = normalizePath(destinationFile);

  if (normalizedSource === normalizedDestination) {
    fail('sqlite source and destination must be different files');
  }

  if (options.validateSourceManifest) {
    validateBackupManifestIfPresent(normalizedSource);
  }

  fs.mkdirSync(path.dirname(normalizedDestination), { recursive: true });
  fs.rmSync(normalizedDestination, { force: true });
  fs.rmSync(`${normalizedDestination}-shm`, { force: true });
  fs.rmSync(`${normalizedDestination}-wal`, { force: true });
  fs.rmSync(backupManifestPath(normalizedDestination), { force: true });

  const sourceDatabase = new Database(normalizedSource, { fileMustExist: true });

  try {
    if (options.applySourceMigrations) {
      applySupportedMigrations(sourceDatabase, normalizedSource);
    }
    validateControlPlaneDatabase(sourceDatabase, normalizedSource, {
      allowMissingMigrationLedger: options.allowMissingMigrationLedger === true
    });
    await sourceDatabase.backup(normalizedDestination);
  } finally {
    sourceDatabase.close();
  }

  const restoredDatabase = new Database(normalizedDestination, { fileMustExist: true });
  try {
    if (options.applyDestinationMigrations) {
      applySupportedMigrations(restoredDatabase, normalizedDestination);
    }
    validateControlPlaneDatabase(restoredDatabase, normalizedDestination);
  } finally {
    restoredDatabase.close();
  }

  if (options.writeDestinationManifest) {
    writeBackupManifest(normalizedSource, normalizedDestination);
  }
}

function validateSqliteDatabase(sourceFile) {
  ensureSourceExists(sourceFile);

  const normalizedSource = normalizePath(sourceFile);
  validateBackupManifestIfPresent(normalizedSource);

  const database = new Database(normalizedSource, { fileMustExist: true, readonly: true });

  try {
    validateControlPlaneDatabase(database, normalizedSource);
  } finally {
    database.close();
  }
}

async function main() {
  const [command, sourceFile, destinationFile] = process.argv.slice(2);

  switch (command) {
    case 'backup':
      await cloneSqliteDatabase(sourceFile, destinationFile, {
        applySourceMigrations: true,
        writeDestinationManifest: true
      });
      return;
    case 'restore':
      await cloneSqliteDatabase(sourceFile, destinationFile, {
        validateSourceManifest: true,
        allowMissingMigrationLedger: true,
        applyDestinationMigrations: true
      });
      return;
    case 'validate':
      validateSqliteDatabase(sourceFile);
      return;
    default:
      fail(USAGE);
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(message);
});
