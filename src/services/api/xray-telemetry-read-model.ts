import type { XrayClient, XrayInbound } from '../../domain';
import { isSampleInMonthlyBillingPeriod, resolveMonthlyBillingPeriod } from '../../domain/billing-period';
import type { AgentEventEnvelope } from './api-contract';

type XrayClientCounterSample = {
  inboundId?: string;
  inboundTag?: string;
  agentId?: string;
  clientEmail?: string;
  clientId?: string;
  uplinkBytes: number;
  downlinkBytes: number;
  usedTrafficBytes?: number;
  trafficLimitBytes?: number;
  monthlyResetDay?: number;
  quotaExceeded?: boolean;
  clientExpired?: boolean;
  runtimeDisabledByPolicy?: boolean;
  guardrailReason?: string;
  sampledAt?: string;
  trafficBillingPeriod?: string;
  source?: string;
};

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined;
}

function readResetDay(value: unknown, fallback: number) {
  const resetDay = readNumber(value) ?? fallback;
  return Math.max(1, Math.min(31, resetDay));
}

function readXrayClientCounters(event: AgentEventEnvelope): XrayClientCounterSample[] {
  if (event.type !== 'telemetry_sample') {
    return [];
  }

  const payload = event.payload as Record<string, unknown>;
  const counters = Array.isArray(payload.xrayClientCounters) ? payload.xrayClientCounters : [];

  return counters.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const counter = item as Record<string, unknown>;
    const inboundId = readString(counter.inboundId);
    const inboundTag = readString(counter.inboundTag);
    const clientEmail = readString(counter.clientEmail);
    const clientId = readString(counter.clientId);

    if ((!inboundId && !inboundTag) || (!clientEmail && !clientId)) {
      return [];
    }

    return [
      {
        inboundId,
        inboundTag,
        agentId: readString(counter.agentId) ?? event.agentId,
        clientEmail,
        clientId,
        uplinkBytes: readNumber(counter.uplinkBytes) ?? 0,
        downlinkBytes: readNumber(counter.downlinkBytes) ?? 0,
        usedTrafficBytes: readNumber(counter.usedTrafficBytes),
        trafficLimitBytes: readNumber(counter.trafficLimitBytes),
        monthlyResetDay: readNumber(counter.monthlyResetDay),
        quotaExceeded: typeof counter.quotaExceeded === 'boolean' ? counter.quotaExceeded : undefined,
        clientExpired: typeof counter.clientExpired === 'boolean' ? counter.clientExpired : undefined,
        runtimeDisabledByPolicy:
          typeof counter.runtimeDisabledByPolicy === 'boolean' ? counter.runtimeDisabledByPolicy : undefined,
        guardrailReason: readString(counter.guardrailReason),
        sampledAt: readString(counter.sampledAt) ?? event.observedAt,
        trafficBillingPeriod: readString(counter.trafficBillingPeriod),
        source: readString(counter.source)
      }
    ];
  });
}

function inboundTag(inbound: XrayInbound) {
  return `ou-${inbound.id}`;
}

function matchesInbound(inbound: XrayInbound, counter: XrayClientCounterSample) {
  if (counter.agentId && inbound.agentId && counter.agentId !== inbound.agentId) {
    return false;
  }

  return counter.inboundId === inbound.id || counter.inboundTag === inboundTag(inbound);
}

function matchesClient(client: XrayClient, counter: XrayClientCounterSample) {
  return counter.clientEmail === client.email || counter.clientId === client.id;
}

function isCounterCurrent(client: XrayClient, counter: XrayClientCounterSample, currentAt: string) {
  return isSampleInMonthlyBillingPeriod({
    resetDay: counter.monthlyResetDay ?? client.monthlyResetDay ?? 1,
    sampledAt: counter.sampledAt,
    currentAt,
    trafficBillingPeriod: counter.trafficBillingPeriod
  });
}

function resolveEnabledAfterRuntimePolicy(client: XrayClient, runtimeDisabledByPolicy: boolean) {
  if (runtimeDisabledByPolicy) {
    return false;
  }

  return client.runtimeDisabledByPolicy ? true : client.enabled;
}

function isGuardrailOnlyCounter(counter: XrayClientCounterSample) {
  return counter.source === 'xray-guardrail' && counter.usedTrafficBytes === undefined;
}

function resetClientForBillingWindow(client: XrayClient, nowIso: string): XrayClient {
  const resetDay = client.monthlyResetDay ?? 1;
  const currentPeriod = resolveMonthlyBillingPeriod(resetDay, nowIso);

  if (!currentPeriod) {
    return client;
  }

  const manualUsedTrafficBytes = client.manualUsedTrafficBytes ?? 0;
  const isCurrent = client.trafficBillingPeriod
    ? client.trafficBillingPeriod === currentPeriod.key
    : client.lastTrafficSampleAt
      ? resolveMonthlyBillingPeriod(resetDay, client.lastTrafficSampleAt)?.key === currentPeriod.key
      : true;

  if (isCurrent) {
    return {
      ...client,
      trafficBillingPeriod: client.trafficBillingPeriod ?? currentPeriod.key
    };
  }

  const quotaExceeded = client.trafficLimitBytes > 0 && manualUsedTrafficBytes >= client.trafficLimitBytes;
  const clientExpired = client.clientExpired ?? false;
  const runtimeDisabledByPolicy = quotaExceeded || clientExpired;
  return {
    ...client,
    enabled: resolveEnabledAfterRuntimePolicy(client, runtimeDisabledByPolicy),
    usedTrafficBytes: manualUsedTrafficBytes,
    uplinkBytes: 0,
    downlinkBytes: 0,
    quotaExceeded,
    clientExpired,
    runtimeDisabledByPolicy,
    guardrailReason: quotaExceeded
      ? 'xray_client_monthly_quota_exceeded'
      : clientExpired
        ? client.guardrailReason ?? 'xray_client_expired'
        : 'ok',
    trafficBillingPeriod: currentPeriod.key
  };
}

export function applyXrayTrafficWindowToReadModel(inbounds: XrayInbound[], nowIso: string): XrayInbound[] {
  return inbounds.map((inbound) => ({
    ...inbound,
    clients: inbound.clients.map((client) => resetClientForBillingWindow(client, nowIso))
  }));
}

export function applyXrayTelemetryToReadModel(inbounds: XrayInbound[], event: AgentEventEnvelope): XrayInbound[] {
  const counters = readXrayClientCounters(event);

  if (counters.length === 0) {
    return inbounds;
  }

  return applyXrayTrafficWindowToReadModel(inbounds, event.observedAt).map((inbound) => ({
    ...inbound,
    clients: inbound.clients.map((client) => {
      const counter = counters.find(
        (item) => matchesInbound(inbound, item) && matchesClient(client, item) && isCounterCurrent(client, item, event.observedAt)
      );

      if (!counter) {
        return client;
      }

      const monthlyResetDay = readResetDay(counter.monthlyResetDay, client.monthlyResetDay ?? 1);
      const manualUsedTrafficBytes = client.manualUsedTrafficBytes ?? 0;
      const guardrailOnlyCounter = isGuardrailOnlyCounter(counter);
      const usedTrafficBytes =
        guardrailOnlyCounter
          ? client.usedTrafficBytes
          : counter.usedTrafficBytes ?? manualUsedTrafficBytes + counter.uplinkBytes + counter.downlinkBytes;
      const trafficLimitBytes = counter.trafficLimitBytes ?? client.trafficLimitBytes;
      const quotaExceeded = counter.quotaExceeded ?? (trafficLimitBytes > 0 && usedTrafficBytes >= trafficLimitBytes);
      const clientExpired = counter.clientExpired ?? false;
      const runtimeDisabledByPolicy = counter.runtimeDisabledByPolicy ?? (quotaExceeded || clientExpired);
      const currentPeriod = resolveMonthlyBillingPeriod(monthlyResetDay, event.observedAt);

      return {
        ...client,
        enabled: resolveEnabledAfterRuntimePolicy(client, runtimeDisabledByPolicy),
        monthlyResetDay,
        trafficLimitBytes,
        usedTrafficBytes,
        uplinkBytes: guardrailOnlyCounter ? client.uplinkBytes : counter.uplinkBytes,
        downlinkBytes: guardrailOnlyCounter ? client.downlinkBytes : counter.downlinkBytes,
        lastTrafficSampleAt: guardrailOnlyCounter ? client.lastTrafficSampleAt : counter.sampledAt,
        trafficBillingPeriod: counter.trafficBillingPeriod ?? currentPeriod?.key,
        quotaExceeded,
        clientExpired,
        runtimeDisabledByPolicy,
        guardrailReason:
          counter.guardrailReason
          ?? (quotaExceeded
            ? 'xray_client_monthly_quota_exceeded'
            : clientExpired
              ? 'xray_client_expired'
              : 'ok')
      };
    })
  }));
}
