import { isXrayRuntimeProtocol, type XrayInbound } from '../../domain/protocol';
import type { CreateTaskInput, DeployTask } from '../../domain/task';
import { readCustomerNodePolicyId } from './customer-node-policy-identity';

type XrayGuardrailEnforcementTrigger = {
  kind: 'agent-event' | 'task';
  id: string;
  observedAt: string;
};

type XrayGuardrailTaskIntent = {
  input: CreateTaskInput;
  requestId: string;
  idempotencyKey: string;
};

const ACTIVE_TASK_STATUSES = new Set(['queued', 'running', 'retrying']);
const GB = 1024 ** 3;

function clampBytes(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(value ?? 0, 0) : 0;
}

function bytesToGb(value: number | undefined) {
  return clampBytes(value) / GB;
}

function computeRemainingDays(expiresAt: string | undefined, observedAt: string, fallback?: number) {
  if (Number.isFinite(fallback)) {
    return Math.max(Math.round(fallback ?? 0), 0);
  }

  const expiresAtMs = Date.parse(expiresAt ?? '');
  const observedAtMs = Date.parse(observedAt);

  if (Number.isNaN(expiresAtMs) || Number.isNaN(observedAtMs)) {
    return 0;
  }

  return Math.max(Math.ceil((expiresAtMs - observedAtMs) / (24 * 60 * 60 * 1000)), 0);
}

function createPolicyId(inbound: XrayInbound, client: XrayInbound['clients'][number]) {
  const scopedInbound =
    inbound.clients.length > 1
      ? {
          ...inbound,
          clientIdentity: undefined
        }
      : inbound;

  return readCustomerNodePolicyId(scopedInbound, client);
}

function isAutomaticGuardrailTask(task: DeployTask) {
  return task.operation === 'inbound.update' && task.metadata?.xrayGuardrailAutomatic === true;
}

function compareTasksByCreatedAt(left: DeployTask, right: DeployTask) {
  if (left.createdAt !== right.createdAt) {
    return right.createdAt.localeCompare(left.createdAt);
  }

  return right.id.localeCompare(left.id);
}

function readLatestAutomaticGuardrailTask(tasks: DeployTask[], targetId: string, policyId: string, action?: 'disable' | 'resume') {
  return tasks
    .filter(
      (task) =>
        isAutomaticGuardrailTask(task)
        && task.targetId === targetId
        && task.metadata?.xrayGuardrailPolicyId === policyId
        && (!action || task.metadata?.xrayGuardrailAction === action)
    )
    .sort(compareTasksByCreatedAt)[0];
}

function readClientUsedTrafficBytes(client: XrayInbound['clients'][number]) {
  const usedTrafficBytes =
    (client.manualUsedTrafficBytes ?? 0) > 0
      ? client.manualUsedTrafficBytes
      : client.usedTrafficBytes;

  return usedTrafficBytes;
}

function readClientTaskIdentity(inbound: XrayInbound, client: XrayInbound['clients'][number]) {
  return inbound.clients.length > 1 ? client.id : inbound.clientIdentity ?? client.id;
}

function createClientTaskMetadata(
  inbound: XrayInbound,
  client: XrayInbound['clients'][number],
  observedAt: string,
  enabled: boolean
) {
  return {
    clientIdentity: readClientTaskIdentity(inbound, client),
    clientEmail: client.email,
    clientCredential: client.password ?? client.auth ?? client.id,
    clientLevel: client.level ?? 0,
    clientComment: client.comment ?? '',
    telegramId: client.tgId ?? '',
    resetPolicy: client.resetPolicy ?? 'never',
    shadowsocksMethod: client.method ?? '2022-blake3-aes-128-gcm',
    hysteriaAuth: client.auth ?? client.password ?? client.id,
    flow: client.flow ?? inbound.flow ?? '',
    ipLimit: client.ipLimit,
    trafficLimitGb: Math.round(bytesToGb(client.trafficLimitBytes)),
    monthlyResetDay: client.monthlyResetDay ?? 1,
    currentUsedTrafficGb: bytesToGb(readClientUsedTrafficBytes(client)),
    remainingDays: computeRemainingDays(client.expiresAt, observedAt, inbound.remainingDays),
    enabled,
    quotaExceeded: client.quotaExceeded ?? false,
    clientExpired: client.clientExpired ?? false,
    runtimeDisabledByPolicy: client.runtimeDisabledByPolicy ?? false,
    guardrailReason: client.guardrailReason ?? 'ok',
    ...(client.security?.trim() ? { vmessSecurity: client.security.trim() } : {})
  };
}

function createCustomerNodeTaskMetadata(
  inbound: XrayInbound,
  observedAt: string,
  affectedClient: XrayInbound['clients'][number],
  action: 'disable' | 'resume'
) {
  const clients = inbound.clients.map((client) => {
    const isAffectedClient = client.id === affectedClient.id || client.email === affectedClient.email;
    const enabled = isAffectedClient ? action === 'resume' : client.enabled && !client.runtimeDisabledByPolicy;

    return createClientTaskMetadata(inbound, client, observedAt, enabled);
  });
  const activeClientCount = clients.filter((client) => client.enabled).length;

  return {
    nodeId: inbound.id,
    agentId: inbound.agentId ?? '',
    customerNodeName: inbound.label,
    customerName: inbound.customerName ?? affectedClient.email,
    xrayProtocol: inbound.protocol,
    listenPort: inbound.listenPort,
    streamNetwork: inbound.streamSettings.network,
    security: inbound.streamSettings.security,
    sni: inbound.streamSettings.sni ?? '',
    path: inbound.streamSettings.path ?? '',
    fingerprint: inbound.streamSettings.fingerprint ?? inbound.reality.fingerprint ?? '',
    alpn: inbound.tls.alpn,
    realityPublicKey: inbound.reality.publicKey ?? '',
    realityPrivateKey: inbound.reality.privateKey ?? '',
    realityTarget: inbound.reality.target ?? '',
    realityShortId: inbound.reality.shortIds[0] ?? '',
    fallbackName: inbound.fallbacks[0]?.name ?? '',
    fallbackDestination: inbound.fallbacks[0]?.destination ?? '',
    fallbackXver: inbound.fallbacks[0]?.xver ?? 0,
    sniffingEnabled: inbound.sniffingEnabled,
    subscriptionRule: inbound.subscriptionRule ?? 'manual',
    ...createClientTaskMetadata(inbound, affectedClient, observedAt, action === 'resume'),
    enabled: activeClientCount > 0,
    clients,
    ...(inbound.serverAddress?.trim() ? { serverAddress: inbound.serverAddress.trim() } : {})
  };
}

function createSummaryPrefix(action: 'disable' | 'resume', guardrailReason: string | undefined) {
  if (action === 'disable') {
    return guardrailReason === 'xray_client_expired' ? '客户节点到期自动停用' : '客户节点配额超限自动停用';
  }

  return guardrailReason === 'xray_client_expired' ? '客户节点到期恢复自动恢复' : '客户节点配额恢复自动恢复';
}

function createIntent(
  inbound: XrayInbound,
  trigger: XrayGuardrailEnforcementTrigger,
  client: XrayInbound['clients'][number],
  action: 'disable' | 'resume'
): XrayGuardrailTaskIntent | undefined {
  if (!inbound.agentId?.trim()) {
    return undefined;
  }

  if (!isXrayRuntimeProtocol(inbound.protocol)) {
    return undefined;
  }

  const metadata = createCustomerNodeTaskMetadata(inbound, trigger.observedAt, client, action);
  const policyId = createPolicyId(inbound, client);
  const requestId = ['req', 'xray-guardrail', action, inbound.id, client.id, trigger.kind, trigger.id].join(':');
  const idempotencyKey = ['system', 'quota-enforcer', 'inbound.update', inbound.id, client.id, action, trigger.kind, trigger.id].join(':');

  return {
    requestId,
    idempotencyKey,
    input: {
      operation: 'inbound.update',
      resourceType: 'inbound',
      targetId: inbound.id,
      targetLabel: inbound.label,
      summary: `${createSummaryPrefix(action, client.guardrailReason)} ${inbound.label}`,
      metadata: {
        ...metadata,
        xrayGuardrailAutomatic: true,
        xrayGuardrailAction: action,
        xrayGuardrailPolicyId: policyId,
        xrayGuardrailPolicyScope: 'customer-node',
        xrayGuardrailObservedAt: trigger.observedAt,
        xrayGuardrailTriggerKind: trigger.kind,
        xrayGuardrailTriggerId: trigger.id,
        xrayGuardrailReason: client.guardrailReason ?? (client.runtimeDisabledByPolicy ? 'xray_client_monthly_quota_exceeded' : 'ok')
      }
    }
  };
}

export function deriveXrayGuardrailTaskIntents(
  tasks: DeployTask[],
  afterInbounds: XrayInbound[],
  trigger: XrayGuardrailEnforcementTrigger
) {
  return afterInbounds.flatMap((inbound) => {
    if (!isXrayRuntimeProtocol(inbound.protocol) || inbound.clients.length === 0) {
      return [];
    }

    return inbound.clients.flatMap((client) => {
      const policyId = createPolicyId(inbound, client);
      const latestDisableTask = readLatestAutomaticGuardrailTask(tasks, inbound.id, policyId, 'disable');
      const latestResumeTask = readLatestAutomaticGuardrailTask(tasks, inbound.id, policyId, 'resume');
      const latestSucceededResumeTask =
        latestResumeTask?.status === 'succeeded'
          ? latestResumeTask
          : undefined;
      const latestSucceededDisableTask =
        latestDisableTask?.status === 'succeeded'
          ? latestDisableTask
          : undefined;
      const hasActiveResume = latestResumeTask ? ACTIVE_TASK_STATUSES.has(latestResumeTask.status) : false;
      const disableAlreadyEnforced =
        latestDisableTask
        && (ACTIVE_TASK_STATUSES.has(latestDisableTask.status) || latestDisableTask.status === 'succeeded')
        && (!latestSucceededResumeTask || latestDisableTask.createdAt > latestSucceededResumeTask.createdAt);
      const needsResume =
        latestSucceededDisableTask
        && (!latestResumeTask
          || latestSucceededDisableTask.createdAt > latestResumeTask.createdAt
          || latestResumeTask.status === 'failed'
          || latestResumeTask.status === 'canceled');

      if (client.runtimeDisabledByPolicy) {
        const disableIntent = disableAlreadyEnforced ? undefined : createIntent(inbound, trigger, client, 'disable');
        return disableIntent ? [disableIntent] : [];
      }

      if (hasActiveResume || !needsResume) {
        return [];
      }

      const resumeIntent = createIntent(inbound, trigger, client, 'resume');
      return resumeIntent ? [resumeIntent] : [];
    });
  });
}
