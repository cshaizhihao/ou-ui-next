import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TasksPage } from './tasks-page';
import type { RuntimeConfigRevision, RuntimePreflightPlan, RuntimeSnapshot } from '../../domain/runtime-release';
import type { DeployTask } from '../../domain/task';

const task: DeployTask = {
  id: 'task-release-001',
  operation: 'forward.apply',
  resourceType: 'forward',
  resourceId: 'forward-hkg-443',
  status: 'queued',
  targetId: 'forward-hkg-443',
  targetLabel: 'Port Forwarding Fabric',
  summary: 'Apply port forwarding policy',
  createdAt: '2026-06-02T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
  actor: 'admin',
  requestedBy: 'admin',
  requestId: 'req-release-001',
  sourceIp: 'ui-preview',
  rollbackAvailable: false,
  attempts: 0,
  progressPercent: 0,
  steps: []
};

const configRevision: RuntimeConfigRevision = {
  id: 'cfg-current',
  taskId: task.id,
  operation: task.operation,
  targetId: task.targetId,
  targetLabel: task.targetLabel,
  agentId: 'agent-hkg-01',
  moduleKind: 'flvx',
  artifactUri: 'ou-ui://artifacts/config-revisions/cfg-current.json',
  checksum: 'sha256:current',
  signature: 'sig-v1:current',
  preflightPlanId: 'preflight-current',
  snapshotBeforeId: 'snapshot-current',
  status: 'compiled',
  createdAt: task.createdAt,
  createdBy: task.actor,
  diffSummary: {
    added: 1,
    changed: 1,
    removed: 0
  },
  artifact: {}
};

const stalePreflightPlan: RuntimePreflightPlan = {
  id: 'preflight-stale',
  taskId: task.id,
  configRevisionId: 'cfg-stale',
  targetId: task.targetId,
  agentId: 'agent-hkg-01',
  moduleKind: 'flvx',
  status: 'pending',
  checks: [],
  createdAt: task.createdAt
};

const staleRuntimeSnapshot: RuntimeSnapshot = {
  id: 'snapshot-stale',
  taskId: task.id,
  targetId: task.targetId,
  targetLabel: task.targetLabel,
  agentId: 'agent-hkg-01',
  moduleKind: 'flvx',
  reason: 'pre_apply',
  status: 'captured',
  checksum: 'sha256:stale',
  capturedAt: task.createdAt,
  capturedBy: task.actor,
  state: {}
};

describe('TasksPage', () => {
  it('does not attach stale preflight or snapshot artifacts to the current config revision', () => {
    render(
      <TasksPage
        tasks={[task]}
        configRevisions={[configRevision]}
        preflightPlans={[stalePreflightPlan]}
        runtimeSnapshots={[staleRuntimeSnapshot]}
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText('cfg-current')).toBeInTheDocument();
    expect(screen.queryByText('preflight-stale')).not.toBeInTheDocument();
    expect(screen.queryByText('snapshot-stale')).not.toBeInTheDocument();
  });

  it('calls the rollback handler for rollback-ready tasks', async () => {
    const user = userEvent.setup();
    const onRollbackTask = vi.fn();

    render(
      <TasksPage
        tasks={[{ ...task, status: 'succeeded', rollbackAvailable: true }]}
        configRevisions={[]}
        preflightPlans={[]}
        runtimeSnapshots={[]}
        onRollbackTask={onRollbackTask}
        onRefresh={vi.fn()}
      />
    );

    const rollbackButton = document.querySelector<HTMLButtonElement>('button[data-task-action="rollback"]');
    expect(rollbackButton).not.toBeNull();
    await user.click(rollbackButton!);

    expect(onRollbackTask).toHaveBeenCalledWith(task.id);
  });

  it('does not expose rollback before the source task has succeeded', () => {
    render(
      <TasksPage
        tasks={[{ ...task, rollbackAvailable: true, status: 'running' }]}
        configRevisions={[]}
        preflightPlans={[]}
        runtimeSnapshots={[]}
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(document.querySelector('button[data-task-action="rollback"]')).not.toBeInTheDocument();
  });
});
