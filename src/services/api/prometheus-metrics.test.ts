import { describe, expect, it } from 'vitest';
import type { ObservabilityMetrics } from './control-plane-api';
import { renderPrometheusMetrics } from './prometheus-metrics';

describe('Prometheus metrics renderer', () => {
  it('renders observability metrics as Prometheus text exposition', () => {
    const metrics: ObservabilityMetrics = {
      generatedAt: '2026-06-05T00:00:00.000Z',
      tasks: {
        total: 3,
        active: 1,
        failed: 1,
        rollbacks: 1,
        completionLatencyMs: {
          count: 2,
          p50Ms: 1200,
          p95Ms: 2400,
          maxMs: 2400
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
        ackLatencyMs: {
          count: 1,
          p50Ms: 100,
          p95Ms: 100,
          maxMs: 100
        },
        resultLatencyMs: {
          count: 1,
          p50Ms: 500,
          p95Ms: 500,
          maxMs: 500
        },
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
        total: 1,
        warning: 1,
        critical: 0,
        bySeverity: {
          warning: 1,
          critical: 0
        },
        byKind: {
          'agent.telemetry_sampling_gap': 0,
          'agent.runtime_service_unhealthy': 1
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
      audit: {
        valid: true,
        checked: 4,
        denied: 2,
        quotaExceeded: 1
      }
    };

    const text = renderPrometheusMetrics(metrics);

    expect(text).toContain('# HELP ou_ui_tasks_total Total number of deploy tasks.');
    expect(text).toContain('ou_ui_metrics_generated_timestamp_seconds 1780617600');
    expect(text).toContain('ou_ui_tasks_total 3');
    expect(text).toContain('ou_ui_tasks_by_status{status="queued"} 1');
    expect(text).toContain('ou_ui_command_outbox_by_status{status="dead_letter"} 1');
    expect(text).toContain('ou_ui_task_completion_latency_p95_ms 2400');
    expect(text).toContain('ou_ui_agents_by_status{status="offline"} 1');
    expect(text).toContain('ou_ui_system_alerts_by_severity{severity="warning"} 1');
    expect(text).toContain('ou_ui_system_alerts_by_kind{kind="agent.runtime_service_unhealthy"} 1');
    expect(text).toContain('ou_ui_system_alert_notifications_failed 1');
    expect(text).toContain('ou_ui_system_alert_notifications_by_status{status="delivered"} 1');
    expect(text).toContain('ou_ui_audit_chain_valid 1');
    expect(text).toContain('ou_ui_audit_denied_total 2');
    expect(text).toContain('ou_ui_audit_quota_exceeded_total 1');
    expect(text.endsWith('\n')).toBe(true);
  });
});
