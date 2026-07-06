import type { CustomerNodeConfigMetadata } from './nodes-page';

const DAY_MS = 24 * 60 * 60 * 1000;
type CustomerNodeClientMetadata = NonNullable<CustomerNodeConfigMetadata['clients']>[number];

export type CustomerNodeClientAction =
  | { kind: 'set-enabled'; enabled: boolean }
  | { kind: 'add-traffic'; addedTrafficGb: number }
  | { kind: 'set-traffic-limit'; trafficLimitGb: number }
  | { kind: 'reset-used-traffic' }
  | { kind: 'renew'; addedDays: number; now?: number | Date }
  | { kind: 'set-reset-policy'; resetPolicy: CustomerNodeConfigMetadata['resetPolicy'] }
  | { kind: 'set-ip-limit'; ipLimit: number };

function roundNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(Math.round(value), 0) : 0;
}

function isQuotaExceeded(usedTrafficGb: number, trafficLimitGb: number) {
  return trafficLimitGb > 0 && usedTrafficGb >= trafficLimitGb;
}

function createClientMetadataFromTopLevel(metadata: CustomerNodeConfigMetadata): CustomerNodeClientMetadata {
  return {
    clientIdentity: metadata.clientIdentity,
    clientEmail: metadata.clientEmail,
    clientCredential: metadata.clientCredential,
    clientLevel: metadata.clientLevel,
    clientComment: metadata.clientComment,
    telegramId: metadata.telegramId,
    resetPolicy: metadata.resetPolicy,
    vmessSecurity: metadata.vmessSecurity,
    shadowsocksMethod: metadata.shadowsocksMethod,
    hysteriaAuth: metadata.hysteriaAuth,
    flow: metadata.flow,
    ipLimit: metadata.ipLimit,
    trafficMultiplier: metadata.trafficMultiplier,
    trafficLimitGb: metadata.trafficLimitGb,
    monthlyResetDay: metadata.monthlyResetDay,
    currentUsedTrafficGb: metadata.currentUsedTrafficGb,
    remainingDays: metadata.remainingDays,
    expiresAt: metadata.expiresAt,
    quotaExceeded: metadata.quotaExceeded,
    clientExpired: metadata.clientExpired,
    runtimeDisabledByPolicy: metadata.runtimeDisabledByPolicy,
    guardrailReason: metadata.guardrailReason,
    subscriptionRule: metadata.subscriptionRule,
    enabled: metadata.enabled
  };
}

function isSameClient(metadata: CustomerNodeConfigMetadata, client: CustomerNodeClientMetadata) {
  return (
    (metadata.clientIdentity.trim() !== '' && client.clientIdentity === metadata.clientIdentity)
    || (metadata.clientEmail.trim() !== '' && client.clientEmail === metadata.clientEmail)
  );
}

function isQuotaGuardrailReason(reason: string | undefined) {
  return Boolean(reason && reason.includes('quota'));
}

function isExpiryGuardrailReason(reason: string | undefined) {
  return Boolean(reason && reason.includes('expired'));
}

function clearGuardrailForRecoveredClient(
  metadata: CustomerNodeConfigMetadata,
  patch: Partial<CustomerNodeConfigMetadata>
): Partial<CustomerNodeConfigMetadata> {
  const nextQuotaExceeded = patch.quotaExceeded ?? metadata.quotaExceeded;
  const nextClientExpired = patch.clientExpired ?? metadata.clientExpired;
  const currentReason = metadata.guardrailReason;
  const clearsQuota = patch.quotaExceeded === false && isQuotaGuardrailReason(currentReason);
  const clearsExpiry = patch.clientExpired === false && isExpiryGuardrailReason(currentReason);

  if (!clearsQuota && !clearsExpiry) {
    return patch;
  }

  if (nextQuotaExceeded || nextClientExpired) {
    return {
      ...patch,
      runtimeDisabledByPolicy: true,
      guardrailReason: nextQuotaExceeded ? 'xray_client_monthly_quota_exceeded' : 'xray_client_expired'
    };
  }

  return {
    ...patch,
    runtimeDisabledByPolicy: false,
    guardrailReason: 'ok'
  };
}

function createPatchForAction(
  metadata: CustomerNodeConfigMetadata,
  action: CustomerNodeClientAction
): Partial<CustomerNodeConfigMetadata> {
  switch (action.kind) {
    case 'set-enabled':
      return {
        enabled: action.enabled
      };
    case 'add-traffic': {
      const trafficLimitGb = Math.max(metadata.trafficLimitGb + roundNonNegative(action.addedTrafficGb), 0);
      return clearGuardrailForRecoveredClient(metadata, {
        trafficLimitGb,
        quotaExceeded: isQuotaExceeded(metadata.currentUsedTrafficGb, trafficLimitGb)
      });
    }
    case 'set-traffic-limit': {
      const trafficLimitGb = roundNonNegative(action.trafficLimitGb);

      return clearGuardrailForRecoveredClient(metadata, {
        trafficLimitGb,
        quotaExceeded: isQuotaExceeded(metadata.currentUsedTrafficGb, trafficLimitGb)
      });
    }
    case 'reset-used-traffic':
      return clearGuardrailForRecoveredClient(metadata, {
        currentUsedTrafficGb: 0,
        quotaExceeded: false
      });
    case 'renew': {
      const remainingDays = Math.max(metadata.remainingDays + roundNonNegative(action.addedDays), 0);
      const now = action.now ?? Date.now();
      const nowMs = typeof now === 'number' ? now : now.getTime();

      return clearGuardrailForRecoveredClient(metadata, {
        remainingDays,
        expiresAt: new Date(nowMs + remainingDays * DAY_MS).toISOString(),
        clientExpired: remainingDays <= 0
      });
    }
    case 'set-reset-policy':
      return {
        resetPolicy: action.resetPolicy
      };
    case 'set-ip-limit':
      return {
        ipLimit: roundNonNegative(action.ipLimit)
      };
    default:
      return {};
  }
}

function syncClientMetadata(
  metadata: CustomerNodeConfigMetadata,
  patch: Partial<CustomerNodeConfigMetadata>
): CustomerNodeConfigMetadata['clients'] {
  const baseClient = createClientMetadataFromTopLevel(metadata);
  const clients = metadata.clients && metadata.clients.length > 0 ? metadata.clients : [baseClient];
  let matched = false;
  const nextTargetClient = {
    ...baseClient,
    ...(patch.clientIdentity !== undefined ? { clientIdentity: patch.clientIdentity } : {}),
    ...(patch.clientEmail !== undefined ? { clientEmail: patch.clientEmail } : {}),
    ...(patch.clientCredential !== undefined ? { clientCredential: patch.clientCredential } : {}),
    ...(patch.clientLevel !== undefined ? { clientLevel: patch.clientLevel } : {}),
    ...(patch.clientComment !== undefined ? { clientComment: patch.clientComment } : {}),
    ...(patch.telegramId !== undefined ? { telegramId: patch.telegramId } : {}),
    ...(patch.resetPolicy !== undefined ? { resetPolicy: patch.resetPolicy } : {}),
    ...(patch.vmessSecurity !== undefined ? { vmessSecurity: patch.vmessSecurity } : {}),
    ...(patch.shadowsocksMethod !== undefined ? { shadowsocksMethod: patch.shadowsocksMethod } : {}),
    ...(patch.hysteriaAuth !== undefined ? { hysteriaAuth: patch.hysteriaAuth } : {}),
    ...(patch.flow !== undefined ? { flow: patch.flow } : {}),
    ...(patch.ipLimit !== undefined ? { ipLimit: patch.ipLimit } : {}),
    ...(patch.trafficMultiplier !== undefined ? { trafficMultiplier: patch.trafficMultiplier } : {}),
    ...(patch.trafficLimitGb !== undefined ? { trafficLimitGb: patch.trafficLimitGb } : {}),
    ...(patch.monthlyResetDay !== undefined ? { monthlyResetDay: patch.monthlyResetDay } : {}),
    ...(patch.currentUsedTrafficGb !== undefined ? { currentUsedTrafficGb: patch.currentUsedTrafficGb } : {}),
    ...(patch.remainingDays !== undefined ? { remainingDays: patch.remainingDays } : {}),
    ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
    ...(patch.quotaExceeded !== undefined ? { quotaExceeded: patch.quotaExceeded } : {}),
    ...(patch.clientExpired !== undefined ? { clientExpired: patch.clientExpired } : {}),
    ...(patch.runtimeDisabledByPolicy !== undefined ? { runtimeDisabledByPolicy: patch.runtimeDisabledByPolicy } : {}),
    ...(patch.guardrailReason !== undefined ? { guardrailReason: patch.guardrailReason } : {}),
    ...(patch.subscriptionRule !== undefined ? { subscriptionRule: patch.subscriptionRule } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {})
  };
  const patchedClients = clients.map((client) => {
    if (!isSameClient(metadata, client)) {
      return client;
    }

    matched = true;
    return {
      ...client,
      ...nextTargetClient
    };
  });

  return matched ? patchedClients : [nextTargetClient, ...patchedClients];
}

export function createCustomerNodeClientActionUpdate(
  metadata: CustomerNodeConfigMetadata,
  action: CustomerNodeClientAction
): CustomerNodeConfigMetadata {
  const patch = createPatchForAction(metadata, action);

  return {
    ...metadata,
    ...patch,
    clients: syncClientMetadata(metadata, patch)
  };
}

export function createCustomerNodeEnabledUpdate(
  metadata: CustomerNodeConfigMetadata,
  enabled: boolean
): CustomerNodeConfigMetadata {
  return createCustomerNodeClientActionUpdate(metadata, { kind: 'set-enabled', enabled });
}

export function createCustomerNodeTrafficUpdate(
  metadata: CustomerNodeConfigMetadata,
  addedTrafficGb: number
): CustomerNodeConfigMetadata {
  return createCustomerNodeClientActionUpdate(metadata, { kind: 'add-traffic', addedTrafficGb });
}

export function createCustomerNodeRenewalUpdate(
  metadata: CustomerNodeConfigMetadata,
  addedDays: number,
  now: number | Date = Date.now()
): CustomerNodeConfigMetadata {
  return createCustomerNodeClientActionUpdate(metadata, { kind: 'renew', addedDays, now });
}
