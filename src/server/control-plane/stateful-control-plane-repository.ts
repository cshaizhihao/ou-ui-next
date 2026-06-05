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
  ControlPlaneRepositoryState,
  ControlPlaneTransaction,
  TaskIdempotencyRecord
} from './control-plane-repository';
import { pruneAgentLogEvents as pruneAgentLogEventList } from './agent-log-retention';

export function clone<T>(value: T): T {
  if (value === undefined) {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function findDuplicateAuditLogId(auditLogs: unknown[]) {
  const seenIds = new Set<string>();

  for (const item of auditLogs) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const id = (item as { id?: unknown }).id;

    if (typeof id !== 'string') {
      continue;
    }

    if (seenIds.has(id)) {
      return id;
    }

    seenIds.add(id);
  }

  return undefined;
}

function assertCanAppendAuditLog(state: ControlPlaneRepositoryState, auditLog: AuditLog) {
  if (state.auditLogs.some((item) => item.id === auditLog.id)) {
    throw new Error(`audit_log.append_only_violation: ${auditLog.id}`);
  }
}

export function createEmptyControlPlaneRepositoryState(
  seed: Partial<ControlPlaneRepositoryState> = {}
): ControlPlaneRepositoryState {
  return {
    tasks: clone(seed.tasks ?? []),
    auditLogs: clone(seed.auditLogs ?? []),
    commandOutbox: clone(seed.commandOutbox ?? []),
    agentEvents: clone(seed.agentEvents ?? []),
    agentSessions: clone(seed.agentSessions ?? []),
    agentCredentials: clone(seed.agentCredentials ?? []),
    idempotencyRecords: clone(seed.idempotencyRecords ?? []),
    forwardRules: clone(seed.forwardRules ?? []),
    subscriptionSources: clone(seed.subscriptionSources ?? []),
    subscriptionClients: clone(seed.subscriptionClients ?? []),
    subscriptionExportProfiles: clone(seed.subscriptionExportProfiles ?? []),
    subscriptionInventoryNodes: clone(seed.subscriptionInventoryNodes ?? []),
    permissionGrants: clone(seed.permissionGrants ?? []),
    configRevisions: clone(seed.configRevisions ?? []),
    preflightPlans: clone(seed.preflightPlans ?? []),
    runtimeSnapshots: clone(seed.runtimeSnapshots ?? []),
    trafficRollups: clone(seed.trafficRollups ?? [])
  };
}

export function assertControlPlaneRepositoryState(
  value: unknown,
  originLabel: string
): asserts value is ControlPlaneRepositoryState {
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
  const optionalArrays: Array<keyof ControlPlaneRepositoryState> = [
    'agentSessions',
    'agentCredentials',
    'idempotencyRecords',
    'subscriptionSources',
    'subscriptionClients'
  ];
  optionalArrays.push('subscriptionExportProfiles');
  optionalArrays.push('subscriptionInventoryNodes');
  optionalArrays.push('trafficRollups');

  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid control-plane repository state: ${originLabel}`);
  }

  for (const key of requiredArrays) {
    if (!Array.isArray(state[key])) {
      throw new Error(`Invalid control-plane repository state: ${originLabel} is missing array "${key}"`);
    }
  }

  for (const key of optionalArrays) {
    if (state[key] === undefined) {
      state[key] = [];
    }

    if (!Array.isArray(state[key])) {
      throw new Error(`Invalid control-plane repository state: ${originLabel} is missing array "${key}"`);
    }
  }

  const duplicateAuditLogId = findDuplicateAuditLogId(state.auditLogs as unknown[]);

  if (duplicateAuditLogId) {
    throw new Error(
      `Invalid control-plane repository state: ${originLabel} contains duplicate audit log "${duplicateAuditLogId}"`
    );
  }
}

export function createControlPlaneTransaction(state: ControlPlaneRepositoryState): ControlPlaneTransaction {
  return {
    async findTask(taskId: string) {
      return clone(state.tasks.find((task) => task.id === taskId));
    },

    async listTasks() {
      return clone(state.tasks);
    },

    async listAuditLogs() {
      return clone(state.auditLogs);
    },

    async insertTask(task: DeployTask) {
      state.tasks.unshift(clone(task));
    },

    async updateTask(task: DeployTask) {
      state.tasks = state.tasks.map((item) => (item.id === task.id ? clone(task) : item));
    },

    async insertAuditLog(auditLog: AuditLog) {
      assertCanAppendAuditLog(state, auditLog);
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

    async pruneAgentLogEvents(policy, now) {
      const pruned = pruneAgentLogEventList(state.agentEvents, policy, now);
      state.agentEvents = pruned.events;
      return pruned.result;
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

    async findAgentCredentialById(id: string) {
      return clone(state.agentCredentials.find((record) => record.id === id));
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

    async listSubscriptionSources() {
      return clone(state.subscriptionSources);
    },

    async upsertSubscriptionSource(source) {
      state.subscriptionSources = [
        clone(source),
        ...state.subscriptionSources.filter((item) => item.id !== source.id)
      ];
    },

    async deleteSubscriptionSource(sourceId) {
      state.subscriptionSources = state.subscriptionSources.filter((source) => source.id !== sourceId);
    },

    async listSubscriptionClients() {
      return clone(state.subscriptionClients);
    },

    async upsertSubscriptionClient(client) {
      state.subscriptionClients = [
        clone(client),
        ...state.subscriptionClients.filter((item) => item.id !== client.id)
      ];
    },

    async deleteSubscriptionClient(clientId) {
      state.subscriptionClients = state.subscriptionClients.filter((client) => client.id !== clientId);
    },

    async listSubscriptionExportProfiles() {
      return clone(state.subscriptionExportProfiles);
    },

    async upsertSubscriptionExportProfile(profile) {
      state.subscriptionExportProfiles = [
        clone(profile),
        ...state.subscriptionExportProfiles.filter((item) => item.id !== profile.id)
      ];
    },

    async deleteSubscriptionExportProfile(profileId) {
      state.subscriptionExportProfiles = state.subscriptionExportProfiles.filter((profile) => profile.id !== profileId);
    },

    async listSubscriptionInventoryNodes() {
      return clone(state.subscriptionInventoryNodes);
    },

    async replaceSubscriptionInventoryNodesForSource(sourceId, nodes) {
      state.subscriptionInventoryNodes = [
        ...clone(nodes),
        ...state.subscriptionInventoryNodes.filter((node) => node.sourceId !== sourceId)
      ];
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
    },

    async insertTrafficRollup(trafficRollup) {
      state.trafficRollups.unshift(clone(trafficRollup));
    },

    async listTrafficRollups() {
      return clone(state.trafficRollups);
    }
  };
}
