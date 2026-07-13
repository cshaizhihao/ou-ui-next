import type { CreateTaskInput, DeployTask } from './task';

export type TaskOperationKind =
  | 'customer-node.upsert'
  | 'xray-client.subscription-binding';

export type TaskOperationStage = 'primary' | 'secondary' | 'compensation';

export type TaskOperationStatus =
  | 'accepted'
  | 'failed'
  | 'partial_failure'
  | 'compensation_queued';

export type TaskOperationFailure = {
  stage: TaskOperationStage;
  code: string;
  message: string;
};

export type TaskOperationReceipt = {
  id: string;
  kind: TaskOperationKind;
  targetId: string;
  targetLabel: string;
  status: TaskOperationStatus;
  createdAt: string;
  updatedAt: string;
  primaryTask?: DeployTask;
  secondaryTask?: DeployTask;
  compensationTask?: DeployTask;
  failure?: TaskOperationFailure;
};

export type CreateTaskOperationInput = {
  id: string;
  kind: Extract<TaskOperationKind, 'customer-node.upsert'>;
  targetId: string;
  targetLabel: string;
  primary: CreateTaskInput;
  secondary: CreateTaskInput;
  compensation?: CreateTaskInput;
};
