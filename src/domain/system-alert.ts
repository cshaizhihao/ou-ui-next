export type SystemAlertKind =
  | 'agent.telemetry_sampling_gap'
  | 'agent.runtime_service_unhealthy'
  | 'agent.high_latency'
  | 'command_outbox.overdue'
  | 'command_outbox.dead_letter'
  | 'quota.exceeded';

export type SystemAlertSeverity = 'warning' | 'critical';

export type SystemAlertStatus = 'active';

export type SystemAlertResourceType = 'agent' | 'command_outbox' | 'quota_policy';

export type SystemAlert = {
  id: string;
  kind: SystemAlertKind;
  severity: SystemAlertSeverity;
  status: SystemAlertStatus;
  title: string;
  message: string;
  resourceType: SystemAlertResourceType;
  resourceId: string;
  resourceLabel: string;
  observedAt: string;
  dedupeKey: string;
  metadata?: Record<string, string | number | boolean | undefined>;
};
