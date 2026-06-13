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

  it('uses the primary blue control-plane palette instead of cyan in the routing cockpit', () => {
    render(<RoutingPage language="en" policies={policies} onRunTask={vi.fn()} />);

    const cockpit = screen.getByRole('region', { name: 'Routing policy cockpit' });
    expect(cockpit.outerHTML).toContain('blue-');
    expect(cockpit.outerHTML).not.toContain('cyan-');
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
