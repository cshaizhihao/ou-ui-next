import type { Agent, AgentRuntimeServiceHealth, QuotaPolicy, SystemAlert, SystemAlertSeverity } from '../../domain';
import type { CommandOutboxItem, CommandOutboxStatus } from './control-plane-api';

function readNumber(value: number | undefined, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseTimestampMs(value: string | undefined) {
  if (!value) {
    return Number.NaN;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function resolveSamplingGapSeverity(agent: Agent): SystemAlertSeverity {
  const gapSeconds = readNumber(agent.telemetry.sampleGapSeconds);
  const expectedSeconds = readNumber(
    agent.telemetry.expectedSamplingIntervalSeconds,
    agent.probeConfig.pingIntervalSeconds
  );

  if (agent.status === 'offline' || gapSeconds >= Math.max(expectedSeconds * 10, 300)) {
    return 'critical';
  }

  return 'warning';
}

function resolveObservedAt(agent: Agent) {
  return agent.telemetry.reportedAt ?? agent.telemetry.samplingExpectedSince ?? agent.lastHeartbeatAt;
}

function createSamplingGapAlert(agent: Agent): SystemAlert | undefined {
  if (!agent.telemetry.sampleGapDetected) {
    return undefined;
  }

  const gapSeconds = readNumber(agent.telemetry.sampleGapSeconds);
  const expectedSeconds = readNumber(
    agent.telemetry.expectedSamplingIntervalSeconds,
    agent.probeConfig.pingIntervalSeconds
  );

  return {
    id: `alert-agent-telemetry-sampling-gap-${agent.id}`,
    kind: 'agent.telemetry_sampling_gap',
    severity: resolveSamplingGapSeverity(agent),
    status: 'active',
    title: 'Agent telemetry sampling gap',
    message: `Agent ${agent.name} has not produced telemetry on the expected sampling cadence.`,
    resourceType: 'agent',
    resourceId: agent.id,
    resourceLabel: agent.name,
    observedAt: resolveObservedAt(agent),
    dedupeKey: `agent:${agent.id}:telemetry_sampling_gap`,
    metadata: {
      agentStatus: agent.status,
      sampleGapSeconds: gapSeconds,
      expectedSamplingIntervalSeconds: expectedSeconds,
      sampleGapReason: agent.telemetry.sampleGapReason,
      lastTelemetryAt: agent.telemetry.reportedAt,
      lastHeartbeatAt: agent.lastHeartbeatAt
    }
  };
}

function resolveRuntimeServiceSeverity(service: AgentRuntimeServiceHealth): SystemAlertSeverity {
  return service.status === 'failed' || service.status === 'missing' ? 'critical' : 'warning';
}

function sanitizeAlertIdPart(value: string) {
  return value.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'runtime-service';
}

function createRuntimeServiceAlerts(agent: Agent): SystemAlert[] {
  return (agent.telemetry.runtimeServices ?? [])
    .filter((service) => service.required && service.status !== 'active')
    .map((service) => ({
      id: `alert-agent-runtime-service-${agent.id}-${sanitizeAlertIdPart(service.name)}`,
      kind: 'agent.runtime_service_unhealthy',
      severity: resolveRuntimeServiceSeverity(service),
      status: 'active',
      title: 'Agent runtime service unhealthy',
      message: `Agent ${agent.name} reports required runtime service ${service.name} is ${service.status}.`,
      resourceType: 'agent',
      resourceId: agent.id,
      resourceLabel: agent.name,
      observedAt: service.checkedAt || resolveObservedAt(agent),
      dedupeKey: `agent:${agent.id}:runtime_service:${service.name}`,
      metadata: {
        agentStatus: agent.status,
        serviceName: service.name,
        serviceModuleKind: service.moduleKind,
        serviceStatus: service.status,
        serviceEnabled: service.enabled,
        serviceRequired: service.required,
        serviceCheckedAt: service.checkedAt,
        serviceDetail: service.detail,
        lastTelemetryAt: agent.telemetry.reportedAt,
        lastHeartbeatAt: agent.lastHeartbeatAt
      }
    }));
}

function readLatencyThresholds(agent: Agent) {
  const greenMax = readNumber(agent.probeConfig.latencyGreenMaxMs, 100);
  const yellowMax = Math.max(readNumber(agent.probeConfig.latencyYellowMaxMs, 200), greenMax);

  return { greenMax, yellowMax };
}

function createHighLatencyAlert(agent: Agent): SystemAlert | undefined {
  const latencyMs = readNumber(agent.telemetry.latencyMs);
  const { greenMax, yellowMax } = readLatencyThresholds(agent);

  if (latencyMs <= yellowMax) {
    return undefined;
  }

  return {
    id: `alert-agent-high-latency-${agent.id}`,
    kind: 'agent.high_latency',
    severity: 'critical',
    status: 'active',
    title: 'Agent high latency',
    message: `Agent ${agent.name} reports latency above the configured red threshold.`,
    resourceType: 'agent',
    resourceId: agent.id,
    resourceLabel: agent.name,
    observedAt: resolveObservedAt(agent),
    dedupeKey: `agent:${agent.id}:high_latency`,
    metadata: {
      agentStatus: agent.status,
      latencyMs,
      latencyStatus: 'red',
      latencyGreenMaxMs: greenMax,
      latencyYellowMaxMs: yellowMax,
      lastTelemetryAt: agent.telemetry.reportedAt,
      lastHeartbeatAt: agent.lastHeartbeatAt
    }
  };
}

export function createSystemAlertsFromAgents(agents: Agent[]): SystemAlert[] {
  return agents.flatMap((agent) => {
    const samplingGapAlert = createSamplingGapAlert(agent);
    const highLatencyAlert = createHighLatencyAlert(agent);
    return [
      ...(samplingGapAlert ? [samplingGapAlert] : []),
      ...(highLatencyAlert ? [highLatencyAlert] : []),
      ...createRuntimeServiceAlerts(agent)
    ];
  });
}

const activeCommandStatuses = new Set<CommandOutboxStatus>(['pending', 'dispatched', 'acknowledged']);

function latestTimestamp(items: CommandOutboxItem[]) {
  return items
    .map((item) => item.updatedAt || item.createdAt)
    .sort((left, right) => parseTimestampMs(right) - parseTimestampMs(left))[0];
}

function oldestTimestamp(items: CommandOutboxItem[]) {
  return items
    .map((item) => item.createdAt)
    .sort((left, right) => parseTimestampMs(left) - parseTimestampMs(right))[0];
}

function sampleCommandMetadata(items: CommandOutboxItem[]) {
  const sample = [...items].sort(
    (left, right) => parseTimestampMs(left.deadlineAt) - parseTimestampMs(right.deadlineAt)
  )[0];

  return {
    sampleCommandId: sample?.commandId,
    sampleTaskId: sample?.taskId,
    sampleAgentId: sample?.agentId,
    sampleStatus: sample?.status
  };
}

function createCommandOutboxOverdueAlert(commandOutbox: CommandOutboxItem[], now: string): SystemAlert | undefined {
  const nowMs = parseTimestampMs(now);

  if (Number.isNaN(nowMs)) {
    return undefined;
  }

  const overdue = commandOutbox.filter((item) => {
    const deadlineMs = parseTimestampMs(item.deadlineAt);
    return activeCommandStatuses.has(item.status) && !Number.isNaN(deadlineMs) && deadlineMs < nowMs;
  });

  if (overdue.length === 0) {
    return undefined;
  }

  return {
    id: 'alert-command-outbox-overdue',
    kind: 'command_outbox.overdue',
    severity: 'warning',
    status: 'active',
    title: 'Command outbox overdue',
    message: `${overdue.length} active command outbox item${overdue.length === 1 ? '' : 's'} are past deadline.`,
    resourceType: 'command_outbox',
    resourceId: 'command-outbox',
    resourceLabel: 'Command outbox',
    observedAt: oldestTimestamp(overdue) ?? now,
    dedupeKey: 'command_outbox:overdue',
    metadata: {
      overdueCount: overdue.length,
      oldestCreatedAt: oldestTimestamp(overdue),
      latestUpdatedAt: latestTimestamp(overdue),
      ...sampleCommandMetadata(overdue)
    }
  };
}

function createCommandOutboxDeadLetterAlert(commandOutbox: CommandOutboxItem[], now: string): SystemAlert | undefined {
  const deadLetters = commandOutbox.filter((item) => item.status === 'dead_letter');

  if (deadLetters.length === 0) {
    return undefined;
  }

  return {
    id: 'alert-command-outbox-dead-letter',
    kind: 'command_outbox.dead_letter',
    severity: 'critical',
    status: 'active',
    title: 'Command outbox dead letter',
    message: `${deadLetters.length} command outbox item${deadLetters.length === 1 ? '' : 's'} are dead-lettered.`,
    resourceType: 'command_outbox',
    resourceId: 'command-outbox',
    resourceLabel: 'Command outbox',
    observedAt: latestTimestamp(deadLetters) ?? now,
    dedupeKey: 'command_outbox:dead_letter',
    metadata: {
      deadLetterCount: deadLetters.length,
      oldestCreatedAt: oldestTimestamp(deadLetters),
      latestUpdatedAt: latestTimestamp(deadLetters),
      ...sampleCommandMetadata(deadLetters)
    }
  };
}

export function createSystemAlertsFromCommandOutbox(
  commandOutbox: CommandOutboxItem[],
  now: string
): SystemAlert[] {
  const overdueAlert = createCommandOutboxOverdueAlert(commandOutbox, now);
  const deadLetterAlert = createCommandOutboxDeadLetterAlert(commandOutbox, now);

  return [
    ...(overdueAlert ? [overdueAlert] : []),
    ...(deadLetterAlert ? [deadLetterAlert] : [])
  ];
}

function createQuotaExceededAlert(policy: QuotaPolicy, now: string): SystemAlert | undefined {
  if (policy.enforcementState !== 'exceeded' && policy.enforcementState !== 'disabled_by_quota') {
    return undefined;
  }

  const limitBytes = readNumber(policy.limitBytes);
  const usedBytes = readNumber(policy.usedBytes);
  const usageRatioPercent = limitBytes > 0 ? Math.round(Math.min(usedBytes / limitBytes, 1) * 10_000) / 100 : 0;

  return {
    id: `alert-quota-exceeded-${sanitizeAlertIdPart(policy.id)}`,
    kind: 'quota.exceeded',
    severity: policy.enforcementState === 'disabled_by_quota' ? 'critical' : 'warning',
    status: 'active',
    title: 'Quota exceeded',
    message: `Quota policy ${policy.name} is ${policy.enforcementState}.`,
    resourceType: 'quota_policy',
    resourceId: policy.id,
    resourceLabel: policy.name,
    observedAt: policy.reportedAt ?? now,
    dedupeKey: `quota_policy:${policy.id}:exceeded`,
    metadata: {
      quotaPolicyId: policy.id,
      quotaScope: policy.scope,
      quotaResourceId: policy.resourceId,
      quotaDetail: policy.detail,
      enforcementState: policy.enforcementState,
      limitBytes,
      usedBytes,
      usageRatioPercent,
      billingDirection: policy.billingDirection,
      resetWindow: policy.resetWindow,
      resetDay: policy.resetDay,
      runtimeDisabledByPolicy: policy.runtimeDisabledByPolicy,
      guardrailReason: policy.guardrailReason,
      quotaReportedAt: policy.reportedAt,
      sourceCount: policy.sourceCount
    }
  };
}

export function createSystemAlertsFromQuotaPolicies(policies: QuotaPolicy[], now: string): SystemAlert[] {
  return policies
    .map((policy) => createQuotaExceededAlert(policy, now))
    .filter((alert): alert is SystemAlert => Boolean(alert));
}
