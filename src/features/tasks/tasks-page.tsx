import { useMemo } from 'react';
import { RotateCcw, Workflow } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
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
  language?: AppLanguage;
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

const copy = {
  zh: {
    title: '执行记录',
    subtitle: '记录 Master 下发、Agent 回执、预检、快照和回滚状态，确保每一次高风险变更都有据可查。',
    pipelineTitle: '发布流水线',
    refresh: '刷新记录',
    actor: '执行者',
    attempts: '尝试次数',
    rollback: '发起回滚',
    runtimeRelease: '运行时发布',
    configRevision: '配置版本',
    preflight: '预检',
    snapshot: '快照',
    pendingArtifact: '等待产物生成',
    emptyTitle: '暂无执行记录',
    emptyDescription: '在转发、订阅、分流或调优页面触发操作后，这里会出现新的执行记录。',
    checksUnit: '项检查',
    diffSummary: (added: number, changed: number, removed: number, language: AppLanguage) =>
      `变更 +${formatNumber(added, language)} / ~${formatNumber(changed, language)} / -${formatNumber(removed, language)}`,
    preflightDetail: (checks: number, agentId: string, language: AppLanguage) =>
      `${formatNumber(checks, language)} ${copy.zh.checksUnit} · ${agentId}`,
    snapshotDetail: (reason: string, agentId: string) => `${reason} · ${agentId}`,
    status: {
      queued: '已排队',
      running: '执行中',
      succeeded: '已成功',
      failed: '已失败',
      retrying: '重试中',
      rolled_back: '已回滚',
      canceled: '已取消',
      compiled: '已编译',
      preflight_ready: '预检就绪',
      applied: '已应用',
      pending: '待处理',
      passed: '已通过',
      captured: '已捕获',
      verified: '已验证',
      restored: '已恢复',
      expired: '已过期',
      not_generated: '未生成'
    },
    operation: {
      'agent.deploy': '部署 Agent',
      'agent.upgrade': '升级 Agent',
      'agent.rollback': '回滚 Agent',
      'module.install': '安装模块',
      'inbound.create': '创建入口',
      'inbound.update': '更新入口',
      'inbound.delete': '删除入口',
      'config.compile': '编译配置',
      'config.apply': '应用配置',
      'runtime.reload': '重载运行时',
      'forward.create': '创建转发',
      'forward.update': '更新转发',
      'forward.apply': '应用转发',
      'forward.pause': '暂停转发',
      'forward.resume': '恢复转发',
      'tunnel.create': '创建隧道',
      'tunnel.update': '更新隧道',
      'tunnel.redeploy': '重新部署隧道',
      'subscription.import': '导入订阅',
      'subscription.sync': '同步订阅',
      'subscription.export': '导出订阅',
      'subscription.generate': '生成订阅',
      'quota.reset': '重置配额',
      'permission.grant': '授予权限',
      'permission.revoke': '撤销权限',
      'system.tune': '系统调优'
    },
    moduleKind: {
      xray: 'Xray',
      gost: 'Gost',
      hysteria2: 'Hysteria 2',
      flvx: 'FLVX',
      bbr: 'BBR'
    },
    snapshotReason: {
      pre_apply: '应用前快照',
      manual: '手动快照',
      rollback: '回滚快照'
    }
  },
  en: {
    title: 'Execution Log',
    subtitle: 'Track Master dispatch, Agent acknowledgement, preflight, snapshots, and rollback state for every high-risk change.',
    pipelineTitle: 'Release Pipeline',
    refresh: 'Refresh Records',
    actor: 'Actor',
    attempts: 'Attempts',
    rollback: 'Start Rollback',
    runtimeRelease: 'Runtime Release',
    configRevision: 'Config Revision',
    preflight: 'Preflight',
    snapshot: 'Snapshot',
    pendingArtifact: 'Pending Artifact',
    emptyTitle: 'No execution records',
    emptyDescription: 'New execution records will appear after actions are triggered in forwarding, subscription, routing, or tuning pages.',
    checksUnit: 'checks',
    diffSummary: (added: number, changed: number, removed: number, language: AppLanguage) =>
      `Diff +${formatNumber(added, language)} / ~${formatNumber(changed, language)} / -${formatNumber(removed, language)}`,
    preflightDetail: (checks: number, agentId: string, language: AppLanguage) =>
      `${formatNumber(checks, language)} ${copy.en.checksUnit} · ${agentId}`,
    snapshotDetail: (reason: string, agentId: string) => `${reason} · ${agentId}`,
    status: {
      queued: 'Queued',
      running: 'Running',
      succeeded: 'Succeeded',
      failed: 'Failed',
      retrying: 'Retrying',
      rolled_back: 'Rolled Back',
      canceled: 'Canceled',
      compiled: 'Compiled',
      preflight_ready: 'Preflight Ready',
      applied: 'Applied',
      pending: 'Pending',
      passed: 'Passed',
      captured: 'Captured',
      verified: 'Verified',
      restored: 'Restored',
      expired: 'Expired',
      not_generated: 'Not Generated'
    },
    operation: {
      'agent.deploy': 'Deploy Agent',
      'agent.upgrade': 'Upgrade Agent',
      'agent.rollback': 'Rollback Agent',
      'module.install': 'Install Module',
      'inbound.create': 'Create Inbound',
      'inbound.update': 'Update Inbound',
      'inbound.delete': 'Delete Inbound',
      'config.compile': 'Compile Config',
      'config.apply': 'Apply Config',
      'runtime.reload': 'Reload Runtime',
      'forward.create': 'Create Forwarding',
      'forward.update': 'Update Forwarding',
      'forward.apply': 'Apply Forwarding',
      'forward.pause': 'Pause Forwarding',
      'forward.resume': 'Resume Forwarding',
      'tunnel.create': 'Create Tunnel',
      'tunnel.update': 'Update Tunnel',
      'tunnel.redeploy': 'Redeploy Tunnel',
      'subscription.import': 'Import Subscription',
      'subscription.sync': 'Sync Subscription',
      'subscription.export': 'Export Subscription',
      'subscription.generate': 'Generate Subscription',
      'quota.reset': 'Reset Quota',
      'permission.grant': 'Grant Permission',
      'permission.revoke': 'Revoke Permission',
      'system.tune': 'Tune System'
    },
    moduleKind: {
      xray: 'Xray',
      gost: 'Gost',
      hysteria2: 'Hysteria 2',
      flvx: 'FLVX',
      bbr: 'BBR'
    },
    snapshotReason: {
      pre_apply: 'Pre-Apply Snapshot',
      manual: 'Manual Snapshot',
      rollback: 'Rollback Snapshot'
    }
  }
} as const;

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

function StatusPill({ status, language }: { status?: string; language: AppLanguage }) {
  const t = copy[language];

  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${getStatusPillClass(status)}`}>
      {status ? t.status[status as keyof typeof t.status] ?? status : t.status.not_generated}
    </span>
  );
}

function ReleaseStep({
  label,
  value,
  status,
  detail,
  language
}: {
  label: string;
  value?: string;
  status?: string;
  detail?: string;
  language: AppLanguage;
}) {
  const t = copy[language];

  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
        <StatusPill status={status} language={language} />
      </div>
      <p className="break-all font-mono text-[11px] font-semibold text-slate-700 dark:text-white/80">
        {value ?? t.pendingArtifact}
      </p>
      {detail ? <p className="mt-2 text-[11px] text-slate-500 dark:text-white/45">{detail}</p> : null}
    </div>
  );
}

function RuntimeReleaseTimeline({ bundle, language }: { bundle: RuntimeReleaseBundle; language: AppLanguage }) {
  const t = copy[language];
  const { configRevision, preflightPlan, runtimeSnapshot } = bundle;
  const moduleKind = configRevision?.moduleKind ?? preflightPlan?.moduleKind ?? runtimeSnapshot?.moduleKind;

  if (!configRevision && !preflightPlan && !runtimeSnapshot) {
    return null;
  }

  return (
    <div className="mt-4 border-t border-slate-200 pt-4 dark:border-white/10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Workflow className="h-3.5 w-3.5 text-blue-500 dark:text-primary" />
          <p className="text-xs font-bold text-slate-800 dark:text-white">{t.runtimeRelease}</p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500 dark:text-white/40">
          {moduleKind ? t.moduleKind[moduleKind] : ''}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <ReleaseStep
          detail={
            configRevision
              ? t.diffSummary(
                  configRevision.diffSummary.added,
                  configRevision.diffSummary.changed,
                  configRevision.diffSummary.removed,
                  language
                )
              : undefined
          }
          label={t.configRevision}
          language={language}
          status={configRevision?.status}
          value={configRevision?.id}
        />
        <ReleaseStep
          detail={
            preflightPlan ? t.preflightDetail(preflightPlan.checks.length, preflightPlan.agentId, language) : undefined
          }
          label={t.preflight}
          language={language}
          status={preflightPlan?.status}
          value={preflightPlan?.id}
        />
        <ReleaseStep
          detail={
            runtimeSnapshot
              ? t.snapshotDetail(t.snapshotReason[runtimeSnapshot.reason], runtimeSnapshot.agentId)
              : undefined
          }
          label={t.snapshot}
          language={language}
          status={runtimeSnapshot?.status}
          value={runtimeSnapshot?.id}
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
  language = 'zh',
  taskMutationBusy = false,
  onRollbackTask,
  onRefresh
}: TasksPageProps) {
  const t = copy[language];
  const releaseBundles = useMemo(
    () => createReleaseBundles(tasks, configRevisions, preflightPlans, runtimeSnapshots),
    [configRevisions, preflightPlans, runtimeSnapshots, tasks]
  );

  return (
    <div className="space-y-6">
      <section className="stagger-1">
        <h3 className="text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-white/50">{t.subtitle}</p>
      </section>

      <GlassCard className="stagger-2 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-blue-500 dark:text-primary" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-white">
              {t.pipelineTitle} · {formatNumber(tasks.length, language)}
            </h4>
          </div>
          <GlowButton className="px-4 py-2 text-xs" onClick={onRefresh}>
            {t.refresh}
          </GlowButton>
        </div>

        <div className="space-y-3">
          {releaseBundles.map((bundle) => (
            <div key={bundle.task.id} className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{bundle.task.summary}</p>
                  <p className="mt-1 break-all font-mono text-[11px] text-slate-500 dark:text-white/45">
                    {t.operation[bundle.task.operation]} · {bundle.task.targetLabel} ·{' '}
                    {formatDateTime(bundle.task.createdAt, language)}
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-white/10 dark:text-white/70">
                  {t.status[bundle.task.status]}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-white/50">
                <span>
                  {t.actor} {bundle.task.actor} · {t.attempts} {formatNumber(bundle.task.attempts, language)}
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
                    {t.rollback}
                  </button>
                ) : null}
              </div>
              <RuntimeReleaseTimeline bundle={bundle} language={language} />
            </div>
          ))}
          {tasks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-white/10">
              <p className="text-sm font-bold text-slate-700 dark:text-white/70">{t.emptyTitle}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-white/45">{t.emptyDescription}</p>
            </div>
          ) : null}
        </div>
      </GlassCard>
    </div>
  );
}
