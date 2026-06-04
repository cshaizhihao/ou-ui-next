import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SubscriptionInventoryNode, SubscriptionSource } from '../../domain';
import { SubscriptionMixerPage } from './subscription-mixer-page';

const source: SubscriptionSource = {
  id: 'source-hk-premium',
  kind: 'mihomo-provider',
  name: '香港 Premium 源',
  url: 'https://provider.example.com/hk.yaml',
  status: 'synced',
  nodeCount: 2,
  dedupeKey: 'server-port',
  lastSyncAt: '2026-06-02T00:00:00.000Z',
  rateLimitPerMinute: 60,
  userAgent: 'clash-meta/2.4.0',
  refreshIntervalMinutes: 60,
  includeFilter: 'premium|streaming',
  excludeFilter: 'expired|test'
};

function renderPage(overrides: Partial<Parameters<typeof SubscriptionMixerPage>[0]> = {}) {
  const props = {
    subscriptions: [],
    subscriptionSources: [source],
    subscriptionInventoryNodes: [],
    subscriptionClients: [],
    proxyProviders: [],
    subscriptionExportFiles: [],
    language: 'zh' as const,
    onImportSource: vi.fn(),
    onDeleteSource: vi.fn(),
    onSaveClient: vi.fn(),
    onDeleteClient: vi.fn(),
    onRunTask: vi.fn(),
    ...overrides
  };

  render(<SubscriptionMixerPage {...props} />);

  return props;
}

describe('SubscriptionMixerPage', () => {
  it('shows an empty inventory until real synchronized subscription nodes exist', async () => {
    const user = userEvent.setup();
    renderPage({ language: 'en' });

    await user.click(screen.getByRole('button', { name: 'Node Inventory' }));

    expect(screen.getByText('No inventory nodes yet')).toBeInTheDocument();
    expect(screen.queryByText(/203\.0\./)).not.toBeInTheDocument();
  });

  it('renders only real synchronized subscription inventory nodes', async () => {
    const user = userEvent.setup();
    const inventoryNode: SubscriptionInventoryNode = {
      id: 'inventory-source-hk-premium-vless-01',
      sourceId: source.id,
      name: 'HK Premium VLESS 01',
      protocol: 'vless',
      server: '198.51.100.18',
      port: 443,
      latencyMs: 76,
      tags: ['region:hk', 'premium', 'streaming'],
      rawUrl: 'vless://00000000-0000-4000-8000-000000000001@198.51.100.18:443#HK%20Premium%2001',
      inboundTag: 'source-hk-premium-vless-01'
    };
    renderPage({ language: 'en', subscriptionInventoryNodes: [inventoryNode] });

    await user.click(screen.getByRole('button', { name: 'Node Inventory' }));

    expect(screen.getByText('HK Premium VLESS 01')).toBeInTheDocument();
    expect(screen.getByText('198.51.100.18:443')).toBeInTheDocument();
    expect(screen.queryByText(/203\.0\./)).not.toBeInTheDocument();
  });

  it('submits external subscription source sync policy and miaomiaowu-style source rules', async () => {
    const user = userEvent.setup();
    const onImportSource = vi.fn();
    renderPage({ subscriptionSources: [], onImportSource });

    await user.click(screen.getByRole('button', { name: '导入订阅源' }));
    const drawer = screen.getByLabelText('导入外部订阅源');

    await user.clear(within(drawer).getByLabelText('源名称'));
    await user.type(within(drawer).getByLabelText('源名称'), '客户外部 Clash 源');
    await user.selectOptions(within(drawer).getByLabelText('源类型'), 'clash');
    await user.clear(within(drawer).getByLabelText('源地址'));
    await user.type(within(drawer).getByLabelText('源地址'), 'https://provider.example.com/customer.yaml');
    await user.clear(within(drawer).getByLabelText('User-Agent'));
    await user.type(within(drawer).getByLabelText('User-Agent'), 'clash-meta/2.4.0');
    await user.clear(within(drawer).getByLabelText('刷新间隔'));
    await user.type(within(drawer).getByLabelText('刷新间隔'), '45');
    await user.clear(within(drawer).getByLabelText('包含过滤'));
    await user.type(within(drawer).getByLabelText('包含过滤'), 'premium|streaming');
    await user.clear(within(drawer).getByLabelText('排除过滤'));
    await user.type(within(drawer).getByLabelText('排除过滤'), 'expired|test');
    await user.selectOptions(within(drawer).getByLabelText('去重策略'), 'uuid');
    await user.click(within(drawer).getByRole('button', { name: '保存' }));

    expect(onImportSource).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'clash',
        name: '客户外部 Clash 源',
        url: 'https://provider.example.com/customer.yaml',
        userAgent: 'clash-meta/2.4.0',
        refreshIntervalMinutes: 45,
        includeFilter: 'premium|streaming',
        excludeFilter: 'expired|test',
        dedupeKey: 'uuid',
        syncPolicy: {
          userAgent: 'clash-meta/2.4.0',
          refreshIntervalMinutes: 45
        },
        sourceRule: {
          includeFilter: 'premium|streaming',
          excludeFilter: 'expired|test',
          dedupeKey: 'uuid'
        }
      })
    );
  });

  it('dispatches source deletion through the control-plane task flow instead of hiding it locally', async () => {
    const user = userEvent.setup();
    const onDeleteSource = vi.fn();
    renderPage({ language: 'en', onDeleteSource });

    await user.click(screen.getByRole('button', { name: 'External Sources' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onDeleteSource).toHaveBeenCalledWith(source);
    expect(screen.getByText(source.name)).toBeInTheDocument();
  });

  it('does not synthesize proxy providers or export files in the page layer', async () => {
    const user = userEvent.setup();
    renderPage({ language: 'en' });

    await user.click(screen.getByRole('button', { name: 'Proxy Providers' }));
    expect(screen.getByText('No proxy providers yet')).toBeInTheDocument();
    expect(screen.queryByText(`${source.name} Provider`)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Export Files' }));
    expect(screen.getByText('No export files yet')).toBeInTheDocument();
  });

  it('submits client subscription rule metadata with protocol, filters, quota, formats, token and secure path preview', async () => {
    const user = userEvent.setup();
    const onSaveClient = vi.fn();
    renderPage({ onSaveClient });

    await user.click(screen.getByRole('button', { name: '新增订阅身份' }));
    const drawer = screen.getByLabelText('新增订阅身份');

    await user.clear(within(drawer).getByLabelText('客户名称'));
    await user.type(within(drawer).getByLabelText('客户名称'), 'Acme 中国区');
    await user.clear(within(drawer).getByLabelText('规则名称'));
    await user.type(within(drawer).getByLabelText('规则名称'), 'Acme 香港高速规则');
    await user.clear(within(drawer).getByLabelText('Sub ID'));
    await user.type(within(drawer).getByLabelText('Sub ID'), 'acme_hk');
    await user.clear(within(drawer).getByLabelText('客户 Email'));
    await user.type(within(drawer).getByLabelText('客户 Email'), 'ops@acme.example');
    await user.selectOptions(within(drawer).getByLabelText('协议过滤'), 'trojan');
    await user.clear(within(drawer).getByLabelText('节点标签'));
    await user.type(within(drawer).getByLabelText('节点标签'), 'streaming');
    await user.clear(within(drawer).getByLabelText('地区过滤'));
    await user.type(within(drawer).getByLabelText('地区过滤'), 'hk');
    await user.clear(within(drawer).getByLabelText('包含关键字'));
    await user.type(within(drawer).getByLabelText('包含关键字'), 'Premium|streaming');
    await user.clear(within(drawer).getByLabelText('排除过滤'));
    await user.type(within(drawer).getByLabelText('排除过滤'), 'expired|test');
    await user.clear(within(drawer).getByLabelText('最大延迟'));
    await user.type(within(drawer).getByLabelText('最大延迟'), '180');
    await user.clear(within(drawer).getByLabelText('流量上限'));
    await user.type(within(drawer).getByLabelText('流量上限'), '600');
    await user.clear(within(drawer).getByLabelText('已用流量'));
    await user.type(within(drawer).getByLabelText('已用流量'), '42');
    await user.clear(within(drawer).getByLabelText('到期'));
    await user.type(within(drawer).getByLabelText('到期'), '90');
    await user.clear(within(drawer).getByLabelText('IP 限制'));
    await user.type(within(drawer).getByLabelText('IP 限制'), '2');
    await user.clear(within(drawer).getByLabelText('每小时请求上限'));
    await user.type(within(drawer).getByLabelText('每小时请求上限'), '120');
    await user.click(within(drawer).getByLabelText('香港 Premium 源'));
    await user.click(within(drawer).getByLabelText('V2Ray'));
    await user.click(within(drawer).getByLabelText('Sing-box'));
    await user.click(within(drawer).getByRole('button', { name: '保存' }));

    expect(onSaveClient).toHaveBeenCalledWith(
      expect.objectContaining({
        customerName: 'Acme 中国区',
        ruleName: 'Acme 香港高速规则',
        displayName: 'Acme 香港高速规则',
        subId: 'acme_hk',
        email: 'ops@acme.example',
        protocol: 'trojan',
        sourceIds: ['source-hk-premium'],
        selectedTags: ['streaming'],
        regionFilter: ['hk'],
        includeFilter: 'Premium|streaming',
        excludeFilter: 'expired|test',
        maxLatencyMs: 180,
        trafficLimitGb: 600,
        usedTrafficGb: 42,
        remainingDays: 90,
        ipLimit: 2,
        requestLimitPerHour: 120,
        formats: ['clash', 'mihomo', 'plain'],
        outputFormats: ['clash', 'mihomo', 'uri'],
        accessTokenPreview: expect.stringMatching(/^ou_[A-Za-z0-9]{6}\.\.\.[A-Za-z0-9]{4}$/),
        securePathPreview: expect.stringMatching(/^\/[A-Za-z0-9]{24}$/),
        subscriptionUrlPreview: expect.objectContaining({
          clash: expect.stringContaining('/clash/acme_hk'),
          mihomo: expect.stringContaining('/mihomo/acme_hk'),
          uri: expect.stringContaining('/uri/acme_hk')
        }),
        clientRule: expect.objectContaining({
          protocolFilter: 'trojan',
          sourceIds: ['source-hk-premium'],
          tagFilter: ['streaming'],
          regionFilter: ['hk'],
          outputFormats: ['clash', 'mihomo', 'uri'],
          trafficConstraint: {
            limitGb: 600,
            usedGb: 42,
            remainingDays: 90,
            ipLimit: 2,
            requestLimitPerHour: 120
          },
          access: expect.objectContaining({
            subId: 'acme_hk',
            tokenPreview: expect.stringMatching(/^ou_/),
            securePathPreview: expect.stringMatching(/^\/[A-Za-z0-9]{24}$/)
          })
        })
      }),
      'create'
    );
  });
});
