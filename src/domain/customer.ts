import type { ForwardRule } from './forwarding';
import { calculateForwardingBilledBytes } from './forwarding';
import type { SubscriptionClientIdentity } from './subscription';
import type { XrayInbound } from './protocol';

export type CustomerReadModel = {
  id: string;
  name: string;
  status: 'active' | 'limited' | 'expired';
  sourceKinds: Array<'customer-node' | 'subscription' | 'forwarding'>;
  customerNodeCount: number;
  subscriptionClientCount: number;
  forwardRuleCount: number;
  agentIds: string[];
  customerNodeIds: string[];
  subscriptionClientIds: string[];
  forwardRuleIds: string[];
  customerNodeUsedTrafficBytes: number;
  customerNodeTrafficLimitBytes: number;
  subscriptionUsedTrafficBytes: number;
  subscriptionTrafficLimitBytes: number;
  forwardingUsedTrafficBytes: number;
  forwardingTrafficLimitBytes: number;
  usedTrafficBytes: number;
  trafficLimitBytes: number;
  expiresAt?: string;
  lastActivityAt?: string;
  quotaExceeded: boolean;
  runtimeDisabledByPolicy: boolean;
};

type MutableCustomerReadModel = CustomerReadModel & {
  sourceKindSet: Set<CustomerReadModel['sourceKinds'][number]>;
};

function createSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function createCustomerId(name: string) {
  const normalizedName = name.trim().toLowerCase();
  const slug = createSlug(normalizedName);

  if (slug) {
    return `customer:${slug}`;
  }

  const codePointKey = Array.from(normalizedName)
    .map((char) => char.codePointAt(0)?.toString(16).padStart(4, '0') ?? '0000')
    .join('');

  return `customer:u-${codePointKey || 'unnamed'}`;
}

function clampBytes(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(Math.round(value ?? 0), 0) : 0;
}

function addUnique(values: string[], value: string | undefined) {
  const normalized = value?.trim();

  if (normalized && !values.includes(normalized)) {
    values.push(normalized);
  }
}

function latestIso(left: string | undefined, right: string | undefined) {
  if (!right) return left;
  if (!left) return right;

  return right.localeCompare(left) > 0 ? right : left;
}

function earliestIso(left: string | undefined, right: string | undefined) {
  if (!right) return left;
  if (!left) return right;

  return right.localeCompare(left) < 0 ? right : left;
}

function readCustomerName(value: string | undefined, fallback?: string) {
  const normalized = value?.trim();
  const normalizedFallback = fallback?.trim();

  return normalized || normalizedFallback || undefined;
}

function createMutableCustomer(name: string): MutableCustomerReadModel {
  return {
    id: createCustomerId(name),
    name,
    status: 'active',
    sourceKinds: [],
    sourceKindSet: new Set(),
    customerNodeCount: 0,
    subscriptionClientCount: 0,
    forwardRuleCount: 0,
    agentIds: [],
    customerNodeIds: [],
    subscriptionClientIds: [],
    forwardRuleIds: [],
    customerNodeUsedTrafficBytes: 0,
    customerNodeTrafficLimitBytes: 0,
    subscriptionUsedTrafficBytes: 0,
    subscriptionTrafficLimitBytes: 0,
    forwardingUsedTrafficBytes: 0,
    forwardingTrafficLimitBytes: 0,
    usedTrafficBytes: 0,
    trafficLimitBytes: 0,
    quotaExceeded: false,
    runtimeDisabledByPolicy: false
  };
}

function getCustomer(customers: Map<string, MutableCustomerReadModel>, name: string) {
  const id = createCustomerId(name);
  const existing = customers.get(id);

  if (existing) {
    return existing;
  }

  const customer = createMutableCustomer(name);
  customers.set(id, customer);
  return customer;
}

function markSource(customer: MutableCustomerReadModel, sourceKind: CustomerReadModel['sourceKinds'][number]) {
  customer.sourceKindSet.add(sourceKind);
}

function applyCustomerStatus(customer: MutableCustomerReadModel, nowIso: string) {
  const expiresAtMs = Date.parse(customer.expiresAt ?? '');
  const nowMs = Date.parse(nowIso);
  const expired =
    Number.isFinite(expiresAtMs) && Number.isFinite(nowMs)
      ? expiresAtMs <= nowMs
      : Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();

  customer.status = expired ? 'expired' : customer.quotaExceeded || customer.runtimeDisabledByPolicy ? 'limited' : 'active';
}

function finalizeCustomer(customer: MutableCustomerReadModel, nowIso: string): CustomerReadModel {
  customer.sourceKinds = [...customer.sourceKindSet].sort((left, right) => left.localeCompare(right));
  customer.agentIds.sort((left, right) => left.localeCompare(right));
  customer.customerNodeIds.sort((left, right) => left.localeCompare(right));
  customer.subscriptionClientIds.sort((left, right) => left.localeCompare(right));
  customer.forwardRuleIds.sort((left, right) => left.localeCompare(right));
  customer.usedTrafficBytes =
    Math.max(customer.customerNodeUsedTrafficBytes, customer.subscriptionUsedTrafficBytes) + customer.forwardingUsedTrafficBytes;
  customer.trafficLimitBytes =
    Math.max(customer.customerNodeTrafficLimitBytes, customer.subscriptionTrafficLimitBytes) + customer.forwardingTrafficLimitBytes;
  applyCustomerStatus(customer, nowIso);

  const readModel = { ...customer };
  delete (readModel as Partial<MutableCustomerReadModel>).sourceKindSet;
  return readModel;
}

export function createCustomersFromReadModels({
  inbounds = [],
  subscriptionClients = [],
  forwardRules = [],
  nowIso = new Date().toISOString()
}: {
  inbounds?: XrayInbound[];
  subscriptionClients?: SubscriptionClientIdentity[];
  forwardRules?: ForwardRule[];
  nowIso?: string;
}): CustomerReadModel[] {
  const customers = new Map<string, MutableCustomerReadModel>();

  for (const inbound of inbounds) {
    const firstClient = inbound.clients[0];
    const customerName = readCustomerName(inbound.customerName, firstClient?.email);

    if (!customerName) {
      continue;
    }

    const customer = getCustomer(customers, customerName);
    markSource(customer, 'customer-node');
    customer.customerNodeCount += 1;
    addUnique(customer.customerNodeIds, inbound.id);
    addUnique(customer.agentIds, inbound.agentId);

    for (const client of inbound.clients) {
      customer.customerNodeUsedTrafficBytes += clampBytes(client.usedTrafficBytes);
      customer.customerNodeTrafficLimitBytes += clampBytes(client.trafficLimitBytes);
      customer.expiresAt = earliestIso(customer.expiresAt, client.expiresAt);
      customer.lastActivityAt = latestIso(customer.lastActivityAt, client.lastTrafficSampleAt);
      customer.quotaExceeded = customer.quotaExceeded || client.quotaExceeded === true;
      customer.runtimeDisabledByPolicy = customer.runtimeDisabledByPolicy || client.runtimeDisabledByPolicy === true;
    }
  }

  for (const client of subscriptionClients) {
    const customerName = readCustomerName(client.customerName, client.email);

    if (!customerName) {
      continue;
    }

    const customer = getCustomer(customers, customerName);
    markSource(customer, 'subscription');
    customer.subscriptionClientCount += 1;
    addUnique(customer.subscriptionClientIds, client.id);
    customer.subscriptionUsedTrafficBytes += clampBytes(client.usedTrafficBytes);
    customer.subscriptionTrafficLimitBytes += clampBytes(client.trafficLimitBytes);
    customer.expiresAt = earliestIso(customer.expiresAt, client.expiresAt);
    customer.lastActivityAt = latestIso(customer.lastActivityAt, client.lastGeneratedAt ?? client.lastOnlineAt);
    customer.quotaExceeded = customer.quotaExceeded || client.quotaExceeded === true;
    customer.runtimeDisabledByPolicy = customer.runtimeDisabledByPolicy || client.runtimeDisabledByPolicy === true;
  }

  for (const rule of forwardRules) {
    const customerName = readCustomerName(rule.ownerName);

    if (!customerName) {
      continue;
    }

    const customer = getCustomer(customers, customerName);
    markSource(customer, 'forwarding');
    customer.forwardRuleCount += 1;
    addUnique(customer.forwardRuleIds, rule.id);
    for (const binding of rule.ports) {
      addUnique(customer.agentIds, binding.agentId);
      customer.lastActivityAt = latestIso(customer.lastActivityAt, binding.lastCounterSampleAt);
    }
    customer.forwardingUsedTrafficBytes += calculateForwardingBilledBytes(rule);
    customer.forwardingTrafficLimitBytes += clampBytes(rule.quotaBytes);
    customer.quotaExceeded = customer.quotaExceeded || rule.quotaExceeded === true;
    customer.runtimeDisabledByPolicy = customer.runtimeDisabledByPolicy || rule.runtimeDisabledByPolicy === true;
  }

  return [...customers.values()]
    .map((customer) => finalizeCustomer(customer, nowIso))
    .sort((left, right) => left.name.localeCompare(right.name));
}
