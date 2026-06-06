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

function metricMetadata(name: string, description: string, type: 'gauge' | 'histogram') {
  return [`# HELP ${name} ${sanitizeDescription(description)}`, `# TYPE ${name} ${type}`];
}

function histogramObservationLines(
  name: string,
  summary: ObservabilityLatencySummary,
  labels: Record<string, string> = {}
) {
  return [
    ...summary.buckets.map((bucket) =>
      metricLine(`${name}_bucket`, bucket.count, { ...labels, le: String(bucket.leMs) })
    ),
    metricLine(`${name}_bucket`, summary.count, { ...labels, le: '+Inf' }),
    metricLine(`${name}_sum`, summary.sumMs, labels),
    metricLine(`${name}_count`, summary.count, labels)
  ];
}

function latencyHistogramMetrics(
  prefix: string,
  summary: ObservabilityLatencySummary,
  description: string
) {
  const name = `${prefix}_ms`;

  return [
    ...metricMetadata(name, `${description} histogram in milliseconds.`, 'histogram'),
    ...histogramObservationLines(name, summary)
  ];
}

function labeledLatencyHistogramMetrics(
  prefix: string,
  summaries: Record<string, ObservabilityLatencySummary>,
  labelName: string,
  description: string
) {
  const name = `${prefix}_ms`;

  return [
    ...metricMetadata(name, `${description} histogram in milliseconds.`, 'histogram'),
    ...Object.entries(summaries).flatMap(([labelValue, summary]) =>
      histogramObservationLines(name, summary, { [labelName]: labelValue })
    )
  ];
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
    metricLine(`${prefix}_max_ms`, summary.maxMs),
    ...latencyHistogramMetrics(prefix, summary, description)
  ];
}

function labeledLatencyMetrics(
  prefix: string,
  summaries: Record<string, ObservabilityLatencySummary>,
  labelName: string,
  description: string
) {
  return [
    ...metricHelp(`${prefix}_count`, `${description} sample count.`),
    ...Object.entries(summaries).map(([labelValue, summary]) =>
      metricLine(`${prefix}_count`, summary.count, { [labelName]: labelValue })
    ),
    ...metricHelp(`${prefix}_p50_ms`, `${description} p50 latency in milliseconds.`),
    ...Object.entries(summaries).map(([labelValue, summary]) =>
      metricLine(`${prefix}_p50_ms`, summary.p50Ms, { [labelName]: labelValue })
    ),
    ...metricHelp(`${prefix}_p95_ms`, `${description} p95 latency in milliseconds.`),
    ...Object.entries(summaries).map(([labelValue, summary]) =>
      metricLine(`${prefix}_p95_ms`, summary.p95Ms, { [labelName]: labelValue })
    ),
    ...metricHelp(`${prefix}_max_ms`, `${description} max latency in milliseconds.`),
    ...Object.entries(summaries).map(([labelValue, summary]) =>
      metricLine(`${prefix}_max_ms`, summary.maxMs, { [labelName]: labelValue })
    ),
    ...labeledLatencyHistogramMetrics(prefix, summaries, labelName, description)
  ];
}

function recordMetrics(prefix: string, values: Record<string, number>, labelName: string, description: string) {
  return [
    ...metricHelp(prefix, description),
    ...Object.entries(values).map(([labelValue, value]) => metricLine(prefix, value, { [labelName]: labelValue }))
  ];
}

function timestampSeconds(value: string | null) {
  if (!value) {
    return 0;
  }

  const timestampMs = Date.parse(value);
  return Number.isNaN(timestampMs) ? 0 : Math.floor(timestampMs / 1000);
}

function quotaScopeValues(
  metrics: ObservabilityMetrics['quotaPolicies'],
  readValue: (summary: ObservabilityMetrics['quotaPolicies']['byScope'][keyof ObservabilityMetrics['quotaPolicies']['byScope']]) => number
) {
  return Object.fromEntries(Object.entries(metrics.byScope).map(([scope, summary]) => [scope, readValue(summary)]));
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
    ...labeledLatencyMetrics(
      'ou_ui_task_completion_latency_by_operation',
      metrics.tasks.completionLatencyByOperation,
      'operation',
      'Deploy task completion latency grouped by operation'
    ),
    ...labeledLatencyMetrics(
      'ou_ui_runtime_apply_latency_by_module',
      metrics.tasks.runtimeApplyLatencyByModule,
      'module',
      'Runtime apply task completion latency grouped by module'
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
    ...metricHelp('ou_ui_quota_policies_total', 'Total number of quota policies.'),
    metricLine('ou_ui_quota_policies_total', metrics.quotaPolicies.total),
    ...metricHelp('ou_ui_quota_policies_exceeded', 'Number of quota policies in exceeded state.'),
    metricLine('ou_ui_quota_policies_exceeded', metrics.quotaPolicies.exceeded),
    ...metricHelp('ou_ui_quota_policies_disabled', 'Number of quota policies disabled by quota.'),
    metricLine('ou_ui_quota_policies_disabled', metrics.quotaPolicies.disabled),
    ...metricHelp('ou_ui_quota_policies_reset_pending', 'Number of quota policies pending reset.'),
    metricLine('ou_ui_quota_policies_reset_pending', metrics.quotaPolicies.resetPending),
    ...metricHelp('ou_ui_quota_policies_limit_bytes_total', 'Total quota limit bytes across quota policies.'),
    metricLine('ou_ui_quota_policies_limit_bytes_total', metrics.quotaPolicies.limitBytesTotal),
    ...metricHelp('ou_ui_quota_policies_used_bytes_total', 'Total used bytes across quota policies.'),
    metricLine('ou_ui_quota_policies_used_bytes_total', metrics.quotaPolicies.usedBytesTotal),
    ...recordMetrics(
      'ou_ui_quota_policies_by_scope',
      quotaScopeValues(metrics.quotaPolicies, (summary) => summary.total),
      'scope',
      'Quota policies grouped by scope.'
    ),
    ...recordMetrics(
      'ou_ui_quota_policies_exceeded_by_scope',
      quotaScopeValues(metrics.quotaPolicies, (summary) => summary.exceeded),
      'scope',
      'Exceeded quota policies grouped by scope.'
    ),
    ...recordMetrics(
      'ou_ui_quota_policies_disabled_by_scope',
      quotaScopeValues(metrics.quotaPolicies, (summary) => summary.disabled),
      'scope',
      'Quota-disabled policies grouped by scope.'
    ),
    ...recordMetrics(
      'ou_ui_quota_policies_reset_pending_by_scope',
      quotaScopeValues(metrics.quotaPolicies, (summary) => summary.resetPending),
      'scope',
      'Reset-pending quota policies grouped by scope.'
    ),
    ...recordMetrics(
      'ou_ui_quota_policies_limit_bytes_by_scope',
      quotaScopeValues(metrics.quotaPolicies, (summary) => summary.limitBytesTotal),
      'scope',
      'Quota limit bytes grouped by scope.'
    ),
    ...recordMetrics(
      'ou_ui_quota_policies_used_bytes_by_scope',
      quotaScopeValues(metrics.quotaPolicies, (summary) => summary.usedBytesTotal),
      'scope',
      'Quota used bytes grouped by scope.'
    ),
    ...recordMetrics(
      'ou_ui_quota_policies_by_enforcement_state',
      metrics.quotaPolicies.byEnforcementState,
      'state',
      'Quota policies grouped by enforcement state.'
    ),
    ...metricHelp('ou_ui_agent_log_chunks_retained_total', 'Number of retained Agent runtime log chunks.'),
    metricLine('ou_ui_agent_log_chunks_retained_total', metrics.agentLogs.retained),
    ...metricHelp(
      'ou_ui_agent_log_chunks_retained_by_stream',
      'Retained Agent runtime log chunks grouped by stream.'
    ),
    ...Object.entries(metrics.agentLogs.byStream).map(([stream, summary]) =>
      metricLine('ou_ui_agent_log_chunks_retained_by_stream', summary.retained, { stream })
    ),
    ...metricHelp(
      'ou_ui_agent_log_chunks_content_bytes_total',
      'Total content bytes across retained Agent runtime log chunks.'
    ),
    metricLine('ou_ui_agent_log_chunks_content_bytes_total', metrics.agentLogs.contentBytes),
    ...metricHelp(
      'ou_ui_agent_log_chunks_content_bytes_by_stream',
      'Total content bytes across retained Agent runtime log chunks grouped by stream.'
    ),
    ...Object.entries(metrics.agentLogs.byStream).map(([stream, summary]) =>
      metricLine('ou_ui_agent_log_chunks_content_bytes_by_stream', summary.contentBytes, { stream })
    ),
    ...metricHelp(
      'ou_ui_agent_log_chunks_earliest_observed_timestamp_seconds',
      'Unix timestamp for the earliest retained Agent runtime log chunk.'
    ),
    metricLine(
      'ou_ui_agent_log_chunks_earliest_observed_timestamp_seconds',
      timestampSeconds(metrics.agentLogs.earliestObservedAt)
    ),
    ...metricHelp(
      'ou_ui_agent_log_chunks_latest_observed_timestamp_seconds',
      'Unix timestamp for the latest retained Agent runtime log chunk.'
    ),
    metricLine(
      'ou_ui_agent_log_chunks_latest_observed_timestamp_seconds',
      timestampSeconds(metrics.agentLogs.latestObservedAt)
    ),
    ...metricHelp(
      'ou_ui_agent_log_chunks_earliest_observed_timestamp_seconds_by_stream',
      'Unix timestamp for the earliest retained Agent runtime log chunk grouped by stream.'
    ),
    ...Object.entries(metrics.agentLogs.byStream).map(([stream, summary]) =>
      metricLine(
        'ou_ui_agent_log_chunks_earliest_observed_timestamp_seconds_by_stream',
        timestampSeconds(summary.earliestObservedAt),
        { stream }
      )
    ),
    ...metricHelp(
      'ou_ui_agent_log_chunks_latest_observed_timestamp_seconds_by_stream',
      'Unix timestamp for the latest retained Agent runtime log chunk grouped by stream.'
    ),
    ...Object.entries(metrics.agentLogs.byStream).map(([stream, summary]) =>
      metricLine(
        'ou_ui_agent_log_chunks_latest_observed_timestamp_seconds_by_stream',
        timestampSeconds(summary.latestObservedAt),
        { stream }
      )
    ),
    ...metricHelp('ou_ui_agent_log_archives_buckets_total', 'Number of Agent log archive summary buckets.'),
    metricLine('ou_ui_agent_log_archives_buckets_total', metrics.agentLogArchives.buckets),
    ...metricHelp(
      'ou_ui_agent_log_archives_buckets_by_stream',
      'Agent log archive summary buckets grouped by stream.'
    ),
    ...Object.entries(metrics.agentLogArchives.byStream).map(([stream, summary]) =>
      metricLine('ou_ui_agent_log_archives_buckets_by_stream', summary.buckets, { stream })
    ),
    ...metricHelp(
      'ou_ui_agent_log_archives_chunks_total',
      'Number of pruned Agent log chunks represented by archive summaries.'
    ),
    metricLine('ou_ui_agent_log_archives_chunks_total', metrics.agentLogArchives.chunks),
    ...metricHelp(
      'ou_ui_agent_log_archives_chunks_by_stream',
      'Pruned Agent log chunks represented by archive summaries grouped by stream.'
    ),
    ...Object.entries(metrics.agentLogArchives.byStream).map(([stream, summary]) =>
      metricLine('ou_ui_agent_log_archives_chunks_by_stream', summary.chunks, { stream })
    ),
    ...metricHelp(
      'ou_ui_agent_log_archives_content_bytes_total',
      'Total pruned Agent log content bytes represented by archive summaries.'
    ),
    metricLine('ou_ui_agent_log_archives_content_bytes_total', metrics.agentLogArchives.contentBytes),
    ...metricHelp(
      'ou_ui_agent_log_archives_content_bytes_by_stream',
      'Pruned Agent log content bytes represented by archive summaries grouped by stream.'
    ),
    ...Object.entries(metrics.agentLogArchives.byStream).map(([stream, summary]) =>
      metricLine('ou_ui_agent_log_archives_content_bytes_by_stream', summary.contentBytes, { stream })
    ),
    ...metricHelp(
      'ou_ui_agent_log_archives_earliest_bucket_timestamp_seconds',
      'Unix timestamp for the earliest Agent log archive summary bucket.'
    ),
    metricLine(
      'ou_ui_agent_log_archives_earliest_bucket_timestamp_seconds',
      timestampSeconds(metrics.agentLogArchives.earliestBucketStartAt)
    ),
    ...metricHelp(
      'ou_ui_agent_log_archives_latest_bucket_timestamp_seconds',
      'Unix timestamp for the latest Agent log archive summary bucket.'
    ),
    metricLine(
      'ou_ui_agent_log_archives_latest_bucket_timestamp_seconds',
      timestampSeconds(metrics.agentLogArchives.latestBucketStartAt)
    ),
    ...metricHelp(
      'ou_ui_agent_log_archives_earliest_bucket_timestamp_seconds_by_stream',
      'Unix timestamp for the earliest Agent log archive summary bucket grouped by stream.'
    ),
    ...Object.entries(metrics.agentLogArchives.byStream).map(([stream, summary]) =>
      metricLine(
        'ou_ui_agent_log_archives_earliest_bucket_timestamp_seconds_by_stream',
        timestampSeconds(summary.earliestBucketStartAt),
        { stream }
      )
    ),
    ...metricHelp(
      'ou_ui_agent_log_archives_latest_bucket_timestamp_seconds_by_stream',
      'Unix timestamp for the latest Agent log archive summary bucket grouped by stream.'
    ),
    ...Object.entries(metrics.agentLogArchives.byStream).map(([stream, summary]) =>
      metricLine(
        'ou_ui_agent_log_archives_latest_bucket_timestamp_seconds_by_stream',
        timestampSeconds(summary.latestBucketStartAt),
        { stream }
      )
    ),
    ...metricHelp('ou_ui_traffic_rollups_retained_total', 'Number of retained traffic rollup records.'),
    metricLine('ou_ui_traffic_rollups_retained_total', metrics.trafficRollups.retained),
    ...metricHelp(
      'ou_ui_traffic_rollups_retained_by_dimension',
      'Retained traffic rollup records grouped by dimension.'
    ),
    ...Object.entries(metrics.trafficRollups.byDimension).map(([dimension, summary]) =>
      metricLine('ou_ui_traffic_rollups_retained_by_dimension', summary.retained, { dimension })
    ),
    ...metricHelp('ou_ui_traffic_rollups_metered_bytes_total', 'Total metered bytes across retained traffic rollups.'),
    metricLine('ou_ui_traffic_rollups_metered_bytes_total', metrics.trafficRollups.meteredBytesTotal),
    ...metricHelp(
      'ou_ui_traffic_rollups_metered_bytes_by_dimension',
      'Total metered bytes across retained traffic rollups grouped by dimension.'
    ),
    ...Object.entries(metrics.trafficRollups.byDimension).map(([dimension, summary]) =>
      metricLine('ou_ui_traffic_rollups_metered_bytes_by_dimension', summary.meteredBytesTotal, { dimension })
    ),
    ...metricHelp(
      'ou_ui_traffic_rollups_earliest_sample_timestamp_seconds',
      'Unix timestamp for the earliest retained traffic rollup sample.'
    ),
    metricLine(
      'ou_ui_traffic_rollups_earliest_sample_timestamp_seconds',
      timestampSeconds(metrics.trafficRollups.earliestSampledAt)
    ),
    ...metricHelp(
      'ou_ui_traffic_rollups_latest_sample_timestamp_seconds',
      'Unix timestamp for the latest retained traffic rollup sample.'
    ),
    metricLine(
      'ou_ui_traffic_rollups_latest_sample_timestamp_seconds',
      timestampSeconds(metrics.trafficRollups.latestSampledAt)
    ),
    ...metricHelp(
      'ou_ui_traffic_rollups_earliest_sample_timestamp_seconds_by_dimension',
      'Unix timestamp for the earliest retained traffic rollup sample grouped by dimension.'
    ),
    ...Object.entries(metrics.trafficRollups.byDimension).map(([dimension, summary]) =>
      metricLine(
        'ou_ui_traffic_rollups_earliest_sample_timestamp_seconds_by_dimension',
        timestampSeconds(summary.earliestSampledAt),
        { dimension }
      )
    ),
    ...metricHelp(
      'ou_ui_traffic_rollups_latest_sample_timestamp_seconds_by_dimension',
      'Unix timestamp for the latest retained traffic rollup sample grouped by dimension.'
    ),
    ...Object.entries(metrics.trafficRollups.byDimension).map(([dimension, summary]) =>
      metricLine(
        'ou_ui_traffic_rollups_latest_sample_timestamp_seconds_by_dimension',
        timestampSeconds(summary.latestSampledAt),
        { dimension }
      )
    ),
    ...metricHelp('ou_ui_traffic_rollup_compactions_buckets_total', 'Number of compacted traffic archive buckets.'),
    metricLine('ou_ui_traffic_rollup_compactions_buckets_total', metrics.trafficRollupCompactions.buckets),
    ...metricHelp(
      'ou_ui_traffic_rollup_compactions_buckets_by_dimension',
      'Compacted traffic archive buckets grouped by dimension.'
    ),
    ...Object.entries(metrics.trafficRollupCompactions.byDimension).map(([dimension, summary]) =>
      metricLine('ou_ui_traffic_rollup_compactions_buckets_by_dimension', summary.buckets, { dimension })
    ),
    ...metricHelp(
      'ou_ui_traffic_rollup_compactions_samples_total',
      'Number of raw traffic rollup samples represented by compacted archive buckets.'
    ),
    metricLine('ou_ui_traffic_rollup_compactions_samples_total', metrics.trafficRollupCompactions.samples),
    ...metricHelp(
      'ou_ui_traffic_rollup_compactions_samples_by_dimension',
      'Raw traffic rollup samples represented by compacted archive buckets grouped by dimension.'
    ),
    ...Object.entries(metrics.trafficRollupCompactions.byDimension).map(([dimension, summary]) =>
      metricLine('ou_ui_traffic_rollup_compactions_samples_by_dimension', summary.samples, { dimension })
    ),
    ...metricHelp(
      'ou_ui_traffic_rollup_compactions_metered_bytes_total',
      'Total metered bytes represented by compacted traffic archive buckets.'
    ),
    metricLine(
      'ou_ui_traffic_rollup_compactions_metered_bytes_total',
      metrics.trafficRollupCompactions.meteredBytesTotal
    ),
    ...metricHelp(
      'ou_ui_traffic_rollup_compactions_metered_bytes_by_dimension',
      'Total metered bytes represented by compacted traffic archive buckets grouped by dimension.'
    ),
    ...Object.entries(metrics.trafficRollupCompactions.byDimension).map(([dimension, summary]) =>
      metricLine('ou_ui_traffic_rollup_compactions_metered_bytes_by_dimension', summary.meteredBytesTotal, {
        dimension
      })
    ),
    ...metricHelp(
      'ou_ui_traffic_rollup_compactions_earliest_bucket_timestamp_seconds',
      'Unix timestamp for the earliest compacted traffic archive bucket.'
    ),
    metricLine(
      'ou_ui_traffic_rollup_compactions_earliest_bucket_timestamp_seconds',
      timestampSeconds(metrics.trafficRollupCompactions.earliestBucketStartAt)
    ),
    ...metricHelp(
      'ou_ui_traffic_rollup_compactions_latest_bucket_timestamp_seconds',
      'Unix timestamp for the latest compacted traffic archive bucket.'
    ),
    metricLine(
      'ou_ui_traffic_rollup_compactions_latest_bucket_timestamp_seconds',
      timestampSeconds(metrics.trafficRollupCompactions.latestBucketStartAt)
    ),
    ...metricHelp(
      'ou_ui_traffic_rollup_compactions_earliest_bucket_timestamp_seconds_by_dimension',
      'Unix timestamp for the earliest compacted traffic archive bucket grouped by dimension.'
    ),
    ...Object.entries(metrics.trafficRollupCompactions.byDimension).map(([dimension, summary]) =>
      metricLine(
        'ou_ui_traffic_rollup_compactions_earliest_bucket_timestamp_seconds_by_dimension',
        timestampSeconds(summary.earliestBucketStartAt),
        { dimension }
      )
    ),
    ...metricHelp(
      'ou_ui_traffic_rollup_compactions_latest_bucket_timestamp_seconds_by_dimension',
      'Unix timestamp for the latest compacted traffic archive bucket grouped by dimension.'
    ),
    ...Object.entries(metrics.trafficRollupCompactions.byDimension).map(([dimension, summary]) =>
      metricLine(
        'ou_ui_traffic_rollup_compactions_latest_bucket_timestamp_seconds_by_dimension',
        timestampSeconds(summary.latestBucketStartAt),
        { dimension }
      )
    ),
    ...metricHelp('ou_ui_audit_chain_valid', 'Whether the audit hash chain is currently valid.'),
    metricLine('ou_ui_audit_chain_valid', metrics.audit.valid ? 1 : 0),
    ...metricHelp('ou_ui_audit_chain_checked', 'Number of audit records checked during chain verification.'),
    metricLine('ou_ui_audit_chain_checked', metrics.audit.checked),
    ...metricHelp('ou_ui_audit_denied_total', 'Number of denied audit records.'),
    metricLine('ou_ui_audit_denied_total', metrics.audit.denied),
    ...metricHelp('ou_ui_audit_quota_exceeded_total', 'Number of quota-exceeded denied audit records.'),
    metricLine('ou_ui_audit_quota_exceeded_total', metrics.audit.quotaExceeded),
    ...metricHelp('ou_ui_audit_write_failures_total', 'Number of audit write failures observed by this HTTP server.'),
    metricLine('ou_ui_audit_write_failures_total', metrics.audit.writeFailures)
  ];

  return `${lines.join('\n')}\n`;
}
