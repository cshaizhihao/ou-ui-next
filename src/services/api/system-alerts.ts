import type {
  Agent,
  AgentRuntimeServiceHealth,
  DeployTask,
  QuotaPolicy,
  SystemAlert,
  SystemAlertSeverity
} from '../../domain';
import { hasAgentRuntimeDeploymentProof } from '../../domain';
import type { CommandOutboxItem, CommandOutboxStatus } from './control-plane-api';
import type { SystemAlertNotificationDeliveryRecord } from './system-alert-notifications';

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

function readLastRuntimeSignalAt(agent: Agent) {
  return agent.lastHeartbeatAt || agent.telemetry.reportedAt;
}

function readOfflineAfterSeconds(agent: Agent) {
  return Math.max(readNumber(agent.probeConfig.pingIntervalSeconds, 30) * 10, 300);
}

function addSecondsToTimestamp(value: string | undefined, seconds: number) {
  const timestampMs = parseTimestampMs(value);
  return Number.isNaN(timestampMs) ? undefined : new Date(timestampMs + seconds * 1000).toISOString();
}

function createOfflineAlert(agent: Agent, now?: string): SystemAlert | undefined {
  if (agent.status !== 'offline') {
    return undefined;
  }

  const lastRuntimeSignalAt = readLastRuntimeSignalAt(agent);
  const offlineAfterSeconds = readOfflineAfterSeconds(agent);
  const offlineSinceAt = addSecondsToTimestamp(lastRuntimeSignalAt, offlineAfterSeconds);

  return {
    id: `alert-agent-offline-${agent.id}`,
    kind: 'agent.offline',
    severity: 'critical',
    status: 'active',
    title: 'Agent offline',
    message: `Agent ${agent.name} has not reported heartbeat or telemetry within the configured liveness window.`,
    resourceType: 'agent',
    resourceId: agent.id,
    resourceLabel: agent.name,
    observedAt: offlineSinceAt ?? now ?? lastRuntimeSignalAt ?? resolveObservedAt(agent),
    dedupeKey: `agent:${agent.id}:offline`,
    metadata: {
      agentStatus: agent.status,
      lastRuntimeSignalAt,
      lastTelemetryAt: agent.telemetry.reportedAt,
      lastHeartbeatAt: agent.lastHeartbeatAt,
      offlineAfterSeconds,
      offlineSinceAt,
      expectedSamplingIntervalSeconds: readNumber(
        agent.telemetry.expectedSamplingIntervalSeconds,
        agent.probeConfig.pingIntervalSeconds
      )
    }
  };
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

export function createSystemAlertsFromAgents(agents: Agent[], now?: string): SystemAlert[] {
  return agents.flatMap((agent) => {
    const offlineAlert = createOfflineAlert(agent, now);
    const samplingGapAlert = createSamplingGapAlert(agent);
    const highLatencyAlert = createHighLatencyAlert(agent);
    return [
      ...(offlineAlert ? [offlineAlert] : []),
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
    sampleStatus: sample?.status,
    sampleLastError: sample?.lastError
  };
}

function createDeadLetterReasonMetadata(items: CommandOutboxItem[]) {
  const reasonCounts = new Map<string, number>();

  for (const item of items) {
    const reason = item.lastError?.trim() || 'unknown';
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }

  const reasonEntries = [...reasonCounts.entries()].sort(([leftReason], [rightReason]) =>
    leftReason.localeCompare(rightReason)
  );

  return {
    deadLetterAckTimeoutCount: reasonCounts.get('command.ack.timeout') ?? 0,
    deadLetterResultTimeoutCount: reasonCounts.get('command.result.timeout') ?? 0,
    deadLetterUnknownReasonCount: reasonCounts.get('unknown') ?? 0,
    deadLetterOtherReasonCount: reasonEntries
      .filter(([reason]) => !['command.ack.timeout', 'command.result.timeout', 'unknown'].includes(reason))
      .reduce((total, [, count]) => total + count, 0),
    deadLetterReasonSummary: reasonEntries.map(([reason, count]) => `${reason}:${count}`).join(',')
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
      ...createDeadLetterReasonMetadata(deadLetters),
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

function latestTaskTimestamp(task: DeployTask) {
  return task.updatedAt || task.createdAt;
}

function compareTasksByLatestTimestampDesc(left: DeployTask, right: DeployTask) {
  return parseTimestampMs(latestTaskTimestamp(right)) - parseTimestampMs(latestTaskTimestamp(left));
}

function createRuntimeReloadFailedAlert(task: DeployTask, now: string): SystemAlert {
  const failedAt = latestTaskTimestamp(task) || now;

  return {
    id: `alert-runtime-reload-failed-${sanitizeAlertIdPart(task.targetId)}`,
    kind: 'runtime.reload_failed',
    severity: 'critical',
    status: 'active',
    title: 'Runtime reload failed',
    message: `Runtime reload for ${task.targetLabel} failed.`,
    resourceType: 'runtime_release',
    resourceId: task.targetId,
    resourceLabel: task.targetLabel,
    observedAt: failedAt,
    dedupeKey: `runtime_reload:${task.targetId}:failed`,
    metadata: {
      taskId: task.id,
      operation: task.operation,
      taskStatus: task.status,
      targetId: task.targetId,
      targetLabel: task.targetLabel,
      failedAt,
      failureReason: task.failureReason,
      requestId: task.requestId,
      actor: task.actor,
      attempts: task.attempts
    }
  };
}

function createRuntimeApplyHealthFailedAlert(
  task: DeployTask,
  rollbackTask: DeployTask | undefined,
  now: string
): SystemAlert {
  const failedAt = latestTaskTimestamp(task) || now;

  return {
    id: `alert-runtime-apply-health-failed-${sanitizeAlertIdPart(task.targetId)}`,
    kind: 'runtime.apply_health_failed',
    severity: 'critical',
    status: 'active',
    title: 'Runtime apply health failed',
    message: `Runtime apply for ${task.targetLabel} failed post-apply health checks and triggered rollback.`,
    resourceType: 'runtime_release',
    resourceId: task.targetId,
    resourceLabel: task.targetLabel,
    observedAt: failedAt,
    dedupeKey: `runtime_apply_health:${task.targetId}:failed`,
    metadata: {
      taskId: task.id,
      operation: task.operation,
      taskStatus: task.status,
      targetId: task.targetId,
      targetLabel: task.targetLabel,
      failedAt,
      failureReason: task.failureReason,
      rollbackTaskId: task.rollbackTaskId,
      rollbackTaskStatus: rollbackTask?.status,
      requestId: task.requestId,
      actor: task.actor,
      attempts: task.attempts
    }
  };
}

function isRuntimeApplyHealthFailureTask(task: DeployTask) {
  return task.status === 'failed' && Boolean(task.rollbackTaskId);
}

function isRuntimeRecoveryTask(task: DeployTask) {
  return task.status === 'succeeded' && hasAgentRuntimeDeploymentProof(task);
}

function createSystemAlertsFromRuntimeApplyHealthFailures(tasks: DeployTask[], now: string): SystemAlert[] {
  const tasksByTarget = new Map<string, DeployTask[]>();
  const tasksById = new Map(tasks.map((task) => [task.id, task]));

  for (const task of tasks) {
    if (isRuntimeApplyHealthFailureTask(task) || isRuntimeRecoveryTask(task)) {
      tasksByTarget.set(task.targetId, [...(tasksByTarget.get(task.targetId) ?? []), task]);
    }
  }

  return [...tasksByTarget.values()]
    .map((targetTasks) => {
      const failedTask = targetTasks
        .filter(isRuntimeApplyHealthFailureTask)
        .sort(compareTasksByLatestTimestampDesc)[0];

      if (!failedTask) {
        return undefined;
      }

      const latestRecovery = targetTasks
        .filter(isRuntimeRecoveryTask)
        .sort(compareTasksByLatestTimestampDesc)[0];
      const failedAtMs = parseTimestampMs(latestTaskTimestamp(failedTask));
      const recoveredAtMs = latestRecovery ? parseTimestampMs(latestTaskTimestamp(latestRecovery)) : Number.NaN;

      if (!Number.isNaN(recoveredAtMs) && !Number.isNaN(failedAtMs) && recoveredAtMs >= failedAtMs) {
        return undefined;
      }

      return createRuntimeApplyHealthFailedAlert(
        failedTask,
        failedTask.rollbackTaskId ? tasksById.get(failedTask.rollbackTaskId) : undefined,
        now
      );
    })
    .filter((alert): alert is SystemAlert => Boolean(alert));
}

function createSystemAlertsFromRuntimeReloadFailures(tasks: DeployTask[], now: string): SystemAlert[] {
  const reloadTasksByTarget = new Map<string, DeployTask[]>();

  for (const task of tasks) {
    if (task.operation !== 'runtime.reload') {
      continue;
    }

    reloadTasksByTarget.set(task.targetId, [...(reloadTasksByTarget.get(task.targetId) ?? []), task]);
  }

  return [...reloadTasksByTarget.values()]
    .map((reloadTasks) => {
      const failedTask = reloadTasks
        .filter((task) => task.status === 'failed')
        .sort(compareTasksByLatestTimestampDesc)[0];

      if (!failedTask) {
        return undefined;
      }

      const latestSuccess = reloadTasks
        .filter((task) => task.status === 'succeeded')
        .sort(compareTasksByLatestTimestampDesc)[0];
      const failedAtMs = parseTimestampMs(latestTaskTimestamp(failedTask));
      const succeededAtMs = latestSuccess ? parseTimestampMs(latestTaskTimestamp(latestSuccess)) : Number.NaN;

      if (!Number.isNaN(succeededAtMs) && !Number.isNaN(failedAtMs) && succeededAtMs >= failedAtMs) {
        return undefined;
      }

      return createRuntimeReloadFailedAlert(failedTask, now);
    })
    .filter((alert): alert is SystemAlert => Boolean(alert));
}

export function createSystemAlertsFromRuntimeTasks(tasks: DeployTask[], now: string): SystemAlert[] {
  return [
    ...createSystemAlertsFromRuntimeApplyHealthFailures(tasks, now),
    ...createSystemAlertsFromRuntimeReloadFailures(tasks, now)
  ];
}

export type AuditWriteFailureAlertInput = {
  writeFailures: number;
  firstFailureAt?: string;
  lastFailureAt?: string;
};

export function createSystemAlertsFromAuditWriteFailures(
  input: AuditWriteFailureAlertInput,
  now: string
): SystemAlert[] {
  const writeFailures = Math.max(0, Math.round(readNumber(input.writeFailures)));

  if (writeFailures === 0) {
    return [];
  }

  const observedAt = input.firstFailureAt ?? input.lastFailureAt ?? now;

  return [
    {
      id: 'alert-audit-write-failed',
      kind: 'audit.write_failed',
      severity: 'critical',
      status: 'active',
      title: 'Audit write failed',
      message: `${writeFailures} audit write failure${writeFailures === 1 ? '' : 's'} occurred in this control-plane process.`,
      resourceType: 'audit',
      resourceId: 'audit-ledger',
      resourceLabel: 'Audit ledger',
      observedAt,
      dedupeKey: 'audit:write_failed',
      metadata: {
        writeFailures,
        firstFailureAt: input.firstFailureAt,
        lastFailureAt: input.lastFailureAt
      }
    }
  ];
}

function isRetryableSystemAlertNotificationDelivery(delivery: SystemAlertNotificationDeliveryRecord) {
  return delivery.status === 'pending' || delivery.status === 'failed';
}

function latestDeliveryTimestamp(deliveries: SystemAlertNotificationDeliveryRecord[]) {
  return deliveries
    .map((delivery) => delivery.updatedAt || delivery.lastAttemptAt || delivery.createdAt)
    .sort((left, right) => parseTimestampMs(right) - parseTimestampMs(left))[0];
}

function oldestDeliveryCreatedAt(deliveries: SystemAlertNotificationDeliveryRecord[]) {
  return deliveries
    .map((delivery) => delivery.createdAt)
    .sort((left, right) => parseTimestampMs(left) - parseTimestampMs(right))[0];
}

function oldestDeliveryNextAttemptAt(deliveries: SystemAlertNotificationDeliveryRecord[]) {
  return deliveries
    .map((delivery) => delivery.nextAttemptAt)
    .sort((left, right) => parseTimestampMs(left) - parseTimestampMs(right))[0];
}

function sampleDeliveryMetadata(deliveries: SystemAlertNotificationDeliveryRecord[]) {
  const sample = [...deliveries].sort(
    (left, right) =>
      parseTimestampMs(left.nextAttemptAt) - parseTimestampMs(right.nextAttemptAt)
      || parseTimestampMs(left.createdAt) - parseTimestampMs(right.createdAt)
      || left.id.localeCompare(right.id)
  )[0];

  return {
    sampleDeliveryId: sample?.id,
    sampleDeliveryStatus: sample?.status,
    sampleAttemptCount: sample?.attemptCount,
    sampleMaxAttempts: sample?.maxAttempts,
    sampleLastAttemptAt: sample?.lastAttemptAt,
    sampleLastErrorMessage: sample?.lastErrorMessage
  };
}

function createSystemAlertNotificationOverdueAlert(
  deliveries: SystemAlertNotificationDeliveryRecord[],
  now: string
): SystemAlert | undefined {
  const nowMs = parseTimestampMs(now);

  if (Number.isNaN(nowMs)) {
    return undefined;
  }

  const overdue = deliveries.filter((delivery) => {
    const nextAttemptAtMs = parseTimestampMs(delivery.nextAttemptAt);
    return isRetryableSystemAlertNotificationDelivery(delivery)
      && !Number.isNaN(nextAttemptAtMs)
      && nextAttemptAtMs <= nowMs;
  });

  if (overdue.length === 0) {
    return undefined;
  }

  return {
    id: 'alert-system-alert-notification-overdue',
    kind: 'system_alert_notification.overdue',
    severity: 'warning',
    status: 'active',
    title: 'System alert notification overdue',
    message: 'System alert notification deliveries are overdue for retry.',
    resourceType: 'system_alert_notification',
    resourceId: 'system-alert-notifications',
    resourceLabel: 'System alert notifications',
    observedAt: oldestDeliveryNextAttemptAt(overdue) ?? now,
    dedupeKey: 'system_alert_notification:overdue',
    metadata: {
      overdueDeliveryCount: overdue.length,
      oldestCreatedAt: oldestDeliveryCreatedAt(overdue),
      oldestNextAttemptAt: oldestDeliveryNextAttemptAt(overdue),
      latestUpdatedAt: latestDeliveryTimestamp(overdue),
      ...sampleDeliveryMetadata(overdue)
    }
  };
}

function createSystemAlertNotificationDeadLetterAlert(
  deliveries: SystemAlertNotificationDeliveryRecord[],
  now: string
): SystemAlert | undefined {
  const deadLetters = deliveries.filter((delivery) => delivery.status === 'dead_letter');

  if (deadLetters.length === 0) {
    return undefined;
  }

  return {
    id: 'alert-system-alert-notification-dead-letter',
    kind: 'system_alert_notification.dead_letter',
    severity: 'critical',
    status: 'active',
    title: 'System alert notification dead letter',
    message: 'System alert notification deliveries are dead-lettered.',
    resourceType: 'system_alert_notification',
    resourceId: 'system-alert-notifications',
    resourceLabel: 'System alert notifications',
    observedAt: latestDeliveryTimestamp(deadLetters) ?? now,
    dedupeKey: 'system_alert_notification:dead_letter',
    metadata: {
      deadLetterDeliveryCount: deadLetters.length,
      oldestCreatedAt: oldestDeliveryCreatedAt(deadLetters),
      latestUpdatedAt: latestDeliveryTimestamp(deadLetters),
      ...sampleDeliveryMetadata(deadLetters)
    }
  };
}

export function createSystemAlertsFromSystemAlertNotifications(
  deliveries: SystemAlertNotificationDeliveryRecord[],
  now: string
): SystemAlert[] {
  const overdueAlert = createSystemAlertNotificationOverdueAlert(deliveries, now);
  const deadLetterAlert = createSystemAlertNotificationDeadLetterAlert(deliveries, now);

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
