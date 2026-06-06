import type { Agent } from '../../domain';
import {
  applyAgentEventToReadModel,
  applyAgentLivenessToReadModel,
  applyAgentMonthlyTrafficWindowToReadModel,
  deriveAgentTelemetrySampleGap,
  deriveAgentLivenessStatus
} from './agent-telemetry-read-model';
import type { AgentEventEnvelope } from './api-contract';

function createAgent(): Agent {
  return {
    id: 'agent-edge-01',
    name: 'Edge 01',
    status: 'online',
    region: 'custom',
    publicAddress: '198.51.100.10',
    connectionMode: 'pull',
    version: '1.0.0-runtime',
    platform: 'linux/amd64',
    capabilities: ['host-agent', 'xray', 'port-forwarding'],
    maxTrafficBytes: 0,
    monthlyTrafficLimitBytes: 0,
    expiresAt: '',
    probeConfig: {
      pingTarget: '1.1.1.1',
      pingIntervalSeconds: 30,
      latencyGreenMaxMs: 100,
      latencyYellowMaxMs: 200
    },
    trafficPolicy: {
      accountingMode: 'both',
      monthlyResetDay: 1,
      manualUsedTrafficBytes: 0,
      telemetrySource: 'agent'
    },
    hardware: {},
    lastHeartbeatAt: '2026-06-03T00:00:00.000Z',
    telemetry: {
      cpuPercent: 0,
      memoryPercent: 0,
      memoryUsedBytes: 0,
      memoryTotalBytes: 0,
      diskUsedBytes: 0,
      diskTotalBytes: 0,
      txBytes: 0,
      rxBytes: 0,
      uploadSpeedBps: 0,
      downloadSpeedBps: 0,
      uploadTotalBytes: 0,
      downloadTotalBytes: 0,
      monthlyTrafficUsedBytes: 0,
      latencyMs: 0,
      latencySamplesMs: [],
      packetLossPercent: 0,
      packetLossSamplesPercent: [],
      onlineDays: 0
    }
  };
}

describe('agent telemetry read model', () => {
  it('uses Agent-reported accounting mode, reset day, manual traffic and monthly usage', () => {
    const event: AgentEventEnvelope = {
      type: 'telemetry_sample',
      eventId: 'evt-traffic-policy-agent-edge-01-1',
      agentId: 'agent-edge-01',
      seq: 1,
      sessionId: 'sess-agent-edge-01',
      observedAt: '2026-06-03T00:01:00.000Z',
      payload: {
        monthlyIngressBytes: 100,
        monthlyEgressBytes: 300,
        monthlyTrafficUsedBytes: 350,
        trafficAccountingMode: 'single',
        monthlyResetDay: 7,
        manualUsedTrafficBytes: 50,
        trafficTelemetrySource: 'agent'
      }
    };

    const [agent] = applyAgentEventToReadModel([createAgent()], event);

    expect(agent.trafficPolicy).toMatchObject({
      accountingMode: 'single',
      monthlyResetDay: 7,
      manualUsedTrafficBytes: 50,
      telemetrySource: 'agent'
    });
    expect(agent.telemetry).toMatchObject({
      monthlyIngressBytes: 100,
      monthlyEgressBytes: 300,
      monthlyTrafficUsedBytes: 350,
      trafficBillingPeriod: '2026-05-reset-07'
    });
  });

  it('derives monthly usage with the accounting mode reported in the same telemetry sample', () => {
    const event: AgentEventEnvelope = {
      type: 'telemetry_sample',
      eventId: 'evt-traffic-policy-agent-edge-01-2',
      agentId: 'agent-edge-01',
      seq: 2,
      sessionId: 'sess-agent-edge-01',
      observedAt: '2026-06-03T00:02:00.000Z',
      payload: {
        monthlyIngressBytes: 900,
        monthlyEgressBytes: 300,
        trafficAccountingMode: 'egress',
        monthlyResetDay: 31,
        trafficTelemetrySource: 'agent'
      }
    };

    const [agent] = applyAgentEventToReadModel([createAgent()], event);

    expect(agent.trafficPolicy).toMatchObject({
      accountingMode: 'egress',
      monthlyResetDay: 31
    });
    expect(agent.telemetry).toMatchObject({
      monthlyIngressBytes: 900,
      monthlyEgressBytes: 300,
      monthlyTrafficUsedBytes: 300,
      trafficBillingPeriod: '2026-05-reset-31'
    });
  });

  it('adds manual calibration when deriving monthly usage from Agent counters without an explicit total', () => {
    const event: AgentEventEnvelope = {
      type: 'telemetry_sample',
      eventId: 'evt-traffic-policy-agent-edge-01-manual-derived',
      agentId: 'agent-edge-01',
      seq: 3,
      sessionId: 'sess-agent-edge-01',
      observedAt: '2026-06-03T00:03:00.000Z',
      payload: {
        monthlyIngressBytes: 900,
        monthlyEgressBytes: 300,
        trafficAccountingMode: 'single',
        manualUsedTrafficBytes: 50,
        monthlyResetDay: 7,
        trafficTelemetrySource: 'agent'
      }
    };

    const [agent] = applyAgentEventToReadModel([createAgent()], event);

    expect(agent.trafficPolicy).toMatchObject({
      accountingMode: 'single',
      manualUsedTrafficBytes: 50
    });
    expect(agent.telemetry).toMatchObject({
      monthlyIngressBytes: 900,
      monthlyEgressBytes: 300,
      monthlyTrafficUsedBytes: 950,
      trafficBillingPeriod: '2026-05-reset-07'
    });
  });

  it('keeps known monthly counters when a compatibility sample only refreshes manual calibration', () => {
    const agentBeforeSample = {
      ...createAgent(),
      trafficPolicy: {
        ...createAgent().trafficPolicy,
        accountingMode: 'both' as const,
        monthlyResetDay: 7,
        manualUsedTrafficBytes: 20
      },
      telemetry: {
        ...createAgent().telemetry,
        monthlyIngressBytes: 1_200,
        monthlyEgressBytes: 300,
        monthlyTrafficUsedBytes: 1_520,
        trafficBillingPeriod: '2026-05-reset-07',
        reportedAt: '2026-06-03T00:03:00.000Z'
      }
    };
    const event: AgentEventEnvelope = {
      type: 'telemetry_sample',
      eventId: 'evt-traffic-policy-agent-edge-01-manual-refresh',
      agentId: 'agent-edge-01',
      seq: 4,
      sessionId: 'sess-agent-edge-01',
      observedAt: '2026-06-03T00:04:00.000Z',
      payload: {
        manualUsedTrafficBytes: 80,
        monthlyResetDay: 7,
        trafficTelemetrySource: 'agent'
      }
    };

    const [agent] = applyAgentEventToReadModel([agentBeforeSample], event);

    expect(agent.telemetry).toMatchObject({
      monthlyIngressBytes: 1_200,
      monthlyEgressBytes: 300,
      monthlyTrafficUsedBytes: 1_580,
      trafficBillingPeriod: '2026-05-reset-07'
    });
  });

  it('ignores monthly traffic samples from the previous billing period', () => {
    const previousPeriodAgent = {
      ...createAgent(),
      trafficPolicy: {
        ...createAgent().trafficPolicy,
        monthlyResetDay: 1
      },
      telemetry: {
        ...createAgent().telemetry,
        monthlyIngressBytes: 800,
        monthlyEgressBytes: 200,
        monthlyTrafficUsedBytes: 1000,
        monthlyTrafficLimitBytes: 900,
        quotaExceeded: true,
        runtimeDisabledByPolicy: true,
        guardrailReason: 'monthly_traffic_quota_exceeded',
        reportedAt: '2026-06-30T23:59:59.000Z',
        trafficBillingPeriod: '2026-06-reset-01'
      }
    };
    const event: AgentEventEnvelope = {
      type: 'telemetry_sample',
      eventId: 'evt-stale-monthly-agent-edge-01',
      agentId: 'agent-edge-01',
      seq: 6,
      sessionId: 'sess-agent-edge-01',
      observedAt: '2026-07-01T00:00:10.000Z',
      payload: {
        monthlyIngressBytes: 999,
        monthlyEgressBytes: 999,
        monthlyTrafficUsedBytes: 1998,
        monthlyTrafficLimitBytes: 900,
        monthlyResetDay: 1,
        trafficBillingPeriod: '2026-06-reset-01',
        reportedAt: '2026-06-30T23:59:59.000Z'
      }
    };

    const [agent] = applyAgentEventToReadModel([previousPeriodAgent], event);

    expect(agent.telemetry).toMatchObject({
      monthlyIngressBytes: 0,
      monthlyEgressBytes: 0,
      monthlyTrafficUsedBytes: 0,
      quotaExceeded: false,
      runtimeDisabledByPolicy: false,
      guardrailReason: 'ok',
      trafficBillingPeriod: '2026-07-reset-01'
    });
  });

  it('resets displayed monthly traffic when the read model enters a new billing period', () => {
    const [agent] = applyAgentMonthlyTrafficWindowToReadModel(
      [
        {
          ...createAgent(),
          trafficPolicy: {
            ...createAgent().trafficPolicy,
            monthlyResetDay: 1
          },
          telemetry: {
            ...createAgent().telemetry,
            txBytes: 10_000,
            rxBytes: 20_000,
            monthlyIngressBytes: 800,
            monthlyEgressBytes: 200,
            monthlyTrafficUsedBytes: 1000,
            reportedAt: '2026-06-30T23:59:59.000Z',
            trafficBillingPeriod: '2026-06-reset-01'
          }
        }
      ],
      '2026-07-01T00:00:00.000Z'
    );

    expect(agent.telemetry).toMatchObject({
      txBytes: 10_000,
      rxBytes: 20_000,
      monthlyIngressBytes: 0,
      monthlyEgressBytes: 0,
      monthlyTrafficUsedBytes: 0,
      trafficBillingPeriod: '2026-07-reset-01'
    });
  });

  it('keeps Agent-reported latency status for threshold-aware host cards', () => {
    const event: AgentEventEnvelope = {
      type: 'telemetry_sample',
      eventId: 'evt-latency-status-agent-edge-01',
      agentId: 'agent-edge-01',
      seq: 3,
      sessionId: 'sess-agent-edge-01',
      observedAt: '2026-06-03T00:03:00.000Z',
      payload: {
        latencyMs: 145,
        latencyStatus: 'yellow',
        latencySamplesMs: [88, 145]
      }
    };

    const [agent] = applyAgentEventToReadModel([createAgent()], event);

    expect(agent.telemetry).toMatchObject({
      latencyMs: 145,
      latencyStatus: 'yellow',
      latencySamplesMs: [88, 145]
    });
  });

  it.each([
    [42, 'green'],
    [145, 'yellow'],
    [236, 'red']
  ] as const)('derives %s ms latency as %s when Agent omits the status band', (latencyMs, latencyStatus) => {
    const event: AgentEventEnvelope = {
      type: 'telemetry_sample',
      eventId: `evt-latency-derived-${latencyStatus}`,
      agentId: 'agent-edge-01',
      seq: latencyMs,
      sessionId: 'sess-agent-edge-01',
      observedAt: '2026-06-03T00:04:00.000Z',
      payload: {
        latencyMs,
        latencySamplesMs: [latencyMs]
      }
    };

    const [agent] = applyAgentEventToReadModel([createAgent()], event);

    expect(agent.telemetry).toMatchObject({
      latencyMs,
      latencyStatus,
      latencySamplesMs: [latencyMs]
    });
  });

  it('does not classify zero latency before a real probe sample exists', () => {
    const event: AgentEventEnvelope = {
      type: 'telemetry_sample',
      eventId: 'evt-latency-zero-agent-edge-01',
      agentId: 'agent-edge-01',
      seq: 4,
      sessionId: 'sess-agent-edge-01',
      observedAt: '2026-06-03T00:05:00.000Z',
      payload: {
        latencyMs: 0,
        latencySamplesMs: []
      }
    };

    const [agent] = applyAgentEventToReadModel([createAgent()], event);

    expect(agent.telemetry.latencyStatus).toBeUndefined();
  });

  it('projects Agent-reported load average and runtime service health', () => {
    const event: AgentEventEnvelope = {
      type: 'telemetry_sample',
      eventId: 'evt-runtime-service-health-agent-edge-01',
      agentId: 'agent-edge-01',
      seq: 7,
      sessionId: 'sess-agent-edge-01',
      observedAt: '2026-06-03T00:07:00.000Z',
      payload: {
        loadAverage1m: 0.42,
        loadAverage5m: 0.35,
        loadAverage15m: 0.31,
        runtimeServices: [
          {
            name: 'ou-ui-agent.service',
            moduleKind: 'agent',
            status: 'active',
            enabled: true,
            required: true,
            checkedAt: '2026-06-03T00:07:00.000Z'
          },
          {
            name: 'ou-ui-xray.service',
            moduleKind: 'xray',
            status: 'failed',
            enabled: true,
            required: true,
            checkedAt: '2026-06-03T00:07:00.000Z',
            detail: 'service failed'
          }
        ]
      }
    };

    const [agent] = applyAgentEventToReadModel([createAgent()], event);

    expect(agent.telemetry).toMatchObject({
      loadAverage1m: 0.42,
      loadAverage5m: 0.35,
      loadAverage15m: 0.31,
      runtimeServices: [
        expect.objectContaining({
          name: 'ou-ui-agent.service',
          moduleKind: 'agent',
          status: 'active',
          enabled: true,
          required: true
        }),
        expect.objectContaining({
          name: 'ou-ui-xray.service',
          moduleKind: 'xray',
          status: 'failed',
          detail: 'service failed'
        })
      ]
    });
  });

  it('stores Agent-enforced quota and expiry guardrail state', () => {
    const event: AgentEventEnvelope = {
      type: 'telemetry_sample',
      eventId: 'evt-host-guardrail-agent-edge-01',
      agentId: 'agent-edge-01',
      seq: 5,
      sessionId: 'sess-agent-edge-01',
      observedAt: '2026-06-03T00:06:00.000Z',
      payload: {
        monthlyTrafficLimitBytes: 100,
        monthlyTrafficUsedBytes: 128,
        quotaExceeded: true,
        hostExpired: false,
        runtimeDisabledByPolicy: true,
        guardrailReason: 'monthly_traffic_quota_exceeded',
        hostGuardrailStoppedUnits: ['ou-ui-xray.service'],
        hostGuardrailRestoredUnits: []
      }
    };

    const [agent] = applyAgentEventToReadModel([createAgent()], event);

    expect(agent.telemetry).toMatchObject({
      monthlyTrafficLimitBytes: 100,
      monthlyTrafficUsedBytes: 128,
      quotaExceeded: true,
      hostExpired: false,
      runtimeDisabledByPolicy: true,
      guardrailReason: 'monthly_traffic_quota_exceeded',
      hostGuardrailStoppedUnits: ['ou-ui-xray.service'],
      hostGuardrailRestoredUnits: []
    });
  });

  it('stores Agent host guardrail unit recovery evidence', () => {
    const event: AgentEventEnvelope = {
      type: 'telemetry_sample',
      eventId: 'evt-host-guardrail-recovered-agent-edge-01',
      agentId: 'agent-edge-01',
      seq: 6,
      sessionId: 'sess-agent-edge-01',
      observedAt: '2026-06-03T00:07:00.000Z',
      payload: {
        monthlyTrafficLimitBytes: 100,
        monthlyTrafficUsedBytes: 64,
        quotaExceeded: false,
        hostExpired: false,
        runtimeDisabledByPolicy: false,
        guardrailReason: 'ok',
        hostGuardrailStoppedUnits: [],
        hostGuardrailRestoredUnits: ['ou-ui-xray.service', 'ou-forward-forward-hkg-443-agent-edge-01-tcp.service']
      }
    };

    const [agent] = applyAgentEventToReadModel([createAgent()], event);

    expect(agent.telemetry).toMatchObject({
      runtimeDisabledByPolicy: false,
      guardrailReason: 'ok',
      hostGuardrailStoppedUnits: [],
      hostGuardrailRestoredUnits: ['ou-ui-xray.service', 'ou-forward-forward-hkg-443-agent-edge-01-tcp.service']
    });
  });

  it.each([
    ['2026-06-03T00:01:29.000Z', 'online'],
    ['2026-06-03T00:01:30.000Z', 'degraded'],
    ['2026-06-03T00:05:00.000Z', 'offline']
  ] as const)('derives host liveness at %s as %s after the last Agent signal', (nowIso, status) => {
    const baseAgent = createAgent();
    const agent = {
      ...baseAgent,
      lastHeartbeatAt: '2026-06-03T00:00:00.000Z',
      telemetry: {
        ...baseAgent.telemetry,
        reportedAt: '2026-06-03T00:00:00.000Z'
      }
    };

    expect(deriveAgentLivenessStatus(agent, nowIso)).toBe(status);
  });

  it('keeps newly registered hosts in provisioning until a real heartbeat or telemetry sample arrives', () => {
    expect(
      deriveAgentLivenessStatus(
        {
          ...createAgent(),
          status: 'provisioning'
        },
        '2026-06-03T01:00:00.000Z'
      )
    ).toBe('provisioning');
  });

  it('flags a telemetry sampling gap even when heartbeat keeps the host online', () => {
    const [agent] = applyAgentLivenessToReadModel(
      [
        {
          ...createAgent(),
          lastHeartbeatAt: '2026-06-03T00:05:00.000Z',
          telemetry: {
            ...createAgent().telemetry,
            reportedAt: '2026-06-03T00:00:00.000Z'
          }
        }
      ],
      '2026-06-03T00:05:00.000Z'
    );

    expect(agent.status).toBe('online');
    expect(agent.telemetry).toMatchObject({
      sampleGapDetected: true,
      sampleGapSeconds: 300,
      expectedSamplingIntervalSeconds: 30,
      sampleGapReason: 'stale_telemetry_sample'
    });
  });

  it('does not let heartbeat overwrite the last telemetry sample timestamp', () => {
    const event: AgentEventEnvelope = {
      type: 'heartbeat',
      eventId: 'evt-heartbeat-after-telemetry-agent-edge-01',
      agentId: 'agent-edge-01',
      seq: 7,
      sessionId: 'sess-agent-edge-01',
      observedAt: '2026-06-03T00:04:00.000Z',
      payload: {
        version: '1.0.0-runtime',
        uptimeSeconds: 7200,
        capabilities: ['host-agent', 'xray', 'port-forwarding']
      }
    };

    const [agent] = applyAgentEventToReadModel(
      [
        {
          ...createAgent(),
          telemetry: {
            ...createAgent().telemetry,
            reportedAt: '2026-06-03T00:00:00.000Z'
          }
        }
      ],
      event
    );

    expect(agent.lastHeartbeatAt).toBe('2026-06-03T00:04:00.000Z');
    expect(agent.telemetry).toMatchObject({
      reportedAt: '2026-06-03T00:00:00.000Z',
      sampleGapDetected: true,
      sampleGapSeconds: 240,
      sampleGapReason: 'stale_telemetry_sample'
    });
  });

  it('derives a no-sample gap for heartbeat-only hosts after the sampling window elapses', () => {
    expect(
      deriveAgentTelemetrySampleGap(
        {
          ...createAgent(),
          lastHeartbeatAt: '2026-06-03T00:01:30.000Z',
          telemetry: {
            ...createAgent().telemetry,
            reportedAt: undefined,
            samplingExpectedSince: '2026-06-03T00:00:00.000Z'
          }
        },
        '2026-06-03T00:01:30.000Z'
      )
    ).toMatchObject({
      sampleGapDetected: true,
      sampleGapSeconds: 90,
      expectedSamplingIntervalSeconds: 30,
      sampleGapReason: 'no_telemetry_sample'
    });
  });
});
