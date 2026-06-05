import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Download, RotateCcw, Terminal, Workflow } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { GlassCard } from '../../components/ui/glass-card';
import { GlowButton } from '../../components/ui/glow-button';
import type { RuntimeConfigRevision, RuntimePreflightPlan, RuntimeSnapshot } from '../../domain/runtime-release';
import type { DeployTask } from '../../domain/task';
import type {
  AgentLogChunk,
  AgentLogRetentionPolicyReadModel,
  AgentLogRetentionPolicyUpdateInput
} from '../../services/api/control-plane-api';
import { formatDateTime, formatNumber } from '../shared/format';

type TasksPageProps = {
  tasks: DeployTask[];
  agentLogChunks?: AgentLogChunk[];
  agentLogRetentionPolicy?: AgentLogRetentionPolicyReadModel;
  agentLogRetentionBusy?: boolean;
  agentLogExportBusy?: boolean;
  configRevisions: RuntimeConfigRevision[];
  preflightPlans: RuntimePreflightPlan[];
  runtimeSnapshots: RuntimeSnapshot[];
  language?: AppLanguage;
  taskMutationBusy?: boolean;
  onExportAgentLogs?: () => void;
  onUpdateAgentLogRetentionPolicy?: (input: AgentLogRetentionPolicyUpdateInput) => void;
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
    agentLogsTitle: '主机代理运行日志',
    agentLogsEmpty: '暂无运行日志',
    agentLogRetentionTitle: '留存策略',
    agentLogRetentionAge: (days: number, language: AppLanguage) => `保留 ${formatNumber(days, language)} 天`,
    agentLogRetentionLimit: (count: number, language: AppLanguage) => `每台主机代理 ${formatNumber(count, language)} 条`,
    agentLogRetentionSourceLabels: {
      'runtime-config': '运行配置',
      'control-plane': '控制面配置'
    },
    agentLogRetentionAgeLabel: '保留天数',
    agentLogRetentionLimitLabel: '单机上限',
    agentLogRetentionSave: '保存策略',
    agentLogRetentionSaveReason: '操作员更新主机代理日志留存策略',
    agentLogExport: '导出日志',
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
    agentLogDetail: (agentId: string, taskId: string, commandId: string, chunkSeq: number, language: AppLanguage) =>
      `${agentId} · 任务 ${taskId} · 命令 ${commandId} · 片段 ${formatNumber(chunkSeq, language)}`,
    streamLabels: {
      stdout: '标准输出',
      stderr: '错误输出',
      agent: '主机代理',
      runtime: '运行时'
    },
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
      'agent.update': '更新主机',
      'agent.delete': '移除主机',
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
      'forward.delete': '删除转发',
      'forward.pause': '暂停转发',
      'forward.resume': '恢复转发',
      'tunnel.create': '创建转发链路',
      'tunnel.update': '更新转发链路',
      'tunnel.redeploy': '重新下发转发链路',
      'subscription.import': '导入订阅',
      'subscription.sync': '同步订阅',
      'subscription.export': '导出订阅',
      'subscription.profile.upsert': '保存订阅配置',
      'subscription.profile.delete': '删除订阅配置',
      'subscription.generate': '生成订阅',
      'subscription.delete': '删除订阅',
      'quota.reset': '重置配额',
      'permission.grant': '授予权限',
      'permission.revoke': '撤销权限',
      'system.tune': '系统调优'
    },
    moduleKind: {
      'host-agent': '主机代理',
      xray: 'Xray',
      gost: 'Gost',
      hysteria2: 'Hysteria 2',
      'port-forwarding': '端口转发',
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
    agentLogsTitle: 'Agent Runtime Logs',
    agentLogsEmpty: 'No runtime logs retained',
    agentLogRetentionTitle: 'Retention',
    agentLogRetentionAge: (days: number, language: AppLanguage) => `${formatNumber(days, language)} days`,
    agentLogRetentionLimit: (count: number, language: AppLanguage) => `${formatNumber(count, language)} per Agent`,
    agentLogRetentionSourceLabels: {
      'runtime-config': 'Runtime Config',
      'control-plane': 'Control Plane'
    },
    agentLogRetentionAgeLabel: 'Retention Days',
    agentLogRetentionLimitLabel: 'Per-Agent Cap',
    agentLogRetentionSave: 'Save Policy',
    agentLogRetentionSaveReason: 'Operator updated Agent log retention policy',
    agentLogExport: 'Export Logs',
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
    agentLogDetail: (agentId: string, taskId: string, commandId: string, chunkSeq: number, language: AppLanguage) =>
      `${agentId} · Task ${taskId} · Command ${commandId} · Chunk ${formatNumber(chunkSeq, language)}`,
    streamLabels: {
      stdout: 'stdout',
      stderr: 'stderr',
      agent: 'Agent',
      runtime: 'Runtime'
    },
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
      'agent.update': 'Update Host',
      'agent.delete': 'Remove Host',
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
      'forward.delete': 'Delete Forwarding',
      'forward.pause': 'Pause Forwarding',
      'forward.resume': 'Resume Forwarding',
      'tunnel.create': 'Create Forwarding Link',
      'tunnel.update': 'Update Forwarding Link',
      'tunnel.redeploy': 'Redeploy Forwarding Link',
      'subscription.import': 'Import Subscription',
      'subscription.sync': 'Sync Subscription',
      'subscription.export': 'Export Subscription',
      'subscription.profile.upsert': 'Save Subscription Profile',
      'subscription.profile.delete': 'Delete Subscription Profile',
      'subscription.generate': 'Generate Subscription',
      'subscription.delete': 'Delete Subscription',
      'quota.reset': 'Reset Quota',
      'permission.grant': 'Grant Permission',
      'permission.revoke': 'Revoke Permission',
      'system.tune': 'Tune System'
    },
    moduleKind: {
      'host-agent': 'Host Agent',
      xray: 'Xray',
      gost: 'Gost',
      hysteria2: 'Hysteria 2',
      'port-forwarding': 'Port Forwarding',
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

function AgentLogPanel({
  chunks,
  language,
  policy,
  busy = false,
  exportBusy = false,
  onExport,
  onUpdatePolicy
}: {
  chunks: AgentLogChunk[];
  language: AppLanguage;
  policy?: AgentLogRetentionPolicyReadModel;
  busy?: boolean;
  exportBusy?: boolean;
  onExport?: () => void;
  onUpdatePolicy?: (input: AgentLogRetentionPolicyUpdateInput) => void;
}) {
  const t = copy[language];
  const [maxAgeDays, setMaxAgeDays] = useState(policy?.maxAgeDays ? String(policy.maxAgeDays) : '7');
  const [maxEventsPerAgent, setMaxEventsPerAgent] = useState(
    policy?.maxEventsPerAgent !== undefined ? String(policy.maxEventsPerAgent) : '5000'
  );
  const parsedMaxAgeDays = Number(maxAgeDays);
  const parsedMaxEventsPerAgent = Number(maxEventsPerAgent);
  const retentionInputValid =
    Number.isFinite(parsedMaxAgeDays)
    && parsedMaxAgeDays > 0
    && parsedMaxAgeDays <= 3650
    && Number.isFinite(parsedMaxEventsPerAgent)
    && Number.isInteger(parsedMaxEventsPerAgent)
    && parsedMaxEventsPerAgent >= 0
    && parsedMaxEventsPerAgent <= 1_000_000;

  useEffect(() => {
    if (!policy) {
      return;
    }

    setMaxAgeDays(String(policy.maxAgeDays));
    setMaxEventsPerAgent(String(policy.maxEventsPerAgent));
  }, [policy]);

  function handleRetentionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!onUpdatePolicy || !retentionInputValid) {
      return;
    }

    onUpdatePolicy({
      maxAgeDays: parsedMaxAgeDays,
      maxEventsPerAgent: parsedMaxEventsPerAgent,
      reason: t.agentLogRetentionSaveReason
    });
  }

  return (
    <GlassCard className="stagger-3 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-blue-500 dark:text-primary" />
          <h4 className="text-sm font-bold text-slate-800 dark:text-white">
            {t.agentLogsTitle} · {formatNumber(chunks.length, language)}
          </h4>
        </div>
        {onExport ? (
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-blue-300 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:border-primary/50 dark:hover:text-primary"
            disabled={exportBusy}
            type="button"
            onClick={onExport}
          >
            <Download className="h-3.5 w-3.5" />
            {t.agentLogExport}
          </button>
        ) : null}
        {policy ? (
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/45">
            <span>{t.agentLogRetentionTitle}</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600 dark:bg-white/10 dark:text-white/70">
              {t.agentLogRetentionAge(policy.maxAgeDays, language)}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600 dark:bg-white/10 dark:text-white/70">
              {t.agentLogRetentionLimit(policy.maxEventsPerAgent, language)}
            </span>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-600 dark:bg-primary/15 dark:text-primary">
              {t.agentLogRetentionSourceLabels[policy.source]}
            </span>
          </div>
        ) : null}
      </div>

      {policy && onUpdatePolicy ? (
        <form className="mb-4 flex flex-wrap items-end gap-3" onSubmit={handleRetentionSubmit}>
          <label className="grid gap-1 text-[11px] font-semibold text-slate-500 dark:text-white/45">
            {t.agentLogRetentionAgeLabel}
            <input
              className="w-28 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-800 outline-none transition focus:border-blue-400 dark:border-white/10 dark:bg-white/5 dark:text-white"
              disabled={busy}
              max="3650"
              min="0.01"
              step="0.01"
              type="number"
              value={maxAgeDays}
              onChange={(event) => setMaxAgeDays(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-[11px] font-semibold text-slate-500 dark:text-white/45">
            {t.agentLogRetentionLimitLabel}
            <input
              className="w-32 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-800 outline-none transition focus:border-blue-400 dark:border-white/10 dark:bg-white/5 dark:text-white"
              disabled={busy}
              min="0"
              max="1000000"
              step="1"
              type="number"
              value={maxEventsPerAgent}
              onChange={(event) => setMaxEventsPerAgent(event.target.value)}
            />
          </label>
          <button
            className="rounded-lg border border-blue-400/40 bg-blue-500 px-3 py-2 text-xs font-bold text-white shadow-[0_0_18px_rgba(59,130,246,0.25)] transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-primary/50 dark:bg-primary dark:text-slate-950"
            disabled={busy || !retentionInputValid}
            type="submit"
          >
            {t.agentLogRetentionSave}
          </button>
        </form>
      ) : null}

      <div className="space-y-3">
        {chunks.map((chunk) => (
          <article key={chunk.eventId} className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-white/10 dark:text-white/70">
                {t.streamLabels[chunk.stream]}
              </span>
              <span className="font-mono text-[11px] text-slate-500 dark:text-white/45">
                {formatDateTime(chunk.observedAt, language)}
              </span>
            </div>
            <p className="mt-2 break-all font-mono text-[11px] text-slate-500 dark:text-white/45">
              {t.agentLogDetail(chunk.agentId, chunk.taskId, chunk.commandId, chunk.chunkSeq, language)}
            </p>
            <pre className="mt-3 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">{chunk.content}</pre>
          </article>
        ))}
        {chunks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-white/10">
            <p className="text-sm font-bold text-slate-700 dark:text-white/70">{t.agentLogsEmpty}</p>
          </div>
        ) : null}
      </div>
    </GlassCard>
  );
}

export function TasksPage({
  tasks,
  agentLogChunks = [],
  agentLogRetentionPolicy,
  agentLogRetentionBusy = false,
  agentLogExportBusy = false,
  configRevisions,
  preflightPlans,
  runtimeSnapshots,
  language = 'zh',
  taskMutationBusy = false,
  onExportAgentLogs,
  onUpdateAgentLogRetentionPolicy,
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

      <AgentLogPanel
        busy={agentLogRetentionBusy}
        chunks={agentLogChunks}
        exportBusy={agentLogExportBusy}
        language={language}
        policy={agentLogRetentionPolicy}
        onExport={onExportAgentLogs}
        onUpdatePolicy={onUpdateAgentLogRetentionPolicy}
      />
    </div>
  );
}
