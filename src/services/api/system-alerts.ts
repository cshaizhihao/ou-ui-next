import type { Agent, SystemAlert, SystemAlertSeverity } from '../../domain';

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

export function createSystemAlertsFromAgents(agents: Agent[]): SystemAlert[] {
  return agents
    .filter((agent) => agent.telemetry.sampleGapDetected)
    .map((agent) => {
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
    });
}
