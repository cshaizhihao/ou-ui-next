import type { CreateTaskInput } from '../../domain/task';
import type { CustomerNodeConfigMetadata } from './nodes-page';
import { createCustomerNodeTaskMetadata } from './customer-node-task-metadata';

export type CustomerNodeSaveAction = 'create' | 'update';
export type CustomerNodeInboundOperation = 'inbound.create' | 'inbound.update' | 'inbound.delete';

function createStableSlug(value: string, fallback: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
}

function createStableHash(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(36).padStart(7, '0');
}

export function createCustomerNodeInboundTargetId(metadata: CustomerNodeConfigMetadata) {
  return metadata.nodeId || `inbound-${createStableSlug(metadata.customerNodeName, 'customer-node')}`;
}

function createCustomerNodeUpsertIdempotencyIdentity(metadata: CustomerNodeConfigMetadata) {
  return {
    serverAddress: metadata.serverAddress,
    listenPort: metadata.listenPort,
    xrayProtocol: metadata.xrayProtocol,
    streamNetwork: metadata.streamNetwork,
    security: metadata.security,
    sni: metadata.sni,
    path: metadata.path,
    flow: metadata.flow,
    fingerprint: metadata.fingerprint,
    alpn: metadata.alpn,
    realityPublicKey: metadata.realityPublicKey,
    realityTarget: metadata.realityTarget,
    realityShortId: metadata.realityShortId,
    fallbackName: metadata.fallbackName,
    fallbackDestination: metadata.fallbackDestination,
    fallbackXver: metadata.fallbackXver,
    sniffingEnabled: metadata.sniffingEnabled,
    clientIdentity: metadata.clientIdentity,
    clientEmail: metadata.clientEmail,
    clientLevel: metadata.clientLevel,
    resetPolicy: metadata.resetPolicy,
    vmessSecurity: metadata.vmessSecurity,
    shadowsocksMethod: metadata.shadowsocksMethod,
    ipLimit: metadata.ipLimit,
    trafficMultiplier: metadata.trafficMultiplier,
    trafficLimitGb: metadata.trafficLimitGb,
    monthlyResetDay: metadata.monthlyResetDay,
    currentUsedTrafficGb: metadata.currentUsedTrafficGb,
    remainingDays: metadata.remainingDays,
    expiresAt: metadata.expiresAt,
    quotaExceeded: metadata.quotaExceeded,
    clientExpired: metadata.clientExpired,
    runtimeDisabledByPolicy: metadata.runtimeDisabledByPolicy,
    guardrailReason: metadata.guardrailReason,
    subscriptionRule: metadata.subscriptionRule,
    enabled: metadata.enabled
  };
}

export function createCustomerNodeInboundIdempotencyKey(
  metadata: CustomerNodeConfigMetadata,
  operation: CustomerNodeInboundOperation
) {
  if (operation === 'inbound.delete') {
    return ['ui', operation, metadata.agentId, metadata.nodeId].join(':');
  }

  const prefix = [
    'ui',
    operation,
    metadata.agentId,
    metadata.nodeId,
    metadata.listenPort,
    metadata.xrayProtocol,
    metadata.customerName
  ].join(':');
  const identityHash = createStableHash(JSON.stringify(createCustomerNodeUpsertIdempotencyIdentity(metadata)));

  return [prefix, identityHash].join(':');
}

export function createCustomerNodeInboundTaskInput(
  metadata: CustomerNodeConfigMetadata,
  action: CustomerNodeSaveAction,
  summaries: { create: string; update: string }
): CreateTaskInput {
  const operation = action === 'create' ? 'inbound.create' : 'inbound.update';
  const targetId = createCustomerNodeInboundTargetId(metadata);

  return {
    operation,
    resourceType: 'inbound',
    targetId,
    targetLabel: metadata.customerNodeName,
    summary: action === 'create' ? summaries.create : summaries.update,
    metadata: createCustomerNodeTaskMetadata(metadata, operation)
  };
}

export function createCustomerNodeDeleteTaskInput(metadata: CustomerNodeConfigMetadata, summary: string): CreateTaskInput {
  return {
    operation: 'inbound.delete',
    resourceType: 'inbound',
    targetId: metadata.nodeId,
    targetLabel: metadata.customerNodeName,
    summary,
    metadata: createCustomerNodeTaskMetadata(metadata, 'inbound.delete'),
    riskConfirmation: {
      operation: 'inbound.delete',
      targetId: metadata.nodeId
    }
  };
}
