import { createHash } from 'node:crypto';
import type {
  Agent,
  AgentCredentialSummary,
  AgentInstallCommandRequest,
  AgentRegistrationRequest,
  AuditLog,
  CreateTaskInput,
  DeployTask,
  DeployTaskStatus,
  ManagedNode,
  QuotaPolicy,
  RateLimitPolicy,
  RoutingPolicy,
  SubscriptionBundle,
  SubscriptionClientIdentity,
  SubscriptionInventoryNode,
  SubscriptionSource,
  SubscriptionSourceSyncResult,
  TuningProfile,
  XrayInbound
} from '../../domain';
import {
  applyAgentTask,
  applyForwardRuleTask,
  applySubscriptionClientTask,
  applySubscriptionSourceTask,
  applyXrayInboundTask,
  readSubscriptionSourceDeleteId
} from '../../domain';
import type { AgentSessionState, ControlPlaneRepository } from '../../server/control-plane/control-plane-repository';
import type { createControlPlaneService } from '../../server/control-plane/control-plane-service';
import type { AgentCommandEnvelope, AgentEventEnvelope } from './api-contract';
import { applyAgentEventToReadModel } from './agent-telemetry-read-model';
import { applyForwardingTelemetryToReadModel } from './forwarding-telemetry-read-model';
import type {
  AuditChainVerification,
  ControlPlaneApi,
  MutationContext
} from './control-plane-api';
import { v1ApiBoundary } from './control-plane-api';
import { parseSubscriptionSourceContent } from './subscription-source-parser';

type ControlPlaneService = ReturnType<typeof createControlPlaneService>;

type ServiceBackedControlPlaneApiInput = {
  repository: ControlPlaneRepository;
  service: ControlPlaneService;
  inventory?: Partial<{
    agents: Agent[];
    nodes: ManagedNode[];
    inbounds: XrayInbound[];
    subscriptionSources: SubscriptionSource[];
    subscriptionInventoryNodes: SubscriptionInventoryNode[];
    subscriptionBundles: SubscriptionBundle[];
    subscriptionClients: SubscriptionClientIdentity[];
    quotaPolicies: QuotaPolicy[];
    rateLimitPolicies: RateLimitPolicy[];
    routingPolicies: RoutingPolicy[];
    tuningProfiles: TuningProfile[];
  }>;
  fetcher?: typeof fetch;
};

const AUDIT_GENESIS_HASH = `sha256:${'0'.repeat(64)}`;

function clone<T>(value: T): T {
  if (value === undefined) {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

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

function verifyAuditLogs(logs: AuditLog[]): AuditChainVerification {
  for (let index = 0; index < logs.length; index += 1) {
    const log = logs[index];
    const expectedPrevHash = index < logs.length - 1 ? logs[index + 1].hash : AUDIT_GENESIS_HASH;

    if (log.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        checked: index,
        brokenAt: log.id,
        reason: 'prev_hash.mismatch'
      };
    }

    if (log.hash !== createAuditIntegrityHash(log)) {
      return {
        valid: false,
        checked: index,
        brokenAt: log.id,
        reason: 'hash.mismatch'
      };
    }
  }

  return {
    valid: true,
    checked: logs.length
  };
}

function resolveMutationContext(context: MutationContext | undefined): MutationContext {
  return {
    actor: context?.actor ?? 'admin',
    operatorGroupId: context?.operatorGroupId,
    resourceGroupId: context?.resourceGroupId,
    sourceIp: context?.sourceIp ?? '127.0.0.1',
    userAgent: context?.userAgent,
    requestId: context?.requestId ?? `req-service-api-${Date.now()}`,
    idempotencyKey: context?.idempotencyKey,
    ifMatch: context?.ifMatch
  };
}

function normalizeAgentCapabilities(capabilities: string[] | undefined): Agent['capabilities'] {
  const normalized = (capabilities ?? [])
    .map((capability) => {
      if (capability === 'flvx') return 'port-forwarding';
      if (
        capability === 'host-agent' ||
        capability === 'xray' ||
        capability === 'gost' ||
        capability === 'hysteria2' ||
        capability === 'port-forwarding' ||
        capability === 'bbr'
      ) {
        return capability;
      }

      return undefined;
    })
    .filter((capability): capability is Agent['capabilities'][number] => Boolean(capability));

  const fallback: Agent['capabilities'] = ['host-agent'];
  return [...new Set<Agent['capabilities'][number]>(normalized.length > 0 ? normalized : fallback)];
}

function createAgentFromCredential(credential: AgentCredentialSummary, session?: AgentSessionState): Agent {
  const observedAt = session?.lastHeartbeatAt ?? session?.updatedAt ?? credential.lastUsedAt ?? credential.issuedAt;
  const capabilities = normalizeAgentCapabilities(
    session?.capabilities ?? credential.metadata.installProfile
  );

  return {
    id: credential.agentId,
    name: credential.agentId,
    status: session?.status ?? 'provisioning',
    region: 'custom',
    publicAddress: credential.sourceIp || 'pending',
    connectionMode: 'pull',
    version: session?.version ?? 'unknown',
    platform: 'linux/unknown',
    capabilities,
    maxTrafficBytes: 0,
    monthlyTrafficLimitBytes: 0,
    expiresAt: '',
    probeConfig: {
      pingTarget: '1.1.1.1',
      pingIntervalSeconds: 30,
      latencyGreenMaxMs: 100,
      latencyYellowMaxMs: 200
    },
    trafficPolicy: {
      accountingMode: 'both',
      monthlyResetDay: 1,
      manualUsedTrafficBytes: 0,
      telemetrySource: 'agent'
    },
    hardware: {},
    lastHeartbeatAt: observedAt,
    telemetry: {
      cpuPercent: 0,
      memoryPercent: 0,
      memoryUsedBytes: 0,
      memoryTotalBytes: 0,
      diskUsedBytes: 0,
      diskTotalBytes: 0,
      txBytes: 0,
      rxBytes: 0,
      uploadSpeedBps: 0,
      downloadSpeedBps: 0,
      uploadTotalBytes: 0,
      downloadTotalBytes: 0,
      monthlyTrafficUsedBytes: 0,
      latencyMs: 0,
      latencySamplesMs: [],
      packetLossPercent: 0,
      packetLossSamplesPercent: [],
      onlineDays: 0,
      reportedAt: observedAt
    }
  };
}

function sortTasksForReadModelReplay(tasks: DeployTask[]) {
  return clone(tasks).sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    const timeDelta = (Number.isNaN(leftTime) ? 0 : leftTime) - (Number.isNaN(rightTime) ? 0 : rightTime);

    return timeDelta === 0 ? left.id.localeCompare(right.id) : timeDelta;
  });
}

function sortAgentEventsForReadModelReplay(events: AgentEventEnvelope[]) {
  return clone(events).sort((left, right) => {
    const leftTime = Date.parse(left.observedAt);
    const rightTime = Date.parse(right.observedAt);
    const timeDelta = (Number.isNaN(leftTime) ? 0 : leftTime) - (Number.isNaN(rightTime) ? 0 : rightTime);

    return timeDelta || left.agentId.localeCompare(right.agentId) || left.seq - right.seq || left.eventId.localeCompare(right.eventId);
  });
}

function readTaskMetadataString(task: DeployTask, key: string, fallback: string) {
  const value = task.metadata?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function readAgentIdFromTask(task: DeployTask) {
  return readTaskMetadataString(task, 'agentId', task.targetId);
}

function updateSubscriptionSourceSyncState(
  sources: SubscriptionSource[],
  sourceId: string,
  patch: Pick<SubscriptionSource, 'status' | 'nodeCount' | 'lastSyncAt'>
) {
  return sources.map((source) =>
    source.id === sourceId
      ? {
          ...source,
          ...patch
        }
      : source
  );
}

function createSubscriptionSourceRateLimitError(source: SubscriptionSource, now: string, nextAllowedAt: string) {
  return Object.assign(new Error(`subscription_source.rate_limited:${source.id}`), {
    code: 'subscription_source.rate_limited',
    details: {
      sourceId: source.id,
      refreshIntervalMinutes: source.refreshIntervalMinutes ?? source.rateLimitPerMinute,
      lastSyncAt: source.lastSyncAt,
      attemptedAt: now,
      nextAllowedAt
    }
  });
}

function assertSubscriptionSourceSyncAllowed(source: SubscriptionSource, now: string) {
  if (source.status === 'syncing') {
    return;
  }

  const intervalMinutes = Math.max(Math.round(source.refreshIntervalMinutes ?? source.rateLimitPerMinute ?? 60), 1);
  const lastSyncMs = Date.parse(source.lastSyncAt);
  const nowMs = Date.parse(now);

  if (Number.isNaN(lastSyncMs) || Number.isNaN(nowMs)) {
    return;
  }

  const nextAllowedMs = lastSyncMs + intervalMinutes * 60 * 1000;

  if (nowMs < nextAllowedMs) {
    throw createSubscriptionSourceRateLimitError(source, now, new Date(nextAllowedMs).toISOString());
  }
}

function createFailedSubscriptionSyncResult(sourceId: string, syncedAt: string, error: unknown): SubscriptionSourceSyncResult {
  const message = error instanceof Error ? error.message : String(error);

  return {
    sourceId,
    status: 'failed',
    nodeCount: 0,
    syncedAt,
    nodes: [],
    warnings: [`subscription_source.sync_failed:${message}`]
  };
}

export function createServiceBackedControlPlaneApi({
  repository,
  service,
  inventory = {},
  fetcher = fetch
}: ServiceBackedControlPlaneApiInput): ControlPlaneApi {
  let subscriptionSources = clone(inventory.subscriptionSources ?? []);
  let subscriptionInventoryNodes = clone(inventory.subscriptionInventoryNodes ?? []);
  let subscriptionClients = clone(inventory.subscriptionClients ?? []);
  let agents = clone(inventory.agents ?? []);
  let inbounds = clone(inventory.inbounds ?? []);
  let forwardRulesReadModel: Awaited<ReturnType<ControlPlaneRepository['listForwardRules']>> | undefined;
  let persistedTaskReadModelsHydrated = false;
  let persistedSubscriptionInventoryHydrated = false;
  const deletedAgentIds = new Set<string>();

  async function listForwardRuleReadModel() {
    if (!forwardRulesReadModel) {
      forwardRulesReadModel = clone(await repository.listForwardRules());
    }

    return clone(forwardRulesReadModel);
  }

  async function hydrateAgentReadModelFromRuntimeCredentials() {
    const credentials = await service.listAgentCredentials();
    const sessions = await repository.listAgentSessions();
    let nextAgents = agents;

    for (const credential of credentials) {
      if (credential.purpose !== 'runtime' || credential.status !== 'active') {
        continue;
      }

      if (deletedAgentIds.has(credential.agentId)) {
        continue;
      }

      if (nextAgents.some((agent) => agent.id === credential.agentId)) {
        continue;
      }

      const session = sessions.find(
        (item) => item.agentId === credential.agentId && (!credential.sessionId || item.sessionId === credential.sessionId)
      );
      nextAgents = [createAgentFromCredential(credential, session), ...nextAgents];
    }

    agents = nextAgents;
  }

  async function hydrateSubscriptionInventoryNodes() {
    if (persistedSubscriptionInventoryHydrated) {
      return;
    }

    const persistedNodes = await repository.listSubscriptionInventoryNodes();
    if (persistedNodes.length > 0) {
      const deletedSourceIds = new Set(
        (await repository.listTasks())
          .map(readSubscriptionSourceDeleteId)
          .filter((sourceId): sourceId is string => Boolean(sourceId))
      );
      subscriptionInventoryNodes =
        deletedSourceIds.size > 0
          ? persistedNodes.filter((node) => !deletedSourceIds.has(node.sourceId))
          : persistedNodes;
    }
    persistedSubscriptionInventoryHydrated = true;
  }

  async function hydrateReadModelsFromPersistedTasks() {
    if (persistedTaskReadModelsHydrated) {
      return;
    }

    await hydrateAgentReadModelFromRuntimeCredentials();

    const tasks = sortTasksForReadModelReplay(await repository.listTasks());
    let nextAgents = agents;
    let nextInbounds = inbounds;
    let nextSubscriptionSources = subscriptionSources;
    let nextSubscriptionClients = subscriptionClients;
    let nextForwardRules = await listForwardRuleReadModel();

    for (const task of tasks) {
      if (task.operation === 'agent.delete') {
        deletedAgentIds.add(readAgentIdFromTask(task));
      }

      const deletedSourceId = readSubscriptionSourceDeleteId(task);
      if (deletedSourceId) {
        subscriptionInventoryNodes = subscriptionInventoryNodes.filter((node) => node.sourceId !== deletedSourceId);
      }

      nextAgents = applyAgentTask(nextAgents, task);
      nextInbounds = applyXrayInboundTask(nextInbounds, task);
      nextSubscriptionSources = applySubscriptionSourceTask(nextSubscriptionSources, task);
      nextSubscriptionClients = applySubscriptionClientTask(nextSubscriptionClients, task);
      nextForwardRules = applyForwardRuleTask(nextForwardRules, task);
    }

    for (const event of sortAgentEventsForReadModelReplay(await repository.listAgentEvents())) {
      if (deletedAgentIds.has(event.agentId)) {
        continue;
      }

      nextAgents = applyAgentEventToReadModel(nextAgents, event);
      nextForwardRules = applyForwardingTelemetryToReadModel(nextForwardRules, event);
    }

    agents = nextAgents;
    inbounds = nextInbounds;
    subscriptionSources = nextSubscriptionSources;
    subscriptionClients = nextSubscriptionClients;
    forwardRulesReadModel = nextForwardRules;
    persistedTaskReadModelsHydrated = true;
  }

  return {
    async getApiBoundary() {
      return clone(v1ApiBoundary);
    },

    async listAgents() {
      await hydrateReadModelsFromPersistedTasks();
      await hydrateAgentReadModelFromRuntimeCredentials();
      return clone(agents);
    },

    async listNodes() {
      return clone(inventory.nodes ?? []);
    },

    async listInbounds() {
      await hydrateReadModelsFromPersistedTasks();
      return clone(inbounds);
    },

    async listSubscriptionSources() {
      await hydrateReadModelsFromPersistedTasks();
      return clone(subscriptionSources);
    },

    async listSubscriptionInventoryNodes() {
      await hydrateSubscriptionInventoryNodes();
      return clone(subscriptionInventoryNodes);
    },

    async listSubscriptionBundles() {
      return clone(inventory.subscriptionBundles ?? []);
    },

    async listSubscriptionClients() {
      await hydrateReadModelsFromPersistedTasks();
      return clone(subscriptionClients);
    },

    async listForwardRules() {
      await hydrateReadModelsFromPersistedTasks();
      return listForwardRuleReadModel();
    },

    async listQuotaPolicies() {
      return clone(inventory.quotaPolicies ?? []);
    },

    async listRateLimitPolicies() {
      return clone(inventory.rateLimitPolicies ?? []);
    },

    async listPermissionGrants() {
      return repository.listPermissionGrants();
    },

    async listRoutingPolicies() {
      return clone(inventory.routingPolicies ?? []);
    },

    async listTuningProfiles() {
      return clone(inventory.tuningProfiles ?? []);
    },

    async listTasks() {
      return repository.listTasks();
    },

    async listCommandOutbox() {
      return repository.listCommandOutbox();
    },

    async listAgentCredentials() {
      return service.listAgentCredentials();
    },

    async listConfigRevisions() {
      return repository.listConfigRevisions();
    },

    async listPreflightPlans() {
      return repository.listPreflightPlans();
    },

    async listRuntimeSnapshots() {
      return repository.listRuntimeSnapshots();
    },

    async listAuditLogs() {
      return repository.listAuditLogs();
    },

    async verifyAuditLogChain(logs?: AuditLog[]) {
      return verifyAuditLogs(clone(logs ?? (await repository.listAuditLogs())));
    },

    async createAgentInstallCommand(input: AgentInstallCommandRequest, context?: MutationContext) {
      return service.createAgentInstallCommand(input, resolveMutationContext(context));
    },

    async registerAgent(input: AgentRegistrationRequest, installToken, context) {
      const credential = await service.registerAgent(input, installToken, context);
      await hydrateAgentReadModelFromRuntimeCredentials();
      return credential;
    },

    async revokeAgentCredential(credentialId, input, context?: MutationContext) {
      return service.revokeAgentCredential(credentialId, input, resolveMutationContext(context));
    },

    async rotateAgentCredential(credentialId, input, context?: MutationContext) {
      return service.rotateAgentCredential(credentialId, input, resolveMutationContext(context));
    },

    async createTask(input: CreateTaskInput, context?: MutationContext) {
      await hydrateReadModelsFromPersistedTasks();

      const task = await service.createTask(input, resolveMutationContext(context));

      if (task.operation === 'agent.delete') {
        deletedAgentIds.add(readAgentIdFromTask(task));
      }

      const deletedSourceId = readSubscriptionSourceDeleteId(task);
      if (deletedSourceId) {
        subscriptionInventoryNodes = subscriptionInventoryNodes.filter((node) => node.sourceId !== deletedSourceId);
        await repository.transaction((transaction) =>
          transaction.replaceSubscriptionInventoryNodesForSource(deletedSourceId, [])
        );
      }

      subscriptionSources = applySubscriptionSourceTask(subscriptionSources, task);
      inbounds = applyXrayInboundTask(inbounds, task);
      forwardRulesReadModel = applyForwardRuleTask(await listForwardRuleReadModel(), task);
      agents = applyAgentTask(agents, task);
      subscriptionClients = applySubscriptionClientTask(subscriptionClients, task);

      return task;
    },

    async syncSubscriptionSource(sourceId: string) {
      await hydrateReadModelsFromPersistedTasks();
      await hydrateSubscriptionInventoryNodes();

      const source = subscriptionSources.find((item) => item.id === sourceId);
      const syncedAt = new Date().toISOString();

      if (!source) {
        throw new Error(`Subscription source not found: ${sourceId}`);
      }

      assertSubscriptionSourceSyncAllowed(source, syncedAt);

      try {
        const response = await fetcher(source.url, {
          headers: {
            Accept:
              source.kind === 'v2ray-uri'
                ? 'text/plain,*/*'
                : source.kind === 'sing-box'
                  ? 'application/json,text/json,text/plain,*/*'
                  : 'text/yaml,application/yaml,text/plain,*/*',
            'User-Agent': source.userAgent || 'OU-UI-Next/1.0'
          }
        });

        if (!response.ok) {
          throw new Error(`remote responded ${response.status} ${response.statusText}`);
        }

        const result = parseSubscriptionSourceContent({
          source,
          body: await response.text(),
          syncedAt
        });

        subscriptionInventoryNodes = [
          ...result.nodes,
          ...subscriptionInventoryNodes.filter((node) => node.sourceId !== sourceId)
        ];
        await repository.transaction((transaction) =>
          transaction.replaceSubscriptionInventoryNodesForSource(sourceId, result.nodes)
        );
        subscriptionSources = updateSubscriptionSourceSyncState(subscriptionSources, sourceId, {
          status: result.status,
          nodeCount: result.nodeCount,
          lastSyncAt: result.syncedAt
        });

        return clone(result);
      } catch (error) {
        const failedResult = createFailedSubscriptionSyncResult(sourceId, syncedAt, error);
        subscriptionInventoryNodes = subscriptionInventoryNodes.filter((node) => node.sourceId !== sourceId);
        await repository.transaction((transaction) =>
          transaction.replaceSubscriptionInventoryNodesForSource(sourceId, [])
        );
        subscriptionSources = updateSubscriptionSourceSyncState(subscriptionSources, sourceId, {
          status: 'failed',
          nodeCount: 0,
          lastSyncAt: syncedAt
        });
        return clone(failedResult);
      }
    },

    async transitionTask(taskId: string, status: DeployTaskStatus, context?: MutationContext) {
      return service.transitionTask(taskId, status, resolveMutationContext(context));
    },

    async issueAgentCommand(agentId: string, command: AgentCommandEnvelope, context?: MutationContext) {
      return service.issueAgentCommand(agentId, command, resolveMutationContext(context));
    },

    async leaseAgentCommands(agentId, options) {
      return service.leaseAgentCommands(agentId, options);
    },

    async sweepCommandTimeouts(options) {
      return service.sweepCommandTimeouts(options);
    },

    async receiveAgentEvent(event: AgentEventEnvelope) {
      const result = await service.receiveAgentEvent(event);
      if (!deletedAgentIds.has(event.agentId)) {
        agents = applyAgentEventToReadModel(agents, event);
        forwardRulesReadModel = applyForwardingTelemetryToReadModel(await listForwardRuleReadModel(), event);
      }
      return result;
    }
  };
}
