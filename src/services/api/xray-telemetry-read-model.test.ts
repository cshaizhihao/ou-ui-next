import type { XrayInbound } from '../../domain';
import { applyXrayTelemetryToReadModel, applyXrayTrafficWindowToReadModel } from './xray-telemetry-read-model';
import type { AgentEventEnvelope } from './api-contract';

function createInbound(): XrayInbound {
  return {
    id: 'customer-node-hkg-vless',
    nodeId: 'agent-hkg-01',
    agentId: 'agent-hkg-01',
    customerName: 'Acme',
    serverAddress: '203.0.113.10',
    clientIdentity: 'acme-vless',
    remainingDays: 30,
    subscriptionRule: 'manual',
    protocol: 'vless',
    label: 'Acme VLESS',
    listenAddress: '0.0.0.0',
    listenPort: 443,
    status: 'enabled',
    clients: [
      {
        id: '0d0f5137-8ef8-4e52-bdd6-60f06d3d6b7f',
        email: 'acme@example.com',
        enabled: true,
        credentialType: 'uuid',
        flow: 'xtls-rprx-vision',
        resetPolicy: 'monthly',
        trafficLimitBytes: 1_000,
        usedTrafficBytes: 100,
        monthlyResetDay: 1,
        manualUsedTrafficBytes: 100,
        expiresAt: '2026-12-31T23:59:59.000Z',
        ipLimit: 2
      }
    ],
    streamSettings: {
      network: 'tcp',
      security: 'reality',
      fingerprint: 'chrome'
    },
    tls: {
      enabled: false,
      alpn: ['h2', 'http/1.1']
    },
    reality: {
      enabled: true,
      shortIds: ['ouui'],
      serverNames: ['example.com']
    },
    fallbacks: [],
    sniffingEnabled: true,
    configVersion: 'cfg-customer-node-hkg-vless'
  };
}

describe('xray telemetry read model', () => {
  it('updates client traffic from current-period Agent counters', () => {
    const event: AgentEventEnvelope = {
      type: 'telemetry_sample',
      eventId: 'evt-xray-client-traffic-1',
      agentId: 'agent-hkg-01',
      seq: 1,
      sessionId: 'sess-agent-hkg-01',
      observedAt: '2026-06-04T00:00:00.000Z',
      payload: {
        xrayClientCounters: [
          {
            inboundId: 'customer-node-hkg-vless',
            inboundTag: 'ou-customer-node-hkg-vless',
            agentId: 'agent-hkg-01',
            clientEmail: 'acme@example.com',
            clientId: '0d0f5137-8ef8-4e52-bdd6-60f06d3d6b7f',
            uplinkBytes: 300,
            downlinkBytes: 400,
            usedTrafficBytes: 800,
            trafficLimitBytes: 1_000,
            monthlyResetDay: 1,
            quotaExceeded: false,
            sampledAt: '2026-06-04T00:00:00.000Z',
            trafficBillingPeriod: '2026-06-reset-01',
            source: 'xray-stats'
          }
        ]
      }
    };

    const [inbound] = applyXrayTelemetryToReadModel([createInbound()], event);

    expect(inbound.clients[0]).toMatchObject({
      usedTrafficBytes: 800,
      uplinkBytes: 300,
      downlinkBytes: 400,
      lastTrafficSampleAt: '2026-06-04T00:00:00.000Z',
      trafficBillingPeriod: '2026-06-reset-01',
      quotaExceeded: false
    });
  });

  it('ignores stale Xray client counters after the monthly reset', () => {
    const staleInbound = {
      ...createInbound(),
      clients: [
        {
          ...createInbound().clients[0],
          usedTrafficBytes: 900,
          uplinkBytes: 500,
          downlinkBytes: 300,
          lastTrafficSampleAt: '2026-06-30T23:59:59.000Z',
          trafficBillingPeriod: '2026-06-reset-01',
          quotaExceeded: true
        }
      ]
    };
    const event: AgentEventEnvelope = {
      type: 'telemetry_sample',
      eventId: 'evt-xray-client-traffic-stale',
      agentId: 'agent-hkg-01',
      seq: 2,
      sessionId: 'sess-agent-hkg-01',
      observedAt: '2026-07-01T00:00:05.000Z',
      payload: {
        xrayClientCounters: [
          {
            inboundId: 'customer-node-hkg-vless',
            clientEmail: 'acme@example.com',
            uplinkBytes: 900,
            downlinkBytes: 900,
            usedTrafficBytes: 1_900,
            monthlyResetDay: 1,
            sampledAt: '2026-06-30T23:59:59.000Z',
            trafficBillingPeriod: '2026-06-reset-01',
            source: 'xray-stats'
          }
        ]
      }
    };

    const [inbound] = applyXrayTelemetryToReadModel([staleInbound], event);

    expect(inbound.clients[0]).toMatchObject({
      usedTrafficBytes: 100,
      uplinkBytes: 0,
      downlinkBytes: 0,
      trafficBillingPeriod: '2026-07-reset-01',
      quotaExceeded: false
    });
  });

  it('resets stale Xray client usage when listing a new billing window', () => {
    const [inbound] = applyXrayTrafficWindowToReadModel(
      [
        {
          ...createInbound(),
          clients: [
            {
              ...createInbound().clients[0],
              usedTrafficBytes: 900,
              uplinkBytes: 500,
              downlinkBytes: 300,
              lastTrafficSampleAt: '2026-06-30T23:59:59.000Z',
              trafficBillingPeriod: '2026-06-reset-01'
            }
          ]
        }
      ],
      '2026-07-01T00:00:00.000Z'
    );

    expect(inbound.clients[0]).toMatchObject({
      usedTrafficBytes: 100,
      uplinkBytes: 0,
      downlinkBytes: 0,
      trafficBillingPeriod: '2026-07-reset-01'
    });
  });
});
