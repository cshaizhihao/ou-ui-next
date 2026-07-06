import type { CustomerNodeConfigMetadata } from './nodes-page';

const DAY_MS = 24 * 60 * 60 * 1000;

export function createCustomerNodeEnabledUpdate(
  metadata: CustomerNodeConfigMetadata,
  enabled: boolean
): CustomerNodeConfigMetadata {
  return {
    ...metadata,
    enabled
  };
}

export function createCustomerNodeTrafficUpdate(
  metadata: CustomerNodeConfigMetadata,
  addedTrafficGb: number
): CustomerNodeConfigMetadata {
  return {
    ...metadata,
    trafficLimitGb: Math.max(metadata.trafficLimitGb + Math.max(Math.round(addedTrafficGb), 0), 0)
  };
}

export function createCustomerNodeRenewalUpdate(
  metadata: CustomerNodeConfigMetadata,
  addedDays: number,
  now: number | Date = Date.now()
): CustomerNodeConfigMetadata {
  const remainingDays = Math.max(metadata.remainingDays + Math.max(Math.round(addedDays), 0), 0);
  const nowMs = typeof now === 'number' ? now : now.getTime();

  return {
    ...metadata,
    remainingDays,
    expiresAt: new Date(nowMs + remainingDays * DAY_MS).toISOString()
  };
}
