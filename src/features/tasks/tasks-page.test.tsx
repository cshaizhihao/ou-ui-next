import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TasksPage } from './tasks-page';
import type { AgentLogArchive } from '../../domain';
import type { RuntimeConfigRevision, RuntimePreflightPlan, RuntimeSnapshot } from '../../domain/runtime-release';
import type { DeployTask } from '../../domain/task';
import type { AgentLogChunk, CommandOutboxSummary } from '../../services/api/control-plane-api';

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

const forwardingRuntimeDiagnosisArtifact = {
  state: 'degraded',
  reasons: ['no-runtime-service', 'blocked-runtime-controls', 'deploying'],
  blockedControls: ['ipRateLimitMbps', 'proxyProtocol'],
  nextActions: ['apply', 'inspect-agent'],
  hasRuntimeEvidence: false,
  impactedBindingCount: 1,
  evidenceStage: 'control-plane-compiled',
  plannedBindingStatus: 'deploying',
  plannedRuntimeServices: ['ou-forward-forward-hkg-443-agent-hkg-01']
};

const diagnosticConfigRevision: RuntimeConfigRevision = {
  ...configRevision,
  artifact: {
    runtimeDiagnosis: forwardingRuntimeDiagnosisArtifact
  }
};

const xrayTask: DeployTask = {
  ...task,
  id: 'task-xray-001',
  operation: 'inbound.update',
  resourceType: 'inbound',
  resourceId: 'inbound-shared-443',
  targetId: 'inbound-shared-443',
  targetLabel: 'Shared Xray Inbound',
  summary: 'Update shared Xray inbound',
  requestId: 'req-xray-001',
  status: 'running',
  metadata: {
    listenPort: 443,
    xrayProtocol: 'vless',
    security: 'tls',
    clientIdentity: 'alice'
  }
};

const xrayRuntimeDiagnosisArtifact = {
  state: 'degraded',
  reasons: ['deploying', 'quota-exceeded', 'runtime-disabled-by-policy', 'multi-client', 'tls', 'xray-config-preflight'],
  nextActions: ['apply', 'reset-quota', 'review-security', 'inspect-agent'],
  hasRuntimeEvidence: false,
  evidenceStage: 'control-plane-compiled',
  plannedBindingStatus: 'deploying',
  plannedRuntimeServices: ['ou-ui-xray.service'],
  plannedInbound: {
    agentId: 'agent-hkg-01',
    listenAddress: '0.0.0.0',
    listenPort: 443,
    protocol: 'vless',
    network: 'tcp',
    security: 'tls',
    action: 'upsert_inbound'
  },
  clientCounters: {
    total: 2,
    active: 1,
    disabled: 1,
    quotaExceeded: 1,
    expired: 0,
    runtimeDisabledByPolicy: 1
  }
};

const xrayConfigRevision: RuntimeConfigRevision = {
  ...configRevision,
  id: 'cfg-xray-current',
  taskId: xrayTask.id,
  operation: xrayTask.operation,
  targetId: xrayTask.targetId,
  targetLabel: xrayTask.targetLabel,
  moduleKind: 'xray',
  artifactUri: 'ou-ui://artifacts/config-revisions/cfg-xray-current.json',
  preflightPlanId: 'preflight-xray-current',
  snapshotBeforeId: 'snapshot-xray-current',
  artifact: {
    runtimeDiagnosis: xrayRuntimeDiagnosisArtifact
  }
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

const xrayPreflightPlan: RuntimePreflightPlan = {
  ...currentPreflightPlan,
  id: 'preflight-xray-current',
  taskId: xrayTask.id,
  configRevisionId: xrayConfigRevision.id,
  targetId: xrayTask.targetId,
  agentId: 'agent-hkg-01',
  moduleKind: 'xray',
  checks: [
    {
      id: 'xray-config-test',
      label: 'xray run -test passed',
      status: 'pending',
      severity: 'critical'
    }
  ]
};

const xrayRuntimeSnapshot: RuntimeSnapshot = {
  ...currentRuntimeSnapshot,
  id: 'snapshot-xray-current',
  taskId: xrayTask.id,
  targetId: xrayTask.targetId,
  targetLabel: xrayTask.targetLabel,
  agentId: 'agent-hkg-01',
  moduleKind: 'xray',
  checksum: 'sha256:xray-snapshot',
  state: {
    service: 'ou-ui-xray.service',
    listenPort: 443
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

const commandOutboxSummary: CommandOutboxSummary = {
  id: 'outbox-release-001',
  taskId: task.id,
  commandId: 'cmd-forward-apply-001',
  agentId: 'agent-hkg-01',
  seq: 42,
  status: 'completed',
  transport: 'http-pull',
  commandType: 'apply',
  attempts: 1,
  createdAt: '2026-06-02T00:00:01.000Z',
  updatedAt: '2026-06-02T00:00:08.000Z',
  deadlineAt: '2026-06-02T00:05:00.000Z',
  ackedAt: '2026-06-02T00:00:03.000Z',
  resultAt: '2026-06-02T00:00:08.000Z'
};

const xrayCommandOutboxSummary: CommandOutboxSummary = {
  ...commandOutboxSummary,
  id: 'outbox-xray-release-001',
  taskId: xrayTask.id,
  commandId: 'cmd-xray-apply-001',
  agentId: 'agent-hkg-01'
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
        commandOutbox={[commandOutboxSummary]}
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
    const commandEvidence = screen.getByRole('group', { name: 'Agent Command' });
    expect(commandEvidence).toHaveTextContent('outbox-release-001');
    expect(commandEvidence).toHaveTextContent('Completed');
    expect(commandEvidence).toHaveTextContent('apply · agent-hkg-01 · cmd-forward-apply-001');
    expect(commandEvidence).toHaveTextContent('ACK');
    expect(commandEvidence).toHaveTextContent('Result');
    expect(
      within(overview).queryByText(
        'Track Master dispatch, Agent acknowledgement, preflight, snapshots, and rollback state for every high-risk change.'
      )
    ).not.toBeInTheDocument();
  });

  it('does not pad the execution workspace with explanatory filler copy', () => {
    render(
      <TasksPage
        tasks={[]}
        agentLogArchives={[]}
        agentLogChunks={[]}
        configRevisions={[]}
        preflightPlans={[]}
        runtimeSnapshots={[]}
        language="en"
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'Execution release cockpit' });

    expect(cockpit).toHaveTextContent('Release path');
    expect(cockpit).toHaveTextContent('Execution Release Gates');
    expect(cockpit).toHaveTextContent('Release Pipeline');
    expect(cockpit).not.toHaveTextContent('Confirm Master dispatch');
    expect(cockpit).not.toHaveTextContent('Keep queue');
    expect(cockpit).not.toHaveTextContent('Keep the queue');
    expect(cockpit).not.toHaveTextContent('New execution records will appear');
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

  it('keeps execution overview metrics free of explanatory filler text', () => {
    render(
      <TasksPage
        tasks={[
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

    const cockpit = screen.getByRole('region', { name: 'Execution release cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Execution control rail' });

    expect(within(rail).getByRole('group', { name: 'Total executions' })).toHaveTextContent('3');
    expect(within(rail).getByRole('group', { name: 'Active executions' })).toHaveTextContent('1');
    expect(within(rail).getByRole('group', { name: 'Needs attention' })).toHaveTextContent('1');
    expect(within(rail).getByRole('group', { name: 'Rollback ready' })).toHaveTextContent('1');
    expect(rail).not.toHaveTextContent('All execution records currently in the pipeline view.');
    expect(rail).not.toHaveTextContent('Tasks that are queued, running, or retrying right now.');
    expect(rail).not.toHaveTextContent('Failed tasks or records with failure evidence.');
    expect(rail).not.toHaveTextContent('Succeeded tasks that still have a rollback path.');
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

  it('uses a v2 release cockpit visual system for the execution control plane', () => {
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
    const pipeline = within(workspace).getByRole('group', { name: 'Release Pipeline' });
    const taskRow = within(pipeline).getByRole('article', { name: 'Apply port forwarding policy' });

    expect(cockpit).toHaveClass('tasks-release-cockpit');
    expect(rail).toHaveClass('tasks-release-rail');
    expect(workspace).toHaveClass('tasks-release-workspace');
    expect(pipeline).toHaveClass('tasks-release-panel');
    expect(taskRow).toHaveClass('tasks-release-row');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).toContain('#1E3AFF');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).toContain('#FF3D18');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).toContain('#D9FF00');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).toContain('#00A878');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('blue-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('orange-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('sky-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('indigo-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('cyan-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('purple-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('violet-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('background-clip:text');
  });

  it('keeps the execution evidence cockpit compact and rejects masonry-style layout', () => {
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
    const cockpitGrid = cockpit.firstElementChild as HTMLElement;
    const rail = within(cockpit).getByRole('complementary', { name: 'Execution control rail' });
    const workspace = within(cockpit).getByRole('region', { name: 'Release evidence workspace' });
    const workspaceStack = workspace.firstElementChild as HTMLElement;
    const pipeline = within(workspace).getByRole('group', { name: 'Release Pipeline' });
    const taskRow = within(pipeline).getByRole('article', { name: 'Apply port forwarding policy' });
    const gates = within(rail).getByRole('region', { name: 'Execution Release Gates' });
    const gateRow = within(gates).getByRole('group', { name: 'Execution Queue' });
    const logPanel = within(workspace).getByRole('group', { name: /Agent Runtime Logs/ });
    const archivePanel = within(workspace).getByRole('group', { name: /Log Archives/ });
    const layoutHtml = `${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`;

    expect(cockpitGrid).toHaveClass('tasks-release-cockpit-grid');
    expect(cockpitGrid).toHaveClass('xl:grid-cols-[18rem_minmax(0,1fr)]');
    expect(rail).toHaveClass('p-3');
    expect(rail).not.toHaveClass('p-4');
    expect(workspaceStack).toHaveClass('space-y-3');
    expect(workspaceStack).toHaveClass('p-3');
    expect(pipeline).toHaveClass('p-3');
    expect(pipeline).not.toHaveClass('p-5');
    expect(taskRow).toHaveClass('p-3');
    expect(taskRow).not.toHaveClass('rounded-xl');
    expect(gateRow).toHaveClass('tasks-release-gate-row');
    expect(gateRow).toHaveClass('min-h-[76px]');
    expect(gateRow).toHaveClass('px-3');
    expect(gateRow).toHaveClass('py-2.5');
    expect(gateRow).not.toHaveClass('min-h-20');
    expect(gateRow).not.toHaveClass('px-4');
    expect(gateRow).not.toHaveClass('py-3');
    expect(logPanel).toHaveClass('tasks-agent-log-panel');
    expect(logPanel).toHaveClass('p-3');
    expect(archivePanel).toHaveClass('tasks-agent-archive-panel');
    expect(archivePanel).toHaveClass('p-3');
    expect(layoutHtml).not.toContain('masonry');
    expect(layoutHtml).not.toContain('columns-');
    expect(layoutHtml).not.toContain('grid-flow-row-dense');
    expect(layoutHtml).not.toContain('row-span');
    expect(layoutHtml).not.toContain('col-span');
  });

  it('keeps execution empty states compact inside the release evidence workspace', () => {
    render(
      <TasksPage
        tasks={[]}
        agentLogArchives={[]}
        agentLogChunks={[]}
        configRevisions={[]}
        preflightPlans={[]}
        runtimeSnapshots={[]}
        language="en"
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    const workspace = screen.getByRole('region', { name: 'Release evidence workspace' });
    const pipeline = within(workspace).getByRole('group', { name: 'Release Pipeline' });
    const releaseEmptyState = within(pipeline).getByText('No execution records').closest('.tasks-release-empty-state');
    const agentLogEmptyState = within(workspace).getByText('No runtime logs retained').closest('.tasks-agent-log-empty-state');
    const archiveEmptyState = within(workspace).getByText('No log archives yet').closest('.tasks-agent-archive-empty-state');

    for (const emptyState of [releaseEmptyState, agentLogEmptyState, archiveEmptyState]) {
      expect(emptyState).toHaveClass('p-3');
      expect(emptyState).not.toHaveClass('p-8', 'p-5', 'rounded-xl');
    }
  });

  it('keeps filtered execution evidence empty states compact instead of oversized cards', async () => {
    const user = userEvent.setup();

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

    await user.type(screen.getByRole('searchbox', { name: 'Search Tasks' }), 'missing execution');
    await user.type(screen.getByRole('searchbox', { name: 'Search Agent Logs' }), 'missing log');
    await user.type(screen.getByRole('searchbox', { name: 'Search Log Archives' }), 'missing archive');

    const workspace = screen.getByRole('region', { name: 'Release evidence workspace' });
    const pipeline = within(workspace).getByRole('group', { name: 'Release Pipeline' });
    const releaseEmptyState = within(pipeline).getByText('No matching execution records').closest('.tasks-release-empty-state');
    const agentLogEmptyState = within(workspace).getByText('No runtime logs retained').closest('.tasks-agent-log-empty-state');
    const archiveEmptyState = within(workspace).getByText('No log archives yet').closest('.tasks-agent-archive-empty-state');

    for (const emptyState of [releaseEmptyState, agentLogEmptyState, archiveEmptyState]) {
      expect(emptyState).toHaveClass('p-3');
      expect(emptyState).not.toHaveClass('p-8', 'p-5', 'rounded-xl');
    }
  });

  it('surfaces execution release gates on the control rail', () => {
    render(
      <TasksPage
        tasks={[
          { ...task, id: 'task-running', status: 'running' },
          {
            ...task,
            id: 'task-failed',
            status: 'failed',
            failureReason: 'runtime reload health check failed'
          },
          { ...task, id: 'task-rollback', status: 'succeeded', rollbackAvailable: true }
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

    const cockpit = screen.getByRole('region', { name: 'Execution release cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Execution control rail' });
    const gates = within(rail).getByRole('region', { name: 'Execution Release Gates' });

    expect(gates).toHaveClass('tasks-release-gate-panel');
    expect(gates.outerHTML).toContain('#1E3AFF');
    expect(gates.outerHTML).toContain('#FF3D18');
    expect(gates.outerHTML).toContain('#D9FF00');
    expect(gates.outerHTML).toContain('#00A878');
    expect(within(gates).getByRole('group', { name: 'Execution Queue' })).toHaveTextContent('Waiting');
    expect(within(gates).getByRole('group', { name: 'Failure Handling' })).toHaveTextContent('Issues');
    expect(within(gates).getByRole('group', { name: 'Release Artifacts' })).toHaveTextContent('Ready');
    expect(within(gates).getByRole('group', { name: 'Rollback Boundary' })).toHaveTextContent('Ready');
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
        configRevisions={[diagnosticConfigRevision]}
        preflightPlans={[currentPreflightPlan]}
        runtimeSnapshots={[currentRuntimeSnapshot]}
        language="en"
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    const pipeline = screen.getByRole('group', { name: 'Release Pipeline' });
    const taskRow = within(pipeline).getByRole('article', { name: 'Apply port forwarding policy' });
    const rowDiagnosis = within(taskRow).getByRole('group', { name: 'Forwarding Runtime Diagnosis' });

    expect(rowDiagnosis).toHaveClass('tasks-forwarding-runtime-diagnosis');
    expect(rowDiagnosis).toHaveAttribute('data-runtime-diagnosis-state', 'degraded');
    expect(rowDiagnosis).toHaveTextContent('control-plane-compiled');
    expect(rowDiagnosis).toHaveTextContent('1 impacted bindings / waiting for Agent evidence');
    expect(rowDiagnosis).toHaveTextContent('deploying');
    expect(rowDiagnosis).toHaveTextContent('ou-forward-forward-hkg-443-agent-hkg-01');
    expect(rowDiagnosis).toHaveTextContent('No runtime service');
    expect(rowDiagnosis).toHaveTextContent('Blocked controls present');
    expect(rowDiagnosis).toHaveTextContent('ipRateLimitMbps');
    expect(rowDiagnosis).toHaveTextContent('proxyProtocol');
    expect(rowDiagnosis).toHaveTextContent('Apply');
    expect(rowDiagnosis).toHaveTextContent('Inspect Agent');

    await user.click(screen.getByRole('button', { name: 'View Task Details' }));

    const dialog = screen.getByRole('dialog', { name: 'Task Details' });
    const dialogDiagnosis = within(dialog).getByRole('group', { name: 'Forwarding Runtime Diagnosis' });

    expect(within(dialog).getByText('task-release-001')).toBeInTheDocument();
    expect(within(dialog).getByText('req-release-001')).toBeInTheDocument();
    expect(within(dialog).getByText(/"targetEndpoint": "10\.0\.0\.7:8443"/)).toBeInTheDocument();
    expect(within(dialog).getAllByText('cfg-current').length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getAllByText('preflight-current').length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getAllByText('snapshot-current').length).toBeGreaterThanOrEqual(1);
    expect(dialogDiagnosis).toHaveTextContent('Forwarding Runtime Diagnosis');
    expect(dialogDiagnosis).toHaveTextContent('Degraded');
    expect(dialogDiagnosis).toHaveTextContent('ipRateLimitMbps');
    expect(within(dialog).getByText('failed to apply port-forwarding unit')).toBeInTheDocument();
    expect(within(dialog).getByText('agent-log-archive-test')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Copy Task Context' }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"taskId": "task-release-001"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"requestId": "req-release-001"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"configRevisionId": "cfg-current"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"runtimeDiagnosis": {'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"state": "degraded"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"blockedControls": ['));
  });

  it('surfaces Xray runtime diagnosis in release rows, task details, and copied context', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });

    render(
      <TasksPage
        tasks={[{ ...xrayTask, status: 'succeeded' }]}
        commandOutbox={[xrayCommandOutboxSummary]}
        configRevisions={[{ ...xrayConfigRevision, status: 'applied' }]}
        preflightPlans={[{ ...xrayPreflightPlan, status: 'passed' }]}
        runtimeSnapshots={[{ ...xrayRuntimeSnapshot, status: 'verified' }]}
        language="en"
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    const pipeline = screen.getByRole('group', { name: 'Release Pipeline' });
    const taskRow = within(pipeline).getByRole('article', { name: 'Update shared Xray inbound' });
    const runtimeVerification = within(taskRow).getByRole('group', { name: 'Runtime Verification' });
    const rowDiagnosis = within(taskRow).getByRole('group', { name: 'Xray Runtime Diagnosis' });

    expect(runtimeVerification).toHaveAttribute('data-runtime-verification-state', 'waiting');
    expect(runtimeVerification).toHaveTextContent('Awaiting Evidence');
    expect(runtimeVerification).toHaveTextContent('Agent Result');
    expect(runtimeVerification).toHaveTextContent('control-plane-compiled');
    expect(rowDiagnosis).toHaveClass('tasks-xray-runtime-diagnosis');
    expect(rowDiagnosis).toHaveAttribute('data-runtime-diagnosis-state', 'degraded');
    expect(rowDiagnosis).toHaveTextContent('control-plane-compiled');
    expect(rowDiagnosis).toHaveTextContent('1 active / 2 clients / 1 disabled / runtime evidence present');
    expect(rowDiagnosis).toHaveTextContent('agent-hkg-01 · 0.0.0.0:443 · vless/tcp/tls · upsert_inbound');
    expect(rowDiagnosis).toHaveTextContent('ou-ui-xray.service');
    expect(rowDiagnosis).toHaveTextContent('Quota exceeded');
    expect(rowDiagnosis).toHaveTextContent('Runtime stopped by policy');
    expect(rowDiagnosis).toHaveTextContent('Xray config preflight');
    expect(rowDiagnosis).toHaveTextContent('Reset quota');
    expect(rowDiagnosis).toHaveTextContent('Inspect Agent');

    await user.click(screen.getByRole('button', { name: 'View Task Details' }));

    const dialog = screen.getByRole('dialog', { name: 'Task Details' });
    const dialogDiagnosis = within(dialog).getByRole('group', { name: 'Xray Runtime Diagnosis' });

    expect(within(dialog).getAllByText('cfg-xray-current').length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getAllByText('preflight-xray-current').length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getAllByText('snapshot-xray-current').length).toBeGreaterThanOrEqual(1);
    expect(dialogDiagnosis).toHaveTextContent('Shared inbound');
    expect(dialogDiagnosis).toHaveTextContent('Review TLS/Reality');

    await user.click(within(dialog).getByRole('button', { name: 'Copy Task Context' }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"taskId": "task-xray-001"'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"runtimeDiagnosis": {'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"plannedInbound": {'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"clientCounters": {'));
  });

  it('marks an Xray release as Agent verified only after result, config, preflight, and snapshot evidence align', async () => {
    const user = userEvent.setup();
    const verifiedXrayDiagnosis = {
      ...xrayRuntimeDiagnosisArtifact,
      state: 'ready',
      reasons: ['multi-client'],
      nextActions: ['inspect-agent'],
      hasRuntimeEvidence: true,
      evidenceStage: 'agent-result-verified',
      plannedBindingStatus: 'applied'
    };

    render(
      <TasksPage
        tasks={[{ ...xrayTask, status: 'succeeded' }]}
        commandOutbox={[xrayCommandOutboxSummary]}
        configRevisions={[
          {
            ...xrayConfigRevision,
            status: 'applied',
            artifact: {
              runtimeDiagnosis: verifiedXrayDiagnosis
            }
          }
        ]}
        preflightPlans={[{ ...xrayPreflightPlan, status: 'passed' }]}
        runtimeSnapshots={[{ ...xrayRuntimeSnapshot, status: 'verified' }]}
        language="en"
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    const pipeline = screen.getByRole('group', { name: 'Release Pipeline' });
    const taskRow = within(pipeline).getByRole('article', { name: 'Update shared Xray inbound' });
    const runtimeVerification = within(taskRow).getByRole('group', { name: 'Runtime Verification' });

    expect(runtimeVerification).toHaveAttribute('data-runtime-verification-state', 'verified');
    expect(runtimeVerification).toHaveTextContent('Agent Verified');
    expect(runtimeVerification).toHaveTextContent('Agent result, config, preflight, and snapshot are aligned.');
    expect(runtimeVerification).toHaveTextContent('1/1 Completed');
    expect(runtimeVerification).toHaveTextContent('agent-result-verified');
    expect(runtimeVerification).toHaveTextContent('cfg-xray-current');
    expect(runtimeVerification).toHaveTextContent('preflight-xray-current');
    expect(runtimeVerification).toHaveTextContent('snapshot-xray-current');

    await user.click(screen.getByRole('button', { name: 'View Task Details' }));

    const dialog = screen.getByRole('dialog', { name: 'Task Details' });
    const detailVerification = within(dialog).getByRole('group', { name: 'Runtime Verification' });

    expect(detailVerification).toHaveAttribute('data-runtime-verification-state', 'verified');
    expect(detailVerification).toHaveTextContent('Agent Verified');
  });

  it('includes Xray runtime diagnosis in the failure evidence drawer and package', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    const failedXrayTask: DeployTask = {
      ...xrayTask,
      status: 'failed',
      failureReason: 'xray config preflight failed: invalid reality short id',
      steps: [
        { id: 'compile', label: 'Compile Xray config', status: 'succeeded' },
        { id: 'preflight', label: 'Run xray config preflight', status: 'failed' }
      ]
    };
    const failedXrayConfigRevision: RuntimeConfigRevision = {
      ...xrayConfigRevision,
      status: 'failed',
      failureReason: failedXrayTask.failureReason
    };
    const failedXrayPreflightPlan: RuntimePreflightPlan = {
      ...xrayPreflightPlan,
      status: 'failed',
      failureReason: failedXrayTask.failureReason,
      checks: [
        {
          id: 'schema',
          label: 'Validate generated runtime configuration schema',
          status: 'failed',
          severity: 'critical'
        }
      ]
    };

    render(
      <TasksPage
        tasks={[failedXrayTask]}
        configRevisions={[failedXrayConfigRevision]}
        preflightPlans={[failedXrayPreflightPlan]}
        runtimeSnapshots={[xrayRuntimeSnapshot]}
        language="en"
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View Failure Evidence' }));

    const dialog = screen.getByRole('dialog', { name: 'Task Failure Evidence' });
    const diagnosis = within(dialog).getByRole('group', { name: 'Xray Runtime Diagnosis' });

    expect(diagnosis).toHaveTextContent('Xray config preflight');
    expect(diagnosis).toHaveTextContent('ou-ui-xray.service');
    expect(within(dialog).getAllByText('xray config preflight failed: invalid reality short id')).toHaveLength(2);

    await user.click(within(dialog).getByRole('button', { name: 'Copy Failure Evidence Package' }));

    const copiedPayload = JSON.parse(writeText.mock.calls[0]?.[0] as string) as {
      runtimeArtifacts: {
        runtimeDiagnosis?: {
          plannedInbound?: { protocol: string; action: string };
          clientCounters?: { active: number; disabled: number };
        };
      };
    };

    expect(copiedPayload.runtimeArtifacts.runtimeDiagnosis).toMatchObject({
      plannedInbound: {
        protocol: 'vless',
        action: 'upsert_inbound'
      },
      clientCounters: {
        active: 1,
        disabled: 1
      }
    });
  });

  it('shows failed Xray Agent result and rollback evidence as the top failure verdict', async () => {
    const user = userEvent.setup();
    const failedXrayTask: DeployTask = {
      ...xrayTask,
      status: 'failed',
      failureReason: 'post-apply health check failed: xray api probe failed',
      rollbackTaskId: 'task-auto-rollback-xray-001',
      steps: [
        { id: 'compile', label: 'Compile Xray config', status: 'succeeded' },
        { id: 'agent-result', label: 'Wait for Agent result', status: 'failed' }
      ]
    };
    const failedAgentResultDiagnosis = {
      ...xrayRuntimeDiagnosisArtifact,
      state: 'failed',
      reasons: ['xray-config-preflight'],
      nextActions: ['rollback', 'inspect-agent'],
      hasRuntimeEvidence: true,
      evidenceStage: 'agent-result-failed',
      plannedBindingStatus: 'failed'
    };

    render(
      <TasksPage
        tasks={[failedXrayTask]}
        commandOutbox={[
          {
            ...xrayCommandOutboxSummary,
            taskId: failedXrayTask.id,
            status: 'completed',
            resultAt: '2026-06-02T00:00:18.000Z'
          }
        ]}
        configRevisions={[
          {
            ...xrayConfigRevision,
            taskId: failedXrayTask.id,
            status: 'failed',
            failureReason: failedXrayTask.failureReason,
            artifact: {
              runtimeDiagnosis: failedAgentResultDiagnosis
            }
          }
        ]}
        preflightPlans={[
          {
            ...xrayPreflightPlan,
            taskId: failedXrayTask.id,
            status: 'failed',
            failureReason: failedXrayTask.failureReason
          }
        ]}
        runtimeSnapshots={[{ ...xrayRuntimeSnapshot, taskId: failedXrayTask.id, status: 'verified' }]}
        language="en"
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View Failure Evidence' }));

    const dialog = screen.getByRole('dialog', { name: 'Task Failure Evidence' });
    const runtimeVerification = within(dialog).getByRole('group', { name: 'Runtime Verification' });

    expect(runtimeVerification).toHaveAttribute('data-runtime-verification-state', 'failed');
    expect(runtimeVerification).toHaveTextContent('Agent Failed');
    expect(runtimeVerification).toHaveTextContent('agent-result-failed');
    expect(runtimeVerification).toHaveTextContent('Rollback Task: task-auto-rollback-xray-001');
    expect(within(dialog).getByRole('group', { name: 'Xray Runtime Diagnosis' })).toHaveTextContent('Rollback');
  });

  it('renders structured evidence for system tuning task details instead of raw JSON only', async () => {
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
            operation: 'system.tune',
            resourceType: 'agent',
            resourceId: 'agent-hkg-01',
            targetLabel: 'BBR + FQ 预设 / agent-hkg-01',
            summary: 'Dispatch system tuning change',
            metadata: {
              agentId: 'agent-hkg-01',
              tuningProfileId: 'bbr-fq',
              tuningProfileName: 'BBR + FQ 预设',
              tuningTarget: 'kernel',
              tuningRiskLevel: 'medium',
              tuningPreset: {
                id: 'bbr-fq',
                name: 'BBR + FQ 预设',
                target: 'kernel',
                riskLevel: 'medium'
              },
              probeState: {
                bbrInstalled: false,
                tcpProbeReady: true,
                kernelVersion: '6.8.0-31-generic'
              },
              sysctlPlan: {
                id: 'bbr-fq',
                name: 'BBR + FQ 预设',
                target: 'kernel',
                riskLevel: 'medium',
                parameters: [
                  {
                    key: 'net.ipv4.tcp_congestion_control',
                    value: 'bbr'
                  },
                  {
                    key: 'net.core.default_qdisc',
                    value: 'fq'
                  }
                ]
              },
              requiresRoot: true,
              rollbackMode: 'graceful_restart'
            },
            steps: [
              { id: 'probe', label: 'Probe kernel tuning state', status: 'succeeded' },
              { id: 'apply', label: 'Apply tuning preset', status: 'running' }
            ]
          }
        ]}
        configRevisions={[]}
        preflightPlans={[]}
        runtimeSnapshots={[]}
        language="en"
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View Task Details' }));

    const dialog = screen.getByRole('dialog', { name: 'Task Details' });

    expect(within(dialog).getByText('Tuning Evidence')).toBeInTheDocument();
    expect(within(dialog).getByText('BBR Probe')).toBeInTheDocument();
    expect(within(dialog).getByText('Unconfirmed')).toBeInTheDocument();
    expect(within(dialog).getByText('TCP Probe')).toBeInTheDocument();
    expect(within(dialog).getByText('Ready')).toBeInTheDocument();
    expect(within(dialog).getByText('Kernel Version')).toBeInTheDocument();
    expect(within(dialog).getByText('6.8.0-31-generic')).toBeInTheDocument();
    expect(within(dialog).getByText('Preset Details')).toBeInTheDocument();
    expect(within(dialog).getByText('Sysctl Plan')).toBeInTheDocument();
    expect(within(dialog).getByText('net.ipv4.tcp_congestion_control')).toBeInTheDocument();
    expect(within(dialog).getByText('net.core.default_qdisc')).toBeInTheDocument();
    expect(within(dialog).queryByText('"probeState"')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('"sysctlPlan"')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Copy Task Context' }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"tuningPreset": {'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"probeState": {'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"sysctlPlan": {'));
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

    expect(screen.getAllByText('cfg-current').length).toBeGreaterThanOrEqual(1);
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

  it('uses the shared primary button vocabulary for Agent log retention saving', () => {
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
        onUpdateAgentLogRetentionPolicy={vi.fn()}
        onRollbackTask={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: '保存策略' })).toHaveClass('btn-glow');
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
      artifact: diagnosticConfigRevision.artifact,
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
        runtimeDiagnosis?: {
          state: string;
          reasons: string[];
          blockedControls: string[];
          nextActions: string[];
          hasRuntimeEvidence: boolean;
          impactedBindingCount: number;
          evidenceStage: string;
          plannedBindingStatus: string;
          plannedRuntimeServices: string[];
        };
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
    expect(copiedPayload.runtimeArtifacts.runtimeDiagnosis).toEqual(
      expect.objectContaining({
        state: 'degraded',
        reasons: ['no-runtime-service', 'blocked-runtime-controls', 'deploying'],
        blockedControls: ['ipRateLimitMbps', 'proxyProtocol'],
        nextActions: ['apply', 'inspect-agent'],
        hasRuntimeEvidence: false,
        impactedBindingCount: 1,
        evidenceStage: 'control-plane-compiled',
        plannedBindingStatus: 'deploying',
        plannedRuntimeServices: ['ou-forward-forward-hkg-443-agent-hkg-01']
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

  it('shows runtime artifacts and related Agent evidence inside the failure evidence drawer', async () => {
    const user = userEvent.setup();
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
      artifact: diagnosticConfigRevision.artifact,
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

    expect(within(dialog).getByText('Runtime Release')).toBeInTheDocument();
    const diagnosis = within(dialog).getByRole('group', { name: 'Forwarding Runtime Diagnosis' });

    expect(diagnosis).toHaveAttribute('data-runtime-diagnosis-state', 'degraded');
    expect(diagnosis).toHaveTextContent('No runtime service');
    expect(diagnosis).toHaveTextContent('Blocked controls present');
    expect(diagnosis).toHaveTextContent('ipRateLimitMbps');
    expect(diagnosis).toHaveTextContent('proxyProtocol');
    expect(diagnosis).toHaveTextContent('Apply');
    expect(diagnosis).toHaveTextContent('Inspect Agent');
    expect(within(dialog).getAllByText('cfg-current').length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getAllByText('preflight-current').length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getAllByText('snapshot-current').length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getByText('Preflight Checks')).toBeInTheDocument();
    expect(within(dialog).getByText('port-conflict')).toBeInTheDocument();
    expect(within(dialog).getByText('Critical')).toBeInTheDocument();
    expect(within(dialog).getByText('Related Agent Logs')).toBeInTheDocument();
    expect(within(dialog).getByText('failed to apply port-forwarding unit')).toBeInTheDocument();
    expect(within(dialog).getByText('Related Log Archives')).toBeInTheDocument();
    expect(within(dialog).getByText('agent-log-archive-test')).toBeInTheDocument();
  });

  it('wraps long failure evidence in Fauvist release cards without legacy palette drift', async () => {
    const user = userEvent.setup();
    const longSuffix = 'x'.repeat(96);
    const failedTask: DeployTask = {
      ...task,
      id: `task-forward-failed-${longSuffix}`,
      status: 'failed',
      summary: 'Apply long evidence forwarding policy',
      failureReason: `port_conflict:${longSuffix}:0.0.0.0:443-is-already-in-use-${longSuffix}`,
      rollbackTaskId: `task-forward-rollback-${longSuffix}`,
      requestId: `req-forward-release-${longSuffix}`,
      metadata: {
        retryable: false,
        idempotencyKey: `idem-forward-${longSuffix}`
      },
      steps: [
        { id: `compile-${longSuffix}`, label: `Compile forwarding config ${longSuffix}`, status: 'succeeded' },
        { id: `preflight-port-${longSuffix}`, label: `Check listen port availability ${longSuffix}`, status: 'failed' }
      ]
    };
    const failedConfigRevision: RuntimeConfigRevision = {
      ...configRevision,
      id: `cfg-current-${longSuffix}`,
      taskId: failedTask.id,
      status: 'failed',
      checksum: `sha256:${longSuffix}${longSuffix}`,
      signature: `sig-v1:${longSuffix}`,
      snapshotBeforeId: `snapshot-current-${longSuffix}`,
      failureReason: `revision_compile_failed_${longSuffix}`
    };
    const failedPreflightPlan: RuntimePreflightPlan = {
      ...currentPreflightPlan,
      id: `preflight-current-${longSuffix}`,
      taskId: failedTask.id,
      configRevisionId: failedConfigRevision.id,
      status: 'failed',
      failureReason: `preflight_port_conflict_${longSuffix}`,
      checks: [
        {
          id: `port-conflict-${longSuffix}`,
          label: `Check listen port availability ${longSuffix}`,
          status: 'failed',
          severity: 'critical'
        }
      ]
    };
    const verifiedSnapshot: RuntimeSnapshot = {
      ...currentRuntimeSnapshot,
      id: `snapshot-current-${longSuffix}`,
      taskId: failedTask.id,
      status: 'verified',
      checksum: `sha256:${longSuffix}${longSuffix}`
    };
    const longAgentLogChunk: AgentLogChunk = {
      ...agentLogChunk,
      eventId: `evt-agent-log-${longSuffix}`,
      taskId: failedTask.id,
      commandId: `cmd-forward-apply-${longSuffix}`,
      content: `failed to apply port-forwarding unit ${longSuffix}`
    };
    const longAgentLogArchive: AgentLogArchive = {
      ...agentLogArchive,
      id: `agent-log-archive-${longSuffix}`,
      taskId: failedTask.id,
      commandId: `cmd-forward-archive-${longSuffix}`,
      contentSha256: `${longSuffix}${longSuffix}`.slice(0, 64)
    };

    render(
      <TasksPage
        tasks={[failedTask]}
        agentLogArchives={[longAgentLogArchive]}
        agentLogChunks={[longAgentLogChunk]}
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
    const failureCard = dialog.querySelector('.tasks-failure-evidence-card');
    const remediationCard = dialog.querySelector('.tasks-remediation-evidence-card');
    const runtimeCard = dialog.querySelector('.tasks-runtime-release-evidence-card');
    const preflightCard = dialog.querySelector('.tasks-preflight-evidence-card');
    const logCard = dialog.querySelector('.tasks-related-agent-log-card');
    const archiveCard = dialog.querySelector('.tasks-related-log-archive-card');
    const dialogHtml = dialog.outerHTML;

    expect(failureCard).not.toBeNull();
    expect(remediationCard).not.toBeNull();
    expect(runtimeCard).not.toBeNull();
    expect(preflightCard).not.toBeNull();
    expect(logCard).not.toBeNull();
    expect(archiveCard).not.toBeNull();
    expect(failureCard).toHaveClass('break-words');
    expect(remediationCard).toHaveClass('break-words');
    expect(runtimeCard).toHaveClass('break-words');
    expect(preflightCard).toHaveClass('break-words');
    expect(logCard).toHaveClass('break-words');
    expect(archiveCard).toHaveClass('break-words');
    expect(dialogHtml).toContain('#1E3AFF');
    expect(dialogHtml).toContain('#FF3D18');
    expect(dialogHtml).toContain('#D9FF00');
    expect(dialogHtml).toContain('#00A878');
    expect(dialogHtml).not.toContain('truncate');
    expect(dialogHtml).not.toContain('blue-');
    expect(dialogHtml).not.toContain('orange-');
    expect(dialogHtml).not.toContain('amber-');
    expect(dialogHtml).not.toContain('purple-');
    expect(dialogHtml).not.toContain('sky-');
    expect(dialogHtml).not.toContain('indigo-');
    expect(dialogHtml).not.toContain('cyan-');
    expect(dialogHtml).not.toContain('rose-');
    expect(within(dialog).getByText(failedTask.failureReason!)).toHaveClass('break-words');
    expect(within(dialog).getAllByText(failedConfigRevision.id)[0]).toHaveClass('break-all');
    expect(within(dialog).getAllByText(failedPreflightPlan.id)[0]).toHaveClass('break-all');
    expect(within(dialog).getAllByText(verifiedSnapshot.id)[0]).toHaveClass('break-all');
    expect(within(dialog).getByText(longAgentLogArchive.id)).toHaveClass('break-all');
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
