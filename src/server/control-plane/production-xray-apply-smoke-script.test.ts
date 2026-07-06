import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

type XrayApplySmokeScript = {
  allocateXrayListenPort(
    snapshot: Record<string, unknown>,
    agentId: string,
    options?: { listenPort?: number; portMin?: number; portMax?: number }
  ): number;
  buildXrayInboundTaskInput(options: {
    agentId: string;
    listenPort: number;
    serverAddress: string;
    targetId?: string;
    targetLabel?: string;
    targetPrefix?: string;
    clientIdentity?: string;
    clientEmail?: string;
    clientCredential?: string;
    expiresAt?: string;
    nowMs?: number;
  }): Record<string, unknown>;
  buildXrayClientAddActionRequest(
    createTaskInput: Record<string, unknown>,
    options?: {
      clientIdentity?: string;
      clientEmail?: string;
      clientCredential?: string;
      trafficLimitGb?: number;
      remainingDays?: number;
      ipLimit?: number;
      subscriptionRule?: string;
      reason?: string;
    }
  ): Record<string, unknown>;
  buildXrayClientDeleteActionRequest(
    createTaskInput: Record<string, unknown>,
    options?: {
      clientEmail?: string;
      clientId?: string;
      reason?: string;
    }
  ): Record<string, unknown>;
  buildXrayInboundDeleteTaskInput(
    createTaskInput: Record<string, unknown>,
    options?: {
      summary?: string;
      targetLabel?: string;
    }
  ): Record<string, unknown>;
  buildXrayInboundUpdateTaskInput(
    createTaskInput: Record<string, unknown>,
    options?: {
      clientComment?: string;
      sniffingEnabled?: boolean;
      targetLabel?: string;
      trafficLimitGb?: number;
    }
  ): Record<string, unknown>;
  collectReservedXrayPorts(snapshot: Record<string, unknown>, agentId: string): Set<number>;
  extractXrayApplyEvidence(
    snapshot: Record<string, unknown>,
    taskId: string,
    targetId: string
  ): Record<string, unknown>;
  parseArgs(argv: string[]): Record<string, unknown>;
  resolveXrayApplySmokeConfig(
    env: Record<string, string | undefined>,
    argv: string[]
  ): {
    baseUrl: URL;
    username: string;
    password: string;
    agentId?: string;
    listenPort?: number;
    portMin: number;
    portMax: number;
    waitMs: number;
    pollIntervalMs: number;
    cleanup: boolean;
    serverAddress: string;
    reportPath?: string;
  };
  selectXrayAgent(snapshot: Record<string, unknown>, preferredAgentId?: string): Record<string, unknown>;
  summarizeXrayApplyEvidence(evidence: Record<string, unknown>): Record<string, unknown>;
  validateXrayApplyEvidence(evidence: Record<string, unknown>, expected?: Record<string, unknown>): string[];
};

const xraySmokeScript = require('../../../scripts/production-xray-apply-smoke.cjs') as XrayApplySmokeScript;

function createVerifiedSnapshot() {
  return {
    agents: [
      {
        id: 'agent-fra-01',
        status: 'offline',
        capabilities: ['host-agent', 'xray']
      },
      {
        id: 'agent-hkg-01',
        status: 'online',
        capabilities: ['host-agent', 'xray', 'port-forwarding']
      }
    ],
    inbounds: [
      {
        id: 'inbound-existing',
        agentId: 'agent-hkg-01',
        listenPort: 42000
      }
    ],
    tasks: [
      {
        id: 'task-apply-01',
        operation: 'inbound.create',
        resourceType: 'inbound',
        targetId: 'xray-live-smoke-42003',
        status: 'succeeded'
      },
      {
        id: 'task-update-01',
        operation: 'inbound.update',
        resourceType: 'inbound',
        targetId: 'xray-live-smoke-42003',
        status: 'succeeded'
      }
    ],
    commandOutbox: [
      {
        taskId: 'task-apply-01',
        commandId: 'cmd-task-apply-01',
        status: 'completed',
        agentId: 'agent-hkg-01'
      },
      {
        taskId: 'task-update-01',
        commandId: 'cmd-task-update-01',
        status: 'completed',
        agentId: 'agent-hkg-01'
      }
    ],
    configRevisions: [
      {
        id: 'cfg-task-apply-01',
        taskId: 'task-apply-01',
        targetId: 'xray-live-smoke-42003',
        status: 'applied',
        agentId: 'agent-hkg-01',
        createdAt: '2026-07-07T00:00:00.000Z',
        appliedAt: '2026-07-07T00:00:01.000Z',
        artifact: {
          runtimeDiagnosis: {
            state: 'ready',
            evidenceStage: 'agent-result-verified',
            hasRuntimeEvidence: true,
            plannedRuntimeServices: ['ou-ui-xray.service'],
            plannedInbound: {
              agentId: 'agent-hkg-01',
              listenAddress: '0.0.0.0',
              listenPort: 42003,
              protocol: 'vless',
              action: 'upsert_inbound'
            }
          }
        }
      },
      {
        id: 'cfg-task-update-01',
        taskId: 'task-update-01',
        targetId: 'xray-live-smoke-42003',
        status: 'applied',
        agentId: 'agent-hkg-01',
        createdAt: '2026-07-07T00:01:00.000Z',
        appliedAt: '2026-07-07T00:01:01.000Z',
        artifact: {
          runtimeDiagnosis: {
            state: 'ready',
            evidenceStage: 'agent-result-verified',
            hasRuntimeEvidence: true,
            plannedRuntimeServices: ['ou-ui-xray.service'],
            plannedInbound: {
              agentId: 'agent-hkg-01',
              listenAddress: '0.0.0.0',
              listenPort: 42003,
              protocol: 'vless',
              action: 'upsert_inbound'
            }
          }
        }
      },
      {
        id: 'cfg-reserved',
        taskId: 'task-reserved',
        targetId: 'xray-live-smoke-42001',
        status: 'applied',
        createdAt: '2026-07-07T00:02:00.000Z',
        appliedAt: '2026-07-07T00:02:01.000Z',
        artifact: {
          runtimeDiagnosis: {
            plannedInbound: {
              agentId: 'agent-hkg-01',
              listenPort: 42001,
              protocol: 'vless',
              action: 'upsert_inbound'
            }
          }
        }
      }
    ],
    preflightPlans: [
      {
        id: 'preflight-task-apply-01',
        taskId: 'task-apply-01',
        status: 'passed',
        checks: []
      },
      {
        id: 'preflight-task-update-01',
        taskId: 'task-update-01',
        status: 'passed',
        checks: []
      }
    ],
    runtimeSnapshots: [
      {
        id: 'snapshot-before-xray-live-smoke-42003',
        taskId: 'task-apply-01',
        status: 'verified',
        agentId: 'agent-hkg-01'
      },
      {
        id: 'snapshot-before-xray-live-smoke-42003-update',
        taskId: 'task-update-01',
        status: 'verified',
        agentId: 'agent-hkg-01'
      }
    ]
  };
}

function createVerifiedClientActionSnapshot() {
  const snapshot = createVerifiedSnapshot();

  return {
    ...snapshot,
    tasks: [
      ...(snapshot.tasks as Array<Record<string, unknown>>),
      {
        id: 'task-add-client-01',
        operation: 'inbound.update',
        resourceType: 'inbound',
        targetId: 'xray-live-smoke-42003',
        status: 'succeeded',
        metadata: {
          xrayClientAction: 'add-client',
          xrayClientActionTargetEmail: 'carol@example.test'
        }
      },
      {
        id: 'task-delete-client-01',
        operation: 'inbound.update',
        resourceType: 'inbound',
        targetId: 'xray-live-smoke-42003',
        status: 'succeeded',
        metadata: {
          xrayClientAction: 'delete-client',
          xrayClientActionTargetEmail: 'carol@example.test'
        }
      }
    ],
    commandOutbox: [
      ...(snapshot.commandOutbox as Array<Record<string, unknown>>),
      {
        taskId: 'task-add-client-01',
        commandId: 'cmd-task-add-client-01',
        status: 'completed',
        agentId: 'agent-hkg-01'
      },
      {
        taskId: 'task-delete-client-01',
        commandId: 'cmd-task-delete-client-01',
        status: 'completed',
        agentId: 'agent-hkg-01'
      }
    ],
    configRevisions: [
      ...(snapshot.configRevisions as Array<Record<string, unknown>>),
      {
        id: 'cfg-task-add-client-01',
        taskId: 'task-add-client-01',
        targetId: 'xray-live-smoke-42003',
        status: 'applied',
        agentId: 'agent-hkg-01',
        createdAt: '2026-07-07T00:03:00.000Z',
        appliedAt: '2026-07-07T00:03:01.000Z',
        artifact: {
          runtimeDiagnosis: {
            state: 'ready',
            evidenceStage: 'agent-result-verified',
            hasRuntimeEvidence: true,
            plannedRuntimeServices: ['ou-ui-xray.service'],
            plannedInbound: {
              agentId: 'agent-hkg-01',
              listenAddress: '0.0.0.0',
              listenPort: 42003,
              protocol: 'vless',
              action: 'upsert_inbound'
            },
            clientCounters: {
              total: 2,
              active: 2,
              disabled: 0
            }
          }
        }
      },
      {
        id: 'cfg-task-delete-client-01',
        taskId: 'task-delete-client-01',
        targetId: 'xray-live-smoke-42003',
        status: 'applied',
        agentId: 'agent-hkg-01',
        createdAt: '2026-07-07T00:04:00.000Z',
        appliedAt: '2026-07-07T00:04:01.000Z',
        artifact: {
          runtimeDiagnosis: {
            state: 'ready',
            evidenceStage: 'agent-result-verified',
            hasRuntimeEvidence: true,
            plannedRuntimeServices: ['ou-ui-xray.service'],
            plannedInbound: {
              agentId: 'agent-hkg-01',
              listenAddress: '0.0.0.0',
              listenPort: 42003,
              protocol: 'vless',
              action: 'upsert_inbound'
            },
            clientCounters: {
              total: 1,
              active: 1,
              disabled: 0
            }
          }
        }
      }
    ],
    preflightPlans: [
      ...(snapshot.preflightPlans as Array<Record<string, unknown>>),
      {
        id: 'preflight-task-add-client-01',
        taskId: 'task-add-client-01',
        status: 'passed',
        checks: []
      },
      {
        id: 'preflight-task-delete-client-01',
        taskId: 'task-delete-client-01',
        status: 'passed',
        checks: []
      }
    ],
    runtimeSnapshots: [
      ...(snapshot.runtimeSnapshots as Array<Record<string, unknown>>),
      {
        id: 'snapshot-before-xray-live-smoke-42003-add-client',
        taskId: 'task-add-client-01',
        status: 'verified',
        agentId: 'agent-hkg-01'
      },
      {
        id: 'snapshot-before-xray-live-smoke-42003-delete-client',
        taskId: 'task-delete-client-01',
        status: 'verified',
        agentId: 'agent-hkg-01'
      }
    ]
  };
}

function createVerifiedCleanupSnapshot() {
  const snapshot = createVerifiedClientActionSnapshot();

  return {
    ...snapshot,
    tasks: [
      ...(snapshot.tasks as Array<Record<string, unknown>>),
      {
        id: 'task-cleanup-delete-01',
        operation: 'inbound.delete',
        resourceType: 'inbound',
        targetId: 'xray-live-smoke-42003',
        status: 'succeeded'
      }
    ],
    commandOutbox: [
      ...(snapshot.commandOutbox as Array<Record<string, unknown>>),
      {
        taskId: 'task-cleanup-delete-01',
        commandId: 'cmd-task-cleanup-delete-01',
        status: 'completed',
        agentId: 'agent-hkg-01'
      }
    ],
    configRevisions: [
      ...(snapshot.configRevisions as Array<Record<string, unknown>>),
      {
        id: 'cfg-task-cleanup-delete-01',
        taskId: 'task-cleanup-delete-01',
        targetId: 'xray-live-smoke-42003',
        status: 'applied',
        agentId: 'agent-hkg-01',
        createdAt: '2026-07-07T00:05:00.000Z',
        appliedAt: '2026-07-07T00:05:01.000Z',
        artifact: {
          runtimeDiagnosis: {
            state: 'waiting',
            evidenceStage: 'agent-result-verified',
            hasRuntimeEvidence: true,
            plannedBindingStatus: 'releasing',
            plannedRuntimeServices: ['ou-ui-xray.service'],
            plannedInbound: {
              agentId: 'agent-hkg-01',
              listenAddress: '0.0.0.0',
              listenPort: 42003,
              protocol: 'vless',
              action: 'remove_inbound'
            },
            clientCounters: {
              total: 1,
              active: 0,
              disabled: 1
            }
          }
        }
      }
    ],
    preflightPlans: [
      ...(snapshot.preflightPlans as Array<Record<string, unknown>>),
      {
        id: 'preflight-task-cleanup-delete-01',
        taskId: 'task-cleanup-delete-01',
        status: 'passed',
        checks: []
      }
    ],
    runtimeSnapshots: [
      ...(snapshot.runtimeSnapshots as Array<Record<string, unknown>>),
      {
        id: 'snapshot-before-xray-live-smoke-42003-cleanup-delete',
        taskId: 'task-cleanup-delete-01',
        status: 'verified',
        agentId: 'agent-hkg-01'
      }
    ]
  };
}

describe('production Xray apply smoke script helpers', () => {
  it('resolves config without putting the operator password on the command line', () => {
    const config = xraySmokeScript.resolveXrayApplySmokeConfig(
      {
        OU_UI_XRAY_SMOKE_BASE_URL: 'https://panel.example/secure/',
        OU_UI_XRAY_SMOKE_USERNAME: 'operator_001',
        OU_UI_XRAY_SMOKE_PASSWORD: 'operator-password',
        OU_UI_XRAY_SMOKE_AGENT_ID: 'agent-hkg-01',
        OU_UI_XRAY_SMOKE_LISTEN_PORT: '42424',
        OU_UI_XRAY_SMOKE_WAIT_MS: '120000',
        OU_UI_XRAY_SMOKE_POLL_INTERVAL_MS: '2500',
        OU_UI_XRAY_SMOKE_PORT_MIN: '42000',
        OU_UI_XRAY_SMOKE_PORT_MAX: '42100',
        OU_UI_XRAY_SMOKE_CLIENT_ACTIONS: 'true',
        OU_UI_XRAY_SMOKE_CLEANUP: 'false'
      },
      ['--server-address', 'edge.example.com', '--report', '/tmp/xray-smoke.json', '--cleanup']
    );

    expect(config.baseUrl.toString()).toBe('https://panel.example/secure/');
    expect(config).toMatchObject({
      username: 'operator_001',
      password: 'operator-password',
      agentId: 'agent-hkg-01',
      listenPort: 42424,
      waitMs: 120_000,
      pollIntervalMs: 2_500,
      portMin: 42_000,
      portMax: 42_100,
      serverAddress: 'edge.example.com',
      clientActions: true,
      cleanup: true,
      reportPath: '/tmp/xray-smoke.json'
    });
    expect(
      xraySmokeScript.parseArgs([
        '--base-url',
        'https://panel.example/panel',
        '--agent-id',
        'agent-hkg-01',
        '--listen-port',
        '42003',
        '--client-actions',
        '--skip-cleanup'
      ])
    ).toMatchObject({
      baseUrl: 'https://panel.example/panel',
      agentId: 'agent-hkg-01',
      listenPort: '42003',
      clientActions: true,
      cleanup: false
    });
  });

  it('selects an online Xray Agent and allocates an unused listen port from runtime evidence', () => {
    const snapshot = createVerifiedSnapshot();

    expect(xraySmokeScript.selectXrayAgent(snapshot)).toMatchObject({
      id: 'agent-hkg-01',
      status: 'online'
    });
    expect(xraySmokeScript.collectReservedXrayPorts(snapshot, 'agent-hkg-01')).toEqual(new Set([42000, 42001, 42003]));
    expect(xraySmokeScript.collectReservedXrayPorts(createVerifiedCleanupSnapshot(), 'agent-hkg-01')).toEqual(
      new Set([42000, 42001])
    );
    expect(
      xraySmokeScript.allocateXrayListenPort(createVerifiedCleanupSnapshot(), 'agent-hkg-01', {
        portMin: 42003,
        portMax: 42005
      })
    ).toBe(42003);
    expect(
      xraySmokeScript.allocateXrayListenPort(
        {
          ...snapshot,
          tasks: [
            ...(snapshot.tasks as Array<Record<string, unknown>>),
            {
              id: 'task-pending',
              resourceType: 'inbound',
              status: 'queued',
              metadata: {
                agentId: 'agent-hkg-01',
                listenPort: 42002
              }
            }
          ]
        },
        'agent-hkg-01',
        { portMin: 42000, portMax: 42005 }
      )
    ).toBe(42004);
    expect(() =>
      xraySmokeScript.allocateXrayListenPort(snapshot, 'agent-hkg-01', { listenPort: 42000 })
    ).toThrow('already reserved');
    expect(() => xraySmokeScript.selectXrayAgent(snapshot, 'agent-fra-01')).toThrow('not online');
  });

  it('builds a real inbound.create task while keeping reports free of client credentials', () => {
    const taskInput = xraySmokeScript.buildXrayInboundTaskInput({
      agentId: 'agent-hkg-01',
      listenPort: 42003,
      serverAddress: 'edge.example.com',
      targetId: 'xray-live-smoke-42003',
      targetLabel: 'Xray Live Smoke 42003',
      clientIdentity: 'smoke-client',
      clientEmail: 'smoke@example.test',
      clientCredential: '11111111-1111-4111-8111-111111111111',
      expiresAt: '2026-07-07T00:00:00.000Z'
    });

    expect(taskInput).toMatchObject({
      operation: 'inbound.create',
      resourceType: 'inbound',
      targetId: 'xray-live-smoke-42003',
      metadata: expect.objectContaining({
        agentId: 'agent-hkg-01',
        xrayProtocol: 'vless',
        listenPort: 42003,
        security: 'none',
        streamNetwork: 'tcp',
        clients: [
          expect.objectContaining({
            clientIdentity: 'smoke-client',
            clientCredential: '11111111-1111-4111-8111-111111111111',
            enabled: true
          })
        ]
      })
    });
  });

  it('builds a follow-up inbound.update smoke task for the same runtime inbound and client', () => {
    const createTaskInput = xraySmokeScript.buildXrayInboundTaskInput({
      agentId: 'agent-hkg-01',
      listenPort: 42003,
      serverAddress: 'edge.example.com',
      targetId: 'xray-live-smoke-42003',
      targetLabel: 'Xray Live Smoke 42003',
      clientIdentity: 'smoke-client',
      clientEmail: 'smoke@example.test',
      clientCredential: '11111111-1111-4111-8111-111111111111',
      expiresAt: '2026-07-07T00:00:00.000Z'
    });
    const updateTaskInput = xraySmokeScript.buildXrayInboundUpdateTaskInput(createTaskInput, {
      targetLabel: 'Xray Live Smoke 42003 Updated',
      trafficLimitGb: 2
    });

    expect(updateTaskInput).toMatchObject({
      operation: 'inbound.update',
      resourceType: 'inbound',
      targetId: 'xray-live-smoke-42003',
      targetLabel: 'Xray Live Smoke 42003 Updated',
      metadata: expect.objectContaining({
        nodeId: 'xray-live-smoke-42003',
        agentId: 'agent-hkg-01',
        listenPort: 42003,
        xrayProtocol: 'vless',
        sniffingEnabled: false,
        trafficLimitGb: 2,
        clients: [
          expect.objectContaining({
            clientIdentity: 'smoke-client',
            clientCredential: '11111111-1111-4111-8111-111111111111',
            trafficLimitGb: 2,
            clientComment: 'runtime-smoke-update-verified',
            enabled: true
          })
        ]
      })
    });
  });

  it('builds a high-risk inbound.delete cleanup task for the smoke runtime inbound', () => {
    const createTaskInput = xraySmokeScript.buildXrayInboundTaskInput({
      agentId: 'agent-hkg-01',
      listenPort: 42003,
      serverAddress: 'edge.example.com',
      targetId: 'xray-live-smoke-42003',
      targetLabel: 'Xray Live Smoke 42003',
      clientIdentity: 'smoke-client',
      clientEmail: 'smoke@example.test',
      clientCredential: '11111111-1111-4111-8111-111111111111',
      expiresAt: '2026-07-07T00:00:00.000Z'
    });
    const deleteTaskInput = xraySmokeScript.buildXrayInboundDeleteTaskInput(createTaskInput, {
      targetLabel: 'Xray Live Smoke 42003 Cleanup'
    });

    expect(deleteTaskInput).toMatchObject({
      operation: 'inbound.delete',
      resourceType: 'inbound',
      targetId: 'xray-live-smoke-42003',
      targetLabel: 'Xray Live Smoke 42003 Cleanup',
      summary: 'Delete Xray runtime smoke inbound and verify Agent removal evidence',
      riskConfirmation: {
        operation: 'inbound.delete',
        targetId: 'xray-live-smoke-42003'
      },
      metadata: expect.objectContaining({
        agentId: 'agent-hkg-01',
        listenPort: 42003,
        enabled: false,
        clients: [
          expect.objectContaining({
            clientIdentity: 'smoke-client',
            enabled: false,
            runtimeDisabledByPolicy: true,
            guardrailReason: 'runtime_smoke_cleanup'
          })
        ]
      })
    });
  });

  it('builds Xray client action requests for Agent-backed add/delete smoke phases', () => {
    const createTaskInput = xraySmokeScript.buildXrayInboundTaskInput({
      agentId: 'agent-hkg-01',
      listenPort: 42003,
      serverAddress: 'edge.example.com',
      targetId: 'xray-live-smoke-42003',
      targetLabel: 'Xray Live Smoke 42003',
      clientIdentity: 'smoke-client',
      clientEmail: 'smoke@example.test',
      clientCredential: '11111111-1111-4111-8111-111111111111',
      expiresAt: '2026-07-07T00:00:00.000Z'
    });
    const addRequest = xraySmokeScript.buildXrayClientAddActionRequest(createTaskInput, {
      clientIdentity: 'client-carol',
      clientEmail: 'carol@example.test',
      clientCredential: '33333333-3333-4333-8333-333333333333',
      trafficLimitGb: 1,
      remainingDays: 1,
      subscriptionRule: 'runtime-smoke:client-carol'
    });
    const deleteRequest = xraySmokeScript.buildXrayClientDeleteActionRequest(createTaskInput, {
      clientEmail: 'carol@example.test'
    });

    expect(addRequest).toMatchObject({
      inboundId: 'xray-live-smoke-42003',
      action: {
        kind: 'add-client',
        clientIdentity: 'client-carol',
        clientEmail: 'carol@example.test',
        clientCredential: '33333333-3333-4333-8333-333333333333',
        enabled: true
      },
      reason: 'runtime smoke add-client evidence'
    });
    expect(deleteRequest).toEqual({
      inboundId: 'xray-live-smoke-42003',
      clientEmail: 'carol@example.test',
      clientId: undefined,
      action: {
        kind: 'delete-client'
      },
      reason: 'runtime smoke delete-client evidence'
    });
  });

  it('extracts and validates Agent-result runtime evidence from a control-plane snapshot', () => {
    const evidence = xraySmokeScript.extractXrayApplyEvidence(
      createVerifiedSnapshot(),
      'task-apply-01',
      'xray-live-smoke-42003'
    );

    expect(xraySmokeScript.validateXrayApplyEvidence(evidence, { agentId: 'agent-hkg-01', listenPort: 42003 })).toEqual(
      []
    );
    expect(xraySmokeScript.summarizeXrayApplyEvidence(evidence)).toEqual(
      expect.objectContaining({
        taskId: 'task-apply-01',
        taskStatus: 'succeeded',
        configRevisionId: 'cfg-task-apply-01',
        configRevisionStatus: 'applied',
        preflightStatus: 'passed',
        runtimeSnapshotStatus: 'verified',
        commandStatus: 'completed',
        evidenceStage: 'agent-result-verified',
        runtimeState: 'ready',
        listenPort: 42003,
        protocol: 'vless'
      })
    );
    expect(JSON.stringify(xraySmokeScript.summarizeXrayApplyEvidence(evidence))).not.toContain(
      '11111111-1111-4111-8111-111111111111'
    );
  });

  it('extracts and validates the follow-up inbound.update Agent-result evidence separately from create', () => {
    const evidence = xraySmokeScript.extractXrayApplyEvidence(
      createVerifiedSnapshot(),
      'task-update-01',
      'xray-live-smoke-42003'
    );

    expect(
      xraySmokeScript.validateXrayApplyEvidence(evidence, {
        agentId: 'agent-hkg-01',
        listenPort: 42003,
        operation: 'inbound.update'
      })
    ).toEqual([]);
    expect(xraySmokeScript.summarizeXrayApplyEvidence(evidence)).toEqual(
      expect.objectContaining({
        taskId: 'task-update-01',
        operation: 'inbound.update',
        configRevisionId: 'cfg-task-update-01',
        preflightStatus: 'passed',
        runtimeSnapshotStatus: 'verified',
        commandStatus: 'completed',
        evidenceStage: 'agent-result-verified'
      })
    );
    expect(
      xraySmokeScript.validateXrayApplyEvidence(evidence, {
        agentId: 'agent-hkg-01',
        listenPort: 42003,
        operation: 'inbound.create'
      })
    ).toEqual(['task operation is inbound.update']);
  });

  it('extracts and validates client action Agent-result evidence with runtime client counters', () => {
    const addEvidence = xraySmokeScript.extractXrayApplyEvidence(
      createVerifiedClientActionSnapshot(),
      'task-add-client-01',
      'xray-live-smoke-42003'
    );
    const deleteEvidence = xraySmokeScript.extractXrayApplyEvidence(
      createVerifiedClientActionSnapshot(),
      'task-delete-client-01',
      'xray-live-smoke-42003'
    );

    expect(
      xraySmokeScript.validateXrayApplyEvidence(addEvidence, {
        agentId: 'agent-hkg-01',
        listenPort: 42003,
        operation: 'inbound.update',
        clientAction: 'add-client',
        clientEmail: 'carol@example.test',
        clientCounters: {
          total: 2,
          active: 2
        }
      })
    ).toEqual([]);
    expect(xraySmokeScript.summarizeXrayApplyEvidence(addEvidence)).toEqual(
      expect.objectContaining({
        taskId: 'task-add-client-01',
        operation: 'inbound.update',
        xrayClientAction: 'add-client',
        xrayClientActionTargetEmail: 'carol@example.test',
        clientCounters: expect.objectContaining({
          total: 2,
          active: 2
        }),
        evidenceStage: 'agent-result-verified'
      })
    );
    expect(
      xraySmokeScript.validateXrayApplyEvidence(deleteEvidence, {
        agentId: 'agent-hkg-01',
        listenPort: 42003,
        operation: 'inbound.update',
        clientAction: 'delete-client',
        clientEmail: 'carol@example.test',
        clientCounters: {
          total: 1,
          active: 1
        }
      })
    ).toEqual([]);
    expect(JSON.stringify(xraySmokeScript.summarizeXrayApplyEvidence(addEvidence))).not.toContain(
      '33333333-3333-4333-8333-333333333333'
    );
  });

  it('extracts and validates final inbound.delete cleanup evidence as a runtime removal', () => {
    const cleanupEvidence = xraySmokeScript.extractXrayApplyEvidence(
      createVerifiedCleanupSnapshot(),
      'task-cleanup-delete-01',
      'xray-live-smoke-42003'
    );

    expect(
      xraySmokeScript.validateXrayApplyEvidence(cleanupEvidence, {
        agentId: 'agent-hkg-01',
        listenPort: 42003,
        operation: 'inbound.delete',
        plannedInboundAction: 'remove_inbound',
        plannedBindingStatus: 'releasing',
        runtimeState: 'waiting',
        clientCounters: {
          total: 1,
          active: 0
        }
      })
    ).toEqual([]);
    expect(xraySmokeScript.summarizeXrayApplyEvidence(cleanupEvidence)).toEqual(
      expect.objectContaining({
        taskId: 'task-cleanup-delete-01',
        operation: 'inbound.delete',
        action: 'remove_inbound',
        plannedBindingStatus: 'releasing',
        runtimeState: 'waiting',
        evidenceStage: 'agent-result-verified',
        clientCounters: expect.objectContaining({
          total: 1,
          active: 0,
          disabled: 1
        })
      })
    );
  });

  it('returns operator-actionable evidence gaps while a task is still waiting for Agent result', () => {
    const waitingEvidence = xraySmokeScript.extractXrayApplyEvidence(
      {
        ...createVerifiedSnapshot(),
        tasks: [
          {
            id: 'task-apply-01',
            operation: 'inbound.create',
            resourceType: 'inbound',
            targetId: 'xray-live-smoke-42003',
            status: 'running'
          }
        ],
        commandOutbox: [
          {
            taskId: 'task-apply-01',
            commandId: 'cmd-task-apply-01',
            status: 'acknowledged'
          }
        ],
        configRevisions: [],
        preflightPlans: [],
        runtimeSnapshots: []
      },
      'task-apply-01',
      'xray-live-smoke-42003'
    );

    expect(xraySmokeScript.validateXrayApplyEvidence(waitingEvidence, { agentId: 'agent-hkg-01', listenPort: 42003 })).toEqual(
      expect.arrayContaining([
        'task status is running',
        'Agent command status is acknowledged',
        'runtime config revision is missing',
        'preflight plan is missing',
        'runtime snapshot is missing',
        'runtime diagnosis evidenceStage is missing'
      ])
    );
  });
});
