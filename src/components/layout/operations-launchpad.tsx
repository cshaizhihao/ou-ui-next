import { Activity, Bell, Boxes, Network, Route, Search, ServerCog, ShieldCheck } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import type { PageId } from '../../app/navigation';
import { cn } from '../../lib/cn';

type OperationsLaunchpadProps = {
  activePage: PageId;
  agentsCount: number;
  alertsCount: number;
  forwardingRulesCount: number;
  language: AppLanguage;
  nodesCount: number;
  subscriptionsCount: number;
  onOpenQuickActions: () => void;
  onPrefetchPage?: (pageId: PageId) => void;
  onSelectPage: (pageId: PageId) => void;
};

type LaunchpadAction = {
  id: string;
  icon: typeof ServerCog;
  label: string;
  description: string;
  pageId: PageId;
  metric: string;
  tone: 'blue' | 'cyan' | 'violet' | 'amber';
};

const copy = {
  zh: {
    eyebrow: '操作启动台',
    title: '按任务路径工作，不再按菜单猜功能',
    subtitle: '把主机接入、客户节点、端口转发、订阅交付和风险检查压缩成可直达路径。',
    quickSearch: '搜索资源 / 执行动作',
    actions: {
      hosts: ['接入服务器', '安装 Agent、查看遥测并应用运行时配置'],
      customerNodes: ['交付客户节点', '创建客户节点、复制分享链接并重置流量'],
      forwarding: ['配置端口转发', '管理多主机端口、配额、限速与策略状态'],
      subscriptions: ['生成订阅', '聚合订阅源、导出客户端配置与链接']
    },
    health: {
      title: '运行健康',
      description: '告警、权限与审计集中检查',
      alerts: '活动告警',
      audit: '查看审计',
      permissions: '打开权限与配额检查'
    },
    metricLabels: {
      hosts: (count: number) => `${count} 台主机`,
      nodes: (count: number) => `${count} 个节点`,
      forwarding: (count: number) => `${count} 条规则`,
      subscriptions: (count: number) => `${count} 个订阅`
    }
  },
  en: {
    eyebrow: 'Operations Launchpad',
    title: 'Work by task path, not by guessing menus',
    subtitle: 'Compress host enrollment, customer nodes, forwarding, subscriptions, and risk checks into direct routes.',
    quickSearch: 'Search resources / run actions',
    actions: {
      hosts: ['Enroll Servers', 'Install Agents, inspect telemetry, and apply runtime config'],
      customerNodes: ['Deliver Customer Nodes', 'Create customer nodes, copy share links, and reset usage'],
      forwarding: ['Configure Forwarding', 'Manage multi-host ports, quotas, rate limits, and policy state'],
      subscriptions: ['Generate Subscriptions', 'Mix sources, export client profiles, and copy links']
    },
    health: {
      title: 'Runtime Health',
      description: 'Alerts, access, and audit in one check lane',
      alerts: 'active alerts',
      audit: 'View Audit',
      permissions: 'Access & Quotas'
    },
    metricLabels: {
      hosts: (count: number) => `${count} hosts`,
      nodes: (count: number) => `${count} nodes`,
      forwarding: (count: number) => `${count} rules`,
      subscriptions: (count: number) => `${count} bundles`
    }
  }
} as const;

const toneClasses = {
  blue: 'border-blue-200 bg-blue-50 text-blue-600 dark:border-primary/20 dark:bg-primary/10 dark:text-primary',
  cyan: 'border-cyan-200 bg-cyan-50 text-cyan-600 dark:border-cyan-400/20 dark:bg-cyan-400/10 dark:text-cyan-200',
  violet:
    'border-violet-200 bg-violet-50 text-violet-600 dark:border-violet-400/20 dark:bg-violet-400/10 dark:text-violet-200',
  amber:
    'border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200'
} as const;

export function OperationsLaunchpad({
  activePage,
  agentsCount,
  alertsCount,
  forwardingRulesCount,
  language,
  nodesCount,
  onOpenQuickActions,
  onPrefetchPage,
  onSelectPage,
  subscriptionsCount
}: OperationsLaunchpadProps) {
  const t = copy[language];
  const actions: LaunchpadAction[] = [
    {
      id: 'hosts',
      icon: ServerCog,
      label: t.actions.hosts[0],
      description: t.actions.hosts[1],
      pageId: 'nodes',
      metric: t.metricLabels.hosts(agentsCount),
      tone: 'blue'
    },
    {
      id: 'customerNodes',
      icon: Boxes,
      label: t.actions.customerNodes[0],
      description: t.actions.customerNodes[1],
      pageId: 'customerNodes',
      metric: t.metricLabels.nodes(nodesCount),
      tone: 'cyan'
    },
    {
      id: 'forwarding',
      icon: Network,
      label: t.actions.forwarding[0],
      description: t.actions.forwarding[1],
      pageId: 'forwarding',
      metric: t.metricLabels.forwarding(forwardingRulesCount),
      tone: 'violet'
    },
    {
      id: 'subscriptions',
      icon: Route,
      label: t.actions.subscriptions[0],
      description: t.actions.subscriptions[1],
      pageId: 'subscriptions',
      metric: t.metricLabels.subscriptions(subscriptionsCount),
      tone: 'amber'
    }
  ];

  return (
    <section className="stagger-1 mb-6 rounded-3xl border border-slate-200 bg-white/75 p-4 shadow-sm backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.04]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-black uppercase tracking-[0.28em] text-blue-500 dark:text-primary">
            {t.eyebrow}
          </p>
          <h3 className="mt-2 text-lg font-black tracking-tight text-slate-950 dark:text-white">{t.title}</h3>
          <p className="mt-1 max-w-3xl text-sm font-medium leading-6 text-slate-500 dark:text-white/50">{t.subtitle}</p>
        </div>
        <button
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-slate-200 bg-slate-950 px-4 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-slate-950/10 transition hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 dark:border-white/10 dark:bg-white dark:text-slate-950 dark:focus-visible:ring-primary/40"
          onClick={onOpenQuickActions}
          type="button"
        >
          <Search className="h-4 w-4" />
          {t.quickSearch}
        </button>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[1fr_1fr_1fr_1fr_0.9fr] md:grid-cols-2">
        {actions.map((action) => {
          const Icon = action.icon;
          const active = activePage === action.pageId;

          return (
            <button
              className={cn(
                'group rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 dark:focus-visible:ring-primary/40',
                active
                  ? 'border-blue-300 bg-blue-50 shadow-lg shadow-blue-500/10 dark:border-primary/30 dark:bg-primary/10'
                  : 'border-slate-200 bg-slate-50/80 hover:border-blue-200 dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-primary/20'
              )}
              key={action.id}
              onClick={() => onSelectPage(action.pageId)}
              onFocus={() => onPrefetchPage?.(action.pageId)}
              onMouseEnter={() => onPrefetchPage?.(action.pageId)}
              type="button"
            >
              <div className="flex items-start justify-between gap-3">
                <span className={cn('grid h-10 w-10 place-items-center rounded-xl border', toneClasses[action.tone])}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="rounded-full bg-white px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500 shadow-sm dark:bg-white/5 dark:text-white/45">
                  {action.metric}
                </span>
              </div>
              <p className="mt-4 text-sm font-black text-slate-900 dark:text-white">{action.label}</p>
              <p className="mt-1 text-xs font-medium leading-5 text-slate-500 dark:text-white/50">{action.description}</p>
            </button>
          );
        })}

        <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-white shadow-xl shadow-slate-950/10 dark:border-white/[0.08] dark:bg-black/30">
          <div className="flex items-start justify-between gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-emerald-300/20 bg-emerald-300/10 text-emerald-200">
              <Activity className="h-5 w-5" />
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-white/70">
              <Bell className="h-3 w-3" />
              {alertsCount} {t.health.alerts}
            </span>
          </div>
          <p className="mt-4 text-sm font-black">{t.health.title}</p>
          <p className="mt-1 text-xs font-medium leading-5 text-white/50">{t.health.description}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white/80 transition hover:bg-white/15"
              onClick={() => onSelectPage('permissions')}
              onFocus={() => onPrefetchPage?.('permissions')}
              onMouseEnter={() => onPrefetchPage?.('permissions')}
              type="button"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              {t.health.permissions}
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white/80 transition hover:bg-white/15"
              onClick={() => onSelectPage('audit')}
              onFocus={() => onPrefetchPage?.('audit')}
              onMouseEnter={() => onPrefetchPage?.('audit')}
              type="button"
            >
              <Activity className="h-3.5 w-3.5" />
              {t.health.audit}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
