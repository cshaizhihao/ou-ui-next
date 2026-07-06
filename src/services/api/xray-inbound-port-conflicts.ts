import type { CreateTaskInput, DeployTask, ManagedNode, XrayInbound, XrayRuntimeProtocol } from '../../domain';
import { isXrayRuntimeProtocol } from '../../domain';
import { allocateStableHighListenPort } from '../../domain/xray-port-allocation';

const ACTIVE_INBOUND_STATUSES = new Set<XrayInbound['status']>(['enabled', 'applying', 'error']);
const IN_FLIGHT_TASK_STATUSES = new Set<DeployTask['status']>(['queued', 'running', 'retrying']);

type XrayInboundMutation = Pick<CreateTaskInput, 'operation' | 'targetId' | 'metadata'>;

export type XrayInboundPortConflictDenial = {
  code: 'xray.port_conflict';
  denialReason: string;
  agentId: string;
  listenAddress: string;
  listenPort: number;
  requestedProtocol: XrayRuntimeProtocol;
  conflictingProtocol: XrayRuntimeProtocol;
  conflictingInboundId?: string;
  conflictingTaskId?: string;
};

function readString(metadata: Record<string, unknown> | undefined, key: string, fallback = '') {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function readNumber(metadata: Record<string, unknown> | undefined, key: string, fallback: number) {
  const value = metadata?.[key];

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function readBoolean(metadata: Record<string, unknown> | undefined, key: string, fallback: boolean) {
  const value = metadata?.[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readRuntimeProtocol(metadata: Record<string, unknown> | undefined): XrayRuntimeProtocol | undefined {
  const rawProtocol = metadata?.xrayProtocol;

  if (rawProtocol === undefined || rawProtocol === '') {
    return 'vless';
  }

  if (typeof rawProtocol !== 'string') {
    return undefined;
  }

  const protocol = rawProtocol.trim();
  return isXrayRuntimeProtocol(protocol) ? protocol : undefined;
}

function resolveListenPort(metadata: Record<string, unknown> | undefined, targetId: string) {
  const listenPort = readNumber(metadata, 'listenPort', 0);

  if (listenPort > 0) {
    return Math.round(listenPort);
  }

  return allocateStableHighListenPort(targetId);
}

function addressesOverlap(left: string, right: string) {
  if (left === right) {
    return true;
  }

  const wildcardAddresses = new Set(['', '0.0.0.0', '::', '[::]']);
  return wildcardAddresses.has(left) || wildcardAddresses.has(right);
}

function resolveInboundAgentId(inbound: XrayInbound, nodesById: Map<string, ManagedNode>) {
  return inbound.agentId || nodesById.get(inbound.nodeId)?.agentId;
}

function createDenial(input: {
  agentId: string;
  listenAddress: string;
  listenPort: number;
  requestedProtocol: XrayRuntimeProtocol;
  conflictingProtocol: XrayRuntimeProtocol;
  conflictingInboundId?: string;
  conflictingTaskId?: string;
}): XrayInboundPortConflictDenial {
  const conflictingResource = input.conflictingInboundId
    ? `inbound ${input.conflictingInboundId}`
    : `task ${input.conflictingTaskId}`;

  return {
    code: 'xray.port_conflict',
    denialReason: `Xray ${input.listenAddress}:${input.listenPort} on Agent ${input.agentId} is already reserved by ${conflictingResource} using ${input.conflictingProtocol}; ${input.requestedProtocol} cannot share that listener. Choose another listen port or keep the same runtime protocol.`,
    ...input
  };
}

function readMutationDescriptor(input: XrayInboundMutation) {
  if (input.operation !== 'inbound.create' && input.operation !== 'inbound.update') {
    return undefined;
  }

  if (input.metadata?.xrayGuardrailAutomatic === true) {
    return undefined;
  }

  if (!readBoolean(input.metadata, 'enabled', true)) {
    return undefined;
  }

  const protocol = readRuntimeProtocol(input.metadata);
  const agentId = readString(input.metadata, 'agentId', input.targetId);

  if (!protocol || agentId === '') {
    return undefined;
  }

  return {
    agentId,
    listenAddress: readString(input.metadata, 'listenAddress', '0.0.0.0'),
    listenPort: resolveListenPort(input.metadata, input.targetId),
    protocol
  };
}

export function findXrayInboundPortConflictDenial(
  input: XrayInboundMutation,
  options: {
    inbounds: XrayInbound[];
    tasks?: DeployTask[];
    nodes?: ManagedNode[];
  }
): XrayInboundPortConflictDenial | undefined {
  const descriptor = readMutationDescriptor(input);

  if (!descriptor) {
    return undefined;
  }

  const nodesById = new Map((options.nodes ?? []).map((node) => [node.id, node] as const));

  for (const inbound of options.inbounds) {
    const inboundProtocol = isXrayRuntimeProtocol(inbound.protocol) ? inbound.protocol : undefined;
    const inboundAgentId = resolveInboundAgentId(inbound, nodesById);

    if (
      inbound.id === input.targetId ||
      !inboundProtocol ||
      !inboundAgentId ||
      inboundAgentId !== descriptor.agentId ||
      inbound.listenPort !== descriptor.listenPort ||
      !addressesOverlap(inbound.listenAddress, descriptor.listenAddress) ||
      !ACTIVE_INBOUND_STATUSES.has(inbound.status) ||
      inboundProtocol === descriptor.protocol
    ) {
      continue;
    }

    return createDenial({
      agentId: descriptor.agentId,
      listenAddress: descriptor.listenAddress,
      listenPort: descriptor.listenPort,
      requestedProtocol: descriptor.protocol,
      conflictingProtocol: inboundProtocol,
      conflictingInboundId: inbound.id
    });
  }

  for (const task of options.tasks ?? []) {
    const taskDescriptor = readMutationDescriptor(task);

    if (
      task.targetId === input.targetId ||
      !taskDescriptor ||
      !IN_FLIGHT_TASK_STATUSES.has(task.status) ||
      taskDescriptor.agentId !== descriptor.agentId ||
      taskDescriptor.listenPort !== descriptor.listenPort ||
      !addressesOverlap(taskDescriptor.listenAddress, descriptor.listenAddress) ||
      taskDescriptor.protocol === descriptor.protocol
    ) {
      continue;
    }

    return createDenial({
      agentId: descriptor.agentId,
      listenAddress: descriptor.listenAddress,
      listenPort: descriptor.listenPort,
      requestedProtocol: descriptor.protocol,
      conflictingProtocol: taskDescriptor.protocol,
      conflictingTaskId: task.id
    });
  }

  return undefined;
}
