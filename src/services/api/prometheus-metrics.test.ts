import { describe, expect, it } from 'vitest';
import type { ObservabilityLatencySummary, ObservabilityMetrics } from './control-plane-api';
import { renderPrometheusMetrics } from './prometheus-metrics';

const latencyBucketBoundsMs = [100, 250, 500, 1000, 2500, 5000, 10_000, 30_000, 60_000, 120_000, 300_000];

function latencySummary(values: number[]): ObservabilityLatencySummary {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (ratio: number) => {
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return sorted[index] ?? 0;
  };

  return {
    count: sorted.length,
    sumMs: sorted.reduce((total, value) => total + value, 0),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted[sorted.length - 1] ?? 0,
    buckets: latencyBucketBoundsMs.map((leMs) => ({
      leMs,
      count: sorted.filter((value) => value <= leMs).length
    }))
  };
}

describe('Prometheus metrics renderer', () => {
  it('renders observability metrics as Prometheus text exposition', () => {
    const metrics: ObservabilityMetrics = {
      generatedAt: '2026-06-05T00:00:00.000Z',
      tasks: {
        total: 3,
        active: 1,
        failed: 1,
        rollbacks: 1,
        completionLatencyMs: latencySummary([1200, 2400]),
        completionLatencyByOperation: {
          'agent.deploy': latencySummary([1200]),
          'inbound.update': latencySummary([2400])
        },
        runtimeApplyLatencyByModule: {
          'host-agent': latencySummary([1200]),
          xray: latencySummary([2400])
        },
        byStatus: {
          queued: 1,
          running: 0,
          succeeded: 1,
          failed: 1,
          retrying: 0,
          rolled_back: 0,
          canceled: 0
        }
      },
      commandOutbox: {
        total: 2,
        backlog: 1,
        activeLeases: 1,
        overdue: 0,
        deadLetters: 1,
        ackLatencyMs: latencySummary([100]),
        resultLatencyMs: latencySummary([500]),
        byStatus: {
          pending: 1,
          dispatched: 0,
          acknowledged: 0,
          completed: 0,
          failed: 0,
          expired: 0,
          dead_letter: 1
        }
      },
      agents: {
        total: 2,
        offline: 1,
        degraded: 0,
        byStatus: {
          online: 1,
          offline: 1,
          degraded: 0,
          provisioning: 0
        }
      },
      systemAlerts: {
        total: 2,
        warning: 1,
        critical: 1,
        bySeverity: {
          warning: 1,
          critical: 1
        },
        byKind: {
          'agent.telemetry_sampling_gap': 0,
          'agent.offline': 0,
          'agent.runtime_service_unhealthy': 1,
          'agent.high_latency': 1,
          'command_outbox.overdue': 0,
          'command_outbox.dead_letter': 0,
          'runtime.reload_failed': 0,
          'audit.write_failed': 0,
          'system_alert_notification.overdue': 0,
          'system_alert_notification.dead_letter': 0,
          'quota.exceeded': 0
        }
      },
      systemAlertNotifications: {
        total: 3,
        pending: 1,
        failed: 1,
        delivered: 1,
        deadLetters: 0,
        overdue: 2,
        byStatus: {
          pending: 1,
          failed: 1,
          delivered: 1,
          dead_letter: 0
        }
      },
      agentLogs: {
        retained: 2,
        contentBytes: 12,
        earliestObservedAt: '2026-06-04T00:00:01.000Z',
        latestObservedAt: '2026-06-04T00:00:03.000Z',
        byStream: {
          stdout: {
            retained: 1,
            contentBytes: 5,
            earliestObservedAt: '2026-06-04T00:00:01.000Z',
            latestObservedAt: '2026-06-04T00:00:01.000Z'
          },
          stderr: {
            retained: 1,
            contentBytes: 7,
            earliestObservedAt: '2026-06-04T00:00:03.000Z',
            latestObservedAt: '2026-06-04T00:00:03.000Z'
          },
          agent: {
            retained: 0,
            contentBytes: 0,
            earliestObservedAt: null,
            latestObservedAt: null
          },
          runtime: {
            retained: 0,
            contentBytes: 0,
            earliestObservedAt: null,
            latestObservedAt: null
          }
        }
      },
      agentLogArchives: {
        buckets: 2,
        chunks: 5,
        contentBytes: 50,
        earliestBucketStartAt: '2026-05-31T00:00:00.000Z',
        latestBucketStartAt: '2026-06-01T00:00:00.000Z',
        byStream: {
          stdout: {
            buckets: 0,
            chunks: 0,
            contentBytes: 0,
            earliestBucketStartAt: null,
            latestBucketStartAt: null
          },
          stderr: {
            buckets: 1,
            chunks: 2,
            contentBytes: 20,
            earliestBucketStartAt: '2026-05-31T00:00:00.000Z',
            latestBucketStartAt: '2026-05-31T00:00:00.000Z'
          },
          agent: {
            buckets: 0,
            chunks: 0,
            contentBytes: 0,
            earliestBucketStartAt: null,
            latestBucketStartAt: null
          },
          runtime: {
            buckets: 1,
            chunks: 3,
            contentBytes: 30,
            earliestBucketStartAt: '2026-06-01T00:00:00.000Z',
            latestBucketStartAt: '2026-06-01T00:00:00.000Z'
          }
        }
      },
      trafficRollups: {
        retained: 3,
        earliestSampledAt: '2026-06-04T00:00:00.000Z',
        latestSampledAt: '2026-06-04T00:02:00.000Z',
        meteredBytesTotal: 9000,
        byDimension: {
          agent: {
            retained: 1,
            earliestSampledAt: '2026-06-04T00:00:00.000Z',
            latestSampledAt: '2026-06-04T00:00:00.000Z',
            meteredBytesTotal: 3000
          },
          'forward-rule': {
            retained: 2,
            earliestSampledAt: '2026-06-04T00:01:00.000Z',
            latestSampledAt: '2026-06-04T00:02:00.000Z',
            meteredBytesTotal: 6000
          },
          'xray-client': {
            retained: 0,
            earliestSampledAt: null,
            latestSampledAt: null,
            meteredBytesTotal: 0
          }
        }
      },
      trafficRollupCompactions: {
        buckets: 2,
        samples: 7,
        earliestBucketStartAt: '2026-05-30T00:00:00.000Z',
        latestBucketStartAt: '2026-05-31T00:00:00.000Z',
        meteredBytesTotal: 12000,
        byDimension: {
          agent: {
            buckets: 1,
            samples: 3,
            earliestBucketStartAt: '2026-05-30T00:00:00.000Z',
            latestBucketStartAt: '2026-05-30T00:00:00.000Z',
            meteredBytesTotal: 5000
          },
          'forward-rule': {
            buckets: 0,
            samples: 0,
            earliestBucketStartAt: null,
            latestBucketStartAt: null,
            meteredBytesTotal: 0
          },
          'xray-client': {
            buckets: 1,
            samples: 4,
            earliestBucketStartAt: '2026-05-31T00:00:00.000Z',
            latestBucketStartAt: '2026-05-31T00:00:00.000Z',
            meteredBytesTotal: 7000
          }
        }
      },
      audit: {
        valid: true,
        checked: 4,
        denied: 2,
        quotaExceeded: 1,
        writeFailures: 1
      }
    };

    const text = renderPrometheusMetrics(metrics);

    expect(text).toContain('# HELP ou_ui_tasks_total Total number of deploy tasks.');
    expect(text).toContain('ou_ui_metrics_generated_timestamp_seconds 1780617600');
    expect(text).toContain('ou_ui_tasks_total 3');
    expect(text).toContain('ou_ui_tasks_by_status{status="queued"} 1');
    expect(text).toContain('ou_ui_command_outbox_by_status{status="dead_letter"} 1');
    expect(text).toContain('ou_ui_task_completion_latency_p95_ms 2400');
    expect(text).toContain('# TYPE ou_ui_task_completion_latency_ms histogram');
    expect(text).toContain('ou_ui_task_completion_latency_ms_bucket{le="1000"} 0');
    expect(text).toContain('ou_ui_task_completion_latency_ms_bucket{le="2500"} 2');
    expect(text).toContain('ou_ui_task_completion_latency_ms_bucket{le="+Inf"} 2');
    expect(text).toContain('ou_ui_task_completion_latency_ms_sum 3600');
    expect(text).toContain('ou_ui_task_completion_latency_ms_count 2');
    expect(text).toContain('ou_ui_task_completion_latency_by_operation_count{operation="agent.deploy"} 1');
    expect(text).toContain('ou_ui_task_completion_latency_by_operation_p95_ms{operation="inbound.update"} 2400');
    expect(text).toContain(
      'ou_ui_task_completion_latency_by_operation_ms_bucket{operation="agent.deploy",le="2500"} 1'
    );
    expect(text).toContain(
      'ou_ui_task_completion_latency_by_operation_ms_count{operation="inbound.update"} 1'
    );
    expect(text).toContain('ou_ui_runtime_apply_latency_by_module_count{module="host-agent"} 1');
    expect(text).toContain('ou_ui_runtime_apply_latency_by_module_max_ms{module="xray"} 2400');
    expect(text).toContain('ou_ui_runtime_apply_latency_by_module_ms_sum{module="xray"} 2400');
    expect(text).toContain('ou_ui_command_ack_latency_ms_bucket{le="100"} 1');
    expect(text).toContain('ou_ui_command_result_latency_ms_bucket{le="500"} 1');
    expect(text).toContain('ou_ui_agents_by_status{status="offline"} 1');
    expect(text).toContain('ou_ui_system_alerts_by_severity{severity="warning"} 1');
    expect(text).toContain('ou_ui_system_alerts_by_kind{kind="agent.offline"} 0');
    expect(text).toContain('ou_ui_system_alerts_by_kind{kind="agent.runtime_service_unhealthy"} 1');
    expect(text).toContain('ou_ui_system_alerts_by_kind{kind="agent.high_latency"} 1');
    expect(text).toContain('ou_ui_system_alerts_by_kind{kind="command_outbox.overdue"} 0');
    expect(text).toContain('ou_ui_system_alerts_by_kind{kind="command_outbox.dead_letter"} 0');
    expect(text).toContain('ou_ui_system_alerts_by_kind{kind="runtime.reload_failed"} 0');
    expect(text).toContain('ou_ui_system_alerts_by_kind{kind="audit.write_failed"} 0');
    expect(text).toContain('ou_ui_system_alerts_by_kind{kind="system_alert_notification.overdue"} 0');
    expect(text).toContain('ou_ui_system_alerts_by_kind{kind="system_alert_notification.dead_letter"} 0');
    expect(text).toContain('ou_ui_system_alerts_by_kind{kind="quota.exceeded"} 0');
    expect(text).toContain('ou_ui_system_alert_notifications_failed 1');
    expect(text).toContain('ou_ui_system_alert_notifications_by_status{status="delivered"} 1');
    expect(text).toContain('ou_ui_agent_log_chunks_retained_total 2');
    expect(text).toContain('ou_ui_agent_log_chunks_retained_by_stream{stream="stderr"} 1');
    expect(text).toContain('ou_ui_agent_log_chunks_content_bytes_total 12');
    expect(text).toContain('ou_ui_agent_log_chunks_content_bytes_by_stream{stream="stdout"} 5');
    expect(text).toContain(
      `ou_ui_agent_log_chunks_earliest_observed_timestamp_seconds ${Math.floor(
        Date.parse('2026-06-04T00:00:01.000Z') / 1000
      )}`
    );
    expect(text).toContain('ou_ui_agent_log_chunks_latest_observed_timestamp_seconds_by_stream{stream="agent"} 0');
    expect(text).toContain('ou_ui_agent_log_archives_buckets_total 2');
    expect(text).toContain('ou_ui_agent_log_archives_buckets_by_stream{stream="runtime"} 1');
    expect(text).toContain('ou_ui_agent_log_archives_chunks_total 5');
    expect(text).toContain('ou_ui_agent_log_archives_chunks_by_stream{stream="stderr"} 2');
    expect(text).toContain('ou_ui_agent_log_archives_content_bytes_total 50');
    expect(text).toContain('ou_ui_agent_log_archives_content_bytes_by_stream{stream="runtime"} 30');
    expect(text).toContain(
      `ou_ui_agent_log_archives_latest_bucket_timestamp_seconds ${Math.floor(
        Date.parse('2026-06-01T00:00:00.000Z') / 1000
      )}`
    );
    expect(text).toContain('ou_ui_traffic_rollups_retained_total 3');
    expect(text).toContain('ou_ui_traffic_rollups_retained_by_dimension{dimension="forward-rule"} 2');
    expect(text).toContain('ou_ui_traffic_rollups_metered_bytes_total 9000');
    expect(text).toContain('ou_ui_traffic_rollups_metered_bytes_by_dimension{dimension="agent"} 3000');
    expect(text).toContain(
      `ou_ui_traffic_rollups_earliest_sample_timestamp_seconds ${Math.floor(
        Date.parse('2026-06-04T00:00:00.000Z') / 1000
      )}`
    );
    expect(text).toContain(
      `ou_ui_traffic_rollups_latest_sample_timestamp_seconds_by_dimension{dimension="xray-client"} 0`
    );
    expect(text).toContain('ou_ui_traffic_rollup_compactions_buckets_total 2');
    expect(text).toContain('ou_ui_traffic_rollup_compactions_buckets_by_dimension{dimension="xray-client"} 1');
    expect(text).toContain('ou_ui_traffic_rollup_compactions_samples_total 7');
    expect(text).toContain('ou_ui_traffic_rollup_compactions_samples_by_dimension{dimension="agent"} 3');
    expect(text).toContain('ou_ui_traffic_rollup_compactions_metered_bytes_total 12000');
    expect(text).toContain(
      'ou_ui_traffic_rollup_compactions_metered_bytes_by_dimension{dimension="forward-rule"} 0'
    );
    expect(text).toContain(
      `ou_ui_traffic_rollup_compactions_earliest_bucket_timestamp_seconds ${Math.floor(
        Date.parse('2026-05-30T00:00:00.000Z') / 1000
      )}`
    );
    expect(text).toContain(
      `ou_ui_traffic_rollup_compactions_latest_bucket_timestamp_seconds_by_dimension{dimension="xray-client"} ${Math.floor(
        Date.parse('2026-05-31T00:00:00.000Z') / 1000
      )}`
    );
    expect(text).toContain('ou_ui_audit_chain_valid 1');
    expect(text).toContain('ou_ui_audit_denied_total 2');
    expect(text).toContain('ou_ui_audit_quota_exceeded_total 1');
    expect(text).toContain('ou_ui_audit_write_failures_total 1');
    expect(text.endsWith('\n')).toBe(true);
  });
});
