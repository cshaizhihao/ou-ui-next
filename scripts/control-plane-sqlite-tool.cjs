#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const SQLITE_STATE_ROW_ID = 1;
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

async function cloneSqliteDatabase(sourceFile, destinationFile) {
  ensureSourceExists(sourceFile);

  if (!destinationFile) {
    fail(USAGE);
  }

  const normalizedSource = normalizePath(sourceFile);
  const normalizedDestination = normalizePath(destinationFile);

  if (normalizedSource === normalizedDestination) {
    fail('sqlite source and destination must be different files');
  }

  fs.mkdirSync(path.dirname(normalizedDestination), { recursive: true });
  fs.rmSync(normalizedDestination, { force: true });
  fs.rmSync(`${normalizedDestination}-shm`, { force: true });
  fs.rmSync(`${normalizedDestination}-wal`, { force: true });

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
}

function validateSqliteDatabase(sourceFile) {
  ensureSourceExists(sourceFile);

  const normalizedSource = normalizePath(sourceFile);
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
    case 'restore':
      await cloneSqliteDatabase(sourceFile, destinationFile);
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
