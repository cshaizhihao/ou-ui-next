import type { AuditLog } from './audit';
import type { DeployTask } from './task';

const OPERATOR_SECRET_KEYS = new Set([
  'accessTokenHash',
  'accessTokenRaw',
  'botToken',
  'clientCredential',
  'hysteriaAuth',
  'password',
  'privateKey',
  'realityPrivateKey',
  'tokenHash',
  'webhookSecretPath'
]);

export type OperatorReadIdentity = {
  actor: string;
  operatorGroupId?: string;
  resourceGroupId?: string;
};

export function redactOperatorReadSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactOperatorReadSecrets(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const redacted: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value)) {
    if (!OPERATOR_SECRET_KEYS.has(key)) {
      redacted[key] = redactOperatorReadSecrets(item);
    }
  }

  return redacted;
}

export function createOperatorTaskReadModel(task: DeployTask): DeployTask {
  return redactOperatorReadSecrets(task) as DeployTask;
}

export function canReadAllOperatorResources(identity: OperatorReadIdentity | undefined) {
  return (
    !identity ||
    !identity.resourceGroupId ||
    identity.actor === 'admin' ||
    identity.actor === 'operator:admin' ||
    identity.operatorGroupId === 'owner'
  );
}

export function filterOperatorTasks(tasks: DeployTask[], identity: OperatorReadIdentity | undefined) {
  if (canReadAllOperatorResources(identity)) {
    return tasks;
  }

  return tasks.filter(
    (task) =>
      task.resourceGroupId === identity?.resourceGroupId ||
      (!task.resourceGroupId && task.actor === identity?.actor)
  );
}

export function filterOperatorAuditLogs(logs: AuditLog[], identity: OperatorReadIdentity | undefined) {
  if (canReadAllOperatorResources(identity)) {
    return logs;
  }

  return logs.filter(
    (log) =>
      log.resourceGroupId === identity?.resourceGroupId ||
      (!log.resourceGroupId && log.actor === identity?.actor)
  );
}
