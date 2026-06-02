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
  targetLabel: '端口转发隧道网络',
  summary: '应用端口转发策略',
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

  it('creates a one-click host agent install task without customer-node metadata', async () => {
    const user = userEvent.setup();
    const baseApi = createMockApi();
    const api = {
      ...baseApi,
      createAgentInstallCommand: vi.fn(baseApi.createAgentInstallCommand),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    renderShell(api);

    await user.click(await screen.findByRole('button', { name: '受控主机' }));
    await user.click(screen.getByRole('button', { name: '生成安装命令' }));
    await user.clear(await screen.findByLabelText('主机名称'));
    await user.type(screen.getByLabelText('主机名称'), 'edge-custom-01');

    expect(screen.queryByText(/批量安装/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/主机代理一键安装/).length).toBeGreaterThan(0);
    expect(await screen.findByText(/OU_INSTALL_PROFILE='host-agent,xray,port-forwarding,telemetry,command-channel'/)).toBeInTheDocument();
    expect(screen.queryByText(/OU_CUSTOMER_NODE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/master\.example\.com/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '创建安装任务' }));

    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'agent.deploy',
        metadata: expect.objectContaining({
          hostName: 'edge-custom-01',
          installProfile: ['host-agent', 'xray', 'port-forwarding', 'telemetry', 'command-channel']
        })
      }),
      expect.any(Object)
    );
    await waitFor(() => {
      expect(api.createAgentInstallCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          hostName: 'edge-custom-01',
          publicBaseUrl: expect.any(String)
        }),
        expect.any(Object)
      );
    });
  });

  it('creates managed host update and delete tasks from the host workspace', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi(),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    renderShell(api);

    await user.click(await screen.findByRole('button', { name: '受控主机' }));
    await user.click((await screen.findAllByRole('button', { name: '编辑主机' }))[0]);
    await user.clear(screen.getByLabelText('主机别名'));
    await user.type(screen.getByLabelText('主机别名'), 'edge-renamed-01');
    const maxTrafficInput = screen.getAllByLabelText('最大流量')[0];
    await user.clear(maxTrafficInput);
    await user.type(maxTrafficInput, '2048');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'agent.update',
          resourceType: 'agent',
          targetId: 'agent-hkg-01',
          targetLabel: 'edge-renamed-01',
          metadata: expect.objectContaining({
            agentId: 'agent-hkg-01',
            hostName: 'edge-renamed-01',
            maxTrafficGb: 2048
          })
        }),
        expect.any(Object)
      );
    });

    await user.click((await screen.findAllByRole('button', { name: '移除主机' }))[0]);
    await user.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'agent.delete',
          resourceType: 'agent',
          targetId: 'agent-hkg-01',
          targetLabel: 'edge-renamed-01',
          metadata: expect.objectContaining({
            agentId: 'agent-hkg-01',
            hostName: 'edge-renamed-01',
            maxTrafficGb: 2048
          })
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

    await user.click(await screen.findByRole('button', { name: '端口转发' }));
    await user.click(screen.getByRole('button', { name: '创建转发规则' }));
    await user.clear(await screen.findByLabelText('监听端口'));
    await user.type(screen.getByLabelText('监听端口'), '2443');
    await user.clear(screen.getByLabelText('目标 IP'));
    await user.type(screen.getByLabelText('目标 IP'), '172.20.8.10');
    await user.clear(screen.getByLabelText('目标端口'));
    await user.type(screen.getByLabelText('目标端口'), '9443');
    expect(await screen.findByText('香港入口 Agent')).toBeInTheDocument();
    expect(screen.getByText('新加坡转发 Agent')).toBeInTheDocument();
    expect(screen.getByText('已选 2')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('agent-hkg-01, agent-sin-02')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'forward.create',
        metadata: expect.objectContaining({
          ownerName: 'Acme Team',
          listenPort: 2443,
          targetAddress: '172.20.8.10',
          targetPort: 9443,
          entryNodeIds: ['agent-hkg-01', 'agent-sin-02']
        })
      }),
      expect.any(Object)
    );
  });

  it('creates customer node inbound tasks with Xray metadata from the managed host workspace', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi(),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    renderShell(api);

    await user.click(await screen.findByRole('button', { name: '受控主机' }));
    await user.click(screen.getByRole('button', { name: '客户节点' }));
    await user.click(screen.getByRole('button', { name: '新增客户节点' }));
    await user.clear(screen.getByLabelText('客户节点名称'));
    await user.type(screen.getByLabelText('客户节点名称'), '客户专属 VLESS 入口');
    await user.clear(screen.getByLabelText('服务器地址'));
    await user.type(screen.getByLabelText('服务器地址'), 'edge.customer.example.com');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'inbound.create',
          resourceType: 'inbound',
          targetLabel: '客户专属 VLESS 入口',
          metadata: expect.objectContaining({
            customerNodeName: '客户专属 VLESS 入口',
            serverAddress: 'edge.customer.example.com',
            xrayProtocol: 'vless',
            listenPort: 443,
            subscriptionRule: 'region:hk AND tier:premium'
          })
        }),
        expect.any(Object)
      );
    });
  });

  it('creates subscription import tasks when an external source is saved', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi(),
      createTask: vi.fn().mockResolvedValue(rollbackReadyTask)
    };
    renderShell(api);

    await user.click(await screen.findByRole('button', { name: '节点订阅' }));
    await user.click(screen.getByRole('button', { name: '导入订阅源' }));
    await user.clear(screen.getByLabelText('源名称'));
    await user.type(screen.getByLabelText('源名称'), '客户自定义订阅源');
    await user.clear(screen.getByLabelText('源地址'));
    await user.type(screen.getByLabelText('源地址'), 'https://provider.example.com/custom.yaml');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(api.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'subscription.import',
          resourceType: 'subscription',
          targetLabel: '客户自定义订阅源',
          metadata: expect.objectContaining({
            kind: 'clash',
            name: '客户自定义订阅源',
            url: 'https://provider.example.com/custom.yaml',
            dedupeKey: 'server-port'
          })
        }),
        expect.any(Object)
      );
    });
  });

  it('surfaces failed task mutations instead of swallowing rejected promises', async () => {
    const user = userEvent.setup();
    const api = {
      ...createMockApi(),
      createTask: vi.fn().mockRejectedValue(new Error('permission.denied'))
    };

    renderShell(api);

    await user.click(await screen.findByRole('button', { name: '端口转发' }));
    await screen.findByText('端口转发隧道网络');
    await user.click((await screen.findAllByRole('button', { name: '下发' }))[0]);

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

    await user.click(await screen.findByRole('button', { name: '端口转发' }));
    await screen.findByText('端口转发隧道网络');
    await user.dblClick((await screen.findAllByRole('button', { name: '下发' }))[0]);

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

    await user.click(await screen.findByRole('button', { name: '端口转发' }));
    await screen.findByText('端口转发隧道网络');
    await user.click((await screen.findAllByRole('button', { name: '下发' }))[0]);

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
