import { createTrafficRollupsFromAgentTelemetry } from './traffic-rollups';
import {
  createTrafficRollupCompactionExport,
  createTrafficRollupExport,
  selectTrafficRollupCompactions,
  selectTrafficRollups
} from './control-plane-api';
import type { TrafficRollup, TrafficRollupCompaction } from '../../domain';

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

  it('filters and exports retained traffic rollups for operator diagnostics', () => {
    const rollups: TrafficRollup[] = [
      {
        id: 'traffic-old-agent',
        dimension: 'agent',
        subjectId: 'agent-hkg-01',
        subjectLabel: 'Hong Kong Edge',
        agentId: 'agent-hkg-01',
        observedAt: '2026-06-04T00:00:00.000Z',
        sampledAt: '2026-06-04T00:00:00.000Z',
        periodKey: '2026-06-reset-01',
        monthlyResetDay: 1,
        accountingMode: 'both',
        ingressBytes: 100,
        egressBytes: 200,
        meteredBytes: 300,
        source: 'agent-telemetry'
      },
      {
        id: 'traffic-new-forward',
        dimension: 'forward-rule',
        subjectId: 'forward-hkg-443',
        subjectLabel: 'Forward 443',
        agentId: 'agent-hkg-01',
        observedAt: '2026-06-04T00:02:00.000Z',
        sampledAt: '2026-06-04T00:02:00.000Z',
        periodKey: '2026-06-reset-01',
        monthlyResetDay: 1,
        accountingMode: 'both',
        ingressBytes: 512,
        egressBytes: 1024,
        meteredBytes: 1536,
        source: 'agent-telemetry',
        metadata: {
          ruleId: 'forward-hkg-443'
        }
      },
      {
        id: 'traffic-sfo-forward',
        dimension: 'forward-rule',
        subjectId: 'forward-sfo-8443',
        subjectLabel: 'Forward 8443',
        agentId: 'agent-sfo-01',
        observedAt: '2026-06-04T00:03:00.000Z',
        sampledAt: '2026-06-04T00:03:00.000Z',
        periodKey: '2026-06-reset-01',
        monthlyResetDay: 1,
        accountingMode: 'both',
        ingressBytes: 2048,
        egressBytes: 4096,
        meteredBytes: 6144,
        source: 'agent-telemetry'
      }
    ];

    expect(
      selectTrafficRollups(rollups, {
        dimension: 'forward-rule',
        agentId: 'agent-hkg-01',
        since: '2026-06-04T00:01:00.000Z',
        limit: 10
      })
    ).toEqual([
      expect.objectContaining({
        id: 'traffic-new-forward',
        subjectId: 'forward-hkg-443',
        meteredBytes: 1536
      })
    ]);

    const exported = createTrafficRollupExport(
      rollups,
      {
        dimension: 'forward-rule',
        agentId: 'agent-hkg-01',
        limit: 10,
        format: 'jsonl'
      },
      '2026-06-04T00:05:00.000Z'
    );

    expect(exported).toMatchObject({
      format: 'jsonl',
      contentType: 'application/x-ndjson; charset=utf-8',
      filename: 'ou-ui-traffic-rollups-2026-06-04T00-05-00-000Z.jsonl',
      count: 1,
      query: {
        dimension: 'forward-rule',
        agentId: 'agent-hkg-01',
        limit: 10,
        format: 'jsonl'
      },
      rollups: [
        expect.objectContaining({
          id: 'traffic-new-forward'
        })
      ]
    });
    expect(exported.content.trim()).toBe(JSON.stringify(exported.rollups[0]));
  });

  it('filters and exports compacted traffic rollups for storage diagnostics', () => {
    const compactions: TrafficRollupCompaction[] = [
      {
        id: 'traffic-compaction-agent-hkg',
        granularity: 'day',
        dimension: 'agent',
        subjectId: 'agent-hkg-01',
        subjectLabel: 'Hong Kong Edge',
        agentId: 'agent-hkg-01',
        periodKey: '2026-06-reset-01',
        bucketStartAt: '2026-06-04T00:00:00.000Z',
        bucketEndAt: '2026-06-05T00:00:00.000Z',
        firstObservedAt: '2026-06-04T00:00:00.000Z',
        lastObservedAt: '2026-06-04T00:30:00.000Z',
        firstSampledAt: '2026-06-04T00:00:00.000Z',
        lastSampledAt: '2026-06-04T00:30:00.000Z',
        sampleCount: 2,
        ingressBytesTotal: 300,
        egressBytesTotal: 700,
        meteredBytesTotal: 1000,
        compactedAt: '2026-06-05T00:00:00.000Z',
        source: 'retention-prune'
      },
      {
        id: 'traffic-compaction-forward-sfo',
        granularity: 'day',
        dimension: 'forward-rule',
        subjectId: 'forward-sfo-8443',
        subjectLabel: 'Forward 8443',
        agentId: 'agent-sfo-01',
        periodKey: '2026-06-reset-01',
        bucketStartAt: '2026-06-03T00:00:00.000Z',
        bucketEndAt: '2026-06-04T00:00:00.000Z',
        firstObservedAt: '2026-06-03T00:00:00.000Z',
        lastObservedAt: '2026-06-03T00:30:00.000Z',
        firstSampledAt: '2026-06-03T00:00:00.000Z',
        lastSampledAt: '2026-06-03T00:30:00.000Z',
        sampleCount: 3,
        ingressBytesTotal: 600,
        egressBytesTotal: 900,
        meteredBytesTotal: 1500,
        compactedAt: '2026-06-05T00:00:00.000Z',
        source: 'retention-prune'
      }
    ];

    expect(
      selectTrafficRollupCompactions(compactions, {
        dimension: 'agent',
        agentId: 'agent-hkg-01',
        periodKey: '2026-06-reset-01',
        since: '2026-06-04T00:00:00.000Z'
      })
    ).toEqual([
      expect.objectContaining({
        id: 'traffic-compaction-agent-hkg',
        sampleCount: 2,
        meteredBytesTotal: 1000
      })
    ]);

    const exported = createTrafficRollupCompactionExport(
      compactions,
      {
        dimension: 'forward-rule',
        limit: 10,
        format: 'jsonl'
      },
      '2026-06-05T00:05:00.000Z'
    );

    expect(exported).toMatchObject({
      filename: 'ou-ui-traffic-rollup-compactions-2026-06-05T00-05-00-000Z.jsonl',
      count: 1,
      compactions: [
        expect.objectContaining({
          id: 'traffic-compaction-forward-sfo'
        })
      ]
    });
    expect(exported.content.trim()).toBe(JSON.stringify(exported.compactions[0]));
  });
});
