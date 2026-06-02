import type {
  Agent,
  AgentInstallCommandRequest,
  AuditLog,
  CreateTaskInput,
  DeployTaskStatus,
  ManagedNode,
  QuotaPolicy,
  RateLimitPolicy,
  RoutingPolicy,
  SubscriptionBundle,
  SubscriptionSource,
  Tunnel,
  TuningProfile,
  XrayInbound
} from '../../domain';
import type { ControlPlaneRepository } from '../../server/control-plane/control-plane-repository';
import type { createControlPlaneService } from '../../server/control-plane/control-plane-service';
import {
  seedAgents,
  seedInbounds,
  seedNodes,
  seedQuotaPolicies,
  seedRateLimitPolicies,
  seedRoutingPolicies,
  seedSubscriptionBundles,
  seedSubscriptionSources,
  seedTuningProfiles,
  seedTunnels
} from '../mock/mock-data';
import type { AgentCommandEnvelope, AgentEventEnvelope } from './api-contract';
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

export function createServiceBackedControlPlaneApi({
  repository,
  service,
  inventory = {}
}: ServiceBackedControlPlaneApiInput): ControlPlaneApi {
  return {
    async getApiBoundary() {
      return clone(v1ApiBoundary);
    },

    async listAgents() {
      return clone(inventory.agents ?? seedAgents);
    },

    async listNodes() {
      return clone(inventory.nodes ?? seedNodes);
    },

    async listInbounds() {
      return clone(inventory.inbounds ?? seedInbounds);
    },

    async listSubscriptionSources() {
      return clone(inventory.subscriptionSources ?? seedSubscriptionSources);
    },

    async listSubscriptionBundles() {
      return clone(inventory.subscriptionBundles ?? seedSubscriptionBundles);
    },

    async listTunnels() {
      return clone(inventory.tunnels ?? seedTunnels);
    },

    async listForwardRules() {
      return repository.listForwardRules();
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

    async createTask(input: CreateTaskInput, context?: MutationContext) {
      return service.createTask(input, resolveMutationContext(context));
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
      return service.receiveAgentEvent(event);
    }
  };
}
