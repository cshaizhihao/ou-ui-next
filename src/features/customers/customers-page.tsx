import { useEffect, useMemo, useState, type RefObject } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Copy, Database, FolderSearch, Search, ServerCog, UserRound } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { ConfigDrawer } from '../../components/ui/config-drawer';
import { GlassCard } from '../../components/ui/glass-card';
import type { CustomerReadModel } from '../../domain';
import { cn } from '../../lib/cn';
import { formatBytes, formatDateTime, formatNumber } from '../shared/format';

type CustomersPageProps = {
  focusIntent?: CustomerFocusIntent;
  customers: CustomerReadModel[];
  language: AppLanguage;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

export type CustomerFocusIntent = {
  id: string;
  kind: 'customer.resources';
  targetId: string;
};

type CustomerSourceKind = CustomerReadModel['sourceKinds'][number];
type CustomerStatusFilter = '' | CustomerReadModel['status'];
type CustomerSourceFilter = '' | CustomerSourceKind;
type CustomerResourceKey = keyof typeof copy.zh.resourceLabels;

const copy = {
  zh: {
    title: '客户管理',
    subtitle: '客户目录由客户节点、订阅身份和端口转发归属自动汇总，受控主机只保留运行时承载关系。',
    totalCustomers: '客户总数',
    activeCustomers: '正常客户',
    limitedCustomers: '受限客户',
    totalUsage: '聚合用量',
    directoryTitle: '客户目录',
    customer: '客户',
    status: '状态',
    sources: '来源',
    resources: '资源',
    traffic: '流量',
    expiry: '到期',
    lastActivity: '最近活动',
    searchCustomers: '搜索客户',
    searchCustomersPlaceholder: '客户、资源 ID、订阅、转发或主机',
    customerStatus: '客户状态',
    allStatuses: '全部状态',
    customerSource: '客户来源',
    allSources: '全部来源',
    matchingCustomers: '当前匹配',
    selectVisibleCustomers: '选择当前客户',
    selectCustomer: (name: string) => `选择 ${name}`,
    selectedCustomers: '已选客户',
    bulkCopyResourceIds: '批量复制资源 ID',
    bulkCopyCustomerSummaries: '批量复制客户概要',
    noMatchingCustomers: '没有匹配的客户',
    actions: '操作',
    viewResources: '查看客户资源',
    resourceDrawerTitle: (name: string) => `${name} 客户资源`,
    resourceDrawerDescription: '按来源列出该客户关联的节点、订阅、转发规则和承载主机。',
    copyAllResourceIds: '复制全部资源 ID',
    quotaExceeded: '超出配额',
    runtimeDisabledByPolicy: '策略停用运行时',
    noResources: '暂无资源',
    noCustomers: '暂无客户',
    noLimit: '未设置配额',
    notAvailable: '未记录',
    sourceLabels: {
      'customer-node': '客户节点',
      subscription: '订阅',
      forwarding: '端口转发'
    },
    statusLabels: {
      active: '正常',
      limited: '受限',
      expired: '已到期'
    },
    resourceLabels: {
      customerNodes: '节点',
      subscriptions: '订阅',
      forwarding: '转发',
      agents: '主机'
    },
    resourceSectionLabels: {
      customerNodes: '客户节点',
      subscriptions: '订阅',
      forwarding: '转发',
      agents: '主机'
    }
  },
  en: {
    title: 'Customer Management',
    subtitle: 'The customer directory is derived from customer nodes, subscription identities, and port-forwarding ownership while managed hosts only carry runtime placement.',
    totalCustomers: 'Customers',
    activeCustomers: 'Active Customers',
    limitedCustomers: 'Limited Customers',
    totalUsage: 'Aggregated Usage',
    directoryTitle: 'Customer Directory',
    customer: 'Customer',
    status: 'Status',
    sources: 'Sources',
    resources: 'Resources',
    traffic: 'Traffic',
    expiry: 'Expiry',
    lastActivity: 'Last Activity',
    searchCustomers: 'Search Customers',
    searchCustomersPlaceholder: 'Customer, resource ID, subscription, forward, or host',
    customerStatus: 'Customer Status',
    allStatuses: 'All Statuses',
    customerSource: 'Customer Source',
    allSources: 'All Sources',
    matchingCustomers: 'Matching',
    selectVisibleCustomers: 'Select Visible Customers',
    selectCustomer: (name: string) => `Select ${name}`,
    selectedCustomers: 'Selected Customers',
    bulkCopyResourceIds: 'Bulk Copy Resource IDs',
    bulkCopyCustomerSummaries: 'Bulk Copy Customer Summaries',
    noMatchingCustomers: 'No matching customers',
    actions: 'Actions',
    viewResources: 'View Resources',
    resourceDrawerTitle: (name: string) => `${name} Resources`,
    resourceDrawerDescription: 'Trace the customer-owned nodes, subscriptions, forwarding rules, and runtime hosts by source.',
    copyAllResourceIds: 'Copy All Resource IDs',
    quotaExceeded: 'Quota Exceeded',
    runtimeDisabledByPolicy: 'Runtime Disabled By Policy',
    noResources: 'No resources',
    noCustomers: 'No customers yet',
    noLimit: 'No quota',
    notAvailable: 'Not recorded',
    sourceLabels: {
      'customer-node': 'Customer Node',
      subscription: 'Subscription',
      forwarding: 'Port Forwarding'
    },
    statusLabels: {
      active: 'Active',
      limited: 'Limited',
      expired: 'Expired'
    },
    resourceLabels: {
      customerNodes: 'nodes',
      subscriptions: 'subs',
      forwarding: 'forwards',
      agents: 'hosts'
    },
    resourceSectionLabels: {
      customerNodes: 'Customer Nodes',
      subscriptions: 'Subscriptions',
      forwarding: 'Forwarding',
      agents: 'Hosts'
    }
  }
} as const;

const customerStatuses: CustomerReadModel['status'][] = ['active', 'limited', 'expired'];
const customerSourceKinds: CustomerSourceKind[] = ['customer-node', 'subscription', 'forwarding'];

function normalizeCustomerSearch(value: string) {
  return value.trim().toLocaleLowerCase();
}

function createCustomerSearchText(customer: CustomerReadModel, t: (typeof copy)[AppLanguage]) {
  return [
    customer.id,
    customer.name,
    customer.status,
    t.statusLabels[customer.status],
    ...customer.sourceKinds.flatMap((sourceKind) => [sourceKind, t.sourceLabels[sourceKind]]),
    ...customer.agentIds,
    ...customer.customerNodeIds,
    ...customer.subscriptionClientIds,
    ...customer.forwardRuleIds
  ]
    .join('\n')
    .toLocaleLowerCase();
}

function filterCustomers(
  customers: CustomerReadModel[],
  query: string,
  statusFilter: CustomerStatusFilter,
  sourceFilter: CustomerSourceFilter,
  t: (typeof copy)[AppLanguage]
) {
  const normalizedQuery = normalizeCustomerSearch(query);

  return customers.filter((customer) => {
    if (statusFilter && customer.status !== statusFilter) {
      return false;
    }

    if (sourceFilter && !customer.sourceKinds.includes(sourceFilter)) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return createCustomerSearchText(customer, t).includes(normalizedQuery);
  });
}

function createCustomerResourceGroups(
  customer: CustomerReadModel,
  labels: Record<CustomerResourceKey, string>
) {
  return [
    { key: 'customerNodes', label: labels.customerNodes, ids: customer.customerNodeIds },
    { key: 'subscriptions', label: labels.subscriptions, ids: customer.subscriptionClientIds },
    { key: 'forwarding', label: labels.forwarding, ids: customer.forwardRuleIds },
    { key: 'agents', label: labels.agents, ids: customer.agentIds }
  ] as const;
}

function createCustomerResourceIdText(customer: CustomerReadModel, labels: Record<CustomerResourceKey, string>, emptyLabel: string) {
  return createCustomerResourceGroups(customer, labels)
    .map((group) => `${group.label}: ${group.ids.length > 0 ? group.ids.join(', ') : emptyLabel}`)
    .join('\n');
}

function createCustomerSummaryText(
  customer: CustomerReadModel,
  labels: (typeof copy)[AppLanguage],
  language: AppLanguage
) {
  return [
    `${labels.customer}: ${customer.name}`,
    `ID: ${customer.id}`,
    `${labels.status}: ${labels.statusLabels[customer.status]}`,
    `${labels.sources}: ${customer.sourceKinds.map((sourceKind) => labels.sourceLabels[sourceKind]).join(', ')}`,
    `${labels.traffic}: ${formatTraffic(customer, labels.noLimit)}`,
    `${labels.expiry}: ${customer.expiresAt ? formatDateTime(customer.expiresAt, language) : labels.notAvailable}`,
    `${labels.lastActivity}: ${
      customer.lastActivityAt ? formatDateTime(customer.lastActivityAt, language) : labels.notAvailable
    }`,
    `${labels.quotaExceeded}: ${String(customer.quotaExceeded)}`,
    `${labels.runtimeDisabledByPolicy}: ${String(customer.runtimeDisabledByPolicy)}`,
    createCustomerResourceIdText(customer, labels.resourceSectionLabels, labels.noResources)
  ].join('\n');
}

function copyText(value: string) {
  void navigator.clipboard?.writeText(value);
}

function calculateTrafficPercent(customer: CustomerReadModel) {
  if (customer.trafficLimitBytes <= 0) {
    return 0;
  }

  return Math.min(Math.round((customer.usedTrafficBytes / customer.trafficLimitBytes) * 100), 100);
}

function formatTraffic(customer: CustomerReadModel, noLimit: string) {
  const used = formatBytes(customer.usedTrafficBytes);

  if (customer.trafficLimitBytes <= 0) {
    return `${used} / ${noLimit}`;
  }

  return `${used} / ${formatBytes(customer.trafficLimitBytes)}`;
}

function createResourceSummary(
  customer: CustomerReadModel,
  labels: Record<keyof typeof copy.zh.resourceLabels, string>,
  language: AppLanguage
) {
  return [
    `${labels.customerNodes} ${formatNumber(customer.customerNodeCount, language)}`,
    `${labels.subscriptions} ${formatNumber(customer.subscriptionClientCount, language)}`,
    `${labels.forwarding} ${formatNumber(customer.forwardRuleCount, language)}`,
    `${labels.agents} ${formatNumber(customer.agentIds.length, language)}`
  ];
}

function getStatusIcon(status: CustomerReadModel['status']) {
  if (status === 'active') return CheckCircle2;
  if (status === 'expired') return Clock3;
  return AlertTriangle;
}

function getStatusClass(status: CustomerReadModel['status']) {
  if (status === 'active') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200';
  }

  if (status === 'expired') {
    return 'border-slate-300 bg-slate-100 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-white/60';
  }

  return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200';
}

function SummaryCard({
  icon: Icon,
  label,
  value
}: {
  icon: typeof UserRound;
  label: string;
  value: string;
}) {
  return (
    <GlassCard className="flex min-h-[104px] items-center justify-between p-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
        <p className="mt-3 text-2xl font-black tracking-normal text-slate-950 dark:text-white">{value}</p>
      </div>
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-blue-600 dark:border-primary/20 dark:bg-primary/10 dark:text-primary">
        <Icon className="h-5 w-5" />
      </div>
    </GlassCard>
  );
}

function CustomerStatusBadge({ customer, language }: { customer: CustomerReadModel; language: AppLanguage }) {
  const t = copy[language];
  const Icon = getStatusIcon(customer.status);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold',
        getStatusClass(customer.status)
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {t.statusLabels[customer.status]}
    </span>
  );
}

function CustomerResourceGroup({ emptyLabel, ids, title }: { emptyLabel: string; ids: readonly string[]; title: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">{title}</p>
        <span className="rounded-full bg-white px-2.5 py-1 font-mono text-[10px] font-black text-slate-500 dark:bg-white/5 dark:text-white/50">
          {ids.length}
        </span>
      </div>
      {ids.length === 0 ? (
        <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-white/45">{emptyLabel}</p>
      ) : (
        <div className="mt-3 grid gap-2">
          {ids.map((id) => (
            <code
              className="break-all rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs font-bold text-slate-700 dark:border-white/10 dark:bg-slate-950/40 dark:text-white/70"
              key={id}
            >
              {id}
            </code>
          ))}
        </div>
      )}
    </div>
  );
}

export function CustomersPage({ focusIntent, customers, language, returnFocusRef }: CustomersPageProps) {
  const t = copy[language];
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerStatusFilter, setCustomerStatusFilter] = useState<CustomerStatusFilter>('');
  const [customerSourceFilter, setCustomerSourceFilter] = useState<CustomerSourceFilter>('');
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [resourceDrawerCustomerId, setResourceDrawerCustomerId] = useState<string | null>(null);
  const totalUsedBytes = customers.reduce((total, customer) => total + customer.usedTrafficBytes, 0);
  const activeCount = customers.filter((customer) => customer.status === 'active').length;
  const limitedCount = customers.filter((customer) => customer.status !== 'active').length;
  const filteredCustomers = useMemo(
    () => filterCustomers(customers, customerSearch, customerStatusFilter, customerSourceFilter, t),
    [customerSearch, customerSourceFilter, customerStatusFilter, customers, t]
  );
  const resourceDrawerCustomer = useMemo(
    () => customers.find((customer) => customer.id === resourceDrawerCustomerId) ?? null,
    [customers, resourceDrawerCustomerId]
  );
  const selectedCustomers = useMemo(
    () => customers.filter((customer) => selectedCustomerIds.includes(customer.id)),
    [customers, selectedCustomerIds]
  );
  const selectedVisibleCustomerCount = useMemo(
    () => filteredCustomers.filter((customer) => selectedCustomerIds.includes(customer.id)).length,
    [filteredCustomers, selectedCustomerIds]
  );

  useEffect(() => {
    if (!focusIntent || focusIntent.kind !== 'customer.resources') {
      return;
    }

    const customer = customers.find((item) => item.id === focusIntent.targetId);

    if (!customer) {
      return;
    }

    setCustomerSearch('');
    setCustomerStatusFilter('');
    setCustomerSourceFilter('');
    setResourceDrawerCustomerId(customer.id);
  }, [customers, focusIntent]);

  function toggleCustomerSelection(customerId: string) {
    setSelectedCustomerIds((current) =>
      current.includes(customerId) ? current.filter((id) => id !== customerId) : [...current, customerId]
    );
  }

  function toggleVisibleCustomerSelection() {
    const visibleIds = filteredCustomers.map((customer) => customer.id);

    if (visibleIds.length === 0) {
      return;
    }

    setSelectedCustomerIds((current) => {
      const visibleIdSet = new Set(visibleIds);
      const allVisibleSelected = visibleIds.every((id) => current.includes(id));

      return allVisibleSelected
        ? current.filter((id) => !visibleIdSet.has(id))
        : Array.from(new Set([...current, ...visibleIds]));
    });
  }

  function copySelectedCustomerResourceIds() {
    const resourceText = selectedCustomers
      .map((customer) =>
        [customer.name, createCustomerResourceIdText(customer, t.resourceSectionLabels, t.noResources)].join('\n')
      )
      .join('\n\n');

    if (resourceText) {
      copyText(resourceText);
    }
  }

  function copySelectedCustomerSummaries() {
    const summaryText = selectedCustomers
      .map((customer) => createCustomerSummaryText(customer, t, language))
      .join('\n\n');

    if (summaryText) {
      copyText(summaryText);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-normal text-slate-950 dark:text-white">{t.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-white/55">{t.subtitle}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={UserRound} label={t.totalCustomers} value={formatNumber(customers.length, language)} />
        <SummaryCard icon={CheckCircle2} label={t.activeCustomers} value={formatNumber(activeCount, language)} />
        <SummaryCard icon={AlertTriangle} label={t.limitedCustomers} value={formatNumber(limitedCount, language)} />
        <SummaryCard icon={Database} label={t.totalUsage} value={formatBytes(totalUsedBytes)} />
      </div>

      <div className="island-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-white/10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white">
              <ServerCog className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-black tracking-wide text-slate-950 dark:text-white">{t.directoryTitle}</h3>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-slate-500 dark:text-white/40">
                {formatNumber(customers.length, language)}
              </p>
            </div>
          </div>
        </div>

        {customers.length === 0 ? (
          <div className="flex min-h-[220px] items-center justify-center px-5 py-12 text-sm font-semibold text-slate-500 dark:text-white/45">
            {t.noCustomers}
          </div>
        ) : (
          <>
            <div className="border-b border-slate-200 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/[0.02]">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(18rem,1fr)_minmax(10rem,0.28fr)_minmax(10rem,0.28fr)]">
                <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                    {t.searchCustomers}
                  </span>
                  <div className="mt-1 flex min-h-7 items-center gap-2">
                    <Search className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-white/35" />
                    <input
                      aria-label={t.searchCustomers}
                      className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-white/35"
                      onChange={(event) => setCustomerSearch(event.target.value)}
                      placeholder={t.searchCustomersPlaceholder}
                      type="search"
                      value={customerSearch}
                    />
                  </div>
                </label>
                <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                    {t.customerStatus}
                  </span>
                  <select
                    aria-label={t.customerStatus}
                    className="glass-select-control mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
                    onChange={(event) => setCustomerStatusFilter(event.target.value as CustomerStatusFilter)}
                    value={customerStatusFilter}
                  >
                    <option value="">{t.allStatuses}</option>
                    {customerStatuses.map((status) => (
                      <option key={status} value={status}>
                        {t.statusLabels[status]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                    {t.customerSource}
                  </span>
                  <select
                    aria-label={t.customerSource}
                    className="glass-select-control mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
                    onChange={(event) => setCustomerSourceFilter(event.target.value as CustomerSourceFilter)}
                    value={customerSourceFilter}
                  >
                    <option value="">{t.allSources}</option>
                    {customerSourceKinds.map((sourceKind) => (
                      <option key={sourceKind} value={sourceKind}>
                        {t.sourceLabels[sourceKind]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="mt-3 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                {t.matchingCustomers} {filteredCustomers.length} / {customers.length}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 transition hover:border-blue-300 hover:text-blue-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/60 dark:hover:border-primary/40 dark:hover:text-primary">
                  <input
                    aria-label={t.selectVisibleCustomers}
                    checked={filteredCustomers.length > 0 && selectedVisibleCustomerCount === filteredCustomers.length}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-white/20"
                    onChange={toggleVisibleCustomerSelection}
                    type="checkbox"
                  />
                  {t.selectVisibleCustomers}
                </label>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/60">
                  {t.selectedCustomers} {formatNumber(selectedCustomers.length, language)}
                </span>
                <button
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white shadow-lg shadow-blue-600/15 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-primary dark:text-slate-950"
                  disabled={selectedCustomers.length === 0}
                  onClick={copySelectedCustomerResourceIds}
                  type="button"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t.bulkCopyResourceIds}
                </button>
                <button
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 transition hover:border-blue-300 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/60 dark:hover:border-primary/40 dark:hover:text-primary"
                  disabled={selectedCustomers.length === 0}
                  onClick={copySelectedCustomerSummaries}
                  type="button"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t.bulkCopyCustomerSummaries}
                </button>
              </div>
            </div>
            {filteredCustomers.length === 0 ? (
              <div className="flex min-h-[220px] items-center justify-center px-5 py-12 text-sm font-semibold text-slate-500 dark:text-white/45">
                {t.noMatchingCustomers}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1180px] text-left">
                  <thead className="bg-slate-50/80 text-[10px] uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                    <tr>
                      <th className="w-12 px-5 py-3 font-bold">
                        <span className="sr-only">{t.selectVisibleCustomers}</span>
                      </th>
                      <th className="px-5 py-3 font-bold">{t.customer}</th>
                      <th className="px-5 py-3 font-bold">{t.status}</th>
                      <th className="px-5 py-3 font-bold">{t.sources}</th>
                      <th className="px-5 py-3 font-bold">{t.resources}</th>
                      <th className="px-5 py-3 font-bold">{t.traffic}</th>
                      <th className="px-5 py-3 font-bold">{t.expiry}</th>
                      <th className="px-5 py-3 font-bold">{t.lastActivity}</th>
                      <th className="px-5 py-3 text-right font-bold">{t.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm dark:divide-white/10">
                    {filteredCustomers.map((customer) => {
                      const trafficPercent = calculateTrafficPercent(customer);
                      const resources = createResourceSummary(customer, t.resourceLabels, language);

                      return (
                        <tr key={customer.id} className="align-top transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                          <td className="px-5 py-4">
                            <input
                              aria-label={t.selectCustomer(customer.name)}
                              checked={selectedCustomerIds.includes(customer.id)}
                              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-white/20"
                              onChange={() => toggleCustomerSelection(customer.id)}
                              type="checkbox"
                            />
                          </td>
                          <td className="px-5 py-4">
                            <p className="font-bold text-slate-950 dark:text-white">{customer.name}</p>
                            <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-slate-500 dark:text-white/40">
                              {customer.id}
                            </p>
                          </td>
                          <td className="px-5 py-4">
                            <CustomerStatusBadge customer={customer} language={language} />
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex max-w-[220px] flex-wrap gap-1.5">
                              {customer.sourceKinds.map((sourceKind: CustomerSourceKind) => (
                                <span
                                  className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-white/70"
                                  key={sourceKind}
                                >
                                  {t.sourceLabels[sourceKind]}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="grid max-w-[180px] grid-cols-2 gap-1.5">
                              {resources.map((resource) => (
                                <span
                                  className="rounded-lg bg-slate-100 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-slate-500 dark:bg-white/[0.04] dark:text-white/45"
                                  key={resource}
                                >
                                  {resource}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <p className="font-mono text-xs font-bold text-slate-700 dark:text-white/70">
                              {formatTraffic(customer, t.noLimit)}
                            </p>
                            <div className="mt-2 h-1.5 w-40 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                              <div
                                className={cn(
                                  'h-full rounded-full',
                                  customer.quotaExceeded || customer.runtimeDisabledByPolicy
                                    ? 'bg-amber-400'
                                    : 'bg-blue-500 dark:bg-primary'
                                )}
                                style={{ width: `${trafficPercent}%` }}
                              />
                            </div>
                          </td>
                          <td className="px-5 py-4 text-xs font-semibold text-slate-600 dark:text-white/55">
                            {customer.expiresAt ? formatDateTime(customer.expiresAt, language) : t.notAvailable}
                          </td>
                          <td className="px-5 py-4 text-xs font-semibold text-slate-600 dark:text-white/55">
                            {customer.lastActivityAt ? formatDateTime(customer.lastActivityAt, language) : t.notAvailable}
                          </td>
                          <td className="px-5 py-4 text-right">
                            <button
                              aria-label={t.viewResources}
                              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:bg-white hover:text-blue-600 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
                              onClick={() => setResourceDrawerCustomerId(customer.id)}
                              type="button"
                            >
                              <FolderSearch className="h-3.5 w-3.5" />
                              {t.viewResources}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      <ConfigDrawer
        description={resourceDrawerCustomer ? t.resourceDrawerDescription : undefined}
        open={resourceDrawerCustomer !== null}
        returnFocusRef={returnFocusRef}
        title={resourceDrawerCustomer ? t.resourceDrawerTitle(resourceDrawerCustomer.name) : t.viewResources}
        onClose={() => setResourceDrawerCustomerId(null)}
      >
        {resourceDrawerCustomer ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
              <div>
                <p className="font-bold text-slate-950 dark:text-white">{resourceDrawerCustomer.name}</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-slate-500 dark:text-white/40">
                  {resourceDrawerCustomer.id}
                </p>
              </div>
              <button
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white shadow-lg shadow-blue-600/15 transition hover:bg-blue-500 dark:bg-primary dark:text-slate-950"
                onClick={() =>
                  copyText(createCustomerResourceIdText(resourceDrawerCustomer, t.resourceSectionLabels, t.noResources))
                }
                type="button"
              >
                <Copy className="h-3.5 w-3.5" />
                {t.copyAllResourceIds}
              </button>
            </div>
            <div className="grid gap-3">
              {createCustomerResourceGroups(resourceDrawerCustomer, t.resourceSectionLabels).map((group) => (
                <CustomerResourceGroup emptyLabel={t.noResources} ids={group.ids} key={group.key} title={group.label} />
              ))}
            </div>
          </div>
        ) : null}
      </ConfigDrawer>
    </div>
  );
}
