import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuditLog } from '../../domain';
import type { ControlPlaneRepository, ControlPlaneTransaction } from './control-plane-repository';

export type AuditAnchorRecord = {
  auditLogId: string;
  action: AuditLog['action'];
  operation: AuditLog['operation'];
  result: AuditLog['result'];
  severity: AuditLog['severity'];
  actor: string;
  scope: string;
  resourceType: AuditLog['resourceType'];
  targetId: string;
  taskId: string;
  requestId: string;
  createdAt: string;
  hash: string;
  prevHash: string;
};

export type AuditAnchorEnvelope = {
  schemaVersion: 'ou-ui-next.audit-anchor.v1';
  anchoredAt: string;
  audit: AuditAnchorRecord;
};

export type AuditAnchorSinkContext = {
  anchoredAt: string;
};

export type ControlPlaneAuditAnchorSink = {
  writeAuditAnchors(auditLogs: AuditLog[], context: AuditAnchorSinkContext): Promise<void>;
};

export type AuditAnchorSinkBatch = {
  auditLogs: AuditLog[];
  anchoredAt: string;
};

export type ControlPlaneAuditAnchorSinkErrorHandler = (error: unknown, batch: AuditAnchorSinkBatch) => void;

export type FileControlPlaneAuditAnchorSinkOptions = {
  directory: string;
};

export type AuditAnchorRepositoryOptions = {
  sink: ControlPlaneAuditAnchorSink;
  now?: () => string;
  onError?: ControlPlaneAuditAnchorSinkErrorHandler;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createAuditAnchorRecord(auditLog: AuditLog): AuditAnchorRecord {
  return {
    auditLogId: auditLog.id,
    action: auditLog.action,
    operation: auditLog.operation,
    result: auditLog.result,
    severity: auditLog.severity,
    actor: auditLog.actor,
    scope: auditLog.scope,
    resourceType: auditLog.resourceType,
    targetId: auditLog.targetId,
    taskId: auditLog.taskId,
    requestId: auditLog.requestId,
    createdAt: auditLog.createdAt,
    hash: auditLog.hash ?? '',
    prevHash: auditLog.prevHash ?? ''
  };
}

function createAuditAnchorEnvelopes(auditLogs: AuditLog[], anchoredAt: string): AuditAnchorEnvelope[] {
  return auditLogs.map((auditLog) => ({
    schemaVersion: 'ou-ui-next.audit-anchor.v1',
    anchoredAt,
    audit: createAuditAnchorRecord(auditLog)
  }));
}

function createJsonlContent(envelopes: AuditAnchorEnvelope[]) {
  if (envelopes.length === 0) {
    return '';
  }

  return `${envelopes.map((envelope) => JSON.stringify(envelope)).join('\n')}\n`;
}

export function createFileControlPlaneAuditAnchorSink(
  options: FileControlPlaneAuditAnchorSinkOptions
): ControlPlaneAuditAnchorSink {
  const directory = options.directory.trim();

  if (!directory) {
    throw new Error('Audit anchor sink directory must not be empty.');
  }

  return {
    async writeAuditAnchors(auditLogs, context) {
      if (auditLogs.length === 0) {
        return;
      }

      await mkdir(directory, { recursive: true });
      await appendFile(
        join(directory, 'audit-anchors.jsonl'),
        createJsonlContent(createAuditAnchorEnvelopes(auditLogs, context.anchoredAt)),
        'utf8'
      );
    }
  };
}

function createAnchoredTransaction(
  transaction: ControlPlaneTransaction,
  auditLogs: AuditLog[]
): ControlPlaneTransaction {
  return {
    ...transaction,
    async insertAuditLog(auditLog) {
      await transaction.insertAuditLog(auditLog);
      auditLogs.push(clone(auditLog));
    }
  };
}

async function writeAuditAnchorBatch(
  sink: ControlPlaneAuditAnchorSink,
  batch: AuditAnchorSinkBatch,
  onError: ControlPlaneAuditAnchorSinkErrorHandler | undefined
) {
  if (batch.auditLogs.length === 0) {
    return;
  }

  try {
    await sink.writeAuditAnchors(batch.auditLogs, { anchoredAt: batch.anchoredAt });
  } catch (error) {
    if (onError) {
      try {
        onError(error, batch);
      } catch (handlerError) {
        console.error('OU-UI Next audit anchor sink error handler failed:', handlerError);
      }
    } else {
      console.error('OU-UI Next audit anchor sink write failed:', error);
    }
  }
}

export function withAuditAnchorSink(
  repository: ControlPlaneRepository,
  options: AuditAnchorRepositoryOptions
): ControlPlaneRepository {
  return {
    ...repository,
    async transaction<T>(run: (transaction: ControlPlaneTransaction) => Promise<T>) {
      const auditLogs: AuditLog[] = [];
      const result = await repository.transaction((transaction) => run(createAnchoredTransaction(transaction, auditLogs)));

      await writeAuditAnchorBatch(
        options.sink,
        {
          auditLogs,
          anchoredAt: options.now?.() ?? new Date().toISOString()
        },
        options.onError
      );

      return result;
    }
  };
}
