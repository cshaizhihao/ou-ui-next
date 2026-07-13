import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Agent, RuntimeConvergenceReadModel, SystemAlert } from '../../domain';
import type { DeployTask } from '../../domain/task';
import { RecoveryCenterPage } from './recovery-center-page';
import { createRecoveryQueues } from './recovery-model';

const failedTask: DeployTask = {
  id: 'task-failed-1', operation: 'config.apply', resourceType: 'agent', resourceId: 'agent-1', status: 'failed',
  targetId: 'agent-1', targetLabel: 'Edge HK', summary: 'Apply config', createdAt: '2026-07-13T10:00:00.000Z',
  updatedAt: '2026-07-13T10:01:00.000Z', actor: 'admin', requestedBy: 'admin', requestId: 'req-1', sourceIp: '127.0.0.1',
  rollbackAvailable: false, attempts: 1, steps: [], failureReason: 'Xray preflight failed'
};

const offlineAgent = {
  id: 'agent-1', name: 'Edge HK', status: 'offline', publicAddress: '198.51.100.1',
  lastHeartbeatAt: '2026-07-13T09:59:00.000Z'
} as Agent;

const drifted: RuntimeConvergenceReadModel = {
  id: 'runtime-convergence:task-failed-1', taskId: failedTask.id, operation: failedTask.operation,
  resourceType: failedTask.resourceType, targetId: failedTask.targetId, targetLabel: failedTask.targetLabel,
  desired: { state: 'applied', requestedAt: failedTask.createdAt, configRevisionIds: [] },
  observed: { state: 'applied', commandStatuses: ['completed'], agentIds: ['agent-1'], configRevisionStatuses: ['applied'], preflightStatuses: ['passed'], snapshotStatuses: ['verified'], observedAt: failedTask.updatedAt },
  verification: { state: 'drifted', source: 'control-plane', reasons: ['agent_verification_missing'], nextAction: 'verify_agent_result' }
};

const alert = {
  id: 'alert-1', kind: 'agent.offline', severity: 'critical', status: 'active', title: 'Agent offline', message: 'No heartbeat',
  resourceType: 'agent', resourceId: 'agent-1', resourceLabel: 'Edge HK', observedAt: failedTask.updatedAt, dedupeKey: 'agent:1'
} satisfies SystemAlert;

describe('RecoveryCenterPage', () => {
  it('builds non-duplicated evidence queues', () => {
    const queues = createRecoveryQueues({ agents: [offlineAgent], tasks: [failedTask], runtimeConvergence: [drifted], systemAlerts: [alert] });
    expect(queues.find((queue) => queue.id === 'fleet')?.items).toHaveLength(1);
    expect(queues.find((queue) => queue.id === 'runtime')?.items).toHaveLength(1);
    expect(queues.find((queue) => queue.id === 'alerts')?.items).toHaveLength(1);
  });

  it('opens the evidence workspace instead of claiming automatic recovery', () => {
    const onSelectPage = vi.fn();
    render(
      <RecoveryCenterPage
        agents={[offlineAgent]}
        runtimeConvergence={[drifted]}
        systemAlerts={[alert]}
        tasks={[failedTask]}
        onRefresh={vi.fn()}
        onSelectPage={onSelectPage}
      />
    );
    expect(screen.getByRole('heading', { name: '恢复中心' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '查看处置路径' })[0]);
    expect(onSelectPage).toHaveBeenCalled();
    expect(screen.queryByText('一键修复')).not.toBeInTheDocument();
  });
});
