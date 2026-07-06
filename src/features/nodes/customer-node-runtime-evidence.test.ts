import type { DeployTask, RuntimeConfigRevision, RuntimePreflightPlan, RuntimeSnapshot } from '../../domain';
import type { CommandOutboxSummary } from '../../services/api/control-plane-api';
import {
  createCustomerNodeRuntimeEvidencePackage,
  resolveCustomerNodeRuntimeEvidence
} from './customer-node-runtime-evidence';

function createTask(overrides: Partial<DeployTask> = {}): DeployTask {
  return {
    id: 'task-0100',
    operation: 'inbound.update',
    resourceType: 'inbound',
    resourceId: 'inbound-acme',
    status: 'succeeded',
    targetId: 'inbound-acme',
    targetLabel: 'Acme VLESS',
    summary: 'Update Acme VLESS',
    createdAt: '2026-06-04T04:00:00.000Z',
    updatedAt: '2026-06-04T04:02:00.000Z',
    actor: 'admin',
    requestedBy: 'admin',
    requestId: 'req-task-0100',
    sourceIp: '127.0.0.1',
    rollbackAvailable: true,
    rollbackTaskId: 'task-0099',
    attempts: 1,
    steps: [],
    metadata: {},
    ...overrides
  };
}

function createCommand(overrides: Partial<CommandOutboxSummary> = {}): CommandOutboxSummary {
  return {
    id: 'outbox-0100',
    taskId: 'task-0100',
    commandId: 'cmd-task-0100',
    agentId: 'agent-hkg-01',
    seq: 100,
    status: 'completed',
    transport: 'http-pull',
    attempts: 1,
    createdAt: '2026-06-04T04:00:05.000Z',
    updatedAt: '2026-06-04T04:00:20.000Z',
    deadlineAt: '2026-06-04T04:05:00.000Z',
    ackedAt: '2026-06-04T04:00:10.000Z',
    resultAt: '2026-06-04T04:00:20.000Z',
    commandType: 'apply',
    ...overrides
  };
}

function createConfigRevision(overrides: Partial<RuntimeConfigRevision> = {}): RuntimeConfigRevision {
  return {
    id: 'cfg-task-0100',
    taskId: 'task-0100',
    operation: 'inbound.update',
    targetId: 'inbound-acme',
    targetLabel: 'Acme VLESS',
    agentId: 'agent-hkg-01',
    moduleKind: 'xray',
    artifactUri: 'memory://cfg-task-0100',
    checksum: 'sha256:0100',
    signature: 'sig-0100',
    preflightPlanId: 'preflight-task-0100',
    snapshotBeforeId: 'snapshot-task-0100',
    status: 'applied',
    createdAt: '2026-06-04T04:00:00.000Z',
    createdBy: 'admin',
    appliedAt: '2026-06-04T04:00:25.000Z',
    diffSummary: {
      added: 0,
      changed: 1,
      removed: 0
    },
    artifact: {
      runtimeDiagnosis: {
        state: 'ready',
        evidenceStage: 'agent-result-verified',
        plannedRuntimeServices: ['ou-ui-xray.service'],
        plannedInbound: {
          agentId: 'agent-hkg-01',
          listenPort: 443
        }
      }
    },
    ...overrides
  };
}

function createPreflightPlan(overrides: Partial<RuntimePreflightPlan> = {}): RuntimePreflightPlan {
  return {
    id: 'preflight-task-0100',
    taskId: 'task-0100',
    configRevisionId: 'cfg-task-0100',
    targetId: 'inbound-acme',
    agentId: 'agent-hkg-01',
    moduleKind: 'xray',
    status: 'passed',
    checks: [
      {
        id: 'check-xray-test',
        label: 'xray run -test',
        status: 'passed',
        severity: 'critical'
      }
    ],
    createdAt: '2026-06-04T04:00:01.000Z',
    completedAt: '2026-06-04T04:00:03.000Z',
    ...overrides
  };
}

function createRuntimeSnapshot(overrides: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot {
  return {
    id: 'snapshot-task-0100',
    taskId: 'task-0100',
    targetId: 'inbound-acme',
    targetLabel: 'Acme VLESS',
    agentId: 'agent-hkg-01',
    moduleKind: 'xray',
    reason: 'pre_apply',
    status: 'verified',
    checksum: 'sha256:snapshot-0100',
    capturedAt: '2026-06-04T03:59:59.000Z',
    capturedBy: 'admin',
    verifiedAt: '2026-06-04T04:00:04.000Z',
    state: {},
    ...overrides
  };
}

describe('customer node runtime evidence', () => {
  it('matches Agent proof to task, command, revision, preflight, and snapshot evidence', () => {
    const evidence = resolveCustomerNodeRuntimeEvidence({
      node: {
        id: 'inbound-acme',
        configVersion: 'cfg-task-0100',
        runtimeDeployment: {
          source: 'agent-result',
          verifiedAt: '2026-06-04T04:00:30.000Z',
          agentIds: ['agent-hkg-01'],
          commandIds: ['cmd-task-0100'],
          appliedConfigRevisions: ['cfg-task-0100']
        }
      },
      tasks: [createTask()],
      commandOutbox: [createCommand()],
      configRevisions: [createConfigRevision()],
      preflightPlans: [createPreflightPlan()],
      runtimeSnapshots: [createRuntimeSnapshot()]
    });

    expect(evidence).toMatchObject({
      state: 'verified',
      taskId: 'task-0100',
      evidenceStage: 'agent-result-verified',
      nextAction: {
        code: 'none',
        severity: 'info'
      },
      task: {
        id: 'task-0100'
      },
      configRevision: {
        id: 'cfg-task-0100'
      },
      preflightPlan: {
        id: 'preflight-task-0100'
      },
      runtimeSnapshot: {
        id: 'snapshot-task-0100'
      }
    });
    expect(evidence.commandOutboxItems.map((item) => item.commandId)).toEqual(['cmd-task-0100']);
    expect(evidence.steps.map((step) => [step.id, step.state])).toEqual([
      ['command', 'confirmed'],
      ['agentResult', 'confirmed'],
      ['configRevision', 'confirmed'],
      ['preflight', 'confirmed'],
      ['snapshot', 'confirmed']
    ]);
  });

  it('keeps evidence waiting when the Agent result proof has not arrived yet', () => {
    const evidence = resolveCustomerNodeRuntimeEvidence({
      node: {
        id: 'inbound-acme',
        configVersion: 'cfg-task-0100'
      },
      tasks: [createTask({ status: 'running' })],
      commandOutbox: [createCommand({ status: 'acknowledged', resultAt: undefined })],
      configRevisions: [
        createConfigRevision({
          status: 'preflight_ready',
          appliedAt: undefined,
          artifact: {
            runtimeDiagnosis: {
              state: 'waiting',
              evidenceStage: 'control-plane-compiled'
            }
          }
        })
      ],
      preflightPlans: [createPreflightPlan()],
      runtimeSnapshots: [createRuntimeSnapshot()]
    });

    expect(evidence.state).toBe('waiting');
    expect(evidence.taskId).toBe('task-0100');
    expect(evidence.evidenceStage).toBe('control-plane-compiled');
    expect(evidence.nextAction).toMatchObject({
      code: 'wait-command-result',
      severity: 'warning',
      stepId: 'command',
      stepState: 'waiting',
      detail: 'cmd-task-0100'
    });
    expect(evidence.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'command', state: 'waiting' }),
        expect.objectContaining({ id: 'agentResult', state: 'waiting' }),
        expect.objectContaining({ id: 'configRevision', state: 'waiting' })
      ])
    );
  });

  it('marks the bundle failed when command, preflight, or snapshot evidence fails', () => {
    const evidence = resolveCustomerNodeRuntimeEvidence({
      node: {
        id: 'inbound-acme',
        configVersion: 'cfg-task-0100'
      },
      tasks: [createTask({ status: 'failed' })],
      commandOutbox: [createCommand({ status: 'failed', lastError: 'xray test failed', resultAt: undefined })],
      configRevisions: [
        createConfigRevision({
          status: 'failed',
          appliedAt: undefined,
          failedAt: '2026-06-04T04:00:25.000Z',
          artifact: {
            runtimeDiagnosis: {
              state: 'failed',
              evidenceStage: 'agent-result-failed'
            }
          }
        })
      ],
      preflightPlans: [createPreflightPlan({ status: 'failed', failureReason: 'xray run -test failed' })],
      runtimeSnapshots: [createRuntimeSnapshot({ status: 'expired' })]
    });

    expect(evidence.state).toBe('failed');
    expect(evidence.nextAction).toMatchObject({
      code: 'inspect-command-failure',
      severity: 'critical',
      stepId: 'command',
      stepState: 'failed',
      detail: 'xray test failed'
    });
    expect(evidence.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'command', state: 'failed', detail: 'xray test failed' }),
        expect.objectContaining({ id: 'agentResult', state: 'failed' }),
        expect.objectContaining({ id: 'configRevision', state: 'failed' }),
        expect.objectContaining({ id: 'preflight', state: 'failed' }),
        expect.objectContaining({ id: 'snapshot', state: 'failed' })
      ])
    );
  });

  it('points the next action at the failed preflight when preflight blocks runtime apply', () => {
    const evidence = resolveCustomerNodeRuntimeEvidence({
      node: {
        id: 'inbound-acme',
        configVersion: 'cfg-task-0100'
      },
      tasks: [createTask({ status: 'failed', failureReason: 'preflight rejected generated config' })],
      commandOutbox: [createCommand()],
      configRevisions: [
        createConfigRevision({
          status: 'preflight_ready',
          appliedAt: undefined,
          artifact: {
            runtimeDiagnosis: {
              state: 'failed',
              evidenceStage: 'control-plane-compiled'
            }
          }
        })
      ],
      preflightPlans: [
        createPreflightPlan({
          status: 'failed',
          failureReason: 'xray run -test failed',
          checks: [
            {
              id: 'check-xray-test',
              label: 'xray run -test',
              status: 'failed',
              severity: 'critical'
            }
          ]
        })
      ],
      runtimeSnapshots: [createRuntimeSnapshot()]
    });

    expect(evidence.state).toBe('failed');
    expect(evidence.nextAction).toMatchObject({
      code: 'fix-preflight',
      severity: 'critical',
      stepId: 'preflight',
      stepState: 'failed',
      detail: 'xray run -test failed'
    });
  });

  it('links rollback task, command, and restored snapshot evidence to the customer-node release bundle', () => {
    const rollbackTask = createTask({
      id: 'task-0099',
      operation: 'agent.rollback',
      status: 'succeeded',
      rollbackAvailable: false,
      rollbackTaskId: undefined,
      requestId: 'req-task-0099',
      summary: 'Rollback Acme VLESS',
      updatedAt: '2026-06-04T04:10:00.000Z',
      metadata: {
        snapshotId: 'snapshot-task-0100'
      }
    });
    const rollbackCommand = createCommand({
      id: 'outbox-0099',
      taskId: 'task-0099',
      commandId: 'cmd-task-0099',
      commandType: 'rollback',
      resultAt: '2026-06-04T04:10:00.000Z',
      updatedAt: '2026-06-04T04:10:00.000Z'
    });
    const restoredSnapshot = createRuntimeSnapshot({
      status: 'restored',
      restoredAt: '2026-06-04T04:10:00.000Z',
      restoredByTaskId: 'task-0099',
      state: {
        secretRuntimeBody: 'do-not-copy'
      }
    });

    const evidence = resolveCustomerNodeRuntimeEvidence({
      node: {
        id: 'inbound-acme',
        configVersion: 'cfg-task-0100',
        runtimeDeployment: {
          source: 'agent-result',
          verifiedAt: '2026-06-04T04:00:30.000Z',
          agentIds: ['agent-hkg-01'],
          commandIds: ['cmd-task-0100'],
          appliedConfigRevisions: ['cfg-task-0100']
        }
      },
      tasks: [createTask(), rollbackTask],
      commandOutbox: [createCommand(), rollbackCommand],
      configRevisions: [createConfigRevision()],
      preflightPlans: [createPreflightPlan()],
      runtimeSnapshots: [restoredSnapshot]
    });

    expect(evidence.rollbackRecovery).toMatchObject({
      state: 'restored',
      taskId: 'task-0099',
      task: {
        id: 'task-0099',
        status: 'succeeded'
      },
      commandOutboxItems: [
        {
          commandId: 'cmd-task-0099',
          commandType: 'rollback',
          status: 'completed'
        }
      ],
      restoredSnapshot: {
        id: 'snapshot-task-0100',
        status: 'restored',
        restoredByTaskId: 'task-0099'
      }
    });

    const diagnosticPackage = createCustomerNodeRuntimeEvidencePackage({
      node: {
        id: 'inbound-acme',
        agentId: 'agent-hkg-01',
        configVersion: 'cfg-task-0100'
      },
      evidence
    });

    expect(diagnosticPackage.rollbackRecovery).toMatchObject({
      state: 'restored',
      taskId: 'task-0099',
      task: {
        id: 'task-0099',
        operation: 'agent.rollback',
        status: 'succeeded'
      },
      commands: [
        {
          commandId: 'cmd-task-0099',
          commandType: 'rollback',
          status: 'completed'
        }
      ],
      restoredSnapshot: {
        id: 'snapshot-task-0100',
        status: 'restored',
        restoredByTaskId: 'task-0099'
      }
    });
    expect(JSON.stringify(diagnosticPackage)).not.toContain('secretRuntimeBody');
  });

  it('creates a copyable safe diagnostic package without raw runtime bodies', () => {
    const evidence = resolveCustomerNodeRuntimeEvidence({
      node: {
        id: 'inbound-acme',
        configVersion: 'cfg-task-0100',
        runtimeDeployment: {
          source: 'agent-result',
          verifiedAt: '2026-06-04T04:00:30.000Z',
          agentIds: ['agent-hkg-01'],
          commandIds: ['cmd-task-0100'],
          appliedConfigRevisions: ['cfg-task-0100']
        }
      },
      tasks: [createTask()],
      commandOutbox: [createCommand()],
      configRevisions: [createConfigRevision()],
      preflightPlans: [createPreflightPlan()],
      runtimeSnapshots: [createRuntimeSnapshot({ state: { secretRuntimeBody: 'do-not-copy' } })]
    });

    const diagnosticPackage = createCustomerNodeRuntimeEvidencePackage({
      node: {
        id: 'inbound-acme',
        agentId: 'agent-hkg-01',
        customerName: 'Acme',
        nodeName: 'Acme VLESS',
        listenPort: 443,
        protocol: 'vless',
        configVersion: 'cfg-task-0100',
        runtimeDeployment: {
          source: 'agent-result',
          verifiedAt: '2026-06-04T04:00:30.000Z',
          agentIds: ['agent-hkg-01'],
          commandIds: ['cmd-task-0100'],
          appliedConfigRevisions: ['cfg-task-0100']
        }
      },
      evidence
    });

    expect(diagnosticPackage).toMatchObject({
      node: {
        id: 'inbound-acme',
        customerName: 'Acme',
        nodeName: 'Acme VLESS',
        listenPort: 443,
        protocol: 'vless'
      },
      task: {
        id: 'task-0100',
        requestId: 'req-task-0100',
        rollbackTaskId: 'task-0099'
      },
      commands: [
        {
          commandId: 'cmd-task-0100',
          agentId: 'agent-hkg-01',
          commandType: 'apply',
          status: 'completed'
        }
      ],
      configRevision: {
        id: 'cfg-task-0100',
        runtimeDiagnosis: {
          state: 'ready',
          evidenceStage: 'agent-result-verified',
          plannedRuntimeServices: ['ou-ui-xray.service']
        }
      },
      preflightPlan: {
        id: 'preflight-task-0100',
        checks: [
          {
            id: 'check-xray-test',
            label: 'xray run -test',
            status: 'passed',
            severity: 'critical'
          }
        ]
      },
      runtimeSnapshot: {
        id: 'snapshot-task-0100',
        status: 'verified'
      },
      evidence: {
        nextAction: {
          code: 'none',
          severity: 'info'
        }
      }
    });
    expect(JSON.stringify(diagnosticPackage)).not.toContain('secretRuntimeBody');
    expect(JSON.stringify(diagnosticPackage)).not.toContain('plannedInbound');
  });
});
