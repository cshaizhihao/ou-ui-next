import { applyQuotaResetStateToAgentEvent, type QuotaResetReplayState } from './quota-reset-tasks';
import type { AgentEventEnvelope } from './api-contract';

function createReplayState(): QuotaResetReplayState {
  return {
    agentsById: new Map([
      [
        'agent-edge-01',
        [
          {
            quotaPolicyId: 'managed-host:agent-edge-01',
            quotaPolicyName: 'Edge 01 monthly quota',
            resetAt: '2026-06-05T00:00:00.000Z',
            agentId: 'agent-edge-01',
            resetDay: 1,
            billingPeriod: '2026-06-reset-01',
            accountingMode: 'both',
            quotaBytes: 2_000,
            baselineManualUsedTrafficBytes: 100,
            baselineMonthlyIngressBytes: 200,
            baselineMonthlyEgressBytes: 300,
            baselineMonthlyTrafficUsedBytes: 600
          }
        ]
      ]
    ]),
    clientsByInboundId: new Map(),
    forwardRulesById: new Map(),
    forwardRulesByServiceName: new Map(),
    subscriptionClientsById: new Map()
  } as unknown as QuotaResetReplayState;
}

describe('quota reset Agent telemetry replay', () => {
  it('writes derived monthly usage when Agent telemetry omits explicit monthlyTrafficUsedBytes', () => {
    const event: AgentEventEnvelope = {
      type: 'telemetry_sample',
      eventId: 'evt-agent-quota-reset-derived-usage',
      agentId: 'agent-edge-01',
      seq: 10,
      sessionId: 'sess-agent-edge-01',
      observedAt: '2026-06-05T00:10:00.000Z',
      payload: {
        monthlyIngressBytes: 500,
        monthlyEgressBytes: 1_000,
        manualUsedTrafficBytes: 150,
        trafficAccountingMode: 'both',
        monthlyResetDay: 1,
        trafficBillingPeriod: '2026-06-reset-01',
        reportedAt: '2026-06-05T00:10:00.000Z'
      }
    };

    const replayed = applyQuotaResetStateToAgentEvent(event, createReplayState());

    expect(replayed.payload).toMatchObject({
      monthlyIngressBytes: 300,
      monthlyEgressBytes: 700,
      manualUsedTrafficBytes: 50,
      monthlyTrafficUsedBytes: 1_050,
      quotaExceeded: false,
      runtimeDisabledByPolicy: false,
      guardrailReason: 'ok'
    });
  });
});
