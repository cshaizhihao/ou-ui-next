import type { ForwardRule } from '../../domain';
import { applyForwardingTelemetryToReadModel } from './forwarding-telemetry-read-model';
import type { AgentEventEnvelope } from './api-contract';

function createForwardRule(): ForwardRule {
  return {
    id: 'forward-custom-2443',
    tunnelId: 'tunnel-custom',
    name: 'Customer HTTPS Forward',
    ownerName: 'Acme Team',
    strategy: 'round-robin',
    enabled: true,
    ports: [
      {
        agentId: 'agent-edge-01',
        listenAddress: '0.0.0.0',
        listenPort: 2443,
        targetAddress: '10.10.0.8',
        targetPort: 9443,
        protocol: 'tcp+udp',
        status: 'allocated',
        runtimeServiceNames: ['ou-forward-forward-custom-2443-agent-edge-01']
      },
      {
        agentId: 'agent-edge-02',
        listenAddress: '0.0.0.0',
        listenPort: 2443,
        targetAddress: '10.10.0.8',
        targetPort: 9443,
        protocol: 'tcp+udp',
        status: 'allocated',
        runtimeServiceNames: ['ou-forward-forward-custom-2443-agent-edge-02'],
        inboundBytes: 200,
        outboundBytes: 400
      }
    ],
    portStatus: 'allocated',
    billingDirection: 'both',
    trafficMultiplier: 1,
    monthlyResetDay: 1,
    manualUsedBytes: 0,
    quotaBytes: 10_000,
    quotaPolicyId: 'quota-custom',
    rateLimitPolicyId: 'rate-custom',
    maxConnections: 0,
    maxConnectionsPerIp: 0,
    proxyProtocol: false,
    tunnelMode: 'direct',
    pricePerGb: 0,
    inboundBytes: 200,
    outboundBytes: 400
  };
}

describe('forwarding telemetry read model', () => {
  it('merges rule-level Agent counters without erasing other host bindings', () => {
    const event: AgentEventEnvelope = {
      type: 'telemetry_sample',
      eventId: 'evt-forwarding-counters-1',
      agentId: 'agent-edge-01',
      seq: 1,
      sessionId: 'sess-agent-edge-01',
      observedAt: '2026-06-04T00:00:00.000Z',
      payload: {
        forwardingCounters: [
          {
            ruleId: 'forward-custom-2443',
            agentId: 'agent-edge-01',
            serviceName: 'ou-forward-forward-custom-2443-agent-edge-01',
            protocol: 'tcp+udp',
            inboundBytes: 1000,
            outboundBytes: 1500,
            sampledAt: '2026-06-04T00:00:00.000Z',
            source: 'nftables'
          }
        ]
      }
    };

    const [rule] = applyForwardingTelemetryToReadModel([createForwardRule()], event);

    expect(rule.inboundBytes).toBe(1200);
    expect(rule.outboundBytes).toBe(1900);
    expect(rule.ports[0]).toMatchObject({
      inboundBytes: 1000,
      outboundBytes: 1500,
      counterSource: 'nftables',
      lastCounterSampleAt: '2026-06-04T00:00:00.000Z'
    });
    expect(rule.ports[1]).toMatchObject({
      inboundBytes: 200,
      outboundBytes: 400
    });
  });
});
