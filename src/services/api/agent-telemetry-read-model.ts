import type { Agent, AgentRuntimeServiceHealth } from '../../domain';
import { isSampleInMonthlyBillingPeriod, resolveMonthlyBillingPeriod } from '../../domain/billing-period';
import type { AgentEventEnvelope } from './api-contract';

function createAgentFromEvent(event: AgentEventEnvelope): Agent {
  const now = event.observedAt;
  const reportedAt = event.type === 'telemetry_sample' ? readTelemetrySampleAt(event) : undefined;

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
      runtimeServices: [],
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
      reportedAt,
      samplingExpectedSince: now
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

function mergeBoolean(current: boolean | undefined, next: unknown) {
  return typeof next === 'boolean' ? next : current;
}

const runtimeServiceStatuses = new Set(['active', 'inactive', 'failed', 'missing', 'unknown']);
const runtimeServiceModuleKinds = new Set(['agent', 'host-agent', 'xray', 'gost', 'hysteria2', 'port-forwarding', 'bbr']);

function readRuntimeServiceHealth(value: unknown): AgentRuntimeServiceHealth | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const name = mergeString(undefined, record.name);
  const checkedAt = mergeString(undefined, record.checkedAt);
  const moduleKind = mergeString(undefined, record.moduleKind);
  const status = mergeString(undefined, record.status);

  if (!name || !checkedAt || !moduleKind || !status) {
    return undefined;
  }

  if (!runtimeServiceModuleKinds.has(moduleKind) || !runtimeServiceStatuses.has(status)) {
    return undefined;
  }

  return {
    name,
    moduleKind: moduleKind as AgentRuntimeServiceHealth['moduleKind'],
    status: status as AgentRuntimeServiceHealth['status'],
    enabled: mergeBoolean(undefined, record.enabled),
    required: record.required === true,
    checkedAt,
    detail: mergeString(undefined, record.detail)
  };
}

function mergeRuntimeServices(
  current: AgentRuntimeServiceHealth[] | undefined,
  next: unknown
): AgentRuntimeServiceHealth[] | undefined {
  if (!Array.isArray(next)) {
    return current;
  }

  const services = next
    .map((item) => readRuntimeServiceHealth(item))
    .filter((item): item is AgentRuntimeServiceHealth => Boolean(item));

  return services.length > 0 ? services : current;
}

function mergeAccountingMode(
  current: Agent['trafficPolicy']['accountingMode'],
  next: unknown
): Agent['trafficPolicy']['accountingMode'] {
  return next === 'both' || next === 'single' || next === 'ingress' || next === 'egress' ? next : current;
}

function mergeLatencyStatus(current: Agent['telemetry']['latencyStatus'], next: unknown) {
  return next === 'green' || next === 'yellow' || next === 'red' ? next : current;
}

function classifyLatencyStatus(latencyMs: number | undefined, probeConfig: Agent['probeConfig']) {
  if (typeof latencyMs !== 'number' || !Number.isFinite(latencyMs) || latencyMs < 1) {
    return undefined;
  }

  const greenMax = probeConfig.latencyGreenMaxMs;
  const yellowMax = Math.max(probeConfig.latencyYellowMaxMs, greenMax);

  if (latencyMs <= greenMax) {
    return 'green' as const;
  }

  if (latencyMs <= yellowMax) {
    return 'yellow' as const;
  }

  return 'red' as const;
}

function mergeResetDay(current: number, next: unknown) {
  return typeof next === 'number' && Number.isInteger(next) ? Math.max(1, Math.min(31, next)) : current;
}

function deriveMonthlyTrafficUsedBytes(
  accountingMode: Agent['trafficPolicy']['accountingMode'],
  monthlyIngressBytes: number | undefined,
  monthlyEgressBytes: number | undefined,
  fallback: number,
  manualUsedTrafficBytes = 0
) {
  const ingressBytes = Number.isFinite(monthlyIngressBytes) ? monthlyIngressBytes ?? 0 : undefined;
  const egressBytes = Number.isFinite(monthlyEgressBytes) ? monthlyEgressBytes ?? 0 : undefined;
  const manualBytes = Number.isFinite(manualUsedTrafficBytes) ? Math.max(manualUsedTrafficBytes, 0) : 0;

  if (ingressBytes === undefined && egressBytes === undefined) {
    return Math.max(fallback, manualBytes);
  }

  let meteredBytes: number;

  switch (accountingMode) {
    case 'single':
      meteredBytes = Math.max(ingressBytes ?? 0, egressBytes ?? 0);
      break;
    case 'ingress':
      meteredBytes = ingressBytes ?? 0;
      break;
    case 'egress':
      meteredBytes = egressBytes ?? 0;
      break;
    case 'both':
    default:
      meteredBytes = (ingressBytes ?? 0) + (egressBytes ?? 0);
      break;
  }

  return manualBytes + meteredBytes;
}

function readProbeIntervalMs(agent: Agent) {
  const intervalSeconds = agent.probeConfig.pingIntervalSeconds;
  return Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds * 1000 : 30_000;
}

function readProbeIntervalSeconds(agent: Agent) {
  return readProbeIntervalMs(agent) / 1000;
}

function readLastAgentRuntimeSignalAt(agent: Agent) {
  return agent.lastHeartbeatAt || agent.telemetry.reportedAt;
}

function readTelemetrySampleAt(event: AgentEventEnvelope) {
  if (event.type !== 'telemetry_sample') {
    return event.observedAt;
  }

  return mergeString(undefined, event.payload.reportedAt) ?? event.observedAt;
}

function deriveAgentMonthlyTrafficPeriod(agent: Agent, nowIso: string) {
  const currentPeriod = resolveMonthlyBillingPeriod(agent.trafficPolicy.monthlyResetDay, nowIso);

  if (!currentPeriod) {
    return undefined;
  }

  if (agent.telemetry.trafficBillingPeriod) {
    return agent.telemetry.trafficBillingPeriod === currentPeriod.key ? currentPeriod : undefined;
  }

  const reportedAt = agent.telemetry.reportedAt;
  return reportedAt
    && resolveMonthlyBillingPeriod(agent.trafficPolicy.monthlyResetDay, reportedAt)?.key === currentPeriod.key
    ? currentPeriod
    : undefined;
}

function applyAgentMonthlyTrafficWindow(agent: Agent, nowIso: string): Agent {
  const currentPeriod = resolveMonthlyBillingPeriod(agent.trafficPolicy.monthlyResetDay, nowIso);

  if (!currentPeriod) {
    return agent;
  }

  const activePeriod = deriveAgentMonthlyTrafficPeriod(agent, nowIso);
  if (activePeriod) {
    return {
      ...agent,
      telemetry: {
        ...agent.telemetry,
        trafficBillingPeriod: activePeriod.key
      }
    };
  }

  const monthlyLimitBytes = agent.telemetry.monthlyTrafficLimitBytes ?? agent.monthlyTrafficLimitBytes ?? 0;
  const quotaExceeded = monthlyLimitBytes > 0 && agent.trafficPolicy.manualUsedTrafficBytes >= monthlyLimitBytes;
  const hostExpired = agent.telemetry.hostExpired ?? false;

  return {
    ...agent,
    telemetry: {
      ...agent.telemetry,
      monthlyIngressBytes: 0,
      monthlyEgressBytes: 0,
      monthlyTrafficUsedBytes: agent.trafficPolicy.manualUsedTrafficBytes,
      quotaExceeded,
      runtimeDisabledByPolicy: quotaExceeded || hostExpired,
      guardrailReason: quotaExceeded ? 'monthly_traffic_quota_exceeded' : hostExpired ? agent.telemetry.guardrailReason : 'ok',
      trafficBillingPeriod: currentPeriod.key
    }
  };
}

export function deriveAgentLivenessStatus(agent: Agent, nowIso: string): Agent['status'] {
  if (agent.status === 'provisioning') {
    return agent.status;
  }

  const lastSignalAt = readLastAgentRuntimeSignalAt(agent);
  if (!lastSignalAt) {
    return agent.status;
  }

  const lastSignalMs = Date.parse(lastSignalAt);
  const nowMs = Date.parse(nowIso);

  if (Number.isNaN(lastSignalMs) || Number.isNaN(nowMs)) {
    return agent.status;
  }

  const ageMs = Math.max(nowMs - lastSignalMs, 0);
  const intervalMs = readProbeIntervalMs(agent);
  const degradedAfterMs = Math.max(intervalMs * 3, 90_000);
  const offlineAfterMs = Math.max(intervalMs * 10, 300_000);

  if (ageMs >= offlineAfterMs) {
    return 'offline';
  }

  if (ageMs >= degradedAfterMs) {
    return 'degraded';
  }

  return 'online';
}

export function deriveAgentTelemetrySampleGap(agent: Agent, nowIso: string): Pick<
  Agent['telemetry'],
  'sampleGapDetected' | 'sampleGapSeconds' | 'expectedSamplingIntervalSeconds' | 'sampleGapReason'
> {
  const intervalMs = readProbeIntervalMs(agent);
  const expectedSamplingIntervalSeconds = readProbeIntervalSeconds(agent);
  const gapThresholdMs = Math.max(intervalMs * 3, 90_000);
  const nowMs = Date.parse(nowIso);

  if (Number.isNaN(nowMs) || agent.status === 'provisioning') {
    return {
      sampleGapDetected: false,
      sampleGapSeconds: 0,
      expectedSamplingIntervalSeconds
    };
  }

  if (!agent.telemetry.reportedAt) {
    const expectedSinceAt = agent.telemetry.samplingExpectedSince ?? readLastAgentRuntimeSignalAt(agent);
    const expectedSinceMs = expectedSinceAt ? Date.parse(expectedSinceAt) : Number.NaN;

    if (Number.isNaN(expectedSinceMs)) {
      return {
        sampleGapDetected: false,
        sampleGapSeconds: 0,
        expectedSamplingIntervalSeconds
      };
    }

    const expectedAgeMs = Math.max(nowMs - expectedSinceMs, 0);
    const sampleGapDetected = expectedAgeMs >= gapThresholdMs;

    return {
      sampleGapDetected,
      sampleGapSeconds: sampleGapDetected ? Math.floor(expectedAgeMs / 1000) : 0,
      expectedSamplingIntervalSeconds,
      sampleGapReason: sampleGapDetected ? 'no_telemetry_sample' : undefined
    };
  }

  const sampleMs = Date.parse(agent.telemetry.reportedAt);

  if (Number.isNaN(sampleMs)) {
    return {
      sampleGapDetected: true,
      sampleGapSeconds: 0,
      expectedSamplingIntervalSeconds,
      sampleGapReason: 'invalid_telemetry_timestamp'
    };
  }

  const sampleAgeMs = Math.max(nowMs - sampleMs, 0);
  const sampleGapDetected = sampleAgeMs >= gapThresholdMs;

  return {
    sampleGapDetected,
    sampleGapSeconds: sampleGapDetected ? Math.floor(sampleAgeMs / 1000) : 0,
    expectedSamplingIntervalSeconds,
    sampleGapReason: sampleGapDetected ? 'stale_telemetry_sample' : undefined
  };
}

export function applyAgentMonthlyTrafficWindowToReadModel(agents: Agent[], nowIso: string): Agent[] {
  return agents.map((agent) => applyAgentMonthlyTrafficWindow(agent, nowIso));
}

export function applyAgentLivenessToReadModel(agents: Agent[], nowIso: string): Agent[] {
  return agents.map((agent) => {
    const windowedAgent = applyAgentMonthlyTrafficWindow(agent, nowIso);
    const status = deriveAgentLivenessStatus(windowedAgent, nowIso);
    const statusedAgent = {
      ...windowedAgent,
      status
    };

    return {
      ...statusedAgent,
      telemetry: {
        ...statusedAgent.telemetry,
        ...deriveAgentTelemetrySampleGap(statusedAgent, nowIso)
      }
    };
  });
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
      const telemetry = {
        ...agent.telemetry,
        uptimeSeconds: mergeNumber(agent.telemetry.uptimeSeconds, event.payload.uptimeSeconds),
        samplingExpectedSince: agent.telemetry.samplingExpectedSince ?? event.observedAt
      };
      const heartbeatAgent = {
        ...agent,
        status: 'online' as const,
        version: event.payload.version ?? agent.version,
        capabilities: nextCapabilities ?? agent.capabilities,
        lastHeartbeatAt: event.observedAt,
        telemetry
      };

      return {
        ...heartbeatAgent,
        telemetry: {
          ...telemetry,
          ...deriveAgentTelemetrySampleGap(heartbeatAgent, event.observedAt)
        }
      };
    }

    const windowedAgent = applyAgentMonthlyTrafficWindow(agent, event.observedAt);
    const nextAccountingMode = mergeAccountingMode(
      windowedAgent.trafficPolicy.accountingMode,
      event.payload.trafficAccountingMode
    );
    const nextMonthlyResetDay = mergeResetDay(windowedAgent.trafficPolicy.monthlyResetDay, event.payload.monthlyResetDay);
    const sampleAt = readTelemetrySampleAt(event);
    const currentPeriod = resolveMonthlyBillingPeriod(nextMonthlyResetDay, event.observedAt);
    const acceptsMonthlyTraffic = isSampleInMonthlyBillingPeriod({
      resetDay: nextMonthlyResetDay,
      sampledAt: sampleAt,
      currentAt: event.observedAt,
      trafficBillingPeriod: event.payload.trafficBillingPeriod
    });
    const nextMonthlyIngressBytes = acceptsMonthlyTraffic
      ? mergeNumber(windowedAgent.telemetry.monthlyIngressBytes, event.payload.monthlyIngressBytes)
      : windowedAgent.telemetry.monthlyIngressBytes;
    const nextMonthlyEgressBytes = acceptsMonthlyTraffic
      ? mergeNumber(windowedAgent.telemetry.monthlyEgressBytes, event.payload.monthlyEgressBytes)
      : windowedAgent.telemetry.monthlyEgressBytes;
    const nextManualUsedTrafficBytes =
      mergeNumber(windowedAgent.trafficPolicy.manualUsedTrafficBytes, event.payload.manualUsedTrafficBytes)
      ?? windowedAgent.trafficPolicy.manualUsedTrafficBytes;
    const nextLatencyMs = mergeNumber(agent.telemetry.latencyMs, event.payload.latencyMs) ?? agent.telemetry.latencyMs;
    const nextLatencyStatus =
      mergeLatencyStatus(agent.telemetry.latencyStatus, event.payload.latencyStatus)
      ?? classifyLatencyStatus(nextLatencyMs, agent.probeConfig);

    return {
      ...windowedAgent,
      status: 'online' as const,
      lastHeartbeatAt: event.observedAt,
      trafficPolicy: {
        ...windowedAgent.trafficPolicy,
        accountingMode: nextAccountingMode,
        monthlyResetDay: nextMonthlyResetDay,
        manualUsedTrafficBytes: nextManualUsedTrafficBytes,
        telemetrySource: (event.payload.trafficTelemetrySource ?? windowedAgent.trafficPolicy.telemetrySource) as 'agent'
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
        ...windowedAgent.telemetry,
        cpuPercent: mergeNumber(windowedAgent.telemetry.cpuPercent, event.payload.cpuPercent) ?? windowedAgent.telemetry.cpuPercent,
        cpuCores: mergeNumber(windowedAgent.telemetry.cpuCores, event.payload.cpuCores),
        loadAverage1m: mergeNumber(windowedAgent.telemetry.loadAverage1m, event.payload.loadAverage1m),
        loadAverage5m: mergeNumber(windowedAgent.telemetry.loadAverage5m, event.payload.loadAverage5m),
        loadAverage15m: mergeNumber(windowedAgent.telemetry.loadAverage15m, event.payload.loadAverage15m),
        memoryPercent:
          mergeNumber(windowedAgent.telemetry.memoryPercent, event.payload.memoryPercent) ?? windowedAgent.telemetry.memoryPercent,
        memoryUsedBytes:
          mergeNumber(windowedAgent.telemetry.memoryUsedBytes, event.payload.memoryUsedBytes) ?? windowedAgent.telemetry.memoryUsedBytes,
        memoryTotalBytes:
          mergeNumber(windowedAgent.telemetry.memoryTotalBytes, event.payload.memoryTotalBytes) ?? windowedAgent.telemetry.memoryTotalBytes,
        diskPercent: mergeNumber(windowedAgent.telemetry.diskPercent, event.payload.diskPercent),
        diskUsedBytes:
          mergeNumber(windowedAgent.telemetry.diskUsedBytes, event.payload.diskUsedBytes) ?? windowedAgent.telemetry.diskUsedBytes,
        diskTotalBytes:
          mergeNumber(windowedAgent.telemetry.diskTotalBytes, event.payload.diskTotalBytes) ?? windowedAgent.telemetry.diskTotalBytes,
        txBytes: mergeNumber(windowedAgent.telemetry.txBytes, event.payload.txBytes) ?? windowedAgent.telemetry.txBytes,
        rxBytes: mergeNumber(windowedAgent.telemetry.rxBytes, event.payload.rxBytes) ?? windowedAgent.telemetry.rxBytes,
        monthlyEgressBytes: nextMonthlyEgressBytes,
        monthlyIngressBytes: nextMonthlyIngressBytes,
        monthlyTrafficLimitBytes: mergeNumber(windowedAgent.telemetry.monthlyTrafficLimitBytes, event.payload.monthlyTrafficLimitBytes),
        quotaExceeded: mergeBoolean(windowedAgent.telemetry.quotaExceeded, event.payload.quotaExceeded),
        hostExpired: mergeBoolean(windowedAgent.telemetry.hostExpired, event.payload.hostExpired),
        runtimeDisabledByPolicy: mergeBoolean(windowedAgent.telemetry.runtimeDisabledByPolicy, event.payload.runtimeDisabledByPolicy),
        guardrailReason: mergeString(windowedAgent.telemetry.guardrailReason, event.payload.guardrailReason),
        uploadSpeedBps:
          mergeNumber(windowedAgent.telemetry.uploadSpeedBps, event.payload.uploadSpeedBps) ?? windowedAgent.telemetry.uploadSpeedBps,
        downloadSpeedBps:
          mergeNumber(windowedAgent.telemetry.downloadSpeedBps, event.payload.downloadSpeedBps) ?? windowedAgent.telemetry.downloadSpeedBps,
        uploadTotalBytes:
          mergeNumber(windowedAgent.telemetry.uploadTotalBytes, event.payload.uploadTotalBytes) ?? windowedAgent.telemetry.uploadTotalBytes,
        downloadTotalBytes:
          mergeNumber(windowedAgent.telemetry.downloadTotalBytes, event.payload.downloadTotalBytes)
          ?? windowedAgent.telemetry.downloadTotalBytes,
        monthlyTrafficUsedBytes:
          acceptsMonthlyTraffic && typeof event.payload.monthlyTrafficUsedBytes === 'number'
            ? event.payload.monthlyTrafficUsedBytes
            : deriveMonthlyTrafficUsedBytes(
                nextAccountingMode,
                nextMonthlyIngressBytes,
                nextMonthlyEgressBytes,
                windowedAgent.telemetry.monthlyTrafficUsedBytes,
                nextManualUsedTrafficBytes
              ),
        trafficBillingPeriod: acceptsMonthlyTraffic
          ? mergeString(currentPeriod?.key, event.payload.trafficBillingPeriod) ?? currentPeriod?.key
          : windowedAgent.telemetry.trafficBillingPeriod,
        latencyMs: nextLatencyMs,
        latencyStatus: nextLatencyStatus,
        latencySamplesMs:
          mergeNumberArray(windowedAgent.telemetry.latencySamplesMs, event.payload.latencySamplesMs)
          ?? windowedAgent.telemetry.latencySamplesMs,
        packetLossPercent:
          mergeNumber(windowedAgent.telemetry.packetLossPercent, event.payload.packetLossPercent)
          ?? windowedAgent.telemetry.packetLossPercent,
        packetLossSamplesPercent:
          mergeNumberArray(windowedAgent.telemetry.packetLossSamplesPercent, event.payload.packetLossSamplesPercent)
          ?? windowedAgent.telemetry.packetLossSamplesPercent,
        onlineDays: mergeNumber(windowedAgent.telemetry.onlineDays, event.payload.onlineDays) ?? windowedAgent.telemetry.onlineDays,
        uptimeSeconds: mergeNumber(windowedAgent.telemetry.uptimeSeconds, event.payload.uptimeSeconds),
        runtimeServices: mergeRuntimeServices(windowedAgent.telemetry.runtimeServices, event.payload.runtimeServices),
        reportedAt: sampleAt,
        samplingExpectedSince: windowedAgent.telemetry.samplingExpectedSince ?? sampleAt,
        sampleGapDetected: false,
        sampleGapSeconds: 0,
        expectedSamplingIntervalSeconds: readProbeIntervalSeconds(windowedAgent),
        sampleGapReason: undefined
      }
    };
  });
}
