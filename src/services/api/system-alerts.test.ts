import type { Agent, DeployTask, QuotaPolicy } from '../../domain';
import type { CommandOutboxItem } from './control-plane-api';
import {
  createSystemAlertsFromAgents,
  createSystemAlertsFromAuditWriteFailures,
  createSystemAlertsFromCommandOutbox,
  createSystemAlertsFromQuotaPolicies,
  createSystemAlertsFromRuntimeTasks
} from './system-alerts';

function createAgent(overrides: Partial<Omit<Agent, 'telemetry'>> & { telemetry?: Partial<Agent['telemetry']> } = {}): Agent {
  const agent: Agent = {
    id: 'agent-edge-01',
    name: 'Edge 01',
    status: 'online',
    region: 'custom',
    publicAddress: '198.51.100.10',
    connectionMode: 'pull',
    version: '1.0.0-runtime',
    platform: 'linux/amd64',
    capabilities: ['host-agent', 'xray', 'port-forwarding'],
    maxTrafficBytes: 0,
    monthlyTrafficLimitBytes: 0,
    expiresAt: '',
    probeConfig: {
      pingTarget: '1.1.1.1',
      pingIntervalSeconds: 30,
      latencyGreenMaxMs: 100,
      latencyYellowMaxMs: 200
    },
    trafficPolicy: {
      accountingMode: 'both',
      monthlyResetDay: 1,
      manualUsedTrafficBytes: 0,
      telemetrySource: 'agent'
    },
    hardware: {},
    lastHeartbeatAt: '2026-06-04T04:05:00.000Z',
    telemetry: {
      cpuPercent: 0,
      memoryPercent: 0,
      memoryUsedBytes: 0,
      memoryTotalBytes: 0,
      diskUsedBytes: 0,
      diskTotalBytes: 0,
      txBytes: 0,
      rxBytes: 0,
      uploadSpeedBps: 0,
      downloadSpeedBps: 0,
      uploadTotalBytes: 0,
      downloadTotalBytes: 0,
      monthlyTrafficUsedBytes: 0,
      latencyMs: 0,
      latencySamplesMs: [],
      packetLossPercent: 0,
      packetLossSamplesPercent: [],
      onlineDays: 0,
      reportedAt: '2026-06-04T04:00:00.000Z',
      samplingExpectedSince: '2026-06-04T04:00:00.000Z',
      sampleGapDetected: true,
      sampleGapSeconds: 180,
      expectedSamplingIntervalSeconds: 30,
      sampleGapReason: 'stale_telemetry_sample'
    }
  };

  return {
    ...agent,
    ...overrides,
    telemetry: {
      ...agent.telemetry,
      ...overrides.telemetry
    }
  };
}

function createCommandOutboxItem(overrides: Partial<CommandOutboxItem> = {}): CommandOutboxItem {
  return {
    id: 'outbox-command-001',
    taskId: 'task-command-001',
    commandId: 'cmd-command-001',
    agentId: 'agent-edge-01',
    seq: 1,
    status: 'pending',
    transport: 'http-pull',
    command: {} as CommandOutboxItem['command'],
    attempts: 1,
    createdAt: '2026-06-04T04:00:00.000Z',
    updatedAt: '2026-06-04T04:00:10.000Z',
    deadlineAt: '2026-06-04T04:01:00.000Z',
    ...overrides
  };
}

function createQuotaPolicy(overrides: Partial<QuotaPolicy> = {}): QuotaPolicy {
  return {
    id: 'managed-host:agent-edge-01',
    name: 'Edge 01 monthly quota',
    scope: 'managed-host',
    limitBytes: 1000,
    usedBytes: 1200,
    resetWindow: 'monthly',
    billingDirection: 'both',
    enforcementState: 'exceeded',
    resourceId: 'agent-edge-01',
    detail: '198.51.100.10',
    resetDay: 1,
    reportedAt: '2026-06-04T04:00:00.000Z',
    runtimeDisabledByPolicy: false,
    guardrailReason: 'monthly_traffic_quota_exceeded',
    ...overrides
  };
}

function createTask(overrides: Partial<DeployTask> = {}): DeployTask {
  return {
    id: 'task-runtime-reload-001',
    operation: 'runtime.reload',
    resourceType: 'module',
    resourceId: 'xray-runtime-hkg',
    status: 'failed',
    targetId: 'xray-runtime-hkg',
    targetLabel: 'Xray Runtime HKG',
    summary: 'Reload Xray runtime',
    createdAt: '2026-06-04T04:00:00.000Z',
    updatedAt: '2026-06-04T04:02:00.000Z',
    actor: 'admin',
    requestedBy: 'admin',
    requestId: 'req-runtime-reload-001',
    sourceIp: '127.0.0.1',
    rollbackAvailable: false,
    attempts: 1,
    steps: [],
    failureReason: 'xray reload failed',
    ...overrides
  };
}

describe('system alerts', () => {
  it('creates operator-visible alerts from Agent telemetry sampling gaps', () => {
    const [alert] = createSystemAlertsFromAgents([createAgent()]);

    expect(alert).toMatchObject({
      id: 'alert-agent-telemetry-sampling-gap-agent-edge-01',
      kind: 'agent.telemetry_sampling_gap',
      severity: 'warning',
      status: 'active',
      resourceType: 'agent',
      resourceId: 'agent-edge-01',
      resourceLabel: 'Edge 01',
      observedAt: '2026-06-04T04:00:00.000Z',
      dedupeKey: 'agent:agent-edge-01:telemetry_sampling_gap',
      metadata: expect.objectContaining({
        sampleGapSeconds: 180,
        expectedSamplingIntervalSeconds: 30,
        sampleGapReason: 'stale_telemetry_sample'
      })
    });
  });

  it('creates critical alerts from offline Agent liveness state', () => {
    const alerts = createSystemAlertsFromAgents(
      [
        createAgent({
          status: 'offline',
          lastHeartbeatAt: '2026-06-04T04:00:00.000Z',
          telemetry: {
            sampleGapDetected: false,
            sampleGapSeconds: 0,
            sampleGapReason: undefined,
            reportedAt: '2026-06-04T03:55:00.000Z'
          }
        })
      ],
      '2026-06-04T04:05:00.000Z'
    );

    expect(alerts).toEqual([
      expect.objectContaining({
        id: 'alert-agent-offline-agent-edge-01',
        kind: 'agent.offline',
        severity: 'critical',
        status: 'active',
        resourceType: 'agent',
        resourceId: 'agent-edge-01',
        resourceLabel: 'Edge 01',
        observedAt: '2026-06-04T04:05:00.000Z',
        dedupeKey: 'agent:agent-edge-01:offline',
        metadata: expect.objectContaining({
          agentStatus: 'offline',
          lastRuntimeSignalAt: '2026-06-04T04:00:00.000Z',
          lastTelemetryAt: '2026-06-04T03:55:00.000Z',
          lastHeartbeatAt: '2026-06-04T04:00:00.000Z',
          offlineAfterSeconds: 300,
          expectedSamplingIntervalSeconds: 30
        })
      })
    ]);
  });

  it('promotes long sampling gaps or offline hosts to critical alerts', () => {
    expect(
      createSystemAlertsFromAgents([
        createAgent({
          status: 'offline',
          telemetry: {
            sampleGapSeconds: 120,
            sampleGapReason: 'no_telemetry_sample'
          }
        })
      ])
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'agent.telemetry_sampling_gap',
        severity: 'critical'
      })
    ]));

    expect(
      createSystemAlertsFromAgents([
        createAgent({
          telemetry: {
            sampleGapSeconds: 600
          }
        })
      ])
    ).toEqual([
      expect.objectContaining({
        severity: 'critical'
      })
    ]);
  });

  it('creates operator-visible alerts from required Agent runtime service failures', () => {
    const alerts = createSystemAlertsFromAgents([
      createAgent({
        telemetry: {
          sampleGapDetected: false,
          sampleGapSeconds: 0,
          sampleGapReason: undefined,
          runtimeServices: [
            {
              name: 'ou-ui-xray.service',
              moduleKind: 'xray',
              status: 'missing',
              enabled: false,
              required: true,
              checkedAt: '2026-06-04T04:02:00.000Z',
              detail: 'unit file not found'
            },
            {
              name: 'ou-ui-agent.service',
              moduleKind: 'agent',
              status: 'active',
              enabled: true,
              required: true,
              checkedAt: '2026-06-04T04:02:00.000Z'
            },
            {
              name: 'ou-forward-optional.service',
              moduleKind: 'port-forwarding',
              status: 'inactive',
              enabled: false,
              required: false,
              checkedAt: '2026-06-04T04:02:00.000Z'
            }
          ]
        }
      })
    ]);

    expect(alerts).toEqual([
      expect.objectContaining({
        id: 'alert-agent-runtime-service-agent-edge-01-ou-ui-xray.service',
        kind: 'agent.runtime_service_unhealthy',
        severity: 'critical',
        resourceType: 'agent',
        resourceId: 'agent-edge-01',
        observedAt: '2026-06-04T04:02:00.000Z',
        dedupeKey: 'agent:agent-edge-01:runtime_service:ou-ui-xray.service',
        metadata: expect.objectContaining({
          serviceName: 'ou-ui-xray.service',
          serviceModuleKind: 'xray',
          serviceStatus: 'missing',
          serviceEnabled: false,
          serviceRequired: true,
          serviceDetail: 'unit file not found'
        })
      })
    ]);
  });

  it('keeps inactive or unknown required runtime services at warning severity', () => {
    expect(
      createSystemAlertsFromAgents([
        createAgent({
          telemetry: {
            sampleGapDetected: false,
            sampleGapSeconds: 0,
            sampleGapReason: undefined,
            runtimeServices: [
              {
                name: 'ou-forward-acme-tcp.service',
                moduleKind: 'port-forwarding',
                status: 'inactive',
                enabled: true,
                required: true,
                checkedAt: '2026-06-04T04:02:00.000Z'
              }
            ]
          }
        })
      ])
    ).toEqual([
      expect.objectContaining({
        kind: 'agent.runtime_service_unhealthy',
        severity: 'warning'
      })
    ]);
  });

  it('creates critical alerts from Agent red latency above the configured threshold', () => {
    const alerts = createSystemAlertsFromAgents([
      createAgent({
        telemetry: {
          sampleGapDetected: false,
          sampleGapSeconds: 0,
          sampleGapReason: undefined,
          latencyMs: 245,
          latencyStatus: 'red'
        }
      })
    ]);

    expect(alerts).toEqual([
      expect.objectContaining({
        id: 'alert-agent-high-latency-agent-edge-01',
        kind: 'agent.high_latency',
        severity: 'critical',
        status: 'active',
        resourceType: 'agent',
        resourceId: 'agent-edge-01',
        observedAt: '2026-06-04T04:00:00.000Z',
        dedupeKey: 'agent:agent-edge-01:high_latency',
        metadata: expect.objectContaining({
          agentStatus: 'online',
          latencyMs: 245,
          latencyStatus: 'red',
          latencyGreenMaxMs: 100,
          latencyYellowMaxMs: 200,
          lastTelemetryAt: '2026-06-04T04:00:00.000Z'
        })
      })
    ]);
  });

  it('derives high latency alerts from thresholds when Agent omits the latency status band', () => {
    expect(
      createSystemAlertsFromAgents([
        createAgent({
          probeConfig: {
            pingTarget: '1.1.1.1',
            pingIntervalSeconds: 30,
            latencyGreenMaxMs: 120,
            latencyYellowMaxMs: 240
          },
          telemetry: {
            sampleGapDetected: false,
            sampleGapSeconds: 0,
            sampleGapReason: undefined,
            latencyMs: 241,
            latencyStatus: undefined
          }
        })
      ])
    ).toEqual([
      expect.objectContaining({
        kind: 'agent.high_latency',
        metadata: expect.objectContaining({
          latencyMs: 241,
          latencyYellowMaxMs: 240
        })
      })
    ]);
  });

  it('does not create high latency alerts while latency remains yellow', () => {
    expect(
      createSystemAlertsFromAgents([
        createAgent({
          telemetry: {
            sampleGapDetected: false,
            sampleGapSeconds: 0,
            sampleGapReason: undefined,
            latencyMs: 200,
            latencyStatus: 'yellow'
          }
        })
      ])
    ).toEqual([]);
  });

  it('does not create alerts when the telemetry sampler is healthy', () => {
    expect(
      createSystemAlertsFromAgents([
        createAgent({
          telemetry: {
            sampleGapDetected: false,
            sampleGapSeconds: 0,
            sampleGapReason: undefined
          }
        })
      ])
    ).toEqual([]);
  });

  it('creates operator-visible alerts from overdue command outbox backlog', () => {
    const alerts = createSystemAlertsFromCommandOutbox(
      [
        createCommandOutboxItem({
          status: 'pending',
          deadlineAt: '2026-06-04T04:00:30.000Z'
        }),
        createCommandOutboxItem({
          id: 'outbox-command-002',
          commandId: 'cmd-command-002',
          status: 'completed',
          deadlineAt: '2026-06-04T04:00:30.000Z'
        }),
        createCommandOutboxItem({
          id: 'outbox-command-003',
          commandId: 'cmd-command-003',
          status: 'acknowledged',
          deadlineAt: '2026-06-04T04:05:00.000Z'
        })
      ],
      '2026-06-04T04:02:00.000Z'
    );

    expect(alerts).toEqual([
      expect.objectContaining({
        id: 'alert-command-outbox-overdue',
        kind: 'command_outbox.overdue',
        severity: 'warning',
        resourceType: 'command_outbox',
        resourceId: 'command-outbox',
        observedAt: '2026-06-04T04:00:00.000Z',
        dedupeKey: 'command_outbox:overdue',
        metadata: expect.objectContaining({
          overdueCount: 1,
          sampleCommandId: 'cmd-command-001',
          sampleTaskId: 'task-command-001',
          sampleAgentId: 'agent-edge-01',
          sampleStatus: 'pending'
        })
      })
    ]);
  });

  it('creates critical alerts from dead-letter command outbox entries', () => {
    const alerts = createSystemAlertsFromCommandOutbox(
      [
        createCommandOutboxItem({
          status: 'dead_letter',
          updatedAt: '2026-06-04T04:04:00.000Z',
          lastError: 'Agent result timeout'
        }),
        createCommandOutboxItem({
          id: 'outbox-command-002',
          commandId: 'cmd-command-002',
          status: 'dead_letter',
          updatedAt: '2026-06-04T04:05:00.000Z'
        })
      ],
      '2026-06-04T04:06:00.000Z'
    );

    expect(alerts).toEqual([
      expect.objectContaining({
        id: 'alert-command-outbox-dead-letter',
        kind: 'command_outbox.dead_letter',
        severity: 'critical',
        resourceType: 'command_outbox',
        resourceId: 'command-outbox',
        observedAt: '2026-06-04T04:05:00.000Z',
        dedupeKey: 'command_outbox:dead_letter',
        metadata: expect.objectContaining({
          deadLetterCount: 2,
          sampleCommandId: 'cmd-command-001',
          latestUpdatedAt: '2026-06-04T04:05:00.000Z'
        })
      })
    ]);
  });

  it('creates runtime reload failed alerts from the latest failed reload per target', () => {
    const alerts = createSystemAlertsFromRuntimeTasks(
      [
        createTask({
          id: 'task-runtime-reload-old',
          status: 'failed',
          updatedAt: '2026-06-04T03:00:00.000Z',
          failureReason: 'old failure'
        }),
        createTask({
          id: 'task-runtime-reload-latest',
          status: 'failed',
          updatedAt: '2026-06-04T04:02:00.000Z',
          failureReason: 'xray reload failed after config validation'
        }),
        createTask({
          id: 'task-runtime-reload-other-target',
          targetId: 'xray-runtime-sin',
          targetLabel: 'Xray Runtime SIN',
          status: 'succeeded',
          updatedAt: '2026-06-04T04:03:00.000Z',
          failureReason: undefined
        })
      ],
      '2026-06-04T04:05:00.000Z'
    );

    expect(alerts).toEqual([
      expect.objectContaining({
        id: 'alert-runtime-reload-failed-xray-runtime-hkg',
        kind: 'runtime.reload_failed',
        severity: 'critical',
        status: 'active',
        resourceType: 'runtime_release',
        resourceId: 'xray-runtime-hkg',
        resourceLabel: 'Xray Runtime HKG',
        observedAt: '2026-06-04T04:02:00.000Z',
        dedupeKey: 'runtime_reload:xray-runtime-hkg:failed',
        metadata: expect.objectContaining({
          taskId: 'task-runtime-reload-latest',
          operation: 'runtime.reload',
          taskStatus: 'failed',
          failedAt: '2026-06-04T04:02:00.000Z',
          failureReason: 'xray reload failed after config validation',
          attempts: 1
        })
      })
    ]);
  });

  it('resolves runtime reload failed alerts after a newer successful reload for the same target', () => {
    expect(
      createSystemAlertsFromRuntimeTasks(
        [
          createTask({
            id: 'task-runtime-reload-failed',
            status: 'failed',
            updatedAt: '2026-06-04T04:02:00.000Z'
          }),
          createTask({
            id: 'task-runtime-reload-recovered',
            status: 'succeeded',
            updatedAt: '2026-06-04T04:04:00.000Z',
            failureReason: undefined
          })
        ],
        '2026-06-04T04:05:00.000Z'
      )
    ).toEqual([]);
  });

  it('creates audit write failed alerts from HTTP runtime audit failure counts', () => {
    expect(
      createSystemAlertsFromAuditWriteFailures(
        {
          writeFailures: 2,
          firstFailureAt: '2026-06-04T04:00:00.000Z',
          lastFailureAt: '2026-06-04T04:02:00.000Z'
        },
        '2026-06-04T04:05:00.000Z'
      )
    ).toEqual([
      expect.objectContaining({
        id: 'alert-audit-write-failed',
        kind: 'audit.write_failed',
        severity: 'critical',
        status: 'active',
        resourceType: 'audit',
        resourceId: 'audit-ledger',
        resourceLabel: 'Audit ledger',
        observedAt: '2026-06-04T04:00:00.000Z',
        dedupeKey: 'audit:write_failed',
        metadata: expect.objectContaining({
          writeFailures: 2,
          firstFailureAt: '2026-06-04T04:00:00.000Z',
          lastFailureAt: '2026-06-04T04:02:00.000Z'
        })
      })
    ]);

    expect(createSystemAlertsFromAuditWriteFailures({ writeFailures: 0 }, '2026-06-04T04:05:00.000Z')).toEqual([]);
  });

  it('creates quota exceeded alerts from exceeded quota policies', () => {
    const alerts = createSystemAlertsFromQuotaPolicies(
      [
        createQuotaPolicy(),
        createQuotaPolicy({
          id: 'user:sub-client-active',
          name: 'Active subscription user',
          scope: 'user',
          usedBytes: 100,
          enforcementState: 'active',
          guardrailReason: undefined
        })
      ],
      '2026-06-04T04:05:00.000Z'
    );

    expect(alerts).toEqual([
      expect.objectContaining({
        id: 'alert-quota-exceeded-managed-host-agent-edge-01',
        kind: 'quota.exceeded',
        severity: 'warning',
        resourceType: 'quota_policy',
        resourceId: 'managed-host:agent-edge-01',
        resourceLabel: 'Edge 01 monthly quota',
        observedAt: '2026-06-04T04:00:00.000Z',
        dedupeKey: 'quota_policy:managed-host:agent-edge-01:exceeded',
        metadata: expect.objectContaining({
          quotaPolicyId: 'managed-host:agent-edge-01',
          quotaScope: 'managed-host',
          quotaResourceId: 'agent-edge-01',
          enforcementState: 'exceeded',
          limitBytes: 1000,
          usedBytes: 1200,
          usageRatioPercent: 100,
          billingDirection: 'both',
          resetWindow: 'monthly',
          guardrailReason: 'monthly_traffic_quota_exceeded'
        })
      })
    ]);
  });

  it('promotes runtime-disabled quota policies to critical alerts', () => {
    expect(
      createSystemAlertsFromQuotaPolicies(
        [
          createQuotaPolicy({
            enforcementState: 'disabled_by_quota',
            runtimeDisabledByPolicy: true
          })
        ],
        '2026-06-04T04:05:00.000Z'
      )
    ).toEqual([
      expect.objectContaining({
        kind: 'quota.exceeded',
        severity: 'critical',
        metadata: expect.objectContaining({
          enforcementState: 'disabled_by_quota',
          runtimeDisabledByPolicy: true
        })
      })
    ]);
  });
});
