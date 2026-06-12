import type { AppLanguage } from '../../app/app-store';
import type { CreateTaskInput } from '../../domain/task';
import type { MutationContext } from '../../services/api/control-plane-api';

export function createUiMutationContext(
  input: CreateTaskInput,
  idempotencyKeyOverride?: string,
  runtimeConfig?: { loginUsername: string; operatorGroupId: string; resourceGroupId: string }
): MutationContext {
  return createUiRequestContext(input.operation, input.targetId, runtimeConfig, idempotencyKeyOverride);
}

export function createUiRequestContext(
  operation: string,
  targetId: string,
  runtimeConfig?: { loginUsername: string; operatorGroupId: string; resourceGroupId: string },
  idempotencyKeyOverride?: string
): MutationContext {
  const rawIdempotencyKey = idempotencyKeyOverride ?? `ui:${operation}:${targetId}`;
  const idempotencyKey = createBoundedMutationKey(rawIdempotencyKey, 190);
  const requestId = createBoundedMutationKey(idempotencyKey, 150);

  return {
    actor: runtimeConfig?.loginUsername ?? 'local-operator',
    operatorGroupId: runtimeConfig?.operatorGroupId ?? 'owner',
    resourceGroupId: runtimeConfig?.resourceGroupId ?? 'group-premium',
    sourceIp: 'ui-preview',
    requestId,
    idempotencyKey
  };
}

function createStableHash(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(36).padStart(7, '0');
}

export function createBoundedMutationKey(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  const [scope = 'ui', operation = 'request', targetId = 'target'] = value.split(':');
  const safeTargetId = targetId.length > 72 ? `${targetId.slice(0, 60)}-${createStableHash(targetId)}` : targetId;
  const readableKey = [scope, operation, safeTargetId, createStableHash(value)].join(':');

  if (readableKey.length <= maxLength) {
    return readableKey;
  }

  return [scope.slice(0, 16), operation.slice(0, 64), createStableHash(targetId), createStableHash(value)].join(':');
}

export function readControlPlaneErrorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }

  if (error instanceof Error && error.message.includes('permission.denied')) {
    return 'permission.denied';
  }

  if (error instanceof Error && error.message.includes('unauthorized')) {
    return 'unauthorized';
  }

  return undefined;
}

export function readControlPlaneErrorDetails(error: unknown) {
  if (error && typeof error === 'object' && 'details' in error) {
    return (error as { details?: unknown }).details;
  }

  return undefined;
}

function readPermissionDenialDetails(details: unknown) {
  if (!details || typeof details !== 'object') {
    return undefined;
  }

  const denial = details as {
    before?: { actorPermissions?: unknown };
    after?: { requiredPermission?: unknown; resourceId?: unknown };
  };
  const actorPermissions = Array.isArray(denial.before?.actorPermissions)
    ? denial.before.actorPermissions.filter((permission): permission is string => typeof permission === 'string')
    : [];

  return {
    requiredPermission:
      typeof denial.after?.requiredPermission === 'string' ? denial.after.requiredPermission : undefined,
    resourceId: typeof denial.after?.resourceId === 'string' ? denial.after.resourceId : undefined,
    actorPermissions
  };
}

const errorHints = {
  zh: {
    permissionDenied: '当前账号没有执行此变更的权限。请检查权限与资源组配置。',
    unauthorized: '登录已失效，请重新登录后再试。'
  },
  en: {
    permissionDenied: 'The current operator is not allowed to perform this operation. Check access and resource group settings.',
    unauthorized: 'Your session is no longer valid. Sign in again and retry.'
  }
} as const;

export function formatTaskMutationError(error: unknown, language: AppLanguage, fallback: string) {
  const code = readControlPlaneErrorCode(error);

  if (code === 'permission.denied') {
    const denialDetails = readPermissionDenialDetails(readControlPlaneErrorDetails(error));

    if (denialDetails?.requiredPermission || denialDetails?.resourceId) {
      const permissions = denialDetails.actorPermissions.length > 0
        ? denialDetails.actorPermissions.join(', ')
        : language === 'zh'
          ? '无'
          : 'none';

      return language === 'zh'
        ? `当前账号缺少 ${denialDetails.requiredPermission ?? '所需'} 权限，资源组：${denialDetails.resourceId ?? '未知'}；已有权限：${permissions}。请运行 ou d 检查安装状态，必要时运行 ou r 清理旧状态。`
        : `The current operator is missing ${denialDetails.requiredPermission ?? 'required'} permission on ${denialDetails.resourceId ?? 'unknown resource group'}; current permissions: ${permissions}. Run ou d to inspect the installation, or ou r to clear stale state.`;
    }

    return errorHints[language].permissionDenied;
  }

  if (code === 'unauthorized') {
    return errorHints[language].unauthorized;
  }

  return error instanceof Error ? error.message : fallback;
}
