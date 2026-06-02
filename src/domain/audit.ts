import type { DeployResourceType, DeployTaskOperation, DeployTaskStatus } from './task';

export type AuditSeverity = 'info' | 'warning' | 'critical';

export type AuditAction =
  | 'audit.denied'
  | 'agent.credential.revoked'
  | 'agent.credential.rotated'
  | 'task.created'
  | `task.${DeployTaskStatus}`;
export type AuditOperation = DeployTaskOperation | 'agent.credential.revoke' | 'agent.credential.rotate';

export type AuditResult = 'accepted' | 'succeeded' | 'failed' | 'denied';

export type AuditLog = {
  id: string;
  action: AuditAction;
  actor: string;
  operatorGroupId?: string;
  resourceGroupId?: string;
  scope: string;
  resourceType: DeployResourceType;
  operation: AuditOperation;
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
