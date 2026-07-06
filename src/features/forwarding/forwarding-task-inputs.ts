import type { CreateTaskInput } from '../../domain/task';
import { collectBlockedForwardingRuntimeControls, type ForwardingRuntimeBlockedControl } from '../../domain/forwarding';
import type { ForwardingCreateMetadata, ForwardingRuleView } from './forwarding-page';

export type ForwardingSaveAction = 'create' | 'update';
export type ForwardingRunAction = 'apply' | 'pause' | 'resume';
export type ForwardingOperation =
  | 'forward.create'
  | 'forward.update'
  | 'forward.apply'
  | 'forward.pause'
  | 'forward.resume'
  | 'forward.delete';

export type ForwardingTaskMetadata = ForwardingCreateMetadata & {
  blockedRuntimeControls?: ForwardingRuntimeBlockedControl[];
  blockedRuntimeControlValues?: Partial<
    Pick<ForwardingCreateMetadata, 'ipRateLimitMbps' | 'maxConnections' | 'maxConnectionsPerIp' | 'proxyProtocol'>
  >;
};

function createStableHash(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(36).padStart(7, '0');
}

function withRiskConfirmation(input: CreateTaskInput): CreateTaskInput {
  return {
    ...input,
    riskConfirmation: {
      operation: input.operation,
      targetId: input.targetId
    }
  };
}

export function createForwardingMetadataFromRule(rule: ForwardingRuleView): ForwardingTaskMetadata {
  const blockedRuntimeControls = collectBlockedForwardingRuntimeControls(rule);

  return {
    name: rule.name,
    ownerName: rule.ownerName,
    tunnelId: rule.tunnelId,
    listenAddress: rule.listenAddress,
    listenPort: rule.listenPort,
    targetAddress: rule.targetAddress,
    targetPort: rule.targetPort,
    protocol: rule.protocol,
    entryNodeIds: rule.entryNodeIds.length > 0 ? rule.entryNodeIds : [rule.sourceAgentId],
    strategy: rule.strategy,
    quotaGb: Math.round(rule.quotaBytes / 1024 / 1024 / 1024),
    monthlyResetDay: rule.monthlyResetDay,
    currentUsedTrafficGb: rule.currentUsedTrafficGb,
    rateLimitMbps: rule.rateLimitMbps,
    rateLimitMode: rule.rateLimitMode,
    rateLimitDirection: rule.rateLimitDirection,
    ipRateLimitMbps: 0,
    maxConnections: 0,
    maxConnectionsPerIp: 0,
    proxyProtocol: false,
    billingDirection: rule.billingDirection,
    tunnelMode: rule.tunnelMode,
    enabled: rule.enabled,
    ...(blockedRuntimeControls.length > 0
      ? {
          blockedRuntimeControls,
          blockedRuntimeControlValues: {
            ipRateLimitMbps: rule.ipRateLimitMbps,
            maxConnections: rule.maxConnections,
            maxConnectionsPerIp: rule.maxConnectionsPerIp,
            proxyProtocol: rule.proxyProtocol
          }
        }
      : {})
  };
}

export function createForwardingIdempotencyKey(
  operation: ForwardingOperation,
  targetId: string,
  metadata?: ForwardingTaskMetadata
) {
  if (!metadata) {
    return ['ui', operation, targetId, 'unknown'].join(':');
  }

  const identity = JSON.stringify({
    name: metadata.name,
    ownerName: metadata.ownerName,
    tunnelId: metadata.tunnelId ?? '',
    listenAddress: metadata.listenAddress,
    listenPort: metadata.listenPort,
    targetAddress: metadata.targetAddress,
    targetPort: metadata.targetPort,
    protocol: metadata.protocol,
    entryNodeIds: metadata.entryNodeIds,
    strategy: metadata.strategy,
    quotaGb: metadata.quotaGb,
    monthlyResetDay: metadata.monthlyResetDay,
    currentUsedTrafficGb: metadata.currentUsedTrafficGb,
    rateLimitMbps: metadata.rateLimitMbps,
    rateLimitMode: metadata.rateLimitMode,
    rateLimitDirection: metadata.rateLimitDirection,
    ipRateLimitMbps: metadata.ipRateLimitMbps,
    maxConnections: metadata.maxConnections,
    maxConnectionsPerIp: metadata.maxConnectionsPerIp,
    proxyProtocol: metadata.proxyProtocol,
    blockedRuntimeControls: metadata.blockedRuntimeControls,
    blockedRuntimeControlValues: metadata.blockedRuntimeControlValues,
    billingDirection: metadata.billingDirection,
    tunnelMode: metadata.tunnelMode,
    enabled: metadata.enabled
  });

  return ['ui', operation, targetId, createStableHash(identity)].join(':');
}

export function createForwardingTargetId(metadata: Pick<ForwardingCreateMetadata, 'listenPort'>, ruleId?: string) {
  return ruleId || `forward-custom-${metadata.listenPort}`;
}

export function createForwardingUpsertTaskInput(
  metadata: ForwardingCreateMetadata,
  action: ForwardingSaveAction,
  options: { ruleId?: string; createSummary: string; updateSummary: string; defaultTargetLabel: string }
): CreateTaskInput {
  const operation = action === 'create' ? 'forward.create' : 'forward.update';
  const targetId = createForwardingTargetId(metadata, options.ruleId);

  return {
    operation,
    resourceType: 'forward',
    targetId,
    targetLabel: metadata.name || options.defaultTargetLabel,
    summary: action === 'create' ? options.createSummary : options.updateSummary,
    metadata
  };
}

export function createForwardingRunTaskInput(
  targetId: string,
  rule: ForwardingRuleView | undefined,
  action: ForwardingRunAction,
  summaries: { apply: string; pause: string; resume: string; defaultTargetLabel: string }
): CreateTaskInput {
  const operation: ForwardingOperation =
    action === 'pause' ? 'forward.pause' : action === 'resume' ? 'forward.resume' : 'forward.apply';
  const metadata = rule
    ? createForwardingMetadataFromRule({
        ...rule,
        enabled: action === 'pause' ? false : action === 'resume' ? true : rule.enabled
      })
    : undefined;
  const input: CreateTaskInput = {
    operation,
    resourceType: 'forward',
    targetId,
    targetLabel: rule?.name ?? summaries.defaultTargetLabel,
    summary: action === 'pause' ? summaries.pause : action === 'resume' ? summaries.resume : summaries.apply,
    metadata
  };

  return action === 'pause' || action === 'resume' ? withRiskConfirmation(input) : input;
}

export function createForwardingDeleteTaskInput(rule: ForwardingRuleView, summary: string): CreateTaskInput {
  return withRiskConfirmation({
    operation: 'forward.delete',
    resourceType: 'forward',
    targetId: rule.id,
    targetLabel: rule.name,
    summary,
    metadata: createForwardingMetadataFromRule(rule)
  });
}

export function createForwardingDeleteIdempotencyKey(rule: Pick<ForwardingRuleView, 'id' | 'entryNodeIds'>) {
  return ['ui', 'forward.delete', rule.id, rule.entryNodeIds.join(',')].join(':');
}
