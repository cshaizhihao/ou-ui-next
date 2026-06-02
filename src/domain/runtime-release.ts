import type { DeployTaskOperation } from './task';
import type { RuntimeModuleKind } from './module';

export type RuntimeReleaseStatus = 'compiled' | 'preflight_ready' | 'applied' | 'failed' | 'rolled_back';

export type RuntimePreflightStatus = 'pending' | 'passed' | 'failed';

export type RuntimeSnapshotStatus = 'captured' | 'verified' | 'restored' | 'expired';

export type RuntimeConfigRevision = {
  id: string;
  taskId: string;
  operation: DeployTaskOperation;
  targetId: string;
  targetLabel: string;
  agentId: string;
  moduleKind: RuntimeModuleKind;
  artifactUri: string;
  checksum: string;
  signature: string;
  preflightPlanId: string;
  snapshotBeforeId: string;
  status: RuntimeReleaseStatus;
  createdAt: string;
  createdBy: string;
  appliedAt?: string;
  failedAt?: string;
  failureReason?: string;
  healthSummary?: Record<string, unknown>;
  diffSummary: {
    added: number;
    changed: number;
    removed: number;
  };
  artifact: Record<string, unknown>;
};

export type RuntimePreflightCheck = {
  id: string;
  label: string;
  status: RuntimePreflightStatus;
  severity: 'info' | 'warning' | 'critical';
};

export type RuntimePreflightPlan = {
  id: string;
  taskId: string;
  configRevisionId: string;
  targetId: string;
  agentId: string;
  moduleKind: RuntimeModuleKind;
  status: RuntimePreflightStatus;
  checks: RuntimePreflightCheck[];
  createdAt: string;
  completedAt?: string;
  failureReason?: string;
};

export type RuntimeSnapshot = {
  id: string;
  taskId: string;
  targetId: string;
  targetLabel: string;
  agentId: string;
  moduleKind: RuntimeModuleKind;
  reason: 'pre_apply' | 'manual' | 'rollback';
  status: RuntimeSnapshotStatus;
  checksum: string;
  capturedAt: string;
  capturedBy: string;
  verifiedAt?: string;
  restoredAt?: string;
  restoredByTaskId?: string;
  state: Record<string, unknown>;
};
