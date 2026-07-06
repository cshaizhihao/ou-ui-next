import type {
  AuditLog,
  DeployTask,
  PermissionGrant,
  RuntimeConfigRevision,
  RuntimePreflightPlan,
  RuntimeSnapshot,
  TelegramBindingChallenge,
  TelegramChatBinding,
  TelegramCustomerBinding,
  TelegramNotificationDelivery,
  TelegramNotificationPolicy
} from '../../domain';
import type { CommandOutboxItem } from '../../services/api/control-plane-api';
import type {
  AgentCredentialRecord,
  ControlPlaneRepositoryState,
  ControlPlaneTransaction,
  OperatorSessionRecord,
  TelegramBindingChallengeSecretRecord,
  TaskIdempotencyRecord
} from './control-plane-repository';
import {
  mergeAgentLogArchives,
  pruneAgentLogEvents as pruneAgentLogEventList
} from './agent-log-retention';
import {
  mergeTrafficRollupCompactions,
  pruneTrafficRollups as pruneTrafficRollupList
} from './traffic-rollup-retention';

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
    agentLogArchives: clone(seed.agentLogArchives ?? []),
    agentSessions: clone(seed.agentSessions ?? []),
    operatorSessions: clone(seed.operatorSessions ?? []),
    agentCredentials: clone(seed.agentCredentials ?? []),
    idempotencyRecords: clone(seed.idempotencyRecords ?? []),
    forwardRules: clone(seed.forwardRules ?? []),
    subscriptionSources: clone(seed.subscriptionSources ?? []),
    subscriptionClients: clone(seed.subscriptionClients ?? []),
    subscriptionExportProfiles: clone(seed.subscriptionExportProfiles ?? []),
    subscriptionInventoryNodes: clone(seed.subscriptionInventoryNodes ?? []),
    systemAlerts: clone(seed.systemAlerts ?? []),
    systemAlertNotificationDeliveries: clone(seed.systemAlertNotificationDeliveries ?? []),
    telegramBotSettings: clone(seed.telegramBotSettings),
    telegramBotSecrets: clone(seed.telegramBotSecrets),
    telegramChatBindings: clone(seed.telegramChatBindings ?? []),
    telegramCustomerBindings: clone(seed.telegramCustomerBindings ?? []),
    telegramBindingChallenges: clone(seed.telegramBindingChallenges ?? []),
    telegramBindingChallengeSecrets: clone(seed.telegramBindingChallengeSecrets ?? []),
    telegramNotificationPolicies: clone(seed.telegramNotificationPolicies ?? []),
    telegramNotificationDeliveries: clone(seed.telegramNotificationDeliveries ?? []),
    permissionGrants: clone(seed.permissionGrants ?? []),
    configRevisions: clone(seed.configRevisions ?? []),
    preflightPlans: clone(seed.preflightPlans ?? []),
    runtimeSnapshots: clone(seed.runtimeSnapshots ?? []),
    trafficRollups: clone(seed.trafficRollups ?? []),
    trafficRollupCompactions: clone(seed.trafficRollupCompactions ?? []),
    agentLogRetentionPolicy: clone(seed.agentLogRetentionPolicy),
    trafficRollupRetentionPolicy: clone(seed.trafficRollupRetentionPolicy)
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
    'operatorSessions',
    'agentCredentials',
    'idempotencyRecords',
    'subscriptionSources',
    'subscriptionClients'
  ];
  optionalArrays.push('subscriptionExportProfiles');
  optionalArrays.push('subscriptionInventoryNodes');
  optionalArrays.push('systemAlerts');
  optionalArrays.push('systemAlertNotificationDeliveries');
  optionalArrays.push('telegramChatBindings');
  optionalArrays.push('telegramCustomerBindings');
  optionalArrays.push('telegramBindingChallenges');
  optionalArrays.push('telegramBindingChallengeSecrets');
  optionalArrays.push('telegramNotificationPolicies');
  optionalArrays.push('telegramNotificationDeliveries');
  optionalArrays.push('agentLogArchives');
  optionalArrays.push('trafficRollups');
  optionalArrays.push('trafficRollupCompactions');

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

  if (state.agentLogRetentionPolicy !== undefined && (
    !state.agentLogRetentionPolicy
    || typeof state.agentLogRetentionPolicy !== 'object'
    || Array.isArray(state.agentLogRetentionPolicy)
  )) {
    throw new Error(`Invalid control-plane repository state: ${originLabel} has invalid "agentLogRetentionPolicy"`);
  }

  if (state.trafficRollupRetentionPolicy !== undefined && (
    !state.trafficRollupRetentionPolicy
    || typeof state.trafficRollupRetentionPolicy !== 'object'
    || Array.isArray(state.trafficRollupRetentionPolicy)
  )) {
    throw new Error(`Invalid control-plane repository state: ${originLabel} has invalid "trafficRollupRetentionPolicy"`);
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

    async findAgentLogChunk(agentId: string, taskId: string, commandId: string, chunkSeq: number) {
      return clone(
        state.agentEvents.find(
          (event): event is Extract<(typeof state.agentEvents)[number], { type: 'log_chunk' }> =>
            event.type === 'log_chunk' &&
            event.agentId === agentId &&
            event.taskId === taskId &&
            event.commandId === commandId &&
            event.payload.chunkSeq === chunkSeq
        )
      );
    },

    async listAgentEvents() {
      return clone(state.agentEvents);
    },

    async insertAgentEvent(event) {
      state.agentEvents.unshift(clone(event));
    },

    async listAgentLogArchives() {
      return clone(state.agentLogArchives);
    },

    async getAgentLogRetentionPolicy() {
      return clone(state.agentLogRetentionPolicy);
    },

    async setAgentLogRetentionPolicy(policy) {
      state.agentLogRetentionPolicy = clone(policy);
    },

    async pruneAgentLogEvents(policy, now) {
      const pruned = pruneAgentLogEventList(state.agentEvents, policy, now);
      state.agentEvents = pruned.events;
      state.agentLogArchives = mergeAgentLogArchives(state.agentLogArchives, pruned.archives);
      return pruned.result;
    },

    async getTrafficRollupRetentionPolicy() {
      return clone(state.trafficRollupRetentionPolicy);
    },

    async setTrafficRollupRetentionPolicy(policy) {
      state.trafficRollupRetentionPolicy = clone(policy);
    },

    async pruneTrafficRollups(policy, now) {
      const pruned = pruneTrafficRollupList(state.trafficRollups, policy, now);
      state.trafficRollups = pruned.rollups;
      state.trafficRollupCompactions = mergeTrafficRollupCompactions(
        state.trafficRollupCompactions,
        pruned.compactions
      );
      return pruned.result;
    },

    async findAgentSession(agentId: string, sessionId: string) {
      return clone(state.agentSessions.find((session) => session.agentId === agentId && session.sessionId === sessionId));
    },

    async listAgentSessions() {
      return clone(state.agentSessions);
    },

    async upsertAgentSession(session) {
      state.agentSessions = [
        clone(session),
        ...state.agentSessions.filter((item) => item.agentId !== session.agentId || item.sessionId !== session.sessionId)
      ];
    },

    async findOperatorSession(sessionId: string) {
      return clone(state.operatorSessions.find((session) => session.id === sessionId));
    },

    async listOperatorSessions() {
      return clone(state.operatorSessions);
    },

    async upsertOperatorSession(session: OperatorSessionRecord) {
      state.operatorSessions = [
        clone(session),
        ...state.operatorSessions.filter((item) => item.id !== session.id)
      ];
    },

    async listAgentCredentials() {
      return clone(state.agentCredentials);
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

    async listSystemAlertRecords() {
      return clone(state.systemAlerts);
    },

    async replaceSystemAlertRecords(alerts) {
      state.systemAlerts = clone(alerts);
    },

    async listSystemAlertNotificationDeliveries() {
      return clone(state.systemAlertNotificationDeliveries);
    },

    async replaceSystemAlertNotificationDeliveries(deliveries) {
      state.systemAlertNotificationDeliveries = clone(deliveries);
    },

    async getTelegramBotSettings() {
      return clone(state.telegramBotSettings);
    },

    async setTelegramBotSettings(settings) {
      state.telegramBotSettings = clone(settings);
    },

    async getTelegramBotSecrets() {
      return clone(state.telegramBotSecrets);
    },

    async setTelegramBotSecrets(secrets) {
      state.telegramBotSecrets = clone(secrets);
    },

    async listTelegramChatBindings() {
      return clone(state.telegramChatBindings);
    },

    async upsertTelegramChatBinding(binding: TelegramChatBinding) {
      state.telegramChatBindings = [
        clone(binding),
        ...state.telegramChatBindings.filter((item) => item.id !== binding.id)
      ];
    },

    async listTelegramCustomerBindings() {
      return clone(state.telegramCustomerBindings);
    },

    async upsertTelegramCustomerBinding(binding: TelegramCustomerBinding) {
      state.telegramCustomerBindings = [
        clone(binding),
        ...state.telegramCustomerBindings.filter((item) => item.id !== binding.id)
      ];
    },

    async listTelegramBindingChallenges() {
      return clone(state.telegramBindingChallenges);
    },

    async upsertTelegramBindingChallenge(challenge: TelegramBindingChallenge) {
      state.telegramBindingChallenges = [
        clone(challenge),
        ...state.telegramBindingChallenges.filter((item) => item.id !== challenge.id)
      ];
    },

    async listTelegramBindingChallengeSecrets() {
      return clone(state.telegramBindingChallengeSecrets);
    },

    async upsertTelegramBindingChallengeSecret(secret: TelegramBindingChallengeSecretRecord) {
      state.telegramBindingChallengeSecrets = [
        clone(secret),
        ...state.telegramBindingChallengeSecrets.filter((item) => item.challengeId !== secret.challengeId)
      ];
    },

    async listTelegramNotificationPolicies() {
      return clone(state.telegramNotificationPolicies);
    },

    async upsertTelegramNotificationPolicy(policy: TelegramNotificationPolicy) {
      state.telegramNotificationPolicies = [
        clone(policy),
        ...state.telegramNotificationPolicies.filter((item) => item.id !== policy.id)
      ];
    },

    async listTelegramNotificationDeliveries() {
      return clone(state.telegramNotificationDeliveries);
    },

    async replaceTelegramNotificationDeliveries(deliveries: TelegramNotificationDelivery[]) {
      state.telegramNotificationDeliveries = clone(deliveries);
    },

    async upsertTelegramNotificationDelivery(delivery: TelegramNotificationDelivery) {
      state.telegramNotificationDeliveries = [
        clone(delivery),
        ...state.telegramNotificationDeliveries.filter((item) => item.id !== delivery.id)
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
    },

    async upsertTrafficRollupCompactions(compactions) {
      state.trafficRollupCompactions = mergeTrafficRollupCompactions(state.trafficRollupCompactions, compactions);
    },

    async listTrafficRollupCompactions() {
      return clone(state.trafficRollupCompactions);
    }
  };
}
