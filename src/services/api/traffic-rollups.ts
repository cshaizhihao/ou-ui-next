import {
  calculateTrafficRollupMeteredBytes,
  resolveMonthlyBillingPeriod,
  type TrafficRollup,
  type TrafficRollupAccountingMode
} from '../../domain';
import type { AgentEventEnvelope } from './api-contract';

type TelemetryPayload = Extract<AgentEventEnvelope, { type: 'telemetry_sample' }>['payload'];

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined;
}

function readBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function readAccountingMode(value: unknown): TrafficRollupAccountingMode {
  return value === 'single' || value === 'ingress' || value === 'egress' ? value : 'both';
}

function readResetDay(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) ? Math.max(1, Math.min(31, value)) : 1;
}

function compactMetadata(input: Record<string, string | number | boolean | undefined>) {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
  );
}

function resolvePeriodKey(input: {
  explicitPeriod?: string;
  sampledAt: string;
  observedAt: string;
  monthlyResetDay: number;
}) {
  if (input.explicitPeriod) {
    return input.explicitPeriod;
  }

  return (
    resolveMonthlyBillingPeriod(input.monthlyResetDay, input.sampledAt)?.key
    ?? resolveMonthlyBillingPeriod(input.monthlyResetDay, input.observedAt)?.key
    ?? 'unknown'
  );
}

function hasHostTraffic(payload: TelemetryPayload) {
  return [
    payload.monthlyIngressBytes,
    payload.monthlyEgressBytes,
    payload.monthlyTrafficUsedBytes,
    payload.rxBytes,
    payload.txBytes,
    payload.uploadTotalBytes,
    payload.downloadTotalBytes
  ].some((value) => readNumber(value) !== undefined);
}

function createHostRollup(event: Extract<AgentEventEnvelope, { type: 'telemetry_sample' }>): TrafficRollup[] {
  if (!hasHostTraffic(event.payload)) {
    return [];
  }

  const monthlyResetDay = readResetDay(event.payload.monthlyResetDay);
  const accountingMode = readAccountingMode(event.payload.trafficAccountingMode);
  const sampledAt = readString(event.payload.reportedAt) ?? event.observedAt;
  const ingressBytes = readNumber(event.payload.monthlyIngressBytes ?? event.payload.rxBytes) ?? 0;
  const egressBytes = readNumber(event.payload.monthlyEgressBytes ?? event.payload.txBytes) ?? 0;
  const meteredBytes =
    readNumber(event.payload.monthlyTrafficUsedBytes)
    ?? calculateTrafficRollupMeteredBytes(accountingMode, ingressBytes, egressBytes);

  return [
    {
      id: `traffic-${event.eventId}-agent`,
      dimension: 'agent',
      subjectId: event.agentId,
      subjectLabel: event.agentId,
      agentId: event.agentId,
      observedAt: event.observedAt,
      sampledAt,
      periodKey: resolvePeriodKey({
        explicitPeriod: event.payload.trafficBillingPeriod,
        sampledAt,
        observedAt: event.observedAt,
        monthlyResetDay
      }),
      monthlyResetDay,
      accountingMode,
      ingressBytes,
      egressBytes,
      meteredBytes,
      source: 'agent-telemetry',
      metadata: compactMetadata({
        quotaExceeded: readBoolean(event.payload.quotaExceeded),
        runtimeDisabledByPolicy: readBoolean(event.payload.runtimeDisabledByPolicy),
        guardrailReason: readString(event.payload.guardrailReason),
        trafficTelemetrySource: readString(event.payload.trafficTelemetrySource)
      })
    }
  ];
}

function createForwardingRollups(event: Extract<AgentEventEnvelope, { type: 'telemetry_sample' }>): TrafficRollup[] {
  const counters = Array.isArray(event.payload.forwardingCounters) ? event.payload.forwardingCounters : [];

  return counters.flatMap((counter, index) => {
    const ruleId = readString(counter.ruleId);
    const serviceName = readString(counter.serviceName);
    const subjectId = ruleId ?? serviceName;

    if (!subjectId) {
      return [];
    }

    const sampledAt = readString(counter.sampledAt) ?? event.observedAt;
    const ingressBytes = readNumber(counter.inboundBytes) ?? 0;
    const egressBytes = readNumber(counter.outboundBytes) ?? 0;
    const monthlyResetDay = readResetDay(event.payload.monthlyResetDay);

    return [
      {
        id: `traffic-${event.eventId}-forward-${index + 1}`,
        dimension: 'forward-rule',
        subjectId,
        subjectLabel: ruleId ?? serviceName ?? subjectId,
        agentId: readString(counter.agentId) ?? event.agentId,
        observedAt: event.observedAt,
        sampledAt,
        periodKey: resolvePeriodKey({
          explicitPeriod: readString(counter.trafficBillingPeriod),
          sampledAt,
          observedAt: event.observedAt,
          monthlyResetDay
        }),
        monthlyResetDay,
        accountingMode: 'both',
        ingressBytes,
        egressBytes,
        meteredBytes: calculateTrafficRollupMeteredBytes('both', ingressBytes, egressBytes),
        source: 'agent-telemetry',
        metadata: compactMetadata({
          ruleId,
          serviceName,
          listenPort: readNumber(counter.listenPort),
          targetPort: readNumber(counter.targetPort),
          protocol: readString(counter.protocol),
          counterSource: readString(counter.source)
        })
      }
    ];
  });
}

function createXrayClientRollups(event: Extract<AgentEventEnvelope, { type: 'telemetry_sample' }>): TrafficRollup[] {
  const counters = Array.isArray(event.payload.xrayClientCounters) ? event.payload.xrayClientCounters : [];

  return counters.flatMap((counter, index) => {
    const inboundId = readString(counter.inboundId);
    const inboundTag = readString(counter.inboundTag);
    const clientEmail = readString(counter.clientEmail);
    const clientId = readString(counter.clientId);
    const inboundSubject = inboundId ?? inboundTag;
    const clientSubject = clientEmail ?? clientId;

    if (!inboundSubject || !clientSubject) {
      return [];
    }

    const sampledAt = readString(counter.sampledAt) ?? event.observedAt;
    const monthlyResetDay = readResetDay(counter.monthlyResetDay ?? event.payload.monthlyResetDay);
    const ingressBytes = readNumber(counter.uplinkBytes) ?? 0;
    const egressBytes = readNumber(counter.downlinkBytes) ?? 0;
    const meteredBytes =
      readNumber(counter.usedTrafficBytes)
      ?? calculateTrafficRollupMeteredBytes('both', ingressBytes, egressBytes);

    return [
      {
        id: `traffic-${event.eventId}-xray-${index + 1}`,
        dimension: 'xray-client',
        subjectId: `${inboundSubject}:${clientSubject}`,
        subjectLabel: clientEmail ?? clientId ?? clientSubject,
        agentId: readString(counter.agentId) ?? event.agentId,
        observedAt: event.observedAt,
        sampledAt,
        periodKey: resolvePeriodKey({
          explicitPeriod: readString(counter.trafficBillingPeriod),
          sampledAt,
          observedAt: event.observedAt,
          monthlyResetDay
        }),
        monthlyResetDay,
        accountingMode: 'both',
        ingressBytes,
        egressBytes,
        meteredBytes,
        source: 'agent-telemetry',
        metadata: compactMetadata({
          inboundId,
          inboundTag,
          clientEmail,
          clientId,
          trafficLimitBytes: readNumber(counter.trafficLimitBytes),
          quotaExceeded: readBoolean(counter.quotaExceeded),
          clientExpired: readBoolean(counter.clientExpired),
          runtimeDisabledByPolicy: readBoolean(counter.runtimeDisabledByPolicy),
          guardrailReason: readString(counter.guardrailReason),
          counterSource: readString(counter.source)
        })
      }
    ];
  });
}

export function createTrafficRollupsFromAgentTelemetry(event: AgentEventEnvelope): TrafficRollup[] {
  if (event.type !== 'telemetry_sample') {
    return [];
  }

  return [...createHostRollup(event), ...createForwardingRollups(event), ...createXrayClientRollups(event)];
}
