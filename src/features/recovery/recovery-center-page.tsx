import { AlertTriangle, ArrowRight, CheckCircle2, LifeBuoy, RefreshCw, ServerOff, Workflow } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import type { PageId } from '../../app/navigation';
import { ResponsivePage, ResponsiveSectionHeader, WorkspaceCockpit } from '../../components/layout/responsive-page';
import { GlowButton } from '../../components/ui/glow-button';
import type { Agent, RuntimeConvergenceReadModel, SystemAlert } from '../../domain';
import type { DeployTask } from '../../domain/task';
import { cn } from '../../lib/cn';
import { formatDateTime } from '../shared/format';
import { createRecoveryQueues } from './recovery-model';

const copy = {
  zh: {
    eyebrow: 'Recovery Center',
    title: '恢复中心',
    description: '集中查看未收敛的运行时状态、失败任务、补偿队列和 Agent 可用性。所有条目都来自持久化证据。',
    refresh: '刷新证据',
    healthy: '当前没有待恢复事项',
    healthyDetail: 'Agent、运行时验证、补偿队列和系统告警均未发现需要人工介入的问题。',
    open: '查看处置路径',
    queues: {
      fleet: ['Agent 可用性', '离线或降级主机'],
      runtime: ['运行时收敛', '失败或缺少验证'],
      compensation: ['补偿队列', '等待恢复或补偿失败'],
      alerts: ['活动告警', '当前系统诊断证据']
    }
  },
  en: {
    eyebrow: 'Recovery Center',
    title: 'Recovery Center',
    description: 'Review runtime drift, failed tasks, compensation work, and Agent availability from persisted evidence.',
    refresh: 'Refresh evidence',
    healthy: 'No recovery work is pending',
    healthyDetail: 'Agents, runtime verification, compensation work, and active alerts require no operator action.',
    open: 'Open response path',
    queues: {
      fleet: ['Agent availability', 'Offline or degraded hosts'],
      runtime: ['Runtime convergence', 'Failed or missing verification'],
      compensation: ['Compensation queue', 'Pending or failed recovery'],
      alerts: ['Active alerts', 'Current diagnostic evidence']
    }
  }
} as const;

const queueIcons = {
  fleet: ServerOff,
  runtime: Workflow,
  compensation: LifeBuoy,
  alerts: AlertTriangle
} as const;

export function RecoveryCenterPage({
  agents,
  language = 'zh',
  runtimeConvergence,
  systemAlerts,
  tasks,
  onRefresh,
  onSelectPage
}: {
  agents: Agent[];
  language?: AppLanguage;
  runtimeConvergence: RuntimeConvergenceReadModel[];
  systemAlerts: SystemAlert[];
  tasks: DeployTask[];
  onRefresh: () => void;
  onSelectPage: (pageId: PageId) => void;
}) {
  const t = copy[language];
  const queues = createRecoveryQueues({ agents, runtimeConvergence, systemAlerts, tasks });
  const total = queues.reduce((count, queue) => count + queue.items.length, 0);

  return (
    <ResponsivePage>
      <div className="contents" data-recovery-center-page="ready">
        <ResponsiveSectionHeader
          action={
            <GlowButton className="min-h-11 px-4" onClick={onRefresh}>
              <RefreshCw className="h-4 w-4" />
              {t.refresh}
            </GlowButton>
          }
          description={t.description}
          eyebrow={t.eyebrow}
          icon={<LifeBuoy className="h-5 w-5 text-[var(--ou-primary)]" />}
          title={t.title}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label={t.title}>
        {queues.map((queue) => {
          const Icon = queueIcons[queue.id];
          const [label, detail] = t.queues[queue.id];
          const critical = queue.items.filter((item) => item.severity === 'critical').length;

          return (
            <div
              className={cn('min-w-0 border p-3', critical > 0 ? 'ou-tone-danger' : queue.items.length > 0 ? 'ou-tone-warning' : 'ou-tone-success')}
              data-recovery-queue={queue.id}
              key={queue.id}
            >
              <div className="flex items-start justify-between gap-3">
                <Icon className="h-4 w-4" />
                <span className="font-mono text-xl font-semibold tabular-nums">{queue.items.length}</span>
              </div>
              <p className="mt-2 text-xs font-semibold">{label}</p>
              <p className="mt-0.5 truncate text-[11px] opacity-70">{detail}</p>
            </div>
          );
        })}
      </div>

      {total === 0 ? (
        <WorkspaceCockpit className="ou-tone-success grid min-h-48 place-items-center p-6 text-center">
          <div>
            <CheckCircle2 className="mx-auto h-8 w-8" />
            <h3 className="mt-3 text-base font-semibold">{t.healthy}</h3>
            <p className="mt-1 max-w-xl text-xs leading-5 opacity-75">{t.healthyDetail}</p>
          </div>
        </WorkspaceCockpit>
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          {queues.map((queue) => {
            const [label, detail] = t.queues[queue.id];
            const Icon = queueIcons[queue.id];

            return (
              <WorkspaceCockpit className="min-w-0 p-3" key={queue.id} aria-label={label}>
                <div className="flex items-center justify-between gap-3 border-b border-[var(--ou-border)] pb-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon className="h-4 w-4 flex-shrink-0 text-[var(--ou-primary)]" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{label}</span>
                      <span className="block truncate text-[11px] text-[var(--ou-text-muted)]">{detail}</span>
                    </span>
                  </span>
                  <span className="ou-chip rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold">{queue.items.length}</span>
                </div>
                {queue.items.length === 0 ? (
                  <p className="py-8 text-center text-xs text-[var(--ou-text-muted)]">{t.healthy}</p>
                ) : (
                  <div className="divide-y divide-[var(--ou-border)]">
                    {queue.items.map((item) => (
                      <div className="grid min-w-0 gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center" key={item.id}>
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className={cn('h-2 w-2 rounded-full', item.severity === 'critical' ? 'bg-[var(--ou-danger)]' : 'bg-[var(--ou-warning)]')} />
                            <p className="min-w-0 truncate text-xs font-semibold text-[var(--ou-text)]">{item.title}</p>
                            <time className="font-mono text-[10px] text-[var(--ou-text-muted)]">{formatDateTime(item.observedAt)}</time>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-[var(--ou-text-muted)]">{item.detail}</p>
                          <p className="mt-1 truncate font-mono text-[10px] text-[var(--ou-text-subtle)]">{item.evidence}</p>
                        </div>
                        <button
                          className="ou-command-pill inline-flex min-h-11 items-center justify-center gap-2 rounded-full border px-3 text-xs font-semibold"
                          onClick={() => onSelectPage(item.pageId)}
                          type="button"
                        >
                          {t.open}
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </WorkspaceCockpit>
            );
          })}
        </div>
      )}
    </ResponsivePage>
  );
}
