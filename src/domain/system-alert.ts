export type SystemAlertKind = 'agent.telemetry_sampling_gap';

export type SystemAlertSeverity = 'warning' | 'critical';

export type SystemAlertStatus = 'active';

export type SystemAlertResourceType = 'agent';

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
