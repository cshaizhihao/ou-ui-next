import type { DeployResourceType, DeployTaskOperation, DeployTaskStatus } from './task';

export type AuditSeverity = 'info' | 'warning' | 'critical';

export type AuditAction = 'audit.denied' | 'task.created' | `task.${DeployTaskStatus}`;

export type AuditResult = 'accepted' | 'succeeded' | 'failed' | 'denied';

export type AuditLog = {
  id: string;
  action: AuditAction;
  actor: string;
  operatorGroupId?: string;
  resourceGroupId?: string;
  scope: string;
  resourceType: DeployResourceType;
  operation: DeployTaskOperation;
  result: AuditResult;
  targetId: string;
  targetLabel: string;
  taskId: string;
  severity: AuditSeverity;
  message: string;
  createdAt: string;
  sourceIp: string;
  userAgent?: string;
  requestId: string;
  requestBodyHash?: string;
  denialCode?: string;
  denialReason?: string;
  prevHash?: string;
  hash?: string;
  before?: unknown;
  after?: unknown;
};
