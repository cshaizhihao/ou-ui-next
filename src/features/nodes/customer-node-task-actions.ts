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
  addedDays: number
): CustomerNodeConfigMetadata {
  const remainingDays = Math.max(metadata.remainingDays + Math.max(Math.round(addedDays), 0), 0);

  return {
    ...metadata,
    remainingDays,
    expiresAt: new Date(Date.now() + remainingDays * DAY_MS).toISOString()
  };
}
