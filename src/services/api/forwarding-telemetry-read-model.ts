import {
  calculateForwardingBilledBytes,
  isForwardingQuotaExceeded,
  type ForwardPortBinding,
  type ForwardProtocol,
  type ForwardRule
} from '../../domain/forwarding';
import type { AgentEventEnvelope } from './api-contract';

type ForwardingCounterSource = NonNullable<ForwardPortBinding['counterSource']>;

type ForwardingCounterSample = {
  ruleId?: string;
  agentId?: string;
  serviceName?: string;
  listenAddress?: string;
  listenPort?: number;
  targetAddress?: string;
  targetPort?: number;
  protocol?: ForwardProtocol;
  inboundBytes: number;
  outboundBytes: number;
  sampledAt?: string;
  source: ForwardingCounterSource;
};

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined;
}

function readProtocol(value: unknown): ForwardProtocol | undefined {
  return value === 'tcp' || value === 'udp' || value === 'tcp+udp' ? value : undefined;
}

function readSource(value: unknown): ForwardingCounterSource {
  return value === 'gost' || value === 'agent' ? value : 'nftables';
}

function readForwardingCounters(event: AgentEventEnvelope): ForwardingCounterSample[] {
  if (event.type !== 'telemetry_sample') {
    return [];
  }

  const payload = event.payload as Record<string, unknown>;
  const counters = Array.isArray(payload.forwardingCounters) ? payload.forwardingCounters : [];

  return counters.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const counter = item as Record<string, unknown>;
    const inboundBytes = readNumber(counter.inboundBytes ?? counter.rxBytes);
    const outboundBytes = readNumber(counter.outboundBytes ?? counter.txBytes);
    const ruleId = readString(counter.ruleId);
    const serviceName = readString(counter.serviceName);
    const agentId = readString(counter.agentId) ?? event.agentId;

    if (!ruleId && !serviceName) {
      return [];
    }

    return [
      {
        ruleId,
        agentId,
        serviceName,
        listenAddress: readString(counter.listenAddress),
        listenPort: readNumber(counter.listenPort),
        targetAddress: readString(counter.targetAddress),
        targetPort: readNumber(counter.targetPort),
        protocol: readProtocol(counter.protocol),
        inboundBytes: inboundBytes ?? 0,
        outboundBytes: outboundBytes ?? 0,
        sampledAt: readString(counter.sampledAt) ?? event.observedAt,
        source: readSource(counter.source)
      }
    ];
  });
}

function matchesBinding(rule: ForwardRule, binding: ForwardPortBinding, counter: ForwardingCounterSample) {
  if (counter.serviceName && binding.runtimeServiceNames?.includes(counter.serviceName)) {
    return true;
  }

  if (counter.ruleId !== rule.id) {
    return false;
  }

  if (counter.agentId && counter.agentId !== binding.agentId) {
    return false;
  }

  if (counter.listenPort !== undefined && counter.listenPort !== binding.listenPort) {
    return false;
  }

  if (counter.targetPort !== undefined && counter.targetPort !== binding.targetPort) {
    return false;
  }

  if (counter.protocol && binding.protocol !== 'tcp+udp' && counter.protocol !== binding.protocol) {
    return false;
  }

  return true;
}

function latestSampleAt(current: string | undefined, next: string | undefined) {
  if (!next) {
    return current;
  }

  if (!current) {
    return next;
  }

  return Date.parse(next) >= Date.parse(current) ? next : current;
}

function mergeBindingCounters(binding: ForwardPortBinding, counters: ForwardingCounterSample[]) {
  if (counters.length === 0) {
    return binding;
  }

  return {
    ...binding,
    inboundBytes: counters.reduce((sum, counter) => sum + counter.inboundBytes, 0),
    outboundBytes: counters.reduce((sum, counter) => sum + counter.outboundBytes, 0),
    lastCounterSampleAt: counters.reduce(
      (sampledAt, counter) => latestSampleAt(sampledAt, counter.sampledAt),
      binding.lastCounterSampleAt
    ),
    counterSource: counters[counters.length - 1]?.source ?? binding.counterSource
  };
}

function sumBindingBytes(ports: ForwardPortBinding[], key: 'inboundBytes' | 'outboundBytes', fallback: number) {
  const hasCounters = ports.some((binding) => typeof binding[key] === 'number');

  if (!hasCounters) {
    return fallback;
  }

  return ports.reduce((sum, binding) => sum + (binding[key] ?? 0), 0);
}

export function applyForwardingTelemetryToReadModel(
  forwardRules: ForwardRule[],
  event: AgentEventEnvelope
): ForwardRule[] {
  const counters = readForwardingCounters(event);

  if (counters.length === 0) {
    return forwardRules;
  }

  return forwardRules.map((rule) => {
    const ports = rule.ports.map((binding) =>
      mergeBindingCounters(
        binding,
        counters.filter((counter) => matchesBinding(rule, binding, counter))
      )
    );

    const nextRule = {
      ...rule,
      ports,
      inboundBytes: sumBindingBytes(ports, 'inboundBytes', rule.inboundBytes),
      outboundBytes: sumBindingBytes(ports, 'outboundBytes', rule.outboundBytes)
    };

    return {
      ...nextRule,
      billedTrafficBytes: calculateForwardingBilledBytes(nextRule),
      quotaExceeded: isForwardingQuotaExceeded(nextRule)
    };
  });
}
