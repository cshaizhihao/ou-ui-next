import {
  collectBlockedForwardingRuntimeControls,
  diagnoseForwardingRuntime,
  normalizeBlockedForwardingRuntimeControls,
  type ForwardRule
} from './forwarding';

function createForwardRule(overrides: Partial<ForwardRule> = {}): ForwardRule {
  return {
    id: 'forward-hkg-443',
    tunnelId: 'tunnel-premium',
    name: 'HKG HTTPS Forward',
    ownerName: 'Acme',
    strategy: 'round-robin',
    enabled: true,
    ports: [
      {
        agentId: 'agent-hkg-01',
        listenAddress: '0.0.0.0',
        listenPort: 443,
        targetAddress: '10.0.0.10',
        targetPort: 8443,
        protocol: 'tcp+udp',
        status: 'allocated',
        runtimeServiceNames: ['ou-forward-forward-hkg-443-agent-hkg-01.service'],
        inboundBytes: 1024,
        outboundBytes: 2048,
        lastCounterSampleAt: '2026-06-04T04:00:00.000Z',
        counterSource: 'nftables'
      }
    ],
    portStatus: 'allocated',
    billingDirection: 'both',
    trafficMultiplier: 1,
    monthlyResetDay: 1,
    manualUsedBytes: 0,
    quotaBytes: 100 * 1024 ** 3,
    rateLimitMbps: 80,
    rateLimitMode: 'bi-directional',
    rateLimitDirection: 'both',
    ipRateLimitMbps: 0,
    quotaPolicyId: 'quota-forward-hkg-443',
    rateLimitPolicyId: 'rate-forward-hkg-443',
    maxConnections: 0,
    maxConnectionsPerIp: 0,
    proxyProtocol: false,
    tunnelMode: 'direct',
    pricePerGb: 0,
    inboundBytes: 1024,
    outboundBytes: 2048,
    ...overrides
  };
}

describe('forwarding runtime diagnosis', () => {
  it('marks allocated rules with service and counter evidence as ready', () => {
    const diagnosis = diagnoseForwardingRuntime(createForwardRule());

    expect(diagnosis).toEqual({
      state: 'ready',
      reasons: [],
      blockedControls: [],
      nextActions: ['pause'],
      hasRuntimeEvidence: true,
      impactedBindingCount: 0
    });
  });

  it('marks Agent blocked controls as degraded without treating them as applied runtime behavior', () => {
    const rule = createForwardRule({
      ipRateLimitMbps: 50,
      maxConnections: 1024,
      maxConnectionsPerIp: 16,
      proxyProtocol: true
    });

    expect(collectBlockedForwardingRuntimeControls(rule)).toEqual([
      'ipRateLimitMbps',
      'maxConnections',
      'maxConnectionsPerIp',
      'proxyProtocol'
    ]);
    expect(diagnoseForwardingRuntime(rule)).toMatchObject({
      state: 'degraded',
      reasons: ['blocked-runtime-controls'],
      nextActions: ['inspect-agent']
    });
  });

  it('normalizes blocked controls out of executable runtime metadata while preserving diagnostics', () => {
    expect(
      normalizeBlockedForwardingRuntimeControls({
        ipRateLimitMbps: 50,
        maxConnections: 1024,
        maxConnectionsPerIp: 16,
        proxyProtocol: true
      })
    ).toEqual({
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

  it('diagnoses blocked controls preserved as metadata even when executable fields are normalized', () => {
    const diagnosis = diagnoseForwardingRuntime(
      createForwardRule({
        ipRateLimitMbps: 0,
        maxConnections: 0,
        maxConnectionsPerIp: 0,
        proxyProtocol: false,
        blockedRuntimeControls: ['ipRateLimitMbps', 'proxyProtocol'],
        blockedRuntimeControlValues: {
          ipRateLimitMbps: 50,
          proxyProtocol: true
        }
      })
    );

    expect(diagnosis).toMatchObject({
      state: 'degraded',
      reasons: ['blocked-runtime-controls'],
      blockedControls: ['ipRateLimitMbps', 'proxyProtocol'],
      nextActions: ['inspect-agent']
    });
  });

  it('marks allocated rules without counter samples as degraded telemetry evidence', () => {
    const diagnosis = diagnoseForwardingRuntime(
      createForwardRule({
        ports: [
          {
            agentId: 'agent-hkg-01',
            listenAddress: '0.0.0.0',
            listenPort: 443,
            targetAddress: '10.0.0.10',
            targetPort: 8443,
            protocol: 'tcp+udp',
            status: 'allocated',
            runtimeServiceNames: ['ou-forward-forward-hkg-443-agent-hkg-01.service']
          }
        ]
      })
    );

    expect(diagnosis).toMatchObject({
      state: 'degraded',
      reasons: ['missing-traffic-counters'],
      nextActions: ['inspect-agent']
    });
  });

  it('marks quota guardrails and policy suspension as blocked with recovery actions', () => {
    const diagnosis = diagnoseForwardingRuntime(
      createForwardRule({
        quotaExceeded: true,
        runtimeDisabledByPolicy: true,
        guardrailReason: 'forward_rule_quota_exceeded'
      })
    );

    expect(diagnosis.state).toBe('blocked');
    expect(diagnosis.reasons).toEqual([
      'quota-exceeded',
      'runtime-disabled-by-policy',
      'guardrail'
    ]);
    expect(diagnosis.nextActions).toEqual(['reset-quota', 'resume', 'inspect-agent']);
  });

  it('derives quota diagnosis from billed usage when quotaExceeded is omitted', () => {
    const diagnosis = diagnoseForwardingRuntime(
      createForwardRule({
        quotaBytes: 6 * 1024 ** 3,
        inboundBytes: 4 * 1024 ** 3,
        outboundBytes: 3 * 1024 ** 3,
        manualUsedBytes: 0,
        trafficMultiplier: 1,
        quotaExceeded: undefined
      })
    );

    expect(diagnosis).toMatchObject({
      state: 'blocked',
      reasons: ['quota-exceeded'],
      nextActions: ['reset-quota']
    });
  });

  it('keeps deployment failures separate from waiting states', () => {
    const diagnosis = diagnoseForwardingRuntime(
      createForwardRule({
        portStatus: 'failed',
        ports: [
          {
            ...createForwardRule().ports[0],
            status: 'failed'
          }
        ]
      })
    );

    expect(diagnosis).toMatchObject({
      state: 'failed',
      reasons: ['runtime-apply-failed'],
      nextActions: ['repair', 'inspect-agent'],
      impactedBindingCount: 1
    });
  });

  it('detects binding-level conflicts before the aggregate rule status catches up', () => {
    const diagnosis = diagnoseForwardingRuntime(
      createForwardRule({
        ports: [
          {
            ...createForwardRule().ports[0],
            status: 'conflict'
          }
        ]
      })
    );

    expect(diagnosis).toMatchObject({
      state: 'blocked',
      reasons: ['port-conflict'],
      nextActions: ['resolve-conflict'],
      impactedBindingCount: 1
    });
  });
});
