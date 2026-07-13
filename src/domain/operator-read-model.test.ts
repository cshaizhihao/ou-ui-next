import type { DeployTask } from './task';
import {
  createOperatorTaskReadModel,
  filterOperatorTasks,
  redactOperatorReadSecrets
} from './operator-read-model';

function createTask(id: string, actor: string, resourceGroupId: string): DeployTask {
  return {
    id,
    operation: 'inbound.create',
    resourceType: 'inbound',
    resourceId: `inbound-${id}`,
    status: 'queued',
    targetId: `inbound-${id}`,
    targetLabel: id,
    summary: id,
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
    actor,
    requestedBy: actor,
    resourceGroupId,
    requestId: `request-${id}`,
    sourceIp: '127.0.0.1',
    rollbackAvailable: false,
    attempts: 0,
    steps: [],
    metadata: {
      clientCredential: 'client-secret',
      clients: [{ clientEmail: 'alice@example.com', clientCredential: 'nested-secret' }],
      realityPrivateKey: 'reality-secret',
      safeEvidence: 'kept'
    }
  };
}

describe('operator read models', () => {
  it('removes runtime secret material recursively while preserving safe evidence', () => {
    const task = createOperatorTaskReadModel(createTask('task-blue', 'operator:blue', 'group-blue'));

    expect(task.metadata).toEqual({
      clients: [{ clientEmail: 'alice@example.com' }],
      safeEvidence: 'kept'
    });
    expect(JSON.stringify(redactOperatorReadSecrets(task))).not.toContain('client-secret');
    expect(JSON.stringify(task)).not.toContain('reality-secret');
  });

  it('limits scoped operators to their resource group while owners retain global reads', () => {
    const tasks = [
      createTask('task-blue', 'operator:blue', 'group-blue'),
      createTask('task-red', 'operator:red', 'group-red')
    ];

    expect(
      filterOperatorTasks(tasks, {
        actor: 'operator:blue',
        operatorGroupId: 'operators-blue',
        resourceGroupId: 'group-blue'
      }).map((task) => task.id)
    ).toEqual(['task-blue']);
    expect(
      filterOperatorTasks(tasks, {
        actor: 'operator:owner',
        operatorGroupId: 'owner',
        resourceGroupId: 'group-blue'
      })
    ).toHaveLength(2);
  });
});
