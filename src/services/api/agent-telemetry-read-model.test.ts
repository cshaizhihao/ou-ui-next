import type { Agent } from '../../domain';
import { applyAgentEventToReadModel } from './agent-telemetry-read-model';
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
      monthlyTrafficUsedBytes: 350
    });
  });
});
