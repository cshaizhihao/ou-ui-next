import { describe, expect, it } from 'vitest';
import type { TrafficRollup } from '../../domain';
import { normalizeTrafficRollupRetentionPolicy, pruneTrafficRollups } from './traffic-rollup-retention';

function createRollup(id: string, observedAt: string, subjectId = 'agent-hkg-01'): TrafficRollup {
  return {
    id,
    dimension: 'agent',
    subjectId,
    subjectLabel: subjectId,
    agentId: 'agent-hkg-01',
    observedAt,
    sampledAt: observedAt,
    periodKey: '2026-06-reset-01',
    monthlyResetDay: 1,
    accountingMode: 'both',
    ingressBytes: 100,
    egressBytes: 200,
    meteredBytes: 300,
    source: 'agent-telemetry'
  };
}

describe('traffic rollup retention', () => {
  it('normalizes invalid policy values to bounded production defaults', () => {
    expect(
      normalizeTrafficRollupRetentionPolicy({
        maxAgeMs: -1,
        maxRecordsPerScope: Number.NaN
      })
    ).toMatchObject({
      maxAgeMs: 1,
      maxRecordsPerScope: 200_000
    });
  });

  it('prunes old rollups and keeps the newest records per traffic scope', () => {
    const rollups = [
      createRollup('traffic-old', '2026-06-01T00:00:00.000Z'),
      createRollup('traffic-newest', '2026-06-05T00:03:00.000Z'),
      createRollup('traffic-middle', '2026-06-05T00:02:00.000Z'),
      createRollup('traffic-other-scope', '2026-06-05T00:01:00.000Z', 'agent-sfo-01')
    ];

    expect(
      pruneTrafficRollups(
        rollups,
        {
          maxAgeMs: 24 * 60 * 60 * 1000,
          maxRecordsPerScope: 1
        },
        '2026-06-05T00:05:00.000Z'
      )
    ).toEqual({
      rollups: [
        expect.objectContaining({ id: 'traffic-newest' }),
        expect.objectContaining({ id: 'traffic-other-scope' })
      ],
      result: {
        removed: 2,
        retained: 2,
        cutoffObservedAt: '2026-06-04T00:05:00.000Z'
      }
    });
  });
});
