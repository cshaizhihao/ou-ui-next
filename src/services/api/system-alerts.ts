import type { Agent, AgentRuntimeServiceHealth, SystemAlert, SystemAlertSeverity } from '../../domain';

function readNumber(value: number | undefined, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function resolveSamplingGapSeverity(agent: Agent): SystemAlertSeverity {
  const gapSeconds = readNumber(agent.telemetry.sampleGapSeconds);
  const expectedSeconds = readNumber(
    agent.telemetry.expectedSamplingIntervalSeconds,
    agent.probeConfig.pingIntervalSeconds
  );

  if (agent.status === 'offline' || gapSeconds >= Math.max(expectedSeconds * 10, 300)) {
    return 'critical';
  }

  return 'warning';
}

function resolveObservedAt(agent: Agent) {
  return agent.telemetry.reportedAt ?? agent.telemetry.samplingExpectedSince ?? agent.lastHeartbeatAt;
}

function createSamplingGapAlert(agent: Agent): SystemAlert | undefined {
  if (!agent.telemetry.sampleGapDetected) {
    return undefined;
  }

  const gapSeconds = readNumber(agent.telemetry.sampleGapSeconds);
  const expectedSeconds = readNumber(
    agent.telemetry.expectedSamplingIntervalSeconds,
    agent.probeConfig.pingIntervalSeconds
  );

  return {
    id: `alert-agent-telemetry-sampling-gap-${agent.id}`,
    kind: 'agent.telemetry_sampling_gap',
    severity: resolveSamplingGapSeverity(agent),
    status: 'active',
    title: 'Agent telemetry sampling gap',
    message: `Agent ${agent.name} has not produced telemetry on the expected sampling cadence.`,
    resourceType: 'agent',
    resourceId: agent.id,
    resourceLabel: agent.name,
    observedAt: resolveObservedAt(agent),
    dedupeKey: `agent:${agent.id}:telemetry_sampling_gap`,
    metadata: {
      agentStatus: agent.status,
      sampleGapSeconds: gapSeconds,
      expectedSamplingIntervalSeconds: expectedSeconds,
      sampleGapReason: agent.telemetry.sampleGapReason,
      lastTelemetryAt: agent.telemetry.reportedAt,
      lastHeartbeatAt: agent.lastHeartbeatAt
    }
  };
}

function resolveRuntimeServiceSeverity(service: AgentRuntimeServiceHealth): SystemAlertSeverity {
  return service.status === 'failed' || service.status === 'missing' ? 'critical' : 'warning';
}

function sanitizeAlertIdPart(value: string) {
  return value.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'runtime-service';
}

function createRuntimeServiceAlerts(agent: Agent): SystemAlert[] {
  return (agent.telemetry.runtimeServices ?? [])
    .filter((service) => service.required && service.status !== 'active')
    .map((service) => ({
      id: `alert-agent-runtime-service-${agent.id}-${sanitizeAlertIdPart(service.name)}`,
      kind: 'agent.runtime_service_unhealthy',
      severity: resolveRuntimeServiceSeverity(service),
      status: 'active',
      title: 'Agent runtime service unhealthy',
      message: `Agent ${agent.name} reports required runtime service ${service.name} is ${service.status}.`,
      resourceType: 'agent',
      resourceId: agent.id,
      resourceLabel: agent.name,
      observedAt: service.checkedAt || resolveObservedAt(agent),
      dedupeKey: `agent:${agent.id}:runtime_service:${service.name}`,
      metadata: {
        agentStatus: agent.status,
        serviceName: service.name,
        serviceModuleKind: service.moduleKind,
        serviceStatus: service.status,
        serviceEnabled: service.enabled,
        serviceRequired: service.required,
        serviceCheckedAt: service.checkedAt,
        serviceDetail: service.detail,
        lastTelemetryAt: agent.telemetry.reportedAt,
        lastHeartbeatAt: agent.lastHeartbeatAt
      }
    }));
}

export function createSystemAlertsFromAgents(agents: Agent[]): SystemAlert[] {
  return agents.flatMap((agent) => {
    const samplingGapAlert = createSamplingGapAlert(agent);
    return [
      ...(samplingGapAlert ? [samplingGapAlert] : []),
      ...createRuntimeServiceAlerts(agent)
    ];
  });
}
