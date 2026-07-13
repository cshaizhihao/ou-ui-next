import { AlertTriangle, ClipboardList, Gauge, ServerCog } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import type { PageId } from '../../app/navigation';
import { cn } from '../../lib/cn';
import type { ControlPlaneLiveEventState } from '../../services/api/use-control-plane-live-events';

type ControlPlaneStatusCenterProps = {
  agentsOnlineCount: number;
  agentsTotalCount: number;
  runtimeApplyingCount: number;
  failedTasksCount: number;
  quotaRiskCount: number;
  alertsCount: number;
  liveEventState?: ControlPlaneLiveEventState;
  language: AppLanguage;
  onPrefetchPage?: (pageId: PageId) => void;
  onSelectPage: (pageId: PageId) => void;
};

type StatusItem = {
  id: string;
  label: string;
  value: string;
  meta: string;
  pageId: PageId;
  tone: 'primary' | 'success' | 'danger' | 'warning';
  icon: typeof ServerCog;
};

const copy = {
  zh: {
    title: '状态中心',
    ariaLabel: '控制面状态中心',
    onlineAgents: 'Agent 在线',
    runtimeApply: 'Runtime Apply',
    failedTasks: '失败任务',
    quotaRisk: '配额风险',
    live: '实时',
    connecting: '连接中',
    reconnecting: '重连中',
    unavailable: '定时同步',
    disabled: '已暂停',
    agentsMeta: (online: number, total: number) => `${online}/${total} 可用`,
    runtimeMeta: (count: number) => (count > 0 ? '执行中' : '无挂起'),
    failedMeta: (count: number) => (count > 0 ? '需要处理' : '证据正常'),
    quotaMeta: (count: number, alerts: number) => (count > 0 ? `${alerts} 告警` : `${alerts} 告警`)
  },
  en: {
    title: 'Status Center',
    ariaLabel: 'Control-plane status center',
    onlineAgents: 'Agent Online',
    runtimeApply: 'Runtime Apply',
    failedTasks: 'Failed Tasks',
    quotaRisk: 'Quota Risk',
    live: 'Live',
    connecting: 'Connecting',
    reconnecting: 'Reconnecting',
    unavailable: 'Timed sync',
    disabled: 'Paused',
    agentsMeta: (online: number, total: number) => `${online}/${total} available`,
    runtimeMeta: (count: number) => (count > 0 ? 'running' : 'none pending'),
    failedMeta: (count: number) => (count > 0 ? 'needs action' : 'evidence ok'),
    quotaMeta: (count: number, alerts: number) => (count > 0 ? `${alerts} alerts` : `${alerts} alerts`)
  }
} as const;

const toneClasses = {
  primary: 'ou-tone-primary hover:border-[var(--ou-primary)] hover:bg-[var(--ou-primary-softer)]',
  success: 'ou-tone-success hover:border-[var(--ou-success)] hover:bg-[var(--ou-success-soft)]',
  danger: 'ou-tone-danger hover:border-[var(--ou-danger)] hover:bg-[var(--ou-danger-soft)]',
  warning: 'ou-tone-warning hover:border-[var(--ou-warning)] hover:bg-[var(--ou-warning-soft)]'
} as const;

export function ControlPlaneStatusCenter({
  agentsOnlineCount,
  agentsTotalCount,
  runtimeApplyingCount,
  failedTasksCount,
  quotaRiskCount,
  alertsCount,
  liveEventState = 'unavailable',
  language,
  onPrefetchPage,
  onSelectPage
}: ControlPlaneStatusCenterProps) {
  const t = copy[language];
  const liveLabel = t[liveEventState];
  const liveTone = liveEventState === 'live' ? 'ou-tone-success' : liveEventState === 'unavailable' ? 'ou-tone-primary' : 'ou-tone-warning';
  const statusItems: StatusItem[] = [
    {
      id: 'agents-online',
      icon: ServerCog,
      label: t.onlineAgents,
      value: `${agentsOnlineCount}/${agentsTotalCount}`,
      meta: t.agentsMeta(agentsOnlineCount, agentsTotalCount),
      pageId: 'nodes',
      tone: agentsTotalCount > 0 && agentsOnlineCount === agentsTotalCount ? 'success' : 'warning'
    },
    {
      id: 'runtime-apply',
      icon: Gauge,
      label: t.runtimeApply,
      value: String(runtimeApplyingCount),
      meta: t.runtimeMeta(runtimeApplyingCount),
      pageId: 'tasks',
      tone: runtimeApplyingCount > 0 ? 'warning' : 'success'
    },
    {
      id: 'failed-tasks',
      icon: ClipboardList,
      label: t.failedTasks,
      value: String(failedTasksCount),
      meta: t.failedMeta(failedTasksCount),
      pageId: 'tasks',
      tone: failedTasksCount > 0 ? 'danger' : 'success'
    },
    {
      id: 'quota-risk',
      icon: AlertTriangle,
      label: t.quotaRisk,
      value: String(quotaRiskCount),
      meta: t.quotaMeta(quotaRiskCount, alertsCount),
      pageId: 'customerNodes',
      tone: quotaRiskCount > 0 ? 'danger' : alertsCount > 0 ? 'warning' : 'success'
    }
  ];

  return (
    <section aria-label={t.ariaLabel} className="surface-shell ou-card-enter mb-5 overflow-hidden p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight text-[var(--ou-text)]">{t.title}</h3>
        <span className="flex items-center gap-1.5">
          <span
            aria-live="polite"
            className={cn('ou-chip rounded-full border px-2 py-0.5 text-[10px] font-semibold shadow-sm', liveTone)}
            data-live-event-state={liveEventState}
          >
            {liveLabel}
          </span>
          <span className="ou-chip ou-tone-warning rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold shadow-sm">
            {alertsCount}
          </span>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {statusItems.map((item) => {
          const Icon = item.icon;

          return (
            <button
              className={cn(
                'ou-action-card min-h-[64px] border p-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 dark:focus-visible:ring-primary/55',
                toneClasses[item.tone]
              )}
              data-status-center-item={item.id}
              data-tone={item.tone}
              key={item.id}
              onClick={() => onSelectPage(item.pageId)}
              onFocus={() => onPrefetchPage?.(item.pageId)}
              onMouseEnter={() => onPrefetchPage?.(item.pageId)}
              type="button"
            >
              <span className="flex items-start justify-between gap-3">
                <span className="grid h-8 w-8 place-items-center border">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="font-mono text-xl font-semibold leading-none tracking-tight">{item.value}</span>
              </span>
              <span className="mt-2 block truncate text-xs font-semibold">{item.label}</span>
              <span className="mt-0.5 block truncate text-[10px] font-semibold uppercase tracking-[0.08em] opacity-70">
                {item.meta}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
