import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Agent } from '../../domain';
import { ForwardingPage, type ForwardingRuleView } from './forwarding-page';

const GB = 1024 ** 3;

function createAgent(id: string, name: string): Agent {
  return {
    id,
    name,
    status: 'online',
    region: 'custom',
    publicAddress: '198.51.100.10',
    connectionMode: 'pull',
    version: '1.0.0-runtime',
    platform: 'linux/amd64',
    capabilities: ['host-agent', 'port-forwarding'],
    maxTrafficBytes: 100 * GB,
    monthlyTrafficLimitBytes: 50 * GB,
    expiresAt: '2026-12-31T23:59:59.000Z',
    probeConfig: {
      pingTarget: '1.1.1.1',
      pingIntervalSeconds: 30,
      latencyGreenMaxMs: 100,
      latencyYellowMaxMs: 200
    },
    trafficPolicy: {
      accountingMode: 'both',
      monthlyResetDay: 1,
      manualUsedTrafficBytes: 0,
      telemetrySource: 'agent'
    },
    hardware: {},
    lastHeartbeatAt: '2026-06-04T04:00:00.000Z',
    telemetry: {
      cpuPercent: 10,
      memoryPercent: 20,
      memoryUsedBytes: 2 * GB,
      memoryTotalBytes: 8 * GB,
      diskUsedBytes: 10 * GB,
      diskTotalBytes: 64 * GB,
      txBytes: 0,
      rxBytes: 0,
      uploadSpeedBps: 0,
      downloadSpeedBps: 0,
      uploadTotalBytes: 0,
      downloadTotalBytes: 0,
      monthlyTrafficUsedBytes: 0,
      latencyMs: 42,
      latencySamplesMs: [42],
      packetLossPercent: 0,
      packetLossSamplesPercent: [0],
      onlineDays: 1,
      reportedAt: '2026-06-04T04:00:00.000Z'
    }
  };
}

function createRule(overrides: Partial<ForwardingRuleView> = {}): ForwardingRuleView {
  const id = overrides.id ?? 'forward-hkg-443';
  const agentId = overrides.sourceAgentId ?? 'agent-hkg-01';

  return {
    id,
    name: 'HKG HTTPS Forward',
    ownerName: 'Acme',
    protocol: 'tcp+udp',
    tunnelId: 'tunnel-premium',
    tunnelName: 'Premium Tunnel',
    sourceAgentId: agentId,
    entryNodeIds: [agentId],
    sourceAddress: '198.51.100.10',
    listenAddress: '0.0.0.0',
    listenPort: 443,
    targetAddress: '10.0.0.10',
    targetPort: 8443,
    enabled: true,
    portStatus: 'allocated',
    bindings: [
      {
        agentId,
        listenAddress: '0.0.0.0',
        listenPort: 443,
        targetAddress: '10.0.0.10',
        targetPort: 8443,
        protocol: 'tcp+udp',
        status: 'allocated',
        runtimeServiceNames: [`ou-forward-${id}-${agentId}.service`],
        inboundBytes: 1024,
        outboundBytes: 2048,
        lastCounterSampleAt: '2026-06-04T04:00:00.000Z',
        counterSource: 'nftables'
      }
    ],
    bindingCount: 1,
    quotaBytes: 100 * GB,
    usedBytes: 12 * GB,
    monthlyResetDay: 1,
    currentUsedTrafficGb: 0,
    rateLimitMbps: 80,
    rateLimitMode: 'bi-directional',
    rateLimitDirection: 'both',
    ipRateLimitMbps: 0,
    billingDirection: 'both',
    pricePerGb: 0,
    tunnelMode: 'direct',
    strategy: 'round-robin',
    maxConnections: 0,
    maxConnectionsPerIp: 0,
    proxyProtocol: false,
    ...overrides
  };
}

function getForwardingRuleTableRegion(workspace?: HTMLElement): HTMLElement {
  const targetWorkspace =
    workspace ?? screen.getByRole('region', { name: 'Forwarding rules workspace' });
  const tableRegion = targetWorkspace.querySelector('.forwarding-rule-table-region');

  if (!(tableRegion instanceof HTMLElement)) {
    throw new Error('Missing forwarding rule table region');
  }

  return tableRegion;
}

function getForwardingRuleRow(ruleName: string, workspace?: HTMLElement): HTMLElement {
  const tableRegion = getForwardingRuleTableRegion(workspace);
  const ruleRow = within(tableRegion).getByText(ruleName).closest('tr');

  if (!(ruleRow instanceof HTMLElement)) {
    throw new Error(`Missing forwarding rule row for ${ruleName}`);
  }

  return ruleRow;
}

function getForwardingMobileRuleList(workspace: HTMLElement): HTMLElement {
  const mobileList = workspace.querySelector('.forwarding-mobile-rule-list');

  if (!(mobileList instanceof HTMLElement)) {
    throw new Error('Missing forwarding mobile rule list');
  }

  return mobileList;
}

describe('ForwardingPage', () => {
  it('shows an operational overview for forwarding density and risk', () => {
    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry'), createAgent('agent-lax-01', 'LAX Entry')]}
        language="en"
        rules={[
          createRule({ id: 'forward-a' }),
          createRule({
            id: 'forward-b',
            enabled: false,
            quotaExceeded: true,
            bindingCount: 2,
            bindings: [
              {
                agentId: 'agent-hkg-01',
                listenAddress: '0.0.0.0',
                listenPort: 8443,
                targetAddress: '10.0.0.20',
                targetPort: 9443,
                protocol: 'tcp',
                status: 'allocated',
                runtimeServiceNames: ['ou-forward-forward-b-agent-hkg-01.service']
              },
              {
                agentId: 'agent-lax-01',
                listenAddress: '0.0.0.0',
                listenPort: 8443,
                targetAddress: '10.0.0.20',
                targetPort: 9443,
                protocol: 'tcp',
                status: 'allocated',
                runtimeServiceNames: ['ou-forward-forward-b-agent-lax-01.service']
              }
            ]
          })
        ]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    expect(screen.getByText('Operational Overview')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Total rules' })).toHaveTextContent('2');
    expect(screen.getByRole('group', { name: 'Enabled rules' })).toHaveTextContent('1');
    expect(screen.getByRole('group', { name: 'Entry bindings' })).toHaveTextContent('3');
    expect(screen.getByRole('group', { name: 'Risk flags' })).toHaveTextContent('1');
  });

  it('creates forwarding metadata from the simple operator flow with advanced fields hidden by default', async () => {
    const user = userEvent.setup();
    const onCreateForwarding = vi.fn();

    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry'), createAgent('agent-lax-01', 'LAX Entry')]}
        language="en"
        rules={[]}
        onCreateForwarding={onCreateForwarding}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Create Forward Rule' }));

    expect(screen.getByRole('dialog', { name: 'Create Forward Rule' })).toHaveClass('modal-panel', 'open');
    expect(screen.getByText('Selected 2')).toBeInTheDocument();
    expect(screen.queryByLabelText('Rule Name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Listen Address')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Current Used Traffic')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Listen Port'), '2443');
    await user.type(screen.getByLabelText('Target IP'), '172.20.8.10');
    await user.type(screen.getByLabelText('Target Port'), '9443');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onCreateForwarding).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Customer 2443->172.20.8.10:9443',
        ownerName: 'Customer',
        listenAddress: '0.0.0.0',
        listenPort: 2443,
        targetAddress: '172.20.8.10',
        targetPort: 9443,
        protocol: 'tcp+udp',
        entryNodeIds: ['agent-hkg-01', 'agent-lax-01'],
        quotaGb: 0,
        monthlyResetDay: 1,
        currentUsedTrafficGb: 0,
        rateLimitMbps: 0,
        rateLimitMode: 'bi-directional',
        rateLimitDirection: 'both',
        ipRateLimitMbps: 0,
        maxConnections: 0,
        maxConnectionsPerIp: 0,
        proxyProtocol: false,
        billingDirection: 'both',
        tunnelMode: 'direct',
        enabled: true
      }),
      'create',
      undefined
    );
  });

  it('frames the forwarding workspace as a cockpit control surface with a control rail and rule panel', () => {
    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry'), createAgent('agent-lax-01', 'LAX Entry')]}
        language="zh"
        rules={[
          createRule({ id: 'forward-a' }),
          createRule({ id: 'forward-b', name: 'LAX Backup Forward', enabled: false })
        ]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: '端口转发 cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: '转发控制栏' });
    const workspace = within(cockpit).getByRole('region', { name: '转发规则工作区' });
    const overviewPanel = within(rail).getByRole('region', { name: '运营概览' });
    const rulePanel = within(workspace).getByRole('complementary', { name: '规则管理面板' });

    expect(overviewPanel).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: '创建转发规则' })).toBeInTheDocument();
    expect(within(rulePanel).getByRole('searchbox', { name: '搜索转发规则' })).toBeInTheDocument();
    expect(within(rulePanel).getByRole('table')).toBeInTheDocument();
  });

  it('does not render explanatory filler copy in the forwarding workflow', async () => {
    const user = userEvent.setup();

    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry'), createAgent('agent-lax-01', 'LAX Entry')]}
        language="zh"
        rules={[createRule({ id: 'forward-a' })]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    expect(screen.queryByText(/按端口转发模型管理/)).not.toBeInTheDocument();
    expect(screen.queryByText(/先看规则规模/)).not.toBeInTheDocument();
    expect(screen.queryByText(/选入口主机/)).not.toBeInTheDocument();
    expect(screen.queryByText(/当前 Agent 运行时仅开放/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '创建转发规则' }));

    expect(screen.queryByText(/按入口主机、目标端点/)).not.toBeInTheDocument();
    expect(screen.queryByText(/普通创建只需要/)).not.toBeInTheDocument();
    expect(screen.queryByText(/仅在接管既有规则/)).not.toBeInTheDocument();
    expect(screen.queryByText(/用于补录历史用量/)).not.toBeInTheDocument();
  });

  it('uses the Fauvist control-plane palette in the forwarding cockpit', () => {
    const { container } = render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry'), createAgent('agent-lax-01', 'LAX Entry')]}
        language="zh"
        rules={[
          createRule({ id: 'forward-a' }),
          createRule({ id: 'forward-b', name: 'LAX Backup Forward', enabled: false })
        ]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    expect(container.outerHTML).toContain('#1E3AFF');
    expect(container.outerHTML).toContain('#FF3D18');
    expect(container.outerHTML).toContain('#D9FF00');
    expect(container.outerHTML).not.toContain('sky-');
    expect(container.outerHTML).not.toContain('indigo-');
    expect(container.outerHTML).not.toContain('cyan-');
    expect(container.outerHTML).not.toContain('purple-');
    expect(container.outerHTML).not.toContain('violet-');
    expect(container.outerHTML).not.toContain('amber-');
    expect(container.outerHTML).not.toContain('rose-');
    expect(container.outerHTML).not.toContain('background-clip:text');
  });

  it('uses a v2 forwarding cockpit visual system for entry binding operations', () => {
    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry'), createAgent('agent-lax-01', 'LAX Entry')]}
        language="en"
        rules={[
          createRule({ id: 'forward-a' }),
          createRule({ id: 'forward-b', name: 'LAX Backup Forward', enabled: false })
        ]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'Port forwarding cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Forwarding control rail' });
    const workspace = within(cockpit).getByRole('region', { name: 'Forwarding rules workspace' });
    const overviewPanel = within(rail).getByRole('region', { name: 'Operational Overview' });
    const rulePanel = within(workspace).getByRole('complementary', { name: 'Rule management panel' });
    const ruleRow = getForwardingRuleRow('HKG HTTPS Forward', workspace);

    expect(cockpit).toHaveClass('forwarding-ops-cockpit');
    expect(rail).toHaveClass('forwarding-ops-rail');
    expect(workspace).toHaveClass('forwarding-ops-workspace');
    expect(overviewPanel).toHaveClass('forwarding-ops-overview-panel');
    expect(rulePanel).toHaveClass('forwarding-ops-rule-panel');
    expect(ruleRow).toHaveClass('forwarding-ops-rule-row');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).toContain('#1E3AFF');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).toContain('#FF3D18');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).toContain('#D9FF00');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('sky-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('indigo-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('cyan-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('purple-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('violet-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('amber-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('rose-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`).not.toContain('background-clip:text');
  });

  it('keeps forwarding first-screen controls on the design-system palette without generic admin color drift', () => {
    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry'), createAgent('agent-lax-01', 'LAX Entry')]}
        language="en"
        rules={[createRule({ id: 'forward-a' }), createRule({ id: 'forward-b', enabled: false })]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'Port forwarding cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Forwarding control rail' });
    const overviewPanel = within(rail).getByRole('region', { name: 'Operational Overview' });
    const endpointStatus = cockpit.querySelector('.forwarding-entry-endpoint-status');
    const rulePanel = within(cockpit).getByRole('complementary', { name: 'Rule management panel' });
    const ruleToolbar = rulePanel.querySelector('.forwarding-rule-toolbar');
    const firstRuleIcon = rulePanel.querySelector('.forwarding-rule-icon');
    const tableHead = rulePanel.querySelector('thead');

    expect(rail).toHaveClass('border-[#07111F]/20', 'bg-[#FDFFF1]');
    expect(overviewPanel.outerHTML).toContain('#1E3AFF');
    expect(ruleToolbar).toHaveClass('border-[#07111F]/20', 'bg-[#EAF3D1]/55');
    expect(firstRuleIcon).toHaveClass('border-[#1E3AFF]', 'bg-[#DCE1FF]', 'text-[#1E3AFF]');
    expect(tableHead).toHaveClass('bg-[#07111F]', 'text-[#FDFFF1]');

    const firstScreenHtml = [
      rail.outerHTML,
      overviewPanel.outerHTML,
      endpointStatus?.outerHTML ?? '',
      ruleToolbar?.outerHTML ?? '',
      tableHead?.outerHTML ?? ''
    ].join('');

    expect(firstScreenHtml).not.toContain('bg-slate');
    expect(firstScreenHtml).not.toContain('text-slate');
    expect(firstScreenHtml).not.toContain('border-slate');
    expect(firstScreenHtml).not.toContain('bg-blue');
    expect(firstScreenHtml).not.toContain('text-blue');
    expect(firstScreenHtml).not.toContain('emerald-');
    expect(firstScreenHtml).not.toContain('rounded-lg');
  });

  it('keeps the forwarding cockpit compact without waterfall card layout patterns', () => {
    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry'), createAgent('agent-lax-01', 'LAX Entry')]}
        language="en"
        rules={[
          createRule({ id: 'forward-a' }),
          createRule({
            id: 'forward-b',
            name: 'LAX Backup Forward',
            enabled: false,
            bindingCount: 2,
            bindings: [
              {
                agentId: 'agent-hkg-01',
                listenAddress: '0.0.0.0',
                listenPort: 8443,
                targetAddress: '10.0.0.20',
                targetPort: 9443,
                protocol: 'tcp',
                status: 'allocated',
                runtimeServiceNames: ['ou-forward-forward-b-agent-hkg-01.service']
              },
              {
                agentId: 'agent-lax-01',
                listenAddress: '0.0.0.0',
                listenPort: 8443,
                targetAddress: '10.0.0.20',
                targetPort: 9443,
                protocol: 'tcp',
                status: 'allocated',
                runtimeServiceNames: ['ou-forward-forward-b-agent-lax-01.service']
              }
            ]
          })
        ]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'Port forwarding cockpit' });
    const shellGrid = cockpit.querySelector('.forwarding-cockpit-grid');
    const rail = within(cockpit).getByRole('complementary', { name: 'Forwarding control rail' });
    const workspace = within(cockpit).getByRole('region', { name: 'Forwarding rules workspace' });
    const workspaceShell = workspace.querySelector('.forwarding-workspace-shell');
    const rulePanel = within(workspace).getByRole('complementary', { name: 'Rule management panel' });
    const ruleToolbar = rulePanel.querySelector('.forwarding-rule-toolbar');
    const firstHeaderCell = rulePanel.querySelector('thead th');
    const firstBodyCell = rulePanel.querySelector('tbody td');
    const overviewPanel = within(rail).getByRole('region', { name: 'Operational Overview' });
    const metricGrid = overviewPanel.querySelector('.forwarding-overview-metric-grid');
    const metricCards = overviewPanel.querySelectorAll('.forwarding-overview-metric');
    const readinessPanel = within(cockpit).getByRole('region', { name: 'Runtime Readiness' });
    const readinessCards = readinessPanel.querySelectorAll('.forwarding-readiness-metric');
    const billingCard = overviewPanel.querySelector('.forwarding-billing-summary');
    const tableRegion = getForwardingRuleTableRegion(workspace);
    const evidence = within(tableRegion).getByRole('group', { name: 'Runtime evidence for HKG HTTPS Forward' });
    const runtimePath = within(tableRegion).getByRole('group', { name: 'Runtime Path HKG HTTPS Forward' });

    expect(shellGrid).not.toBeNull();
    expect(shellGrid).toHaveClass('xl:grid-cols-[18rem_minmax(0,1fr)]');
    expect(rail).toHaveClass('p-3');
    expect(workspaceShell).toHaveClass('p-3');
    expect(workspaceShell).not.toHaveClass('lg:p-4', 'p-4', 'p-5', 'p-6');
    expect(ruleToolbar).toHaveClass('p-3');
    expect(ruleToolbar).not.toHaveClass('p-4', 'p-5');
    expect(firstHeaderCell).toHaveClass('px-3', 'py-2.5');
    expect(firstHeaderCell).not.toHaveClass('px-4');
    expect(firstBodyCell).toHaveClass('px-3', 'py-2.5');
    expect(firstBodyCell).not.toHaveClass('px-4', 'py-3');
    expect(overviewPanel).toHaveClass('p-3');
    expect(metricGrid).not.toBeNull();
    expect(metricGrid).toHaveClass('forwarding-overview-metric-grid', 'grid-cols-2');
    expect(metricGrid).not.toHaveClass('xl:grid-cols-1');
    expect(metricCards).toHaveLength(5);
    expect(within(overviewPanel).getByRole('group', { name: 'Billing direction summary' })).toHaveTextContent('Both 2');
    expect(screen.queryByRole('group', { name: 'Billing direction' })).not.toBeInTheDocument();
    expect(billingCard).toBeNull();
    metricCards.forEach((metric) => {
      expect(metric).toHaveClass('min-h-[56px]', 'p-2.5');
      expect(metric).not.toHaveClass('rounded-2xl', 'p-4');
    });
    expect(readinessPanel).toHaveClass('forwarding-readiness-panel', 'mt-3');
    expect(readinessCards).toHaveLength(3);
    readinessCards.forEach((metric) => {
      expect(metric).toHaveClass('min-h-[52px]', 'px-3', 'py-2');
      expect(metric).not.toHaveClass('min-h-24', 'px-4', 'py-3');
    });
    expect(evidence).toHaveClass('max-w-[17rem]', 'p-2.5');
    expect(evidence).not.toHaveClass('max-w-[19rem]', 'rounded-xl', 'p-3');
    expect(runtimePath).toHaveClass('p-2.5');
    expect(runtimePath).not.toHaveClass('rounded-xl', 'p-3');
    expect(cockpit.outerHTML).not.toContain('masonry');
    expect(cockpit.outerHTML).not.toContain('columns-');
    expect(cockpit.outerHTML).not.toContain('grid-flow-row-dense');
    expect(cockpit.outerHTML).not.toContain('row-span');
    expect(cockpit.outerHTML).not.toContain('col-span');
    expect(cockpit).not.toHaveTextContent('当前可见的转发规则数量');
    expect(cockpit).not.toHaveTextContent('当前仍处于启用状态');
    expect(cockpit).not.toHaveTextContent('所有可见规则的绑定总数');
    expect(cockpit).not.toHaveTextContent('具备入口绑定和运行服务证据');
    expect(cockpit).not.toHaveTextContent('等待运行服务、恢复启用或部署完成');
  });

  it('keeps forwarding workspace content reachable on short screens with independent cockpit scrolling', () => {
    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry'), createAgent('agent-lax-01', 'LAX Entry')]}
        language="en"
        rules={[
          createRule({ id: 'forward-a' }),
          createRule({ id: 'forward-b', name: 'LAX Backup Forward', enabled: false })
        ]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'Port forwarding cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Forwarding control rail' });
    const workspace = within(cockpit).getByRole('region', { name: 'Forwarding rules workspace' });
    const shellGrid = cockpit.querySelector('.forwarding-cockpit-grid');
    const workspaceShell = workspace.querySelector('.forwarding-workspace-shell');

    expect(cockpit).toHaveClass('min-h-0');
    expect(cockpit).toHaveClass('xl:h-[calc(100dvh-8.5rem)]', 'xl:overflow-hidden');
    expect(shellGrid).toHaveClass('min-h-0');
    expect(shellGrid).toHaveClass('xl:h-full');
    expect(rail).toHaveClass('xl:overflow-y-auto', 'xl:overscroll-contain');
    expect(rail).not.toHaveClass('overflow-visible');
    expect(rail.className).not.toContain('max-h');
    expect(workspace).toHaveClass('min-h-0');
    expect(workspace).toHaveClass('xl:overflow-y-auto', 'xl:overscroll-contain');
    expect(workspaceShell).toHaveClass('min-h-0');
    expect(cockpit.outerHTML).not.toContain('h-screen');
    expect(cockpit.className).not.toContain('md:h-');
    expect(cockpit.className).not.toContain('md:overflow-hidden');
    expect(shellGrid?.className).not.toContain('md:h-full');
    expect(rail.className).not.toContain('overflow-hidden');
    expect(workspace.className).not.toContain('overflow-hidden');
    expect((workspaceShell as HTMLElement).className).not.toContain('overflow-hidden');
  });

  it('uses a shorter desktop cockpit height so the forwarding page fits laptop screens', () => {
    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry'), createAgent('agent-lax-01', 'LAX Entry')]}
        language="en"
        rules={[createRule({ id: 'forward-a' }), createRule({ id: 'forward-b', enabled: false })]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'Port forwarding cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Forwarding control rail' });
    const workspace = within(cockpit).getByRole('region', { name: 'Forwarding rules workspace' });

    expect(cockpit).toHaveClass('xl:h-[calc(100dvh-8.5rem)]');
    expect(cockpit).not.toHaveClass('xl:h-[calc(100dvh-10rem)]');
    expect(rail).toHaveClass('xl:overflow-y-auto');
    expect(workspace).toHaveClass('xl:overflow-y-auto');
  });

  it('reserves mobile bottom-nav clearance and uses a narrower forwarding table', () => {
    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry'), createAgent('agent-lax-01', 'LAX Entry')]}
        language="en"
        rules={[createRule({ id: 'forward-a' }), createRule({ id: 'forward-b', enabled: false })]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const workspace = screen.getByRole('region', { name: 'Forwarding rules workspace' });
    const workspaceShell = workspace.querySelector('.forwarding-workspace-shell');
    const table = within(workspace).getByRole('table');

    expect(workspace).toHaveClass('max-md:pb-[calc(7rem+env(safe-area-inset-bottom))]');
    expect(workspaceShell).not.toHaveClass('max-md:pb-28');
    expect(table).toHaveClass('min-w-[960px]');
    expect(table).not.toHaveClass('min-w-[1040px]', 'min-w-[1220px]', 'min-w-[1280px]');
  });

  it('uses mobile rule cards instead of making the wide forwarding table the phone workflow', () => {
    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry'), createAgent('agent-lax-01', 'LAX Entry')]}
        language="en"
        rules={[
          createRule({ id: 'forward-a' }),
          createRule({ id: 'forward-b', name: 'LAX Backup Forward', enabled: false })
        ]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const workspace = screen.getByRole('region', { name: 'Forwarding rules workspace' });
    const tableRegion = getForwardingRuleTableRegion(workspace);
    const mobileList = getForwardingMobileRuleList(workspace);
    const firstCard = within(mobileList).getByRole('group', { name: 'Mobile rule HKG HTTPS Forward' });

    expect(tableRegion).toHaveClass('max-md:hidden');
    expect(tableRegion).not.toHaveClass('max-md:block');
    expect(mobileList).toHaveClass('forwarding-mobile-rule-list', 'md:hidden');
    expect(firstCard).toHaveClass('forwarding-mobile-rule-card');
    expect(firstCard).toHaveTextContent('HKG HTTPS Forward');
    expect(firstCard).toHaveTextContent('0.0.0.0:443');
    expect(firstCard).toHaveTextContent('10.0.0.10:8443');
    expect(firstCard).toHaveTextContent('Runtime Evidence');
    expect(within(firstCard).getByRole('button', { name: 'Edit Forward Rule' })).toBeInTheDocument();
    expect(within(firstCard).getByRole('button', { name: 'Deploy' })).toBeInTheDocument();
    expect(within(firstCard).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(within(firstCard).getByRole('button', { name: 'Delete Rule' })).toBeInTheDocument();
    expect(firstCard.outerHTML).not.toContain('min-w-[960px]');
    expect(firstCard.outerHTML).not.toContain('overflow-x-auto');
  });

  it('keeps the forwarding empty rule panel compact without an oversized blank card', () => {
    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry')]}
        language="en"
        rules={[]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'Port forwarding cockpit' });
    const emptyState = within(cockpit).getByText('No forwarding rules yet').closest('.forwarding-empty-state');

    expect(emptyState).toHaveClass('p-3');
    expect(emptyState).not.toHaveClass('p-8', 'p-6', 'p-5');
  });

  it('surfaces runtime readiness on the forwarding control rail', () => {
    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry'), createAgent('agent-lax-01', 'LAX Entry')]}
        language="en"
        rules={[
          createRule({ id: 'forward-ready' }),
          createRule({
            id: 'forward-issue',
            name: 'LAX Guardrail Forward',
            quotaExceeded: true
          }),
          createRule({
            id: 'forward-waiting',
            name: 'Waiting Forward',
            bindings: [],
            bindingCount: 0,
            portStatus: 'allocated'
          })
        ]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'Port forwarding cockpit' });
    const readiness = within(cockpit).getByRole('region', { name: 'Runtime Readiness' });

    expect(within(readiness).getByRole('group', { name: 'Ready' })).toHaveTextContent('1');
    expect(within(readiness).getByRole('group', { name: 'Issues' })).toHaveTextContent('1');
    expect(within(readiness).getByRole('group', { name: 'Waiting' })).toHaveTextContent('1');
  });

  it('shows rule-level runtime diagnosis states with reasons and recovery actions', () => {
    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry')]}
        language="en"
        rules={[
          createRule({
            id: 'forward-ready',
            name: 'Ready Forward'
          }),
          createRule({
            id: 'forward-missing-counters',
            name: 'Missing Counter Forward',
            bindings: [
              {
                agentId: 'agent-hkg-01',
                listenAddress: '0.0.0.0',
                listenPort: 2443,
                targetAddress: '10.0.0.20',
                targetPort: 9443,
                protocol: 'tcp+udp',
                status: 'allocated',
                runtimeServiceNames: ['ou-forward-forward-missing-counters-agent-hkg-01.service']
              }
            ]
          }),
          createRule({
            id: 'forward-quota-blocked',
            name: 'Quota Blocked Forward',
            quotaExceeded: true,
            runtimeDisabledByPolicy: true,
            guardrailReason: 'forward_rule_quota_exceeded'
          }),
          createRule({
            id: 'forward-normalized-blocked-controls',
            name: 'Normalized Blocked Controls Forward',
            blockedRuntimeControls: ['ipRateLimitMbps', 'proxyProtocol'],
            blockedRuntimeControlValues: {
              ipRateLimitMbps: 50,
              proxyProtocol: true
            }
          }),
          createRule({
            id: 'forward-apply-failed',
            name: 'Apply Failed Forward',
            portStatus: 'failed',
            bindings: [
              {
                agentId: 'agent-hkg-01',
                listenAddress: '0.0.0.0',
                listenPort: 4443,
                targetAddress: '10.0.0.30',
                targetPort: 9443,
                protocol: 'tcp+udp',
                status: 'failed',
                runtimeServiceNames: ['ou-forward-forward-apply-failed-agent-hkg-01.service']
              }
            ]
          })
        ]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const cockpit = screen.getByRole('region', { name: 'Port forwarding cockpit' });
    const readiness = within(cockpit).getByRole('region', { name: 'Runtime Readiness' });
    const tableRegion = getForwardingRuleTableRegion();

    expect(within(cockpit).getByRole('group', { name: 'Risk flags' })).toHaveTextContent('4');
    expect(within(readiness).getByRole('group', { name: 'Ready' })).toHaveTextContent('1');
    expect(within(readiness).getByRole('group', { name: 'Issues' })).toHaveTextContent('4');
    expect(within(readiness).getByRole('group', { name: 'Waiting' })).toHaveTextContent('0');

    const readyDiagnosis = within(tableRegion).getByRole('group', { name: 'Runtime diagnosis for Ready Forward' });
    expect(readyDiagnosis).toHaveAttribute('data-runtime-diagnosis-state', 'ready');
    expect(within(readyDiagnosis).getByText('No blockers')).toBeInTheDocument();
    expect(within(readyDiagnosis).getByText('Pause')).toHaveAttribute('data-runtime-diagnosis-action', 'pause');

    const degradedDiagnosis = within(tableRegion).getByRole('group', { name: 'Runtime diagnosis for Missing Counter Forward' });
    expect(degradedDiagnosis).toHaveAttribute('data-runtime-diagnosis-state', 'degraded');
    expect(within(degradedDiagnosis).getByText('Missing traffic counters')).toHaveAttribute(
      'data-runtime-diagnosis-reason',
      'missing-traffic-counters'
    );
    expect(within(degradedDiagnosis).getByText('Inspect Agent')).toHaveAttribute(
      'data-runtime-diagnosis-action',
      'inspect-agent'
    );

    const blockedDiagnosis = within(tableRegion).getByRole('group', { name: 'Runtime diagnosis for Quota Blocked Forward' });
    expect(blockedDiagnosis).toHaveAttribute('data-runtime-diagnosis-state', 'blocked');
    expect(within(blockedDiagnosis).getByText('Quota exceeded')).toHaveAttribute(
      'data-runtime-diagnosis-reason',
      'quota-exceeded'
    );
    expect(within(blockedDiagnosis).getByText('Reset quota')).toHaveAttribute('data-runtime-diagnosis-action', 'reset-quota');
    expect(within(blockedDiagnosis).getByText('Resume')).toHaveAttribute('data-runtime-diagnosis-action', 'resume');

    const normalizedBlockedDiagnosis = within(tableRegion).getByRole('group', {
      name: 'Runtime diagnosis for Normalized Blocked Controls Forward'
    });
    expect(normalizedBlockedDiagnosis).toHaveAttribute('data-runtime-diagnosis-state', 'degraded');
    expect(within(normalizedBlockedDiagnosis).getByText('Blocked controls present')).toHaveAttribute(
      'data-runtime-diagnosis-reason',
      'blocked-runtime-controls'
    );
    expect(within(normalizedBlockedDiagnosis).getByText('Inspect Agent')).toHaveAttribute(
      'data-runtime-diagnosis-action',
      'inspect-agent'
    );

    const failedDiagnosis = within(tableRegion).getByRole('group', { name: 'Runtime diagnosis for Apply Failed Forward' });
    expect(failedDiagnosis).toHaveAttribute('data-runtime-diagnosis-state', 'failed');
    expect(within(failedDiagnosis).getByText('Apply failed')).toHaveAttribute(
      'data-runtime-diagnosis-reason',
      'runtime-apply-failed'
    );
    expect(within(failedDiagnosis).getByText('Repair')).toHaveAttribute('data-runtime-diagnosis-action', 'repair');
  });

  it('surfaces actionable runtime recovery controls from forwarding diagnosis', async () => {
    const user = userEvent.setup();
    const onRunTask = vi.fn();
    const writeText = vi.fn();
    const confirm = vi.fn(() => false);

    vi.stubGlobal('confirm', confirm);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText
      }
    });

    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry')]}
        language="en"
        rules={[
          createRule({
            id: 'forward-apply-failed',
            name: 'Apply Failed Forward',
            portStatus: 'failed',
            bindings: [
              {
                agentId: 'agent-hkg-01',
                listenAddress: '0.0.0.0',
                listenPort: 4443,
                targetAddress: '10.0.0.30',
                targetPort: 9443,
                protocol: 'tcp+udp',
                status: 'failed',
                runtimeServiceNames: ['ou-forward-forward-apply-failed-agent-hkg-01.service']
              }
            ]
          })
        ]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={onRunTask}
      />
    );

    const tableRegion = getForwardingRuleTableRegion();
    const recovery = within(tableRegion).getByRole('region', { name: 'Runtime recovery for Apply Failed Forward' });

    expect(recovery).toHaveAttribute('data-forwarding-recovery-state', 'failed');
    expect(recovery).toHaveTextContent('Runtime apply failed; redeploy or repair the rule.');
    expect(recovery).toHaveTextContent('Impacted Bindings');
    expect(recovery).toHaveTextContent('Runtime Services');
    expect(recovery).toHaveTextContent('ou-forward-forward-apply-failed-agent-hkg-01.service');

    await user.click(within(recovery).getByRole('button', { name: 'Recovery Deploy' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Deploy Apply Failed Forward'));
    expect(onRunTask).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(within(recovery).getByRole('button', { name: 'Recovery Deploy' }));

    expect(onRunTask).toHaveBeenCalledWith('forward-apply-failed', 'apply');

    await user.click(within(recovery).getByRole('button', { name: 'Copy Recovery Context' }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Forwarding Runtime Recovery: Apply Failed Forward'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('State: Failed'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Reasons: Apply failed'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('ou-forward-forward-apply-failed-agent-hkg-01.service'));
  });

  it('copies runtime evidence context for ready forwarding rules', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText
      }
    });

    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry')]}
        language="en"
        rules={[createRule()]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const row = getForwardingRuleRow('HKG HTTPS Forward');

    await user.click(within(row).getByRole('button', { name: 'Copy Runtime Evidence' }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Forwarding Runtime Evidence: HKG HTTPS Forward'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('State: Ready'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Port Status: allocated'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('HKG Entry 0.0.0.0:443/tcp+udp -> 10.0.0.10:8443 [allocated]'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('ou-forward-forward-hkg-443-agent-hkg-01.service'));
  });

  it('auto-allocates a high listen port and shows a copyable entry endpoint when the port is omitted', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    const onCreateForwarding = vi.fn();

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText
      }
    });

    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry')]}
        language="en"
        rules={[createRule({ listenPort: 2443 })]}
        onCreateForwarding={onCreateForwarding}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Create Forward Rule' }));
    await user.type(screen.getByLabelText('Target IP'), '172.20.8.10');
    await user.type(screen.getByLabelText('Target Port'), '9443');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onCreateForwarding).toHaveBeenCalledTimes(1);
    const metadata = onCreateForwarding.mock.calls[0][0];

    expect(metadata.listenPort).toBeGreaterThanOrEqual(20_000);
    expect(metadata.listenPort).toBeLessThanOrEqual(60_999);
    expect(metadata.listenPort).not.toBe(2443);

    const endpoint = `198.51.100.10:${metadata.listenPort}`;
    const status = screen.getByRole('status');
    expect(status).toHaveClass('forwarding-entry-endpoint-status', 'p-3');
    expect(status).not.toHaveClass('p-4', 'rounded-xl', 'shadow-sm');
    expect(status).toHaveTextContent(endpoint);

    await user.click(screen.getByRole('button', { name: 'Copy Entry Endpoint' }));

    expect(writeText).toHaveBeenCalledWith(endpoint);
  });

  it('keeps the forwarding drawer advanced options compact until the operator needs them', async () => {
    const user = userEvent.setup();

    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry')]}
        language="en"
        rules={[]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Create Forward Rule' }));

    const dialog = screen.getByRole('dialog', { name: 'Create Forward Rule' });
    const advancedOptions = within(dialog).getByText('Advanced Config').closest('details');

    expect(advancedOptions).toHaveClass('forwarding-advanced-options', 'p-3');
    expect(advancedOptions).not.toHaveClass('p-4', 'p-5', 'p-6');
    expect(within(dialog).queryByLabelText('Rule Name')).not.toBeInTheDocument();

    await user.click(within(dialog).getByText('Advanced Config'));

    const advancedBody = dialog.querySelector('.forwarding-advanced-options-body');
    expect(advancedBody).toHaveClass('mt-3', 'space-y-3');
    expect(advancedBody).not.toHaveClass('mt-4', 'space-y-4');
  });

  it('surfaces Agent runtime capability state inside the forwarding drawer instead of exposing blocked controls as editable fields', async () => {
    const user = userEvent.setup();

    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry')]}
        language="en"
        rules={[]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Create Forward Rule' }));
    await user.click(screen.getByText('Advanced Config'));

    const matrix = screen.getByRole('region', { name: 'Agent Runtime Matrix' });
    const readyControls = within(matrix).getByRole('group', { name: 'Ready Controls' });
    const blockedControls = within(matrix).getByRole('group', { name: 'Blocked Controls' });

    expect(matrix).toHaveClass('forwarding-runtime-capability-matrix', 'p-3');
    expect(within(readyControls).getByText('Rule rate limit')).toHaveAttribute('data-runtime-state', 'supported');
    expect(within(readyControls).getByText('nftables counters')).toHaveAttribute('data-runtime-state', 'supported');
    expect(within(blockedControls).getByText('IP rate limit')).toHaveAttribute('data-runtime-state', 'blocked');
    expect(within(blockedControls).getByText('Max connections')).toHaveAttribute('aria-disabled', 'true');
    expect(within(blockedControls).getByText('Max per IP')).toHaveAttribute('data-runtime-state', 'blocked');
    expect(within(blockedControls).getByText('Proxy Protocol')).toHaveAttribute('data-runtime-state', 'blocked');
    expect(within(matrix).getByText('Agent runtime blocked')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'IP rate limit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Max connections' })).not.toBeInTheDocument();
  });

  it('prevents non-forwarding Agents from being selected as forwarding entry hosts', async () => {
    const user = userEvent.setup();
    const hostOnlyAgent: Agent = {
      ...createAgent('agent-host-only', 'Host Only'),
      capabilities: ['host-agent']
    };

    render(
      <ForwardingPage
        agents={[hostOnlyAgent, createAgent('agent-hkg-01', 'HKG Entry')]}
        language="en"
        rules={[]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Create Forward Rule' }));

    const hostOnlyToggle = screen.getByRole('checkbox', { name: 'select Host Only' });
    const hkgToggle = screen.getByRole('checkbox', { name: 'select HKG Entry' });

    expect(hostOnlyToggle).toBeDisabled();
    expect(hkgToggle).toBeChecked();
    expect(screen.getByText('port-forwarding missing')).toHaveClass('border-[#DC2626]');
  });

  it('shows blocked runtime controls on existing forwarding rules and strips them from edit submissions', async () => {
    const user = userEvent.setup();
    const onCreateForwarding = vi.fn();

    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry')]}
        language="en"
        rules={[
          createRule({
            ipRateLimitMbps: 80,
            maxConnections: 2048,
            maxConnectionsPerIp: 32,
            proxyProtocol: true
          })
        ]}
        onCreateForwarding={onCreateForwarding}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const blockedEvidence = screen.getAllByRole('group', { name: 'Blocked Controls HKG HTTPS Forward' })[0];

    expect(within(blockedEvidence).getByText('IP rate limit')).toHaveAttribute('data-runtime-state', 'blocked');
    expect(within(blockedEvidence).getByText('Max connections')).toBeInTheDocument();
    expect(within(blockedEvidence).getByText('Max per IP')).toBeInTheDocument();
    expect(within(blockedEvidence).getByText('Proxy Protocol')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Edit Forward Rule' })[0]);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onCreateForwarding).toHaveBeenCalledWith(
      expect.objectContaining({
        ipRateLimitMbps: 0,
        maxConnections: 0,
        maxConnectionsPerIp: 0,
        proxyProtocol: false
      }),
      'update',
      'forward-hkg-443'
    );
  });

  it('keeps forwarding rule rows and create drawer forms on square design-system controls', async () => {
    const user = userEvent.setup();

    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry')]}
        language="en"
        rules={[createRule({ id: 'forward-a' })]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const workspace = screen.getByRole('region', { name: 'Forwarding rules workspace' });
    const tableRegion = getForwardingRuleTableRegion(workspace);
    const tableBody = tableRegion.querySelector('tbody');
    const ruleRow = getForwardingRuleRow('HKG HTTPS Forward', workspace);
    const rowCheckbox = within(ruleRow).getByRole('checkbox', { name: 'Select HKG HTTPS Forward' });
    const ruleState = within(ruleRow).getByText('Enabled');

    expect(tableBody).toHaveClass('divide-[#07111F]/15');
    expect(ruleRow).toHaveClass('hover:bg-[#EAF3D1]/45');
    expect(rowCheckbox).toHaveClass('accent-[#1E3AFF]');
    expect(ruleState).toHaveClass('border-[#07111F]/20', 'bg-[#FFFDF5]', 'text-[#35405A]');

    const rowHtml = ruleRow?.outerHTML ?? '';
    expect(rowHtml).not.toContain('bg-slate');
    expect(rowHtml).not.toContain('text-slate');
    expect(rowHtml).not.toContain('border-slate');
    expect(rowHtml).not.toContain('bg-blue');
    expect(rowHtml).not.toContain('text-blue');
    expect(rowHtml).not.toContain('emerald-');
    expect(rowHtml).not.toContain('rounded-lg');

    await user.click(screen.getByRole('button', { name: 'Create Forward Rule' }));

    const dialog = screen.getByRole('dialog', { name: 'Create Forward Rule' });
    const ownerField = within(dialog).getByLabelText('Customer').closest('label');
    const entryNodePicker = within(dialog).getByText('Entry Hosts').closest('.forwarding-entry-node-picker');
    const enabledToggle = within(dialog).getByText('Enabled').closest('label');
    const advancedOptions = within(dialog).getByText('Advanced Config').closest('details');

    expect(ownerField).toHaveClass('border-[#07111F]/20', 'bg-[#FFFDF5]');
    expect(entryNodePicker).toHaveClass('forwarding-entry-node-picker', 'border-[#07111F]/20', 'bg-[#FFFDF5]');
    expect(enabledToggle).toHaveClass('forwarding-enabled-toggle', 'border-[#07111F]/20', 'bg-[#FFFDF5]');
    expect(advancedOptions).toHaveClass('forwarding-advanced-options', 'border-[#07111F]/20', 'bg-[#FFFDF5]');

    const dialogHtml = dialog.outerHTML;
    expect(dialogHtml).not.toContain('border-slate');
    expect(dialogHtml).not.toContain('text-slate');
    expect(dialogHtml).not.toContain('bg-slate');
    expect(dialogHtml).not.toContain('bg-blue');
    expect(dialogHtml).not.toContain('text-blue');
    expect(dialogHtml).not.toContain('rounded-lg');
    expect(dialogHtml).not.toContain('rounded-xl');
  });

  it('keeps forwarding risk states on explicit design-system colors instead of default template utilities', async () => {
    const user = userEvent.setup();

    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry'), createAgent('agent-lax-01', 'LAX Entry')]}
        language="en"
        rules={[
          createRule({
            id: 'forward-disabled-by-policy',
            name: 'Policy Disabled Forward',
            runtimeDisabledByPolicy: true,
            guardrailReason: 'forward_rule_disabled_by_policy',
            portStatus: 'failed'
          }),
          createRule({
            id: 'forward-quota-exceeded',
            name: 'Quota Exceeded Forward',
            sourceAgentId: 'agent-lax-01',
            entryNodeIds: ['agent-lax-01'],
            quotaExceeded: true,
            guardrailReason: 'forward_rule_quota_exceeded',
            listenPort: 8443,
            bindings: [
              {
                agentId: 'agent-lax-01',
                listenAddress: '0.0.0.0',
                listenPort: 8443,
                targetAddress: '10.0.0.20',
                targetPort: 9443,
                protocol: 'tcp',
                status: 'conflict',
                runtimeServiceNames: ['ou-forward-quota-exceeded-agent-lax-01.service']
              }
            ]
          })
        ]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Select Visible Rules' }));

    const cockpit = screen.getByRole('region', { name: 'Port forwarding cockpit' });
    const workspace = within(cockpit).getByRole('region', { name: 'Forwarding rules workspace' });
    const tableRegion = getForwardingRuleTableRegion(workspace);
    const policyRow = getForwardingRuleRow('Policy Disabled Forward', workspace);
    const quotaRow = getForwardingRuleRow('Quota Exceeded Forward', workspace);
    const deleteButton = within(tableRegion).getAllByRole('button', { name: 'Delete Rule' })[0];
    const bulkDeleteButton = within(cockpit).getByRole('button', { name: 'Bulk Delete' });

    expect(policyRow).not.toBeNull();
    expect(quotaRow).not.toBeNull();
    expect(within(policyRow).getByText('Quota suspended')).toHaveClass('border-[#DC2626]', 'bg-[#DC2626]/[0.10]', 'text-[#B91C1C]');
    expect(within(quotaRow).getAllByText('Quota exceeded')[0]).toHaveClass('border-[#FF3D18]', 'bg-[#FFD8C6]/72', 'text-[#B93C17]');
    expect(within(policyRow).getAllByText('forward_rule_disabled_by_policy')[0]).toHaveClass('text-[#B91C1C]');
    expect(within(quotaRow).getAllByText('forward_rule_quota_exceeded')[0]).toHaveClass('text-[#B93C17]');
    expect(deleteButton).toHaveClass('border-[#DC2626]', 'text-[#DC2626]');
    expect(bulkDeleteButton).toHaveClass('border-[#DC2626]', 'text-[#DC2626]');

    const riskStateHtml = [
      policyRow?.outerHTML ?? '',
      quotaRow?.outerHTML ?? '',
      deleteButton.outerHTML,
      bulkDeleteButton.outerHTML
    ].join('');

    expect(riskStateHtml).toContain('#DC2626');
    expect(riskStateHtml).toContain('#FF3D18');
    expect(riskStateHtml).not.toContain('red-');
    expect(riskStateHtml).not.toContain('orange-');
    expect(riskStateHtml).not.toContain('slate-');
    expect(riskStateHtml).not.toContain('rounded-lg');
  });

  it('blocks duplicate entry bindings before submitting a new forwarding rule', async () => {
    const user = userEvent.setup();
    const onCreateForwarding = vi.fn();

    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry')]}
        language="en"
        rules={[createRule({ name: 'Existing HTTPS Forward' })]}
        onCreateForwarding={onCreateForwarding}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Create Forward Rule' }));
    await user.type(screen.getByLabelText('Listen Port'), '443');
    await user.type(screen.getByLabelText('Target IP'), '172.20.8.10');
    await user.type(screen.getByLabelText('Target Port'), '9443');

    const conflictAlert = screen.getByRole('alert');
    expect(within(conflictAlert).getByText(/Port conflict/)).toBeInTheDocument();
    expect(within(conflictAlert).getByText(/Existing HTTPS Forward/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onCreateForwarding).not.toHaveBeenCalled();
  });

  it('surfaces billing direction mix and one-way limiter direction from existing rule models', () => {
    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry'), createAgent('agent-lax-01', 'LAX Entry')]}
        language="en"
        rules={[
          createRule(),
          createRule({
            id: 'forward-lax-8443',
            name: 'LAX Egress Forward',
            sourceAgentId: 'agent-lax-01',
            entryNodeIds: ['agent-lax-01'],
            listenPort: 8443,
            rateLimitMbps: 40,
            rateLimitMode: 'one-way',
            rateLimitDirection: 'egress',
            billingDirection: 'egress'
          })
        ]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    expect(screen.getByText('Both 1 · Out 1')).toBeInTheDocument();
    expect(screen.getByText('Bi-directional / Both')).toBeInTheDocument();
    expect(screen.getByText('One-way / Egress')).toBeInTheDocument();
  });

  it('frames the forwarding bulk impact preflight and bulk migrate action as a Fauvist control surface', async () => {
    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry'), createAgent('agent-lax-01', 'LAX Entry')]}
        language="en"
        rules={[
          createRule({ id: 'forward-a' }),
          createRule({
            id: 'forward-b',
            enabled: false,
            quotaExceeded: true,
            bindingCount: 2,
            bindings: [
              {
                agentId: 'agent-hkg-01',
                listenAddress: '0.0.0.0',
                listenPort: 8443,
                targetAddress: '10.0.0.20',
                targetPort: 9443,
                protocol: 'tcp',
                status: 'allocated',
                runtimeServiceNames: ['ou-forward-forward-b-agent-hkg-01.service']
              },
              {
                agentId: 'agent-lax-01',
                listenAddress: '0.0.0.0',
                listenPort: 8443,
                targetAddress: '10.0.0.20',
                targetPort: 9443,
                protocol: 'tcp',
                status: 'allocated',
                runtimeServiceNames: ['ou-forward-forward-b-agent-lax-01.service']
              }
            ]
          })
        ]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Select Visible Rules' }));

    const impactTitle = screen.getByText('Forwarding Bulk Impact Preflight');
    const impact = impactTitle.closest('section');

    expect(impact).not.toBeNull();
    expect(impact).toHaveClass('forwarding-bulk-impact-preflight', 'border-[#1E3AFF]', 'bg-[#D9FF00]/[0.18]', 'p-3');
    expect(impact).not.toHaveClass('p-4', 'p-5', 'p-6');
    const impactMetricGrid = (impact as HTMLElement).querySelector('.forwarding-bulk-impact-metric-grid');
    expect(impactMetricGrid).toHaveClass('xl:w-[26rem]');
    expect(impactMetricGrid).not.toHaveClass('xl:w-[30rem]', 'xl:w-[34rem]');
    expect(within(impact as HTMLElement).getByText('Entry Hosts')).toBeInTheDocument();
    expect(within(impact as HTMLElement).getByText('HKG Entry')).toBeInTheDocument();
    expect(within(impact as HTMLElement).getByText('HKG Entry')).toHaveClass('border-[#1E3AFF]', 'bg-[#FFFDF5]', 'text-[#07111F]');
    expect(screen.getByRole('button', { name: 'Bulk Migrate Entry' })).toHaveClass('border-[#FF3D18]', 'text-[#FF3D18]');
    expect(impact?.outerHTML).not.toContain('masonry');
    expect(impact?.outerHTML).not.toContain('columns-');
    expect(impact?.outerHTML).not.toContain('grid-flow-row-dense');
    expect(impact?.outerHTML).not.toContain('row-span');
  });

  it('renders a scan-friendly runtime path for each forwarding rule', () => {
    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry')]}
        language="en"
        rules={[
          createRule({
            id: 'forward-runtime-path',
            name: 'HKG Runtime Path',
            listenAddress: '0.0.0.0',
            listenPort: 2443,
            targetAddress: '172.20.8.10',
            targetPort: 9443,
            bindings: [
              {
                agentId: 'agent-hkg-01',
                listenAddress: '0.0.0.0',
                listenPort: 2443,
                targetAddress: '172.20.8.10',
                targetPort: 9443,
                protocol: 'tcp+udp',
                status: 'allocated',
                runtimeServiceNames: ['ou-forward-forward-runtime-path-agent-hkg-01.service']
              }
            ]
          })
        ]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const workspace = screen.getByRole('region', { name: 'Forwarding rules workspace' });
    const tableRegion = getForwardingRuleTableRegion(workspace);
    const runtimePath = within(tableRegion).getByRole('group', { name: 'Runtime Path HKG Runtime Path' });

    expect(within(runtimePath).getByText('Entry')).toBeInTheDocument();
    expect(within(runtimePath).getByText('HKG Entry')).toBeInTheDocument();
    expect(within(runtimePath).getByText('0.0.0.0:2443')).toBeInTheDocument();
    expect(within(runtimePath).getByText('Target')).toBeInTheDocument();
    expect(within(runtimePath).getByText('172.20.8.10:9443')).toBeInTheDocument();
    expect(within(runtimePath).getByText('Runtime Service')).toBeInTheDocument();
    expect(within(runtimePath).getByText('ou-forward-forward-runtime-path-agent-hkg-01.service')).toBeInTheDocument();
  });

  it('filters forwarding rules before selecting visible rows for bulk pause actions', async () => {
    const user = userEvent.setup();
    const onRunTask = vi.fn();
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const acmeRule = createRule({
      id: 'forward-acme-game',
      name: 'Acme Game Forward',
      ownerName: 'Acme',
      listenPort: 2443,
      targetAddress: '10.0.0.20',
      targetPort: 2443
    });
    const backupRule = createRule({
      id: 'forward-backup-game',
      name: 'Backup Game Forward',
      ownerName: 'Backup',
      listenPort: 2444,
      targetAddress: '10.0.0.21',
      targetPort: 2444
    });
    const pausedAcmeRule = createRule({
      id: 'forward-acme-paused',
      name: 'Acme Paused Forward',
      ownerName: 'Acme',
      enabled: false,
      portStatus: 'paused',
      listenPort: 2445,
      targetAddress: '10.0.0.22',
      targetPort: 2445
    });

    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry')]}
        language="en"
        rules={[acmeRule, backupRule, pausedAcmeRule]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={onRunTask}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search Forward Rules' }), 'acme');
    await user.selectOptions(screen.getByLabelText('Rule Status'), 'allocated');
    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Rules' }));

    const workspace = screen.getByRole('region', { name: 'Forwarding rules workspace' });
    const tableRegion = getForwardingRuleTableRegion(workspace);

    expect(within(tableRegion).getByText('Acme Game Forward')).toBeInTheDocument();
    expect(screen.queryByText('Backup Game Forward')).not.toBeInTheDocument();
    expect(screen.queryByText('Acme Paused Forward')).not.toBeInTheDocument();
    expect(screen.getByText('Matching 1 / 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Bulk Pause' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Pause 1 selected forwarding rule'));
    expect(onRunTask).toHaveBeenCalledTimes(1);
    expect(onRunTask).toHaveBeenCalledWith('forward-acme-game', 'pause');
    expect(within(tableRegion).getByRole('checkbox', { name: 'Select Acme Game Forward' })).toBeChecked();
  });

  it('shows a bulk impact preflight for selected forwarding rules before risky actions', async () => {
    const user = userEvent.setup();
    const acmeRule = createRule({
      id: 'forward-acme-game',
      name: 'Acme Game Forward',
      ownerName: 'Acme',
      listenPort: 2443,
      targetAddress: '10.0.0.20',
      targetPort: 2443,
      usedBytes: 88 * GB,
      quotaBytes: 100 * GB,
      quotaExceeded: true,
      guardrailReason: 'forward_rule_quota_exceeded'
    });
    const backupRule = createRule({
      id: 'forward-backup-paused',
      name: 'Backup Paused Forward',
      ownerName: 'Backup',
      sourceAgentId: 'agent-lax-01',
      entryNodeIds: ['agent-lax-01'],
      listenPort: 2444,
      targetAddress: '10.0.0.21',
      targetPort: 2444,
      enabled: false,
      portStatus: 'paused',
      usedBytes: 12 * GB,
      quotaBytes: 50 * GB,
      runtimeDisabledByPolicy: true,
      guardrailReason: 'forward_rule_disabled_by_policy',
      bindings: [
        {
          agentId: 'agent-lax-01',
          listenAddress: '0.0.0.0',
          listenPort: 2444,
          targetAddress: '10.0.0.21',
          targetPort: 2444,
          protocol: 'tcp+udp',
          status: 'paused'
        }
      ]
    });

    render(
      <ForwardingPage
        agents={[
          createAgent('agent-hkg-01', 'HKG Entry'),
          createAgent('agent-lax-01', 'LAX Entry')
        ]}
        language="en"
        rules={[acmeRule, backupRule]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const workspace = screen.getByRole('region', { name: 'Forwarding rules workspace' });
    const tableRegion = getForwardingRuleTableRegion(workspace);

    await user.click(within(tableRegion).getByRole('checkbox', { name: 'Select Acme Game Forward' }));
    await user.click(within(tableRegion).getByRole('checkbox', { name: 'Select Backup Paused Forward' }));

    const preflight = screen.getByRole('region', { name: 'Forwarding Bulk Impact Preflight' });
    expect(within(preflight).getByText('Affected Customers 2')).toBeInTheDocument();
    expect(within(preflight).getByText('Entry Hosts 2')).toBeInTheDocument();
    expect(within(preflight).getByText('Port Bindings 2')).toBeInTheDocument();
    expect(within(preflight).getByText('Guardrail Risks 2')).toBeInTheDocument();
    expect(within(preflight).getByText('Paused/Disabled 1')).toBeInTheDocument();
    expect(within(preflight).getByText('Used Traffic 100.0 GB')).toBeInTheDocument();

    const customerPreview = within(preflight).getByText('Customer Preview').closest('div');
    const bindingPreview = within(preflight).getByText('Binding Preview').closest('div');
    const riskPreview = within(preflight).getByText('Risk Notes').closest('div');
    expect(customerPreview).not.toBeNull();
    expect(bindingPreview).not.toBeNull();
    expect(riskPreview).not.toBeNull();
    expect(within(customerPreview as HTMLElement).getByText('Acme')).toBeInTheDocument();
    expect(within(customerPreview as HTMLElement).getByText('Backup')).toBeInTheDocument();
    expect(within(bindingPreview as HTMLElement).getByText(/HKG Entry/)).toBeInTheDocument();
    expect(within(bindingPreview as HTMLElement).getByText(/LAX Entry/)).toBeInTheDocument();
    expect(within(riskPreview as HTMLElement).getByText(/forward_rule_quota_exceeded/)).toBeInTheDocument();
    expect(within(riskPreview as HTMLElement).getByText(/forward_rule_disabled_by_policy/)).toBeInTheDocument();
    expect(preflight.outerHTML).toContain('#1E3AFF');
    expect(preflight.outerHTML).toContain('#D9FF00');
    expect(preflight.outerHTML).toContain('#FF3D18');
    expect(preflight.outerHTML).not.toContain('amber-');
    expect(preflight.outerHTML).not.toContain('rose-');
  });

  it('migrates selected filtered forwarding rules to a replacement entry host', async () => {
    const user = userEvent.setup();
    const onCreateForwarding = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const acmeRule = createRule({
      id: 'forward-acme-game',
      name: 'Acme Game Forward',
      ownerName: 'Acme',
      listenPort: 2443,
      targetAddress: '10.0.0.20',
      targetPort: 2443
    });
    const backupRule = createRule({
      id: 'forward-backup-game',
      name: 'Backup Game Forward',
      ownerName: 'Backup',
      listenPort: 2444,
      targetAddress: '10.0.0.21',
      targetPort: 2444
    });

    render(
      <ForwardingPage
        agents={[
          createAgent('agent-hkg-01', 'HKG Entry'),
          createAgent('agent-lax-01', 'LAX Entry')
        ]}
        language="en"
        rules={[acmeRule, backupRule]}
        onCreateForwarding={onCreateForwarding}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search Forward Rules' }), 'acme');
    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Rules' }));
    await user.selectOptions(screen.getByLabelText('Bulk Migrate Entry Host'), 'agent-lax-01');
    await user.click(screen.getByRole('button', { name: 'Bulk Migrate Entry' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Migrate 1 selected forwarding rule to LAX Entry'));
    expect(onCreateForwarding).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Bulk Migrate Entry' }));

    expect(onCreateForwarding).toHaveBeenCalledTimes(1);
    expect(onCreateForwarding).toHaveBeenCalledWith(
      expect.objectContaining({
        name: acmeRule.name,
        ownerName: acmeRule.ownerName,
        listenPort: acmeRule.listenPort,
        targetAddress: acmeRule.targetAddress,
        targetPort: acmeRule.targetPort,
        entryNodeIds: ['agent-lax-01']
      }),
      'update',
      acmeRule.id
    );
    expect(onCreateForwarding).not.toHaveBeenCalledWith(
      expect.anything(),
      'update',
      backupRule.id
    );
  });

  it('blocks bulk entry migration when the replacement host already owns the binding', async () => {
    const user = userEvent.setup();
    const onCreateForwarding = vi.fn();
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const acmeRule = createRule({
      id: 'forward-acme-game',
      name: 'Acme Game Forward',
      ownerName: 'Acme',
      listenPort: 2443,
      targetAddress: '10.0.0.20',
      targetPort: 2443,
      bindings: [
        {
          agentId: 'agent-hkg-01',
          listenAddress: '0.0.0.0',
          listenPort: 2443,
          targetAddress: '10.0.0.20',
          targetPort: 2443,
          protocol: 'tcp+udp',
          status: 'allocated'
        }
      ]
    });
    const existingLaxRule = createRule({
      id: 'forward-existing-lax',
      name: 'Existing LAX Forward',
      ownerName: 'Ops',
      sourceAgentId: 'agent-lax-01',
      entryNodeIds: ['agent-lax-01'],
      listenPort: 2443,
      targetAddress: '10.0.0.99',
      targetPort: 9443,
      bindings: [
        {
          agentId: 'agent-lax-01',
          listenAddress: '0.0.0.0',
          listenPort: 2443,
          targetAddress: '10.0.0.99',
          targetPort: 9443,
          protocol: 'tcp+udp',
          status: 'allocated'
        }
      ]
    });

    render(
      <ForwardingPage
        agents={[
          createAgent('agent-hkg-01', 'HKG Entry'),
          createAgent('agent-lax-01', 'LAX Entry')
        ]}
        language="en"
        rules={[acmeRule, existingLaxRule]}
        onCreateForwarding={onCreateForwarding}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search Forward Rules' }), 'acme');
    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Rules' }));
    await user.selectOptions(screen.getByLabelText('Bulk Migrate Entry Host'), 'agent-lax-01');

    const conflictAlert = screen.getByRole('alert');
    expect(within(conflictAlert).getByText(/Port conflict/)).toBeInTheDocument();
    expect(within(conflictAlert).getByText(/Existing LAX Forward/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bulk Migrate Entry' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Bulk Migrate Entry' }));

    expect(confirm).not.toHaveBeenCalled();
    expect(onCreateForwarding).not.toHaveBeenCalled();
  });

  it('surfaces per-rule runtime evidence before row actions', () => {
    const acmeRule = createRule({
      id: 'forward-acme-game',
      name: 'Acme Game Forward',
      ownerName: 'Acme',
      listenPort: 2443,
      targetAddress: '10.0.0.20',
      targetPort: 2443,
      quotaExceeded: true,
      guardrailReason: 'forward_rule_quota_exceeded',
      bindings: [
        {
          agentId: 'agent-hkg-01',
          listenAddress: '0.0.0.0',
          listenPort: 2443,
          targetAddress: '10.0.0.20',
          targetPort: 2443,
          protocol: 'tcp+udp',
          status: 'allocated',
          runtimeServiceNames: ['ou-forward-acme-hkg.service']
        },
        {
          agentId: 'agent-lax-01',
          listenAddress: '0.0.0.0',
          listenPort: 2443,
          targetAddress: '10.0.0.20',
          targetPort: 2443,
          protocol: 'tcp+udp',
          status: 'paused',
          runtimeServiceNames: ['ou-forward-acme-lax.service']
        }
      ],
      bindingCount: 2
    });

    render(
      <ForwardingPage
        agents={[
          createAgent('agent-hkg-01', 'HKG Entry'),
          createAgent('agent-lax-01', 'LAX Entry')
        ]}
        language="en"
        rules={[acmeRule]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const workspace = screen.getByRole('region', { name: 'Forwarding rules workspace' });
    const tableRegion = getForwardingRuleTableRegion(workspace);
    const evidence = within(tableRegion).getByRole('group', { name: 'Runtime evidence for Acme Game Forward' });
    expect(within(evidence).getByText('Runtime Evidence')).toBeInTheDocument();
    expect(within(evidence).getByText('Bindings 2')).toBeInTheDocument();
    expect(within(evidence).getByText('Next Action Deploy / Pause')).toBeInTheDocument();
    expect(within(evidence).getByText('Guardrail forward_rule_quota_exceeded')).toBeInTheDocument();
    expect(within(evidence).getByText('ou-forward-acme-hkg.service')).toBeInTheDocument();
    expect(within(evidence).getByText('ou-forward-acme-lax.service')).toBeInTheDocument();
    expect(evidence.outerHTML).toContain('#1E3AFF');
    expect(evidence.outerHTML).toContain('#FF3D18');
    expect(evidence.outerHTML).not.toContain('purple-');
    expect(evidence.outerHTML).not.toContain('indigo-');
  });

  it('keeps forwarding runtime evidence readable for long generated service names', () => {
    const longServiceName =
      'ou-forward-forward-custom-2443-agent-edge-hkg-production-primary-tcp-forwarding-runtime.service';
    const acmeRule = createRule({
      id: 'forward-acme-long-service',
      name: 'Acme Long Runtime Forward',
      ownerName: 'Acme',
      listenPort: 2443,
      targetAddress: '10.0.0.20',
      targetPort: 2443,
      bindings: [
        {
          agentId: 'agent-hkg-01',
          listenAddress: '0.0.0.0',
          listenPort: 2443,
          targetAddress: '10.0.0.20',
          targetPort: 2443,
          protocol: 'tcp+udp',
          status: 'allocated',
          runtimeServiceNames: [longServiceName]
        }
      ],
      bindingCount: 1
    });

    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry')]}
        language="en"
        rules={[acmeRule]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={vi.fn()}
        onRunTask={vi.fn()}
      />
    );

    const workspace = screen.getByRole('region', { name: 'Forwarding rules workspace' });
    const tableRegion = getForwardingRuleTableRegion(workspace);
    const evidence = within(tableRegion).getByRole('group', { name: 'Runtime evidence for Acme Long Runtime Forward' });
    const path = within(tableRegion).getByRole('group', { name: 'Runtime Path Acme Long Runtime Forward' });

    expect(evidence).toHaveClass('forwarding-runtime-evidence-card');
    expect(path).toHaveClass('forwarding-runtime-path-card');
    expect(within(evidence).getByText(longServiceName)).not.toHaveClass('truncate');
    expect(within(path).getByText(longServiceName)).not.toHaveClass('truncate');
  });

  it('confirms row runtime and delete actions before changing a forwarding rule', async () => {
    const user = userEvent.setup();
    const onRunTask = vi.fn();
    const onDeleteForwarding = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const acmeRule = createRule({
      id: 'forward-acme-game',
      name: 'Acme Game Forward',
      ownerName: 'Acme',
      listenPort: 2443,
      targetAddress: '10.0.0.20',
      targetPort: 2443
    });

    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry')]}
        language="en"
        rules={[acmeRule]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={onDeleteForwarding}
        onRunTask={onRunTask}
      />
    );

    const workspace = screen.getByRole('region', { name: 'Forwarding rules workspace' });
    const tableRegion = getForwardingRuleTableRegion(workspace);

    await user.click(within(tableRegion).getByRole('button', { name: 'Deploy' }));
    await user.click(within(tableRegion).getByRole('button', { name: 'Pause' }));
    await user.click(within(tableRegion).getByRole('button', { name: 'Delete Rule' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Deploy Acme Game Forward'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Pause Acme Game Forward'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Delete Rule Acme Game Forward'));
    expect(onRunTask).not.toHaveBeenCalled();
    expect(onDeleteForwarding).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(within(tableRegion).getByRole('button', { name: 'Deploy' }));
    await user.click(within(tableRegion).getByRole('button', { name: 'Delete Rule' }));

    expect(onRunTask).toHaveBeenCalledWith('forward-acme-game', 'apply');
    expect(onDeleteForwarding).toHaveBeenCalledWith(acmeRule);
  });

  it('requires confirmation before bulk deleting selected filtered forwarding rules', async () => {
    const user = userEvent.setup();
    const onDeleteForwarding = vi.fn();
    const acmeRule = createRule({
      id: 'forward-acme-game',
      name: 'Acme Game Forward',
      ownerName: 'Acme',
      listenPort: 2443,
      targetAddress: '10.0.0.20',
      targetPort: 2443
    });
    const backupRule = createRule({
      id: 'forward-backup-game',
      name: 'Backup Game Forward',
      ownerName: 'Backup',
      listenPort: 2444,
      targetAddress: '10.0.0.21',
      targetPort: 2444
    });

    render(
      <ForwardingPage
        agents={[createAgent('agent-hkg-01', 'HKG Entry')]}
        language="en"
        rules={[acmeRule, backupRule]}
        onCreateForwarding={vi.fn()}
        onDeleteForwarding={onDeleteForwarding}
        onRunTask={vi.fn()}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search Forward Rules' }), 'acme');
    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Rules' }));
    await user.click(screen.getByRole('button', { name: 'Bulk Delete' }));

    expect(onDeleteForwarding).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm Delete 1 Rules' }));

    expect(onDeleteForwarding).toHaveBeenCalledTimes(1);
    expect(onDeleteForwarding).toHaveBeenCalledWith(acmeRule);
    expect(onDeleteForwarding).not.toHaveBeenCalledWith(backupRule);
    expect(screen.queryByText('Acme Game Forward')).not.toBeInTheDocument();
    expect(screen.getByText('No matching forwarding rules')).toBeInTheDocument();
  });
});
