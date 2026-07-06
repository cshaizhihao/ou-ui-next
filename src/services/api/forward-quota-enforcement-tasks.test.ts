import { seedForwardRules } from '../mock/mock-data';
import { deriveForwardQuotaEnforcementTaskIntents } from './forward-quota-enforcement-tasks';
import type { ForwardRule, QuotaPolicy } from '../../domain';

const baseRule = seedForwardRules[0]! as ForwardRule;
const GB = 1024 ** 3;

function createQuotaPolicy(overrides: Partial<QuotaPolicy> = {}): QuotaPolicy {
  return {
    id: `forward-rule:${baseRule.id}`,
    name: baseRule.name,
    scope: 'forward-rule',
    limitBytes: 100 * 1024 ** 3,
    usedBytes: 101 * 1024 ** 3,
    resetWindow: 'monthly',
    billingDirection: 'both',
    enforcementState: 'exceeded',
    guardrailReason: 'rule_monthly_quota_exceeded',
    ...overrides
  };
}

describe('forward quota enforcement tasks', () => {
  it('derives automatic pause intents from billed forwarding usage when quotaExceeded is omitted', () => {
    const beforeRule: ForwardRule = {
      ...baseRule,
      enabled: true,
      quotaExceeded: undefined,
      quotaBytes: 6 * GB,
      inboundBytes: 1 * GB,
      outboundBytes: 1 * GB,
      manualUsedBytes: 0,
      trafficMultiplier: 1,
      billingDirection: 'both'
    };
    const afterRule: ForwardRule = {
      ...beforeRule,
      inboundBytes: 4 * GB,
      outboundBytes: 3 * GB
    };

    const [intent] = deriveForwardQuotaEnforcementTaskIntents(
      [],
      [beforeRule],
      [afterRule],
      [],
      {
        kind: 'agent-event',
        id: 'evt-forward-metered-quota-exceeded',
        observedAt: '2026-06-05T12:00:00.000Z'
      }
    );

    expect(intent).toBeDefined();
    expect(intent?.input.operation).toBe('forward.pause');
    expect(intent?.input.metadata).toMatchObject({
      quotaGb: 6,
      currentUsedTrafficGb: 7,
      quotaEnforcementPolicyId: `forward-rule:${afterRule.id}`,
      quotaEnforcementGuardrailReason: 'rule_monthly_quota_exceeded'
    });
  });

  it('normalizes blocked forwarding controls out of automatic pause metadata', () => {
    const blockedRule: ForwardRule = {
      ...baseRule,
      quotaExceeded: true,
      ipRateLimitMbps: 50,
      maxConnections: 1024,
      maxConnectionsPerIp: 16,
      proxyProtocol: true
    };

    const [intent] = deriveForwardQuotaEnforcementTaskIntents(
      [],
      [{ ...baseRule, quotaExceeded: false }],
      [blockedRule],
      [createQuotaPolicy()],
      {
        kind: 'agent-event',
        id: 'evt-forward-quota-exceeded',
        observedAt: '2026-06-05T12:00:00.000Z'
      }
    );

    expect(intent).toBeDefined();
    expect(intent?.input.operation).toBe('forward.pause');
    expect(intent?.input.metadata).toMatchObject({
      ipRateLimitMbps: 0,
      maxConnections: 0,
      maxConnectionsPerIp: 0,
      proxyProtocol: false,
      blockedRuntimeControls: ['ipRateLimitMbps', 'maxConnections', 'maxConnectionsPerIp', 'proxyProtocol'],
      blockedRuntimeControlValues: {
        ipRateLimitMbps: 50,
        maxConnections: 1024,
        maxConnectionsPerIp: 16,
        proxyProtocol: true
      }
    });
  });
});
