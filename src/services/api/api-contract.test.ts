import { describe, expect, it } from 'vitest';
import {
  agentCredentialRevokeRequestSchema,
  agentCredentialRotateRequestSchema,
  agentCommandEnvelopeSchema,
  agentEventsRequestSchema,
  agentInstallCommandRequestSchema,
  agentPollRequestSchema,
  createTaskRequestSchema,
  mutationContextSchema,
  transitionTaskRequestSchema
} from './api-contract';
import { createMockApi } from '../mock/mock-api';

describe('v1 API runtime contract', () => {
  it('accepts structured task metadata for host onboarding and forwarding forms', () => {
    expect(
      createTaskRequestSchema.parse({
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-edge-hkg-01',
        targetLabel: 'edge-hkg-01',
        summary: '生成一键主机代理安装命令',
        metadata: {
          hostName: 'edge-hkg-01',
          installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
        }
      })
    ).toMatchObject({
      operation: 'agent.deploy',
      metadata: {
        installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
      }
    });

    expect(
      createTaskRequestSchema.parse({
        operation: 'inbound.create',
        resourceType: 'inbound',
        targetId: 'customer-node-hkg-acme',
        targetLabel: '客户专属 VLESS 入口',
        summary: '创建客户 Xray 入站',
        metadata: {
          nodeId: 'customer-node-hkg-acme',
          agentId: 'agent-hkg-01',
          customerNodeName: '客户专属 VLESS 入口',
          customerName: 'Acme Team',
          serverAddress: 'edge.customer.example.com',
          xrayProtocol: 'vless',
          listenPort: 443,
          clientIdentity: '9f3f5b3e-1f42-4f46-9b76-22e8d0bbf3c1',
          streamNetwork: 'tcp',
          security: 'reality',
          sni: 'www.cloudflare.com',
          path: '/ou-ui',
          flow: 'xtls-rprx-vision',
          ipLimit: 3,
          trafficLimitGb: 1024,
          remainingDays: 30,
          subscriptionRule: 'region:hk AND tier:premium'
        }
      })
    ).toMatchObject({
      operation: 'inbound.create',
      metadata: {
        customerNodeName: '客户专属 VLESS 入口',
        xrayProtocol: 'vless'
      }
    });

    expect(
      createTaskRequestSchema.parse({
        operation: 'subscription.import',
        resourceType: 'subscription',
        targetId: 'source-custom',
        targetLabel: '客户自定义订阅源',
        summary: '导入外部订阅源',
        metadata: {
          sourceId: 'source-custom',
          kind: 'clash',
          name: '客户自定义订阅源',
          url: 'https://provider.example.com/custom.yaml',
          userAgent: 'OU-UI-Next/1.0',
          refreshIntervalMinutes: 60,
          includeFilter: 'premium|streaming',
          excludeFilter: 'expired|test',
          dedupeKey: 'server-port'
        }
      })
    ).toMatchObject({
      operation: 'subscription.import',
      metadata: {
        kind: 'clash',
        dedupeKey: 'server-port'
      }
    });

    expect(
      createTaskRequestSchema.parse({
        operation: 'forward.create',
        resourceType: 'forward',
        targetId: 'forward-custom-2443',
        targetLabel: '多主机端口转发 2443',
        summary: '创建多主机端口转发',
        metadata: {
          ownerName: 'Acme Team',
          listenPort: 2443,
          targetAddress: '172.20.8.10',
          targetPort: 9443,
          agentIds: ['agent-hkg-01', 'agent-sin-02']
        }
      })
    ).toMatchObject({
      operation: 'forward.create',
      metadata: {
        ownerName: 'Acme Team',
        listenPort: 2443,
        targetAddress: '172.20.8.10',
        targetPort: 9443,
        agentIds: ['agent-hkg-01', 'agent-sin-02']
      }
    });
  });

  it('rejects invalid task metadata for quota, expiry, ports, and host targets', () => {
    expect(() =>
      createTaskRequestSchema.parse({
        operation: 'forward.create',
        resourceType: 'forward',
        targetId: 'forward-invalid',
        targetLabel: 'invalid forwarding',
        summary: 'invalid forwarding metadata',
        metadata: {
          listenPort: 70000,
          targetAddress: '172.20.8.10',
          targetPort: 0,
          agentIds: []
        }
      })
    ).toThrow();

    expect(() =>
      createTaskRequestSchema.parse({
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-invalid',
        targetLabel: 'invalid agent',
        summary: 'invalid agent metadata',
        metadata: {
          hostName: ''
        }
      })
    ).toThrow();

    expect(() =>
      createTaskRequestSchema.parse({
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-missing-profile',
        targetLabel: 'agent missing install profile',
        summary: 'invalid agent install metadata',
        metadata: {
          hostName: 'edge-hkg-01'
        }
      })
    ).toThrow();

    expect(() =>
      createTaskRequestSchema.parse({
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-partial-profile',
        targetLabel: 'agent partial install profile',
        summary: 'invalid agent install metadata',
        metadata: {
          hostName: 'edge-hkg-01',
          installProfile: ['host-agent']
        }
      })
    ).toThrow();

    expect(() =>
      createTaskRequestSchema.parse({
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-duplicate-profile',
        targetLabel: 'agent duplicate install profile',
        summary: 'invalid agent install metadata',
        metadata: {
          hostName: 'edge-hkg-01',
          installProfile: ['host-agent', 'host-agent', 'xray', 'port-forwarding', 'telemetry']
        }
      })
    ).toThrow();

    expect(() =>
      createTaskRequestSchema.parse({
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-invalid-profile',
        targetLabel: 'invalid agent profile',
        summary: 'invalid agent metadata',
        metadata: {
          hostName: 'edge-hkg-01',
          installProfile: ['host-agent', 'unknown-module']
        }
      })
    ).toThrow();
  });

  it('validates one-click Agent install command requests with the complete runtime profile', () => {
    expect(
      agentInstallCommandRequestSchema.parse({
        hostName: 'edge-hkg-01',
        installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel'],
        publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
      })
    ).toMatchObject({
      hostName: 'edge-hkg-01',
      installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
    });

    expect(() =>
      agentInstallCommandRequestSchema.parse({
        hostName: 'edge-hkg-01',
        installProfile: ['host-agent', 'xray', 'port-forwarding']
      })
    ).toThrow();

    expect(() =>
      agentInstallCommandRequestSchema.parse({
        hostName: 'edge-hkg-01',
        installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel'],
        publicBaseUrl: 'not-a-url'
      })
    ).toThrow();
  });

  it('requires an operator reason when revoking Agent credentials', () => {
    expect(
      agentCredentialRevokeRequestSchema.parse({
        reason: 'operator initiated runtime credential rotation'
      })
    ).toEqual({
      reason: 'operator initiated runtime credential rotation'
    });

    expect(() =>
      agentCredentialRevokeRequestSchema.parse({
        reason: ''
      })
    ).toThrow();
  });

  it('requires an operator reason when rotating Agent credentials', () => {
    expect(
      agentCredentialRotateRequestSchema.parse({
        reason: 'scheduled runtime credential rotation'
      })
    ).toEqual({
      reason: 'scheduled runtime credential rotation'
    });

    expect(() =>
      agentCredentialRotateRequestSchema.parse({
        reason: ''
      })
    ).toThrow();
  });

  it('validates task mutation payloads and mutation request context', async () => {
    const api = createMockApi();

    expect(
      createTaskRequestSchema.parse({
        operation: 'agent.deploy',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'Agent-A 香港入口',
        summary: '下发 Universal Agent 配置'
      })
    ).toMatchObject({
      operation: 'agent.deploy',
      targetId: 'agent-hkg-01'
    });

    expect(
      mutationContextSchema.parse({
        actor: 'sre:alice',
        sourceIp: '203.0.113.10',
        requestId: 'req-agent-deploy-001',
        idempotencyKey: 'idem-agent-deploy-001'
      })
    ).toMatchObject({
      actor: 'sre:alice',
      requestId: 'req-agent-deploy-001'
    });

    await expect(
      api.createTask({
        operation: 'agent.deploy',
        targetId: '',
        targetLabel: 'Agent-A 香港入口',
        summary: '下发 Universal Agent 配置'
      })
    ).rejects.toThrow('Invalid create task request');
  });

  it('validates Universal Agent command envelopes before backend dispatch', () => {
    expect(
      agentCommandEnvelopeSchema.parse({
        type: 'apply',
        commandId: 'cmd-agent-apply-001',
        requestId: 'req-agent-apply-001',
        taskId: 'task-0001',
        agentId: 'agent-hkg-01',
        sessionId: 'sess-agent-hkg-01',
        seq: 42,
        issuedAt: '2026-06-02T00:00:00.000Z',
        deadlineAt: '2026-06-02T00:05:00.000Z',
        payload: {
          configRevision: 'cfg-20260602-001',
          moduleKind: 'xray',
          checksum: 'sha256:64f5b2b8d8c2f7f67a6a0f9b7f5c4f4de8f4d7c1a8b1c2d3e4f5a6b7c8d9e0f1',
          dryRun: false,
          rollbackTaskId: null
        }
      })
    ).toMatchObject({
      type: 'apply',
      commandId: 'cmd-agent-apply-001',
      seq: 42
    });

    expect(() =>
      agentCommandEnvelopeSchema.parse({
        type: 'shell',
        commandId: 'cmd-agent-shell-001',
        requestId: 'req-agent-shell-001',
        taskId: 'task-0001',
        agentId: 'agent-hkg-01',
        seq: 43,
        issuedAt: '2026-06-02T00:00:00.000Z',
        deadlineAt: '2026-06-02T00:05:00.000Z',
        payload: {}
      })
    ).toThrow();
  });

  it('rejects runtime apply commands without immutable config payload fields', () => {
    expect(() =>
      agentCommandEnvelopeSchema.parse({
        type: 'apply',
        commandId: 'cmd-agent-apply-002',
        requestId: 'req-agent-apply-002',
        taskId: 'task-0002',
        agentId: 'agent-hkg-01',
        seq: 44,
        issuedAt: '2026-06-02T00:00:00.000Z',
        deadlineAt: '2026-06-02T00:05:00.000Z',
        payload: {
          dryRun: false
        }
      })
    ).toThrow();

    expect(
      agentCommandEnvelopeSchema.parse({
        type: 'rollback',
        commandId: 'cmd-agent-rollback-001',
        requestId: 'req-agent-rollback-001',
        taskId: 'task-0003',
        agentId: 'agent-hkg-01',
        seq: 45,
        issuedAt: '2026-06-02T00:00:00.000Z',
        deadlineAt: '2026-06-02T00:05:00.000Z',
        payload: {
          snapshotId: 'snapshot-hkg-443-before',
          targetConfigRevision: 'cfg-20260601-001',
          rollbackReason: 'post-apply health probe failed',
          rollbackMode: 'graceful_restart'
        }
      })
    ).toMatchObject({
      type: 'rollback',
      payload: {
        snapshotId: 'snapshot-hkg-443-before'
      }
    });
  });

  it('validates task transition and Agent runtime request envelopes', () => {
    expect(
      transitionTaskRequestSchema.parse({
        status: 'running'
      })
    ).toEqual({
      status: 'running'
    });

    expect(() =>
      transitionTaskRequestSchema.parse({
        status: 'unknown'
      })
    ).toThrow();

    expect(
      agentPollRequestSchema.parse({
        agentId: 'agent-hkg-01',
        requestId: 'req-agent-poll-001',
        sessionId: 'sess-agent-hkg-01',
        lastSeenCommandSeq: 7
      })
    ).toMatchObject({
      agentId: 'agent-hkg-01',
      requestId: 'req-agent-poll-001'
    });

    expect(() =>
      agentPollRequestSchema.parse({
        agentId: 'agent-hkg-01'
      })
    ).toThrow();

    expect(() =>
      agentEventsRequestSchema.parse({
        events: []
      })
    ).toThrow();
  });
});
