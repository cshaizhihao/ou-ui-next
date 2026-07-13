import type { DeployTask } from './task';
import { markTaskAgentRuntimeDeploymentVerified } from './task';
import { createRuntimeConvergenceReadModels } from './runtime-convergence';

function createTask(status: DeployTask['status']): DeployTask {
  return {
    id: 'task-runtime-convergence-001',
    operation: 'inbound.update',
    resourceType: 'inbound',
    resourceId: 'inbound-runtime-convergence-001',
    status,
    targetId: 'inbound-runtime-convergence-001',
    targetLabel: 'Runtime convergence inbound',
    summary: 'Apply runtime convergence inbound',
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:05.000Z',
    actor: 'admin',
    requestedBy: 'admin',
    requestId: 'req-runtime-convergence-001',
    sourceIp: '127.0.0.1',
    rollbackAvailable: false,
    attempts: 1,
    steps: []
  };
}

describe('runtime convergence read models', () => {
  it('marks Agent-result runtime evidence as verified', () => {
    const task = markTaskAgentRuntimeDeploymentVerified(createTask('succeeded'), {
      verifiedAt: '2026-07-13T00:00:10.000Z',
      agentIds: ['agent-runtime-001'],
      commandIds: ['command-runtime-001'],
      appliedConfigRevisions: ['cfg-runtime-001']
    });
    const [result] = createRuntimeConvergenceReadModels({
      tasks: [task],
      commandOutbox: [
        {
          taskId: task.id,
          agentId: 'agent-runtime-001',
          status: 'completed',
          updatedAt: '2026-07-13T00:00:10.000Z'
        }
      ],
      configRevisions: [],
      preflightPlans: [],
      runtimeSnapshots: []
    });

    expect(result).toMatchObject({
      desired: { state: 'applied' },
      observed: { state: 'applied', agentIds: ['agent-runtime-001'] },
      verification: {
        state: 'verified',
        source: 'agent-result',
        verifiedAt: '2026-07-13T00:00:10.000Z',
        nextAction: 'none'
      }
    });
  });

  it('reports completed commands without Agent proof as drift instead of verified', () => {
    const task = createTask('succeeded');
    const [result] = createRuntimeConvergenceReadModels({
      tasks: [task],
      commandOutbox: [
        {
          taskId: task.id,
          agentId: 'agent-runtime-001',
          status: 'completed',
          updatedAt: '2026-07-13T00:00:10.000Z'
        }
      ],
      configRevisions: [],
      preflightPlans: [],
      runtimeSnapshots: []
    });

    expect(result.verification).toEqual({
      state: 'drifted',
      source: 'control-plane',
      reasons: ['agent_verification_missing'],
      nextAction: 'verify_agent_result'
    });
  });

  it('excludes control-plane-only subscription tasks from runtime convergence', () => {
    const task = { ...createTask('succeeded'), operation: 'subscription.generate' as const };
    expect(
      createRuntimeConvergenceReadModels({
        tasks: [task],
        commandOutbox: [],
        configRevisions: [],
        preflightPlans: [],
        runtimeSnapshots: []
      })
    ).toEqual([]);
  });
});
