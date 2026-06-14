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
  onOpenQuickActions: (returnFocusTarget?: HTMLElement | null) => void;
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
  tone: 'blue' | 'cyan' | 'orange' | 'slate';
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
  blue: 'border-[#1E3AFF] bg-[#DCE1FF] text-[#1E3AFF] dark:border-[#6B7CFF]/40 dark:bg-[#6B7CFF]/15 dark:text-[#DDE3FF]',
  cyan: 'border-[#00A878] bg-[#00A878]/[0.12] text-[#007D5E] dark:border-[#35E68E]/35 dark:bg-[#35E68E]/10 dark:text-[#9EF4C4]',
  orange:
    'border-[#FF3D18] bg-[#FF3D18]/[0.12] text-[#C9220C] dark:border-[#FF6A3A]/35 dark:bg-[#FF6A3A]/12 dark:text-[#FFB197]',
  slate:
    'border-[#D9FF00] bg-[#D9FF00]/[0.28] text-[#07111F] dark:border-[#EAFF5A]/35 dark:bg-[#EAFF5A]/12 dark:text-[#F4FFC5]',
  amber:
    'border-[#D9FF00] bg-[#D9FF00]/[0.28] text-[#07111F] dark:border-[#EAFF5A]/35 dark:bg-[#EAFF5A]/12 dark:text-[#F4FFC5]'
} as const;

const actionToneClasses = {
  blue:
    'border-[#1E3AFF] bg-[#DCE1FF] text-[#07111F] hover:bg-[#1E3AFF] hover:text-white dark:border-[#6B7CFF]/40 dark:bg-[#6B7CFF]/14 dark:text-[#F4F8FF] dark:hover:bg-[#6B7CFF] dark:hover:text-[#07111F]',
  cyan:
    'border-[#00A878] bg-[#00A878]/[0.12] text-[#07111F] hover:bg-[#00A878] hover:text-white dark:border-[#35E68E]/35 dark:bg-[#35E68E]/10 dark:text-[#F4F8FF] dark:hover:bg-[#35E68E] dark:hover:text-[#07111F]',
  orange:
    'border-[#FF3D18] bg-[#FF3D18]/[0.12] text-[#07111F] hover:bg-[#FF3D18] hover:text-white dark:border-[#FF6A3A]/40 dark:bg-[#FF6A3A]/12 dark:text-[#F4F8FF] dark:hover:bg-[#FF6A3A] dark:hover:text-[#07111F]',
  slate:
    'border-[#D9FF00] bg-[#D9FF00]/[0.28] text-[#07111F] hover:bg-[#D9FF00] hover:text-[#07111F] dark:border-[#EAFF5A]/40 dark:bg-[#EAFF5A]/12 dark:text-[#F4F8FF] dark:hover:bg-[#EAFF5A] dark:hover:text-[#07111F]'
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
      tone: 'orange'
    },
    {
      id: 'subscriptions',
      icon: Route,
      label: t.actions.subscriptions[0],
      description: t.actions.subscriptions[1],
      pageId: 'subscriptions',
      metric: t.metricLabels.subscriptions(subscriptionsCount),
      tone: 'slate'
    }
  ];

  const [expanded, setExpanded] = useState(false);

  return (
    <section className="ou-card-enter mb-3 overflow-hidden border border-[#07111F] bg-[#FFFDF5] p-2.5 shadow-[0_18px_44px_-34px_rgba(7,17,31,0.38)] backdrop-blur-xl dark:border-[#6B7CFF]/25 dark:bg-[#101827] max-md:mb-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 flex-shrink-0 place-items-center border border-[#1E3AFF] bg-[#DCE1FF] text-[#1E3AFF] shadow-sm shadow-[#1E3AFF]/20 dark:border-[#6B7CFF]/35 dark:bg-[#6B7CFF]/15 dark:text-[#DDE3FF]">
            <Activity className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-[#1E3AFF] dark:text-[#DDE3FF]">
              {t.eyebrow}
            </p>
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-sm font-semibold tracking-tight text-[#07111F] dark:text-white">{t.title}</h3>
              <p className="hidden truncate text-xs font-medium text-[#35405A] dark:text-white/55 lg:block">{t.subtitle}</p>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            className="ou-command-pill inline-flex h-9 items-center justify-center gap-2 rounded-full border border-[#1E3AFF] bg-[#FFFDF5] px-3 text-[11px] font-semibold tracking-[0.02em] text-[#1E3AFF] shadow-sm shadow-[#1E3AFF]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 dark:border-[#6B7CFF]/35 dark:bg-white/[0.05] dark:text-[#DDE3FF] dark:focus-visible:ring-primary/55 max-md:hidden"
            onClick={(event) => onOpenQuickActions(event.currentTarget)}
            type="button"
          >
            <Search className="h-3.5 w-3.5" />
            {t.quickSearch}
          </button>
          <button
            aria-expanded={expanded}
            className="ou-command-pill inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-[#D9FF00] bg-[#D9FF00]/[0.22] px-3 text-[11px] font-semibold tracking-[0.02em] text-[#07111F] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 dark:border-[#EAFF5A]/35 dark:bg-[#EAFF5A]/12 dark:text-[#F4FFC5] dark:focus-visible:ring-primary/55"
            onClick={() => setExpanded((value) => !value)}
            type="button"
          >
            {expanded ? t.collapse : t.expand}
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
          </button>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-4 gap-2 max-md:auto-cols-[46%] max-md:grid-flow-col max-md:grid-cols-none max-md:overflow-x-auto max-md:pb-1 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden">
        {actions.map((action) => (
            <button
              className={cn(
                'ou-action-card group min-h-12 border px-3 py-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 dark:focus-visible:ring-primary/55',
                actionToneClasses[action.tone]
              )}
              key={action.id}
              onClick={() => onSelectPage(action.pageId)}
              onFocus={() => onPrefetchPage?.(action.pageId)}
              onMouseEnter={() => onPrefetchPage?.(action.pageId)}
              type="button"
            >
            <span className="block truncate text-[10px] font-semibold tracking-[0.08em] opacity-75">{action.metric}</span>
            <span className="mt-1 block truncate text-xs font-semibold">{action.label}</span>
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
                  'ou-action-card group min-h-[92px] border p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 dark:focus-visible:ring-primary/55',
                  active
                    ? 'border-[#1E3AFF] bg-[#DCE1FF] shadow-lg shadow-[#1E3AFF]/12 dark:border-[#6B7CFF]/40 dark:bg-[#6B7CFF]/14'
                    : actionToneClasses[action.tone]
                )}
                key={action.id}
                onClick={() => onSelectPage(action.pageId)}
                onFocus={() => onPrefetchPage?.(action.pageId)}
                onMouseEnter={() => onPrefetchPage?.(action.pageId)}
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className={cn('grid h-8 w-8 place-items-center border', toneClasses[action.tone])}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="rounded-full border border-[#07111F]/20 bg-[#FFFDF5] px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#35405A] shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-white/50">
                    {action.metric}
                  </span>
                </div>
                <p className="mt-3 text-xs font-semibold">{action.label}</p>
                <p className="mt-1 line-clamp-2 text-[11px] font-normal leading-4 opacity-70">
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
