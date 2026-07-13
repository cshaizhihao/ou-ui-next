import { createHash, randomUUID } from 'node:crypto';
import type { AuditLog, OperatorSessionSummary } from '../../domain';
import type { MutationContext } from '../../services/api/control-plane-api';
import type {
  ControlPlaneRepository,
  ControlPlaneTransaction,
  OperatorSessionRecord
} from './control-plane-repository';

const AUDIT_GENESIS_HASH = `sha256:${'0'.repeat(64)}`;

export type IssueOperatorSessionInput = {
  sessionId: string;
  username: string;
  actor: string;
  operatorGroupId?: string;
  resourceGroupId?: string;
  expiresAt: string;
  sourceIp: string;
  userAgent?: string;
  requestId: string;
  issuedAt?: string;
};

export type RevokeOperatorSessionInput = MutationContext & {
  reason: string;
};

export type OperatorSessionObservationContext = Pick<MutationContext, 'sourceIp' | 'userAgent' | 'requestId'>;

export type OperatorSessionStore = {
  issue(input: IssueOperatorSessionInput): Promise<OperatorSessionSummary>;
  get(sessionId: string, context?: OperatorSessionObservationContext): Promise<OperatorSessionSummary | undefined>;
  list(context?: OperatorSessionObservationContext): Promise<OperatorSessionSummary[]>;
  revoke(sessionId: string, input: RevokeOperatorSessionInput): Promise<OperatorSessionSummary | undefined>;
};

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForHash(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeForHash(item)])
    );
  }

  return value;
}

function createStableSha256LikeHash(value: unknown) {
  const normalized = JSON.stringify(normalizeForHash(value));
  return `sha256:${createHash('sha256').update(normalized).digest('hex')}`;
}

function createAuditIntegrityHash(log: AuditLog) {
  const hashableLog = { ...log };
  delete hashableLog.hash;
  return createStableSha256LikeHash(hashableLog);
}

function resolveOperatorSessionStatus(record: OperatorSessionRecord, now: string = new Date().toISOString()) {
  if (record.status === 'revoked') {
    return 'revoked' as const;
  }

  return Date.parse(record.expiresAt) <= Date.parse(now) ? ('expired' as const) : ('active' as const);
}

function createOperatorSessionSummary(record: OperatorSessionRecord, now?: string): OperatorSessionSummary {
  return createOperatorSessionSummaryWithStatus(record, resolveOperatorSessionStatus(record, now));
}

function createOperatorSessionSummaryWithStatus(
  record: OperatorSessionRecord,
  status: OperatorSessionSummary['status']
): OperatorSessionSummary {
  return {
    id: record.id,
    username: record.username,
    actor: record.actor,
    operatorGroupId: record.operatorGroupId,
    resourceGroupId: record.resourceGroupId,
    status,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    sourceIp: record.sourceIp,
    userAgent: record.userAgent,
    requestId: record.requestId,
    revokedAt: record.revokedAt,
    revokedBy: record.revokedBy,
    revokedReason: record.revokedReason
  };
}

function markExpiredRecord(record: OperatorSessionRecord, now: string) {
  if (record.status !== 'active' || Date.parse(record.expiresAt) > Date.parse(now)) {
    return record;
  }

  return {
    ...record,
    status: 'expired' as const
  };
}

function createOperatorSessionIssuedAudit(record: OperatorSessionRecord): AuditLog {
  return {
    id: `audit-operator-session-issued-${record.id}-${randomUUID()}`,
    action: 'operator.session.issued',
    actor: record.actor,
    operatorGroupId: record.operatorGroupId,
    resourceGroupId: record.resourceGroupId,
    scope: 'control-plane:operator',
    resourceType: 'permission',
    operation: 'operator.session.issue',
    result: 'succeeded',
    targetId: record.id,
    targetLabel: record.username,
    taskId: '',
    severity: 'info',
    message: `Operator session ${record.id} issued`,
    createdAt: record.issuedAt,
    sourceIp: record.sourceIp,
    userAgent: record.userAgent,
    requestId: record.requestId,
    requestBodyHash: createStableSha256LikeHash({
      operation: 'operator.session.issue',
      username: record.username
    }),
    after: {
      session: createOperatorSessionSummary(record, record.issuedAt)
    }
  };
}

function createOperatorSessionExpiredAudit(
  before: OperatorSessionSummary,
  after: OperatorSessionSummary,
  context: OperatorSessionObservationContext,
  observedAt: string
): AuditLog {
  return {
    id: `audit-operator-session-expired-${after.id}-${randomUUID()}`,
    action: 'operator.session.expired',
    actor: 'system:operator-session-expiry',
    operatorGroupId: after.operatorGroupId,
    resourceGroupId: after.resourceGroupId,
    scope: 'control-plane:operator',
    resourceType: 'permission',
    operation: 'operator.session.expire',
    result: 'succeeded',
    targetId: after.id,
    targetLabel: after.username,
    taskId: '',
    severity: 'info',
    message: `Operator session ${after.id} expired`,
    createdAt: observedAt,
    sourceIp: context.sourceIp,
    userAgent: context.userAgent,
    requestId: context.requestId,
    requestBodyHash: createStableSha256LikeHash({
      operation: 'operator.session.expire',
      sessionId: after.id
    }),
    before: {
      session: before
    },
    after: {
      session: after
    }
  };
}

function createOperatorSessionRevokedAudit(
  before: OperatorSessionSummary,
  after: OperatorSessionSummary,
  context: RevokeOperatorSessionInput,
  observedAt: string
): AuditLog {
  return {
    id: `audit-operator-session-revoked-${after.id}-${randomUUID()}`,
    action: 'operator.session.revoked',
    actor: context.actor,
    operatorGroupId: context.operatorGroupId,
    resourceGroupId: context.resourceGroupId,
    scope: 'control-plane:operator',
    resourceType: 'permission',
    operation: 'operator.session.revoke',
    result: 'succeeded',
    targetId: after.id,
    targetLabel: after.username,
    taskId: '',
    severity: 'warning',
    message: `Operator session ${after.id} revoked: ${context.reason}`,
    createdAt: observedAt,
    sourceIp: context.sourceIp,
    userAgent: context.userAgent,
    requestId: context.requestId,
    requestBodyHash: createStableSha256LikeHash({
      operation: 'operator.session.revoke',
      sessionId: after.id,
      reason: context.reason
    }),
    before: {
      session: before
    },
    after: {
      session: after
    }
  };
}

async function appendLedgerAuditLog(transaction: ControlPlaneTransaction, auditLog: AuditLog) {
  const existingLogs = await transaction.listAuditLogs();
  const auditWithPrevHash = {
    ...auditLog,
    prevHash: existingLogs[0]?.hash ?? AUDIT_GENESIS_HASH
  };
  const insertedAuditLog = {
    ...auditWithPrevHash,
    hash: createAuditIntegrityHash(auditWithPrevHash)
  };
  await transaction.insertAuditLog(insertedAuditLog);
}

async function expireRecordIfNeeded(
  transaction: ControlPlaneTransaction,
  record: OperatorSessionRecord,
  currentAt: string,
  context?: OperatorSessionObservationContext
) {
  const normalized = markExpiredRecord(record, currentAt);

  if (normalized.status === record.status) {
    return normalized;
  }

  await transaction.upsertOperatorSession(normalized);

  if (context) {
    const before = createOperatorSessionSummaryWithStatus(record, 'active');
    const after = createOperatorSessionSummaryWithStatus(normalized, 'expired');
    await appendLedgerAuditLog(transaction, createOperatorSessionExpiredAudit(before, after, context, currentAt));
  }

  return normalized;
}

export function createInMemoryOperatorSessionStore(now: () => string = () => new Date().toISOString()): OperatorSessionStore {
  const records = new Map<string, OperatorSessionRecord>();

  return {
    async issue(input) {
      const issuedAt = input.issuedAt ?? now();
      const record: OperatorSessionRecord = {
        id: input.sessionId,
        username: input.username,
        actor: input.actor,
        operatorGroupId: input.operatorGroupId,
        resourceGroupId: input.resourceGroupId,
        status: 'active',
        issuedAt,
        expiresAt: input.expiresAt,
        sourceIp: input.sourceIp,
        userAgent: input.userAgent,
        requestId: input.requestId
      };
      records.set(record.id, record);
      return createOperatorSessionSummary(record, issuedAt);
    },

    async get(sessionId) {
      const currentAt = now();
      const record = records.get(sessionId);
      if (!record) {
        return undefined;
      }
      const next = markExpiredRecord(record, currentAt);
      records.set(next.id, next);
      return createOperatorSessionSummary(next, currentAt);
    },

    async list() {
      const currentAt = now();
      return [...records.values()]
        .map((record) => {
          const next = markExpiredRecord(record, currentAt);
          records.set(next.id, next);
          return createOperatorSessionSummary(next, currentAt);
        })
        .sort((left, right) => Date.parse(right.issuedAt) - Date.parse(left.issuedAt));
    },

    async revoke(sessionId, input) {
      const currentAt = now();
      const record = records.get(sessionId);
      if (!record) {
        return undefined;
      }
      const normalized = markExpiredRecord(record, currentAt);
      if (normalized.status !== 'active') {
        records.set(normalized.id, normalized);
        return createOperatorSessionSummary(normalized, currentAt);
      }
      const revoked: OperatorSessionRecord = {
        ...normalized,
        status: 'revoked',
        revokedAt: currentAt,
        revokedBy: input.actor,
        revokedReason: input.reason
      };
      records.set(revoked.id, revoked);
      return createOperatorSessionSummary(revoked, currentAt);
    }
  };
}

export function createRepositoryBackedOperatorSessionStore(
  repository: ControlPlaneRepository,
  now: () => string = () => new Date().toISOString()
): OperatorSessionStore {
  const recordCache = new Map<string, OperatorSessionRecord>();

  return {
    async issue(input) {
      const result = await repository.transaction(async (transaction) => {
        const issuedAt = input.issuedAt ?? now();
        const record: OperatorSessionRecord = {
          id: input.sessionId,
          username: input.username,
          actor: input.actor,
          operatorGroupId: input.operatorGroupId,
          resourceGroupId: input.resourceGroupId,
          status: 'active',
          issuedAt,
          expiresAt: input.expiresAt,
          sourceIp: input.sourceIp,
          userAgent: input.userAgent,
          requestId: input.requestId
        };
        await transaction.upsertOperatorSession(record);
        await appendLedgerAuditLog(transaction, createOperatorSessionIssuedAudit(record));
        return { record, summary: createOperatorSessionSummary(record, issuedAt) };
      });
      recordCache.set(result.record.id, result.record);
      return result.summary;
    },

    async get(sessionId, context) {
      const currentAt = now();
      const cached = recordCache.get(sessionId);
      if (cached && resolveOperatorSessionStatus(cached, currentAt) === cached.status) {
        return createOperatorSessionSummary(cached, currentAt);
      }

      const result = await repository.transaction(async (transaction) => {
        const record = await transaction.findOperatorSession(sessionId);
        if (!record) {
          return undefined;
        }
        const normalized = await expireRecordIfNeeded(transaction, record, currentAt, context);
        return { record: normalized, summary: createOperatorSessionSummary(normalized, currentAt) };
      });
      if (!result) {
        return undefined;
      }
      recordCache.set(result.record.id, result.record);
      return result.summary;
    },

    async list(context) {
      return repository.transaction(async (transaction) => {
        const currentAt = now();
        const records = await transaction.listOperatorSessions();
        const summaries: OperatorSessionSummary[] = [];

        for (const record of records) {
          const normalized = await expireRecordIfNeeded(transaction, record, currentAt, context);
          recordCache.set(normalized.id, normalized);
          summaries.push(createOperatorSessionSummary(normalized, currentAt));
        }

        return summaries.sort((left, right) => Date.parse(right.issuedAt) - Date.parse(left.issuedAt));
      });
    },

    async revoke(sessionId, input) {
      const result = await repository.transaction(async (transaction) => {
        const currentAt = now();
        const record = await transaction.findOperatorSession(sessionId);
        if (!record) {
          return undefined;
        }
        const normalized = await expireRecordIfNeeded(transaction, record, currentAt, input);
        if (normalized.status !== 'active') {
          return { record: normalized, summary: createOperatorSessionSummary(normalized, currentAt) };
        }

        const before = createOperatorSessionSummary(normalized, currentAt);
        const revoked: OperatorSessionRecord = {
          ...normalized,
          status: 'revoked',
          revokedAt: currentAt,
          revokedBy: input.actor,
          revokedReason: input.reason
        };
        await transaction.upsertOperatorSession(revoked);
        const after = createOperatorSessionSummary(revoked, currentAt);
        await appendLedgerAuditLog(transaction, createOperatorSessionRevokedAudit(before, after, input, currentAt));
        return { record: revoked, summary: after };
      });
      if (!result) {
        return undefined;
      }
      recordCache.set(result.record.id, result.record);
      return result.summary;
    }
  };
}
