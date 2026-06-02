import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type {
  AuditLog,
  DeployTask,
  PermissionGrant,
  RuntimeConfigRevision,
  RuntimePreflightPlan,
  RuntimeSnapshot
} from '../../domain';
import type { CommandOutboxItem } from '../../services/api/control-plane-api';
import type {
  AgentCredentialRecord,
  ControlPlaneRepository,
  ControlPlaneRepositoryState,
  ControlPlaneTransaction,
  TaskIdempotencyRecord
} from './control-plane-repository';

type CreateFileControlPlaneRepositoryInput = {
  filePath: string;
  seed?: Partial<ControlPlaneRepositoryState>;
};

function clone<T>(value: T): T {
  if (value === undefined) {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function createEmptyState(seed: Partial<ControlPlaneRepositoryState> = {}): ControlPlaneRepositoryState {
  return {
    tasks: clone(seed.tasks ?? []),
    auditLogs: clone(seed.auditLogs ?? []),
    commandOutbox: clone(seed.commandOutbox ?? []),
    agentEvents: clone(seed.agentEvents ?? []),
    agentSessions: clone(seed.agentSessions ?? []),
    agentCredentials: clone(seed.agentCredentials ?? []),
    idempotencyRecords: clone(seed.idempotencyRecords ?? []),
    forwardRules: clone(seed.forwardRules ?? []),
    permissionGrants: clone(seed.permissionGrants ?? []),
    configRevisions: clone(seed.configRevisions ?? []),
    preflightPlans: clone(seed.preflightPlans ?? []),
    runtimeSnapshots: clone(seed.runtimeSnapshots ?? [])
  };
}

function assertRepositoryState(value: unknown, filePath: string): asserts value is ControlPlaneRepositoryState {
  const state = value as Partial<Record<keyof ControlPlaneRepositoryState, unknown>>;
  const requiredArrays: Array<keyof ControlPlaneRepositoryState> = [
    'tasks',
    'auditLogs',
    'commandOutbox',
    'agentEvents',
    'forwardRules',
    'permissionGrants',
    'configRevisions',
    'preflightPlans',
    'runtimeSnapshots'
  ];
  const optionalArrays: Array<keyof ControlPlaneRepositoryState> = ['agentSessions', 'agentCredentials', 'idempotencyRecords'];

  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid control-plane state file: ${filePath}`);
  }

  for (const key of requiredArrays) {
    if (!Array.isArray(state[key])) {
      throw new Error(`Invalid control-plane state file: ${filePath} is missing array "${key}"`);
    }
  }

  for (const key of optionalArrays) {
    if (state[key] === undefined) {
      state[key] = [];
    }

    if (!Array.isArray(state[key])) {
      throw new Error(`Invalid control-plane state file: ${filePath} is missing array "${key}"`);
    }
  }
}

async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

async function readStateFile(filePath: string): Promise<ControlPlaneRepositoryState> {
  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;

  assertRepositoryState(parsed, filePath);
  return clone(parsed);
}

async function writeStateFile(filePath: string, state: ControlPlaneRepositoryState) {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true });

  const tempPath = join(directory, `.${basename(filePath)}.${randomUUID()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(tempPath, filePath);
}

function createTransaction(state: ControlPlaneRepositoryState): ControlPlaneTransaction {
  return {
    async findTask(taskId: string) {
      return clone(state.tasks.find((task) => task.id === taskId));
    },

    async listTasks() {
      return clone(state.tasks);
    },

    async insertTask(task: DeployTask) {
      state.tasks.unshift(clone(task));
    },

    async updateTask(task: DeployTask) {
      state.tasks = state.tasks.map((item) => (item.id === task.id ? clone(task) : item));
    },

    async insertAuditLog(auditLog: AuditLog) {
      state.auditLogs.unshift(clone(auditLog));
    },

    async listCommandOutbox() {
      return clone(state.commandOutbox);
    },

    async findCommandOutboxItem(commandId: string, agentId: string) {
      return clone(state.commandOutbox.find((item) => item.commandId === commandId && item.agentId === agentId));
    },

    async updateCommandOutboxItem(item: CommandOutboxItem) {
      state.commandOutbox = state.commandOutbox.map((current) => (current.id === item.id ? clone(item) : current));
    },

    async insertCommandOutbox(item: CommandOutboxItem) {
      state.commandOutbox.unshift(clone(item));
    },

    async findAgentEvent(eventId: string) {
      return clone(state.agentEvents.find((event) => event.eventId === eventId));
    },

    async insertAgentEvent(event) {
      state.agentEvents.unshift(clone(event));
    },

    async findAgentSession(agentId: string, sessionId: string) {
      return clone(state.agentSessions.find((session) => session.agentId === agentId && session.sessionId === sessionId));
    },

    async upsertAgentSession(session) {
      state.agentSessions = [
        clone(session),
        ...state.agentSessions.filter((item) => item.agentId !== session.agentId || item.sessionId !== session.sessionId)
      ];
    },

    async findAgentCredentialByTokenHash(tokenHash: string) {
      return clone(state.agentCredentials.find((record) => record.tokenHash === tokenHash));
    },

    async upsertAgentCredential(record: AgentCredentialRecord) {
      state.agentCredentials = [
        clone(record),
        ...state.agentCredentials.filter((item) => item.id !== record.id && item.tokenHash !== record.tokenHash)
      ];
    },

    async findIdempotencyRecord(key: string) {
      return clone(state.idempotencyRecords.find((record) => record.key === key));
    },

    async insertIdempotencyRecord(record: TaskIdempotencyRecord) {
      state.idempotencyRecords = [clone(record), ...state.idempotencyRecords.filter((item) => item.key !== record.key)];
    },

    async findForwardRule(ruleId: string) {
      return clone(state.forwardRules.find((rule) => rule.id === ruleId));
    },

    async listPermissionGrants() {
      return clone(state.permissionGrants);
    },

    async upsertPermissionGrant(grant: PermissionGrant) {
      state.permissionGrants = [clone(grant), ...state.permissionGrants.filter((item) => item.id !== grant.id)];
    },

    async insertConfigRevision(configRevision: RuntimeConfigRevision) {
      state.configRevisions.unshift(clone(configRevision));
    },

    async listConfigRevisions() {
      return clone(state.configRevisions);
    },

    async updateConfigRevision(configRevision: RuntimeConfigRevision) {
      state.configRevisions = state.configRevisions.map((item) =>
        item.id === configRevision.id ? clone(configRevision) : item
      );
    },

    async insertPreflightPlan(preflightPlan: RuntimePreflightPlan) {
      state.preflightPlans.unshift(clone(preflightPlan));
    },

    async listPreflightPlans() {
      return clone(state.preflightPlans);
    },

    async updatePreflightPlan(preflightPlan: RuntimePreflightPlan) {
      state.preflightPlans = state.preflightPlans.map((item) =>
        item.id === preflightPlan.id ? clone(preflightPlan) : item
      );
    },

    async insertRuntimeSnapshot(runtimeSnapshot: RuntimeSnapshot) {
      state.runtimeSnapshots.unshift(clone(runtimeSnapshot));
    },

    async listRuntimeSnapshots() {
      return clone(state.runtimeSnapshots);
    },

    async updateRuntimeSnapshot(runtimeSnapshot: RuntimeSnapshot) {
      state.runtimeSnapshots = state.runtimeSnapshots.map((item) =>
        item.id === runtimeSnapshot.id ? clone(runtimeSnapshot) : item
      );
    }
  };
}

export async function createFileControlPlaneRepository(
  input: CreateFileControlPlaneRepositoryInput
): Promise<ControlPlaneRepository> {
  let state = (await pathExists(input.filePath))
    ? await readStateFile(input.filePath)
    : createEmptyState(input.seed);

  if (!(await pathExists(input.filePath))) {
    await writeStateFile(input.filePath, state);
  }

  let transactionQueue: Promise<void> = Promise.resolve();

  return {
    async transaction<T>(run: (transaction: ControlPlaneTransaction) => Promise<T>) {
      const execute = async () => {
        const draft = clone(state);
        const result = await run(createTransaction(draft));

        await writeStateFile(input.filePath, draft);
        state = draft;

        return clone(result);
      };

      const pending = transactionQueue.then(execute, execute);
      transactionQueue = pending.then(
        () => undefined,
        () => undefined
      );

      return pending;
    },

    async listTasks() {
      return clone(state.tasks);
    },

    async listAuditLogs() {
      return clone(state.auditLogs);
    },

    async listCommandOutbox() {
      return clone(state.commandOutbox);
    },

    async listAgentEvents() {
      return clone(state.agentEvents);
    },

    async listAgentSessions() {
      return clone(state.agentSessions);
    },

    async listAgentCredentials() {
      return clone(state.agentCredentials);
    },

    async findAgentCredentialByTokenHash(tokenHash: string) {
      return clone(state.agentCredentials.find((record) => record.tokenHash === tokenHash));
    },

    async listForwardRules() {
      return clone(state.forwardRules);
    },

    async listPermissionGrants() {
      return clone(state.permissionGrants);
    },

    async listConfigRevisions() {
      return clone(state.configRevisions);
    },

    async listPreflightPlans() {
      return clone(state.preflightPlans);
    },

    async listRuntimeSnapshots() {
      return clone(state.runtimeSnapshots);
    },

    async findIdempotencyRecord(key: string) {
      return clone(state.idempotencyRecords.find((record) => record.key === key));
    }
  };
}
