import { useState } from 'react';
import { Activity, Boxes, ChevronDown, Network, Route, Search, ServerCog } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import type { PageId } from '../../app/navigation';
import { cn } from '../../lib/cn';

type OperationsLaunchpadProps = {
  activePage: PageId;
  agentsCount: number;
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
    title: '任务路径',
    subtitle: '默认收起，展开后直达主机、节点、转发与订阅。',
    quickSearch: '搜索 / 执行动作',
    expand: '展开',
    collapse: '收起',
    actions: {
      hosts: ['接入服务器', '安装 Agent、查看遥测并应用运行时配置'],
      customerNodes: ['交付客户节点', '创建客户节点、复制分享链接并重置流量'],
      forwarding: ['配置端口转发', '管理多主机端口、配额、限速与策略状态'],
      subscriptions: ['生成订阅', '聚合订阅源、导出客户端配置与链接']
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
    title: 'Task Paths',
    subtitle: 'Collapsed by default; expand for direct host, node, forwarding, and subscription routes.',
    quickSearch: 'Search / run action',
    expand: 'Expand',
    collapse: 'Collapse',
    actions: {
      hosts: ['Enroll Servers', 'Install Agents, inspect telemetry, and apply runtime config'],
      customerNodes: ['Deliver Customer Nodes', 'Create customer nodes, copy share links, and reset usage'],
      forwarding: ['Configure Forwarding', 'Manage multi-host ports, quotas, rate limits, and policy state'],
      subscriptions: ['Generate Subscriptions', 'Mix sources, export client profiles, and copy links']
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

  const [expanded, setExpanded] = useState(false);

  return (
    <section className="taste-v2-launchpad stagger-1 mb-3 overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 p-2.5 shadow-sm backdrop-blur-2xl dark:border-white/[0.08] dark:bg-white/[0.035] max-md:mb-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl border border-blue-200 bg-blue-50 text-blue-700 shadow-sm shadow-blue-500/10 dark:border-blue-400/25 dark:bg-blue-400/10 dark:text-blue-200">
            <Activity className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[9px] font-black uppercase tracking-[0.24em] text-blue-500 dark:text-primary">
              {t.eyebrow}
            </p>
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-sm font-black tracking-tight text-slate-950 dark:text-white">{t.title}</h3>
              <p className="hidden truncate text-xs font-semibold text-slate-500 dark:text-white/45 lg:block">{t.subtitle}</p>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 text-[11px] font-black uppercase tracking-widest text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 dark:border-white/10 dark:bg-white/[0.06] dark:text-white/70 dark:hover:border-blue-300/30 dark:hover:text-blue-200"
            onClick={onOpenQuickActions}
            type="button"
          >
            <Search className="h-3.5 w-3.5" />
            {t.quickSearch}
          </button>
          <button
            aria-expanded={expanded}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 text-[11px] font-black uppercase tracking-widest text-blue-700 transition hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-200"
            onClick={() => setExpanded((value) => !value)}
            type="button"
          >
            {expanded ? t.collapse : t.expand}
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
          </button>
        </div>
      </div>

      <div className="taste-v2-launchpad-rail mt-2 grid grid-cols-4 gap-2 max-md:auto-cols-[46%] max-md:grid-flow-col max-md:grid-cols-none max-md:overflow-x-auto max-md:pb-1 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden">
        {actions.map((action) => (
          <button
            className="group min-h-12 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2 text-left transition duration-300 hover:-translate-y-0.5 hover:bg-white/[0.075] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 dark:focus-visible:ring-primary/40"
            key={action.id}
            onClick={() => onSelectPage(action.pageId)}
            onFocus={() => onPrefetchPage?.(action.pageId)}
            onMouseEnter={() => onPrefetchPage?.(action.pageId)}
            type="button"
          >
            <span className="block truncate text-[10px] font-black uppercase tracking-widest text-white/45">{action.metric}</span>
            <span className="mt-1 block truncate text-xs font-black text-white">{action.label}</span>
          </button>
        ))}
      </div>

      {expanded ? (
        <div className="mt-2 grid gap-2 lg:grid-cols-4 max-md:auto-cols-[72%] max-md:grid-flow-col max-md:grid-cols-none max-md:overflow-x-auto max-md:pb-1 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden">
          {actions.map((action) => {
            const Icon = action.icon;
            const active = activePage === action.pageId;

            return (
              <button
                className={cn(
                  'group min-h-[92px] rounded-2xl border p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 dark:focus-visible:ring-primary/40',
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
                  <span className={cn('grid h-8 w-8 place-items-center rounded-lg border', toneClasses[action.tone])}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-slate-500 shadow-sm dark:bg-white/5 dark:text-white/45">
                    {action.metric}
                  </span>
                </div>
                <p className="mt-3 text-xs font-black text-slate-900 dark:text-white">{action.label}</p>
                <p className="mt-1 line-clamp-2 text-[11px] font-medium leading-4 text-slate-500 dark:text-white/50">
                  {action.description}
                </p>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
