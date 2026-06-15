import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  ProxyProviderConfig,
  SubscriptionClientIdentity,
  SubscriptionExportFile,
  SubscriptionExportProfile,
  SubscriptionInventoryNode,
  SubscriptionSource
} from '../../domain';
import { SubscriptionMixerPage } from './subscription-mixer-page';

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(async (value: string) => `data:image/png;base64,${Buffer.from(value).toString('base64')}`)
  }
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

const GB = 1024 * 1024 * 1024;

const source: SubscriptionSource = {
  id: 'source-hk-premium',
  kind: 'mihomo-provider',
  name: '香港 Premium 源',
  url: 'https://provider.example.com/hk.yaml',
  providerAccountId: 'provider-account-hkg',
  status: 'synced',
  nodeCount: 2,
  dedupeKey: 'server-port',
  lastSyncAt: '2026-06-02T00:00:00.000Z',
  rateLimitPerMinute: 60,
  userAgent: 'clash-meta/2.4.0',
  refreshIntervalMinutes: 60,
  syncBudget: {
    maxFetchesPerDay: 12,
    maxBytesPerDay: 64 * 1024 * 1024,
    windowStartedAt: '2026-06-02T00:00:00.000Z',
    windowEndsAt: '2026-06-03T00:00:00.000Z',
    usedFetches: 3,
    usedBytes: 16 * 1024 * 1024,
    lastFetchBytes: 4 * 1024 * 1024,
    lastRecordedAt: '2026-06-02T00:01:00.000Z'
  },
  includeFilter: 'premium|streaming',
  excludeFilter: 'expired|test'
};

const backupSource: SubscriptionSource = {
  ...source,
  id: 'source-sg-backup',
  kind: 'clash',
  name: '新加坡 Backup 源',
  url: 'https://provider.example.com/sg-backup.yaml',
  providerAccountId: 'provider-account-sg',
  status: 'warning',
  nodeCount: 1,
  userAgent: 'OU-UI-Next/1.0',
  includeFilter: 'backup|Singapore|SG',
  excludeFilter: 'expired|trial'
};

const subscriptionClient: SubscriptionClientIdentity = {
  id: 'sub-client-acme-hkg',
  customerName: 'Acme Team',
  displayName: 'Acme 香港 Premium 订阅',
  subId: 'sub_acme_hkg_premium',
  email: 'acme@example.com',
  enabled: true,
  protocol: 'vless',
  group: 'premium',
  trafficLimitBytes: 1024 * 1024 * 1024 * 1024,
  usedTrafficBytes: 128 * 1024 * 1024 * 1024,
  expiresAt: '2026-12-31T23:59:59.000Z',
  ipLimit: 3,
  requestLimitPerHour: 360,
  sourceIds: ['source-hk-premium'],
  selectedTags: ['premium', 'streaming'],
  includeFilter: '香港|HK|Premium',
  excludeFilter: 'test|expired',
  regionFilter: ['hk'],
  routingRule: 'tag:premium AND !tag:test',
  maxLatencyMs: 200,
  sortStrategy: 'latency',
  formats: ['plain', 'clash', 'mihomo'],
  outputFormats: ['uri', 'clash', 'mihomo'],
  templateName: 'mihomo-compatible.yaml',
  accessTokenPreview: 'sub_acmehg...mium',
  securePathPreview: '/secure-acme-hkg',
  generatedNodeCount: 2,
  lastOnlineAt: '2026-06-02T00:00:00.000Z',
  lastGeneratedAt: '2026-06-02T00:00:00.000Z'
};

const backupSubscriptionClient: SubscriptionClientIdentity = {
  ...subscriptionClient,
  id: 'sub-client-backup-sg',
  customerName: 'Backup Team',
  displayName: 'Backup 新加坡 Standard 订阅',
  subId: 'sub_backup_sg_standard',
  email: 'backup@example.com',
  group: 'standard',
  selectedTags: ['standard', 'backup'],
  includeFilter: 'Singapore|SG',
  securePathPreview: '/secure-backup-sg',
  generatedNodeCount: 1
};

const riskySubscriptionClient: SubscriptionClientIdentity = {
  ...backupSubscriptionClient,
  id: 'sub-client-risky-sg',
  customerName: 'Risky Team',
  displayName: 'Risky 新加坡 Guardrail 订阅',
  subId: 'sub_risky_sg_guardrail',
  email: 'risky@example.com',
  protocol: 'vmess',
  trafficLimitBytes: 512 * GB,
  usedTrafficBytes: 512 * GB,
  expiresAt: '2020-01-01T00:00:00.000Z',
  sourceIds: [backupSource.id],
  selectedTags: ['backup', 'standard'],
  includeFilter: 'Singapore|SG|Backup',
  regionFilter: ['sg'],
  routingRule: 'tag:backup',
  formats: ['plain', 'mihomo'],
  outputFormats: ['uri', 'mihomo'],
  quotaExceeded: true,
  runtimeDisabledByPolicy: true,
  guardrailReason: 'subscription_user_quota_exceeded'
};

const inventoryNodes: SubscriptionInventoryNode[] = [
  {
    id: 'inventory-source-hk-premium-vless-01',
    sourceId: source.id,
    name: 'HK Premium VLESS 01',
    protocol: 'vless',
    server: '198.51.100.18',
    port: 443,
    latencyMs: 76,
    tags: ['region:hk', 'premium', 'streaming'],
    status: 'online',
    usedTrafficBytes: 128 * 1024 * 1024 * 1024,
    trafficLimitBytes: 1024 * 1024 * 1024 * 1024,
    rawUrl: 'vless://00000000-0000-4000-8000-000000000001@198.51.100.18:443#HK%20Premium%2001',
    inboundTag: 'source-hk-premium-vless-01'
  },
  {
    id: 'inventory-source-hk-premium-test-01',
    sourceId: source.id,
    name: 'HK Premium Test 01',
    protocol: 'vless',
    server: '198.51.100.19',
    port: 443,
    latencyMs: 88,
    tags: ['region:hk', 'premium', 'test'],
    status: 'online',
    rawUrl: 'vless://00000000-0000-4000-8000-000000000002@198.51.100.19:443#HK%20Premium%20Test'
  },
  {
    id: 'inventory-source-sg-backup-vmess-01',
    sourceId: backupSource.id,
    name: 'SG Backup VMess 01',
    protocol: 'vmess',
    server: '203.0.113.44',
    port: 443,
    latencyMs: 112,
    tags: ['region:sg', 'backup', 'standard'],
    status: 'warning',
    rawUrl: 'vmess://backup'
  }
];

function renderPage(overrides: Partial<Parameters<typeof SubscriptionMixerPage>[0]> = {}) {
  const props = {
    subscriptions: [],
    subscriptionSources: [source],
    subscriptionInventoryNodes: [],
    subscriptionClients: [],
    subscriptionExportProfiles: [],
    proxyProviders: [],
    subscriptionExportFiles: [],
    language: 'zh' as const,
    onImportSource: vi.fn(),
    onSyncSource: vi.fn(),
    onDeleteSource: vi.fn(),
    onSaveClient: vi.fn(),
    onDeleteClient: vi.fn(),
    onSaveExportProfile: vi.fn(),
    onDeleteExportProfile: vi.fn(),
    onGenerateExportFile: vi.fn(),
    ...overrides
  };

  render(<SubscriptionMixerPage {...props} />);

  return props;
}

describe('SubscriptionMixerPage', () => {
  it('renders a cockpit-style first screen with a left control rail and a right workspace', () => {
    renderPage({
      subscriptionSources: [source, backupSource],
      subscriptionInventoryNodes: inventoryNodes,
      subscriptionClients: [subscriptionClient, backupSubscriptionClient],
      subscriptionExportProfiles: [
        {
          id: 'profile-acme-mihomo',
          name: 'Acme Mihomo',
          client: 'mihomo',
          sourceIds: [source.id, backupSource.id],
          includeFilter: 'premium|streaming',
          excludeFilter: 'expired|test',
          regionFilter: ['hk', 'sg'],
          outputFormats: ['uri', 'clash', 'mihomo'],
          templateName: 'mihomo-compatible.yaml',
          proxyGroups: [
            {
              id: 'proxy-group-acme',
              name: 'Acme Premium',
              strategy: 'url-test',
              filterTags: ['premium', 'streaming']
            }
          ],
          includeTrafficHeaders: true,
          updatedAt: '2026-06-02T00:00:00.000Z'
        }
      ],
      subscriptionExportFiles: [
        {
          id: 'export-sub-client-acme-profile',
          subscriptionClientId: subscriptionClient.id,
          exportProfileId: 'profile-acme-mihomo',
          exportProfileName: 'Acme Mihomo',
          subId: subscriptionClient.subId,
          name: 'Acme 香港 Premium 订阅 - Acme Mihomo Export',
          templateName: 'mihomo-compatible.yaml',
          selectedTags: ['premium', 'streaming'],
          selectedProviderIds: ['provider-source-hk-premium', 'provider-source-sg-backup'],
          formats: ['plain', 'clash', 'mihomo'],
          accessTokenPreview: subscriptionClient.accessTokenPreview,
          trafficLimitBytes: subscriptionClient.trafficLimitBytes,
          expiresAt: subscriptionClient.expiresAt
        }
      ],
      proxyProviders: [
        {
          id: 'provider-source-hk-premium',
          name: '香港 Premium Provider',
          externalSubscriptionId: source.id,
          filter: 'premium|streaming',
          excludeFilter: 'expired|test',
          geoIpFilter: 'CN,HK,SG,JP,US,EU',
          processMode: 'server',
          overrideRule: 'source:source-hk-premium;dedupe:server-port'
        },
        {
          id: 'provider-source-sg-backup',
          name: '新加坡 Backup Provider',
          externalSubscriptionId: backupSource.id,
          filter: 'backup|standard',
          excludeFilter: 'expired|trial',
          geoIpFilter: 'SG,JP',
          processMode: 'client',
          overrideRule: 'source:source-sg-backup;dedupe:name'
        }
      ]
    });

    const cockpit = screen.getByRole('region', { name: '订阅控制 cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: '订阅控制 rail' });
    const workspace = within(cockpit).getByRole('region', { name: '订阅工作区' });

    expect(within(rail).getByText('订阅身份', { selector: 'p' })).toBeInTheDocument();
    expect(within(rail).getByText('节点库存', { selector: 'p' })).toBeInTheDocument();
    expect(within(rail).getByText('导出配置', { selector: 'p' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: '新增订阅身份' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: '导入订阅源' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: '订阅身份' })).toBeInTheDocument();

    expect(within(workspace).getByRole('region', { name: '订阅链接' })).toBeInTheDocument();
    expect(within(workspace).getByRole('region', { name: '订阅链路就绪' })).toBeInTheDocument();
    expect(within(workspace).getByRole('article', { name: 'Acme 香港 Premium 订阅' })).toBeInTheDocument();
  });

  it('uses the primary blue and signal orange control-plane palette in the subscription cockpit', () => {
    renderPage({
      subscriptionSources: [source, backupSource],
      subscriptionInventoryNodes: inventoryNodes,
      subscriptionClients: [subscriptionClient, backupSubscriptionClient],
      subscriptionExportProfiles: [
        {
          id: 'profile-acme-mihomo',
          name: 'Acme Mihomo',
          client: 'mihomo',
          sourceIds: [source.id, backupSource.id],
          includeFilter: 'premium|streaming',
          excludeFilter: 'expired|test',
          regionFilter: ['hk', 'sg'],
          outputFormats: ['uri', 'clash', 'mihomo'],
          templateName: 'mihomo-compatible.yaml',
          proxyGroups: [],
          includeTrafficHeaders: true,
          updatedAt: '2026-06-02T00:00:00.000Z'
        }
      ]
    });

    const cockpit = screen.getByRole('region', { name: '订阅控制 cockpit' });

    expect(cockpit.outerHTML).toContain('#1E3AFF');
    expect(cockpit.outerHTML).toContain('#DCE1FF');
    expect(cockpit.outerHTML).toContain('#FF3D18');
    expect(cockpit.outerHTML).toContain('#FFD8C6');
    expect(cockpit.outerHTML).not.toContain('sky-');
    expect(cockpit.outerHTML).not.toContain('indigo-');
    expect(cockpit.outerHTML).not.toContain('cyan-');
    expect(cockpit.outerHTML).not.toContain('purple-');
    expect(cockpit.outerHTML).not.toContain('violet-');
    expect(cockpit.outerHTML).not.toContain('amber-');
    expect(cockpit.outerHTML).not.toContain('rose-');
    expect(cockpit.outerHTML).not.toContain('background-clip:text');
  });

  it('uses a v2 subscription distribution cockpit visual system for publishable subscription operations', () => {
    renderPage({
      subscriptionSources: [source, backupSource],
      subscriptionInventoryNodes: inventoryNodes,
      subscriptionClients: [subscriptionClient, backupSubscriptionClient],
      subscriptionExportProfiles: [
        {
          id: 'profile-acme-mihomo',
          name: 'Acme Mihomo',
          client: 'mihomo',
          sourceIds: [source.id, backupSource.id],
          includeFilter: 'premium|streaming',
          excludeFilter: 'expired|test',
          regionFilter: ['hk', 'sg'],
          outputFormats: ['uri', 'clash', 'mihomo'],
          templateName: 'mihomo-compatible.yaml',
          proxyGroups: [],
          includeTrafficHeaders: true,
          updatedAt: '2026-06-02T00:00:00.000Z'
        }
      ],
      subscriptionExportFiles: [
        {
          id: 'export-sub-client-acme-profile',
          subscriptionClientId: subscriptionClient.id,
          exportProfileId: 'profile-acme-mihomo',
          exportProfileName: 'Acme Mihomo',
          subId: subscriptionClient.subId,
          name: 'Acme 香港 Premium 订阅 - Acme Mihomo Export',
          templateName: 'mihomo-compatible.yaml',
          selectedTags: ['premium', 'streaming'],
          selectedProviderIds: ['provider-source-hk-premium'],
          formats: ['plain', 'clash', 'mihomo'],
          accessTokenPreview: subscriptionClient.accessTokenPreview,
          trafficLimitBytes: subscriptionClient.trafficLimitBytes,
          expiresAt: subscriptionClient.expiresAt
        }
      ]
    });

    const cockpit = screen.getByRole('region', { name: '订阅控制 cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: '订阅控制 rail' });
    const workspace = within(cockpit).getByRole('region', { name: '订阅工作区' });
    const quickLinks = within(workspace).getByRole('region', { name: '订阅链接' });
    const readiness = within(workspace).getByRole('region', { name: '订阅链路就绪' });
    const clientRow = screen.getByText('Acme 香港 Premium 订阅').closest('tr');

    expect(cockpit).toHaveClass('subscription-ops-cockpit');
    expect(rail).toHaveClass('subscription-ops-rail');
    expect(workspace).toHaveClass('subscription-ops-workspace');
    expect(quickLinks).toHaveClass('subscription-ops-links-panel');
    expect(readiness).toHaveClass('subscription-ops-readiness-panel');
    expect(clientRow).toHaveClass('subscription-ops-client-row');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}${clientRow?.outerHTML ?? ''}`).toContain('#1E3AFF');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}${clientRow?.outerHTML ?? ''}`).toContain('#DCE1FF');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}${clientRow?.outerHTML ?? ''}`).toContain('#FF3D18');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}${clientRow?.outerHTML ?? ''}`).toContain('#FFD8C6');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}${clientRow?.outerHTML ?? ''}`).not.toContain('sky-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}${clientRow?.outerHTML ?? ''}`).not.toContain('indigo-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}${clientRow?.outerHTML ?? ''}`).not.toContain('cyan-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}${clientRow?.outerHTML ?? ''}`).not.toContain('purple-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}${clientRow?.outerHTML ?? ''}`).not.toContain('violet-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}${clientRow?.outerHTML ?? ''}`).not.toContain('amber-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}${clientRow?.outerHTML ?? ''}`).not.toContain('rose-');
    expect(`${cockpit.outerHTML}${rail.outerHTML}${workspace.outerHTML}${clientRow?.outerHTML ?? ''}`).not.toContain(
      'background-clip:text'
    );
  });

  it('keeps the subscription distribution cockpit compact without masonry or oversized cards', () => {
    renderPage({
      subscriptionSources: [source, backupSource],
      subscriptionInventoryNodes: inventoryNodes,
      subscriptionClients: [subscriptionClient, backupSubscriptionClient],
      subscriptionExportProfiles: [
        {
          id: 'profile-acme-mihomo',
          name: 'Acme Mihomo',
          client: 'mihomo',
          sourceIds: [source.id, backupSource.id],
          includeFilter: 'premium|streaming',
          excludeFilter: 'expired|test',
          regionFilter: ['hk', 'sg'],
          outputFormats: ['uri', 'clash', 'mihomo'],
          templateName: 'mihomo-compatible.yaml',
          proxyGroups: [],
          includeTrafficHeaders: true,
          updatedAt: '2026-06-02T00:00:00.000Z'
        }
      ],
      subscriptionExportFiles: [
        {
          id: 'export-sub-client-acme-profile',
          subscriptionClientId: subscriptionClient.id,
          exportProfileId: 'profile-acme-mihomo',
          exportProfileName: 'Acme Mihomo',
          subId: subscriptionClient.subId,
          name: 'Acme 香港 Premium 订阅 - Acme Mihomo Export',
          templateName: 'mihomo-compatible.yaml',
          selectedTags: ['premium', 'streaming'],
          selectedProviderIds: ['provider-source-hk-premium'],
          formats: ['plain', 'clash', 'mihomo'],
          accessTokenPreview: subscriptionClient.accessTokenPreview,
          trafficLimitBytes: subscriptionClient.trafficLimitBytes,
          expiresAt: subscriptionClient.expiresAt
        }
      ]
    });

    const cockpit = screen.getByRole('region', { name: '订阅控制 cockpit' });
    const cockpitGrid = cockpit.querySelector('.subscription-cockpit-grid');
    const rail = within(cockpit).getByRole('complementary', { name: '订阅控制 rail' });
    const workspace = within(cockpit).getByRole('region', { name: '订阅工作区' });
    const quickLinks = within(workspace).getByRole('region', { name: '订阅链接' });
    const quickLinkCard = within(quickLinks).getByRole('article', { name: 'Acme 香港 Premium 订阅' });
    const readiness = within(workspace).getByRole('region', { name: '订阅链路就绪' });
    const overviewPanel = workspace.querySelector('.subscription-overview-panel');
    const gates = within(rail).getByRole('region', { name: '订阅分发门禁' });
    const sourceGate = within(gates).getByRole('group', { name: '来源同步' });

    expect(cockpitGrid).not.toBeNull();
    expect(cockpitGrid as HTMLElement).toHaveClass('subscription-cockpit-grid', 'xl:grid-cols-[18rem_minmax(0,1fr)]');
    expect(rail).toHaveClass('p-3');
    expect(rail).not.toHaveClass('p-4');
    expect(workspace.firstElementChild).toHaveClass('space-y-3', 'p-3');
    expect(overviewPanel).not.toBeNull();
    expect(overviewPanel as HTMLElement).toHaveClass('subscription-overview-panel', 'p-3');
    expect(overviewPanel as HTMLElement).not.toHaveClass('p-4', 'rounded-xl');
    expect(quickLinks).toHaveClass('gap-3');
    expect(quickLinks).not.toHaveClass('gap-4');
    expect(quickLinkCard).toHaveClass('subscription-quick-link-card', 'p-3');
    expect(quickLinkCard).not.toHaveClass('p-5');
    expect(readiness).toHaveClass('p-3');
    expect(readiness).not.toHaveClass('rounded-xl', 'p-4');
    expect(sourceGate).toHaveClass('subscription-distribution-gate-row', 'min-h-[76px]', 'px-3', 'py-2.5');
    expect(sourceGate).not.toHaveClass('min-h-20', 'px-4', 'py-3');

    const layoutHtml = `${cockpit.outerHTML}${quickLinks.outerHTML}${readiness.outerHTML}`;
    expect(layoutHtml).not.toContain('masonry');
    expect(layoutHtml).not.toContain('columns-');
    expect(layoutHtml).not.toContain('grid-flow-row-dense');
    expect(layoutHtml).not.toContain('row-span');
    expect(layoutHtml).not.toContain('col-span');
  });

  it('keeps every subscription distribution data table dense across workspaces', async () => {
    const user = userEvent.setup();
    renderPage({
      subscriptionSources: [source, backupSource],
      subscriptionInventoryNodes: inventoryNodes,
      subscriptionClients: [subscriptionClient, backupSubscriptionClient],
      subscriptionExportProfiles: [
        {
          id: 'profile-acme-mihomo',
          name: 'Acme Mihomo',
          client: 'mihomo',
          sourceIds: [source.id, backupSource.id],
          includeFilter: 'premium|streaming',
          excludeFilter: 'expired|test',
          regionFilter: ['hk', 'sg'],
          outputFormats: ['uri', 'clash', 'mihomo'],
          templateName: 'mihomo-compatible.yaml',
          proxyGroups: [
            {
              id: 'proxy-group-acme',
              name: 'Acme Premium',
              strategy: 'url-test',
              filterTags: ['premium', 'streaming']
            }
          ],
          includeTrafficHeaders: true,
          updatedAt: '2026-06-02T00:00:00.000Z'
        }
      ],
      subscriptionExportFiles: [
        {
          id: 'export-sub-client-acme-profile',
          subscriptionClientId: subscriptionClient.id,
          exportProfileId: 'profile-acme-mihomo',
          exportProfileName: 'Acme Mihomo',
          subId: subscriptionClient.subId,
          name: 'Acme 香港 Premium 订阅 - Acme Mihomo Export',
          templateName: 'mihomo-compatible.yaml',
          selectedTags: ['premium', 'streaming'],
          selectedProviderIds: ['provider-source-hk-premium'],
          formats: ['plain', 'clash', 'mihomo'],
          accessTokenPreview: subscriptionClient.accessTokenPreview,
          trafficLimitBytes: subscriptionClient.trafficLimitBytes,
          expiresAt: subscriptionClient.expiresAt
        }
      ],
      proxyProviders: [
        {
          id: 'provider-source-hk-premium',
          name: '香港 Premium Provider',
          externalSubscriptionId: source.id,
          filter: 'premium|streaming',
          excludeFilter: 'expired|test',
          geoIpFilter: 'CN,HK,SG,JP,US,EU',
          processMode: 'server',
          overrideRule: 'source:source-hk-premium;dedupe:server-port'
        }
      ]
    });

    async function expectDenseTable(workspaceButton: string, tableName: string, rowText: string, rowClass: string) {
      await user.click(screen.getByRole('button', { name: workspaceButton }));
      const tableRegion = screen.getByRole('region', { name: tableName });
      const row = within(tableRegion).getByText(rowText).closest('tr');

      expect(tableRegion.outerHTML).toContain('px-3');
      expect(tableRegion.outerHTML).toContain('py-2.5');
      expect(tableRegion.outerHTML).not.toContain('px-5 py-4');
      expect(tableRegion.outerHTML).not.toContain('px-5 py-3');
      expect(row).not.toBeNull();
      expect(row).toHaveClass(rowClass, 'transition-colors');
      expect(row).not.toHaveClass('px-5', 'py-4');
    }

    await expectDenseTable('外部订阅源', '外部订阅源 数据表', '香港 Premium 源', 'subscription-ops-source-row');
    await expectDenseTable('节点库存', '节点库存 数据表', 'HK Premium VLESS 01', 'subscription-ops-inventory-row');
    await expectDenseTable('代理集合', '代理集合 数据表', '香港 Premium Provider', 'subscription-ops-provider-row');
    await expectDenseTable('导出配置', '导出配置 数据表', 'Acme Mihomo', 'subscription-ops-profile-row');
    await expectDenseTable('导出文件', '导出文件 数据表', 'Acme 香港 Premium 订阅 - Acme Mihomo Export', 'subscription-ops-export-row');
  });

  it('does not pad the subscription workspace with explanatory lineage or workflow filler', () => {
    renderPage({
      subscriptionSources: [source, backupSource],
      subscriptionInventoryNodes: inventoryNodes,
      subscriptionClients: [subscriptionClient, backupSubscriptionClient],
      subscriptionExportProfiles: [
        {
          id: 'profile-acme-mihomo',
          name: 'Acme Mihomo',
          client: 'mihomo',
          sourceIds: [source.id, backupSource.id],
          includeFilter: 'premium|streaming',
          excludeFilter: 'expired|test',
          regionFilter: ['hk', 'sg'],
          outputFormats: ['uri', 'clash', 'mihomo'],
          templateName: 'mihomo-compatible.yaml',
          proxyGroups: [],
          includeTrafficHeaders: true,
          updatedAt: '2026-06-02T00:00:00.000Z'
        }
      ]
    });

    const cockpit = screen.getByRole('region', { name: '订阅控制 cockpit' });
    const pageHtml = cockpit.parentElement?.outerHTML ?? cockpit.outerHTML;

    expect(screen.getByRole('heading', { name: '订阅管理' })).toBeInTheDocument();
    expect(pageHtml).not.toContain('3X-UI');
    expect(pageHtml).not.toContain('miaomiaowu');
    expect(pageHtml).not.toContain('先看订阅规模');
    expect(pageHtml).not.toContain('导入节点源');
    expect(pageHtml).not.toContain('绑定订阅身份');
    expect(pageHtml).not.toContain('选择客户端格式');
    expect(pageHtml).not.toContain('复制导出链接');
    expect(pageHtml).not.toContain('审阅订阅规模');
    expect(pageHtml).not.toContain('核对库存覆盖');
    expect(pageHtml).not.toContain('确认导出配置');
    expect(pageHtml).not.toContain('检查发布链路');
    expect(pageHtml).not.toContain('订阅身份以 subId 为入口');
    expect(pageHtml).not.toContain('端到端检查');
    expect(pageHtml).not.toContain('发布前核对');
    expect(pageHtml).not.toContain('避免把不可用订阅交给客户');
  });

  it('surfaces subscription distribution gates on the control rail', () => {
    renderPage({
      subscriptionSources: [
        source,
        {
          ...backupSource,
          status: 'warning',
          syncWarnings: ['subscription_source.cross_source_duplicates:2']
        }
      ],
      subscriptionInventoryNodes: inventoryNodes,
      subscriptionClients: [subscriptionClient, riskySubscriptionClient],
      proxyProviders: [
        {
          id: 'provider-source-hk-premium',
          name: '香港 Premium Provider',
          externalSubscriptionId: source.id,
          filter: 'premium|streaming',
          excludeFilter: 'expired|test',
          geoIpFilter: 'CN,HK,SG,JP,US,EU',
          processMode: 'server',
          overrideRule: 'source:source-hk-premium;dedupe:server-port'
        }
      ],
      subscriptionExportFiles: [
        {
          id: 'export-sub-client-acme-profile',
          subscriptionClientId: subscriptionClient.id,
          exportProfileId: 'profile-acme-mihomo',
          exportProfileName: 'Acme Mihomo',
          subId: subscriptionClient.subId,
          name: 'Acme 香港 Premium 订阅 - Acme Mihomo Export',
          templateName: 'mihomo-compatible.yaml',
          selectedTags: ['premium', 'streaming'],
          selectedProviderIds: ['provider-source-hk-premium'],
          formats: ['plain', 'clash', 'mihomo'],
          accessTokenPreview: subscriptionClient.accessTokenPreview,
          trafficLimitBytes: subscriptionClient.trafficLimitBytes,
          expiresAt: subscriptionClient.expiresAt
        }
      ]
    });

    const cockpit = screen.getByRole('region', { name: '订阅控制 cockpit' });
    const rail = within(cockpit).getByRole('complementary', { name: '订阅控制 rail' });
    const gates = within(rail).getByRole('region', { name: '订阅分发门禁' });

    expect(within(gates).getByRole('group', { name: '来源同步' })).toHaveTextContent('异常');
    expect(within(gates).getByRole('group', { name: '库存命中' })).toHaveTextContent('就绪');
    expect(within(gates).getByRole('group', { name: '导出产物' })).toHaveTextContent('就绪');
    expect(within(gates).getByRole('group', { name: '订阅入口' })).toHaveTextContent('异常');
  });

  it('keeps subscription operation drawers on explicit OU action colors instead of default template utilities', async () => {
    const user = userEvent.setup();
    renderPage({
      subscriptionSources: [source, backupSource],
      subscriptionInventoryNodes: inventoryNodes,
      subscriptionClients: [subscriptionClient],
      subscriptionExportFiles: [
        {
          id: 'export-sub-client-acme-profile',
          subscriptionClientId: subscriptionClient.id,
          exportProfileId: 'profile-acme-mihomo',
          exportProfileName: 'Acme Mihomo',
          subId: subscriptionClient.subId,
          name: 'Acme 香港 Premium 订阅 - Acme Mihomo Export',
          templateName: 'mihomo-compatible.yaml',
          selectedTags: ['premium', 'streaming'],
          selectedProviderIds: ['provider-source-hk-premium'],
          formats: ['plain', 'clash', 'mihomo'],
          accessTokenPreview: subscriptionClient.accessTokenPreview,
          trafficLimitBytes: subscriptionClient.trafficLimitBytes,
          expiresAt: subscriptionClient.expiresAt
        }
      ]
    });

    const acmeRow = screen.getByText('Acme 香港 Premium 订阅').closest('tr');
    expect(acmeRow).not.toBeNull();

    await user.click(within(acmeRow as HTMLElement).getByRole('button', { name: '查看订阅链接' }));
    const linksDrawer = screen.getByLabelText('Acme 香港 Premium 订阅 订阅链接');

    const linksDrawerActions = Array.from(linksDrawer.querySelectorAll('button')).map((button) => button.outerHTML).join('');

    expect(linksDrawerActions).toContain('#1E3AFF');
    expect(linksDrawerActions).toContain('#07111F');
    expect(linksDrawerActions).not.toMatch(/\b(?:border|bg|text|ring)-(?:blue|orange|red|slate|emerald)-/u);
    expect(linksDrawer.outerHTML).not.toContain('sky-');
    expect(linksDrawer.outerHTML).not.toContain('indigo-');
    expect(linksDrawer.outerHTML).not.toContain('cyan-');
    expect(linksDrawer.outerHTML).not.toContain('purple-');
    expect(linksDrawer.outerHTML).not.toContain('violet-');
    expect(linksDrawer.outerHTML).not.toContain('amber-');
    expect(linksDrawer.outerHTML).not.toContain('rose-');
    expect(linksDrawer.outerHTML).not.toContain('background-clip:text');

    await user.click(within(linksDrawer).getByRole('button', { name: 'Close' }));
    expect(screen.queryByLabelText('Acme 香港 Premium 订阅 订阅链接')).not.toBeInTheDocument();
    await user.click(within(acmeRow as HTMLElement).getByRole('button', { name: '查看命中节点' }));
    const nodesDrawer = screen.getByLabelText('Acme 香港 Premium 订阅 命中节点');
    const nodesDrawerActions = Array.from(nodesDrawer.querySelectorAll('button')).map((button) => button.outerHTML).join('');

    expect(nodesDrawerActions).toContain('#1E3AFF');
    expect(nodesDrawerActions).toContain('#07111F');
    expect(nodesDrawerActions).not.toMatch(/\b(?:border|bg|text|ring)-(?:blue|orange|red|slate|emerald)-/u);
    expect(nodesDrawer.outerHTML).not.toContain('sky-');
    expect(nodesDrawer.outerHTML).not.toContain('indigo-');
    expect(nodesDrawer.outerHTML).not.toContain('cyan-');
    expect(nodesDrawer.outerHTML).not.toContain('purple-');
    expect(nodesDrawer.outerHTML).not.toContain('violet-');
    expect(nodesDrawer.outerHTML).not.toContain('amber-');
    expect(nodesDrawer.outerHTML).not.toContain('rose-');
    expect(nodesDrawer.outerHTML).not.toContain('background-clip:text');
  });

  it('shows copyable subscription links and QR codes on the first screen', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });

    renderPage({ subscriptionClients: [subscriptionClient] });

    const quickLinks = screen.getByRole('region', { name: '订阅链接' });
    const card = within(quickLinks).getByRole('article', { name: 'Acme 香港 Premium 订阅' });

    expect(within(card).getByText(/\/sub\/secure-acme-hkg\/uri\/sub_acme_hkg_premium$/)).toBeInTheDocument();
    expect(within(card).getByText('Acme Team')).toBeInTheDocument();
    expect(within(card).getByText('2 个节点')).toBeInTheDocument();
    expect(await within(card).findByRole('img', { name: 'Acme 香港 Premium 订阅 订阅二维码' })).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: '复制订阅链接 Acme 香港 Premium 订阅' }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/\/sub\/secure-acme-hkg\/uri\/sub_acme_hkg_premium$/)
    );
  });

  it('summarizes end-to-end subscription pipeline readiness on the first screen', () => {
    const acmeProvider: ProxyProviderConfig = {
      id: 'provider-source-hk-premium',
      name: '香港 Premium Provider',
      externalSubscriptionId: source.id,
      filter: 'premium|streaming',
      excludeFilter: 'expired|test',
      geoIpFilter: 'CN,HK,SG,JP,US,EU',
      processMode: 'server',
      overrideRule: 'source:source-hk-premium;dedupe:server-port'
    };
    const backupProvider: ProxyProviderConfig = {
      id: 'provider-source-sg-backup',
      name: '新加坡 Backup Provider',
      externalSubscriptionId: backupSource.id,
      filter: 'backup|standard',
      excludeFilter: 'expired|trial',
      geoIpFilter: 'SG,JP',
      processMode: 'client',
      overrideRule: 'source:source-sg-backup;dedupe:name'
    };
    const exportFile: SubscriptionExportFile = {
      id: 'export-sub-client-acme-profile',
      subscriptionClientId: subscriptionClient.id,
      exportProfileId: 'profile-acme-mihomo',
      exportProfileName: 'Acme Mihomo',
      subId: subscriptionClient.subId,
      name: 'Acme 香港 Premium 订阅 - Acme Mihomo Export',
      templateName: 'mihomo-compatible.yaml',
      selectedTags: ['premium', 'streaming'],
      selectedProviderIds: [acmeProvider.id, backupProvider.id],
      formats: ['plain', 'clash', 'mihomo'],
      trafficLimitBytes: subscriptionClient.trafficLimitBytes,
      expiresAt: subscriptionClient.expiresAt,
      accessTokenPreview: subscriptionClient.accessTokenPreview
    };
    renderPage({
      subscriptionSources: [source, backupSource],
      subscriptionInventoryNodes: inventoryNodes,
      subscriptionClients: [subscriptionClient],
      proxyProviders: [acmeProvider, backupProvider],
      subscriptionExportFiles: [exportFile]
    });

    const readiness = screen.getByRole('region', { name: '订阅链路就绪' });
    const expectMetric = (label: string, value: string) => {
      const metric = within(readiness).getByText(label).closest('div');

      expect(metric).not.toBeNull();
      expect(within(metric as HTMLElement).getByText(value)).toBeInTheDocument();
    };

    expectMetric('链路完整度', '5 / 5');
    expectMetric('可发布导出', '1');
    expectMetric('可用节点', '2');
    expectMetric('异常来源', '1');
    expect(within(readiness).getByText('来源 2 · 库存 2 · 代理集合 2 · 导出 1 · 身份 1')).toBeInTheDocument();
    expect(within(readiness).getByText('Acme 香港 Premium 订阅 - Acme Mihomo Export · URI / Clash / Mihomo')).toBeInTheDocument();
  });

  it('frames subscription pipeline readiness and bulk impact preflight as a blue control surface with orange risk cues', async () => {
    const user = userEvent.setup();
    const warningSource: SubscriptionSource = {
      ...backupSource,
      status: 'warning',
      syncWarnings: ['subscription_source.cross_source_duplicates:2']
    };

    renderPage({
      subscriptionSources: [source, warningSource],
      subscriptionInventoryNodes: inventoryNodes,
      subscriptionClients: [subscriptionClient, riskySubscriptionClient],
      proxyProviders: [
        {
          id: 'provider-source-hk-premium',
          name: '香港 Premium Provider',
          externalSubscriptionId: source.id,
          filter: 'premium|streaming',
          excludeFilter: 'expired|test',
          geoIpFilter: 'CN,HK,SG,JP,US,EU',
          processMode: 'server',
          overrideRule: 'source:source-hk-premium;dedupe:server-port'
        },
        {
          id: 'provider-source-sg-backup',
          name: '新加坡 Backup Provider',
          externalSubscriptionId: warningSource.id,
          filter: 'backup|standard',
          excludeFilter: 'expired|trial',
          geoIpFilter: 'SG,JP',
          processMode: 'client',
          overrideRule: 'source:source-sg-backup;dedupe:name'
        }
      ],
      subscriptionExportFiles: [
        {
          id: 'export-sub-client-acme-profile',
          subscriptionClientId: subscriptionClient.id,
          exportProfileId: 'profile-acme-mihomo',
          exportProfileName: 'Acme Mihomo',
          subId: subscriptionClient.subId,
          name: 'Acme 香港 Premium 订阅 - Acme Mihomo Export',
          templateName: 'mihomo-compatible.yaml',
          selectedTags: ['premium', 'streaming'],
          selectedProviderIds: ['provider-source-hk-premium'],
          formats: ['plain', 'clash', 'mihomo'],
          trafficLimitBytes: subscriptionClient.trafficLimitBytes,
          expiresAt: subscriptionClient.expiresAt,
          accessTokenPreview: subscriptionClient.accessTokenPreview
        }
      ]
    });

    const readiness = screen.getByRole('region', { name: '订阅链路就绪' });
    expect(readiness).toHaveClass('border-[#1E3AFF]/35', 'bg-[#DCE1FF]/45');
    const readinessMetricGrid = readiness.querySelector('.subscription-pipeline-readiness-metric-grid');
    expect(readinessMetricGrid).toHaveClass('xl:w-[26rem]');
    expect(readinessMetricGrid).not.toHaveClass('xl:w-[30rem]', 'xl:w-[34rem]');
    expect(within(readiness).getByText('订阅链路就绪')).toHaveClass('text-[#1E3AFF]', 'dark:text-[#9EACFF]');
    expect(within(readiness).getByText('Acme 香港 Premium 订阅 - Acme Mihomo Export · URI / Clash / Mihomo')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '订阅身份' }));
    await user.click(screen.getByRole('checkbox', { name: '选择 Acme 香港 Premium 订阅' }));
    await user.click(screen.getByRole('checkbox', { name: '选择 Risky 新加坡 Guardrail 订阅' }));

    const preflight = screen.getByRole('region', { name: '批量影响预检' });
    expect(preflight).toHaveClass('border-[#FF3D18]/45', 'bg-[#FFD8C6]/45');
    const preflightMetricGrid = preflight.querySelector('.subscription-bulk-impact-metric-grid');
    expect(preflightMetricGrid).toHaveClass('xl:w-[26rem]');
    expect(preflightMetricGrid).not.toHaveClass('xl:w-[30rem]', 'xl:w-[34rem]');
    expect(within(preflight).getByText('批量影响预检')).toHaveClass('text-[#C92810]', 'dark:text-[#FFB299]');
    expect(within(preflight).getByText('受影响客户 2')).toBeInTheDocument();
    expect(within(preflight).getByText('守护风险 1')).toBeInTheDocument();

    const riskPreview = within(preflight).getByText('风险提示').closest('div');
    expect(riskPreview).not.toBeNull();
    const riskItems = within(riskPreview as HTMLElement).getByText(/subscription_user_quota_exceeded/).closest('div');
    expect(riskItems).not.toBeNull();
    expect(riskItems).toHaveClass('mt-2', 'space-y-1', 'text-[#C92810]', 'dark:text-[#FFB299]');
  });

  it('makes dense subscription tables keyboard-scrollable and exposes visible focus states on bulk actions', () => {
    renderPage({
      subscriptionSources: [source, backupSource],
      subscriptionInventoryNodes: inventoryNodes,
      subscriptionClients: [subscriptionClient, backupSubscriptionClient]
    });

    const clientTableRegion = screen.getByRole('region', { name: '订阅身份 数据表' });
    expect(clientTableRegion).toHaveAttribute('tabindex', '0');
    expect(clientTableRegion).toHaveClass('subscription-data-table-region', 'overflow-x-auto', 'focus-visible:ring-2');
    expect(within(clientTableRegion).queryByText('表格可横向滚动，键盘聚焦后可用方向键或触控板查看隐藏列。')).not.toBeInTheDocument();
    const clientTable = within(clientTableRegion).getByRole('table');
    expect(clientTable).toHaveClass('subscription-data-table');
    expect(clientTable).toHaveStyle({ minWidth: '920px' });

    expect(screen.getByRole('button', { name: '批量复制订阅链接' })).toHaveClass('focus-visible:ring-2');
    expect(screen.getByRole('button', { name: '批量复制全部格式链接' })).toHaveClass('focus-visible:ring-2');
    expect(screen.getByRole('button', { name: '批量删除' })).toHaveClass('focus-visible:ring-2');
  });

  it('shows an empty inventory until real synchronized subscription nodes exist', async () => {
    const user = userEvent.setup();
    renderPage({ language: 'en' });

    await user.click(screen.getByRole('button', { name: 'Node Inventory' }));

    const emptyState = screen.getByText('No inventory nodes yet').closest('.subscription-empty-state');
    expect(emptyState).toHaveClass('p-3');
    expect(emptyState).not.toHaveClass('p-8', 'p-6', 'p-5');
    expect(screen.queryByText(/203\.0\./)).not.toBeInTheDocument();
  });

  it('renders only real synchronized subscription inventory nodes', async () => {
    const user = userEvent.setup();
    renderPage({ language: 'en', subscriptionInventoryNodes: [inventoryNodes[0]] });

    await user.click(screen.getByRole('button', { name: 'Node Inventory' }));

    expect(screen.getByText('HK Premium VLESS 01')).toBeInTheDocument();
    expect(screen.getByText('198.51.100.18:443')).toBeInTheDocument();
    expect(screen.queryByText(/203\.0\./)).not.toBeInTheDocument();
  });

  it('filters inventory nodes by source, protocol, region, tag, and search text', async () => {
    const user = userEvent.setup();
    renderPage({
      language: 'en',
      subscriptionSources: [source, backupSource],
      subscriptionInventoryNodes: inventoryNodes
    });

    await user.click(screen.getByRole('button', { name: 'Node Inventory' }));

    await user.selectOptions(screen.getByLabelText('Inventory Source'), backupSource.id);
    await user.selectOptions(screen.getByLabelText('Inventory Protocol'), 'vmess');
    await user.type(screen.getByRole('textbox', { name: 'Inventory Region' }), 'sg');
    await user.type(screen.getByRole('textbox', { name: 'Inventory Tags' }), 'backup');
    await user.type(screen.getByRole('searchbox', { name: 'Search Inventory Nodes' }), '203.0.113.44');

    expect(screen.getByText('SG Backup VMess 01')).toBeInTheDocument();
    expect(screen.queryByText('HK Premium VLESS 01')).not.toBeInTheDocument();
    expect(screen.queryByText('HK Premium Test 01')).not.toBeInTheDocument();
    expect(screen.getByText('Matching 1 / 2')).toBeInTheDocument();
  });

  it('uses a selected subscription identity as a live rule lens over inventory nodes', async () => {
    const user = userEvent.setup();
    renderPage({
      language: 'en',
      subscriptionSources: [source, backupSource],
      subscriptionInventoryNodes: inventoryNodes,
      subscriptionClients: [subscriptionClient, backupSubscriptionClient]
    });

    await user.click(screen.getByRole('button', { name: 'Node Inventory' }));
    await user.selectOptions(screen.getByLabelText('Inventory Client Rule'), subscriptionClient.id);

    expect(screen.getByText('HK Premium VLESS 01')).toBeInTheDocument();
    expect(screen.queryByText('HK Premium Test 01')).not.toBeInTheDocument();
    expect(screen.queryByText('SG Backup VMess 01')).not.toBeInTheDocument();
    expect(screen.getAllByText('Acme 香港 Premium 订阅').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Matching 1 / 2')).toBeInTheDocument();
  });

  it('bulk copies selected inventory node links from the client-filtered inventory table', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderPage({
      language: 'en',
      subscriptionSources: [source, backupSource],
      subscriptionInventoryNodes: inventoryNodes,
      subscriptionClients: [subscriptionClient, backupSubscriptionClient]
    });

    await user.click(screen.getByRole('button', { name: 'Node Inventory' }));
    await user.selectOptions(screen.getByLabelText('Inventory Client Rule'), subscriptionClient.id);
    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Inventory Nodes' }));
    await user.click(screen.getByRole('button', { name: 'Bulk Copy Node Links' }));

    expect(writeText).toHaveBeenCalledWith(inventoryNodes[0].rawUrl);
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('HK%20Premium%20Test'));
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('vmess://backup'));
  });

  it('shows a bulk impact preflight for selected subscription identities before risky actions', async () => {
    const user = userEvent.setup();
    renderPage({
      subscriptionSources: [source, backupSource],
      subscriptionInventoryNodes: inventoryNodes,
      subscriptionClients: [subscriptionClient, riskySubscriptionClient]
    });

    await user.click(screen.getByRole('checkbox', { name: '选择 Acme 香港 Premium 订阅' }));
    await user.click(screen.getByRole('checkbox', { name: '选择 Risky 新加坡 Guardrail 订阅' }));

    const preflight = screen.getByRole('region', { name: '批量影响预检' });
    const metricGrid = preflight.querySelector('.subscription-bulk-impact-metric-grid');
    expect(metricGrid).toHaveClass('xl:w-[26rem]');
    expect(metricGrid).not.toHaveClass('xl:w-[30rem]', 'xl:w-[34rem]');
    expect(within(preflight).getByText('受影响客户 2')).toBeInTheDocument();
    expect(within(preflight).getByText('命中节点 2')).toBeInTheDocument();
    expect(within(preflight).getByText('覆盖来源 2')).toBeInTheDocument();
    expect(within(preflight).getByText('守护风险 1')).toBeInTheDocument();
    expect(within(preflight).getByText('已过期/即将到期 1')).toBeInTheDocument();
    const customerPreview = within(preflight).getByText('客户预览').closest('div');
    const nodePreview = within(preflight).getByText('节点预览').closest('div');
    const riskPreview = within(preflight).getByText('风险提示').closest('div');
    expect(customerPreview).not.toBeNull();
    expect(nodePreview).not.toBeNull();
    expect(riskPreview).not.toBeNull();
    expect(within(customerPreview as HTMLElement).getByText('Acme Team')).toBeInTheDocument();
    expect(within(customerPreview as HTMLElement).getByText('Risky Team')).toBeInTheDocument();
    expect(within(nodePreview as HTMLElement).getByText('HK Premium VLESS 01')).toBeInTheDocument();
    expect(within(nodePreview as HTMLElement).getByText('SG Backup VMess 01')).toBeInTheDocument();
    expect(within(riskPreview as HTMLElement).getByText(/subscription_user_quota_exceeded/)).toBeInTheDocument();
    expect(preflight.outerHTML).toContain('#FF3D18');
    expect(preflight.outerHTML).toContain('#FFD8C6');
    expect(preflight.outerHTML).not.toContain('amber-');
    expect(preflight.outerHTML).not.toContain('rose-');
    expect(preflight.outerHTML).not.toContain('masonry');
    expect(preflight.outerHTML).not.toContain('columns-');
    expect(preflight.outerHTML).not.toContain('grid-flow-row-dense');
    expect(preflight.outerHTML).not.toContain('row-span');
  });

  it('keeps subscription preflights operational without explanatory filler paragraphs', async () => {
    const user = userEvent.setup();
    const acmeProvider: ProxyProviderConfig = {
      id: 'provider-source-hk-premium',
      name: '香港 Premium Provider',
      externalSubscriptionId: source.id,
      filter: 'premium|streaming',
      excludeFilter: 'expired|test',
      geoIpFilter: 'CN,HK,SG,JP,US,EU',
      processMode: 'server',
      overrideRule: 'source:source-hk-premium;dedupe:server-port'
    };
    const acmeExportFile: SubscriptionExportFile = {
      id: 'export-sub-client-acme-profile',
      subscriptionClientId: subscriptionClient.id,
      exportProfileId: 'profile-acme-mihomo',
      exportProfileName: 'Acme Mihomo',
      subId: subscriptionClient.subId,
      name: 'Acme 香港 Premium 订阅 - Acme Mihomo Export',
      templateName: 'mihomo-compatible.yaml',
      selectedTags: ['premium', 'streaming'],
      selectedProviderIds: [acmeProvider.id],
      formats: ['mihomo', 'clash'],
      trafficLimitBytes: subscriptionClient.trafficLimitBytes,
      expiresAt: subscriptionClient.expiresAt,
      accessTokenPreview: subscriptionClient.accessTokenPreview
    };

    renderPage({
      subscriptionSources: [source],
      subscriptionInventoryNodes: inventoryNodes,
      subscriptionClients: [subscriptionClient],
      proxyProviders: [acmeProvider],
      subscriptionExportFiles: [acmeExportFile]
    });

    await user.click(screen.getByRole('checkbox', { name: '选择 Acme 香港 Premium 订阅' }));
    const clientPreflight = screen.getByRole('region', { name: '批量影响预检' });
    expect(within(clientPreflight).getByText('受影响客户 1')).toBeInTheDocument();
    expect(within(clientPreflight).getByText('客户预览')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批量启用' })).toBeInTheDocument();
    expect(clientPreflight).not.toHaveTextContent('基于当前订阅规则');
    expect(clientPreflight).not.toHaveTextContent('执行前请核对');

    await user.click(screen.getByRole('button', { name: '外部订阅源' }));
    await user.click(screen.getByRole('checkbox', { name: '选择当前订阅源' }));
    const sourcePreflight = screen.getByRole('region', { name: '订阅源影响预检' });
    expect(within(sourcePreflight).getByText('已选订阅源 1')).toBeInTheDocument();
    expect(within(sourcePreflight).getByText('来源预览')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批量同步' })).toBeInTheDocument();
    expect(sourcePreflight).not.toHaveTextContent('批量同步会触发');
    expect(sourcePreflight).not.toHaveTextContent('执行前请核对');

    await user.click(screen.getByRole('button', { name: '代理集合' }));
    await user.click(screen.getByRole('checkbox', { name: '选择当前代理集合' }));
    const providerPreflight = screen.getByRole('region', { name: '代理集合生成影响预检' });
    expect(within(providerPreflight).getByText('代理集合 1')).toBeInTheDocument();
    expect(within(providerPreflight).getByText('代理集合预览')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批量生成关联导出' })).toBeInTheDocument();
    expect(providerPreflight).not.toHaveTextContent('批量生成关联导出会刷新');
    expect(providerPreflight).not.toHaveTextContent('执行前请核对');

    await user.click(screen.getByRole('button', { name: '导出文件' }));
    await user.click(screen.getByRole('checkbox', { name: '选择当前导出文件' }));
    const exportPreflight = screen.getByRole('region', { name: '生成影响预检' });
    expect(within(exportPreflight).getByText('导出文件 1')).toBeInTheDocument();
    expect(within(exportPreflight).getByText('导出预览')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批量生成' })).toBeInTheDocument();
    expect(exportPreflight).not.toHaveTextContent('批量生成会刷新');
    expect(exportPreflight).not.toHaveTextContent('执行前请核对');
  });

  it('submits external subscription source sync policy and miaomiaowu-style source rules', async () => {
    const user = userEvent.setup({ delay: null });
    const onImportSource = vi.fn();
    renderPage({ subscriptionSources: [], onImportSource });

    await user.click(screen.getByRole('button', { name: '导入订阅源' }));
    const drawer = screen.getByLabelText('导入外部订阅源');

    await user.clear(within(drawer).getByLabelText('源名称'));
    await user.type(within(drawer).getByLabelText('源名称'), '客户外部 Clash 源');
    await user.selectOptions(within(drawer).getByLabelText('源类型'), 'clash');
    await user.clear(within(drawer).getByLabelText('源地址'));
    await user.type(within(drawer).getByLabelText('源地址'), 'https://provider.example.com/customer.yaml');
    await user.clear(within(drawer).getByLabelText('服务商账户'));
    await user.type(within(drawer).getByLabelText('服务商账户'), 'provider-account-hkg');
    await user.clear(within(drawer).getByLabelText('User-Agent'));
    await user.type(within(drawer).getByLabelText('User-Agent'), 'clash-meta/2.4.0');
    await user.clear(within(drawer).getByLabelText('刷新间隔'));
    await user.type(within(drawer).getByLabelText('刷新间隔'), '45');
    await user.clear(within(drawer).getByLabelText('抓取超时'));
    await user.type(within(drawer).getByLabelText('抓取超时'), '12');
    await user.clear(within(drawer).getByLabelText('响应上限'));
    await user.type(within(drawer).getByLabelText('响应上限'), '8');
    await user.clear(within(drawer).getByLabelText('每日抓取'));
    await user.type(within(drawer).getByLabelText('每日抓取'), '12');
    await user.clear(within(drawer).getByLabelText('每日字节'));
    await user.type(within(drawer).getByLabelText('每日字节'), '64');
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
        providerAccountId: 'provider-account-hkg',
        userAgent: 'clash-meta/2.4.0',
        refreshIntervalMinutes: 45,
        fetchTimeoutSeconds: 12,
        maxBodyBytes: 8 * 1024 * 1024,
        syncBudgetMaxFetchesPerDay: 12,
        syncBudgetMaxBytesPerDay: 64 * 1024 * 1024,
        includeFilter: 'premium|streaming',
        excludeFilter: 'expired|test',
        dedupeKey: 'uuid',
        syncPolicy: {
          userAgent: 'clash-meta/2.4.0',
          refreshIntervalMinutes: 45,
          fetchTimeoutSeconds: 12,
          maxBodyBytes: 8 * 1024 * 1024
        },
        syncBudget: {
          providerAccountId: 'provider-account-hkg',
          maxFetchesPerDay: 12,
          maxBytesPerDay: 64 * 1024 * 1024
        },
        sourceRule: {
          includeFilter: 'premium|streaming',
          excludeFilter: 'expired|test',
          dedupeKey: 'uuid'
        }
      })
    );
  });

  it('confirms source deletion before dispatching it through the control-plane task flow', async () => {
    const user = userEvent.setup();
    const onDeleteSource = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    renderPage({ language: 'en', onDeleteSource });

    await user.click(screen.getByRole('button', { name: 'External Sources' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Delete external subscription source 香港 Premium 源'));
    expect(onDeleteSource).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onDeleteSource).toHaveBeenCalledWith(source);
    expect(screen.getByText(source.name)).toBeInTheDocument();
  });

  it('dispatches manual external subscription source sync from the source table', async () => {
    const user = userEvent.setup();
    const onSyncSource = vi.fn().mockResolvedValue(true);
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    renderPage({ language: 'en', onSyncSource });

    await user.click(screen.getByRole('button', { name: 'External Sources' }));
    await user.click(screen.getByRole('button', { name: 'Sync Now' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Sync external subscription source 香港 Premium 源'));
    expect(onSyncSource).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Sync Now' }));

    expect(onSyncSource).toHaveBeenCalledWith(source);
  });

  it('filters external subscription sources before dispatching row sync actions', async () => {
    const user = userEvent.setup();
    const onSyncSource = vi.fn().mockResolvedValue(true);
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    renderPage({ subscriptionSources: [source, backupSource], onSyncSource });

    await user.click(screen.getByRole('button', { name: '外部订阅源' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索订阅源' }), 'provider-account-sg');

    expect(screen.queryByText('香港 Premium 源')).not.toBeInTheDocument();
    expect(screen.getByText('新加坡 Backup 源')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '立即同步' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('确认同步外部订阅源 新加坡 Backup 源'));
    expect(onSyncSource).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: '立即同步' }));

    expect(onSyncSource).toHaveBeenCalledWith(backupSource);
  });

  it('bulk syncs selected filtered external subscription sources', async () => {
    const user = userEvent.setup();
    const onSyncSource = vi.fn().mockResolvedValue(true);
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    renderPage({ subscriptionSources: [source, backupSource], onSyncSource });

    await user.click(screen.getByRole('button', { name: '外部订阅源' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索订阅源' }), 'provider-account-sg');
    await user.click(screen.getByRole('checkbox', { name: '选择当前订阅源' }));
    await user.click(screen.getByRole('button', { name: '批量同步' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('确认同步 1 个已选外部订阅源'));
    expect(onSyncSource).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: '批量同步' }));

    expect(onSyncSource).toHaveBeenCalledTimes(1);
    expect(onSyncSource).toHaveBeenCalledWith(backupSource);
    expect(onSyncSource).not.toHaveBeenCalledWith(source);
  });

  it('shows a source impact preflight before bulk syncing or deleting external subscription sources', async () => {
    const user = userEvent.setup();
    const warningSource: SubscriptionSource = {
      ...backupSource,
      status: 'warning',
      syncWarnings: ['subscription_source.cross_source_duplicates:2']
    };
    renderPage({
      subscriptionSources: [source, warningSource],
      subscriptionInventoryNodes: inventoryNodes
    });

    await user.click(screen.getByRole('button', { name: '外部订阅源' }));
    await user.click(screen.getByRole('checkbox', { name: '选择当前订阅源' }));

    const preflight = screen.getByRole('region', { name: '订阅源影响预检' });
    const expectSourceMetric = (label: string, value: string) => {
      const metric = within(preflight).getByText(label).closest('div');

      expect(metric).not.toBeNull();
      expect(within(metric as HTMLElement).getByText(value)).toBeInTheDocument();
    };

    expectSourceMetric('已选订阅源', '2');
    expectSourceMetric('库存节点', '3');
    expectSourceMetric('异常来源', '1');
    expectSourceMetric('同步警告', '1');
    expectSourceMetric('抓取预算', '6 / 24');
    const metricGrid = preflight.querySelector('.subscription-source-impact-metric-grid');
    expect(metricGrid).toHaveClass('xl:w-[26rem]');
    expect(metricGrid).not.toHaveClass('xl:w-[30rem]', 'xl:w-[34rem]');

    const sourcePreview = within(preflight).getByText('来源预览').closest('div');
    const nodePreview = within(preflight).getByText('节点预览').closest('div');
    const warningPreview = within(preflight).getByText('风险提示').closest('div');

    expect(sourcePreview).not.toBeNull();
    expect(nodePreview).not.toBeNull();
    expect(warningPreview).not.toBeNull();
    expect(within(sourcePreview as HTMLElement).getByText('香港 Premium 源 · synced · mihomo-provider')).toBeInTheDocument();
    expect(within(sourcePreview as HTMLElement).getByText('新加坡 Backup 源 · warning · clash')).toBeInTheDocument();
    expect(within(nodePreview as HTMLElement).getByText('香港 Premium 源 · 2')).toBeInTheDocument();
    expect(within(nodePreview as HTMLElement).getByText('新加坡 Backup 源 · 1')).toBeInTheDocument();
    expect(within(warningPreview as HTMLElement).getByText('新加坡 Backup 源: 跨源重复节点 2 个')).toBeInTheDocument();
    expect(preflight.outerHTML).toContain('#FF3D18');
    expect(preflight.outerHTML).toContain('#FFD8C6');
    expect(preflight.outerHTML).not.toContain('amber-');
    expect(preflight.outerHTML).not.toContain('rose-');
    expect(preflight.outerHTML).not.toContain('masonry');
    expect(preflight.outerHTML).not.toContain('columns-');
    expect(preflight.outerHTML).not.toContain('grid-flow-row-dense');
    expect(preflight.outerHTML).not.toContain('row-span');
  });

  it('requires confirmation before bulk deleting selected filtered external subscription sources', async () => {
    const user = userEvent.setup();
    const onDeleteSource = vi.fn().mockResolvedValue(true);
    renderPage({ subscriptionSources: [source, backupSource], onDeleteSource });

    await user.click(screen.getByRole('button', { name: '外部订阅源' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索订阅源' }), 'provider-account-sg');
    await user.click(screen.getByRole('checkbox', { name: '选择当前订阅源' }));
    await user.click(screen.getByRole('button', { name: '批量删除订阅源' }));

    expect(onDeleteSource).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '确认删除 1 个订阅源' }));

    expect(onDeleteSource).toHaveBeenCalledTimes(1);
    expect(onDeleteSource).toHaveBeenCalledWith(backupSource);
    expect(onDeleteSource).not.toHaveBeenCalledWith(source);
    expect(screen.getByText('新加坡 Backup 源')).toBeInTheDocument();
  });

  it('shows provider traffic snapshots on external subscription sources', async () => {
    const user = userEvent.setup();
    renderPage({
      subscriptionSources: [
        {
          ...source,
          traffic: {
            sourceId: source.id,
            uploadBytes: 2 * 1024 * 1024,
            downloadBytes: 4 * 1024 * 1024,
            totalBytes: 500 * 1024 * 1024,
            expiresAt: '2027-01-01T00:00:00.000Z'
          }
        }
      ]
    });

    await user.click(screen.getByRole('button', { name: '外部订阅源' }));

    expect(screen.getByText('源流量')).toBeInTheDocument();
    expect(screen.getByText('6.0 MB / 500.0 MB')).toBeInTheDocument();
  });

  it('shows external source sync budget usage', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: '外部订阅源' }));

    expect(screen.getByText('3 / 12 次')).toBeInTheDocument();
    expect(screen.getByText('16.0 MB / 64.0 MB')).toBeInTheDocument();
    expect(screen.getByText('provider-account-hkg')).toBeInTheDocument();
  });

  it('shows external source sync warnings without exposing raw warning codes', async () => {
    const user = userEvent.setup();
    renderPage({
      subscriptionSources: [
        {
          ...source,
          status: 'warning',
          syncWarnings: ['subscription_source.cross_source_duplicates:2']
        }
      ]
    });

    await user.click(screen.getByRole('button', { name: '外部订阅源' }));

    const warning = screen.getByText('跨源重复节点 2 个');

    expect(warning).toBeInTheDocument();
    expect(warning.closest('div')?.outerHTML).toContain('orange-');
    expect(warning.closest('div')?.outerHTML).not.toContain('amber-');
    expect(warning.closest('div')?.outerHTML).not.toContain('rose-');
    expect(screen.queryByText('subscription_source.cross_source_duplicates:2')).not.toBeInTheDocument();
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

  it('submits editable export profile metadata instead of keeping export rules as derived-only rows', async () => {
    const user = userEvent.setup({ delay: null });
    const onSaveExportProfile = vi.fn();
    renderPage({ language: 'en', onSaveExportProfile });

    await user.click(screen.getByRole('button', { name: 'Export Profiles' }));
    expect(screen.getByText('No export profiles yet')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add Profile' }));
    const drawer = screen.getByLabelText('Edit Export Profile');

    await user.clear(within(drawer).getByLabelText('Profile Name'));
    await user.type(within(drawer).getByLabelText('Profile Name'), 'Acme Mihomo Profile');
    await user.selectOptions(within(drawer).getByLabelText('Client Type'), 'mihomo');
    await user.clear(within(drawer).getByLabelText('Export Template'));
    await user.type(within(drawer).getByLabelText('Export Template'), 'acme-mihomo.yaml');
    await user.click(within(drawer).getByLabelText(`${'Visible Sources'}: ${source.name}`));
    await user.clear(within(drawer).getByLabelText('Include Filter'));
    await user.type(within(drawer).getByLabelText('Include Filter'), 'premium|streaming');
    await user.clear(within(drawer).getByLabelText('Exclude Filter'));
    await user.type(within(drawer).getByLabelText('Exclude Filter'), 'expired|test');
    await user.clear(within(drawer).getByLabelText('Region Filter'));
    await user.type(within(drawer).getByLabelText('Region Filter'), 'hk,sg');
    await user.clear(within(drawer).getByLabelText('Proxy Group Name'));
    await user.type(within(drawer).getByLabelText('Proxy Group Name'), 'Acme Auto');
    await user.selectOptions(within(drawer).getByLabelText('Proxy Group Strategy'), 'url-test');
    await user.clear(within(drawer).getByLabelText('Proxy Group Tags'));
    await user.type(within(drawer).getByLabelText('Proxy Group Tags'), 'premium,streaming');
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));

    expect(onSaveExportProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Acme Mihomo Profile',
        client: 'mihomo',
        sourceIds: ['source-hk-premium'],
        includeFilter: 'premium|streaming',
        excludeFilter: 'expired|test',
        regionFilter: ['hk', 'sg'],
        outputFormats: ['mihomo', 'clash', 'uri'],
        templateName: 'acme-mihomo.yaml',
        proxyGroups: [
          expect.objectContaining({
            name: 'Acme Auto',
            strategy: 'url-test',
            filterTags: ['premium', 'streaming']
          })
        ],
        includeTrafficHeaders: true
      }),
      'create'
    );
  });

  it('filters export profiles before confirming bulk deletion', async () => {
    const user = userEvent.setup();
    const onDeleteExportProfile = vi.fn();
    const acmeProfile: SubscriptionExportProfile = {
      id: 'profile-acme-mihomo',
      name: 'Acme Mihomo Profile',
      client: 'mihomo',
      sourceIds: [source.id],
      includeFilter: 'premium|streaming',
      excludeFilter: 'expired|test',
      regionFilter: ['hk'],
      outputFormats: ['mihomo', 'clash'],
      templateName: 'acme-mihomo.yaml',
      proxyGroups: [
        {
          id: 'proxy-group-acme-auto',
          name: 'Acme Auto',
          strategy: 'url-test',
          filterTags: ['premium', 'streaming']
        }
      ],
      includeTrafficHeaders: true,
      updatedAt: '2026-06-02T00:00:00.000Z'
    };
    const backupProfile: SubscriptionExportProfile = {
      id: 'profile-backup-sing-box',
      name: 'Backup Sing-box Profile',
      client: 'sing-box',
      sourceIds: [backupSource.id],
      includeFilter: 'backup|standard',
      excludeFilter: 'expired|trial',
      regionFilter: ['sg'],
      outputFormats: ['sing-box'],
      templateName: 'backup-sing-box.json',
      proxyGroups: [
        {
          id: 'proxy-group-backup-auto',
          name: 'Backup Auto',
          strategy: 'fallback',
          filterTags: ['backup', 'standard']
        }
      ],
      includeTrafficHeaders: false,
      updatedAt: '2026-06-03T00:00:00.000Z'
    };

    renderPage({
      language: 'en',
      subscriptionExportProfiles: [acmeProfile, backupProfile],
      onDeleteExportProfile
    });

    await user.click(screen.getByRole('button', { name: 'Export Profiles' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search Export Profiles' }), 'backup sing-box');
    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Export Profiles' }));
    await user.click(screen.getByRole('button', { name: 'Bulk Delete Profiles' }));

    expect(onDeleteExportProfile).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm Delete 1 Profiles' }));

    expect(onDeleteExportProfile).toHaveBeenCalledTimes(1);
    expect(onDeleteExportProfile).toHaveBeenCalledWith(expect.objectContaining({ profileId: backupProfile.id }));
    expect(onDeleteExportProfile).not.toHaveBeenCalledWith(expect.objectContaining({ profileId: acmeProfile.id }));
  });

  it('dispatches export-file generation with the selected derived export file', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => false);
    const exportFile: SubscriptionExportFile = {
      id: 'export-sub-client-custom',
      subscriptionClientId: 'sub-client-custom',
      subId: 'custom_sub',
      name: 'Custom Client Export',
      templateName: 'mihomo-compatible.yaml',
      selectedTags: ['premium'],
      selectedProviderIds: ['provider-source-hk-premium'],
      formats: ['plain', 'clash'],
      trafficLimitBytes: 600 * 1024 * 1024 * 1024,
      expiresAt: '2026-07-04T00:00:00.000Z',
      accessTokenPreview: 'ou_custom...sub1'
    };
    const onGenerateExportFile = vi.fn();
    vi.stubGlobal('confirm', confirm);
    renderPage({ language: 'en', onGenerateExportFile, subscriptionExportFiles: [exportFile] });

    await user.click(screen.getByRole('button', { name: 'Export Files' }));
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Generate export file Custom Client Export'));
    expect(onGenerateExportFile).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    expect(onGenerateExportFile).toHaveBeenCalledWith(exportFile);
  });

  it('filters export files by client, profile, template, tag, and output format before row actions', async () => {
    const user = userEvent.setup();
    const mihomoExportFile: SubscriptionExportFile = {
      id: 'export-sub-client-acme-profile',
      subscriptionClientId: subscriptionClient.id,
      exportProfileId: 'profile-acme-mihomo',
      exportProfileName: 'Acme Mihomo',
      subId: subscriptionClient.subId,
      name: 'Acme 香港 Premium 订阅 - Acme Mihomo Export',
      templateName: 'mihomo-compatible.yaml',
      selectedTags: ['premium', 'streaming'],
      selectedProviderIds: ['provider-source-hk-premium'],
      formats: ['mihomo', 'clash'],
      trafficLimitBytes: subscriptionClient.trafficLimitBytes,
      expiresAt: subscriptionClient.expiresAt,
      accessTokenPreview: subscriptionClient.accessTokenPreview
    };
    const singBoxExportFile: SubscriptionExportFile = {
      id: 'export-sub-client-backup-sing-box',
      subscriptionClientId: backupSubscriptionClient.id,
      exportProfileId: 'profile-backup-sing-box',
      exportProfileName: 'Backup Sing-box',
      subId: backupSubscriptionClient.subId,
      name: 'Backup 新加坡 Standard 订阅 - Backup Sing-box Export',
      templateName: 'sing-box-compatible.json',
      selectedTags: ['standard', 'backup'],
      selectedProviderIds: ['provider-source-sg-backup'],
      formats: ['sing-box'],
      trafficLimitBytes: backupSubscriptionClient.trafficLimitBytes,
      expiresAt: backupSubscriptionClient.expiresAt,
      accessTokenPreview: backupSubscriptionClient.accessTokenPreview
    };

    renderPage({
      language: 'en',
      subscriptionExportFiles: [mihomoExportFile, singBoxExportFile]
    });

    await user.click(screen.getByRole('button', { name: 'Export Files' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search Export Files' }), 'backup');
    await user.selectOptions(screen.getByLabelText('Export Format'), 'sing-box');

    expect(screen.getByText('Backup 新加坡 Standard 订阅 - Backup Sing-box Export')).toBeInTheDocument();
    expect(screen.queryByText('Acme 香港 Premium 订阅 - Acme Mihomo Export')).not.toBeInTheDocument();
    expect(screen.getByText('Matching 1 / 2')).toBeInTheDocument();
  });

  it('bulk copies and generates selected filtered export files', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    const onGenerateExportFile = vi.fn();
    const confirm = vi.fn(() => false);
    const mihomoExportFile: SubscriptionExportFile = {
      id: 'export-sub-client-acme-profile',
      subscriptionClientId: subscriptionClient.id,
      exportProfileId: 'profile-acme-mihomo',
      exportProfileName: 'Acme Mihomo',
      subId: subscriptionClient.subId,
      name: 'Acme 香港 Premium 订阅 - Acme Mihomo Export',
      templateName: 'mihomo-compatible.yaml',
      selectedTags: ['premium', 'streaming'],
      selectedProviderIds: ['provider-source-hk-premium'],
      formats: ['mihomo', 'clash'],
      trafficLimitBytes: subscriptionClient.trafficLimitBytes,
      expiresAt: subscriptionClient.expiresAt,
      accessTokenPreview: subscriptionClient.accessTokenPreview
    };
    const singBoxExportFile: SubscriptionExportFile = {
      id: 'export-sub-client-backup-sing-box',
      subscriptionClientId: backupSubscriptionClient.id,
      exportProfileId: 'profile-backup-sing-box',
      exportProfileName: 'Backup Sing-box',
      subId: backupSubscriptionClient.subId,
      name: 'Backup 新加坡 Standard 订阅 - Backup Sing-box Export',
      templateName: 'sing-box-compatible.json',
      selectedTags: ['standard', 'backup'],
      selectedProviderIds: ['provider-source-sg-backup'],
      formats: ['sing-box'],
      trafficLimitBytes: backupSubscriptionClient.trafficLimitBytes,
      expiresAt: backupSubscriptionClient.expiresAt,
      accessTokenPreview: backupSubscriptionClient.accessTokenPreview
    };
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    vi.stubGlobal('confirm', confirm);
    renderPage({
      language: 'en',
      subscriptionClients: [subscriptionClient, backupSubscriptionClient],
      subscriptionExportFiles: [mihomoExportFile, singBoxExportFile],
      onGenerateExportFile
    });

    await user.click(screen.getByRole('button', { name: 'Export Files' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search Export Files' }), 'backup');
    await user.selectOptions(screen.getByLabelText('Export Format'), 'sing-box');
    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Export Files' }));
    await user.click(screen.getByRole('button', { name: 'Bulk Copy Export Links' }));
    await user.click(screen.getByRole('button', { name: 'Bulk Generate' }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/^Backup 新加坡 Standard 订阅 - Backup Sing-box Export\nhttp:\/\/localhost(?::\d+)?\/sub\/secure-backup-sg\/sing-box\/sub_backup_sg_standard$/)
    );
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('secure-acme-hkg'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Generate 1 selected export file'));
    expect(onGenerateExportFile).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Bulk Generate' }));

    expect(onGenerateExportFile).toHaveBeenCalledTimes(1);
    expect(onGenerateExportFile).toHaveBeenCalledWith(singBoxExportFile);
    expect(onGenerateExportFile).not.toHaveBeenCalledWith(mihomoExportFile);
  });

  it('shows an export generation impact preflight before bulk generating selected export files', async () => {
    const user = userEvent.setup();
    const mihomoExportFile: SubscriptionExportFile = {
      id: 'export-sub-client-acme-profile',
      subscriptionClientId: subscriptionClient.id,
      exportProfileId: 'profile-acme-mihomo',
      exportProfileName: 'Acme Mihomo',
      subId: subscriptionClient.subId,
      name: 'Acme 香港 Premium 订阅 - Acme Mihomo Export',
      templateName: 'mihomo-compatible.yaml',
      selectedTags: ['premium', 'streaming'],
      selectedProviderIds: ['provider-source-hk-premium'],
      formats: ['mihomo', 'clash'],
      trafficLimitBytes: subscriptionClient.trafficLimitBytes,
      expiresAt: subscriptionClient.expiresAt,
      accessTokenPreview: subscriptionClient.accessTokenPreview
    };
    const singBoxExportFile: SubscriptionExportFile = {
      id: 'export-sub-client-backup-sing-box',
      subscriptionClientId: backupSubscriptionClient.id,
      exportProfileId: 'profile-backup-sing-box',
      exportProfileName: 'Backup Sing-box',
      subId: backupSubscriptionClient.subId,
      name: 'Backup 新加坡 Standard 订阅 - Backup Sing-box Export',
      templateName: 'sing-box-compatible.json',
      selectedTags: ['standard', 'backup'],
      selectedProviderIds: ['provider-source-sg-backup'],
      formats: ['sing-box'],
      trafficLimitBytes: backupSubscriptionClient.trafficLimitBytes,
      expiresAt: backupSubscriptionClient.expiresAt,
      accessTokenPreview: backupSubscriptionClient.accessTokenPreview
    };
    renderPage({
      subscriptionClients: [subscriptionClient, backupSubscriptionClient],
      subscriptionExportFiles: [mihomoExportFile, singBoxExportFile]
    });

    await user.click(screen.getByRole('button', { name: '导出文件' }));
    await user.click(screen.getByRole('checkbox', { name: '选择当前导出文件' }));

    const preflight = screen.getByRole('region', { name: '生成影响预检' });
    const expectMetric = (label: string, value: string) => {
      const metric = within(preflight).getByText(label).closest('div');

      expect(metric).not.toBeNull();
      expect(within(metric as HTMLElement).getByText(value)).toBeInTheDocument();
    };

    expectMetric('导出文件', '2');
    expectMetric('订阅身份', '2');
    expectMetric('输出格式', '3');
    expectMetric('代理集合引用', '2');
    const metricGrid = preflight.querySelector('.subscription-export-impact-metric-grid');
    expect(metricGrid).toHaveClass('xl:w-[26rem]');
    expect(metricGrid).not.toHaveClass('xl:w-[30rem]', 'xl:w-[34rem]');

    const exportPreview = within(preflight).getByText('导出预览').closest('div');
    const clientPreview = within(preflight).getByText('身份预览').closest('div');
    const formatPreview = within(preflight).getByText('格式预览').closest('div');

    expect(exportPreview).not.toBeNull();
    expect(clientPreview).not.toBeNull();
    expect(formatPreview).not.toBeNull();
    expect(within(exportPreview as HTMLElement).getByText('Acme 香港 Premium 订阅 - Acme Mihomo Export · mihomo-compatible.yaml')).toBeInTheDocument();
    expect(within(exportPreview as HTMLElement).getByText('Backup 新加坡 Standard 订阅 - Backup Sing-box Export · sing-box-compatible.json')).toBeInTheDocument();
    expect(within(clientPreview as HTMLElement).getByText('Acme 香港 Premium 订阅')).toBeInTheDocument();
    expect(within(clientPreview as HTMLElement).getByText('Backup 新加坡 Standard 订阅')).toBeInTheDocument();
    expect(within(formatPreview as HTMLElement).getByText('Mihomo / Clash / Sing-box')).toBeInTheDocument();
    expect(preflight.outerHTML).not.toContain('masonry');
    expect(preflight.outerHTML).not.toContain('columns-');
    expect(preflight.outerHTML).not.toContain('grid-flow-row-dense');
    expect(preflight.outerHTML).not.toContain('row-span');
  });

  it('wraps long export generation evidence instead of truncating publishable subscription artifacts', async () => {
    const user = userEvent.setup();
    const longExportFile: SubscriptionExportFile = {
      id: 'export-sub-client-acme-long-evidence',
      subscriptionClientId: subscriptionClient.id,
      exportProfileId: 'profile-acme-long-evidence',
      exportProfileName: 'Acme Long Evidence',
      subId: subscriptionClient.subId,
      name:
        'Acme 香港 Premium 订阅 - northbound-production-rollout-window-2026-06-14-super-long-evidence-artifact-for-customer-review',
      templateName:
        'mihomo-compatible-production-template-with-very-long-provider-and-routing-policy-name.yaml',
      selectedTags: ['premium', 'streaming', 'production-rollout'],
      selectedProviderIds: [
        'provider-source-hk-premium-super-long-runtime-export-reference-2026-06-14'
      ],
      formats: ['mihomo', 'clash'],
      trafficLimitBytes: subscriptionClient.trafficLimitBytes,
      expiresAt: subscriptionClient.expiresAt,
      accessTokenPreview: 'ou_acme_long_evidence_token_preview'
    };

    renderPage({
      subscriptionClients: [subscriptionClient],
      subscriptionExportFiles: [longExportFile]
    });

    await user.click(screen.getByRole('button', { name: '导出文件' }));
    await user.click(screen.getByRole('checkbox', { name: '选择当前导出文件' }));

    const preflight = screen.getByRole('region', { name: '生成影响预检' });
    const exportPreview = within(preflight).getByText('导出预览').closest('div');
    const longEvidence = within(exportPreview as HTMLElement).getByText(
      `${longExportFile.name} · ${longExportFile.templateName}`
    );

    expect(exportPreview).not.toBeNull();
    expect(exportPreview).toHaveClass('subscription-distribution-evidence-card');
    expect(longEvidence).toHaveClass('break-all', 'whitespace-normal');
    expect(longEvidence).not.toHaveClass('truncate');
    expect(exportPreview?.outerHTML).not.toContain('truncate');
    expect(preflight.outerHTML).toContain('#1E3AFF');
    expect(preflight.outerHTML).toContain('#DCE1FF');
    expect(preflight.outerHTML).not.toContain('amber-');
    expect(preflight.outerHTML).not.toContain('purple-');
  });

  it('copies the public export subscription URL using the matching subscription identity secure path', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    const exportFile: SubscriptionExportFile = {
      id: 'export-sub-client-acme-profile',
      subscriptionClientId: subscriptionClient.id,
      exportProfileId: 'profile-acme-mihomo',
      exportProfileName: 'Acme Mihomo',
      subId: subscriptionClient.subId,
      name: 'Acme 香港 Premium 订阅 - Acme Mihomo Export',
      templateName: 'mihomo-compatible.yaml',
      selectedTags: ['premium', 'streaming'],
      selectedProviderIds: ['provider-source-hk-premium'],
      formats: ['mihomo', 'clash'],
      trafficLimitBytes: subscriptionClient.trafficLimitBytes,
      expiresAt: subscriptionClient.expiresAt,
      accessTokenPreview: subscriptionClient.accessTokenPreview
    };
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderPage({ subscriptionClients: [subscriptionClient], subscriptionExportFiles: [exportFile] });

    await user.click(screen.getByRole('button', { name: '导出文件' }));
    await user.click(screen.getByRole('button', { name: '复制导出链接' }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/\/sub\/secure-acme-hkg\/mihomo\/sub_acme_hkg_premium$/)
    );
  });

  it('copies the default subscription URL directly from the client table', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderPage({ subscriptionClients: [subscriptionClient] });

    await user.click(screen.getByRole('button', { name: '复制订阅链接' }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/\/sub\/secure-acme-hkg\/uri\/sub_acme_hkg_premium$/)
    );
  });

  it('copies all enabled format subscription URLs directly from the client table', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderPage({ subscriptionClients: [subscriptionClient] });

    await user.click(screen.getByRole('button', { name: '复制全部格式链接' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(
        /URI: http:\/\/localhost(?::\d+)?\/sub\/secure-acme-hkg\/uri\/sub_acme_hkg_premium\nClash: http:\/\/localhost(?::\d+)?\/sub\/secure-acme-hkg\/clash\/sub_acme_hkg_premium\nMihomo: http:\/\/localhost(?::\d+)?\/sub\/secure-acme-hkg\/mihomo\/sub_acme_hkg_premium/
      )
    );
  });

  it('opens a subscription link drawer with per-format copy, diagnostics, and open actions', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    const open = vi.fn();
    const guardedClient: SubscriptionClientIdentity = {
      ...subscriptionClient,
      quotaResetAt: '2026-07-01T00:00:00.000Z',
      quotaResetBaselineUsedTrafficBytes: 64 * 1024 * 1024 * 1024,
      quotaExceeded: true,
      runtimeDisabledByPolicy: true,
      guardrailReason: 'subscription.quota_exceeded'
    };
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    vi.stubGlobal('open', open);
    renderPage({ subscriptionClients: [guardedClient] });

    await user.click(screen.getByRole('button', { name: '查看订阅链接' }));
    const drawer = screen.getByLabelText('Acme 香港 Premium 订阅 订阅链接');

    expect(within(drawer).getByText('URI')).toBeInTheDocument();
    expect(within(drawer).getByText('Clash')).toBeInTheDocument();
    expect(within(drawer).getByText('Mihomo')).toBeInTheDocument();
    expect(within(drawer).getByText('Subscription-Userinfo')).toBeInTheDocument();
    expect(
      within(drawer).getByText('upload=0; download=137438953472; total=1099511627776; expire=1798761599')
    ).toBeInTheDocument();
    expect(within(drawer).getByText('访问统计')).toBeInTheDocument();
    expect(within(drawer).getByText('上次在线')).toBeInTheDocument();
    expect(within(drawer).getByText('上次生成')).toBeInTheDocument();
    expect(within(drawer).getByText('重置窗口')).toBeInTheDocument();
    expect(within(drawer).getByText('生成节点')).toBeInTheDocument();
    expect(within(drawer).getByText('2')).toBeInTheDocument();
    expect(within(drawer).getByText('请求上限')).toBeInTheDocument();
    expect(within(drawer).getByText('360 req/h')).toBeInTheDocument();
    expect(within(drawer).getByText('守护状态')).toBeInTheDocument();
    expect(within(drawer).getByText('subscription.quota_exceeded')).toBeInTheDocument();
    expect(within(drawer).getByText(/\/sub\/secure-acme-hkg\/clash\/sub_acme_hkg_premium$/)).toBeInTheDocument();

    await user.click(within(drawer).getByRole('button', { name: '复制 Clash 链接' }));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/^http:\/\/localhost(?::\d+)?\/sub\/secure-acme-hkg\/clash\/sub_acme_hkg_premium$/)
    );

    await user.click(within(drawer).getByRole('button', { name: '复制订阅用量头' }));
    expect(writeText).toHaveBeenCalledWith(
      'Subscription-Userinfo: upload=0; download=137438953472; total=1099511627776; expire=1798761599'
    );

    await user.click(within(drawer).getByRole('button', { name: '复制订阅诊断' }));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('Sub ID: sub_acme_hkg_premium')
    );
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Generated Nodes: 2'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Request Limit: 360 req/h'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Last Online: 2026-06-02T00:00:00.000Z'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Last Generated: 2026-06-02T00:00:00.000Z'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Quota Reset: 2026-07-01T00:00:00.000Z'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Quota Reset Baseline Used: 68719476736 bytes'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Guardrail: subscription.quota_exceeded'));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('Subscription-Userinfo: upload=0; download=137438953472; total=1099511627776; expire=1798761599')
    );

    await user.click(within(drawer).getByRole('button', { name: '打开 Mihomo 链接' }));
    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/^http:\/\/localhost(?::\d+)?\/sub\/secure-acme-hkg\/mihomo\/sub_acme_hkg_premium$/),
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('generates downloadable QR codes for every subscription link format', async () => {
    const user = userEvent.setup();
    renderPage({ subscriptionClients: [subscriptionClient] });

    await user.click(screen.getByRole('button', { name: '查看订阅链接' }));
    const drawer = screen.getByLabelText('Acme 香港 Premium 订阅 订阅链接');
    const clashQr = await within(drawer).findByRole('img', { name: 'Clash 订阅二维码' });

    expect(clashQr).toHaveAttribute(
      'src',
      expect.stringMatching(/^data:image\/png;base64,aHR0cDovL2xvY2FsaG9zd/)
    );

    const downloadLink = within(drawer).getByRole('link', { name: '下载 Clash 二维码' });
    expect(downloadLink).toHaveAttribute('href', clashQr.getAttribute('src'));
    expect(downloadLink).toHaveAttribute('download', 'sub-acme-hkg-premium-clash-qr.png');

    expect(await within(drawer).findByRole('img', { name: 'Mihomo 订阅二维码' })).toBeInTheDocument();
  });

  it('opens a matched-node drawer from a subscription identity and copies node share links', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderPage({
      subscriptionSources: [source, backupSource],
      subscriptionInventoryNodes: inventoryNodes,
      subscriptionClients: [subscriptionClient]
    });

    const acmeRow = screen.getByText('Acme 香港 Premium 订阅').closest('tr');
    expect(acmeRow).not.toBeNull();

    await user.click(within(acmeRow as HTMLElement).getByRole('button', { name: '查看命中节点' }));
    const drawer = screen.getByLabelText('Acme 香港 Premium 订阅 命中节点');

    expect(within(drawer).getByText('HK Premium VLESS 01')).toBeInTheDocument();
    expect(within(drawer).queryByText('HK Premium Test 01')).not.toBeInTheDocument();
    expect(within(drawer).queryByText('SG Backup VMess 01')).not.toBeInTheDocument();
    expect(within(drawer).getByText('当前命中 1 / 2')).toBeInTheDocument();

    await user.click(within(drawer).getByRole('button', { name: '复制节点链接' }));

    expect(writeText).toHaveBeenCalledWith(inventoryNodes[0].rawUrl);
  });

  it('jumps from the matched-node drawer to inventory with the subscription rule applied', async () => {
    const user = userEvent.setup();
    renderPage({
      subscriptionSources: [source, backupSource],
      subscriptionInventoryNodes: inventoryNodes,
      subscriptionClients: [subscriptionClient]
    });

    const acmeRow = screen.getByText('Acme 香港 Premium 订阅').closest('tr');
    expect(acmeRow).not.toBeNull();

    await user.click(within(acmeRow as HTMLElement).getByRole('button', { name: '查看命中节点' }));
    const drawer = screen.getByLabelText('Acme 香港 Premium 订阅 命中节点');

    await user.click(within(drawer).getByRole('button', { name: '在库存中查看' }));

    expect(screen.queryByLabelText('Acme 香港 Premium 订阅 命中节点')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '节点库存' }).outerHTML).toContain('#1E3AFF');
    expect(screen.getByRole('button', { name: '节点库存' }).outerHTML).not.toContain('bg-blue-500');
    expect(screen.getByLabelText('客户订阅规则')).toHaveValue(subscriptionClient.id);
    expect(screen.getByText('HK Premium VLESS 01')).toBeInTheDocument();
    expect(screen.queryByText('HK Premium Test 01')).not.toBeInTheDocument();
    expect(screen.queryByText('SG Backup VMess 01')).not.toBeInTheDocument();
  });

  it('summarizes matched source sync state and syncs the matching source from the node drawer', async () => {
    const user = userEvent.setup();
    const onSyncSource = vi.fn().mockResolvedValue(true);
    const confirm = vi.fn(() => false);
    const warningSource: SubscriptionSource = {
      ...source,
      status: 'warning',
      syncWarnings: ['subscription_source.cross_source_duplicates:2'],
      lastSyncAt: '2026-06-03T08:30:00.000Z'
    };
    vi.stubGlobal('confirm', confirm);
    renderPage({
      subscriptionSources: [warningSource, backupSource],
      subscriptionInventoryNodes: inventoryNodes,
      subscriptionClients: [subscriptionClient],
      onSyncSource
    });

    await user.click(screen.getByRole('button', { name: '查看命中节点' }));
    const drawer = screen.getByLabelText('Acme 香港 Premium 订阅 命中节点');

    expect(within(drawer).getByText('命中来源')).toBeInTheDocument();
    expect(within(drawer).getByText('香港 Premium 源')).toBeInTheDocument();
    expect(within(drawer).getByText(/warning/i)).toBeInTheDocument();
    expect(within(drawer).getByText('跨源重复节点 2 个')).toBeInTheDocument();
    expect(within(drawer).queryByText('新加坡 Backup 源')).not.toBeInTheDocument();

    await user.click(within(drawer).getByRole('button', { name: '同步命中来源' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('确认同步 1 个已选外部订阅源'));
    expect(onSyncSource).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(within(drawer).getByRole('button', { name: '同步命中来源' }));

    expect(onSyncSource).toHaveBeenCalledWith(warningSource);
  });

  it('surfaces the matching export files from the matched-node drawer for copy and generation', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    const onGenerateExportFile = vi.fn();
    const confirm = vi.fn(() => false);
    const acmeExportFile: SubscriptionExportFile = {
      id: 'export-sub-client-acme-profile',
      subscriptionClientId: subscriptionClient.id,
      exportProfileId: 'profile-acme-mihomo',
      exportProfileName: 'Acme Mihomo',
      subId: subscriptionClient.subId,
      name: 'Acme 香港 Premium 订阅 - Acme Mihomo Export',
      templateName: 'mihomo-compatible.yaml',
      selectedTags: ['premium', 'streaming'],
      selectedProviderIds: ['provider-source-hk-premium'],
      formats: ['mihomo', 'clash'],
      trafficLimitBytes: subscriptionClient.trafficLimitBytes,
      expiresAt: subscriptionClient.expiresAt,
      accessTokenPreview: subscriptionClient.accessTokenPreview
    };
    const backupExportFile: SubscriptionExportFile = {
      id: 'export-sub-client-backup-sing-box',
      subscriptionClientId: backupSubscriptionClient.id,
      exportProfileId: 'profile-backup-sing-box',
      exportProfileName: 'Backup Sing-box',
      subId: backupSubscriptionClient.subId,
      name: 'Backup 新加坡 Standard 订阅 - Backup Sing-box Export',
      templateName: 'sing-box-compatible.json',
      selectedTags: ['standard', 'backup'],
      selectedProviderIds: ['provider-source-sg-backup'],
      formats: ['sing-box'],
      trafficLimitBytes: backupSubscriptionClient.trafficLimitBytes,
      expiresAt: backupSubscriptionClient.expiresAt,
      accessTokenPreview: backupSubscriptionClient.accessTokenPreview
    };
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    vi.stubGlobal('confirm', confirm);
    renderPage({
      subscriptionClients: [subscriptionClient, backupSubscriptionClient],
      subscriptionSources: [source, backupSource],
      subscriptionInventoryNodes: inventoryNodes,
      subscriptionExportFiles: [acmeExportFile, backupExportFile],
      onGenerateExportFile
    });

    const acmeRow = screen.getByText('Acme 香港 Premium 订阅').closest('tr');
    expect(acmeRow).not.toBeNull();

    await user.click(within(acmeRow as HTMLElement).getByRole('button', { name: '查看命中节点' }));
    const drawer = screen.getByLabelText('Acme 香港 Premium 订阅 命中节点');

    expect(within(drawer).getByText('关联导出文件')).toBeInTheDocument();
    expect(within(drawer).getByText('Acme 香港 Premium 订阅 - Acme Mihomo Export')).toBeInTheDocument();
    expect(within(drawer).queryByText('Backup 新加坡 Standard 订阅 - Backup Sing-box Export')).not.toBeInTheDocument();

    await user.click(within(drawer).getByRole('button', { name: '复制导出链接' }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/\/sub\/secure-acme-hkg\/mihomo\/sub_acme_hkg_premium$/)
    );

    await user.click(within(drawer).getByRole('button', { name: '生成' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('生成导出文件 Acme 香港 Premium 订阅 - Acme Mihomo Export'));
    expect(onGenerateExportFile).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(within(drawer).getByRole('button', { name: '生成' }));

    expect(onGenerateExportFile).toHaveBeenCalledWith(acmeExportFile);
  });

  it('filters proxy providers before bulk copying provider links and generating related export files', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    const onGenerateExportFile = vi.fn();
    const confirm = vi.fn(() => false);
    const acmeProvider: ProxyProviderConfig = {
      id: 'provider-source-hk-premium',
      name: '香港 Premium Provider',
      externalSubscriptionId: source.id,
      filter: 'premium|streaming',
      excludeFilter: 'expired|test',
      geoIpFilter: 'CN,HK,SG,JP,US,EU',
      processMode: 'server',
      overrideRule: 'source:source-hk-premium;dedupe:server-port'
    };
    const backupProvider: ProxyProviderConfig = {
      id: 'provider-source-sg-backup',
      name: '新加坡 Backup Provider',
      externalSubscriptionId: backupSource.id,
      filter: 'backup|standard',
      excludeFilter: 'expired|trial',
      geoIpFilter: 'SG,JP',
      processMode: 'client',
      overrideRule: 'source:source-sg-backup;dedupe:name'
    };
    const acmeExportFile: SubscriptionExportFile = {
      id: 'export-sub-client-acme-profile',
      subscriptionClientId: subscriptionClient.id,
      exportProfileId: 'profile-acme-mihomo',
      exportProfileName: 'Acme Mihomo',
      subId: subscriptionClient.subId,
      name: 'Acme 香港 Premium 订阅 - Acme Mihomo Export',
      templateName: 'mihomo-compatible.yaml',
      selectedTags: ['premium', 'streaming'],
      selectedProviderIds: [acmeProvider.id],
      formats: ['mihomo', 'clash'],
      trafficLimitBytes: subscriptionClient.trafficLimitBytes,
      expiresAt: subscriptionClient.expiresAt,
      accessTokenPreview: subscriptionClient.accessTokenPreview
    };
    const backupExportFile: SubscriptionExportFile = {
      id: 'export-sub-client-backup-sing-box',
      subscriptionClientId: backupSubscriptionClient.id,
      exportProfileId: 'profile-backup-sing-box',
      exportProfileName: 'Backup Sing-box',
      subId: backupSubscriptionClient.subId,
      name: 'Backup 新加坡 Standard 订阅 - Backup Sing-box Export',
      templateName: 'sing-box-compatible.json',
      selectedTags: ['standard', 'backup'],
      selectedProviderIds: [backupProvider.id],
      formats: ['sing-box'],
      trafficLimitBytes: backupSubscriptionClient.trafficLimitBytes,
      expiresAt: backupSubscriptionClient.expiresAt,
      accessTokenPreview: backupSubscriptionClient.accessTokenPreview
    };
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    vi.stubGlobal('confirm', confirm);
    renderPage({
      language: 'en',
      subscriptionSources: [source, backupSource],
      subscriptionClients: [subscriptionClient, backupSubscriptionClient],
      proxyProviders: [acmeProvider, backupProvider],
      subscriptionExportFiles: [acmeExportFile, backupExportFile],
      onGenerateExportFile
    });

    await user.click(screen.getByRole('button', { name: 'Proxy Providers' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search Proxy Providers' }), 'backup standard');
    await user.click(screen.getByRole('checkbox', { name: 'Select Visible Proxy Providers' }));
    await user.click(screen.getByRole('button', { name: 'Bulk Copy Provider URLs' }));
    await user.click(screen.getByRole('button', { name: 'Bulk Generate Related Exports' }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/^新加坡 Backup Provider\nhttp:\/\/localhost(?::\d+)?\/proxy-providers\/provider-source-sg-backup\.yaml$/)
    );
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('provider-source-hk-premium'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Generate 1 selected export file'));
    expect(onGenerateExportFile).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Bulk Generate Related Exports' }));

    expect(onGenerateExportFile).toHaveBeenCalledTimes(1);
    expect(onGenerateExportFile).toHaveBeenCalledWith(backupExportFile);
    expect(onGenerateExportFile).not.toHaveBeenCalledWith(acmeExportFile);
  });

  it('shows a provider generation impact preflight before bulk generating related export files', async () => {
    const user = userEvent.setup();
    const acmeProvider: ProxyProviderConfig = {
      id: 'provider-source-hk-premium',
      name: '香港 Premium Provider',
      externalSubscriptionId: source.id,
      filter: 'premium|streaming',
      excludeFilter: 'expired|test',
      geoIpFilter: 'CN,HK,SG,JP,US,EU',
      processMode: 'server',
      overrideRule: 'source:source-hk-premium;dedupe:server-port'
    };
    const backupProvider: ProxyProviderConfig = {
      id: 'provider-source-sg-backup',
      name: '新加坡 Backup Provider',
      externalSubscriptionId: backupSource.id,
      filter: 'backup|standard',
      excludeFilter: 'expired|trial',
      geoIpFilter: 'SG,JP',
      processMode: 'client',
      overrideRule: 'source:source-sg-backup;dedupe:name'
    };
    const acmeExportFile: SubscriptionExportFile = {
      id: 'export-sub-client-acme-profile',
      subscriptionClientId: subscriptionClient.id,
      exportProfileId: 'profile-acme-mihomo',
      exportProfileName: 'Acme Mihomo',
      subId: subscriptionClient.subId,
      name: 'Acme 香港 Premium 订阅 - Acme Mihomo Export',
      templateName: 'mihomo-compatible.yaml',
      selectedTags: ['premium', 'streaming'],
      selectedProviderIds: [acmeProvider.id],
      formats: ['mihomo', 'clash'],
      trafficLimitBytes: subscriptionClient.trafficLimitBytes,
      expiresAt: subscriptionClient.expiresAt,
      accessTokenPreview: subscriptionClient.accessTokenPreview
    };
    const backupExportFile: SubscriptionExportFile = {
      id: 'export-sub-client-backup-sing-box',
      subscriptionClientId: backupSubscriptionClient.id,
      exportProfileId: 'profile-backup-sing-box',
      exportProfileName: 'Backup Sing-box',
      subId: backupSubscriptionClient.subId,
      name: 'Backup 新加坡 Standard 订阅 - Backup Sing-box Export',
      templateName: 'sing-box-compatible.json',
      selectedTags: ['standard', 'backup'],
      selectedProviderIds: [backupProvider.id],
      formats: ['sing-box'],
      trafficLimitBytes: backupSubscriptionClient.trafficLimitBytes,
      expiresAt: backupSubscriptionClient.expiresAt,
      accessTokenPreview: backupSubscriptionClient.accessTokenPreview
    };
    renderPage({
      subscriptionSources: [source, backupSource],
      subscriptionClients: [subscriptionClient, backupSubscriptionClient],
      proxyProviders: [acmeProvider, backupProvider],
      subscriptionExportFiles: [acmeExportFile, backupExportFile]
    });

    await user.click(screen.getByRole('button', { name: '代理集合' }));
    await user.click(screen.getByRole('checkbox', { name: '选择当前代理集合' }));

    const preflight = screen.getByRole('region', { name: '代理集合生成影响预检' });
    const expectMetric = (label: string, value: string) => {
      const metric = within(preflight).getByText(label).closest('div');

      expect(metric).not.toBeNull();
      expect(within(metric as HTMLElement).getByText(value)).toBeInTheDocument();
    };

    expectMetric('代理集合', '2');
    expectMetric('关联导出文件', '2');
    expectMetric('订阅身份', '2');
    expectMetric('输出格式', '3');
    const metricGrid = preflight.querySelector('.subscription-provider-impact-metric-grid');
    expect(metricGrid).toHaveClass('xl:w-[26rem]');
    expect(metricGrid).not.toHaveClass('xl:w-[30rem]', 'xl:w-[34rem]');

    const providerPreview = within(preflight).getByText('代理集合预览').closest('div');
    const exportPreview = within(preflight).getByText('导出预览').closest('div');
    const formatPreview = within(preflight).getByText('格式预览').closest('div');

    expect(providerPreview).not.toBeNull();
    expect(exportPreview).not.toBeNull();
    expect(formatPreview).not.toBeNull();
    expect(within(providerPreview as HTMLElement).getByText('香港 Premium Provider · server · source-hk-premium')).toBeInTheDocument();
    expect(within(providerPreview as HTMLElement).getByText('新加坡 Backup Provider · client · source-sg-backup')).toBeInTheDocument();
    expect(within(exportPreview as HTMLElement).getByText('Acme 香港 Premium 订阅 - Acme Mihomo Export · mihomo-compatible.yaml')).toBeInTheDocument();
    expect(within(exportPreview as HTMLElement).getByText('Backup 新加坡 Standard 订阅 - Backup Sing-box Export · sing-box-compatible.json')).toBeInTheDocument();
    expect(within(formatPreview as HTMLElement).getByText('Mihomo / Clash / Sing-box')).toBeInTheDocument();
    expect(preflight.outerHTML).not.toContain('masonry');
    expect(preflight.outerHTML).not.toContain('columns-');
    expect(preflight.outerHTML).not.toContain('grid-flow-row-dense');
    expect(preflight.outerHTML).not.toContain('row-span');
  });

  it('copies a single proxy provider link and generates only its related export files from the provider row', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    const onGenerateExportFile = vi.fn();
    const confirm = vi.fn(() => false);
    const acmeProvider: ProxyProviderConfig = {
      id: 'provider-source-hk-premium',
      name: '香港 Premium Provider',
      externalSubscriptionId: source.id,
      filter: 'premium|streaming',
      excludeFilter: 'expired|test',
      geoIpFilter: 'CN,HK,SG,JP,US,EU',
      processMode: 'server',
      overrideRule: 'source:source-hk-premium;dedupe:server-port'
    };
    const backupProvider: ProxyProviderConfig = {
      id: 'provider-source-sg-backup',
      name: '新加坡 Backup Provider',
      externalSubscriptionId: backupSource.id,
      filter: 'backup|standard',
      excludeFilter: 'expired|trial',
      geoIpFilter: 'SG,JP',
      processMode: 'client',
      overrideRule: 'source:source-sg-backup;dedupe:name'
    };
    const acmeExportFile: SubscriptionExportFile = {
      id: 'export-sub-client-acme-profile',
      subscriptionClientId: subscriptionClient.id,
      exportProfileId: 'profile-acme-mihomo',
      exportProfileName: 'Acme Mihomo',
      subId: subscriptionClient.subId,
      name: 'Acme 香港 Premium 订阅 - Acme Mihomo Export',
      templateName: 'mihomo-compatible.yaml',
      selectedTags: ['premium', 'streaming'],
      selectedProviderIds: [acmeProvider.id],
      formats: ['mihomo', 'clash'],
      trafficLimitBytes: subscriptionClient.trafficLimitBytes,
      expiresAt: subscriptionClient.expiresAt,
      accessTokenPreview: subscriptionClient.accessTokenPreview
    };
    const backupExportFile: SubscriptionExportFile = {
      id: 'export-sub-client-backup-sing-box',
      subscriptionClientId: backupSubscriptionClient.id,
      exportProfileId: 'profile-backup-sing-box',
      exportProfileName: 'Backup Sing-box',
      subId: backupSubscriptionClient.subId,
      name: 'Backup 新加坡 Standard 订阅 - Backup Sing-box Export',
      templateName: 'sing-box-compatible.json',
      selectedTags: ['standard', 'backup'],
      selectedProviderIds: [backupProvider.id],
      formats: ['sing-box'],
      trafficLimitBytes: backupSubscriptionClient.trafficLimitBytes,
      expiresAt: backupSubscriptionClient.expiresAt,
      accessTokenPreview: backupSubscriptionClient.accessTokenPreview
    };
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    vi.stubGlobal('confirm', confirm);
    renderPage({
      language: 'en',
      subscriptionSources: [source, backupSource],
      subscriptionClients: [subscriptionClient, backupSubscriptionClient],
      proxyProviders: [acmeProvider, backupProvider],
      subscriptionExportFiles: [acmeExportFile, backupExportFile],
      onGenerateExportFile
    });

    await user.click(screen.getByRole('button', { name: 'Proxy Providers' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search Proxy Providers' }), 'premium');
    await user.click(screen.getByRole('button', { name: 'Copy Proxy Provider URL 香港 Premium Provider' }));
    await user.click(screen.getByRole('button', { name: 'Generate Related Exports 香港 Premium Provider' }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/^香港 Premium Provider\nhttp:\/\/localhost(?::\d+)?\/proxy-providers\/provider-source-hk-premium\.yaml$/)
    );
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('provider-source-sg-backup'));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Generate 1 selected export file'));
    expect(onGenerateExportFile).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Generate Related Exports 香港 Premium Provider' }));

    expect(onGenerateExportFile).toHaveBeenCalledTimes(1);
    expect(onGenerateExportFile).toHaveBeenCalledWith(acmeExportFile);
    expect(onGenerateExportFile).not.toHaveBeenCalledWith(backupExportFile);
  });

  it('filters subscription identities by customer, email, subId, and tags before row actions', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderPage({ subscriptionClients: [subscriptionClient, backupSubscriptionClient] });

    await user.type(screen.getByRole('searchbox', { name: '搜索订阅身份' }), 'backup@example.com');

    expect(screen.queryByText('Acme 香港 Premium 订阅')).not.toBeInTheDocument();
    expect(screen.getByText('Backup 新加坡 Standard 订阅')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '复制订阅链接' }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/\/sub\/secure-backup-sg\/uri\/sub_backup_sg_standard$/)
    );
  });

  it('bulk copies selected subscription URLs from the filtered identity table', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderPage({ subscriptionClients: [subscriptionClient, backupSubscriptionClient] });

    await user.type(screen.getByRole('searchbox', { name: '搜索订阅身份' }), 'backup');
    await user.click(screen.getByRole('checkbox', { name: '选择 Backup 新加坡 Standard 订阅' }));
    await user.click(screen.getByRole('button', { name: '批量复制订阅链接' }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/^http:\/\/localhost(?::\d+)?\/sub\/secure-backup-sg\/uri\/sub_backup_sg_standard$/)
    );
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('sub_acme_hkg_premium'));
  });

  it('bulk copies all enabled format subscription URLs for selected filtered identities', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderPage({ subscriptionClients: [subscriptionClient, backupSubscriptionClient] });

    await user.type(screen.getByRole('searchbox', { name: '搜索订阅身份' }), 'backup');
    await user.click(screen.getByRole('checkbox', { name: '选择 Backup 新加坡 Standard 订阅' }));
    await user.click(screen.getByRole('button', { name: '批量复制全部格式链接' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(
        /Backup 新加坡 Standard 订阅\nURI: http:\/\/localhost(?::\d+)?\/sub\/secure-backup-sg\/uri\/sub_backup_sg_standard\nClash: http:\/\/localhost(?::\d+)?\/sub\/secure-backup-sg\/clash\/sub_backup_sg_standard\nMihomo: http:\/\/localhost(?::\d+)?\/sub\/secure-backup-sg\/mihomo\/sub_backup_sg_standard/
      )
    );
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('sub_acme_hkg_premium'));
  });

  it('bulk copies diagnostics for selected filtered subscription identities', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText
      }
    });
    renderPage({ subscriptionClients: [subscriptionClient, backupSubscriptionClient] });

    await user.type(screen.getByRole('searchbox', { name: '搜索订阅身份' }), 'backup');
    await user.click(screen.getByRole('checkbox', { name: '选择 Backup 新加坡 Standard 订阅' }));
    await user.click(screen.getByRole('button', { name: '批量复制订阅诊断' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedDiagnostics = writeText.mock.calls[0]?.[0] as string;
    expect(copiedDiagnostics).toContain('Sub ID: sub_backup_sg_standard');
    expect(copiedDiagnostics).toContain('Display Name: Backup 新加坡 Standard 订阅');
    expect(copiedDiagnostics).toContain('Email: backup@example.com');
    expect(copiedDiagnostics).toContain('Subscription-Userinfo:');
    expect(copiedDiagnostics).toContain('Generated Nodes: 1');
    expect(copiedDiagnostics).toContain('Request Limit: 360 req/h');
    expect(copiedDiagnostics).toContain('Guardrail: active');
    expect(copiedDiagnostics).not.toContain('sub_acme_hkg_premium');
  });

  it('bulk disables selected subscription identities from the filtered table', async () => {
    const user = userEvent.setup();
    const onSaveClient = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    renderPage({ subscriptionClients: [subscriptionClient, backupSubscriptionClient], onSaveClient });

    await user.type(screen.getByRole('searchbox', { name: '搜索订阅身份' }), 'backup');
    await user.click(screen.getByRole('checkbox', { name: '选择 Backup 新加坡 Standard 订阅' }));
    await user.click(screen.getByRole('button', { name: '批量停用' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('停用 1 个已选订阅身份'));
    expect(onSaveClient).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: '批量停用' }));

    expect(onSaveClient).toHaveBeenCalledTimes(1);
    expect(onSaveClient).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionClientId: 'sub-client-backup-sg',
        subId: 'sub_backup_sg_standard',
        enabled: false
      }),
      'update'
    );
    expect(onSaveClient).not.toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionClientId: 'sub-client-acme-hkg' }),
      expect.anything()
    );
  });

  it('bulk adds traffic quota to selected subscription identities from the filtered table', async () => {
    const user = userEvent.setup();
    const onSaveClient = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    renderPage({ subscriptionClients: [subscriptionClient, backupSubscriptionClient], onSaveClient });

    await user.type(screen.getByRole('searchbox', { name: '搜索订阅身份' }), 'backup');
    await user.click(screen.getByRole('checkbox', { name: '选择 Backup 新加坡 Standard 订阅' }));
    await user.clear(screen.getByRole('spinbutton', { name: '批量加流量 GB' }));
    await user.type(screen.getByRole('spinbutton', { name: '批量加流量 GB' }), '200');
    await user.click(screen.getByRole('button', { name: '批量加流量' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('给 1 个已选订阅身份增加 200 GB 流量'));
    expect(onSaveClient).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: '批量加流量' }));

    expect(onSaveClient).toHaveBeenCalledTimes(1);
    expect(onSaveClient).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionClientId: 'sub-client-backup-sg',
        subId: 'sub_backup_sg_standard',
        trafficLimitGb: 1224,
        usedTrafficGb: 128,
        enabled: true
      }),
      'update'
    );
    expect(onSaveClient).not.toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionClientId: 'sub-client-acme-hkg' }),
      expect.anything()
    );
  });

  it('bulk renews selected subscription identities by extending their current remaining days', async () => {
    const user = userEvent.setup();
    const onSaveClient = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const remainingDays = Math.ceil(
      Math.max(Date.parse(backupSubscriptionClient.expiresAt) - Date.now(), 0) / 24 / 60 / 60 / 1000
    );
    renderPage({ subscriptionClients: [subscriptionClient, backupSubscriptionClient], onSaveClient });

    await user.type(screen.getByRole('searchbox', { name: '搜索订阅身份' }), 'backup');
    await user.click(screen.getByRole('checkbox', { name: '选择 Backup 新加坡 Standard 订阅' }));
    await user.clear(screen.getByRole('spinbutton', { name: '批量续期天数' }));
    await user.type(screen.getByRole('spinbutton', { name: '批量续期天数' }), '45');
    await user.click(screen.getByRole('button', { name: '批量续期' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('给 1 个已选订阅身份续期 45 天'));
    expect(onSaveClient).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: '批量续期' }));

    expect(onSaveClient).toHaveBeenCalledTimes(1);
    expect(onSaveClient).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionClientId: 'sub-client-backup-sg',
        subId: 'sub_backup_sg_standard',
        remainingDays: remainingDays + 45,
        trafficLimitGb: 1024,
        enabled: true
      }),
      'update'
    );
    expect(onSaveClient).not.toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionClientId: 'sub-client-acme-hkg' }),
      expect.anything()
    );
  });

  it('bulk resets used traffic for selected subscription identities', async () => {
    const user = userEvent.setup();
    const onSaveClient = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    renderPage({ subscriptionClients: [subscriptionClient, backupSubscriptionClient], onSaveClient });

    await user.type(screen.getByRole('searchbox', { name: '搜索订阅身份' }), 'backup');
    await user.click(screen.getByRole('checkbox', { name: '选择 Backup 新加坡 Standard 订阅' }));
    await user.click(screen.getByRole('button', { name: '批量重置已用流量' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('清零 1 个已选订阅身份的已用流量'));
    expect(onSaveClient).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: '批量重置已用流量' }));

    expect(onSaveClient).toHaveBeenCalledTimes(1);
    expect(onSaveClient).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionClientId: 'sub-client-backup-sg',
        subId: 'sub_backup_sg_standard',
        trafficLimitGb: 1024,
        usedTrafficGb: 0,
        enabled: true
      }),
      'update'
    );
    expect(onSaveClient).not.toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionClientId: 'sub-client-acme-hkg' }),
      expect.anything()
    );
  });

  it('requires confirmation before bulk deleting selected subscription identities', async () => {
    const user = userEvent.setup();
    const onDeleteClient = vi.fn();
    renderPage({ subscriptionClients: [subscriptionClient, backupSubscriptionClient], onDeleteClient });

    await user.type(screen.getByRole('searchbox', { name: '搜索订阅身份' }), 'backup');
    await user.click(screen.getByRole('checkbox', { name: '选择 Backup 新加坡 Standard 订阅' }));
    const bulkDeleteButton = screen.getByRole('button', { name: '批量删除' });

    expect(bulkDeleteButton.outerHTML).toContain('#DC2626');
    expect(bulkDeleteButton.outerHTML).not.toMatch(/\b(?:border|bg|text|ring)-red-/u);
    expect(bulkDeleteButton.outerHTML).not.toContain('rose-');
    await user.click(bulkDeleteButton);

    expect(onDeleteClient).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '确认删除 1 个订阅身份' }));

    expect(onDeleteClient).toHaveBeenCalledTimes(1);
    expect(onDeleteClient).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionClientId: 'sub-client-backup-sg',
        subId: 'sub_backup_sg_standard'
      })
    );
    expect(onDeleteClient).not.toHaveBeenCalledWith(expect.objectContaining({ subscriptionClientId: 'sub-client-acme-hkg' }));
  });

  it('requires confirmation before deleting a single subscription identity row', async () => {
    const user = userEvent.setup();
    const onDeleteClient = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    renderPage({ subscriptionClients: [subscriptionClient, backupSubscriptionClient], onDeleteClient });

    await user.type(screen.getByRole('searchbox', { name: '搜索订阅身份' }), 'backup');
    await user.click(screen.getByRole('button', { name: '删除' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('删除 Backup 新加坡 Standard 订阅'));
    expect(onDeleteClient).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: '删除' }));

    expect(onDeleteClient).toHaveBeenCalledTimes(1);
    expect(onDeleteClient).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionClientId: 'sub-client-backup-sg',
        subId: 'sub_backup_sg_standard'
      })
    );
    expect(onDeleteClient).not.toHaveBeenCalledWith(expect.objectContaining({ subscriptionClientId: 'sub-client-acme-hkg' }));
  });

  it('submits client subscription rule metadata with protocol, filters, traffic condition, quota, formats, token and secure path preview', async () => {
    const user = userEvent.setup({ delay: null });
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
    await user.selectOptions(within(drawer).getByLabelText('流量条件'), 'quota-exceeded');
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
        routingRule: 'tag:hk AND tag:premium AND traffic:quota-exceeded',
        trafficFilter: 'quota-exceeded',
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
          routingRule: 'tag:hk AND tag:premium AND traffic:quota-exceeded',
          trafficFilter: 'quota-exceeded',
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
