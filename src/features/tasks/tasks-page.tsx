import { useMemo } from 'react';
import { RotateCcw, Workflow } from 'lucide-react';
import { GlassCard } from '../../components/ui/glass-card';
import { GlowButton } from '../../components/ui/glow-button';
import type { RuntimeConfigRevision, RuntimePreflightPlan, RuntimeSnapshot } from '../../domain/runtime-release';
import type { DeployTask } from '../../domain/task';
import { formatDateTime, formatNumber } from '../shared/format';

type TasksPageProps = {
  tasks: DeployTask[];
  configRevisions: RuntimeConfigRevision[];
  preflightPlans: RuntimePreflightPlan[];
  runtimeSnapshots: RuntimeSnapshot[];
  taskMutationBusy?: boolean;
  onRollbackTask: (taskId: string) => void;
  onRefresh: () => void;
};

type RuntimeReleaseBundle = {
  task: DeployTask;
  configRevision?: RuntimeConfigRevision;
  preflightPlan?: RuntimePreflightPlan;
  runtimeSnapshot?: RuntimeSnapshot;
};

function indexFirstByTaskId<T extends { taskId: string }>(items: T[]) {
  const indexed = new Map<string, T>();

  items.forEach((item) => {
    if (!indexed.has(item.taskId)) {
      indexed.set(item.taskId, item);
    }
  });

  return indexed;
}

function createReleaseBundles(
  tasks: DeployTask[],
  configRevisions: RuntimeConfigRevision[],
  preflightPlans: RuntimePreflightPlan[],
  runtimeSnapshots: RuntimeSnapshot[]
): RuntimeReleaseBundle[] {
  const configByTaskId = indexFirstByTaskId(configRevisions);
  const preflightByTaskId = indexFirstByTaskId(preflightPlans);
  const preflightByRevisionId = new Map(preflightPlans.map((plan) => [plan.configRevisionId, plan]));
  const snapshotByTaskId = indexFirstByTaskId(runtimeSnapshots);
  const snapshotById = new Map(runtimeSnapshots.map((snapshot) => [snapshot.id, snapshot]));

  return tasks.map((task) => {
    const configRevision = configByTaskId.get(task.id);
    const preflightPlan = configRevision
      ? preflightByRevisionId.get(configRevision.id)
      : preflightByTaskId.get(task.id);
    const runtimeSnapshot = configRevision
      ? snapshotById.get(configRevision.snapshotBeforeId)
      : snapshotByTaskId.get(task.id);

    return {
      task,
      configRevision,
      preflightPlan,
      runtimeSnapshot
    };
  });
}

function getStatusPillClass(status?: string) {
  if (!status) {
    return 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/50';
  }

  if (status.includes('failed')) {
    return 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-200';
  }

  if (['applied', 'passed', 'verified', 'restored'].includes(status)) {
    return 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-200';
  }

  if (['compiled', 'preflight_ready', 'captured', 'pending'].includes(status)) {
    return 'bg-blue-50 text-blue-600 dark:bg-primary/15 dark:text-primary';
  }

  return 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/70';
}

function StatusPill({ status }: { status?: string }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${getStatusPillClass(status)}`}>
      {status ?? 'not_generated'}
    </span>
  );
}

function ReleaseStep({
  label,
  value,
  status,
  detail
}: {
  label: string;
  value?: string;
  status?: string;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
        <StatusPill status={status} />
      </div>
      <p className="break-all font-mono text-[11px] font-semibold text-slate-700 dark:text-white/80">
        {value ?? 'pending-artifact'}
      </p>
      {detail ? <p className="mt-2 text-[11px] text-slate-500 dark:text-white/45">{detail}</p> : null}
    </div>
  );
}

function RuntimeReleaseTimeline({ bundle }: { bundle: RuntimeReleaseBundle }) {
  const { configRevision, preflightPlan, runtimeSnapshot } = bundle;

  if (!configRevision && !preflightPlan && !runtimeSnapshot) {
    return null;
  }

  return (
    <div className="mt-4 border-t border-slate-200 pt-4 dark:border-white/10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Workflow className="h-3.5 w-3.5 text-blue-500 dark:text-primary" />
          <p className="text-xs font-bold text-slate-800 dark:text-white">Runtime Release</p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500 dark:text-white/40">
          {configRevision?.moduleKind ?? preflightPlan?.moduleKind ?? runtimeSnapshot?.moduleKind}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <ReleaseStep
          label="Config Revision"
          value={configRevision?.id}
          status={configRevision?.status}
          detail={
            configRevision
              ? `diff +${configRevision.diffSummary.added} / ~${configRevision.diffSummary.changed} / -${configRevision.diffSummary.removed}`
              : undefined
          }
        />
        <ReleaseStep
          label="Preflight"
          value={preflightPlan?.id}
          status={preflightPlan?.status}
          detail={
            preflightPlan
              ? `${formatNumber(preflightPlan.checks.length)} checks · ${preflightPlan.agentId}`
              : undefined
          }
        />
        <ReleaseStep
          label="Snapshot"
          value={runtimeSnapshot?.id}
          status={runtimeSnapshot?.status}
          detail={runtimeSnapshot ? `${runtimeSnapshot.reason} · ${runtimeSnapshot.agentId}` : undefined}
        />
      </div>
      {configRevision?.failureReason ?? preflightPlan?.failureReason ? (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50/70 p-3 text-xs font-semibold text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200">
          {configRevision?.failureReason ?? preflightPlan?.failureReason}
        </p>
      ) : null}
    </div>
  );
}

export function TasksPage({
  tasks,
  configRevisions,
  preflightPlans,
  runtimeSnapshots,
  taskMutationBusy = false,
  onRollbackTask,
  onRefresh
}: TasksPageProps) {
  const releaseBundles = useMemo(
    () => createReleaseBundles(tasks, configRevisions, preflightPlans, runtimeSnapshots),
    [configRevisions, preflightPlans, runtimeSnapshots, tasks]
  );

  return (
    <div className="space-y-6">
      <section className="stagger-1">
        <h3 className="text-base font-bold text-slate-800 dark:text-white">任务队列</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-white/50">
          所有风险操作先进入可审计任务队列，由后端 Agent 确认后推进状态。
        </p>
      </section>

      <GlassCard className="stagger-2 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-blue-500 dark:text-primary" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-white">
              Deploy Pipeline · {formatNumber(tasks.length)}
            </h4>
          </div>
          <GlowButton className="px-4 py-2 text-xs" onClick={onRefresh}>
            刷新任务
          </GlowButton>
        </div>

        <div className="space-y-3">
          {releaseBundles.map((bundle) => (
            <div key={bundle.task.id} className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{bundle.task.summary}</p>
                  <p className="mt-1 break-all font-mono text-[11px] text-slate-500 dark:text-white/45">
                    {bundle.task.operation} · {bundle.task.targetLabel} · {formatDateTime(bundle.task.createdAt)}
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-white/10 dark:text-white/70">
                  {bundle.task.status}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-white/50">
                <span>
                  Actor {bundle.task.actor} · attempts {bundle.task.attempts}
                </span>
                {bundle.task.rollbackAvailable && bundle.task.status === 'succeeded' ? (
                  <button
                    className="inline-flex items-center gap-1 text-blue-600 disabled:cursor-not-allowed disabled:opacity-60 dark:text-primary"
                    data-task-action="rollback"
                    disabled={taskMutationBusy}
                    onClick={() => onRollbackTask(bundle.task.id)}
                    type="button"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    发起回滚
                  </button>
                ) : null}
              </div>
              <RuntimeReleaseTimeline bundle={bundle} />
            </div>
          ))}
          {tasks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-white/10">
              <p className="text-sm font-bold text-slate-700 dark:text-white/70">暂无待处理任务</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-white/45">
                点击转发、订阅、分流或调优页面的操作按钮创建任务。
              </p>
            </div>
          ) : null}
        </div>
      </GlassCard>
    </div>
  );
}
