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
  pageId: PageId;
  metric: string;
  tone: 'primary' | 'success' | 'danger' | 'warning';
};

const copy = {
  zh: {
    eyebrow: '操作启动台',
    title: '任务路径',
    quickSearch: '搜索 / 执行动作',
    expand: '展开',
    collapse: '收起',
    actions: {
      hosts: '接入服务器',
      customerNodes: '交付客户节点',
      forwarding: '配置端口转发',
      subscriptions: '生成订阅'
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
    quickSearch: 'Search / run action',
    expand: 'Expand',
    collapse: 'Collapse',
    actions: {
      hosts: 'Enroll Servers',
      customerNodes: 'Deliver Customer Nodes',
      forwarding: 'Configure Forwarding',
      subscriptions: 'Generate Subscriptions'
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
  primary: 'ou-tone-primary text-[var(--ou-primary)]',
  success: 'ou-tone-success text-[var(--ou-success)]',
  danger: 'ou-tone-danger text-[var(--ou-danger)]',
  warning: 'ou-tone-warning text-[var(--ou-warning)]'
} as const;

const actionToneClasses = {
  primary: 'ou-tone-primary hover:border-[var(--ou-primary)] hover:bg-[var(--ou-primary-softer)]',
  success: 'ou-tone-success hover:border-[var(--ou-success)] hover:bg-[var(--ou-success-soft)]',
  danger: 'ou-tone-danger hover:border-[var(--ou-danger)] hover:bg-[var(--ou-danger-soft)]',
  warning: 'ou-tone-warning hover:border-[var(--ou-warning)] hover:bg-[var(--ou-warning-soft)]'
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
      label: t.actions.hosts,
      pageId: 'nodes',
      metric: t.metricLabels.hosts(agentsCount),
      tone: 'primary'
    },
    {
      id: 'customerNodes',
      icon: Boxes,
      label: t.actions.customerNodes,
      pageId: 'customerNodes',
      metric: t.metricLabels.nodes(nodesCount),
      tone: 'success'
    },
    {
      id: 'forwarding',
      icon: Network,
      label: t.actions.forwarding,
      pageId: 'forwarding',
      metric: t.metricLabels.forwarding(forwardingRulesCount),
      tone: 'danger'
    },
    {
      id: 'subscriptions',
      icon: Route,
      label: t.actions.subscriptions,
      pageId: 'subscriptions',
      metric: t.metricLabels.subscriptions(subscriptionsCount),
      tone: 'warning'
    }
  ];

  const [expanded, setExpanded] = useState(false);

  return (
    <section
      className="surface-shell ou-card-enter mb-3 overflow-hidden p-2.5 max-md:mb-2"
      data-state={expanded ? 'expanded' : 'collapsed'}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="ou-tone-primary grid h-9 w-9 flex-shrink-0 place-items-center border">
            <Activity className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-[var(--ou-primary)]">
              {t.eyebrow}
            </p>
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-sm font-semibold tracking-tight text-[var(--ou-text)]">{t.title}</h3>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            className="ou-command-pill inline-flex h-9 items-center justify-center gap-2 rounded-full border px-3 text-[11px] font-semibold tracking-[0.02em] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 max-md:hidden"
            onClick={(event) => onOpenQuickActions(event.currentTarget)}
            type="button"
          >
            <Search className="h-3.5 w-3.5" />
            {t.quickSearch}
          </button>
          <button
            aria-expanded={expanded}
            className="ou-command-pill ou-tone-warning inline-flex h-9 items-center justify-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold tracking-[0.02em] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
            onClick={() => setExpanded((value) => !value)}
            type="button"
          >
            {expanded ? t.collapse : t.expand}
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
          </button>
        </div>
      </div>

      {!expanded ? (
        <div
          className="ou-launchpad-metric-rail mt-2 grid grid-cols-4 gap-2 motion-safe:animate-[ou-panel-in_180ms_ease-out] max-md:auto-cols-[46%] max-md:grid-flow-col max-md:grid-cols-none max-md:overflow-x-auto max-md:pb-1 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden"
          data-allow-horizontal-scroll="true"
        >
          {actions.map((action) => (
            <button
              className={cn(
                'ou-action-card group min-h-12 border px-3 py-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 dark:focus-visible:ring-primary/55',
                actionToneClasses[action.tone]
              )}
              data-tone={action.tone}
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
      ) : null}

      {expanded ? (
        <div
          className="ou-launchpad-panel mt-2 grid gap-2 motion-safe:animate-[ou-panel-in_180ms_ease-out] lg:grid-cols-4 max-md:auto-cols-[72%] max-md:grid-flow-col max-md:grid-cols-none max-md:overflow-x-auto max-md:pb-1 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden"
          data-allow-horizontal-scroll="true"
        >
          {actions.map((action) => {
            const Icon = action.icon;
            const active = activePage === action.pageId;

            return (
              <button
                className={cn(
                  'ou-action-card group min-h-[68px] border p-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 dark:focus-visible:ring-primary/55',
                  active ? 'shadow-[var(--ou-shadow-interactive)]' : actionToneClasses[action.tone]
                )}
                aria-current={active ? 'page' : undefined}
                data-tone={action.tone}
                key={action.id}
                onClick={() => onSelectPage(action.pageId)}
                onFocus={() => onPrefetchPage?.(action.pageId)}
                onMouseEnter={() => onPrefetchPage?.(action.pageId)}
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className={cn('grid h-8 w-8 place-items-center border', toneClasses[action.tone])} data-tone={action.tone}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="ou-chip rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] shadow-sm">
                    {action.metric}
                  </span>
                </div>
                <p className="mt-2 text-xs font-semibold">{action.label}</p>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
