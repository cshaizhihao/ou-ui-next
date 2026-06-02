import type { PermissionGrant, ResourcePermission } from './permission';

export type DeployTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'retrying' | 'rolled_back' | 'canceled';

export type DeployResourceType =
  | 'agent'
  | 'node'
  | 'module'
  | 'inbound'
  | 'subscription'
  | 'tunnel'
  | 'forward'
  | 'quota'
  | 'permission';

export type DeployTaskOperation =
  | 'agent.deploy'
  | 'agent.upgrade'
  | 'agent.rollback'
  | 'module.install'
  | 'inbound.create'
  | 'inbound.update'
  | 'inbound.delete'
  | 'config.compile'
  | 'config.apply'
  | 'runtime.reload'
  | 'forward.create'
  | 'forward.update'
  | 'forward.apply'
  | 'forward.pause'
  | 'forward.resume'
  | 'tunnel.create'
  | 'tunnel.update'
  | 'tunnel.redeploy'
  | 'subscription.import'
  | 'subscription.sync'
  | 'subscription.export'
  | 'subscription.generate'
  | 'quota.reset'
  | 'permission.grant'
  | 'permission.revoke'
  | 'system.tune';

export type DeployTaskStep = {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
};

export type CreateTaskMetadata = Record<string, unknown>;

export type DeployTask = {
  id: string;
  operation: DeployTaskOperation;
  resourceType: DeployResourceType;
  resourceId: string;
  status: DeployTaskStatus;
  targetId: string;
  targetLabel: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  actor: string;
  requestedBy: string;
  requestId: string;
  idempotencyKey?: string;
  sourceIp: string;
  rollbackAvailable: boolean;
  attempts: number;
  progressPercent?: number;
  steps: DeployTaskStep[];
  metadata?: CreateTaskMetadata;
  failureReason?: string;
  rollbackTaskId?: string;
};

export type PermissionChangeInput = {
  subjectType: PermissionGrant['subjectType'];
  subjectId: string;
  resourceType: PermissionGrant['resourceType'];
  resourceId: string;
  permissions: ResourcePermission[];
  reason?: string;
  expiresAt?: string;
};

export type CreateTaskInput = {
  operation: DeployTaskOperation;
  resourceType?: DeployResourceType;
  targetId: string;
  targetLabel: string;
  summary: string;
  metadata?: CreateTaskMetadata;
  permissionChange?: PermissionChangeInput;
};
