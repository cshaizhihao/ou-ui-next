import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Copy, Download, RotateCcw, Search, Terminal, Workflow } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { ConfigDrawer } from '../../components/ui/config-drawer';
import { GlassCard } from '../../components/ui/glass-card';
import { GlowButton } from '../../components/ui/glow-button';
import type { AgentLogArchive } from '../../domain';
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
  agentLogArchives?: AgentLogArchive[];
  agentLogRetentionPolicy?: AgentLogRetentionPolicyReadModel;
  agentLogRetentionBusy?: boolean;
  agentLogExportBusy?: boolean;
  agentLogArchiveExportBusy?: boolean;
  configRevisions: RuntimeConfigRevision[];
  preflightPlans: RuntimePreflightPlan[];
  runtimeSnapshots: RuntimeSnapshot[];
  language?: AppLanguage;
  taskMutationBusy?: boolean;
  onExportAgentLogs?: () => void;
  onExportAgentLogArchives?: () => void;
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

type TaskRemediationPlan = {
  failedStep?: DeployTask['steps'][number];
  nextStep: string;
  retryable?: boolean;
  rollbackTaskId?: string;
};

type TaskStatusFilter = 'all' | DeployTask['status'];
type TaskOperationFilter = 'all' | DeployTask['operation'];
type AgentLogStreamFilter = 'all' | AgentLogChunk['stream'];

const taskStatuses: DeployTask['status'][] = ['queued', 'running', 'succeeded', 'failed', 'retrying', 'rolled_back', 'canceled'];
const agentLogStreams: AgentLogChunk['stream'][] = ['stdout', 'stderr', 'agent', 'runtime'];

type ExecutionMetric = {
  label: string;
  value: number;
  detail?: string;
  language: AppLanguage;
};

const copy = {
  zh: {
    title: '执行记录',
    subtitle: '记录 Master 下发、Agent 回执、预检、快照和回滚状态，确保每一次高风险变更都有据可查。',
    operationalOverview: '运营总览',
    operationalOverviewHint: '先确认 Master 下发路径、Agent 执行证据、发布产物和回滚边界，再处理队列或失败任务。',
    releasePath: '发布路径',
    pathMaster: 'Master',
    pathAgent: 'Agent',
    pathEvidence: 'Evidence',
    pathRollback: 'Rollback',
    releaseEvidence: '发布证据',
    releaseEvidenceSummary: (
      configCount: number,
      preflightCount: number,
      snapshotCount: number,
      language: AppLanguage
    ) =>
      `配置 ${formatNumber(configCount, language)} / 预检 ${formatNumber(preflightCount, language)} / 快照 ${formatNumber(
        snapshotCount,
        language
      )}`,
    agentEvidence: 'Agent 证据',
    agentEvidenceSummary: (logCount: number, archiveCount: number, language: AppLanguage) =>
      `${formatNumber(logCount, language)} 日志 / ${formatNumber(archiveCount, language)} 归档`,
    latestExecution: '最新执行',
    executionOverview: '执行概览',
    totalExecutions: '总执行数',
    totalExecutionsDetail: '当前纳入流水线视图的全部执行记录。',
    activeExecutions: '进行中',
    activeExecutionsDetail: '正在排队、执行或重试中的任务。',
    needsAttention: '需要处理',
    needsAttentionDetail: '已失败或有失败证据的任务，优先处理。',
    rollbackReady: '可回滚',
    rollbackReadyDetail: '已完成且具备回滚入口的任务。',
    overviewHint: '控制执行队列、失败风险和回滚入口，优先处理影响面最大的任务。',
    pipelineTitle: '发布流水线',
    refresh: '刷新记录',
    searchTasks: '搜索任务',
    searchTasksPlaceholder: '任务、对象、操作、失败原因、请求或执行者',
    taskStatusFilter: '任务状态',
    taskStatusAll: '全部状态',
    taskOperationFilter: '操作',
    taskOperationAll: '全部操作',
    matchingTasks: '当前匹配',
    selectedTasks: '已选任务',
    selectedFailureTasks: '失败任务',
    selectVisibleTasks: '选择当前匹配任务',
    selectTask: (summary: string) => `选择任务 ${summary}`,
    bulkCopyTaskContexts: '批量复制任务上下文',
    bulkCopyRemediationPlans: '批量复制处置计划',
    copyFailureEvidencePackage: '复制失败证据包',
    noMatchingTasks: '没有匹配的执行记录',
    viewTaskDetails: '查看任务详情',
    taskDetailsTitle: '任务详情',
    copyTaskContext: '复制任务上下文',
    viewFailureEvidence: '查看失败证据',
    failureEvidenceTitle: '任务失败证据',
    failureReason: '失败原因',
    failedStep: '失败步骤',
    taskRemediationPlan: '任务处置计划',
    copyTaskRemediationPlan: '复制处置计划',
    nextStep: '下一步',
    retryable: '可重试',
    retryableYes: '是',
    retryableNo: '否',
    rollbackTask: '回滚任务',
    remediationPortConflict: '释放或更换冲突监听端口，预检通过后再创建新的应用任务。',
    remediationRollback: '打开回滚任务，确认运行时健康后，再在回滚成功之后重试源任务。',
    remediationNonRetryable: '先修复记录的失败原因；该任务被运行时标记为不可直接重试。',
    remediationDefault: '检查失败步骤和关联 Agent 日志，确认原因解除后再重试或创建替代任务。',
    taskContext: '任务上下文',
    metadata: '任务元数据',
    relatedAgentLogs: '关联 Agent 日志',
    relatedLogArchives: '关联日志归档',
    noMetadata: '未记录任务元数据',
    noRelatedLogs: '没有关联日志',
    retryTask: '重试 / 刷新任务',
    noFailureReason: '未记录失败原因',
    actor: '执行者',
    attempts: '尝试次数',
    rollback: '发起回滚',
    confirmRollback: (taskId: string) => `确认回滚任务 ${taskId}？`,
    runtimeRelease: '运行时发布',
    agentLogsTitle: '主机代理运行日志',
    agentLogsEmpty: '暂无运行日志',
    searchAgentLogs: '搜索 Agent 日志',
    searchAgentLogsPlaceholder: 'Agent、任务、命令、会话或日志内容',
    agentLogStreamFilter: '日志流',
    agentLogStreamAll: '全部日志流',
    matchingAgentLogs: '匹配日志',
    copyVisibleAgentLogs: '复制当前日志',
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
    confirmAgentLogRetentionSave: (days: number, count: number, language: AppLanguage) =>
      `确认保存 Agent 日志留存策略：保留 ${formatNumber(days, language)} 天、单机上限 ${formatNumber(count, language)} 条？`,
    agentLogExport: '导出日志',
    agentLogArchivesTitle: '日志归档',
    agentLogArchivesEmpty: '暂无日志归档',
    searchAgentLogArchives: '搜索日志归档',
    searchAgentLogArchivesPlaceholder: '归档、Agent、任务、命令、会话或校验值',
    agentLogArchiveStreamFilter: '归档日志流',
    agentLogArchiveStreamAll: '全部归档流',
    matchingAgentLogArchives: '匹配归档',
    copyVisibleAgentLogArchives: '复制当前归档',
    agentLogArchiveExport: '导出归档',
    agentLogArchiveDetail: (agentId: string, taskId: string, commandId: string) =>
      `${agentId} · 任务 ${taskId} · 命令 ${commandId}`,
    agentLogArchiveChunks: (count: number, language: AppLanguage) => `${formatNumber(count, language)} 个片段`,
    agentLogArchiveBytes: (bytes: number, language: AppLanguage) => `${formatNumber(bytes, language)} 字节`,
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
    operationalOverview: 'Operational Overview',
    operationalOverviewHint:
      'Confirm Master dispatch, Agent evidence, release artifacts, and rollback boundaries before acting on the queue or failure records.',
    releasePath: 'Release path',
    pathMaster: 'Master',
    pathAgent: 'Agent',
    pathEvidence: 'Evidence',
    pathRollback: 'Rollback',
    releaseEvidence: 'Release Evidence',
    releaseEvidenceSummary: (
      configCount: number,
      preflightCount: number,
      snapshotCount: number,
      language: AppLanguage
    ) =>
      `Config ${formatNumber(configCount, language)} / Preflight ${formatNumber(
        preflightCount,
        language
      )} / Snapshot ${formatNumber(snapshotCount, language)}`,
    agentEvidence: 'Agent Evidence',
    agentEvidenceSummary: (logCount: number, archiveCount: number, language: AppLanguage) =>
      `${formatNumber(logCount, language)} Logs / ${formatNumber(archiveCount, language)} Archives`,
    latestExecution: 'Latest Execution',
    executionOverview: 'Execution Overview',
    totalExecutions: 'Total executions',
    totalExecutionsDetail: 'All execution records currently in the pipeline view.',
    activeExecutions: 'Active executions',
    activeExecutionsDetail: 'Tasks that are queued, running, or retrying right now.',
    needsAttention: 'Needs attention',
    needsAttentionDetail: 'Failed tasks or records with failure evidence.',
    rollbackReady: 'Rollback ready',
    rollbackReadyDetail: 'Succeeded tasks that still have a rollback path.',
    overviewHint: 'Keep the queue, failure risk, and rollback entry points visible so operators can act fast.',
    pipelineTitle: 'Release Pipeline',
    refresh: 'Refresh Records',
    searchTasks: 'Search Tasks',
    searchTasksPlaceholder: 'Task, target, operation, failure reason, request, or actor',
    taskStatusFilter: 'Task Status',
    taskStatusAll: 'All Statuses',
    taskOperationFilter: 'Operation',
    taskOperationAll: 'All Operations',
    matchingTasks: 'Matching',
    selectedTasks: 'Selected Tasks',
    selectedFailureTasks: 'Failure Tasks',
    selectVisibleTasks: 'Select Visible Tasks',
    selectTask: (summary: string) => `Select Task ${summary}`,
    bulkCopyTaskContexts: 'Bulk Copy Task Contexts',
    bulkCopyRemediationPlans: 'Bulk Copy Remediation Plans',
    copyFailureEvidencePackage: 'Copy Failure Evidence Package',
    noMatchingTasks: 'No matching execution records',
    viewTaskDetails: 'View Task Details',
    taskDetailsTitle: 'Task Details',
    copyTaskContext: 'Copy Task Context',
    viewFailureEvidence: 'View Failure Evidence',
    failureEvidenceTitle: 'Task Failure Evidence',
    failureReason: 'Failure Reason',
    failedStep: 'Failed Step',
    taskRemediationPlan: 'Task Remediation Plan',
    copyTaskRemediationPlan: 'Copy Remediation Plan',
    nextStep: 'Next Step',
    retryable: 'Retryable',
    retryableYes: 'Yes',
    retryableNo: 'No',
    rollbackTask: 'Rollback Task',
    remediationPortConflict: 'Free or change the conflicting listen port, then create a fresh apply task after preflight passes.',
    remediationRollback: 'Open the rollback task, verify runtime health, then retry the source task only after rollback succeeds.',
    remediationNonRetryable: 'Fix the recorded failure cause before retrying; this task is marked non-retryable by runtime metadata.',
    remediationDefault: 'Inspect failed step evidence and related Agent logs, then retry or create a replacement task after the cause is resolved.',
    taskContext: 'Task Context',
    metadata: 'Task Metadata',
    relatedAgentLogs: 'Related Agent Logs',
    relatedLogArchives: 'Related Log Archives',
    noMetadata: 'No task metadata recorded',
    noRelatedLogs: 'No related logs',
    retryTask: 'Retry / Refresh Task',
    noFailureReason: 'No failure reason recorded',
    actor: 'Actor',
    attempts: 'Attempts',
    rollback: 'Start Rollback',
    confirmRollback: (taskId: string) => `Start rollback for ${taskId}?`,
    runtimeRelease: 'Runtime Release',
    agentLogsTitle: 'Agent Runtime Logs',
    agentLogsEmpty: 'No runtime logs retained',
    searchAgentLogs: 'Search Agent Logs',
    searchAgentLogsPlaceholder: 'Agent, task, command, session, or log content',
    agentLogStreamFilter: 'Log Stream',
    agentLogStreamAll: 'All Streams',
    matchingAgentLogs: 'Matching Logs',
    copyVisibleAgentLogs: 'Copy Visible Logs',
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
    confirmAgentLogRetentionSave: (days: number, count: number, language: AppLanguage) =>
      `Save Agent log retention policy: retain ${formatNumber(days, language)} days with ${formatNumber(count, language)} events per Agent?`,
    agentLogExport: 'Export Logs',
    agentLogArchivesTitle: 'Log Archives',
    agentLogArchivesEmpty: 'No log archives yet',
    searchAgentLogArchives: 'Search Log Archives',
    searchAgentLogArchivesPlaceholder: 'Archive, Agent, task, command, session, or checksum',
    agentLogArchiveStreamFilter: 'Archive Stream',
    agentLogArchiveStreamAll: 'All Archive Streams',
    matchingAgentLogArchives: 'Matching Archives',
    copyVisibleAgentLogArchives: 'Copy Visible Archives',
    agentLogArchiveExport: 'Export Archives',
    agentLogArchiveDetail: (agentId: string, taskId: string, commandId: string) =>
      `${agentId} · Task ${taskId} · Command ${commandId}`,
    agentLogArchiveChunks: (count: number, language: AppLanguage) => `${formatNumber(count, language)} chunks`,
    agentLogArchiveBytes: (bytes: number, language: AppLanguage) => `${formatNumber(bytes, language)} bytes`,
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

function normalizeTaskSearch(value: string) {
  return value.trim().toLocaleLowerCase();
}

function stringifyTaskMetadata(metadata: DeployTask['metadata']) {
  if (!metadata) {
    return '';
  }

  try {
    return JSON.stringify(metadata);
  } catch {
    return '';
  }
}

function stringifyJson(value: unknown) {
  if (value === undefined) {
    return '';
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function createTaskContextPayload({
  bundle,
  relatedArchives,
  relatedChunks
}: {
  bundle: RuntimeReleaseBundle;
  relatedArchives: AgentLogArchive[];
  relatedChunks: AgentLogChunk[];
}) {
  const { task, configRevision, preflightPlan, runtimeSnapshot } = bundle;

  return {
    taskId: task.id,
    requestId: task.requestId,
    operation: task.operation,
    resource: `${task.resourceType}:${task.resourceId}`,
    targetId: task.targetId,
    targetLabel: task.targetLabel,
    status: task.status,
    attempts: task.attempts,
    actor: task.actor,
    requestedBy: task.requestedBy,
    sourceIp: task.sourceIp,
    failureReason: task.failureReason,
    idempotencyKey: task.idempotencyKey,
    rollbackTaskId: task.rollbackTaskId,
    configRevisionId: configRevision?.id,
    preflightPlanId: preflightPlan?.id,
    runtimeSnapshotId: runtimeSnapshot?.id,
    metadata: task.metadata ?? {},
    relatedLogEventIds: relatedChunks.map((chunk) => chunk.eventId),
    relatedArchiveIds: relatedArchives.map((archive) => archive.id)
  };
}

function copyText(value: string) {
  void navigator.clipboard?.writeText(value);
}

function readTaskMetadataBoolean(task: DeployTask, key: string) {
  const value = task.metadata?.[key];

  return typeof value === 'boolean' ? value : undefined;
}

function isPortConflictFailureReason(failureReason: string | undefined) {
  return /(port_conflict|port conflict|listen port is not available|address already in use|port_bind|\bbind\b)/i.test(
    failureReason ?? ''
  );
}

function hasTaskFailureEvidence(task: DeployTask) {
  return task.status === 'failed' || Boolean(task.failureReason);
}

function createTaskRemediationPlan(
  task: DeployTask,
  labels: (typeof copy)[AppLanguage]
): TaskRemediationPlan {
  const failedStep = getFailedTaskSteps(task)[0];
  const retryable = readTaskMetadataBoolean(task, 'retryable');

  if (isPortConflictFailureReason(task.failureReason)) {
    return {
      failedStep,
      nextStep: labels.remediationPortConflict,
      retryable,
      rollbackTaskId: task.rollbackTaskId
    };
  }

  if (task.rollbackTaskId) {
    return {
      failedStep,
      nextStep: labels.remediationRollback,
      retryable,
      rollbackTaskId: task.rollbackTaskId
    };
  }

  if (retryable === false) {
    return {
      failedStep,
      nextStep: labels.remediationNonRetryable,
      retryable
    };
  }

  return {
    failedStep,
    nextStep: labels.remediationDefault,
    retryable,
    rollbackTaskId: task.rollbackTaskId
  };
}

function createTaskRemediationPlanText(task: DeployTask, plan: TaskRemediationPlan) {
  return [
    `Task: ${task.id}`,
    `Operation: ${task.operation}`,
    `Target: ${task.targetLabel}`,
    `Status: ${task.status}`,
    task.failureReason ? `Failure Reason: ${task.failureReason}` : undefined,
    plan.failedStep ? `Failed Step: ${plan.failedStep.id} · ${plan.failedStep.label}` : undefined,
    plan.retryable === undefined ? undefined : `Retryable: ${String(plan.retryable)}`,
    plan.rollbackTaskId ? `Rollback Task: ${plan.rollbackTaskId}` : undefined,
    `Next Step: ${plan.nextStep}`,
    `Request: ${task.requestId}`
  ]
    .filter(Boolean)
    .join('\n');
}

function copyTaskRemediationPlan(task: DeployTask, plan: TaskRemediationPlan) {
  copyText(createTaskRemediationPlanText(task, plan));
}

function copyTaskRemediationPlans(tasks: DeployTask[], labels: (typeof copy)[AppLanguage]) {
  copyText(
    tasks
      .map((task) => createTaskRemediationPlanText(task, createTaskRemediationPlan(task, labels)))
      .join('\n\n')
  );
}

function createTaskFailureEvidencePackage({
  bundle,
  labels,
  relatedArchives,
  relatedChunks
}: {
  bundle: RuntimeReleaseBundle;
  labels: (typeof copy)[AppLanguage];
  relatedArchives: AgentLogArchive[];
  relatedChunks: AgentLogChunk[];
}) {
  const { task, configRevision, preflightPlan, runtimeSnapshot } = bundle;
  const remediationPlan = createTaskRemediationPlan(task, labels);
  const failedSteps = getFailedTaskSteps(task);
  const failedChecks = preflightPlan?.checks.filter((check) => check.status === 'failed') ?? [];

  return {
    taskId: task.id,
    requestId: task.requestId,
    operation: task.operation,
    resource: `${task.resourceType}:${task.resourceId}`,
    targetId: task.targetId,
    targetLabel: task.targetLabel,
    status: task.status,
    attempts: task.attempts,
    actor: task.actor,
    requestedBy: task.requestedBy,
    sourceIp: task.sourceIp,
    failureReason: task.failureReason,
    metadata: task.metadata ?? {},
    failedSteps: failedSteps.map((step) => ({
      id: step.id,
      label: step.label,
      status: step.status
    })),
    remediationPlan: {
      nextStep: remediationPlan.nextStep,
      retryable: remediationPlan.retryable,
      rollbackTaskId: remediationPlan.rollbackTaskId,
      failedStepId: remediationPlan.failedStep?.id
    },
    runtimeArtifacts: {
      configRevision: configRevision
        ? {
            id: configRevision.id,
            status: configRevision.status,
            checksum: configRevision.checksum,
            signature: configRevision.signature,
            artifactUri: configRevision.artifactUri,
            failureReason: configRevision.failureReason
          }
        : undefined,
      preflightPlan: preflightPlan
        ? {
            id: preflightPlan.id,
            status: preflightPlan.status,
            failureReason: preflightPlan.failureReason,
            failedChecks: failedChecks.map((check) => ({
              id: check.id,
              label: check.label,
              status: check.status,
              severity: check.severity
            }))
          }
        : undefined,
      runtimeSnapshot: runtimeSnapshot
        ? {
            id: runtimeSnapshot.id,
            status: runtimeSnapshot.status,
            checksum: runtimeSnapshot.checksum,
            reason: runtimeSnapshot.reason,
            capturedAt: runtimeSnapshot.capturedAt,
            verifiedAt: runtimeSnapshot.verifiedAt
          }
        : undefined
    },
    relatedAgentLogs: createAgentLogContextPayload(relatedChunks),
    relatedLogArchives: createAgentLogArchiveContextPayload(relatedArchives)
  };
}

function copyTaskFailureEvidencePackage(
  bundle: RuntimeReleaseBundle,
  labels: (typeof copy)[AppLanguage],
  relatedArchives: AgentLogArchive[],
  relatedChunks: AgentLogChunk[]
) {
  copyText(
    stringifyJson(
      createTaskFailureEvidencePackage({
        bundle,
        labels,
        relatedArchives,
        relatedChunks
      })
    )
  );
}

function createTaskSearchText(task: DeployTask, labels: (typeof copy)[AppLanguage]) {
  return [
    task.id,
    task.operation,
    labels.operation[task.operation],
    task.resourceType,
    task.resourceId,
    task.status,
    labels.status[task.status],
    task.targetId,
    task.targetLabel,
    task.summary,
    task.actor,
    task.requestedBy,
    task.requestId,
    task.idempotencyKey,
    task.sourceIp,
    task.failureReason,
    task.rollbackTaskId,
    ...task.steps.flatMap((step) => [step.id, step.label, step.status]),
    stringifyTaskMetadata(task.metadata)
  ]
    .filter(Boolean)
    .join('\n')
    .toLocaleLowerCase();
}

function filterTasks(
  tasks: DeployTask[],
  query: string,
  statusFilter: TaskStatusFilter,
  operationFilter: TaskOperationFilter,
  labels: (typeof copy)[AppLanguage]
) {
  const normalizedQuery = normalizeTaskSearch(query);

  return tasks.filter((task) => {
    if (statusFilter !== 'all' && task.status !== statusFilter) {
      return false;
    }

    if (operationFilter !== 'all' && task.operation !== operationFilter) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return createTaskSearchText(task, labels).includes(normalizedQuery);
  });
}

function getFailedTaskSteps(task: DeployTask) {
  return task.steps.filter((step) => step.status === 'failed');
}

function createAgentLogSearchText(chunk: AgentLogChunk, labels: (typeof copy)[AppLanguage]) {
  return [
    chunk.eventId,
    chunk.agentId,
    chunk.sessionId,
    chunk.commandId,
    chunk.taskId,
    chunk.stream,
    labels.streamLabels[chunk.stream],
    chunk.content
  ]
    .filter(Boolean)
    .join('\n')
    .toLocaleLowerCase();
}

function filterAgentLogChunks(
  chunks: AgentLogChunk[],
  query: string,
  streamFilter: AgentLogStreamFilter,
  labels: (typeof copy)[AppLanguage]
) {
  const normalizedQuery = normalizeTaskSearch(query);

  return chunks.filter((chunk) => {
    if (streamFilter !== 'all' && chunk.stream !== streamFilter) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return createAgentLogSearchText(chunk, labels).includes(normalizedQuery);
  });
}

function createAgentLogContextPayload(chunks: AgentLogChunk[]) {
  return {
    logCount: chunks.length,
    logs: chunks.map((chunk) => ({
      eventId: chunk.eventId,
      agentId: chunk.agentId,
      sessionId: chunk.sessionId,
      sequence: chunk.seq,
      observedAt: chunk.observedAt,
      taskId: chunk.taskId,
      commandId: chunk.commandId,
      chunkSeq: chunk.chunkSeq,
      stream: chunk.stream,
      content: chunk.content
    }))
  };
}

function createAgentLogArchiveSearchText(archive: AgentLogArchive, labels: (typeof copy)[AppLanguage]) {
  return [
    archive.id,
    archive.agentId,
    archive.sessionIds.join('\n'),
    archive.taskId,
    archive.commandId,
    archive.stream,
    labels.streamLabels[archive.stream],
    archive.contentSha256,
    archive.source
  ]
    .filter(Boolean)
    .join('\n')
    .toLocaleLowerCase();
}

function filterAgentLogArchives(
  archives: AgentLogArchive[],
  query: string,
  streamFilter: AgentLogStreamFilter,
  labels: (typeof copy)[AppLanguage]
) {
  const normalizedQuery = normalizeTaskSearch(query);

  return archives.filter((archive) => {
    if (streamFilter !== 'all' && archive.stream !== streamFilter) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return createAgentLogArchiveSearchText(archive, labels).includes(normalizedQuery);
  });
}

function createAgentLogArchiveContextPayload(archives: AgentLogArchive[]) {
  return {
    archiveCount: archives.length,
    archives: archives.map((archive) => ({
      id: archive.id,
      agentId: archive.agentId,
      sessionIds: archive.sessionIds,
      taskId: archive.taskId,
      commandId: archive.commandId,
      stream: archive.stream,
      bucketStartAt: archive.bucketStartAt,
      bucketEndAt: archive.bucketEndAt,
      firstObservedAt: archive.firstObservedAt,
      lastObservedAt: archive.lastObservedAt,
      firstSeq: archive.firstSeq,
      lastSeq: archive.lastSeq,
      firstChunkSeq: archive.firstChunkSeq,
      lastChunkSeq: archive.lastChunkSeq,
      chunkCount: archive.chunkCount,
      contentBytes: archive.contentBytes,
      contentSha256: archive.contentSha256,
      archivedAt: archive.archivedAt,
      source: archive.source
    }))
  };
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

function MetricTile({
  label,
  value,
  detail,
  language
}: ExecutionMetric) {
  return (
    <article aria-label={label} className="ou-surface-muted rounded-2xl p-4" role="group">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-white/45">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
            {formatNumber(value, language)}
          </p>
        </div>
      </div>
      {detail ? <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-white/60">{detail}</p> : null}
    </article>
  );
}

function ReleasePath({ labels }: { labels: string[] }) {
  return (
    <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
      {labels.map((label, index) => (
        <li className="flex min-w-0 items-center gap-2" key={label}>
          <span
            aria-hidden="true"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-blue-200 bg-white text-[11px] font-black text-blue-600 dark:border-primary/25 dark:bg-primary/10 dark:text-primary"
          >
            {index + 1}
          </span>
          <span className="truncate text-xs font-black text-slate-800 dark:text-white/80">{label}</span>
        </li>
      ))}
    </ol>
  );
}

function EvidenceSummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <article aria-label={label} className="rounded-xl border border-slate-200 bg-white/55 p-4 dark:border-white/10 dark:bg-black/10">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <p className="mt-2 text-base font-black text-slate-900 dark:text-white">{value}</p>
    </article>
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

function TaskDetailsDrawer({
  bundle,
  language,
  open,
  relatedArchives,
  relatedChunks,
  onClose
}: {
  bundle?: RuntimeReleaseBundle;
  language: AppLanguage;
  open: boolean;
  relatedArchives: AgentLogArchive[];
  relatedChunks: AgentLogChunk[];
  onClose: () => void;
}) {
  const t = copy[language];
  const task = bundle?.task;
  const contextPayload = bundle
    ? createTaskContextPayload({ bundle, relatedArchives, relatedChunks })
    : undefined;

  return (
    <ConfigDrawer
      description={task ? `${t.operation[task.operation]} · ${task.targetLabel}` : undefined}
      open={open}
      title={t.taskDetailsTitle}
      onClose={onClose}
    >
      {bundle && task && contextPayload ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-white">{task.summary}</p>
                <p className="mt-1 font-mono text-[11px] text-slate-500 dark:text-white/45">
                  {formatDateTime(task.createdAt, language)}
                </p>
              </div>
              <StatusPill status={task.status} language={language} />
            </div>
            <div className="mt-4 grid gap-2 font-mono text-[11px] text-slate-500 dark:text-white/50">
              <p className="break-all">{task.id}</p>
              <p className="break-all">{task.requestId}</p>
              <p className="break-all">
                {task.resourceType}:{task.resourceId}
              </p>
              <p className="break-all">{task.targetId}</p>
              <p>
                {t.actor} {task.actor} · {t.attempts} {formatNumber(task.attempts, language)}
              </p>
            </div>
            <div className="mt-4 flex justify-end">
              <GlowButton className="px-4 py-2 text-xs" onClick={() => copyText(stringifyJson(contextPayload))}>
                <Copy className="h-3.5 w-3.5" />
                {t.copyTaskContext}
              </GlowButton>
            </div>
          </div>

          {task.steps.length > 0 ? (
            <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
              <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
                {t.failedStep}
              </p>
              <div className="mt-3 grid gap-2">
                {task.steps.map((step) => (
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/[0.04]"
                    key={step.id}
                  >
                    <span className="text-sm font-semibold text-slate-800 dark:text-white/80">{step.label}</span>
                    <StatusPill status={step.status} language={language} />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <RuntimeReleaseTimeline bundle={bundle} language={language} />

          <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.metadata}
            </p>
            {task.metadata ? (
              <pre className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
                {stringifyJson(task.metadata)}
              </pre>
            ) : (
              <p className="mt-3 text-xs font-semibold text-slate-500 dark:text-white/45">{t.noMetadata}</p>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.relatedAgentLogs}
            </p>
            <div className="mt-3 grid gap-2">
              {relatedChunks.map((chunk) => (
                <div key={chunk.eventId} className="rounded-lg bg-slate-50 p-3 dark:bg-white/[0.04]">
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
                  <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
                    {chunk.content}
                  </pre>
                </div>
              ))}
              {relatedChunks.length === 0 ? (
                <p className="text-xs font-semibold text-slate-500 dark:text-white/45">{t.noRelatedLogs}</p>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.relatedLogArchives}
            </p>
            <div className="mt-3 grid gap-2">
              {relatedArchives.map((archive) => (
                <div key={archive.id} className="rounded-lg bg-slate-50 p-3 dark:bg-white/[0.04]">
                  <p className="break-all font-mono text-[11px] font-semibold text-slate-700 dark:text-white/80">
                    {archive.id}
                  </p>
                  <p className="mt-2 break-all font-mono text-[11px] text-slate-500 dark:text-white/45">
                    {t.agentLogArchiveDetail(archive.agentId, archive.taskId, archive.commandId)}
                  </p>
                  <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] font-semibold text-slate-500 dark:text-white/50 md:grid-cols-3">
                    <span>{t.agentLogArchiveChunks(archive.chunkCount, language)}</span>
                    <span>{t.agentLogArchiveBytes(archive.contentBytes, language)}</span>
                    <span className="break-all font-mono">sha256:{archive.contentSha256.slice(0, 16)}</span>
                  </div>
                </div>
              ))}
              {relatedArchives.length === 0 ? (
                <p className="text-xs font-semibold text-slate-500 dark:text-white/45">{t.noRelatedLogs}</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </ConfigDrawer>
  );
}

function TaskFailureDrawer({
  bundle,
  language,
  open,
  relatedArchives,
  relatedChunks,
  onClose,
  onRetry
}: {
  bundle?: RuntimeReleaseBundle;
  language: AppLanguage;
  open: boolean;
  relatedArchives: AgentLogArchive[];
  relatedChunks: AgentLogChunk[];
  onClose: () => void;
  onRetry: () => void;
}) {
  const t = copy[language];
  const task = bundle?.task;
  const failedSteps = task ? getFailedTaskSteps(task) : [];
  const remediationPlan = task ? createTaskRemediationPlan(task, t) : undefined;

  return (
    <ConfigDrawer
      description={task ? `${t.operation[task.operation]} · ${task.targetLabel}` : undefined}
      open={open}
      title={t.failureEvidenceTitle}
      onClose={onClose}
    >
      {task ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-red-200 bg-red-50/70 p-4 dark:border-red-500/20 dark:bg-red-500/10">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-300" />
              <p className="text-xs font-black uppercase tracking-widest text-red-600 dark:text-red-300">
                {t.failureReason}
              </p>
            </div>
            <p className="mt-3 break-all text-sm font-semibold text-red-700 dark:text-red-100">
              {task.failureReason ?? t.noFailureReason}
            </p>
          </div>

          {remediationPlan ? (
            <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 dark:border-primary/25 dark:bg-primary/10">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-blue-600 dark:text-primary">
                    {t.taskRemediationPlan}
                  </p>
                  <p className="mt-2 break-words text-sm font-semibold leading-6 text-slate-800 dark:text-white/80">
                    {remediationPlan.nextStep}
                  </p>
                </div>
                <GlowButton
                  className="px-3 py-2 text-xs"
                  onClick={() => copyTaskRemediationPlan(task, remediationPlan)}
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t.copyTaskRemediationPlan}
                </GlowButton>
              </div>
              <div className="mt-4 grid gap-2 text-xs md:grid-cols-2">
                <div className="rounded-lg bg-white/70 p-3 dark:bg-white/[0.05]">
                  <p className="font-black uppercase tracking-widest text-slate-500 dark:text-white/40">{t.failedStep}</p>
                  <p className="mt-1 break-words font-semibold text-slate-800 dark:text-white/80">
                    {remediationPlan.failedStep ? remediationPlan.failedStep.label : t.noFailureReason}
                  </p>
                </div>
                <div className="rounded-lg bg-white/70 p-3 dark:bg-white/[0.05]">
                  <p className="font-black uppercase tracking-widest text-slate-500 dark:text-white/40">{t.retryable}</p>
                  <p className="mt-1 font-semibold text-slate-800 dark:text-white/80">
                    {remediationPlan.retryable === undefined
                      ? t.noMetadata
                      : remediationPlan.retryable
                        ? t.retryableYes
                        : t.retryableNo}
                  </p>
                </div>
                <div className="rounded-lg bg-white/70 p-3 dark:bg-white/[0.05]">
                  <p className="font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
                    {t.rollbackTask}
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] font-semibold text-slate-800 dark:text-white/80">
                    {remediationPlan.rollbackTaskId ?? t.noMetadata}
                  </p>
                </div>
                <div className="rounded-lg bg-white/70 p-3 dark:bg-white/[0.05]">
                  <p className="font-black uppercase tracking-widest text-slate-500 dark:text-white/40">{t.nextStep}</p>
                  <p className="mt-1 break-words font-semibold leading-5 text-slate-800 dark:text-white/80">
                    {remediationPlan.nextStep}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {bundle ? (
            <div className="flex flex-wrap justify-end gap-2">
              <GlowButton
                className="px-4 py-2 text-xs"
                onClick={() => copyTaskFailureEvidencePackage(bundle, t, relatedArchives, relatedChunks)}
              >
                <Copy className="h-3.5 w-3.5" />
                {t.copyFailureEvidencePackage}
              </GlowButton>
            </div>
          ) : null}

          <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.failedStep}
            </p>
            <div className="mt-3 grid gap-2">
              {(failedSteps.length > 0 ? failedSteps : task.steps).map((step) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/[0.04]"
                  key={step.id}
                >
                  <span className="text-sm font-semibold text-slate-800 dark:text-white/80">{step.label}</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-white/10 dark:text-white/70">
                    {t.status[step.status]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.taskContext}
            </p>
            <div className="mt-3 grid gap-2 font-mono text-[11px] text-slate-500 dark:text-white/50">
              <p className="break-all">task {task.id}</p>
              <p className="break-all">request {task.requestId}</p>
              <p className="break-all">
                {task.resourceType}:{task.resourceId}
              </p>
              <p className="break-all">target {task.targetId}</p>
              <p>
                {t.actor} {task.actor} · {t.attempts} {formatNumber(task.attempts, language)}
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <GlowButton className="px-4 py-2 text-xs" onClick={onRetry}>
              <RotateCcw className="h-3.5 w-3.5" />
              {t.retryTask}
            </GlowButton>
          </div>
        </div>
      ) : null}
    </ConfigDrawer>
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
  const [logSearch, setLogSearch] = useState('');
  const [logStreamFilter, setLogStreamFilter] = useState<AgentLogStreamFilter>('all');
  const [maxAgeDays, setMaxAgeDays] = useState(policy?.maxAgeDays ? String(policy.maxAgeDays) : '7');
  const [maxEventsPerAgent, setMaxEventsPerAgent] = useState(
    policy?.maxEventsPerAgent !== undefined ? String(policy.maxEventsPerAgent) : '5000'
  );
  const filteredChunks = useMemo(
    () => filterAgentLogChunks(chunks, logSearch, logStreamFilter, t),
    [chunks, logSearch, logStreamFilter, t]
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

    const confirmed =
      typeof window === 'undefined'
      || window.confirm(t.confirmAgentLogRetentionSave(parsedMaxAgeDays, parsedMaxEventsPerAgent, language));

    if (!confirmed) {
      return;
    }

    onUpdatePolicy({
      maxAgeDays: parsedMaxAgeDays,
      maxEventsPerAgent: parsedMaxEventsPerAgent,
      reason: t.agentLogRetentionSaveReason
    });
  }

  function copyVisibleAgentLogs() {
    if (filteredChunks.length === 0) {
      return;
    }

    copyText(stringifyJson(createAgentLogContextPayload(filteredChunks)));
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

      {chunks.length > 0 ? (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(16rem,1fr)_minmax(10rem,0.28fr)]">
            <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                {t.searchAgentLogs}
              </span>
              <div className="mt-1 flex min-h-7 items-center gap-2">
                <Search className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-white/35" />
                <input
                  aria-label={t.searchAgentLogs}
                  className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-white/35"
                  onChange={(event) => setLogSearch(event.target.value)}
                  placeholder={t.searchAgentLogsPlaceholder}
                  type="search"
                  value={logSearch}
                />
              </div>
            </label>
            <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                {t.agentLogStreamFilter}
              </span>
              <select
                aria-label={t.agentLogStreamFilter}
                className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
                onChange={(event) => setLogStreamFilter(event.target.value as AgentLogStreamFilter)}
                value={logStreamFilter}
              >
                <option value="all">{t.agentLogStreamAll}</option>
                {agentLogStreams.map((stream) => (
                  <option key={stream} value={stream}>
                    {t.streamLabels[stream]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.matchingAgentLogs} {filteredChunks.length} / {chunks.length}
            </p>
            <button
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:bg-white hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
              disabled={filteredChunks.length === 0}
              onClick={copyVisibleAgentLogs}
              type="button"
            >
              <Copy className="h-3.5 w-3.5" />
              {t.copyVisibleAgentLogs}
            </button>
          </div>
        </div>
      ) : null}

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
          <GlowButton
            className="px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy || !retentionInputValid}
            type="submit"
          >
            {t.agentLogRetentionSave}
          </GlowButton>
        </form>
      ) : null}

      <div className="space-y-3">
        {filteredChunks.map((chunk) => (
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
        {chunks.length > 0 && filteredChunks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-white/10">
            <p className="text-sm font-bold text-slate-700 dark:text-white/70">{t.agentLogsEmpty}</p>
          </div>
        ) : null}
      </div>
    </GlassCard>
  );
}

function AgentLogArchivePanel({
  archives,
  language,
  exportBusy = false,
  onExport
}: {
  archives: AgentLogArchive[];
  language: AppLanguage;
  exportBusy?: boolean;
  onExport?: () => void;
}) {
  const t = copy[language];
  const [archiveSearch, setArchiveSearch] = useState('');
  const [archiveStreamFilter, setArchiveStreamFilter] = useState<AgentLogStreamFilter>('all');
  const filteredArchives = useMemo(
    () => filterAgentLogArchives(archives, archiveSearch, archiveStreamFilter, t),
    [archiveSearch, archiveStreamFilter, archives, t]
  );

  function copyVisibleAgentLogArchives() {
    if (filteredArchives.length === 0) {
      return;
    }

    copyText(stringifyJson(createAgentLogArchiveContextPayload(filteredArchives)));
  }

  return (
    <GlassCard className="stagger-4 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-blue-500 dark:text-primary" />
          <h4 className="text-sm font-bold text-slate-800 dark:text-white">
            {t.agentLogArchivesTitle} · {formatNumber(archives.length, language)}
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
            {t.agentLogArchiveExport}
          </button>
        ) : null}
      </div>

      {archives.length > 0 ? (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(16rem,1fr)_minmax(10rem,0.28fr)]">
            <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                {t.searchAgentLogArchives}
              </span>
              <div className="mt-1 flex min-h-7 items-center gap-2">
                <Search className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-white/35" />
                <input
                  aria-label={t.searchAgentLogArchives}
                  className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-white/35"
                  onChange={(event) => setArchiveSearch(event.target.value)}
                  placeholder={t.searchAgentLogArchivesPlaceholder}
                  type="search"
                  value={archiveSearch}
                />
              </div>
            </label>
            <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                {t.agentLogArchiveStreamFilter}
              </span>
              <select
                aria-label={t.agentLogArchiveStreamFilter}
                className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
                onChange={(event) => setArchiveStreamFilter(event.target.value as AgentLogStreamFilter)}
                value={archiveStreamFilter}
              >
                <option value="all">{t.agentLogArchiveStreamAll}</option>
                {agentLogStreams.map((stream) => (
                  <option key={stream} value={stream}>
                    {t.streamLabels[stream]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.matchingAgentLogArchives} {filteredArchives.length} / {archives.length}
            </p>
            <button
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:bg-white hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
              disabled={filteredArchives.length === 0}
              onClick={copyVisibleAgentLogArchives}
              type="button"
            >
              <Copy className="h-3.5 w-3.5" />
              {t.copyVisibleAgentLogArchives}
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        {filteredArchives.map((archive) => (
          <article key={archive.id} className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
            <p className="mb-2 break-all font-mono text-[11px] font-semibold text-slate-700 dark:text-white/80">
              {archive.id}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-white/10 dark:text-white/70">
                {t.streamLabels[archive.stream]}
              </span>
              <span className="font-mono text-[11px] text-slate-500 dark:text-white/45">
                {formatDateTime(archive.firstObservedAt, language)} - {formatDateTime(archive.lastObservedAt, language)}
              </span>
            </div>
            <p className="mt-2 break-all font-mono text-[11px] text-slate-500 dark:text-white/45">
              {t.agentLogArchiveDetail(archive.agentId, archive.taskId, archive.commandId)}
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] font-semibold text-slate-500 dark:text-white/50 md:grid-cols-3">
              <span>{t.agentLogArchiveChunks(archive.chunkCount, language)}</span>
              <span>{t.agentLogArchiveBytes(archive.contentBytes, language)}</span>
              <span className="break-all font-mono">sha256:{archive.contentSha256.slice(0, 16)}</span>
            </div>
          </article>
        ))}
        {archives.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-white/10">
            <p className="text-sm font-bold text-slate-700 dark:text-white/70">{t.agentLogArchivesEmpty}</p>
          </div>
        ) : null}
        {archives.length > 0 && filteredArchives.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-white/10">
            <p className="text-sm font-bold text-slate-700 dark:text-white/70">{t.agentLogArchivesEmpty}</p>
          </div>
        ) : null}
      </div>
    </GlassCard>
  );
}

export function TasksPage({
  tasks,
  agentLogChunks = [],
  agentLogArchives = [],
  agentLogRetentionPolicy,
  agentLogRetentionBusy = false,
  agentLogExportBusy = false,
  agentLogArchiveExportBusy = false,
  configRevisions,
  preflightPlans,
  runtimeSnapshots,
  language = 'zh',
  taskMutationBusy = false,
  onExportAgentLogArchives,
  onExportAgentLogs,
  onUpdateAgentLogRetentionPolicy,
  onRollbackTask,
  onRefresh
}: TasksPageProps) {
  const t = copy[language];
  const [taskSearch, setTaskSearch] = useState('');
  const [taskStatusFilter, setTaskStatusFilter] = useState<TaskStatusFilter>('all');
  const [taskOperationFilter, setTaskOperationFilter] = useState<TaskOperationFilter>('all');
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [failureDrawerTaskId, setFailureDrawerTaskId] = useState<string | null>(null);
  const [detailsDrawerTaskId, setDetailsDrawerTaskId] = useState<string | null>(null);
  const taskOperationOptions = useMemo(() => [...new Set(tasks.map((item) => item.operation))].sort(), [tasks]);
  const filteredTasks = useMemo(
    () => filterTasks(tasks, taskSearch, taskStatusFilter, taskOperationFilter, t),
    [taskOperationFilter, taskSearch, taskStatusFilter, tasks, t]
  );
  const allReleaseBundles = useMemo(
    () => createReleaseBundles(tasks, configRevisions, preflightPlans, runtimeSnapshots),
    [configRevisions, preflightPlans, runtimeSnapshots, tasks]
  );
  const releaseBundles = useMemo(
    () => createReleaseBundles(filteredTasks, configRevisions, preflightPlans, runtimeSnapshots),
    [configRevisions, filteredTasks, preflightPlans, runtimeSnapshots]
  );
  const selectedBundles = useMemo(
    () => allReleaseBundles.filter((bundle) => selectedTaskIds.includes(bundle.task.id)),
    [allReleaseBundles, selectedTaskIds]
  );
  const selectedFailureTasks = useMemo(
    () => selectedBundles.map((bundle) => bundle.task).filter(hasTaskFailureEvidence),
    [selectedBundles]
  );
  const latestTask = useMemo(
    () =>
      [...tasks].sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt))[0],
    [tasks]
  );
  const releaseEvidenceSummary = t.releaseEvidenceSummary(
    configRevisions.length,
    preflightPlans.length,
    runtimeSnapshots.length,
    language
  );
  const agentEvidenceSummary = t.agentEvidenceSummary(agentLogChunks.length, agentLogArchives.length, language);
  const latestExecutionStatus = latestTask ? t.status[latestTask.status] : t.status.not_generated;
  const overviewMetrics = useMemo(
    () => [
      {
        label: t.totalExecutions,
        value: tasks.length,
        detail: t.totalExecutionsDetail,
        language
      },
      {
        label: t.activeExecutions,
        value: tasks.filter((item) => ['queued', 'running', 'retrying'].includes(item.status)).length,
        detail: t.activeExecutionsDetail,
        language
      },
      {
        label: t.needsAttention,
        value: tasks.filter((item) => hasTaskFailureEvidence(item)).length,
        detail: t.needsAttentionDetail,
        language
      },
      {
        label: t.rollbackReady,
        value: tasks.filter((item) => item.rollbackAvailable && item.status === 'succeeded').length,
        detail: t.rollbackReadyDetail,
        language
      }
    ],
    [
      language,
      t.activeExecutions,
      t.activeExecutionsDetail,
      t.needsAttention,
      t.needsAttentionDetail,
      t.rollbackReady,
      t.rollbackReadyDetail,
      t.totalExecutions,
      t.totalExecutionsDetail,
      tasks
    ]
  );
  const detailsDrawerBundle = useMemo(
    () => allReleaseBundles.find((bundle) => bundle.task.id === detailsDrawerTaskId),
    [allReleaseBundles, detailsDrawerTaskId]
  );
  const detailsDrawerAgentLogChunks = useMemo(
    () => agentLogChunks.filter((chunk) => chunk.taskId === detailsDrawerTaskId),
    [agentLogChunks, detailsDrawerTaskId]
  );
  const detailsDrawerAgentLogArchives = useMemo(
    () => agentLogArchives.filter((archive) => archive.taskId === detailsDrawerTaskId),
    [agentLogArchives, detailsDrawerTaskId]
  );
  const failureDrawerTask = useMemo(
    () => tasks.find((item) => item.id === failureDrawerTaskId),
    [failureDrawerTaskId, tasks]
  );
  const failureDrawerBundle = useMemo(
    () => allReleaseBundles.find((bundle) => bundle.task.id === failureDrawerTaskId),
    [allReleaseBundles, failureDrawerTaskId]
  );
  const failureDrawerAgentLogChunks = useMemo(
    () => agentLogChunks.filter((chunk) => chunk.taskId === failureDrawerTaskId),
    [agentLogChunks, failureDrawerTaskId]
  );
  const failureDrawerAgentLogArchives = useMemo(
    () => agentLogArchives.filter((archive) => archive.taskId === failureDrawerTaskId),
    [agentLogArchives, failureDrawerTaskId]
  );

  function toggleTaskSelection(taskId: string) {
    setSelectedTaskIds((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId]
    );
  }

  function toggleVisibleTaskSelection() {
    const visibleTaskIds = releaseBundles.map((bundle) => bundle.task.id);

    setSelectedTaskIds((current) => {
      const allVisibleSelected = visibleTaskIds.length > 0 && visibleTaskIds.every((id) => current.includes(id));

      if (allVisibleSelected) {
        return current.filter((id) => !visibleTaskIds.includes(id));
      }

      return [...new Set([...current, ...visibleTaskIds])];
    });
  }

  function copySelectedTaskContexts() {
    if (selectedBundles.length === 0) {
      return;
    }

    const contexts = selectedBundles.map((bundle) =>
      createTaskContextPayload({
        bundle,
        relatedArchives: agentLogArchives.filter((archive) => archive.taskId === bundle.task.id),
        relatedChunks: agentLogChunks.filter((chunk) => chunk.taskId === bundle.task.id)
      })
    );

    copyText(
      stringifyJson({
        taskCount: contexts.length,
        tasks: contexts
      })
    );
  }

  function copySelectedTaskRemediationPlans() {
    if (selectedFailureTasks.length === 0) {
      return;
    }

    copyTaskRemediationPlans(selectedFailureTasks, t);
  }

  function rollbackTask(task: DeployTask) {
    const confirmed = typeof window === 'undefined' || window.confirm(t.confirmRollback(task.id));

    if (!confirmed) {
      return;
    }

    onRollbackTask(task.id);
  }

  return (
    <div className="space-y-6">
      <section aria-label={t.operationalOverview} className="stagger-1 space-y-4" role="region">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-600 dark:text-primary">
            {t.operationalOverview}
          </p>
          <h3 className="mt-2 text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
          <p className="mt-1 max-w-2xl text-xs leading-6 text-slate-500 dark:text-white/50">{t.subtitle}</p>
        </div>

        <GlassCard className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2">
                <Workflow className="h-4 w-4 text-blue-500 dark:text-primary" />
                <p className="text-sm font-semibold text-slate-800 dark:text-white">{t.releasePath}</p>
              </div>
              <ReleasePath labels={[t.pathMaster, t.pathAgent, t.pathEvidence, t.pathRollback]} />
              <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-white/50">
                {t.operationalOverviewHint}
              </p>
            </div>
            <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-xs font-black text-orange-700 shadow-sm dark:border-orange-400/20 dark:bg-orange-400/10 dark:text-orange-200">
              {t.latestExecution}: {latestExecutionStatus}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
            <EvidenceSummaryTile label={t.releaseEvidence} value={releaseEvidenceSummary} />
            <EvidenceSummaryTile label={t.agentEvidence} value={agentEvidenceSummary} />
            <EvidenceSummaryTile label={t.latestExecution} value={latestExecutionStatus} />
          </div>
        </GlassCard>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-slate-800 dark:text-white">{t.executionOverview}</h4>
          </div>
          <p className="max-w-xl text-[11px] leading-5 text-slate-500 dark:text-white/45">{t.overviewHint}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {overviewMetrics.map((metric) => (
            <MetricTile key={metric.label} {...metric} />
          ))}
        </div>
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

        {tasks.length > 0 ? (
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(16rem,1fr)_minmax(10rem,0.28fr)_minmax(12rem,0.34fr)]">
              <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                  {t.searchTasks}
                </span>
                <div className="mt-1 flex min-h-7 items-center gap-2">
                  <Search className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-white/35" />
                  <input
                    aria-label={t.searchTasks}
                    className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-white/35"
                    onChange={(event) => setTaskSearch(event.target.value)}
                    placeholder={t.searchTasksPlaceholder}
                    type="search"
                    value={taskSearch}
                  />
                </div>
              </label>
              <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                  {t.taskStatusFilter}
                </span>
                <select
                  aria-label={t.taskStatusFilter}
                  className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
                  onChange={(event) => setTaskStatusFilter(event.target.value as TaskStatusFilter)}
                  value={taskStatusFilter}
                >
                  <option value="all">{t.taskStatusAll}</option>
                  {taskStatuses.map((status) => (
                    <option key={status} value={status}>
                      {t.status[status]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                  {t.taskOperationFilter}
                </span>
                <select
                  aria-label={t.taskOperationFilter}
                  className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
                  onChange={(event) => setTaskOperationFilter(event.target.value as TaskOperationFilter)}
                  value={taskOperationFilter}
                >
                  <option value="all">{t.taskOperationAll}</option>
                  {taskOperationOptions.map((operation) => (
                    <option key={operation} value={operation}>
                      {t.operation[operation]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                {t.matchingTasks} {filteredTasks.length} / {tasks.length}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-600 dark:bg-primary/15 dark:text-primary">
                  {t.selectedTasks} {formatNumber(selectedBundles.length, language)}
                </span>
                <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300">
                  {t.selectedFailureTasks} {formatNumber(selectedFailureTasks.length, language)}
                </span>
                <button
                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-white hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
                  disabled={releaseBundles.length === 0}
                  onClick={toggleVisibleTaskSelection}
                  type="button"
                >
                  {t.selectVisibleTasks}
                </button>
                <button
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:bg-white hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
                  disabled={selectedBundles.length === 0}
                  onClick={copySelectedTaskContexts}
                  type="button"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t.bulkCopyTaskContexts}
                </button>
                <button
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-red-200 px-3 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/25 dark:text-red-300 dark:hover:bg-red-500/10"
                  disabled={selectedFailureTasks.length === 0}
                  onClick={copySelectedTaskRemediationPlans}
                  type="button"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t.bulkCopyRemediationPlans}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="space-y-3">
          {releaseBundles.map((bundle) => (
            <div key={bundle.task.id} className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <input
                    aria-label={t.selectTask(bundle.task.summary)}
                    checked={selectedTaskIds.includes(bundle.task.id)}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600"
                    onChange={() => toggleTaskSelection(bundle.task.id)}
                    type="checkbox"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{bundle.task.summary}</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-slate-500 dark:text-white/45">
                      {t.operation[bundle.task.operation]} · {bundle.task.targetLabel} ·{' '}
                      {formatDateTime(bundle.task.createdAt, language)}
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-white/10 dark:text-white/70">
                  {t.status[bundle.task.status]}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-white/50">
                <span>
                  {t.actor} {bundle.task.actor} · {t.attempts} {formatNumber(bundle.task.attempts, language)}
                </span>
                <button
                  className="inline-flex items-center gap-1 text-blue-600 dark:text-primary"
                  data-task-action="details"
                  onClick={() => setDetailsDrawerTaskId(bundle.task.id)}
                  type="button"
                >
                  <Workflow className="h-3.5 w-3.5" />
                  {t.viewTaskDetails}
                </button>
                {bundle.task.rollbackAvailable && bundle.task.status === 'succeeded' ? (
                  <button
                    className="inline-flex items-center gap-1 text-blue-600 disabled:cursor-not-allowed disabled:opacity-60 dark:text-primary"
                    data-task-action="rollback"
                    disabled={taskMutationBusy}
                    onClick={() => rollbackTask(bundle.task)}
                    type="button"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t.rollback}
                  </button>
                ) : null}
                {hasTaskFailureEvidence(bundle.task) ? (
                  <button
                    className="inline-flex items-center gap-1 text-red-600 dark:text-red-300"
                    data-task-action="failure-evidence"
                    onClick={() => setFailureDrawerTaskId(bundle.task.id)}
                    type="button"
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {t.viewFailureEvidence}
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
          {tasks.length > 0 && releaseBundles.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-white/10">
              <p className="text-sm font-bold text-slate-700 dark:text-white/70">{t.noMatchingTasks}</p>
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

      <AgentLogArchivePanel
        archives={agentLogArchives}
        exportBusy={agentLogArchiveExportBusy}
        language={language}
        onExport={onExportAgentLogArchives}
      />

      <TaskDetailsDrawer
        bundle={detailsDrawerBundle}
        language={language}
        open={Boolean(detailsDrawerBundle)}
        relatedArchives={detailsDrawerAgentLogArchives}
        relatedChunks={detailsDrawerAgentLogChunks}
        onClose={() => setDetailsDrawerTaskId(null)}
      />

      <TaskFailureDrawer
        bundle={failureDrawerBundle}
        language={language}
        open={Boolean(failureDrawerTask)}
        relatedArchives={failureDrawerAgentLogArchives}
        relatedChunks={failureDrawerAgentLogChunks}
        onClose={() => setFailureDrawerTaskId(null)}
        onRetry={onRefresh}
      />
    </div>
  );
}
