import { AlertTriangle, CheckCircle2, Clock3, Database, ServerCog, UserRound } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { GlassCard } from '../../components/ui/glass-card';
import type { CustomerReadModel } from '../../domain';
import { cn } from '../../lib/cn';
import { formatBytes, formatDateTime, formatNumber } from '../shared/format';

type CustomersPageProps = {
  customers: CustomerReadModel[];
  language: AppLanguage;
};

type CustomerSourceKind = CustomerReadModel['sourceKinds'][number];

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
    }
  }
} as const;

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
    <GlassCard className="tilt-card flex min-h-[104px] items-center justify-between p-5">
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

export function CustomersPage({ customers, language }: CustomersPageProps) {
  const t = copy[language];
  const totalUsedBytes = customers.reduce((total, customer) => total + customer.usedTrafficBytes, 0);
  const activeCount = customers.filter((customer) => customer.status === 'active').length;
  const limitedCount = customers.filter((customer) => customer.status !== 'active').length;

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
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-left">
              <thead className="bg-slate-50/80 text-[10px] uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                <tr>
                  <th className="px-5 py-3 font-bold">{t.customer}</th>
                  <th className="px-5 py-3 font-bold">{t.status}</th>
                  <th className="px-5 py-3 font-bold">{t.sources}</th>
                  <th className="px-5 py-3 font-bold">{t.resources}</th>
                  <th className="px-5 py-3 font-bold">{t.traffic}</th>
                  <th className="px-5 py-3 font-bold">{t.expiry}</th>
                  <th className="px-5 py-3 font-bold">{t.lastActivity}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm dark:divide-white/10">
                {customers.map((customer) => {
                  const trafficPercent = calculateTrafficPercent(customer);
                  const resources = createResourceSummary(customer, t.resourceLabels, language);

                  return (
                    <tr key={customer.id} className="align-top">
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
