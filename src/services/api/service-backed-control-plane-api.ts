import type {
  Agent,
  AgentCredentialSummary,
  AgentInstallCommandRequest,
  AgentRegistrationRequest,
  AuditLog,
  CreateTaskInput,
  DeployTaskStatus,
  ManagedNode,
  QuotaPolicy,
  RateLimitPolicy,
  RoutingPolicy,
  SubscriptionBundle,
  SubscriptionClientIdentity,
  SubscriptionSource,
  Tunnel,
  TuningProfile,
  XrayInbound
} from '../../domain';
import {
  applyAgentTask,
  applyForwardRuleTask,
  applySubscriptionClientTask,
  applyTunnelTask,
  applyXrayInboundTask,
  createSubscriptionSourceFromTask
} from '../../domain';
import type { AgentSessionState, ControlPlaneRepository } from '../../server/control-plane/control-plane-repository';
import type { createControlPlaneService } from '../../server/control-plane/control-plane-service';
import {
  seedAgents,
  seedInbounds,
  seedNodes,
  seedQuotaPolicies,
  seedRateLimitPolicies,
  seedRoutingPolicies,
  seedSubscriptionBundles,
  seedSubscriptionClients,
  seedSubscriptionSources,
  seedTuningProfiles,
  seedTunnels
} from '../mock/mock-data';
import type { AgentCommandEnvelope, AgentEventEnvelope } from './api-contract';
import { applyAgentEventToReadModel } from './agent-telemetry-read-model';
import type {
  AuditChainVerification,
  ControlPlaneApi,
  MutationContext
} from './control-plane-api';
import { v1ApiBoundary } from './control-plane-api';

type ControlPlaneService = ReturnType<typeof createControlPlaneService>;

type ServiceBackedControlPlaneApiInput = {
  repository: ControlPlaneRepository;
  service: ControlPlaneService;
  inventory?: Partial<{
    agents: Agent[];
    nodes: ManagedNode[];
    inbounds: XrayInbound[];
    subscriptionSources: SubscriptionSource[];
    subscriptionBundles: SubscriptionBundle[];
    subscriptionClients: SubscriptionClientIdentity[];
    tunnels: Tunnel[];
    quotaPolicies: QuotaPolicy[];
    rateLimitPolicies: RateLimitPolicy[];
    routingPolicies: RoutingPolicy[];
    tuningProfiles: TuningProfile[];
  }>;
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
  let first = 0x811c9dc5;
  let second = 0x01000193;

  for (let index = 0; index < normalized.length; index += 1) {
    first ^= normalized.charCodeAt(index);
    first = Math.imul(first, 0x01000193);
    second ^= normalized.charCodeAt(normalized.length - index - 1);
    second = Math.imul(second, 0x811c9dc5);
  }

  const seed = `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
  return `sha256:${seed.repeat(4).slice(0, 64)}`;
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
      if (capability === 'port-forwarding') return 'flvx';
      if (
        capability === 'host-agent' ||
        capability === 'xray' ||
        capability === 'gost' ||
        capability === 'hysteria2' ||
        capability === 'flvx' ||
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
    name: credential.metadata.hostName?.trim() || credential.agentId,
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

export function createServiceBackedControlPlaneApi({
  repository,
  service,
  inventory = {}
}: ServiceBackedControlPlaneApiInput): ControlPlaneApi {
  let subscriptionSources = clone(inventory.subscriptionSources ?? seedSubscriptionSources);
  let subscriptionClients = clone(inventory.subscriptionClients ?? seedSubscriptionClients);
  let agents = clone(inventory.agents ?? seedAgents);
  let inbounds = clone(inventory.inbounds ?? seedInbounds);
  let tunnels = clone(inventory.tunnels ?? seedTunnels);
  let forwardRulesReadModel: Awaited<ReturnType<ControlPlaneRepository['listForwardRules']>> | undefined;

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

  return {
    async getApiBoundary() {
      return clone(v1ApiBoundary);
    },

    async listAgents() {
      await hydrateAgentReadModelFromRuntimeCredentials();
      return clone(agents);
    },

    async listNodes() {
      return clone(inventory.nodes ?? seedNodes);
    },

    async listInbounds() {
      return clone(inbounds);
    },

    async listSubscriptionSources() {
      return clone(subscriptionSources);
    },

    async listSubscriptionBundles() {
      return clone(inventory.subscriptionBundles ?? seedSubscriptionBundles);
    },

    async listSubscriptionClients() {
      return clone(subscriptionClients);
    },

    async listTunnels() {
      return clone(tunnels);
    },

    async listForwardRules() {
      return listForwardRuleReadModel();
    },

    async listQuotaPolicies() {
      return clone(inventory.quotaPolicies ?? seedQuotaPolicies);
    },

    async listRateLimitPolicies() {
      return clone(inventory.rateLimitPolicies ?? seedRateLimitPolicies);
    },

    async listPermissionGrants() {
      return repository.listPermissionGrants();
    },

    async listRoutingPolicies() {
      return clone(inventory.routingPolicies ?? seedRoutingPolicies);
    },

    async listTuningProfiles() {
      return clone(inventory.tuningProfiles ?? seedTuningProfiles);
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
      const task = await service.createTask(input, resolveMutationContext(context));
      const importedSubscriptionSource = createSubscriptionSourceFromTask(task);

      if (importedSubscriptionSource) {
        subscriptionSources = [
          importedSubscriptionSource,
          ...subscriptionSources.filter((source) => source.id !== importedSubscriptionSource.id)
        ];
      }

      inbounds = applyXrayInboundTask(inbounds, task);
      forwardRulesReadModel = applyForwardRuleTask(await listForwardRuleReadModel(), task);
      tunnels = applyTunnelTask(tunnels, task);
      agents = applyAgentTask(agents, task);
      subscriptionClients = applySubscriptionClientTask(subscriptionClients, task);

      return task;
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
      agents = applyAgentEventToReadModel(agents, event);
      return result;
    }
  };
}
