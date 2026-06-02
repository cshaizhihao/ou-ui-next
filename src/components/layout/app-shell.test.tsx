import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RuntimeConfigRevision, RuntimeSnapshot } from '../../domain/runtime-release';
import type { DeployTask } from '../../domain/task';
import { ApiProvider } from '../../services/api/api-provider';
import type { ControlPlaneApi } from '../../services/api/control-plane-api';
import { createMockApi } from '../../services/mock/mock-api';
import { seedForwardRules, seedNodes } from '../../services/mock/mock-data';
import { AppShell } from './app-shell';

const rollbackReadyTask: DeployTask = {
  id: 'task-rollback-source',
  operation: 'forward.apply',
  resourceType: 'forward',
  resourceId: 'forward-hkg-443',
  status: 'succeeded',
  targetId: 'forward-hkg-443',
  targetLabel: 'FLVX Tunnel Fabric',
  summary: 'Apply FLVX forwarding policy',
  createdAt: '2026-06-02T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
  actor: 'admin',
  requestedBy: 'admin',
  requestId: 'req-rollback-source',
  sourceIp: 'ui-preview',
  rollbackAvailable: true,
  attempts: 1,
  progressPercent: 100,
  steps: []
};

const rollbackConfigRevision: RuntimeConfigRevision = {
  id: 'cfg-rollback-source',
  taskId: rollbackReadyTask.id,
  operation: rollbackReadyTask.operation,
  targetId: rollbackReadyTask.targetId,
  targetLabel: rollbackReadyTask.targetLabel,
  agentId: 'agent-hkg-01',
  moduleKind: 'flvx',
  artifactUri: 'ou-ui://artifacts/config-revisions/cfg-rollback-source.json',
  checksum: 'sha256:rollback-source',
  signature: 'sig-v1:rollback-source',
  preflightPlanId: 'preflight-rollback-source',
  snapshotBeforeId: 'snapshot-before-forward-hkg-443',
  status: 'applied',
  createdAt: rollbackReadyTask.createdAt,
  createdBy: rollbackReadyTask.actor,
  diffSummary: {
    added: 1,
    changed: 0,
    removed: 0
  },
  artifact: {}
};

const rollbackSnapshot: RuntimeSnapshot = {
  id: rollbackConfigRevision.snapshotBeforeId,
  taskId: rollbackReadyTask.id,
  targetId: rollbackReadyTask.targetId,
  targetLabel: rollbackReadyTask.targetLabel,
  agentId: rollbackConfigRevision.agentId,
  moduleKind: rollbackConfigRevision.moduleKind,
  reason: 'pre_apply',
  status: 'verified',
  checksum: 'sha256:snapshot-before-forward-hkg-443',
  capturedAt: rollbackReadyTask.createdAt,
  capturedBy: rollbackReadyTask.actor,
  state: {}
};

function renderShell(api: ControlPlaneApi) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });

  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <AppShell ready />
      </ApiProvider>
    </QueryClientProvider>
  );
}

function getButtonContainingText(text: string) {
  const button = screen.getByText(text).closest('button');
  expect(button).not.toBeNull();
  return button as HTMLButtonElement;
}

function getPrimaryPageAction() {
  const button = document.querySelector<HTMLButtonElement>('.page-view button.btn-glow');
  expect(button).not.toBeNull();
  return button as HTMLButtonElement;
}

async function getRollbackAction() {
  await waitFor(() => {
    expect(document.querySelector('button[data-task-action="rollback"]')).not.toBeNull();
  });

  return document.querySelector<HTMLButtonElement>('button[data-task-action="rollback"]')!;
}

describe('AppShell', () => {
  it('renders inventory even when a forwarding rule has no allocated ports yet', async () => {
    const api = {
      ...createMockApi(),
      listForwardRules: async () => [{ ...seedForwardRules[0], ports: [] }]
    };
    renderShell(api);

    expect(await screen.findByText(seedNodes[0].name)).toBeInTheDocument();
  });

  it('creates a one-click Agent install task with custom host, customer, quota, and expiry metadata', async () => {
    const user = userEvent.setup();
    const baseApi = createMockApi();
    const api = {
      ...baseApi,
      createAgentInstallCommand: vi.fn(baseApi.createAgentInstallCommand),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    renderShell(api);

    await user.click(await screen.findByRole('button', { name: 'Agent 安装' }));
    await user.clear(await screen.findByLabelText('主机名称'));
    await user.type(screen.getByLabelText('主机名称'), 'edge-custom-01');
    await user.clear(screen.getByLabelText('最大流量'));
    await user.type(screen.getByLabelText('最大流量'), '12');
    await user.clear(screen.getByLabelText('客户节点名称'));
    await user.type(screen.getByLabelText('客户节点名称'), '香港高级节点 01');
    await user.clear(screen.getByLabelText('客户名称'));
    await user.type(screen.getByLabelText('客户名称'), 'Acme Team');
    await user.clear(screen.getByLabelText('剩余时间'));
    await user.type(screen.getByLabelText('剩余时间'), '45');

    expect(screen.queryByText(/批量安装/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/一键安装命令/).length).toBeGreaterThan(0);
    expect(await screen.findByText(/OU_INSTALL_PROFILE='probe,xray,flvx,forwarding,telemetry,command-channel'/)).toBeInTheDocument();
    expect(screen.queryByText(/master\.example\.com/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '生成一键安装命令' }));

    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'agent.deploy',
        metadata: expect.objectContaining({
          hostName: 'edge-custom-01',
          maxTrafficGb: 12,
          customerNodeName: '香港高级节点 01',
          customerName: 'Acme Team',
          remainingDays: 45,
          installProfile: ['probe', 'xray', 'flvx', 'forwarding', 'telemetry', 'command-channel']
        })
      }),
      expect.any(Object)
    );
    await waitFor(() => {
      expect(api.createAgentInstallCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          hostName: 'edge-custom-01',
          maxTrafficGb: 12,
          publicBaseUrl: expect.any(String)
        }),
        expect.any(Object)
      );
    });
  });

  it('creates multi-host forwarding tasks with custom listen port and target endpoint metadata', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi(),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    renderShell(api);

    await user.click(await screen.findByRole('button', { name: '流量转发' }));
    await user.clear(await screen.findByLabelText('监听端口'));
    await user.type(screen.getByLabelText('监听端口'), '2443');
    await user.clear(screen.getByLabelText('目标 IP'));
    await user.type(screen.getByLabelText('目标 IP'), '172.20.8.10');
    await user.clear(screen.getByLabelText('目标端口'));
    await user.type(screen.getByLabelText('目标端口'), '9443');
    expect(await screen.findByText('香港入口 Agent')).toBeInTheDocument();
    expect(screen.getByText('新加坡转发 Agent')).toBeInTheDocument();
    expect(screen.getByText('已选择主机 2')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('agent-hkg-01, agent-sin-02')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '创建多主机转发' }));

    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'forward.create',
        metadata: expect.objectContaining({
          listenPort: 2443,
          targetAddress: '172.20.8.10',
          targetPort: 9443,
          agentIds: ['agent-hkg-01', 'agent-sin-02']
        })
      }),
      expect.any(Object)
    );
  });

  it('surfaces failed task mutations instead of swallowing rejected promises', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi(),
      createTask: vi.fn().mockRejectedValue(new Error('permission.denied'))
    };

    renderShell(api);

    await user.click(await screen.findByRole('button', { name: '流量转发' }));
    await screen.findByText('FLVX Tunnel Fabric');
    await user.click(getPrimaryPageAction());

    expect(await screen.findByRole('alert')).toHaveTextContent('permission.denied');
  });

  it('prevents duplicate task mutations while one task request is in flight', async () => {
    const user = userEvent.setup();
    let resolveCreateTask: (task: DeployTask) => void = () => undefined;
    const createTaskPromise = new Promise<DeployTask>((resolve) => {
      resolveCreateTask = resolve;
    });
    const api = {
      ...createMockApi(),
      createTask: vi.fn(() => createTaskPromise)
    };

    renderShell(api);

    await user.click(await screen.findByRole('button', { name: '流量转发' }));
    await screen.findByText('FLVX Tunnel Fabric');
    await user.dblClick(getPrimaryPageAction());

    expect(api.createTask).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('变更提交中')).toBeInTheDocument();

    await act(async () => {
      resolveCreateTask(rollbackReadyTask);
      await createTaskPromise;
    });
  });

  it('keeps a created task queued when the post-mutation refresh fails', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi(),
      listTasks: vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('snapshot.unavailable')),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };

    renderShell(api);

    await user.click(await screen.findByRole('button', { name: '流量转发' }));
    await screen.findByText('FLVX Tunnel Fabric');
    await user.click(getPrimaryPageAction());

    expect(await screen.findByRole('status')).toHaveTextContent('执行记录已创建');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('creates an agent rollback task from a rollback-ready task', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi(),
      listTasks: vi.fn().mockResolvedValue([rollbackReadyTask]),
      listConfigRevisions: vi.fn().mockResolvedValue([rollbackConfigRevision]),
      listRuntimeSnapshots: vi.fn().mockResolvedValue([rollbackSnapshot]),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };

    renderShell(api);

    await screen.findByText('执行记录');
    await user.click(getButtonContainingText('执行记录'));
    await user.click(await getRollbackAction());

    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'agent.rollback',
        targetId: rollbackReadyTask.targetId,
        targetLabel: rollbackReadyTask.targetLabel
      }),
      expect.objectContaining({
        idempotencyKey: `ui:agent.rollback:${rollbackReadyTask.targetId}:${rollbackReadyTask.id}:${rollbackSnapshot.id}`
      })
    );
  });
});
