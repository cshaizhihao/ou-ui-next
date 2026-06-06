#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');

const SQLITE_SCHEMA_VERSION = 1;
const SQLITE_STATE_ROW_ID = 1;
const SQLITE_STATE_FORMAT = 'json-state-v1';
const BACKUP_MANIFEST_SCHEMA_VERSION = 'ou-ui-next.control-plane-backup.v1';
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

function backupManifestPath(filePath) {
  return `${filePath}.manifest.json`;
}

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readFileSize(filePath) {
  return fs.statSync(filePath).size;
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

function validateControlPlaneDatabase(database, sourceFile) {
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

    if (parsedSchemaVersion !== SQLITE_SCHEMA_VERSION) {
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
    validateControlPlaneDatabase(sourceDatabase, normalizedSource);
    await sourceDatabase.backup(normalizedDestination);
  } finally {
    sourceDatabase.close();
  }

  const restoredDatabase = new Database(normalizedDestination, { fileMustExist: true });
  try {
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
      await cloneSqliteDatabase(sourceFile, destinationFile, { writeDestinationManifest: true });
      return;
    case 'restore':
      await cloneSqliteDatabase(sourceFile, destinationFile, { validateSourceManifest: true });
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
