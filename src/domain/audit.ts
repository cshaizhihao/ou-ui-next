import type { DeployResourceType, DeployTaskOperation, DeployTaskStatus } from './task';

export type AuditSeverity = 'info' | 'warning' | 'critical';

export type AuditAction =
  | 'audit.denied'
  | 'agent.credential.issued'
  | 'agent.credential.revoked'
  | 'agent.credential.rotated'
  | 'agent.upgrade_command.issued'
  | 'agent.log_retention.updated'
  | 'traffic.rollup_retention.updated'
  | 'telegram_bot.settings.updated'
  | 'telegram_bot.test_sent'
  | 'telegram_binding.created'
  | 'telegram_binding.revoked'
  | 'telegram_binding_challenge.created'
  | 'telegram_notification_policy.updated'
  | 'telegram_notification.delivery_retried'
  | 'operator.session.issued'
  | 'operator.session.revoked'
  | 'operator.session.expired'
  | 'subscription.source.synced'
  | 'subscription.source.sync_failed'
  | 'task.created'
  | `task.${DeployTaskStatus}`;
export type AuditOperation =
  | DeployTaskOperation
  | 'operator.auth'
  | 'operator.session.issue'
  | 'operator.session.revoke'
  | 'operator.session.expire'
  | 'agent.poll'
  | 'agent.events'
  | 'agent.credential.issue'
  | 'agent.credential.revoke'
  | 'agent.credential.rotate'
  | 'agent.log_retention.update'
  | 'traffic.rollup_retention.update'
  | 'telegram_bot.settings.update'
  | 'telegram_bot.test'
  | 'telegram_binding.create'
  | 'telegram_binding.revoke'
  | 'telegram_binding_challenge.create'
  | 'telegram_notification_policy.update'
  | 'telegram_notification.delivery_retry';

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
