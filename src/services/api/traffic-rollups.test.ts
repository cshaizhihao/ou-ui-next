import { createTrafficRollupsFromAgentTelemetry } from './traffic-rollups';

describe('traffic rollups', () => {
  it('derives host, forwarding, and Xray client rollups from Agent telemetry samples', () => {
    expect(
      createTrafficRollupsFromAgentTelemetry({
        type: 'telemetry_sample',
        eventId: 'evt-traffic-rollup-001',
        agentId: 'agent-edge-01',
        seq: 11,
        sessionId: 'sess-agent-edge-01',
        observedAt: '2026-06-04T00:00:00.000Z',
        payload: {
          trafficAccountingMode: 'single',
          monthlyResetDay: 31,
          monthlyIngressBytes: 1024,
          monthlyEgressBytes: 4096,
          trafficBillingPeriod: '2026-06-reset-31',
          reportedAt: '2026-06-04T00:00:00.000Z',
          xrayClientCounters: [
            {
              inboundId: 'inbound-acme-vless',
              clientEmail: 'acme@example.com',
              uplinkBytes: 2048,
              downlinkBytes: 4096,
              usedTrafficBytes: 8192,
              monthlyResetDay: 15,
              sampledAt: '2026-06-04T00:00:01.000Z',
              trafficBillingPeriod: '2026-06-reset-15',
              source: 'xray-stats'
            }
          ],
          forwardingCounters: [
            {
              ruleId: 'forward-web-2443',
              serviceName: 'ou-forward-web-2443-agent-edge-01',
              inboundBytes: 512,
              outboundBytes: 1536,
              sampledAt: '2026-06-04T00:00:02.000Z',
              source: 'nftables',
              trafficBillingPeriod: '2026-06-reset-31'
            }
          ]
        }
      })
    ).toEqual([
      expect.objectContaining({
        id: 'traffic-evt-traffic-rollup-001-agent',
        dimension: 'agent',
        subjectId: 'agent-edge-01',
        periodKey: '2026-06-reset-31',
        accountingMode: 'single',
        ingressBytes: 1024,
        egressBytes: 4096,
        meteredBytes: 4096
      }),
      expect.objectContaining({
        id: 'traffic-evt-traffic-rollup-001-forward-1',
        dimension: 'forward-rule',
        subjectId: 'forward-web-2443',
        ingressBytes: 512,
        egressBytes: 1536,
        meteredBytes: 2048,
        metadata: expect.objectContaining({
          ruleId: 'forward-web-2443',
          counterSource: 'nftables'
        })
      }),
      expect.objectContaining({
        id: 'traffic-evt-traffic-rollup-001-xray-1',
        dimension: 'xray-client',
        subjectId: 'inbound-acme-vless:acme@example.com',
        periodKey: '2026-06-reset-15',
        ingressBytes: 2048,
        egressBytes: 4096,
        meteredBytes: 8192,
        metadata: expect.objectContaining({
          inboundId: 'inbound-acme-vless',
          clientEmail: 'acme@example.com',
          counterSource: 'xray-stats'
        })
      })
    ]);
  });
});
