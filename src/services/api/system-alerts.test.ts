import type { Agent } from '../../domain';
import { createSystemAlertsFromAgents } from './system-alerts';

function createAgent(overrides: Partial<Omit<Agent, 'telemetry'>> & { telemetry?: Partial<Agent['telemetry']> } = {}): Agent {
  const agent: Agent = {
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
    lastHeartbeatAt: '2026-06-04T04:05:00.000Z',
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
      onlineDays: 0,
      reportedAt: '2026-06-04T04:00:00.000Z',
      samplingExpectedSince: '2026-06-04T04:00:00.000Z',
      sampleGapDetected: true,
      sampleGapSeconds: 180,
      expectedSamplingIntervalSeconds: 30,
      sampleGapReason: 'stale_telemetry_sample'
    }
  };

  return {
    ...agent,
    ...overrides,
    telemetry: {
      ...agent.telemetry,
      ...overrides.telemetry
    }
  };
}

describe('system alerts', () => {
  it('creates operator-visible alerts from Agent telemetry sampling gaps', () => {
    const [alert] = createSystemAlertsFromAgents([createAgent()]);

    expect(alert).toMatchObject({
      id: 'alert-agent-telemetry-sampling-gap-agent-edge-01',
      kind: 'agent.telemetry_sampling_gap',
      severity: 'warning',
      status: 'active',
      resourceType: 'agent',
      resourceId: 'agent-edge-01',
      resourceLabel: 'Edge 01',
      observedAt: '2026-06-04T04:00:00.000Z',
      dedupeKey: 'agent:agent-edge-01:telemetry_sampling_gap',
      metadata: expect.objectContaining({
        sampleGapSeconds: 180,
        expectedSamplingIntervalSeconds: 30,
        sampleGapReason: 'stale_telemetry_sample'
      })
    });
  });

  it('promotes long sampling gaps or offline hosts to critical alerts', () => {
    expect(
      createSystemAlertsFromAgents([
        createAgent({
          status: 'offline',
          telemetry: {
            sampleGapSeconds: 120,
            sampleGapReason: 'no_telemetry_sample'
          }
        })
      ])
    ).toEqual([
      expect.objectContaining({
        severity: 'critical'
      })
    ]);

    expect(
      createSystemAlertsFromAgents([
        createAgent({
          telemetry: {
            sampleGapSeconds: 600
          }
        })
      ])
    ).toEqual([
      expect.objectContaining({
        severity: 'critical'
      })
    ]);
  });

  it('does not create alerts when the telemetry sampler is healthy', () => {
    expect(
      createSystemAlertsFromAgents([
        createAgent({
          telemetry: {
            sampleGapDetected: false,
            sampleGapSeconds: 0,
            sampleGapReason: undefined
          }
        })
      ])
    ).toEqual([]);
  });
});
