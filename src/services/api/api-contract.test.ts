import { describe, expect, it } from 'vitest';
import {
  agentCredentialRevokeRequestSchema,
  agentCredentialRotateRequestSchema,
  agentCommandEnvelopeSchema,
  agentEventsRequestSchema,
  agentInstallCommandRequestSchema,
  agentLogRetentionPolicyUpdateRequestSchema,
  agentPollRequestSchema,
  createTaskRequestSchema,
  mutationContextSchema,
  parseAgentLogRetentionPolicyUpdateRequest,
  transitionTaskRequestSchema
} from './api-contract';
import { createMockApi } from '../mock/mock-api';
import type { AuditLog, DeployTask } from '../../domain';
import { createObservabilityMetrics, type CommandOutboxItem } from './control-plane-api';

describe('v1 API runtime contract', () => {
  it('summarizes observability latency metrics from task and outbox timestamps', () => {
    const createTask = (
      id: string,
      status: DeployTask['status'],
      createdAt: string,
      updatedAt: string,
      operation: DeployTask['operation'] = 'agent.deploy',
      metadata?: DeployTask['metadata']
    ): DeployTask => ({
      id,
      operation,
      resourceType: 'agent',
      resourceId: id,
      status,
      targetId: id,
      targetLabel: id,
      summary: id,
      createdAt,
      updatedAt,
      actor: 'admin',
      requestedBy: 'admin',
      requestId: `req-${id}`,
      sourceIp: '127.0.0.1',
      rollbackAvailable: false,
      attempts: 1,
      steps: [],
      metadata
    });
    const createCommand = (
      id: string,
      status: CommandOutboxItem['status'],
      createdAt: string,
      deadlineAt: string,
      ackedAt?: string,
      resultAt?: string,
      leaseExpiresAt?: string
    ): CommandOutboxItem => ({
      id,
      taskId: `task-${id}`,
      commandId: `cmd-${id}`,
      agentId: 'agent-hkg-01',
      seq: 1,
      status,
      transport: 'http-pull',
      command: {
        type: 'health',
        commandId: `cmd-${id}`,
        requestId: `req-${id}`,
        taskId: `task-${id}`,
        agentId: 'agent-hkg-01',
        seq: 1,
        issuedAt: createdAt,
        deadlineAt,
        payload: {}
      },
      attempts: 1,
      createdAt,
      updatedAt: resultAt ?? ackedAt ?? createdAt,
      deadlineAt,
      ...(ackedAt ? { ackedAt } : {}),
      ...(resultAt ? { resultAt } : {}),
      ...(leaseExpiresAt ? { leaseExpiresAt } : {})
    });
    const createAuditLog = (
      id: string,
      action: AuditLog['action'],
      result: AuditLog['result'],
      denialCode?: string
    ): AuditLog => ({
      id,
      action,
      actor: 'admin',
      scope: 'control-plane:quota',
      resourceType: 'quota',
      operation: 'quota.reset',
      result,
      targetId: id,
      targetLabel: id,
      taskId: '',
      severity: result === 'denied' ? 'critical' : 'info',
      message: `${id} -> ${denialCode ?? action}`,
      createdAt: '2026-06-02T00:00:00.000Z',
      sourceIp: '127.0.0.1',
      requestId: `req-${id}`,
      ...(denialCode ? { denialCode } : {})
    });

    const metrics = createObservabilityMetrics({
      generatedAt: '2026-06-02T00:00:10.000Z',
      tasks: [
        createTask('task-succeeded', 'succeeded', '2026-06-02T00:00:00.000Z', '2026-06-02T00:00:10.000Z'),
        createTask(
          'task-rollback',
          'rolled_back',
          '2026-06-02T00:00:00.000Z',
          '2026-06-02T00:00:20.000Z',
          'agent.rollback'
        ),
        createTask(
          'task-inbound-update',
          'failed',
          '2026-06-02T00:00:00.000Z',
          '2026-06-02T00:00:05.000Z',
          'inbound.update',
          {
            moduleKind: 'xray'
          }
        ),
        createTask('task-queued', 'queued', '2026-06-02T00:00:00.000Z', '2026-06-02T00:00:00.000Z')
      ],
      commandOutbox: [
        createCommand(
          'completed',
          'completed',
          '2026-06-02T00:00:00.000Z',
          '2026-06-02T00:01:00.000Z',
          '2026-06-02T00:00:02.000Z',
          '2026-06-02T00:00:09.000Z'
        ),
        createCommand(
          'leased',
          'acknowledged',
          '2026-06-02T00:00:00.000Z',
          '2026-06-02T00:01:00.000Z',
          '2026-06-02T00:00:05.000Z',
          undefined,
          '2026-06-02T00:00:30.000Z'
        ),
        createCommand('overdue', 'pending', '2026-06-02T00:00:00.000Z', '2026-06-02T00:00:05.000Z')
      ],
      agents: [],
      systemAlerts: [],
      systemAlertNotificationDeliveries: [
        {
          id: 'system-alert-notification-pending',
          status: 'pending',
          batch: {
            schemaVersion: 'ou-ui-next.system-alerts.v1',
            generatedAt: '2026-06-02T00:00:00.000Z',
            events: []
          },
          createdAt: '2026-06-02T00:00:00.000Z',
          updatedAt: '2026-06-02T00:00:00.000Z',
          nextAttemptAt: '2026-06-02T00:00:09.000Z',
          attemptCount: 0,
          maxAttempts: 3
        },
        {
          id: 'system-alert-notification-dead-letter',
          status: 'dead_letter',
          batch: {
            schemaVersion: 'ou-ui-next.system-alerts.v1',
            generatedAt: '2026-06-02T00:00:00.000Z',
            events: []
          },
          createdAt: '2026-06-02T00:00:00.000Z',
          updatedAt: '2026-06-02T00:00:05.000Z',
          nextAttemptAt: '2026-06-02T00:00:05.000Z',
          attemptCount: 3,
          maxAttempts: 3,
          deadLetteredAt: '2026-06-02T00:00:05.000Z',
          lastErrorMessage: 'webhook unavailable'
        }
      ],
      audit: { valid: true, checked: 3 },
      auditLogs: [
        createAuditLog('audit-permission-denied', 'audit.denied', 'denied', 'permission.denied'),
        createAuditLog('audit-quota-exceeded', 'audit.denied', 'denied', 'quota.exceeded'),
        createAuditLog('audit-task-created', 'task.created', 'accepted')
      ]
    });

    expect(metrics.tasks).toMatchObject({
      active: 1,
      rollbacks: 1,
      completionLatencyMs: {
        count: 3,
        p50Ms: 10_000,
        p95Ms: 20_000,
        maxMs: 20_000
      },
      completionLatencyByOperation: {
        'agent.deploy': {
          count: 1,
          p50Ms: 10_000,
          p95Ms: 10_000,
          maxMs: 10_000
        },
        'agent.rollback': {
          count: 1,
          p50Ms: 20_000,
          p95Ms: 20_000,
          maxMs: 20_000
        },
        'inbound.update': {
          count: 1,
          p50Ms: 5_000,
          p95Ms: 5_000,
          maxMs: 5_000
        }
      },
      runtimeApplyLatencyByModule: {
        'host-agent': {
          count: 2,
          p50Ms: 10_000,
          p95Ms: 20_000,
          maxMs: 20_000
        },
        xray: {
          count: 1,
          p50Ms: 5_000,
          p95Ms: 5_000,
          maxMs: 5_000
        }
      }
    });
    expect(metrics.commandOutbox).toMatchObject({
      backlog: 2,
      activeLeases: 1,
      overdue: 1,
      ackLatencyMs: {
        count: 2,
        p50Ms: 2_000,
        p95Ms: 5_000,
        maxMs: 5_000
      },
      resultLatencyMs: {
        count: 1,
        p50Ms: 7_000,
        p95Ms: 7_000,
        maxMs: 7_000
      }
    });
    expect(metrics.audit).toMatchObject({
      valid: true,
      checked: 3,
      denied: 2,
      quotaExceeded: 1,
      writeFailures: 0
    });
    expect(metrics.systemAlerts).toMatchObject({
      byKind: {
        'agent.telemetry_sampling_gap': 0,
        'agent.offline': 0,
        'agent.runtime_service_unhealthy': 0,
        'agent.high_latency': 0,
        'command_outbox.overdue': 0,
        'command_outbox.dead_letter': 0,
        'runtime.reload_failed': 0,
        'audit.write_failed': 0,
        'system_alert_notification.overdue': 0,
        'system_alert_notification.dead_letter': 0,
        'quota.exceeded': 0
      }
    });
    expect(metrics.systemAlertNotifications).toMatchObject({
      total: 2,
      pending: 1,
      deadLetters: 1,
      overdue: 1,
      byStatus: {
        pending: 1,
        failed: 0,
        delivered: 0,
        dead_letter: 1
      }
    });
  });

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
          fingerprint: 'chrome',
          realityPublicKey: 'client-public-key',
          realityPrivateKey: 'server-private-key',
          realityTarget: 'www.cloudflare.com:443',
          realityShortId: 'abcd1234',
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
        xrayProtocol: 'vless',
        realityPrivateKey: 'server-private-key',
        realityTarget: 'www.cloudflare.com:443'
      }
    });

    expect(
      createTaskRequestSchema.parse({
        operation: 'inbound.update',
        resourceType: 'inbound',
        targetId: 'customer-node-hkg-acme',
        targetLabel: '客户专属 VLESS 入口',
        summary: '系统自动停用客户节点',
        metadata: {
          nodeId: 'customer-node-hkg-acme',
          agentId: 'agent-hkg-01',
          customerNodeName: '客户专属 VLESS 入口',
          customerName: 'Acme Team',
          xrayProtocol: 'vless',
          listenPort: 443,
          clientIdentity: 'acme-human-id',
          streamNetwork: 'tcp',
          security: 'reality',
          enabled: false,
          xrayGuardrailAutomatic: true,
          xrayGuardrailAction: 'disable',
          xrayGuardrailPolicyId: 'customer-node:customer-node-hkg-acme:acme-human-id',
          xrayGuardrailPolicyScope: 'customer-node',
          xrayGuardrailObservedAt: '2026-06-05T11:00:00.000Z',
          xrayGuardrailTriggerKind: 'agent-event',
          xrayGuardrailTriggerId: 'evt-customer-node-guardrail',
          xrayGuardrailReason: 'xray_client_monthly_quota_exceeded'
        }
      })
    ).toMatchObject({
      operation: 'inbound.update',
      metadata: {
        enabled: false,
        xrayGuardrailAutomatic: true,
        xrayGuardrailAction: 'disable',
        xrayGuardrailPolicyScope: 'customer-node'
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
          fetchTimeoutSeconds: 12,
          maxBodyBytes: 8 * 1024 * 1024,
          includeFilter: 'premium|streaming',
          excludeFilter: 'expired|test',
          dedupeKey: 'server-port'
        }
      })
    ).toMatchObject({
      operation: 'subscription.import',
      metadata: {
        kind: 'clash',
        dedupeKey: 'server-port',
        fetchTimeoutSeconds: 12,
        maxBodyBytes: 8 * 1024 * 1024
      }
    });

    expect(
      createTaskRequestSchema.parse({
        operation: 'subscription.generate',
        resourceType: 'subscription',
        targetId: 'sub-client-acme',
        targetLabel: 'Acme Mihomo subscription',
        summary: 'Create a custom client subscription rule',
        metadata: {
          subscriptionClientId: 'sub-client-acme',
          displayName: 'Acme Mihomo subscription',
          subId: 'acme_hkg',
          protocol: 'vless',
          sourceIds: ['source-custom'],
          formats: ['plain', 'mihomo'],
          outputFormats: ['uri', 'mihomo'],
          templateName: 'mihomo-compatible.yaml'
        }
      })
    ).toMatchObject({
      operation: 'subscription.generate',
      metadata: {
        formats: ['plain', 'mihomo'],
        outputFormats: ['uri', 'mihomo'],
        templateName: 'mihomo-compatible.yaml'
      }
    });

    expect(
      createTaskRequestSchema.parse({
        operation: 'subscription.profile.upsert',
        resourceType: 'subscription',
        targetId: 'profile-mihomo-premium',
        targetLabel: 'Mihomo Premium',
        summary: 'Save subscription export profile',
        metadata: {
          profileId: 'profile-mihomo-premium',
          name: 'Mihomo Premium',
          client: 'mihomo',
          sourceIds: ['source-custom'],
          includeFilter: 'premium|streaming',
          excludeFilter: 'expired|test',
          regionFilter: ['hk', 'sg'],
          outputFormats: ['mihomo', 'clash', 'uri'],
          templateName: 'mihomo-compatible.yaml',
          includeTrafficHeaders: true,
          proxyGroups: [
            {
              id: 'proxy-group-premium-auto',
              name: 'Premium Auto',
              strategy: 'url-test',
              filterTags: ['premium', 'streaming']
            }
          ]
        }
      })
    ).toMatchObject({
      operation: 'subscription.profile.upsert',
      metadata: {
        profileId: 'profile-mihomo-premium',
        client: 'mihomo',
        outputFormats: ['mihomo', 'clash', 'uri'],
        proxyGroups: [
          {
            id: 'proxy-group-premium-auto',
            name: 'Premium Auto',
            strategy: 'url-test',
            filterTags: ['premium', 'streaming']
          }
        ]
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
          agentIds: ['agent-hkg-01', 'agent-sin-02'],
          billingDirection: 'single',
          monthlyResetDay: 15,
          currentUsedTrafficGb: 33.5
        }
      })
    ).toMatchObject({
      operation: 'forward.create',
      metadata: {
        ownerName: 'Acme Team',
        listenPort: 2443,
        targetAddress: '172.20.8.10',
        targetPort: 9443,
        agentIds: ['agent-hkg-01', 'agent-sin-02'],
        billingDirection: 'single',
        monthlyResetDay: 15,
        currentUsedTrafficGb: 33.5
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
        operation: 'forward.create',
        resourceType: 'forward',
        targetId: 'forward-missing-runtime-fields',
        targetLabel: 'missing forwarding metadata',
        summary: 'missing forwarding metadata',
        metadata: {
          targetAddress: '172.20.8.10',
          billingDirection: 'both'
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

    expect(() =>
      createTaskRequestSchema.parse({
        operation: 'inbound.create',
        resourceType: 'inbound',
        targetId: 'inbound-unsupported-wireguard',
        targetLabel: 'unsupported WireGuard inbound',
        summary: 'reject unsupported customer node protocol',
        metadata: {
          customerNodeName: 'unsupported WireGuard inbound',
          agentId: 'agent-hkg-01',
          serverAddress: 'edge.customer.example.com',
          xrayProtocol: 'wireguard',
          listenPort: 51820
        }
      })
    ).toThrow();

    expect(() =>
      createTaskRequestSchema.parse({
        operation: 'inbound.create',
        resourceType: 'inbound',
        targetId: 'inbound-unsupported-hysteria',
        targetLabel: 'unsupported Hysteria2 inbound',
        summary: 'reject Hysteria2 until a dedicated runtime exists',
        metadata: {
          customerNodeName: 'unsupported Hysteria2 inbound',
          agentId: 'agent-hkg-01',
          serverAddress: 'edge.customer.example.com',
          xrayProtocol: 'hysteria',
          listenPort: 443
        }
      })
    ).toThrow();

    expect(() =>
      createTaskRequestSchema.parse({
        operation: 'forward.create',
        resourceType: 'forward',
        targetId: 'forward-unsupported-runtime-control',
        targetLabel: 'unsupported runtime control',
        summary: 'reject unsupported port forwarding runtime controls',
        metadata: {
          name: 'unsupported runtime control',
          listenAddress: '0.0.0.0',
          listenPort: 2443,
          targetAddress: '172.20.8.10',
          targetPort: 9443,
          protocol: 'tcp+udp',
          entryNodeIds: ['agent-hkg-01'],
          ipRateLimitMbps: 80,
          maxConnections: 2048,
          maxConnectionsPerIp: 32,
          proxyProtocol: true
        }
      })
    ).toThrow();

    expect(
      createTaskRequestSchema.parse({
        operation: 'tunnel.create',
        resourceType: 'tunnel',
        targetId: 'tunnel-port-forward',
        targetLabel: 'port-forwarding tunnel',
        summary: 'create executable port-forwarding tunnel runtime',
        metadata: {
          type: 'port-forward',
          entryAgentIds: ['agent-hkg-01'],
          exitAgentIds: ['agent-sin-02'],
          protocol: 'tcp+udp',
          listenPort: 2443,
          targetAddress: '172.20.8.10',
          targetPort: 9443
        }
      })
    ).toMatchObject({
      operation: 'tunnel.create',
      metadata: {
        type: 'port-forward',
        listenPort: 2443,
        targetAddress: '172.20.8.10',
        targetPort: 9443
      }
    });

    expect(() =>
      createTaskRequestSchema.parse({
        operation: 'tunnel.create',
        resourceType: 'tunnel',
        targetId: 'tunnel-missing-runtime',
        targetLabel: 'missing tunnel runtime',
        summary: 'reject incomplete tunnel runtime',
        metadata: {
          type: 'port-forward',
          entryAgentIds: ['agent-hkg-01'],
          exitAgentIds: ['agent-sin-02'],
          protocol: 'tcp+udp'
        }
      })
    ).toThrow();
  });

  it('validates one-click Agent install command requests with the complete runtime profile', () => {
    expect(
      agentInstallCommandRequestSchema.parse({
        installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel'],
        publicBaseUrl: 'https://panel.example.com/x7K2mP9vL4qR1wDz'
      })
    ).toMatchObject({
      installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
    });

    expect(() =>
      agentInstallCommandRequestSchema.parse({
        installProfile: ['host-agent', 'xray', 'port-forwarding']
      })
    ).toThrow();

    expect(() =>
      agentInstallCommandRequestSchema.parse({
        installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel'],
        publicBaseUrl: 'not-a-url'
      })
    ).toThrow();

    expect(() =>
      agentInstallCommandRequestSchema.parse({
        installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel'],
        hostName: 'edge-hkg-01',
        displayName: '香港入口'
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
    const api = createMockApi({ seedInventory: true });

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
      createTaskRequestSchema.parse({
        operation: 'agent.update',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: '香港入口主机',
        summary: '更新受控主机资料',
        metadata: {
          agentId: 'agent-hkg-01',
          hostName: 'edge-renamed-01',
          runtimeHostName: 'edge-runtime-01',
          maxTrafficGb: 2048,
          monthlyTrafficGb: 512,
          trafficAccountingMode: 'egress',
          monthlyResetDay: 7,
          currentUsedTrafficGb: 256,
          expiresAt: '2026-12-31T23:59:59.000Z',
          pingTarget: 'www.cloudflare.com',
          pingIntervalSeconds: 30
        }
      })
    ).toMatchObject({
      operation: 'agent.update',
      metadata: {
        hostName: 'edge-renamed-01',
        runtimeHostName: 'edge-runtime-01',
        maxTrafficGb: 2048,
        monthlyTrafficGb: 512,
        trafficAccountingMode: 'egress',
        monthlyResetDay: 7,
        currentUsedTrafficGb: 256,
        expiresAt: '2026-12-31T23:59:59.000Z',
        pingTarget: 'www.cloudflare.com',
        pingIntervalSeconds: 30
      }
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

    expect(() =>
      createTaskRequestSchema.parse({
        operation: 'agent.update',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'invalid ping interval',
        summary: 'invalid host profile metadata',
        metadata: {
          pingIntervalSeconds: 60
        }
      })
    ).toThrow();

    expect(() =>
      createTaskRequestSchema.parse({
        operation: 'agent.update',
        resourceType: 'agent',
        targetId: 'agent-hkg-01',
        targetLabel: 'invalid reset day',
        summary: 'invalid host profile metadata',
        metadata: {
          monthlyResetDay: 32
        }
      })
    ).toThrow();
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

  it('accepts Agent forwarding traffic counter telemetry samples', () => {
    expect(
      agentEventsRequestSchema.parse({
        events: [
          {
            type: 'telemetry_sample',
            eventId: 'evt-forwarding-counter-001',
            agentId: 'agent-edge-01',
            seq: 7,
            sessionId: 'sess-agent-edge-01',
            observedAt: '2026-06-04T00:00:00.000Z',
            payload: {
              trafficAccountingMode: 'ingress',
              monthlyResetDay: 31,
              manualUsedTrafficBytes: 4096,
              monthlyTrafficLimitBytes: 8192,
              trafficBillingPeriod: '2026-06-reset-31',
              quotaExceeded: true,
              hostExpired: false,
              runtimeDisabledByPolicy: true,
              guardrailReason: 'monthly_traffic_quota_exceeded',
              latencyStatus: 'yellow',
              loadAverage1m: 0.42,
              loadAverage5m: 0.35,
              loadAverage15m: 0.31,
              runtimeServices: [
                {
                  name: 'ou-ui-agent.service',
                  moduleKind: 'agent',
                  status: 'active',
                  enabled: true,
                  required: true,
                  checkedAt: '2026-06-04T00:00:00.000Z'
                },
                {
                  name: 'ou-ui-xray.service',
                  moduleKind: 'xray',
                  status: 'missing',
                  enabled: false,
                  required: true,
                  checkedAt: '2026-06-04T00:00:00.000Z',
                  detail: 'unit file not found'
                }
              ],
              xrayClientCounters: [
                {
                  inboundId: 'customer-node-hkg-vless',
                  inboundTag: 'ou-customer-node-hkg-vless',
                  agentId: 'agent-edge-01',
                  clientEmail: 'acme@example.com',
                  clientId: '0d0f5137-8ef8-4e52-bdd6-60f06d3d6b7f',
                  uplinkBytes: 1024,
                  downlinkBytes: 2048,
                  usedTrafficBytes: 4096,
                  trafficLimitBytes: 8192,
                  monthlyResetDay: 31,
                  quotaExceeded: false,
                  clientExpired: false,
                  runtimeDisabledByPolicy: false,
                  guardrailReason: 'ok',
                  sampledAt: '2026-06-04T00:00:00.000Z',
                  trafficBillingPeriod: '2026-06-reset-31',
                  source: 'xray-stats'
                },
                {
                  inboundId: 'customer-node-hkg-vless',
                  inboundTag: 'ou-customer-node-hkg-vless',
                  agentId: 'agent-edge-01',
                  clientEmail: 'acme@example.com',
                  clientId: '0d0f5137-8ef8-4e52-bdd6-60f06d3d6b7f',
                  trafficLimitBytes: 8192,
                  monthlyResetDay: 31,
                  quotaExceeded: false,
                  clientExpired: true,
                  runtimeDisabledByPolicy: true,
                  guardrailReason: 'xray_client_expired',
                  sampledAt: '2026-06-04T00:00:00.000Z',
                  trafficBillingPeriod: '2026-06-reset-31',
                  source: 'xray-guardrail'
                }
              ],
              forwardingCounters: [
                {
                  ruleId: 'forward-custom-2443',
                  agentId: 'agent-edge-01',
                  serviceName: 'ou-forward-forward-custom-2443-agent-edge-01',
                  listenAddress: '0.0.0.0',
                  listenPort: 2443,
                  targetAddress: '10.10.0.8',
                  targetPort: 9443,
                  protocol: 'tcp+udp',
                  inboundBytes: 1024,
                  outboundBytes: 2048,
                  sampledAt: '2026-06-04T00:00:00.000Z',
                  source: 'nftables',
                  trafficBillingPeriod: '2026-06-reset-31'
                }
              ],
              forwardingGuardrails: [
                {
                  ruleId: 'forward-custom-2443',
                  serviceName: 'ou-forward-forward-custom-2443-agent-edge-01',
                  quotaBytes: 2048,
                  billedTrafficBytes: 3072,
                  quotaExceeded: true,
                  runtimeDisabledByPolicy: true,
                  guardrailReason: 'rule_monthly_quota_exceeded',
                  stoppedUnits: ['ou-forward-forward-custom-2443-agent-edge-01-tcp.service'],
                  evaluatedAt: '2026-06-04T00:00:00.000Z',
                  trafficBillingPeriod: '2026-06-reset-31'
                }
              ]
            }
          }
        ]
      })
    ).toMatchObject({
      events: [
        {
          type: 'telemetry_sample',
          payload: {
            trafficAccountingMode: 'ingress',
            monthlyResetDay: 31,
            manualUsedTrafficBytes: 4096,
            monthlyTrafficLimitBytes: 8192,
            trafficBillingPeriod: '2026-06-reset-31',
            quotaExceeded: true,
            hostExpired: false,
            runtimeDisabledByPolicy: true,
            guardrailReason: 'monthly_traffic_quota_exceeded',
            latencyStatus: 'yellow',
            loadAverage1m: 0.42,
            loadAverage5m: 0.35,
            loadAverage15m: 0.31,
            runtimeServices: [
              {
                name: 'ou-ui-agent.service',
                moduleKind: 'agent',
                status: 'active',
                enabled: true,
                required: true
              },
              {
                name: 'ou-ui-xray.service',
                moduleKind: 'xray',
                status: 'missing',
                required: true,
                detail: 'unit file not found'
              }
            ],
            xrayClientCounters: [
              {
                inboundId: 'customer-node-hkg-vless',
                clientEmail: 'acme@example.com',
                source: 'xray-stats',
                trafficBillingPeriod: '2026-06-reset-31',
                runtimeDisabledByPolicy: false,
                guardrailReason: 'ok'
              },
              {
                inboundId: 'customer-node-hkg-vless',
                clientEmail: 'acme@example.com',
                source: 'xray-guardrail',
                trafficBillingPeriod: '2026-06-reset-31',
                runtimeDisabledByPolicy: true,
                guardrailReason: 'xray_client_expired'
              }
            ],
            forwardingCounters: [
              {
                ruleId: 'forward-custom-2443',
                source: 'nftables',
                trafficBillingPeriod: '2026-06-reset-31'
              }
            ],
            forwardingGuardrails: [
              {
                ruleId: 'forward-custom-2443',
                quotaExceeded: true,
                runtimeDisabledByPolicy: true,
                guardrailReason: 'rule_monthly_quota_exceeded',
                trafficBillingPeriod: '2026-06-reset-31'
              }
            ]
          }
        }
      ]
    });
  });

  it('validates Agent log retention policy updates with a zero per-Agent cap', () => {
    expect(
      parseAgentLogRetentionPolicyUpdateRequest({
        maxAgeDays: 14,
        maxEventsPerAgent: 0,
        reason: 'operator retention override'
      })
    ).toEqual({
      maxAgeDays: 14,
      maxEventsPerAgent: 0,
      reason: 'operator retention override'
    });

    expect(() =>
      agentLogRetentionPolicyUpdateRequestSchema.parse({
        maxAgeDays: 0,
        maxEventsPerAgent: 100
      })
    ).toThrow();
    expect(() =>
      agentLogRetentionPolicyUpdateRequestSchema.parse({
        maxAgeDays: 7,
        maxEventsPerAgent: 1.5
      })
    ).toThrow();
  });
});
