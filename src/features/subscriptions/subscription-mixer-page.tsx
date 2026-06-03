import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Download, FileSliders, Layers3, Pencil, Plus, RefreshCcw, Shuffle, Trash2 } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { ConfigDrawer } from '../../components/ui/config-drawer';
import { GlassToggle } from '../../components/ui/glass-toggle';
import { GlowButton } from '../../components/ui/glow-button';
import { applySubscriptionSourceRules, selectSubscriptionInventoryNodes } from '../../domain';
import type {
  ProxyProviderConfig,
  SubscriptionBundle,
  SubscriptionClientFormat,
  SubscriptionClientIdentity,
  SubscriptionExportFile,
  SubscriptionInventoryNode,
  SubscriptionSource,
  SubscriptionSourceKind,
  XrayProtocol
} from '../../domain';
import { formatBytes, formatDateTime, formatNumber } from '../shared/format';

export type { SubscriptionBundle };

type SubscriptionMixerPageProps = {
  subscriptions: SubscriptionBundle[];
  subscriptionSources: SubscriptionSource[];
  language: AppLanguage;
  taskMutationBusy?: boolean;
  onImportSource: (metadata: SubscriptionSourceImportMetadata) => void;
  onRunTask: (id: string) => void;
};

export type SubscriptionSourceImportMetadata = {
  sourceId: string;
  kind: SubscriptionSourceKind;
  name: string;
  url: string;
  userAgent: string;
  refreshIntervalMinutes: number;
  includeFilter: string;
  excludeFilter: string;
  dedupeKey: SubscriptionSource['dedupeKey'];
};

type SourceRuleState = Pick<SubscriptionSourceImportMetadata, 'includeFilter' | 'excludeFilter' | 'dedupeKey'>;

type Workspace = 'clients' | 'sources' | 'inventory' | 'providers' | 'exports';
type DrawerState = { type: 'closed' } | { type: 'client'; id?: string } | { type: 'source' };

type ClientDraft = {
  subId: string;
  email: string;
  protocol: XrayProtocol;
  group: string;
  trafficLimitGb: string;
  usedTrafficGb: string;
  remainingDays: string;
  ipLimit: string;
  selectedTags: string;
  routingRule: string;
  formats: SubscriptionClientFormat[];
  enabled: boolean;
};

type SourceDraft = {
  kind: SubscriptionSourceKind;
  name: string;
  url: string;
  userAgent: string;
  refreshInterval: string;
  includeFilter: string;
  excludeFilter: string;
  dedupeKey: SubscriptionSource['dedupeKey'];
};

const copy = {
  zh: {
    title: '节点订阅',
    subtitle: '按 3X-UI 的客户订阅身份和 miaomiaowu 的订阅链路拆分：订阅身份、外部订阅源、节点库存、代理集合和导出文件独立维护。',
    clientsTab: '订阅身份',
    sourcesTab: '外部订阅源',
    inventoryTab: '节点库存',
    providersTab: '代理集合',
    exportsTab: '导出文件',
    addClient: '新增订阅身份',
    importSource: '导入订阅源',
    clientCount: '订阅身份',
    inventoryCount: '库存节点',
    exportCount: '导出文件',
    clientTitle: '客户订阅规则',
    clientHint: '订阅身份以 subId 为入口，聚合客户可见节点、协议、流量、到期、IP 限制和输出格式。',
    subId: 'Sub ID',
    email: '客户 Email',
    protocol: '协议',
    group: '分组',
    trafficLimit: '流量上限',
    usedTraffic: '已用流量',
    expires: '到期',
    ipLimit: 'IP 限制',
    selectedTags: '节点标签',
    routingRule: '规则表达式',
    formats: '输出格式',
    enabled: '启用',
    disabled: '停用',
    actions: '操作',
    edit: '编辑',
    delete: '删除',
    save: '保存',
    cancel: '取消',
    preview: '订阅地址预览',
    noClients: '暂无订阅身份',
    sourceName: '订阅源',
    sourceUrl: '源地址',
    sourceStatus: '状态',
    sourceNodes: '节点数',
    lastSync: '同步时间',
    noSources: '暂无外部订阅源',
    nodeName: '节点名称',
    server: '服务器',
    tags: '标签',
    origin: '来源',
    noInventory: '暂无节点库存',
    providerName: '代理集合',
    filter: '包含过滤',
    excludeFilter: '排除过滤',
    processMode: '处理模式',
    overrideRule: '覆盖规则',
    noProviders: '暂无代理集合',
    exportName: '导出文件',
    template: '模板',
    accessToken: '访问令牌',
    generate: '生成',
    noExports: '暂无导出文件',
    unitGb: 'GB',
    unitDays: '天',
    sourceDrawerTitle: '导入外部订阅源',
    sourceDrawerHint: '源会先登记为外部订阅，再同步进节点库存，之后由代理集合和导出文件引用。',
    sourceKind: '源类型',
    sourceDisplayName: '源名称',
    userAgent: 'User-Agent',
    refreshInterval: '刷新间隔',
    sourceDedupe: '去重策略',
    matchedNodes: '命中节点'
  },
  en: {
    title: 'Node Subscriptions',
    subtitle: 'Split subscriptions into 3X-UI-style client identities and miaomiaowu-style source, inventory, provider, and export-file layers.',
    clientsTab: 'Identities',
    sourcesTab: 'External Sources',
    inventoryTab: 'Node Inventory',
    providersTab: 'Proxy Providers',
    exportsTab: 'Export Files',
    addClient: 'Add Identity',
    importSource: 'Import Source',
    clientCount: 'Identities',
    inventoryCount: 'Inventory Nodes',
    exportCount: 'Export Files',
    clientTitle: 'Client Subscription Rules',
    clientHint: 'Each subId aggregates visible nodes, protocol, quota, expiry, IP limits, routing rules, and output formats.',
    subId: 'Sub ID',
    email: 'Client Email',
    protocol: 'Protocol',
    group: 'Group',
    trafficLimit: 'Traffic Limit',
    usedTraffic: 'Used Traffic',
    expires: 'Expires',
    ipLimit: 'IP Limit',
    selectedTags: 'Node Tags',
    routingRule: 'Rule Expression',
    formats: 'Formats',
    enabled: 'Enabled',
    disabled: 'Disabled',
    actions: 'Actions',
    edit: 'Edit',
    delete: 'Delete',
    save: 'Save',
    cancel: 'Cancel',
    preview: 'Subscription URL Preview',
    noClients: 'No subscription identities yet',
    sourceName: 'Source',
    sourceUrl: 'Source URL',
    sourceStatus: 'Status',
    sourceNodes: 'Nodes',
    lastSync: 'Last Sync',
    noSources: 'No external sources yet',
    nodeName: 'Node Name',
    server: 'Server',
    tags: 'Tags',
    origin: 'Source',
    noInventory: 'No inventory nodes yet',
    providerName: 'Proxy Provider',
    filter: 'Include Filter',
    excludeFilter: 'Exclude Filter',
    processMode: 'Process Mode',
    overrideRule: 'Override Rule',
    noProviders: 'No proxy providers yet',
    exportName: 'Export File',
    template: 'Template',
    accessToken: 'Access Token',
    generate: 'Generate',
    noExports: 'No export files yet',
    unitGb: 'GB',
    unitDays: 'days',
    sourceDrawerTitle: 'Import External Source',
    sourceDrawerHint: 'Sources are registered first, synchronized into inventory, then referenced by proxy providers and export files.',
    sourceKind: 'Source Kind',
    sourceDisplayName: 'Source Name',
    userAgent: 'User-Agent',
    refreshInterval: 'Refresh Interval',
    sourceDedupe: 'Dedupe Strategy',
    matchedNodes: 'Matched Nodes'
  }
} as const;

function createDefaultClientDraft(): ClientDraft {
  return {
    subId: 'sub_hkg_premium_01',
    email: 'client@example.com',
    protocol: 'vless',
    group: 'premium',
    trafficLimitGb: '1024',
    usedTrafficGb: '128',
    remainingDays: '30',
    ipLimit: '3',
    selectedTags: 'hk,premium,streaming',
    routingRule: 'tag:hk AND tag:premium',
    formats: ['plain', 'json', 'clash'],
    enabled: true
  };
}

function createClientFromDraft(draft: ClientDraft, existingId?: string): SubscriptionClientIdentity {
  const remainingDays = Math.max(Number.parseInt(draft.remainingDays, 10) || 0, 0);
  const trafficLimitGb = Math.max(Number.parseInt(draft.trafficLimitGb, 10) || 0, 0);
  const usedTrafficGb = Math.max(Number.parseInt(draft.usedTrafficGb, 10) || 0, 0);

  return {
    id: existingId ?? `sub-client-${Date.now()}`,
    subId: draft.subId.trim() || 'manual',
    email: draft.email.trim() || 'client@example.com',
    enabled: draft.enabled,
    protocol: draft.protocol,
    group: draft.group.trim() || 'default',
    trafficLimitBytes: trafficLimitGb * 1024 * 1024 * 1024,
    usedTrafficBytes: usedTrafficGb * 1024 * 1024 * 1024,
    expiresAt: new Date(Date.now() + remainingDays * 24 * 60 * 60 * 1000).toISOString(),
    ipLimit: Math.max(Number.parseInt(draft.ipLimit, 10) || 0, 0),
    selectedTags: draft.selectedTags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    routingRule: draft.routingRule.trim() || 'manual',
    formats: draft.formats,
    lastOnlineAt: new Date().toISOString()
  };
}

function createDraftFromClient(client: SubscriptionClientIdentity): ClientDraft {
  const remainingMs = Math.max(Date.parse(client.expiresAt) - Date.now(), 0);

  return {
    subId: client.subId,
    email: client.email,
    protocol: client.protocol as XrayProtocol,
    group: client.group,
    trafficLimitGb: String(Math.round(client.trafficLimitBytes / 1024 / 1024 / 1024)),
    usedTrafficGb: String(Math.round(client.usedTrafficBytes / 1024 / 1024 / 1024)),
    remainingDays: String(Math.ceil(remainingMs / 24 / 60 / 60 / 1000)),
    ipLimit: String(client.ipLimit),
    selectedTags: client.selectedTags.join(','),
    routingRule: client.routingRule,
    formats: client.formats,
    enabled: client.enabled
  };
}

function createInitialClients(): SubscriptionClientIdentity[] {
  return [
    {
      id: 'sub-client-acme',
      subId: 'sub_acme_hkg_premium',
      email: 'acme@example.com',
      enabled: true,
      protocol: 'vless',
      group: 'premium',
      trafficLimitBytes: 1024 * 1024 * 1024 * 1024,
      usedTrafficBytes: 128 * 1024 * 1024 * 1024,
      expiresAt: '2026-12-31T23:59:59.000Z',
      ipLimit: 3,
      selectedTags: ['hk', 'premium', 'streaming'],
      routingRule: 'tag:hk AND tag:premium',
      formats: ['plain', 'json', 'clash'],
      lastOnlineAt: '2026-06-02T00:00:00.000Z'
    }
  ];
}

function mapBundleSources(subscriptions: SubscriptionBundle[]): SubscriptionSource[] {
  return subscriptions.flatMap((bundle) =>
    bundle.sources.map((source) => ({
      id: source.id,
      kind: 'clash' as const,
      name: source.name,
      url: source.url,
      status: source.status === 'ok' ? 'synced' : source.status,
      nodeCount: source.nodeCount,
      dedupeKey: 'server-port' as const,
      lastSyncAt: source.lastSyncAt,
      rateLimitPerMinute: 60
    }))
  );
}

function mergeSubscriptionSources(...sourceGroups: SubscriptionSource[][]) {
  const sourcesById = new Map<string, SubscriptionSource>();

  sourceGroups.flat().forEach((source) => {
    if (!sourcesById.has(source.id)) {
      sourcesById.set(source.id, source);
    }
  });

  return Array.from(sourcesById.values());
}

function createDefaultSourceDraft(): SourceDraft {
  return {
    kind: 'clash',
    name: '香港 Premium 外部订阅',
    url: 'https://provider.example.com/sub.yaml',
    userAgent: 'OU-UI-Next/1.0',
    refreshInterval: '60',
    includeFilter: 'premium|streaming',
    excludeFilter: 'expired|test',
    dedupeKey: 'server-port'
  };
}

function createSourceFromDraft(draft: SourceDraft): SubscriptionSource {
  return {
    id: `source-${Date.now()}`,
    kind: draft.kind,
    name: draft.name.trim() || 'Manual Source',
    url: draft.url.trim() || 'https://provider.example.com/sub.yaml',
    status: 'syncing',
    nodeCount: 0,
    dedupeKey: draft.dedupeKey,
    lastSyncAt: new Date().toISOString(),
    rateLimitPerMinute: Math.max(Number.parseInt(draft.refreshInterval, 10) || 60, 1)
  };
}

function createInventoryNodes(sources: SubscriptionSource[]): SubscriptionInventoryNode[] {
  return sources.flatMap((source, sourceIndex) =>
    Array.from({ length: Math.max(Math.min(source.nodeCount || 3, 3), 1) }, (_, index) => ({
        id: `inventory-${source.id}-${index}`,
        sourceId: source.id,
        name: `${source.name} / ${index + 1}`,
        protocol: index % 2 === 0 ? 'vless' : 'trojan',
        server: `203.0.${sourceIndex}.${index + 10}`,
        port: index % 2 === 0 ? 443 : 8443,
        tags: [source.kind, source.status, index % 2 === 0 ? 'premium' : 'streaming'],
        rawUrl: source.url,
        inboundTag: `inbound-${source.id}-${index}`
      }))
  );
}

function createProviders(sources: SubscriptionSource[], sourceRules: Record<string, SourceRuleState>): ProxyProviderConfig[] {
  return sources.map((source) => ({
    id: `provider-${source.id}`,
    name: `${source.name} Provider`,
    externalSubscriptionId: source.id,
    filter: sourceRules[source.id]?.includeFilter || (source.kind === 'manual' ? 'manual|owned' : 'premium|streaming'),
    excludeFilter: sourceRules[source.id]?.excludeFilter ?? 'expired|test',
    geoIpFilter: 'geoip:!cn',
    processMode: source.kind === 'manual' ? 'client' : 'server',
    overrideRule: `source:${source.id};dedupe:${sourceRules[source.id]?.dedupeKey ?? source.dedupeKey}`
  }));
}

function createExportFiles(subscriptions: SubscriptionBundle[], providers: ProxyProviderConfig[]): SubscriptionExportFile[] {
  return subscriptions.map((bundle) => ({
    id: `export-${bundle.id}`,
    name: `${bundle.name} Clash`,
    templateName: `${bundle.strategy}.yaml`,
    selectedTags: [bundle.strategy, 'premium'],
    selectedProviderIds: providers.map((provider) => provider.id),
    formats: ['plain', 'clash'],
    trafficLimitBytes: bundle.generatedNodeCount * 10 * 1024 * 1024 * 1024,
    expiresAt: '2026-12-31T23:59:59.000Z',
    accessTokenPreview: `sub_${bundle.id.slice(0, 8)}...`
  }));
}

function buildSubscriptionUrls(draft: ClientDraft) {
  const subId = encodeURIComponent(draft.subId.trim() || 'manual');
  const query = new URLSearchParams();

  if (draft.selectedTags.trim()) {
    query.set('tags', draft.selectedTags.trim());
  }

  if (draft.routingRule.trim()) {
    query.set('rule', draft.routingRule.trim());
  }

  query.set('protocol', draft.protocol);
  const suffix = query.toString();

  return {
    plain: `/sub/${subId}${suffix ? `?${suffix}` : ''}`,
    json: `/json/${subId}${suffix ? `?${suffix}` : ''}`,
    clash: `/clash/${subId}${suffix ? `?${suffix}` : ''}`
  };
}

function findMatchingInventoryNodes(nodes: SubscriptionInventoryNode[], draft: ClientDraft) {
  const selectedTags = draft.selectedTags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  return selectSubscriptionInventoryNodes(nodes, {
    selectedTags,
    routingRule: draft.routingRule,
    protocol: draft.protocol
  }).slice(0, 5);
}

export function SubscriptionMixerPage({
  subscriptions,
  subscriptionSources,
  language,
  taskMutationBusy = false,
  onImportSource,
  onRunTask
}: SubscriptionMixerPageProps) {
  const t = copy[language];
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>('clients');
  const [drawer, setDrawer] = useState<DrawerState>({ type: 'closed' });
  const [clients, setClients] = useState<SubscriptionClientIdentity[]>(createInitialClients);
  const [removedSourceIds, setRemovedSourceIds] = useState<string[]>([]);
  const [customSources, setCustomSources] = useState<SubscriptionSource[]>([]);
  const [sourceRules, setSourceRules] = useState<Record<string, SourceRuleState>>({});
  const [clientDraft, setClientDraft] = useState<ClientDraft>(createDefaultClientDraft);
  const [sourceDraft, setSourceDraft] = useState<SourceDraft>(createDefaultSourceDraft);
  const bundleSources = useMemo(() => mapBundleSources(subscriptions), [subscriptions]);
  const sources = useMemo(
    () =>
      mergeSubscriptionSources(customSources, subscriptionSources, bundleSources).filter(
        (source) => !removedSourceIds.includes(source.id)
      ),
    [bundleSources, customSources, removedSourceIds, subscriptionSources]
  );
  const inventoryNodes = useMemo(
    () =>
      sources.flatMap((source) =>
        applySubscriptionSourceRules(createInventoryNodes([source]), {
          includeFilter: sourceRules[source.id]?.includeFilter,
          excludeFilter: sourceRules[source.id]?.excludeFilter,
          dedupeKey: sourceRules[source.id]?.dedupeKey ?? source.dedupeKey
        })
      ),
    [sources, sourceRules]
  );
  const providers = useMemo(() => createProviders(sources, sourceRules), [sources, sourceRules]);
  const exportFiles = useMemo(() => createExportFiles(subscriptions, providers), [subscriptions, providers]);
  const editingClient = drawer.type === 'client' && drawer.id ? clients.find((client) => client.id === drawer.id) : undefined;
  const subscriptionUrls = buildSubscriptionUrls(clientDraft);
  const matchedInventoryNodes = useMemo(() => findMatchingInventoryNodes(inventoryNodes, clientDraft), [clientDraft, inventoryNodes]);

  function openClientDrawer(client?: SubscriptionClientIdentity) {
    setClientDraft(client ? createDraftFromClient(client) : createDefaultClientDraft());
    setDrawer({ type: 'client', id: client?.id });
  }

  function toggleFormat(format: SubscriptionClientFormat) {
    setClientDraft((current) => ({
      ...current,
      formats: current.formats.includes(format)
        ? current.formats.filter((item) => item !== format)
        : [...current.formats, format]
    }));
  }

  function openSourceDrawer() {
    setSourceDraft(createDefaultSourceDraft());
    setDrawer({ type: 'source' });
  }

  function saveClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextClient = createClientFromDraft(clientDraft, editingClient?.id);
    setClients((current) =>
      editingClient ? current.map((client) => (client.id === editingClient.id ? nextClient : client)) : [nextClient, ...current]
    );
    setDrawer({ type: 'closed' });
    setActiveWorkspace('clients');
  }

  function saveSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSource = createSourceFromDraft(sourceDraft);

    onImportSource({
      sourceId: nextSource.id,
      kind: sourceDraft.kind,
      name: nextSource.name,
      url: nextSource.url,
      userAgent: sourceDraft.userAgent.trim() || 'OU-UI-Next/1.0',
      refreshIntervalMinutes: nextSource.rateLimitPerMinute,
      includeFilter: sourceDraft.includeFilter.trim(),
      excludeFilter: sourceDraft.excludeFilter.trim(),
      dedupeKey: nextSource.dedupeKey
    });
    setCustomSources((current) => [nextSource, ...current]);
    setSourceRules((current) => ({
      ...current,
      [nextSource.id]: {
        includeFilter: sourceDraft.includeFilter.trim(),
        excludeFilter: sourceDraft.excludeFilter.trim(),
        dedupeKey: nextSource.dedupeKey
      }
    }));
    setDrawer({ type: 'closed' });
    setActiveWorkspace('sources');
  }

  return (
    <div className="space-y-6">
      <section className="stagger-1">
        <h3 className="text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
        <p className="mt-1 max-w-3xl text-xs leading-6 text-slate-500 dark:text-white/50">{t.subtitle}</p>
      </section>

      <section className="stagger-2 island-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            <WorkspaceButton active={activeWorkspace === 'clients'} label={t.clientsTab} onClick={() => setActiveWorkspace('clients')} />
            <WorkspaceButton active={activeWorkspace === 'sources'} label={t.sourcesTab} onClick={() => setActiveWorkspace('sources')} />
            <WorkspaceButton active={activeWorkspace === 'inventory'} label={t.inventoryTab} onClick={() => setActiveWorkspace('inventory')} />
            <WorkspaceButton active={activeWorkspace === 'providers'} label={t.providersTab} onClick={() => setActiveWorkspace('providers')} />
            <WorkspaceButton active={activeWorkspace === 'exports'} label={t.exportsTab} onClick={() => setActiveWorkspace('exports')} />
          </div>
          <div className="flex flex-wrap gap-2">
            <GlowButton className="gap-2 px-4 py-2 text-xs" onClick={openSourceDrawer}>
              <Download className="h-3.5 w-3.5" />
              {t.importSource}
            </GlowButton>
            <GlowButton className="gap-2 px-4 py-2 text-xs" onClick={() => openClientDrawer()}>
              <Plus className="h-3.5 w-3.5" />
              {t.addClient}
            </GlowButton>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <SummaryMetric icon={Shuffle} label={t.clientCount} value={formatNumber(clients.length, language)} />
          <SummaryMetric icon={Layers3} label={t.inventoryCount} value={formatNumber(inventoryNodes.length, language)} />
          <SummaryMetric icon={FileSliders} label={t.exportCount} value={formatNumber(exportFiles.length, language)} />
        </div>
      </section>

      {activeWorkspace === 'clients' ? (
        <DataSection title={t.clientTitle} hint={t.clientHint}>
          {clients.length === 0 ? (
            <EmptyState label={t.noClients} />
          ) : (
            <Table minWidth="980px">
              <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                <tr>
                  <th className="px-5 py-3">{t.subId}</th>
                  <th className="px-5 py-3">{t.email}</th>
                  <th className="px-5 py-3">{t.protocol}</th>
                  <th className="px-5 py-3">{t.trafficLimit}</th>
                  <th className="px-5 py-3">{t.selectedTags}</th>
                  <th className="px-5 py-3">{t.formats}</th>
                  <th className="px-5 py-3 text-right">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                {clients.map((client) => (
                  <tr key={client.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                    <td className="px-5 py-4">
                      <p className="font-mono text-xs font-bold text-slate-900 dark:text-white">{client.subId}</p>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                        {client.enabled ? t.enabled : t.disabled} / {client.group}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">{client.email}</td>
                    <td className="px-5 py-4">
                      <p className="text-xs font-bold uppercase text-slate-800 dark:text-white/80">{client.protocol}</p>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">IP {client.ipLimit}</p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-xs font-semibold text-slate-700 dark:text-white/70">
                        {formatBytes(client.usedTrafficBytes)} / {formatBytes(client.trafficLimitBytes)}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">{formatDateTime(client.expiresAt, language)}</p>
                    </td>
                    <td className="px-5 py-4">
                      <TagList tags={client.selectedTags} />
                    </td>
                    <td className="px-5 py-4">
                      <TagList tags={client.formats} />
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <IconButton label={t.edit} onClick={() => openClientDrawer(client)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton danger label={t.delete} onClick={() => setClients((current) => current.filter((item) => item.id !== client.id))}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataSection>
      ) : null}

      {activeWorkspace === 'sources' ? (
        <DataSection title={t.sourcesTab}>
          {sources.length === 0 ? (
            <EmptyState label={t.noSources} />
          ) : (
            <Table minWidth="860px">
              <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                <tr>
                  <th className="px-5 py-3">{t.sourceName}</th>
                  <th className="px-5 py-3">{t.sourceUrl}</th>
                  <th className="px-5 py-3">{t.sourceNodes}</th>
                  <th className="px-5 py-3">{t.lastSync}</th>
                  <th className="px-5 py-3">{t.sourceStatus}</th>
                  <th className="px-5 py-3 text-right">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                {sources.map((source) => (
                  <tr key={source.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                    <td className="px-5 py-4 text-sm font-bold text-slate-900 dark:text-white">{source.name}</td>
                    <td className="px-5 py-4 font-mono text-[11px] text-slate-500 dark:text-white/45">{source.url}</td>
                    <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">{formatNumber(source.nodeCount, language)}</td>
                    <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">{formatDateTime(source.lastSyncAt, language)}</td>
                    <td className="px-5 py-4 text-xs font-bold uppercase text-slate-500 dark:text-white/50">{source.status}</td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <IconButton label={t.delete} onClick={() => setRemovedSourceIds((current) => [...current, source.id])}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataSection>
      ) : null}

      {activeWorkspace === 'inventory' ? (
        <DataSection title={t.inventoryTab}>
          {inventoryNodes.length === 0 ? (
            <EmptyState label={t.noInventory} />
          ) : (
            <Table minWidth="860px">
              <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                <tr>
                  <th className="px-5 py-3">{t.nodeName}</th>
                  <th className="px-5 py-3">{t.protocol}</th>
                  <th className="px-5 py-3">{t.server}</th>
                  <th className="px-5 py-3">{t.tags}</th>
                  <th className="px-5 py-3">{t.origin}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                {inventoryNodes.map((node) => (
                  <tr key={node.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                    <td className="px-5 py-4 text-sm font-bold text-slate-900 dark:text-white">{node.name}</td>
                    <td className="px-5 py-4 text-xs font-bold uppercase text-slate-700 dark:text-white/70">{node.protocol}</td>
                    <td className="px-5 py-4 font-mono text-xs text-slate-700 dark:text-white/70">{node.server}:{node.port}</td>
                    <td className="px-5 py-4"><TagList tags={node.tags} /></td>
                    <td className="px-5 py-4 text-[11px] text-slate-500 dark:text-white/45">{node.sourceId}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataSection>
      ) : null}

      {activeWorkspace === 'providers' ? (
        <DataSection title={t.providersTab}>
          {providers.length === 0 ? (
            <EmptyState label={t.noProviders} />
          ) : (
            <ProviderTable providers={providers} language={language} />
          )}
        </DataSection>
      ) : null}

      {activeWorkspace === 'exports' ? (
        <DataSection title={t.exportsTab}>
          {exportFiles.length === 0 ? (
            <EmptyState label={t.noExports} />
          ) : (
            <Table minWidth="900px">
              <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                <tr>
                  <th className="px-5 py-3">{t.exportName}</th>
                  <th className="px-5 py-3">{t.template}</th>
                  <th className="px-5 py-3">{t.tags}</th>
                  <th className="px-5 py-3">{t.trafficLimit}</th>
                  <th className="px-5 py-3">{t.accessToken}</th>
                  <th className="px-5 py-3 text-right">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                {exportFiles.map((file, index) => (
                  <tr key={file.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                    <td className="px-5 py-4 text-sm font-bold text-slate-900 dark:text-white">{file.name}</td>
                    <td className="px-5 py-4 font-mono text-xs text-slate-700 dark:text-white/70">{file.templateName}</td>
                    <td className="px-5 py-4"><TagList tags={file.selectedTags} /></td>
                    <td className="px-5 py-4 text-xs font-semibold text-slate-700 dark:text-white/70">{formatBytes(file.trafficLimitBytes)}</td>
                    <td className="px-5 py-4 font-mono text-[11px] text-slate-500 dark:text-white/45">{file.accessTokenPreview}</td>
                    <td className="px-5 py-4 text-right">
                      <GlowButton
                        className="px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={taskMutationBusy}
                        onClick={() => onRunTask(subscriptions[index]?.id ?? file.id)}
                      >
                        <RefreshCcw className="h-3.5 w-3.5" />
                        {t.generate}
                      </GlowButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataSection>
      ) : null}

      <ConfigDrawer
        open={drawer.type === 'client'}
        title={editingClient ? t.edit : t.addClient}
        onClose={() => setDrawer({ type: 'closed' })}
      >
        <form className="space-y-4" onSubmit={saveClient}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <InputField label={t.subId} value={clientDraft.subId} onChange={(value) => setClientDraft((current) => ({ ...current, subId: value }))} />
            <InputField label={t.email} value={clientDraft.email} onChange={(value) => setClientDraft((current) => ({ ...current, email: value }))} />
            <SelectField
              label={t.protocol}
              value={clientDraft.protocol}
              onChange={(value) => setClientDraft((current) => ({ ...current, protocol: value as XrayProtocol }))}
              options={[
                { label: 'VLESS', value: 'vless' },
                { label: 'VMess', value: 'vmess' },
                { label: 'Trojan', value: 'trojan' },
                { label: 'Shadowsocks', value: 'shadowsocks' },
                { label: 'Hysteria', value: 'hysteria' }
              ]}
            />
            <InputField label={t.group} value={clientDraft.group} onChange={(value) => setClientDraft((current) => ({ ...current, group: value }))} />
            <InputField label={t.trafficLimit} suffix={t.unitGb} type="number" value={clientDraft.trafficLimitGb} onChange={(value) => setClientDraft((current) => ({ ...current, trafficLimitGb: value }))} />
            <InputField label={t.usedTraffic} suffix={t.unitGb} type="number" value={clientDraft.usedTrafficGb} onChange={(value) => setClientDraft((current) => ({ ...current, usedTrafficGb: value }))} />
            <InputField label={t.expires} suffix={t.unitDays} type="number" value={clientDraft.remainingDays} onChange={(value) => setClientDraft((current) => ({ ...current, remainingDays: value }))} />
            <InputField label={t.ipLimit} type="number" value={clientDraft.ipLimit} onChange={(value) => setClientDraft((current) => ({ ...current, ipLimit: value }))} />
          </div>
          <InputField label={t.selectedTags} value={clientDraft.selectedTags} onChange={(value) => setClientDraft((current) => ({ ...current, selectedTags: value }))} />
          <InputField label={t.routingRule} value={clientDraft.routingRule} onChange={(value) => setClientDraft((current) => ({ ...current, routingRule: value }))} />
          <div className="rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{t.formats}</p>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              {(['plain', 'json', 'clash'] as SubscriptionClientFormat[]).map((format) => (
                <label key={format} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-white/10">
                  <span className="text-xs font-bold uppercase text-slate-700 dark:text-white/70">{format}</span>
                  <GlassToggle aria-label={format} checked={clientDraft.formats.includes(format)} onChange={() => toggleFormat(format)} />
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
            <span className="text-xs font-bold text-slate-700 dark:text-white/70">{t.enabled}</span>
            <GlassToggle
              aria-label={t.enabled}
              checked={clientDraft.enabled}
              onChange={() => setClientDraft((current) => ({ ...current, enabled: !current.enabled }))}
            />
          </label>
          <div className="rounded-xl border border-slate-200 bg-slate-100/80 p-3 dark:border-white/10 dark:bg-black/20">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{t.preview}</p>
            <div className="space-y-1 font-mono text-[11px] text-slate-600 dark:text-white/60">
              {clientDraft.formats.map((format) => (
                <p key={format}>{format}: {subscriptionUrls[format]}</p>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{t.matchedNodes}</p>
            {matchedInventoryNodes.length > 0 ? <TagList tags={matchedInventoryNodes.map((node) => node.name)} /> : <EmptyState label={t.noInventory} />}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <GhostButton label={t.cancel} onClick={() => setDrawer({ type: 'closed' })} />
            <GlowButton className="px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60" disabled={taskMutationBusy} type="submit">{t.save}</GlowButton>
          </div>
        </form>
      </ConfigDrawer>

      <ConfigDrawer
        description={t.sourceDrawerHint}
        open={drawer.type === 'source'}
        title={t.sourceDrawerTitle}
        onClose={() => setDrawer({ type: 'closed' })}
      >
        <form className="space-y-4" onSubmit={saveSource}>
          <InputField
            label={t.sourceDisplayName}
            value={sourceDraft.name}
            onChange={(value) => setSourceDraft((current) => ({ ...current, name: value }))}
          />
          <SelectField
            label={t.sourceKind}
            value={sourceDraft.kind}
            onChange={(value) => setSourceDraft((current) => ({ ...current, kind: value as SubscriptionSourceKind }))}
            options={[
              { label: 'Clash', value: 'clash' },
              { label: 'Mihomo Provider', value: 'mihomo-provider' },
              { label: 'V2Ray URI', value: 'v2ray-uri' },
              { label: 'Sing-box', value: 'sing-box' }
            ]}
          />
          <InputField label={t.sourceUrl} value={sourceDraft.url} onChange={(value) => setSourceDraft((current) => ({ ...current, url: value }))} />
          <InputField label={t.userAgent} value={sourceDraft.userAgent} onChange={(value) => setSourceDraft((current) => ({ ...current, userAgent: value }))} />
          <InputField label={t.refreshInterval} suffix="min" type="number" value={sourceDraft.refreshInterval} onChange={(value) => setSourceDraft((current) => ({ ...current, refreshInterval: value }))} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <InputField label={t.filter} value={sourceDraft.includeFilter} onChange={(value) => setSourceDraft((current) => ({ ...current, includeFilter: value }))} />
            <InputField label={t.excludeFilter} value={sourceDraft.excludeFilter} onChange={(value) => setSourceDraft((current) => ({ ...current, excludeFilter: value }))} />
          </div>
          <SelectField
            label={t.sourceDedupe}
            value={sourceDraft.dedupeKey}
            onChange={(value) => setSourceDraft((current) => ({ ...current, dedupeKey: value as SubscriptionSource['dedupeKey'] }))}
            options={[
              { label: 'server-port', value: 'server-port' },
              { label: 'uuid', value: 'uuid' },
              { label: 'name-region', value: 'name-region' }
            ]}
          />
          <div className="flex justify-end gap-3 pt-2">
            <GhostButton label={t.cancel} onClick={() => setDrawer({ type: 'closed' })} />
            <GlowButton className="px-4 py-2 text-xs" type="submit">{t.save}</GlowButton>
          </div>
        </form>
      </ConfigDrawer>
    </div>
  );
}

function ProviderTable({ providers, language }: { providers: ProxyProviderConfig[]; language: AppLanguage }) {
  const t = copy[language];

  return (
    <Table minWidth="900px">
      <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
        <tr>
          <th className="px-5 py-3">{t.providerName}</th>
          <th className="px-5 py-3">{t.filter}</th>
          <th className="px-5 py-3">{t.excludeFilter}</th>
          <th className="px-5 py-3">{t.processMode}</th>
          <th className="px-5 py-3">{t.overrideRule}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-200 dark:divide-white/10">
        {providers.map((provider) => (
          <tr key={provider.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
            <td className="px-5 py-4 text-sm font-bold text-slate-900 dark:text-white">{provider.name}</td>
            <td className="px-5 py-4 font-mono text-[11px] text-slate-600 dark:text-white/60">{provider.filter}</td>
            <td className="px-5 py-4 font-mono text-[11px] text-slate-600 dark:text-white/60">{provider.excludeFilter}</td>
            <td className="px-5 py-4 text-xs font-bold uppercase text-slate-700 dark:text-white/70">{provider.processMode}</td>
            <td className="px-5 py-4 font-mono text-[11px] text-slate-600 dark:text-white/60">{provider.overrideRule}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function DataSection({ children, hint, title }: { children: ReactNode; hint?: string; title: string }) {
  return (
    <section className="stagger-3 island-card overflow-hidden">
      <div className="border-b border-slate-200 p-5 dark:border-white/10">
        <h4 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h4>
        {hint ? <p className="mt-1 max-w-3xl text-xs leading-6 text-slate-500 dark:text-white/45">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Table({ children, minWidth }: { children: ReactNode; minWidth: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

function WorkspaceButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={
        active
          ? 'rounded-xl bg-blue-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-blue-500/20 dark:bg-primary dark:text-slate-950'
          : 'rounded-xl border border-slate-200 bg-white/60 px-4 py-2 text-xs font-bold text-slate-500 transition hover:text-blue-600 dark:border-white/10 dark:bg-white/5 dark:text-white/50 dark:hover:text-primary'
      }
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function SummaryMetric({
  label,
  value,
  icon: Icon
}: {
  label: string;
  value: string;
  icon: typeof Shuffle;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/50 p-4 dark:border-white/10 dark:bg-black/10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
          <p className="mt-2 text-xl font-black text-slate-900 dark:text-white">{value}</p>
        </div>
        <Icon className="h-5 w-5 text-blue-500 dark:text-primary" />
      </div>
    </div>
  );
}

function IconButton({
  children,
  danger = false,
  label,
  onClick
}: {
  children: ReactNode;
  danger?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={
        danger
          ? 'rounded-full border border-rose-200 p-2 text-rose-500 transition hover:bg-rose-50 dark:border-rose-400/30 dark:hover:bg-rose-400/10'
          : 'rounded-full border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-blue-600 dark:border-white/10 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-primary'
      }
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function InputField({
  label,
  onChange,
  suffix,
  type = 'text',
  value
}: {
  label: string;
  onChange: (value: string) => void;
  suffix?: string;
  type?: 'number' | 'text';
  value: string;
}) {
  return (
    <label className="block rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</span>
      <span className="mt-2 flex items-center gap-2">
        <input
          aria-label={label}
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-white"
          min={type === 'number' ? 0 : undefined}
          onChange={(event) => onChange(event.target.value)}
          type={type}
          value={value}
        />
        {suffix ? <span className="text-[10px] font-bold text-slate-400 dark:text-white/35">{suffix}</span> : null}
      </span>
    </label>
  );
}

function SelectField({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label className="block rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</span>
      <select
        aria-label={label}
        className="mt-2 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TagList({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span key={tag} className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-600 dark:bg-primary/15 dark:text-primary">
          {tag}
        </span>
      ))}
    </div>
  );
}

function GhostButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 dark:border-white/10 dark:text-white/60"
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="p-8 text-center text-sm font-semibold text-slate-500 dark:text-white/50">{label}</div>;
}
