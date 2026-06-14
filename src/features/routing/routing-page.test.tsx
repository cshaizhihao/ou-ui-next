import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RoutingPolicy } from '../../domain';
import { RoutingPage } from './routing-page';

afterEach(() => {
  vi.unstubAllGlobals();
});

const policies: RoutingPolicy[] = [
  {
    id: 'route-direct-private',
    name: 'Private CIDR direct',
    enabled: true,
    match: 'cidr:10.0.0.0/8 OR geoip:private',
    action: 'direct',
    priority: 10,
    targetGroup: 'DIRECT',
    hitCount: 3200,
    riskLevel: 'low'
  },
  {
    id: 'route-proxy-hk-streaming',
    name: 'HK streaming proxy',
    enabled: true,
    match: 'domain:netflix.com OR app:streaming',
    action: 'proxy',
    priority: 40,
    targetGroup: 'HK-PREMIUM',
    hitCount: 1205,
    riskLevel: 'medium'
  },
  {
    id: 'route-reject-cn-risk',
    name: 'CN malware reject',
    enabled: false,
    match: 'geoip:cn AND domain:malware.example',
    action: 'reject',
    priority: 90,
    targetGroup: 'REJECT',
    hitCount: 17,
    riskLevel: 'high'
  }
];

describe('RoutingPage', () => {
  it('splits routing policy operations into a control rail and policy workspace cockpit', () => {
    render(<RoutingPage language="en" policies={policies} onRunTask={vi.fn()} />);

    const cockpit = screen.getByRole('region', { name: 'Routing policy cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Routing control rail' });
    const workspace = within(cockpit).getByRole('region', { name: 'Routing policy workspace' });

    expect(within(rail).getByText('Compile Scope')).toBeInTheDocument();
    expect(within(rail).getByText('High Risk Rules')).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Compile Visible Policies' })).toBeInTheDocument();

    expect(within(workspace).getByRole('searchbox', { name: 'Search Policies' })).toBeInTheDocument();
    expect(within(workspace).getByLabelText('Filtered Route Policies')).toBeInTheDocument();
    expect(within(workspace).getByRole('button', { name: 'Compile Selected Policies' })).toBeInTheDocument();
  });

  it('uses the fauvist control-plane palette instead of legacy utility colors in the routing cockpit', () => {
    render(<RoutingPage language="en" policies={policies} onRunTask={vi.fn()} />);

    const cockpit = screen.getByRole('region', { name: 'Routing policy cockpit' });
    expect(cockpit.outerHTML).toContain('#1E3AFF');
    expect(cockpit.outerHTML).toContain('#DCE1FF');
    expect(cockpit.outerHTML).toContain('#FF3D18');
    expect(cockpit.outerHTML).toContain('#FFD8C6');
    expect(cockpit.outerHTML).toContain('#00A878');
    expect(cockpit.outerHTML).not.toContain('blue-');
    expect(cockpit.outerHTML).not.toContain('orange-');
    expect(cockpit.outerHTML).not.toContain('slate-');
    expect(cockpit.outerHTML).not.toContain('emerald-');
    expect(cockpit.outerHTML).not.toContain('cyan-');
  });

  it('uses a v2 routing cockpit visual system for the policy matrix', () => {
    render(<RoutingPage language="en" policies={policies} onRunTask={vi.fn()} />);

    const cockpit = screen.getByRole('region', { name: 'Routing policy cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Routing control rail' });
    const workspace = within(cockpit).getByRole('region', { name: 'Routing policy workspace' });
    const matrix = within(workspace).getByRole('group', { name: 'Policy List' });
    const policyRow = within(matrix).getByRole('article', { name: 'HK streaming proxy' });

    expect(cockpit).toHaveClass('routing-policy-cockpit');
    expect(rail).toHaveClass('routing-policy-rail');
    expect(workspace).toHaveClass('routing-policy-workspace');
    expect(matrix).toHaveClass('routing-policy-matrix-panel');
    expect(policyRow).toHaveClass('routing-policy-row');
    const cockpitHtml = `${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}`;
    expect(cockpitHtml).toContain('#1E3AFF');
    expect(cockpitHtml).toContain('#DCE1FF');
    expect(cockpitHtml).toContain('#FF3D18');
    expect(cockpitHtml).toContain('#FFD8C6');
    expect(cockpitHtml).toContain('#00A878');
    expect(within(rail).getByRole('group', { name: 'High Risk Rules' }).outerHTML).toContain('#FF3D18');
    expect(cockpitHtml).not.toContain('blue-');
    expect(cockpitHtml).not.toContain('orange-');
    expect(cockpitHtml).not.toContain('slate-');
    expect(cockpitHtml).not.toContain('emerald-');
    expect(cockpitHtml).not.toContain('sky-');
    expect(cockpitHtml).not.toContain('indigo-');
    expect(cockpitHtml).not.toContain('cyan-');
    expect(cockpitHtml).not.toContain('purple-');
    expect(cockpitHtml).not.toContain('violet-');
    expect(cockpitHtml).not.toContain('rose-');
    expect(cockpitHtml).not.toContain('amber-');
    expect(cockpitHtml).not.toContain('background-clip:text');
  });

  it('surfaces routing policy compile gates on the control rail', () => {
    render(<RoutingPage language="en" policies={policies} onRunTask={vi.fn()} />);

    const cockpit = screen.getByRole('region', { name: 'Routing policy cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: 'Routing control rail' });
    const gates = within(rail).getByRole('region', { name: 'Policy Compile Gates' });

    expect(gates).toHaveClass('routing-compile-gate-panel');
    expect(gates.outerHTML).toContain('#1E3AFF');
    expect(gates.outerHTML).toContain('#FF3D18');
    expect(gates.outerHTML).toContain('#D9FF00');
    expect(gates.outerHTML).toContain('#00A878');
    expect(within(gates).getByRole('group', { name: 'Visible Scope' })).toHaveTextContent('Ready');
    expect(within(gates).getByRole('group', { name: 'Risk Review' })).toHaveTextContent('Issues');
    expect(within(gates).getByRole('group', { name: 'Target Groups' })).toHaveTextContent('Ready');
    expect(within(gates).getByRole('group', { name: 'Selection Scope' })).toHaveTextContent('Waiting');
    expect(within(gates).getByRole('group', { name: 'Dispatch Readiness' })).toHaveTextContent('Ready');
  });

  it('builds an administrator-authored domain routing rule from host, domain, and outbound protocol fields', async () => {
    const user = userEvent.setup();
    const onRunTask = vi.fn();

    render(<RoutingPage language="zh" policies={policies} onRunTask={onRunTask} />);

    const manualRule = screen.getByRole('region', { name: '手写分流规则' });
    await user.type(within(manualRule).getByLabelText('生成主机'), '香港入口主机');
    await user.type(within(manualRule).getByLabelText('访问域名'), 'stream.example.com');
    await user.selectOptions(within(manualRule).getByLabelText('出站协议'), 'proxy');
    await user.type(within(manualRule).getByLabelText('出站标签'), 'HK-PREMIUM');
    await user.click(within(manualRule).getByRole('button', { name: '编译手写规则' }));

    expect(onRunTask).toHaveBeenCalledWith('routing-manual-rule', [
      'manual:香港入口主机:stream.example.com:proxy:HK-PREMIUM'
    ]);
    expect(within(manualRule).getByText('香港入口主机 生成的节点')).toBeInTheDocument();
    expect(within(manualRule).getByText('domain:stream.example.com')).toBeInTheDocument();
    expect(within(manualRule).getByText('outbound:HK-PREMIUM')).toBeInTheDocument();
    expect(screen.queryByText('将域名、CIDR、GeoIP 与应用标签映射到直连、代理或拒绝策略。')).not.toBeInTheDocument();
  });

  it('keeps the routing policy cockpit compact without masonry or oversized cards', () => {
    render(<RoutingPage language="en" policies={policies} onRunTask={vi.fn()} />);

    const cockpit = screen.getByRole('region', { name: 'Routing policy cockpit' });
    const cockpitGrid = cockpit.querySelector('.routing-policy-cockpit-grid');
    const rail = within(cockpit).getByRole('complementary', { name: 'Routing control rail' });
    const workspace = within(cockpit).getByRole('region', { name: 'Routing policy workspace' });
    const workspaceStack = workspace.querySelector('.routing-policy-workspace-stack');
    const matrix = within(workspace).getByRole('group', { name: 'Policy List' });
    const filterPanel = matrix.querySelector('.routing-policy-filter-panel');
    const filterGrid = matrix.querySelector('.routing-policy-filter-grid');
    const policyRow = within(matrix).getByRole('article', { name: 'HK streaming proxy' });
    const railMetric = within(rail).getByRole('group', { name: 'Policy Count' });
    const overviewGrid = document.querySelector('.routing-summary-grid');
    const overviewCard = document.querySelector('.routing-summary-card');
    const emptyStateHtml = cockpit.outerHTML;

    expect(cockpitGrid).toBeInTheDocument();
    expect(cockpitGrid as HTMLElement).toHaveClass('xl:grid-cols-[18rem_minmax(0,1fr)]');
    expect(rail).toHaveClass('p-3');
    expect(rail).not.toHaveClass('p-4');
    expect(workspaceStack).toBeInTheDocument();
    expect(workspaceStack as HTMLElement).toHaveClass('space-y-3', 'p-3');
    expect(matrix).toHaveClass('routing-policy-matrix-panel', 'p-3');
    expect(matrix).not.toHaveClass('p-5', 'rounded-xl');
    expect(overviewGrid).toBeInTheDocument();
    expect(overviewGrid as HTMLElement).toHaveClass('xl:w-[28rem]', 'xl:grid-cols-2');
    expect(overviewGrid as HTMLElement).not.toHaveClass('xl:grid-cols-1');
    expect(filterPanel).toBeInTheDocument();
    expect(filterPanel as HTMLElement).toHaveClass('p-3');
    expect(filterPanel as HTMLElement).not.toHaveClass('p-4', 'rounded-xl');
    expect(filterGrid).toBeInTheDocument();
    expect(filterGrid as HTMLElement).toHaveClass('xl:grid-cols-[minmax(16rem,1fr)_minmax(10rem,0.32fr)_minmax(10rem,0.32fr)]');
    expect(policyRow).toHaveClass('routing-policy-row', 'min-h-[64px]', 'px-3', 'py-2.5');
    expect(policyRow).not.toHaveClass('min-h-[76px]', 'p-3');
    expect(policyRow).not.toHaveClass('rounded-xl');
    expect(railMetric).toHaveClass('routing-rail-metric', 'min-h-[64px]', 'px-3', 'py-2');
    expect(railMetric).not.toHaveClass('min-h-[76px]');
    expect(railMetric).not.toHaveClass('rounded-xl');
    expect(overviewCard).toHaveClass('routing-summary-card', 'min-h-[64px]', 'p-2.5');
    expect(overviewCard).not.toHaveClass('min-h-[76px]', 'rounded-xl', 'p-3', 'p-4');
    expect(emptyStateHtml).not.toContain('masonry');
    expect(emptyStateHtml).not.toContain('columns-');
    expect(emptyStateHtml).not.toContain('grid-flow-row-dense');
    expect(emptyStateHtml).not.toContain('auto-rows');
    expect(emptyStateHtml).not.toContain('row-span');
  });

  it('filters route policies by query action and risk before compiling the visible policy scope', async () => {
    const user = userEvent.setup();
    const onRunTask = vi.fn();
    vi.stubGlobal('confirm', vi.fn(() => true));

    render(<RoutingPage language="en" policies={policies} onRunTask={onRunTask} />);

    expect(screen.getByRole('heading', { name: 'Routing Policy' })).toBeInTheDocument();
    expect(screen.getByText('Matching 3 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'High Risk · 1' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'High Risk · 1' }));
    expect(screen.getByText('Matching 1 / 3')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Search Policies' }), 'cn');
    await user.selectOptions(screen.getByLabelText('Action'), 'reject');

    expect(screen.getByText('Matching 1 / 3')).toBeInTheDocument();
    expect(screen.getByText('Visible Hits')).toBeInTheDocument();
    expect(screen.getByText('17')).toBeInTheDocument();
    expect(screen.getByText('CN malware reject')).toBeInTheDocument();
    expect(screen.queryByText('HK streaming proxy')).not.toBeInTheDocument();

    const filteredPolicy = screen.getByLabelText('Filtered Route Policies');
    expect(within(filteredPolicy).getByText('route-reject-cn-risk')).toBeInTheDocument();
    expect(within(filteredPolicy).getByText('geoip:cn AND domain:malware.example')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Compile Visible Policies' }));

    expect(onRunTask).toHaveBeenCalledWith('routing-policy-matrix', ['route-reject-cn-risk']);
  });

  it('shows an empty filtered state and prevents compiling when no routing policies match', async () => {
    const user = userEvent.setup();
    const onRunTask = vi.fn();

    render(<RoutingPage language="en" policies={policies} onRunTask={onRunTask} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search Policies' }), 'wireguard');

    expect(screen.getByText('Matching 0 / 3')).toBeInTheDocument();
    expect(screen.getByText('No matching routing policies')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compile Visible Policies' })).toBeDisabled();
  });

  it('requires confirmation before compiling visible high-risk or reject routing policies', async () => {
    const user = userEvent.setup();
    const onRunTask = vi.fn();
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);

    render(<RoutingPage language="en" policies={policies} onRunTask={onRunTask} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search Policies' }), 'malware');
    await user.selectOptions(screen.getByLabelText('Action'), 'reject');

    await user.click(screen.getByRole('button', { name: 'Compile Visible Policies' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('1 high-risk or reject policy'));
    expect(onRunTask).toHaveBeenCalledWith('routing-policy-matrix', ['route-reject-cn-risk']);
  });

  it('compiles only selected routing policies instead of the full visible scope', async () => {
    const user = userEvent.setup();
    const onRunTask = vi.fn();
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);

    render(<RoutingPage language="en" policies={policies} onRunTask={onRunTask} />);

    await user.click(screen.getByRole('checkbox', { name: 'Select HK streaming proxy' }));
    await user.click(screen.getByRole('button', { name: 'Compile Selected Policies' }));

    expect(confirm).not.toHaveBeenCalled();
    expect(onRunTask).toHaveBeenCalledTimes(1);
    expect(onRunTask).toHaveBeenCalledWith('routing-policy-matrix', ['route-proxy-hk-streaming']);
    expect(onRunTask).not.toHaveBeenCalledWith('routing-policy-matrix', [
      'route-direct-private',
      'route-proxy-hk-streaming',
      'route-reject-cn-risk'
    ]);
  });

  it('shows a routing compile impact preflight for selected policies before risky actions', async () => {
    const user = userEvent.setup();

    render(<RoutingPage language="en" policies={policies} onRunTask={vi.fn()} />);

    await user.click(screen.getByRole('checkbox', { name: 'Select HK streaming proxy' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select CN malware reject' }));

    const preflight = screen.getByRole('region', { name: 'Routing Compile Impact Preflight' });
    expect(within(preflight).getByText('Target Groups 2')).toBeInTheDocument();
    expect(within(preflight).getByText('Proxy Policies 1')).toBeInTheDocument();
    expect(within(preflight).getByText('Reject Policies 1')).toBeInTheDocument();
    expect(within(preflight).getByText('Risky Policies 1')).toBeInTheDocument();
    expect(within(preflight).getByText('Selected Hits 1,222')).toBeInTheDocument();
    expect(preflight.outerHTML).toContain('#FF3D18');
    expect(preflight.outerHTML).toContain('#FFD8C6');
    expect(preflight.outerHTML).not.toContain('orange-');
    expect(preflight.outerHTML).not.toContain('amber-');

    const targetPreview = within(preflight).getByText('Target Preview').closest('div');
    const matchPreview = within(preflight).getByText('Match Preview').closest('div');
    const riskPreview = within(preflight).getByText('Risk Preview').closest('div');

    expect(within(targetPreview as HTMLElement).getByText('HK-PREMIUM')).toBeInTheDocument();
    expect(within(targetPreview as HTMLElement).getByText('REJECT')).toBeInTheDocument();
    expect(within(matchPreview as HTMLElement).getByText('domain:netflix.com OR app:streaming')).toBeInTheDocument();
    expect(within(riskPreview as HTMLElement).getByText('CN malware reject · reject · high')).toBeInTheDocument();
  });

  it('copies a selected routing compile plan for risky policy review', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });

    render(<RoutingPage language="en" policies={policies} onRunTask={vi.fn()} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search Policies' }), 'malware');
    await user.click(screen.getByRole('checkbox', { name: 'Select CN malware reject' }));
    await user.click(screen.getByRole('button', { name: 'Copy Selected Compile Plan' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedPlan = writeText.mock.calls[0]?.[0] as string;
    expect(copiedPlan).toContain('Routing Compile Plan');
    expect(copiedPlan).toContain('Policy Count: 1');
    expect(copiedPlan).toContain('Risky Policies: 1');
    expect(copiedPlan).toContain('CN malware reject');
    expect(copiedPlan).toContain('Action: reject');
    expect(copiedPlan).toContain('Match: geoip:cn AND domain:malware.example');
    expect(copiedPlan).not.toContain('HK streaming proxy');
  });
});
