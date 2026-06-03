import type { Agent } from '../../domain';
import type { AgentEventEnvelope } from './api-contract';

function createAgentFromEvent(event: AgentEventEnvelope): Agent {
  const now = event.observedAt;

  return {
    id: event.agentId,
    name: event.agentId,
    status: event.type === 'heartbeat' || event.type === 'telemetry_sample' ? 'online' : 'provisioning',
    region: 'custom',
    publicAddress: 'pending',
    connectionMode: 'pull',
    version: event.type === 'heartbeat' ? event.payload.version ?? 'unknown' : 'unknown',
    platform: 'linux/unknown',
    capabilities: event.type === 'heartbeat'
      ? event.payload.capabilities?.filter((capability): capability is Agent['capabilities'][number] => capability !== 'system') ?? ['host-agent']
      : ['host-agent'],
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
    lastHeartbeatAt: now,
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
      reportedAt: now
    }
  };
}

function mergeNumber(current: number | undefined, next: unknown) {
  return typeof next === 'number' && Number.isFinite(next) ? next : current;
}

function mergeNumberArray(current: number[] | undefined, next: unknown) {
  return Array.isArray(next) && next.every((value) => typeof value === 'number' && Number.isFinite(value))
    ? next
    : current;
}

function mergeString(current: string | undefined, next: unknown) {
  return typeof next === 'string' && next.trim() !== '' ? next.trim() : current;
}

function mergeAccountingMode(
  current: Agent['trafficPolicy']['accountingMode'],
  next: unknown
): Agent['trafficPolicy']['accountingMode'] {
  return next === 'both' || next === 'single' || next === 'ingress' || next === 'egress' ? next : current;
}

function mergeResetDay(current: number, next: unknown) {
  return typeof next === 'number' && Number.isInteger(next) ? Math.max(1, Math.min(28, next)) : current;
}

function deriveMonthlyTrafficUsedBytes(
  accountingMode: Agent['trafficPolicy']['accountingMode'],
  monthlyIngressBytes: number | undefined,
  monthlyEgressBytes: number | undefined,
  fallback: number
) {
  const ingressBytes = Number.isFinite(monthlyIngressBytes) ? monthlyIngressBytes ?? 0 : undefined;
  const egressBytes = Number.isFinite(monthlyEgressBytes) ? monthlyEgressBytes ?? 0 : undefined;

  if (ingressBytes === undefined && egressBytes === undefined) {
    return fallback;
  }

  switch (accountingMode) {
    case 'single':
      return Math.max(ingressBytes ?? 0, egressBytes ?? 0);
    case 'ingress':
      return ingressBytes ?? fallback;
    case 'egress':
      return egressBytes ?? fallback;
    case 'both':
    default:
      return (ingressBytes ?? 0) + (egressBytes ?? 0);
  }
}

export function applyAgentEventToReadModel(agents: Agent[], event: AgentEventEnvelope): Agent[] {
  if (event.type !== 'heartbeat' && event.type !== 'telemetry_sample') {
    return agents;
  }

  const nextAgents = agents.some((agent) => agent.id === event.agentId) ? agents : [createAgentFromEvent(event), ...agents];

  return nextAgents.map((agent) => {
    if (agent.id !== event.agentId) {
      return agent;
    }

    if (event.type === 'heartbeat') {
      const nextCapabilities = event.payload.capabilities?.filter(
        (capability): capability is Agent['capabilities'][number] => capability !== 'system'
      );

      return {
        ...agent,
        status: 'online' as const,
        version: event.payload.version ?? agent.version,
        capabilities: nextCapabilities ?? agent.capabilities,
        lastHeartbeatAt: event.observedAt,
        telemetry: {
          ...agent.telemetry,
          uptimeSeconds: mergeNumber(agent.telemetry.uptimeSeconds, event.payload.uptimeSeconds),
          reportedAt: event.observedAt
        }
      };
    }

    return {
      ...agent,
      status: 'online' as const,
      lastHeartbeatAt: event.observedAt,
      trafficPolicy: {
        ...agent.trafficPolicy,
        accountingMode: mergeAccountingMode(agent.trafficPolicy.accountingMode, event.payload.trafficAccountingMode),
        monthlyResetDay: mergeResetDay(agent.trafficPolicy.monthlyResetDay, event.payload.monthlyResetDay),
        manualUsedTrafficBytes:
          mergeNumber(agent.trafficPolicy.manualUsedTrafficBytes, event.payload.manualUsedTrafficBytes)
          ?? agent.trafficPolicy.manualUsedTrafficBytes,
        telemetrySource: (event.payload.trafficTelemetrySource ?? agent.trafficPolicy.telemetrySource) as 'agent'
      },
      hardware: {
        ...agent.hardware,
        cpuModel: mergeString(agent.hardware.cpuModel, event.payload.cpuModel),
        kernelVersion: mergeString(agent.hardware.kernelVersion, event.payload.kernelVersion),
        virtualization: mergeString(agent.hardware.virtualization, event.payload.virtualization),
        primaryNetworkInterface: mergeString(agent.hardware.primaryNetworkInterface, event.payload.primaryNetworkInterface),
        detectedAt:
          mergeString(agent.hardware.detectedAt, event.payload.hardwareDetectedAt)
          ?? mergeString(agent.hardware.detectedAt, event.payload.reportedAt)
          ?? event.observedAt
      },
      telemetry: {
        ...agent.telemetry,
        cpuPercent: mergeNumber(agent.telemetry.cpuPercent, event.payload.cpuPercent) ?? agent.telemetry.cpuPercent,
        cpuCores: mergeNumber(agent.telemetry.cpuCores, event.payload.cpuCores),
        memoryPercent:
          mergeNumber(agent.telemetry.memoryPercent, event.payload.memoryPercent) ?? agent.telemetry.memoryPercent,
        memoryUsedBytes:
          mergeNumber(agent.telemetry.memoryUsedBytes, event.payload.memoryUsedBytes) ?? agent.telemetry.memoryUsedBytes,
        memoryTotalBytes:
          mergeNumber(agent.telemetry.memoryTotalBytes, event.payload.memoryTotalBytes) ?? agent.telemetry.memoryTotalBytes,
        diskPercent: mergeNumber(agent.telemetry.diskPercent, event.payload.diskPercent),
        diskUsedBytes:
          mergeNumber(agent.telemetry.diskUsedBytes, event.payload.diskUsedBytes) ?? agent.telemetry.diskUsedBytes,
        diskTotalBytes:
          mergeNumber(agent.telemetry.diskTotalBytes, event.payload.diskTotalBytes) ?? agent.telemetry.diskTotalBytes,
        txBytes: mergeNumber(agent.telemetry.txBytes, event.payload.txBytes) ?? agent.telemetry.txBytes,
        rxBytes: mergeNumber(agent.telemetry.rxBytes, event.payload.rxBytes) ?? agent.telemetry.rxBytes,
        monthlyEgressBytes: mergeNumber(agent.telemetry.monthlyEgressBytes, event.payload.monthlyEgressBytes),
        monthlyIngressBytes: mergeNumber(agent.telemetry.monthlyIngressBytes, event.payload.monthlyIngressBytes),
        uploadSpeedBps:
          mergeNumber(agent.telemetry.uploadSpeedBps, event.payload.uploadSpeedBps) ?? agent.telemetry.uploadSpeedBps,
        downloadSpeedBps:
          mergeNumber(agent.telemetry.downloadSpeedBps, event.payload.downloadSpeedBps) ?? agent.telemetry.downloadSpeedBps,
        uploadTotalBytes:
          mergeNumber(agent.telemetry.uploadTotalBytes, event.payload.uploadTotalBytes) ?? agent.telemetry.uploadTotalBytes,
        downloadTotalBytes:
          mergeNumber(agent.telemetry.downloadTotalBytes, event.payload.downloadTotalBytes)
          ?? agent.telemetry.downloadTotalBytes,
        monthlyTrafficUsedBytes:
          typeof event.payload.monthlyTrafficUsedBytes === 'number'
            ? event.payload.monthlyTrafficUsedBytes
            : deriveMonthlyTrafficUsedBytes(
                agent.trafficPolicy.accountingMode,
                mergeNumber(agent.telemetry.monthlyIngressBytes, event.payload.monthlyIngressBytes),
                mergeNumber(agent.telemetry.monthlyEgressBytes, event.payload.monthlyEgressBytes),
                agent.telemetry.monthlyTrafficUsedBytes
              ),
        latencyMs: mergeNumber(agent.telemetry.latencyMs, event.payload.latencyMs) ?? agent.telemetry.latencyMs,
        latencySamplesMs:
          mergeNumberArray(agent.telemetry.latencySamplesMs, event.payload.latencySamplesMs) ?? agent.telemetry.latencySamplesMs,
        packetLossPercent:
          mergeNumber(agent.telemetry.packetLossPercent, event.payload.packetLossPercent)
          ?? agent.telemetry.packetLossPercent,
        packetLossSamplesPercent:
          mergeNumberArray(agent.telemetry.packetLossSamplesPercent, event.payload.packetLossSamplesPercent)
          ?? agent.telemetry.packetLossSamplesPercent,
        onlineDays: mergeNumber(agent.telemetry.onlineDays, event.payload.onlineDays) ?? agent.telemetry.onlineDays,
        uptimeSeconds: mergeNumber(agent.telemetry.uptimeSeconds, event.payload.uptimeSeconds),
        reportedAt: mergeString(agent.telemetry.reportedAt, event.payload.reportedAt) ?? event.observedAt
      }
    };
  });
}
