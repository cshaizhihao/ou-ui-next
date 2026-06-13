import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TasksPage } from './tasks-page';
import type { AgentLogArchive } from '../../domain';
import type { RuntimeConfigRevision, RuntimePreflightPlan, RuntimeSnapshot } from '../../domain/runtime-release';
import type { DeployTask } from '../../domain/task';
import type { AgentLogChunk } from '../../services/api/control-plane-api';

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
  moduleKind: 'port-forwarding',
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
  moduleKind: 'port-forwarding',
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
  moduleKind: 'port-forwarding',
  reason: 'pre_apply',
  status: 'captured',
  checksum: 'sha256:stale',
  capturedAt: task.createdAt,
  capturedBy: task.actor,
  state: {}
};

const currentPreflightPlan: RuntimePreflightPlan = {
  id: 'preflight-current',
  taskId: task.id,
  configRevisionId: configRevision.id,
  targetId: task.targetId,
  agentId: 'agent-hkg-01',
  moduleKind: 'port-forwarding',
  status: 'passed',
  checks: [
    {
      id: 'port-free',
      label: 'Port 443 available',
      status: 'passed',
      severity: 'critical'
    }
  ],
  createdAt: task.createdAt,
  completedAt: '2026-06-02T00:00:10.000Z'
};

const currentRuntimeSnapshot: RuntimeSnapshot = {
  id: 'snapshot-current',
  taskId: task.id,
  targetId: task.targetId,
  targetLabel: task.targetLabel,
  agentId: 'agent-hkg-01',
  moduleKind: 'port-forwarding',
  reason: 'pre_apply',
  status: 'captured',
  checksum: 'sha256:current-snapshot',
  capturedAt: task.createdAt,
  capturedBy: task.actor,
  state: {
    listenPort: 443,
    unit: 'ou-forward-hkg-443.service'
  }
};

const agentLogChunk: AgentLogChunk = {
  eventId: 'evt-agent-log-001',
  agentId: 'agent-hkg-01',
  sessionId: 'sess-agent-log-01',
  seq: 12,
  observedAt: '2026-06-04T07:30:00.000Z',
  commandId: 'cmd-forward-apply-001',
  taskId: 'task-release-001',
  chunkSeq: 3,
  stream: 'stderr',
  content: 'failed to apply port-forwarding unit'
};

const agentLogArchive: AgentLogArchive = {
  id: 'agent-log-archive-test',
  agentId: 'agent-hkg-01',
  sessionIds: ['sess-agent-log-01'],
  taskId: 'task-release-001',
  commandId: 'cmd-forward-apply-001',
  stream: 'stderr',
  bucketStartAt: '2026-06-04T00:00:00.000Z',
  bucketEndAt: '2026-06-05T00:00:00.000Z',
  firstObservedAt: '2026-06-04T07:00:00.000Z',
  lastObservedAt: '2026-06-04T07:10:00.000Z',
  firstSeq: 8,
  lastSeq: 10,
  firstChunkSeq: 1,
  lastChunkSeq: 3,
  chunkCount: 3,
  contentBytes: 128,
  contentSha256: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  archivedAt: '2026-06-04T07:10:00.000Z',
  source: 'retention-prune'
};

describe('TasksPage', () => {
  it('frames execution records as an operational release control surface', () => {
    render(
      <TasksPage
        tasks={[task]}
        agentLogArchives={[agentLogArchive]}
        agentLogChunks={[agentLogChunk]}
        configRevisions={[configRevision]}
        preflightPlans={[currentPreflightPlan]}
        runtimeSnapshots={[currentRuntimeSnapshot]}
        language="en"
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    const overview = screen.getByRole('region', { name: 'Operational Overview' });
    expect(within(overview).getByText('Execution Log')).toBeInTheDocument();
    expect(within(overview).getByText('Track Master dispatch, Agent acknowledgement, preflight, snapshots, and rollback state for every high-risk change.')).toBeInTheDocument();
  });

  it('shows an execution overview with live task counts', () => {
    render(
      <TasksPage
        tasks={[
          { ...task, id: 'task-queued', status: 'queued' },
          { ...task, id: 'task-running', status: 'running' },
          { ...task, id: 'task-failed', status: 'failed' },
          { ...task, id: 'task-ready', status: 'succeeded', rollbackAvailable: true }
        ]}
        configRevisions={[]}
        preflightPlans={[]}
        runtimeSnapshots={[]}
        language="en"
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText('Execution Overview')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Total executions' })).toHaveTextContent('4');
    expect(screen.getByRole('group', { name: 'Active executions' })).toHaveTextContent('2');
    expect(screen.getByRole('group', { name: 'Needs attention' })).toHaveTextContent('1');
    expect(screen.getByRole('group', { name: 'Rollback ready' })).toHaveTextContent('1');
  });

  it('frames execution work as a cockpit with a control rail and release evidence workspace', () => {
    render(
      <TasksPage
        tasks={[task]}
        agentLogArchives={[agentLogArchive]}
        agentLogChunks={[agentLogChunk]}
        configRevisions={[configRevision]}
        preflightPlans={[currentPreflightPlan]}
        runtimeSnapshots={[currentRuntimeSnapshot]}
        language="en"
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'Execution release cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Execution control rail' });
    const workspace = within(cockpit).getByRole('region', { name: 'Release evidence workspace' });

    expect(within(rail).getByText('Release path')).toBeInTheDocument();
    expect(within(rail).getByRole('group', { name: 'Total executions' })).toHaveTextContent('1');
    expect(within(rail).getByRole('searchbox', { name: 'Search Tasks' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Select Visible Tasks' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Bulk Copy Task Contexts' })).toBeInTheDocument();

    expect(within(workspace).getByText('Release Pipeline · 1')).toBeInTheDocument();
    expect(within(workspace).getByText('Agent Runtime Logs · 1')).toBeInTheDocument();
    expect(within(workspace).getByText('Log Archives · 1')).toBeInTheDocument();
  });

  it('opens task details with metadata, release artifacts, related logs, and copyable context', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });

    render(
      <TasksPage
        tasks={[
          {
            ...task,
            status: 'running',
            attempts: 1,
            metadata: {
              listenPort: 443,
              targetEndpoint: '10.0.0.7:8443'
            },
            steps: [
              { id: 'compile', label: 'Compile forwarding config', status: 'succeeded' },
              { id: 'apply', label: 'Apply systemd unit', status: 'running' }
            ]
          }
        ]}
        agentLogArchives={[agentLogArchive]}
        agentLogChunks={[agentLogChunk]}
        configRevisions={[configRevision]}
        preflightPlans={[currentPreflightPlan]}
        runtimeSnapshots={[currentRuntimeSnapshot]}
        language="en"
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View Task Details' }));

    const dialog = screen.getByRole('dialog', { name: 'Task Details' });

    expect(within(dialog).getByText('task-release-001')).toBeInTheDocument();
    expect(within(dialog).getByText('req-release-001')).toBeInTheDocument();
    expect(within(dialog).getByText(/"targetEndpoint": "10\.0\.0\.7:8443"/)).toBeInTheDocument();
    expect(within(dialog).getByText('cfg-current')).toBeInTheDocument();
    expect(within(dialog).getByText('preflight-current')).toBeInTheDocument();
    expect(within(dialog).getByText('snapshot-current')).toBeInTheDocument();
    expect(within(dialog).getByText('failed to apply port-forwarding unit')).toBeInTheDocument();
    expect(within(dialog).getByText('agent-log-archive-test')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Copy Task Context' }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"taskId": "task-release-001"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"requestId": "req-release-001"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"configRevisionId": "cfg-current"'));
  });

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
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

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

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('回滚任务 task-release-001'));
    expect(onRollbackTask).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
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

  it('shows retained Agent runtime log chunks with task and command context', () => {
    render(
      <TasksPage
        tasks={[]}
        agentLogChunks={[agentLogChunk]}
        agentLogRetentionPolicy={{
          maxAgeMs: 3 * 24 * 60 * 60 * 1000,
          maxAgeDays: 3,
          maxEventsPerAgent: 120,
          source: 'runtime-config'
        }}
        configRevisions={[]}
        preflightPlans={[]}
        runtimeSnapshots={[]}
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText('主机代理运行日志 · 1')).toBeInTheDocument();
    expect(screen.getByText('留存策略')).toBeInTheDocument();
    expect(screen.getByText('保留 3 天')).toBeInTheDocument();
    expect(screen.getByText('每台主机代理 120 条')).toBeInTheDocument();
    expect(screen.getByText('运行配置')).toBeInTheDocument();
    const logArticle = screen.getByText('failed to apply port-forwarding unit').closest('article');
    expect(logArticle).not.toBeNull();
    expect(within(logArticle!).getByText('错误输出')).toBeInTheDocument();
    expect(within(logArticle!).getByText(/agent-hkg-01/)).toBeInTheDocument();
    expect(within(logArticle!).getByText(/cmd-forward-apply-001/)).toBeInTheDocument();
  });

  it('submits Agent log retention policy edits from the execution workspace', async () => {
    const user = userEvent.setup();
    const onUpdatePolicy = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

    render(
      <TasksPage
        tasks={[]}
        agentLogRetentionPolicy={{
          maxAgeMs: 3 * 24 * 60 * 60 * 1000,
          maxAgeDays: 3,
          maxEventsPerAgent: 120,
          source: 'control-plane'
        }}
        configRevisions={[]}
        preflightPlans={[]}
        runtimeSnapshots={[]}
        onUpdateAgentLogRetentionPolicy={onUpdatePolicy}
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    await user.clear(screen.getByLabelText('保留天数'));
    await user.type(screen.getByLabelText('保留天数'), '14');
    await user.clear(screen.getByLabelText('单机上限'));
    await user.type(screen.getByLabelText('单机上限'), '300');
    await user.click(screen.getByRole('button', { name: '保存策略' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('确认保存 Agent 日志留存策略'));
    expect(onUpdatePolicy).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: '保存策略' }));

    expect(onUpdatePolicy).toHaveBeenCalledWith({
      maxAgeDays: 14,
      maxEventsPerAgent: 300,
      reason: '操作员更新主机代理日志留存策略'
    });
  });

  it('requests retained Agent log export from the execution workspace', async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();

    render(
      <TasksPage
        tasks={[]}
        agentLogChunks={[agentLogChunk]}
        configRevisions={[]}
        preflightPlans={[]}
        runtimeSnapshots={[]}
        onExportAgentLogs={onExport}
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: '导出日志' }));

    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('filters Agent runtime logs before copying the visible evidence set', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    const stdoutChunk: AgentLogChunk = {
      ...agentLogChunk,
      eventId: 'evt-agent-log-stdout',
      commandId: 'cmd-forward-apply-stdout',
      chunkSeq: 4,
      stream: 'stdout',
      content: 'systemd unit applied successfully'
    };
    const stderrChunk: AgentLogChunk = {
      ...agentLogChunk,
      eventId: 'evt-agent-log-port-conflict',
      commandId: 'cmd-forward-apply-stderr',
      chunkSeq: 5,
      stream: 'stderr',
      content: 'port_conflict: 0.0.0.0:2443 is already in use'
    };

    render(
      <TasksPage
        tasks={[]}
        agentLogChunks={[stdoutChunk, stderrChunk]}
        configRevisions={[]}
        preflightPlans={[]}
        runtimeSnapshots={[]}
        language="en"
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search Agent Logs' }), '2443');
    await user.selectOptions(screen.getByLabelText('Log Stream'), 'stderr');

    expect(screen.getByText('Matching Logs 1 / 2')).toBeInTheDocument();
    expect(screen.getByText('port_conflict: 0.0.0.0:2443 is already in use')).toBeInTheDocument();
    expect(screen.queryByText('systemd unit applied successfully')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy Visible Logs' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedPayload = JSON.parse(writeText.mock.calls[0]?.[0] as string) as {
      logCount: number;
      logs: Array<{
        eventId: string;
        stream: AgentLogChunk['stream'];
        content: string;
      }>;
    };

    expect(copiedPayload.logCount).toBe(1);
    expect(copiedPayload.logs).toEqual([
      expect.objectContaining({
        eventId: 'evt-agent-log-port-conflict',
        stream: 'stderr',
        content: 'port_conflict: 0.0.0.0:2443 is already in use'
      })
    ]);
    expect(writeText.mock.calls[0]?.[0]).not.toContain('evt-agent-log-stdout');
  });

  it('shows Agent log archives and requests archive export from the execution workspace', async () => {
    const user = userEvent.setup();
    const onExportArchives = vi.fn();

    render(
      <TasksPage
        tasks={[]}
        agentLogArchives={[agentLogArchive]}
        configRevisions={[]}
        preflightPlans={[]}
        runtimeSnapshots={[]}
        onExportAgentLogArchives={onExportArchives}
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText('日志归档 · 1')).toBeInTheDocument();
    expect(screen.getByText('3 个片段')).toBeInTheDocument();
    expect(screen.getByText('128 字节')).toBeInTheDocument();
    expect(screen.getByText('sha256:abcdef1234567890')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '导出归档' }));

    expect(onExportArchives).toHaveBeenCalledTimes(1);
  });

  it('filters Agent log archives before copying the visible archive evidence set', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    const stdoutArchive: AgentLogArchive = {
      ...agentLogArchive,
      id: 'agent-log-archive-stdout',
      commandId: 'cmd-forward-apply-stdout',
      stream: 'stdout',
      contentSha256: '1111111111111111111111111111111111111111111111111111111111111111'
    };
    const stderrArchive: AgentLogArchive = {
      ...agentLogArchive,
      id: 'agent-log-archive-port-conflict',
      commandId: 'cmd-forward-apply-conflict',
      stream: 'stderr',
      contentSha256: '2222222222222222222222222222222222222222222222222222222222222222'
    };

    render(
      <TasksPage
        tasks={[]}
        agentLogArchives={[stdoutArchive, stderrArchive]}
        configRevisions={[]}
        preflightPlans={[]}
        runtimeSnapshots={[]}
        language="en"
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search Log Archives' }), 'conflict');
    await user.selectOptions(screen.getByLabelText('Archive Stream'), 'stderr');

    expect(screen.getByText('Matching Archives 1 / 2')).toBeInTheDocument();
    expect(screen.getByText('agent-log-archive-port-conflict')).toBeInTheDocument();
    expect(screen.queryByText('agent-log-archive-stdout')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy Visible Archives' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedPayload = JSON.parse(writeText.mock.calls[0]?.[0] as string) as {
      archiveCount: number;
      archives: Array<{
        id: string;
        stream: AgentLogArchive['stream'];
        contentSha256: string;
      }>;
    };

    expect(copiedPayload.archiveCount).toBe(1);
    expect(copiedPayload.archives).toEqual([
      expect.objectContaining({
        id: 'agent-log-archive-port-conflict',
        stream: 'stderr',
        contentSha256: '2222222222222222222222222222222222222222222222222222222222222222'
      })
    ]);
    expect(writeText.mock.calls[0]?.[0]).not.toContain('agent-log-archive-stdout');
  });

  it('filters failed tasks before opening failure evidence and retrying the task feed', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    const onRefresh = vi.fn();
    const failedTask: DeployTask = {
      ...task,
      id: 'task-forward-failed-001',
      status: 'failed',
      operation: 'forward.apply',
      targetLabel: 'Acme Game Forward',
      summary: 'Apply Acme game forwarding',
      failureReason: 'port_conflict: 0.0.0.0:2443 is already in use',
      rollbackTaskId: 'task-auto-rollback-forward-001',
      attempts: 2,
      metadata: {
        retryable: false
      },
      steps: [
        { id: 'compile', label: 'Compile forwarding config', status: 'succeeded' },
        { id: 'apply', label: 'Apply systemd unit', status: 'failed' }
      ]
    };
    const succeededTask: DeployTask = {
      ...task,
      id: 'task-subscription-ok-001',
      status: 'succeeded',
      operation: 'subscription.sync',
      targetLabel: 'Backup Subscription Source',
      summary: 'Sync backup subscription',
      resourceType: 'subscription',
      resourceId: 'sub-source-backup'
    };

    render(
      <TasksPage
        tasks={[failedTask, succeededTask]}
        configRevisions={[]}
        preflightPlans={[]}
        runtimeSnapshots={[]}
        language="en"
        onRollbackTask={vi.fn()}
        onRefresh={onRefresh}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search Tasks' }), 'acme');
    await user.selectOptions(screen.getByLabelText('Task Status'), 'failed');
    await user.selectOptions(screen.getByLabelText('Operation'), 'forward.apply');

    expect(screen.getByText('Matching 1 / 2')).toBeInTheDocument();
    expect(screen.getByText('Apply Acme game forwarding')).toBeInTheDocument();
    expect(screen.queryByText('Sync backup subscription')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View Failure Evidence' }));

    const dialog = screen.getByRole('dialog', { name: 'Task Failure Evidence' });

    expect(within(dialog).getByText('port_conflict: 0.0.0.0:2443 is already in use')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Apply systemd unit')).toHaveLength(2);
    expect(within(dialog).getByText('Failed')).toBeInTheDocument();
    expect(within(dialog).getByText('Task Remediation Plan')).toBeInTheDocument();
    expect(within(dialog).getByText('Retryable')).toBeInTheDocument();
    expect(within(dialog).getByText('No')).toBeInTheDocument();
    expect(within(dialog).getByText('Rollback Task')).toBeInTheDocument();
    expect(within(dialog).getByText('task-auto-rollback-forward-001')).toBeInTheDocument();
    expect(
      within(dialog).getAllByText('Free or change the conflicting listen port, then create a fresh apply task after preflight passes.')
    ).toHaveLength(2);

    await user.click(within(dialog).getByRole('button', { name: 'Copy Remediation Plan' }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Task: task-forward-failed-001'));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('Failure Reason: port_conflict: 0.0.0.0:2443 is already in use')
    );
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Failed Step: apply · Apply systemd unit'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Retryable: false'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Rollback Task: task-auto-rollback-forward-001'));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('Next Step: Free or change the conflicting listen port, then create a fresh apply task after preflight passes.')
    );

    await user.click(within(dialog).getByRole('button', { name: 'Retry / Refresh Task' }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('copies a complete failure evidence package with runtime artifacts and related logs', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    const failedTask: DeployTask = {
      ...task,
      status: 'failed',
      summary: 'Apply port forwarding policy',
      failureReason: 'port_conflict: 0.0.0.0:443 is already in use',
      attempts: 2,
      rollbackTaskId: 'task-forward-rollback-001',
      metadata: {
        retryable: false,
        listenPort: 443,
        targetEndpoint: '10.0.0.7:8443'
      },
      steps: [
        { id: 'compile', label: 'Compile forwarding config', status: 'succeeded' },
        { id: 'preflight-port', label: 'Check listen port availability', status: 'failed' }
      ]
    };
    const failedConfigRevision: RuntimeConfigRevision = {
      ...configRevision,
      status: 'failed',
      failureReason: 'port_conflict: 0.0.0.0:443 is already in use'
    };
    const failedPreflightPlan: RuntimePreflightPlan = {
      ...currentPreflightPlan,
      status: 'failed',
      failureReason: 'port_conflict: 0.0.0.0:443 is already in use',
      checks: [
        {
          id: 'port-conflict',
          label: 'Check listen port availability',
          status: 'failed',
          severity: 'critical'
        }
      ]
    };
    const verifiedSnapshot: RuntimeSnapshot = {
      ...currentRuntimeSnapshot,
      status: 'verified'
    };

    render(
      <TasksPage
        tasks={[failedTask]}
        agentLogArchives={[agentLogArchive]}
        agentLogChunks={[agentLogChunk]}
        configRevisions={[failedConfigRevision]}
        preflightPlans={[failedPreflightPlan]}
        runtimeSnapshots={[verifiedSnapshot]}
        language="en"
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View Failure Evidence' }));
    const dialog = screen.getByRole('dialog', { name: 'Task Failure Evidence' });

    await user.click(within(dialog).getByRole('button', { name: 'Copy Failure Evidence Package' }));

    expect(writeText).toHaveBeenCalledTimes(1);

    const copiedPayload = JSON.parse(writeText.mock.calls[0]?.[0] as string) as {
      taskId: string;
      failureReason: string;
      failedSteps: Array<{ id: string; label: string }>;
      remediationPlan: { nextStep: string; retryable?: boolean; rollbackTaskId?: string };
      runtimeArtifacts: {
        configRevision?: { id: string; status: string; failureReason?: string };
        preflightPlan?: { id: string; status: string; failedChecks: Array<{ id: string; status: string }> };
        runtimeSnapshot?: { id: string; status: string; checksum: string };
      };
      relatedAgentLogs: { logCount: number; logs: Array<{ eventId: string; content: string }> };
      relatedLogArchives: { archiveCount: number; archives: Array<{ id: string; contentSha256: string }> };
    };

    expect(copiedPayload.taskId).toBe('task-release-001');
    expect(copiedPayload.failureReason).toBe('port_conflict: 0.0.0.0:443 is already in use');
    expect(copiedPayload.failedSteps).toEqual([
      expect.objectContaining({
        id: 'preflight-port',
        label: 'Check listen port availability'
      })
    ]);
    expect(copiedPayload.remediationPlan).toEqual(
      expect.objectContaining({
        retryable: false,
        rollbackTaskId: 'task-forward-rollback-001'
      })
    );
    expect(copiedPayload.runtimeArtifacts.configRevision).toEqual(
      expect.objectContaining({
        id: 'cfg-current',
        status: 'failed',
        failureReason: 'port_conflict: 0.0.0.0:443 is already in use'
      })
    );
    expect(copiedPayload.runtimeArtifacts.preflightPlan).toEqual(
      expect.objectContaining({
        id: 'preflight-current',
        status: 'failed',
        failedChecks: [
          expect.objectContaining({
            id: 'port-conflict',
            status: 'failed'
          })
        ]
      })
    );
    expect(copiedPayload.runtimeArtifacts.runtimeSnapshot).toEqual(
      expect.objectContaining({
        id: 'snapshot-current',
        status: 'verified',
        checksum: 'sha256:current-snapshot'
      })
    );
    expect(copiedPayload.relatedAgentLogs).toEqual(
      expect.objectContaining({
        logCount: 1,
        logs: [
          expect.objectContaining({
            eventId: 'evt-agent-log-001',
            content: 'failed to apply port-forwarding unit'
          })
        ]
      })
    );
    expect(copiedPayload.relatedLogArchives).toEqual(
      expect.objectContaining({
        archiveCount: 1,
        archives: [
          expect.objectContaining({
            id: 'agent-log-archive-test',
            contentSha256: agentLogArchive.contentSha256
          })
        ]
      })
    );
  });

  it('copies remediation plans only for selected failed tasks', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    const failedTask: DeployTask = {
      ...task,
      id: 'task-forward-failed-001',
      status: 'failed',
      operation: 'forward.apply',
      targetLabel: 'Acme Game Forward',
      summary: 'Apply Acme game forwarding',
      failureReason: 'port_conflict: 0.0.0.0:2443 is already in use',
      rollbackTaskId: 'task-auto-rollback-forward-001',
      attempts: 2,
      metadata: {
        retryable: false
      },
      steps: [
        { id: 'compile', label: 'Compile forwarding config', status: 'succeeded' },
        { id: 'apply', label: 'Apply systemd unit', status: 'failed' }
      ]
    };
    const runtimeFailedTask: DeployTask = {
      ...task,
      id: 'task-runtime-failed-002',
      status: 'failed',
      operation: 'runtime.reload',
      targetLabel: 'HKG Runtime',
      summary: 'Reload HKG runtime',
      resourceType: 'module',
      resourceId: 'runtime-hkg',
      failureReason: 'runtime reload health check failed',
      requestId: 'req-runtime-failed-002',
      attempts: 1,
      metadata: {
        retryable: true
      },
      steps: [{ id: 'reload', label: 'Reload runtime', status: 'failed' }]
    };
    const succeededTask: DeployTask = {
      ...task,
      id: 'task-subscription-ok-001',
      status: 'succeeded',
      operation: 'subscription.sync',
      targetLabel: 'Backup Subscription Source',
      summary: 'Sync backup subscription',
      resourceType: 'subscription',
      resourceId: 'sub-source-backup'
    };

    render(
      <TasksPage
        tasks={[failedTask, runtimeFailedTask, succeededTask]}
        configRevisions={[]}
        preflightPlans={[]}
        runtimeSnapshots={[]}
        language="en"
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Bulk Copy Remediation Plans' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Select Visible Tasks' }));

    expect(screen.getByText('Failure Tasks 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bulk Copy Remediation Plans' })).not.toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Bulk Copy Remediation Plans' }));

    expect(writeText).toHaveBeenCalledTimes(1);

    const copiedPlan = writeText.mock.calls[0]?.[0] as string;

    expect(copiedPlan.match(/^Task:/gm)).toHaveLength(2);
    expect(copiedPlan).toContain('Task: task-forward-failed-001');
    expect(copiedPlan).toContain('Task: task-runtime-failed-002');
    expect(copiedPlan).not.toContain('task-subscription-ok-001');
    expect(copiedPlan).toContain('Retryable: false');
    expect(copiedPlan).toContain('Retryable: true');
    expect(copiedPlan).toContain('Rollback Task: task-auto-rollback-forward-001');
    expect(copiedPlan).toContain('Next Step: Free or change the conflicting listen port');
    expect(copiedPlan).toContain('Next Step: Inspect failed step evidence and related Agent logs');
  });

  it('filters tasks before selecting visible rows and bulk copying task contexts', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    const failedTask: DeployTask = {
      ...task,
      id: 'task-forward-failed-001',
      status: 'failed',
      operation: 'forward.apply',
      targetLabel: 'Acme Game Forward',
      summary: 'Apply Acme game forwarding',
      failureReason: 'port_conflict: 0.0.0.0:2443 is already in use',
      attempts: 2,
      metadata: {
        listenPort: 2443,
        targetEndpoint: '10.0.0.18:443'
      },
      steps: [
        { id: 'compile', label: 'Compile forwarding config', status: 'succeeded' },
        { id: 'apply', label: 'Apply systemd unit', status: 'failed' }
      ]
    };
    const succeededTask: DeployTask = {
      ...task,
      id: 'task-subscription-ok-001',
      status: 'succeeded',
      operation: 'subscription.sync',
      targetLabel: 'Backup Subscription Source',
      summary: 'Sync backup subscription',
      resourceType: 'subscription',
      resourceId: 'sub-source-backup'
    };

    render(
      <TasksPage
        tasks={[failedTask, succeededTask]}
        agentLogArchives={[{ ...agentLogArchive, taskId: failedTask.id }]}
        agentLogChunks={[{ ...agentLogChunk, taskId: failedTask.id }]}
        configRevisions={[{ ...configRevision, taskId: failedTask.id }]}
        preflightPlans={[{ ...currentPreflightPlan, taskId: failedTask.id }]}
        runtimeSnapshots={[{ ...currentRuntimeSnapshot, taskId: failedTask.id }]}
        language="en"
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search Tasks' }), 'acme');
    await user.selectOptions(screen.getByLabelText('Task Status'), 'failed');
    await user.selectOptions(screen.getByLabelText('Operation'), 'forward.apply');

    await user.click(screen.getByRole('button', { name: 'Select Visible Tasks' }));
    await user.click(screen.getByRole('button', { name: 'Bulk Copy Task Contexts' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedPayload = JSON.parse(writeText.mock.calls[0]?.[0] as string) as {
      taskCount: number;
      tasks: Array<{
        taskId: string;
        configRevisionId?: string;
        relatedLogEventIds: string[];
        relatedArchiveIds: string[];
      }>;
    };

    expect(copiedPayload.taskCount).toBe(1);
    expect(copiedPayload.tasks).toHaveLength(1);
    expect(copiedPayload.tasks[0]).toMatchObject({
      taskId: 'task-forward-failed-001',
      configRevisionId: 'cfg-current',
      relatedLogEventIds: ['evt-agent-log-001'],
      relatedArchiveIds: ['agent-log-archive-test']
    });
    expect(writeText.mock.calls[0]?.[0]).not.toContain('task-subscription-ok-001');
  });
});
