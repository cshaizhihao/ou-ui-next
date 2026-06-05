import type { ObservabilityLatencySummary, ObservabilityMetrics } from './control-plane-api';

function sanitizeDescription(value: string) {
  return value.replace(/\n/g, ' ');
}

function escapeLabelValue(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function metricLine(name: string, value: number, labels: Record<string, string> = {}) {
  const labelEntries = Object.entries(labels);
  const suffix =
    labelEntries.length === 0
      ? ''
      : `{${labelEntries.map(([key, item]) => `${key}="${escapeLabelValue(item)}"`).join(',')}}`;
  return `${name}${suffix} ${Number.isFinite(value) ? value : 0}`;
}

function metricHelp(name: string, description: string) {
  return [`# HELP ${name} ${sanitizeDescription(description)}`, `# TYPE ${name} gauge`];
}

function latencyMetrics(prefix: string, summary: ObservabilityLatencySummary, description: string) {
  return [
    ...metricHelp(`${prefix}_count`, `${description} sample count.`),
    metricLine(`${prefix}_count`, summary.count),
    ...metricHelp(`${prefix}_p50_ms`, `${description} p50 latency in milliseconds.`),
    metricLine(`${prefix}_p50_ms`, summary.p50Ms),
    ...metricHelp(`${prefix}_p95_ms`, `${description} p95 latency in milliseconds.`),
    metricLine(`${prefix}_p95_ms`, summary.p95Ms),
    ...metricHelp(`${prefix}_max_ms`, `${description} max latency in milliseconds.`),
    metricLine(`${prefix}_max_ms`, summary.maxMs)
  ];
}

function recordMetrics(prefix: string, values: Record<string, number>, labelName: string, description: string) {
  return [
    ...metricHelp(prefix, description),
    ...Object.entries(values).map(([labelValue, value]) => metricLine(prefix, value, { [labelName]: labelValue }))
  ];
}

export function renderPrometheusMetrics(metrics: ObservabilityMetrics) {
  const generatedAtSeconds = Date.parse(metrics.generatedAt);
  const lines = [
    ...metricHelp('ou_ui_metrics_generated_timestamp_seconds', 'Unix timestamp for this OU-UI Next metrics snapshot.'),
    metricLine(
      'ou_ui_metrics_generated_timestamp_seconds',
      Number.isNaN(generatedAtSeconds) ? 0 : Math.floor(generatedAtSeconds / 1000)
    ),
    ...metricHelp('ou_ui_tasks_total', 'Total number of deploy tasks.'),
    metricLine('ou_ui_tasks_total', metrics.tasks.total),
    ...metricHelp('ou_ui_tasks_active', 'Number of active deploy tasks.'),
    metricLine('ou_ui_tasks_active', metrics.tasks.active),
    ...metricHelp('ou_ui_tasks_failed', 'Number of failed deploy tasks.'),
    metricLine('ou_ui_tasks_failed', metrics.tasks.failed),
    ...metricHelp('ou_ui_tasks_rollbacks', 'Number of rollback-related deploy tasks.'),
    metricLine('ou_ui_tasks_rollbacks', metrics.tasks.rollbacks),
    ...recordMetrics('ou_ui_tasks_by_status', metrics.tasks.byStatus, 'status', 'Deploy tasks grouped by status.'),
    ...latencyMetrics(
      'ou_ui_task_completion_latency',
      metrics.tasks.completionLatencyMs,
      'Deploy task completion latency'
    ),
    ...metricHelp('ou_ui_command_outbox_total', 'Total number of command outbox entries.'),
    metricLine('ou_ui_command_outbox_total', metrics.commandOutbox.total),
    ...metricHelp('ou_ui_command_outbox_backlog', 'Number of active command outbox entries.'),
    metricLine('ou_ui_command_outbox_backlog', metrics.commandOutbox.backlog),
    ...metricHelp('ou_ui_command_outbox_active_leases', 'Number of active command leases.'),
    metricLine('ou_ui_command_outbox_active_leases', metrics.commandOutbox.activeLeases),
    ...metricHelp('ou_ui_command_outbox_overdue', 'Number of active commands past deadline.'),
    metricLine('ou_ui_command_outbox_overdue', metrics.commandOutbox.overdue),
    ...metricHelp('ou_ui_command_outbox_dead_letters', 'Number of dead-letter command outbox entries.'),
    metricLine('ou_ui_command_outbox_dead_letters', metrics.commandOutbox.deadLetters),
    ...recordMetrics(
      'ou_ui_command_outbox_by_status',
      metrics.commandOutbox.byStatus,
      'status',
      'Command outbox entries grouped by status.'
    ),
    ...latencyMetrics(
      'ou_ui_command_ack_latency',
      metrics.commandOutbox.ackLatencyMs,
      'Command ACK latency'
    ),
    ...latencyMetrics(
      'ou_ui_command_result_latency',
      metrics.commandOutbox.resultLatencyMs,
      'Command result latency'
    ),
    ...metricHelp('ou_ui_agents_total', 'Total number of Agent hosts.'),
    metricLine('ou_ui_agents_total', metrics.agents.total),
    ...metricHelp('ou_ui_agents_offline', 'Number of offline Agent hosts.'),
    metricLine('ou_ui_agents_offline', metrics.agents.offline),
    ...metricHelp('ou_ui_agents_degraded', 'Number of degraded Agent hosts.'),
    metricLine('ou_ui_agents_degraded', metrics.agents.degraded),
    ...recordMetrics('ou_ui_agents_by_status', metrics.agents.byStatus, 'status', 'Agent hosts grouped by status.'),
    ...metricHelp('ou_ui_system_alerts_total', 'Total number of active system alerts.'),
    metricLine('ou_ui_system_alerts_total', metrics.systemAlerts.total),
    ...metricHelp('ou_ui_system_alerts_warning', 'Number of active warning system alerts.'),
    metricLine('ou_ui_system_alerts_warning', metrics.systemAlerts.warning),
    ...metricHelp('ou_ui_system_alerts_critical', 'Number of active critical system alerts.'),
    metricLine('ou_ui_system_alerts_critical', metrics.systemAlerts.critical),
    ...recordMetrics(
      'ou_ui_system_alerts_by_severity',
      metrics.systemAlerts.bySeverity,
      'severity',
      'Active system alerts grouped by severity.'
    ),
    ...recordMetrics(
      'ou_ui_system_alerts_by_kind',
      metrics.systemAlerts.byKind,
      'kind',
      'Active system alerts grouped by alert kind.'
    ),
    ...metricHelp('ou_ui_system_alert_notifications_total', 'Total number of retained system alert notification deliveries.'),
    metricLine('ou_ui_system_alert_notifications_total', metrics.systemAlertNotifications.total),
    ...metricHelp('ou_ui_system_alert_notifications_pending', 'Number of pending system alert notification deliveries.'),
    metricLine('ou_ui_system_alert_notifications_pending', metrics.systemAlertNotifications.pending),
    ...metricHelp('ou_ui_system_alert_notifications_failed', 'Number of retryable failed system alert notification deliveries.'),
    metricLine('ou_ui_system_alert_notifications_failed', metrics.systemAlertNotifications.failed),
    ...metricHelp('ou_ui_system_alert_notifications_delivered', 'Number of delivered system alert notification deliveries.'),
    metricLine('ou_ui_system_alert_notifications_delivered', metrics.systemAlertNotifications.delivered),
    ...metricHelp('ou_ui_system_alert_notifications_dead_letters', 'Number of dead-letter system alert notification deliveries.'),
    metricLine('ou_ui_system_alert_notifications_dead_letters', metrics.systemAlertNotifications.deadLetters),
    ...metricHelp('ou_ui_system_alert_notifications_overdue', 'Number of due system alert notification deliveries.'),
    metricLine('ou_ui_system_alert_notifications_overdue', metrics.systemAlertNotifications.overdue),
    ...recordMetrics(
      'ou_ui_system_alert_notifications_by_status',
      metrics.systemAlertNotifications.byStatus,
      'status',
      'System alert notification deliveries grouped by status.'
    ),
    ...metricHelp('ou_ui_audit_chain_valid', 'Whether the audit hash chain is currently valid.'),
    metricLine('ou_ui_audit_chain_valid', metrics.audit.valid ? 1 : 0),
    ...metricHelp('ou_ui_audit_chain_checked', 'Number of audit records checked during chain verification.'),
    metricLine('ou_ui_audit_chain_checked', metrics.audit.checked),
    ...metricHelp('ou_ui_audit_denied_total', 'Number of denied audit records.'),
    metricLine('ou_ui_audit_denied_total', metrics.audit.denied),
    ...metricHelp('ou_ui_audit_quota_exceeded_total', 'Number of quota-exceeded denied audit records.'),
    metricLine('ou_ui_audit_quota_exceeded_total', metrics.audit.quotaExceeded)
  ];

  return `${lines.join('\n')}\n`;
}
