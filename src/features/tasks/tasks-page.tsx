import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Copy, Download, RotateCcw, Search, Terminal, Workflow } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import {
  ResponsivePage,
  WorkspaceCockpit,
  WorkspaceCockpitScroller
} from '../../components/layout/responsive-page';
import { ConfigDrawer } from '../../components/ui/config-drawer';
import { GlassCard } from '../../components/ui/glass-card';
import { GlowButton } from '../../components/ui/glow-button';
import type {
  AgentLogArchive,
  ForwardingRuntimeDiagnosisAction,
  ForwardingRuntimeDiagnosisReason,
  ForwardingRuntimeDiagnosisState,
  XrayRuntimeDiagnosisAction,
  XrayRuntimeDiagnosisReason,
  XrayRuntimeDiagnosisState
} from '../../domain';
import type { RuntimeConfigRevision, RuntimePreflightPlan, RuntimeSnapshot } from '../../domain/runtime-release';
import type { DeployTask } from '../../domain/task';
import type {
  AgentLogChunk,
  AgentLogRetentionPolicyReadModel,
  AgentLogRetentionPolicyUpdateInput,
  CommandOutboxSummary
} from '../../services/api/control-plane-api';
import { copyText as copyToClipboard } from '../../lib/copy';
import { formatDateTime, formatNumber } from '../shared/format';

type TasksPageProps = {
  tasks: DeployTask[];
  agentLogChunks?: AgentLogChunk[];
  agentLogArchives?: AgentLogArchive[];
  agentLogRetentionPolicy?: AgentLogRetentionPolicyReadModel;
  agentLogRetentionBusy?: boolean;
  agentLogExportBusy?: boolean;
  agentLogArchiveExportBusy?: boolean;
  commandOutbox?: CommandOutboxSummary[];
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
  commandOutboxItems: CommandOutboxSummary[];
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
type ExecutionReleaseGateState = 'ready' | 'issues' | 'waiting';
type RuntimeVerificationState = 'verified' | 'failed' | 'waiting';
type RuntimeVerificationStepState = 'confirmed' | 'failed' | 'waiting';
type RuntimeVerificationStepId = 'command' | 'agentResult' | 'configRevision' | 'preflight' | 'snapshot';

type ExecutionReleaseGate = {
  label: string;
  detail: string;
  state: ExecutionReleaseGateState;
  value: string;
};

type RuntimeVerificationStep = {
  id: RuntimeVerificationStepId;
  state: RuntimeVerificationStepState;
  value?: string;
  detail?: string;
};

type RuntimeVerificationEvidence = {
  state: RuntimeVerificationState;
  description: string;
  steps: RuntimeVerificationStep[];
  rollbackTaskId?: string;
};

type ForwardingRuntimeDiagnosisEvidence = {
  state: ForwardingRuntimeDiagnosisState;
  reasons: ForwardingRuntimeDiagnosisReason[];
  blockedControls: string[];
  nextActions: ForwardingRuntimeDiagnosisAction[];
  hasRuntimeEvidence: boolean;
  impactedBindingCount: number;
  evidenceStage: string;
  plannedBindingStatus: string;
  plannedRuntimeServices: string[];
};

type XrayRuntimeDiagnosisEvidence = {
  state: XrayRuntimeDiagnosisState;
  reasons: XrayRuntimeDiagnosisReason[];
  nextActions: XrayRuntimeDiagnosisAction[];
  hasRuntimeEvidence: boolean;
  evidenceStage: string;
  plannedBindingStatus: string;
  plannedRuntimeServices: string[];
  plannedInbound: {
    agentId: string;
    listenAddress: string;
    listenPort: number;
    protocol: string;
    network: string;
    security: string;
    action: string;
  };
  clientCounters: {
    total: number;
    active: number;
    disabled: number;
    quotaExceeded: number;
    expired: number;
    runtimeDisabledByPolicy: number;
  };
};

type TuningProbeState = {
  bbrInstalled?: boolean;
  tcpProbeReady?: boolean;
  kernelVersion?: string;
};

type TuningPresetMetadata = {
  id?: string;
  name?: string;
  target?: string;
  riskLevel?: string;
};

type TuningSysctlPlanMetadata = {
  id?: string;
  name?: string;
  target?: string;
  riskLevel?: string;
  parameters?: Array<{ key: string; value: string }>;
};

const taskStatuses: DeployTask['status'][] = ['queued', 'running', 'succeeded', 'failed', 'retrying', 'rolled_back', 'canceled'];
const agentLogStreams: AgentLogChunk['stream'][] = ['stdout', 'stderr', 'agent', 'runtime'];
const forwardingRuntimeDiagnosisStates = new Set<ForwardingRuntimeDiagnosisState>([
  'ready',
  'waiting',
  'degraded',
  'blocked',
  'failed'
]);
const forwardingRuntimeDiagnosisReasons = new Set<ForwardingRuntimeDiagnosisReason>([
  'rule-disabled',
  'no-entry-binding',
  'no-runtime-service',
  'deploying',
  'paused',
  'releasing',
  'port-conflict',
  'runtime-apply-failed',
  'quota-exceeded',
  'runtime-disabled-by-policy',
  'guardrail',
  'blocked-runtime-controls',
  'missing-traffic-counters'
]);
const forwardingRuntimeDiagnosisActions = new Set<ForwardingRuntimeDiagnosisAction>([
  'apply',
  'resume',
  'pause',
  'repair',
  'inspect-agent',
  'resolve-conflict',
  'reset-quota',
  'enable-rule'
]);
const xrayRuntimeDiagnosisStates = new Set<XrayRuntimeDiagnosisState>([
  'ready',
  'waiting',
  'degraded',
  'blocked',
  'failed'
]);
const xrayRuntimeDiagnosisReasons = new Set<XrayRuntimeDiagnosisReason>([
  'deploying',
  'releasing',
  'no-active-client',
  'operator-disabled',
  'quota-exceeded',
  'client-expired',
  'runtime-disabled-by-policy',
  'guardrail',
  'multi-client',
  'tls',
  'reality',
  'fallback',
  'xray-config-preflight'
]);
const xrayRuntimeDiagnosisActions = new Set<XrayRuntimeDiagnosisAction>([
  'apply',
  'inspect-agent',
  'renew-client',
  'reset-quota',
  'enable-client',
  'review-security',
  'rollback',
  'remove-runtime'
]);
const commandFailureStatuses = new Set<CommandOutboxSummary['status']>(['failed', 'expired', 'dead_letter']);

type ExecutionMetric = {
  label: string;
  value: number;
  language: AppLanguage;
  tone?: 'signal';
};

const copy = {
  zh: {
    title: '执行记录',
    subtitle: '',
    operationalOverview: '运营总览',
    operationalOverviewHint: '',
    releasePath: '发布路径',
    pathMaster: 'Master',
    pathAgent: 'Agent',
    pathEvidence: 'Evidence',
    pathRollback: 'Rollback',
    executionReleaseGates: '执行发布门禁',
    executionReleaseGatesHint: '',
    executionQueueGate: '执行队列',
    executionQueueGateDetail: (activeCount: number, totalCount: number, language: AppLanguage) =>
      `${formatNumber(activeCount, language)} 进行中 / ${formatNumber(totalCount, language)} 总执行`,
    failureHandlingGate: '失败处置',
    failureHandlingGateDetail: (failureCount: number, language: AppLanguage) =>
      `${formatNumber(failureCount, language)} 个任务需要处置证据`,
    releaseArtifactsGate: '发布产物',
    releaseArtifactsGateDetail: (
      configCount: number,
      preflightCount: number,
      snapshotCount: number,
      language: AppLanguage
    ) =>
      `配置 ${formatNumber(configCount, language)} / 预检 ${formatNumber(preflightCount, language)} / 快照 ${formatNumber(
        snapshotCount,
        language
      )}`,
    rollbackBoundaryGate: '回滚边界',
    rollbackBoundaryGateDetail: (readyCount: number, taskCount: number, language: AppLanguage) =>
      `${formatNumber(readyCount, language)} 可回滚 / ${formatNumber(taskCount, language)} 总执行`,
    gateStateLabel: {
      ready: '就绪',
      issues: '异常',
      waiting: '等待'
    },
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
    activeExecutions: '进行中',
    needsAttention: '需要处理',
    rollbackReady: '可回滚',
    overviewHint: '',
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
    tuningTaskEvidence: '调优证据',
    tuningProbeState: '探测状态',
    tuningProbeBbr: 'BBR 探测',
    tuningProbeTcp: 'TCP 探测',
    tuningProbeKernelVersion: '内核版本',
    tuningProbeInstalled: '已安装',
    tuningProbeUnconfirmed: '未确认',
    tuningProbeReady: '已就绪',
    tuningProbeWaiting: '等待探测',
    tuningPresetEvidence: '预置信息',
    tuningPresetName: '预设名称',
    tuningPresetTarget: '目标',
    tuningPresetRiskLevel: '风险级别',
    tuningPresetId: '预设 ID',
    sysctlPlanEvidence: 'sysctl 执行计划',
    sysctlPlanName: '计划名称',
    sysctlPlanTarget: '计划目标',
    sysctlPlanRisk: '计划风险',
    sysctlPlanId: '计划 ID',
    sysctlPlanParameters: '参数',
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
    runtimeVerification: '运行验证',
    runtimeVerificationStateLabels: {
      verified: 'Agent 已验证',
      failed: '运行失败',
      waiting: '等待证据'
    },
    runtimeVerificationStateDescriptions: {
      verified: 'Agent result、配置、预检和快照已对齐。',
      failed: '证据链包含失败项，按失败证据或回滚任务处理。',
      waiting: 'Master 已有发布记录，但还缺 Agent result 或验证产物。'
    },
    runtimeVerificationStepLabels: {
      command: '命令',
      agentResult: 'Agent Result',
      configRevision: '配置',
      preflight: '预检',
      snapshot: '快照'
    },
    runtimeVerificationStepStateLabels: {
      confirmed: '已确认',
      failed: '失败',
      waiting: '等待'
    },
    runtimeVerificationCommandProgress: (completedCount: number, totalCount: number, language: AppLanguage) =>
      `${formatNumber(completedCount, language)}/${formatNumber(totalCount, language)} 已完成`,
    agentCommand: 'Agent 命令',
    agentCommandDetail: (commandType: string, agentId: string, commandId: string) =>
      `${commandType} · ${agentId} · ${commandId}`,
    agentCommandTiming: (ackedAt?: string, resultAt?: string, deadlineAt?: string) =>
      `ACK ${ackedAt ? formatDateTime(ackedAt) : '等待'} · Result ${
        resultAt ? formatDateTime(resultAt) : '等待'
      } · Deadline ${deadlineAt ? formatDateTime(deadlineAt) : '未记录'}`,
    forwardingRuntimeDiagnosis: '转发运行诊断',
    xrayRuntimeDiagnosis: 'Xray 运行诊断',
    runtimeDiagnosisEvidenceStage: '证据阶段',
    runtimeDiagnosisPlannedBinding: '计划绑定',
    xrayRuntimeDiagnosisPlannedInbound: '计划入站',
    runtimeDiagnosisPlannedServices: '计划服务',
    runtimeDiagnosisBlockedControls: '阻断控制',
    runtimeDiagnosisNextActions: '下一步',
    runtimeDiagnosisCounters: (bindingCount: number, hasRuntimeEvidence: boolean, language: AppLanguage) =>
      `${formatNumber(bindingCount, language)} 受影响绑定 / ${hasRuntimeEvidence ? '已有运行证据' : '等待 Agent 证据'}`,
    xrayRuntimeDiagnosisCounters: (
      activeCount: number,
      totalCount: number,
      disabledCount: number,
      hasRuntimeEvidence: boolean,
      language: AppLanguage
    ) =>
      `${formatNumber(activeCount, language)} 活跃 / ${formatNumber(totalCount, language)} 客户端 / ${formatNumber(
        disabledCount,
        language
      )} 已停用 / ${hasRuntimeEvidence ? '已有运行证据' : '等待 Agent 证据'}`,
    runtimeDiagnosisStateLabels: {
      ready: '就绪',
      waiting: '等待',
      degraded: '降级',
      blocked: '阻断',
      failed: '失败'
    },
    runtimeDiagnosisReasonLabels: {
      'rule-disabled': '规则未启用',
      'no-entry-binding': '缺少入口绑定',
      'no-runtime-service': '缺少运行时服务',
      deploying: '正在下发',
      paused: '已暂停',
      releasing: '正在释放',
      'port-conflict': '端口冲突',
      'runtime-apply-failed': '下发失败',
      'quota-exceeded': '配额已超限',
      'runtime-disabled-by-policy': '策略停用运行时',
      guardrail: '触发 guardrail',
      'blocked-runtime-controls': '包含阻断控制',
      'missing-traffic-counters': '缺少流量计数'
    },
    runtimeDiagnosisActionLabels: {
      apply: '下发',
      resume: '恢复',
      pause: '暂停',
      repair: '修复',
      'inspect-agent': '检查 Agent',
      'resolve-conflict': '处理冲突',
      'reset-quota': '重置配额',
      'enable-rule': '启用规则'
    },
    xrayRuntimeDiagnosisReasonLabels: {
      deploying: '正在下发',
      releasing: '正在释放',
      'no-active-client': '无活跃客户端',
      'operator-disabled': '操作员停用',
      'quota-exceeded': '配额已超限',
      'client-expired': '客户端已过期',
      'runtime-disabled-by-policy': '策略停用运行时',
      guardrail: '触发 guardrail',
      'multi-client': '共享入站',
      tls: 'TLS',
      reality: 'Reality',
      fallback: 'Fallback',
      'xray-config-preflight': 'Xray 配置预检'
    },
    xrayRuntimeDiagnosisActionLabels: {
      apply: '下发',
      'inspect-agent': '检查 Agent',
      'renew-client': '续期客户端',
      'reset-quota': '重置配额',
      'enable-client': '启用客户端',
      'review-security': '检查 TLS/Reality',
      rollback: '回滚',
      'remove-runtime': '移除运行时'
    },
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
    preflightChecks: '预检检查',
    noPreflightChecks: '未记录预检检查',
    snapshot: '快照',
    pendingArtifact: '等待产物生成',
    emptyTitle: '暂无执行记录',
    emptyDescription: '',
    checksUnit: '项检查',
    diffSummary: (added: number, changed: number, removed: number, language: AppLanguage) =>
      `变更 +${formatNumber(added, language)} / ~${formatNumber(changed, language)} / -${formatNumber(removed, language)}`,
    preflightDetail: (checks: number, agentId: string, language: AppLanguage) =>
      `${formatNumber(checks, language)} ${copy.zh.checksUnit} · ${agentId}`,
    preflightSeverity: {
      info: '信息',
      warning: '警告',
      critical: '关键'
    },
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
      dispatched: '已派发',
      acknowledged: '已确认',
      completed: '已完成',
      dead_letter: '死信',
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
    subtitle: '',
    operationalOverview: 'Operational Overview',
    operationalOverviewHint: '',
    releasePath: 'Release path',
    pathMaster: 'Master',
    pathAgent: 'Agent',
    pathEvidence: 'Evidence',
    pathRollback: 'Rollback',
    executionReleaseGates: 'Execution Release Gates',
    executionReleaseGatesHint: '',
    executionQueueGate: 'Execution Queue',
    executionQueueGateDetail: (activeCount: number, totalCount: number, language: AppLanguage) =>
      `${formatNumber(activeCount, language)} active / ${formatNumber(totalCount, language)} total`,
    failureHandlingGate: 'Failure Handling',
    failureHandlingGateDetail: (failureCount: number, language: AppLanguage) =>
      `${formatNumber(failureCount, language)} tasks need evidence handling`,
    releaseArtifactsGate: 'Release Artifacts',
    releaseArtifactsGateDetail: (
      configCount: number,
      preflightCount: number,
      snapshotCount: number,
      language: AppLanguage
    ) =>
      `Config ${formatNumber(configCount, language)} / Preflight ${formatNumber(
        preflightCount,
        language
      )} / Snapshot ${formatNumber(snapshotCount, language)}`,
    rollbackBoundaryGate: 'Rollback Boundary',
    rollbackBoundaryGateDetail: (readyCount: number, taskCount: number, language: AppLanguage) =>
      `${formatNumber(readyCount, language)} rollback ready / ${formatNumber(taskCount, language)} total`,
    gateStateLabel: {
      ready: 'Ready',
      issues: 'Issues',
      waiting: 'Waiting'
    },
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
    activeExecutions: 'Active executions',
    needsAttention: 'Needs attention',
    rollbackReady: 'Rollback ready',
    overviewHint: '',
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
    tuningTaskEvidence: 'Tuning Evidence',
    tuningProbeState: 'Probe State',
    tuningProbeBbr: 'BBR Probe',
    tuningProbeTcp: 'TCP Probe',
    tuningProbeKernelVersion: 'Kernel Version',
    tuningProbeInstalled: 'Installed',
    tuningProbeUnconfirmed: 'Unconfirmed',
    tuningProbeReady: 'Ready',
    tuningProbeWaiting: 'Waiting',
    tuningPresetEvidence: 'Preset Details',
    tuningPresetName: 'Preset Name',
    tuningPresetTarget: 'Target',
    tuningPresetRiskLevel: 'Risk Level',
    tuningPresetId: 'Preset ID',
    sysctlPlanEvidence: 'Sysctl Plan',
    sysctlPlanName: 'Plan Name',
    sysctlPlanTarget: 'Target',
    sysctlPlanRisk: 'Risk Level',
    sysctlPlanId: 'Plan ID',
    sysctlPlanParameters: 'Parameters',
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
    runtimeVerification: 'Runtime Verification',
    runtimeVerificationStateLabels: {
      verified: 'Agent Verified',
      failed: 'Agent Failed',
      waiting: 'Awaiting Evidence'
    },
    runtimeVerificationStateDescriptions: {
      verified: 'Agent result, config, preflight, and snapshot are aligned.',
      failed: 'The evidence chain contains a failed stage; use the failure package or rollback task.',
      waiting: 'Master has release records, but Agent result or verification artifacts are still missing.'
    },
    runtimeVerificationStepLabels: {
      command: 'Command',
      agentResult: 'Agent Result',
      configRevision: 'Config',
      preflight: 'Preflight',
      snapshot: 'Snapshot'
    },
    runtimeVerificationStepStateLabels: {
      confirmed: 'Confirmed',
      failed: 'Failed',
      waiting: 'Waiting'
    },
    runtimeVerificationCommandProgress: (completedCount: number, totalCount: number, language: AppLanguage) =>
      `${formatNumber(completedCount, language)}/${formatNumber(totalCount, language)} Completed`,
    agentCommand: 'Agent Command',
    agentCommandDetail: (commandType: string, agentId: string, commandId: string) =>
      `${commandType} · ${agentId} · ${commandId}`,
    agentCommandTiming: (ackedAt?: string, resultAt?: string, deadlineAt?: string) =>
      `ACK ${ackedAt ? formatDateTime(ackedAt) : 'Waiting'} · Result ${
        resultAt ? formatDateTime(resultAt) : 'Waiting'
      } · Deadline ${deadlineAt ? formatDateTime(deadlineAt) : 'Not recorded'}`,
    forwardingRuntimeDiagnosis: 'Forwarding Runtime Diagnosis',
    xrayRuntimeDiagnosis: 'Xray Runtime Diagnosis',
    runtimeDiagnosisEvidenceStage: 'Evidence Stage',
    runtimeDiagnosisPlannedBinding: 'Planned Binding',
    xrayRuntimeDiagnosisPlannedInbound: 'Planned Inbound',
    runtimeDiagnosisPlannedServices: 'Planned Services',
    runtimeDiagnosisBlockedControls: 'Blocked Controls',
    runtimeDiagnosisNextActions: 'Next Actions',
    runtimeDiagnosisCounters: (bindingCount: number, hasRuntimeEvidence: boolean, language: AppLanguage) =>
      `${formatNumber(bindingCount, language)} impacted bindings / ${hasRuntimeEvidence ? 'runtime evidence present' : 'waiting for Agent evidence'}`,
    xrayRuntimeDiagnosisCounters: (
      activeCount: number,
      totalCount: number,
      disabledCount: number,
      hasRuntimeEvidence: boolean,
      language: AppLanguage
    ) =>
      `${formatNumber(activeCount, language)} active / ${formatNumber(totalCount, language)} clients / ${formatNumber(
        disabledCount,
        language
      )} disabled / ${hasRuntimeEvidence ? 'runtime evidence present' : 'waiting for Agent evidence'}`,
    runtimeDiagnosisStateLabels: {
      ready: 'Ready',
      waiting: 'Waiting',
      degraded: 'Degraded',
      blocked: 'Blocked',
      failed: 'Failed'
    },
    runtimeDiagnosisReasonLabels: {
      'rule-disabled': 'Rule disabled',
      'no-entry-binding': 'No entry binding',
      'no-runtime-service': 'No runtime service',
      deploying: 'Deploying',
      paused: 'Paused',
      releasing: 'Releasing',
      'port-conflict': 'Port conflict',
      'runtime-apply-failed': 'Apply failed',
      'quota-exceeded': 'Quota exceeded',
      'runtime-disabled-by-policy': 'Runtime stopped by policy',
      guardrail: 'Guardrail active',
      'blocked-runtime-controls': 'Blocked controls present',
      'missing-traffic-counters': 'Missing traffic counters'
    },
    runtimeDiagnosisActionLabels: {
      apply: 'Apply',
      resume: 'Resume',
      pause: 'Pause',
      repair: 'Repair',
      'inspect-agent': 'Inspect Agent',
      'resolve-conflict': 'Resolve conflict',
      'reset-quota': 'Reset quota',
      'enable-rule': 'Enable rule'
    },
    xrayRuntimeDiagnosisReasonLabels: {
      deploying: 'Deploying',
      releasing: 'Releasing',
      'no-active-client': 'No active client',
      'operator-disabled': 'Operator disabled',
      'quota-exceeded': 'Quota exceeded',
      'client-expired': 'Client expired',
      'runtime-disabled-by-policy': 'Runtime stopped by policy',
      guardrail: 'Guardrail active',
      'multi-client': 'Shared inbound',
      tls: 'TLS',
      reality: 'Reality',
      fallback: 'Fallback',
      'xray-config-preflight': 'Xray config preflight'
    },
    xrayRuntimeDiagnosisActionLabels: {
      apply: 'Apply',
      'inspect-agent': 'Inspect Agent',
      'renew-client': 'Renew client',
      'reset-quota': 'Reset quota',
      'enable-client': 'Enable client',
      'review-security': 'Review TLS/Reality',
      rollback: 'Rollback',
      'remove-runtime': 'Remove runtime'
    },
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
    preflightChecks: 'Preflight Checks',
    noPreflightChecks: 'No preflight checks recorded',
    snapshot: 'Snapshot',
    pendingArtifact: 'Pending Artifact',
    emptyTitle: 'No execution records',
    emptyDescription: '',
    checksUnit: 'checks',
    diffSummary: (added: number, changed: number, removed: number, language: AppLanguage) =>
      `Diff +${formatNumber(added, language)} / ~${formatNumber(changed, language)} / -${formatNumber(removed, language)}`,
    preflightDetail: (checks: number, agentId: string, language: AppLanguage) =>
      `${formatNumber(checks, language)} ${copy.en.checksUnit} · ${agentId}`,
    preflightSeverity: {
      info: 'Info',
      warning: 'Warning',
      critical: 'Critical'
    },
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
      dispatched: 'Dispatched',
      acknowledged: 'Acknowledged',
      completed: 'Completed',
      dead_letter: 'Dead Letter',
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim());
}

function readFiniteNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function hasRuntimeReleaseEvidence(bundle: RuntimeReleaseBundle) {
  return (
    bundle.configRevision?.status === 'applied' ||
    bundle.commandOutboxItems.some((item) => item.status === 'completed') ||
    (bundle.preflightPlan?.status === 'passed' && bundle.runtimeSnapshot?.status === 'verified')
  );
}

function readForwardingRuntimeDiagnosis(bundle: RuntimeReleaseBundle): ForwardingRuntimeDiagnosisEvidence | undefined {
  if (bundle.configRevision?.moduleKind !== 'port-forwarding') {
    return undefined;
  }

  const value = bundle.configRevision.artifact.runtimeDiagnosis;

  if (!isObjectRecord(value) || !forwardingRuntimeDiagnosisStates.has(value.state as ForwardingRuntimeDiagnosisState)) {
    return undefined;
  }

  const reasons = readStringList(value.reasons).filter((reason): reason is ForwardingRuntimeDiagnosisReason =>
    forwardingRuntimeDiagnosisReasons.has(reason as ForwardingRuntimeDiagnosisReason)
  );
  const nextActions = readStringList(value.nextActions).filter((action): action is ForwardingRuntimeDiagnosisAction =>
    forwardingRuntimeDiagnosisActions.has(action as ForwardingRuntimeDiagnosisAction)
  );
  const impactedBindingCount =
    typeof value.impactedBindingCount === 'number' && Number.isFinite(value.impactedBindingCount)
      ? Math.max(0, Math.round(value.impactedBindingCount))
      : 0;

  return {
    state: value.state as ForwardingRuntimeDiagnosisState,
    reasons,
    blockedControls: readStringList(value.blockedControls),
    nextActions,
    hasRuntimeEvidence: value.hasRuntimeEvidence === true || hasRuntimeReleaseEvidence(bundle),
    impactedBindingCount,
    evidenceStage: typeof value.evidenceStage === 'string' && value.evidenceStage.trim() ? value.evidenceStage.trim() : 'unknown',
    plannedBindingStatus:
      typeof value.plannedBindingStatus === 'string' && value.plannedBindingStatus.trim()
        ? value.plannedBindingStatus.trim()
        : 'unknown',
    plannedRuntimeServices: readStringList(value.plannedRuntimeServices)
  };
}

function readXrayRuntimeDiagnosis(bundle: RuntimeReleaseBundle): XrayRuntimeDiagnosisEvidence | undefined {
  if (bundle.configRevision?.moduleKind !== 'xray') {
    return undefined;
  }

  const value = bundle.configRevision.artifact.runtimeDiagnosis;

  if (!isObjectRecord(value) || !xrayRuntimeDiagnosisStates.has(value.state as XrayRuntimeDiagnosisState)) {
    return undefined;
  }

  const plannedInbound = isObjectRecord(value.plannedInbound) ? value.plannedInbound : {};
  const clientCounters = isObjectRecord(value.clientCounters) ? value.clientCounters : {};
  const reasons = readStringList(value.reasons).filter((reason): reason is XrayRuntimeDiagnosisReason =>
    xrayRuntimeDiagnosisReasons.has(reason as XrayRuntimeDiagnosisReason)
  );
  const nextActions = readStringList(value.nextActions).filter((action): action is XrayRuntimeDiagnosisAction =>
    xrayRuntimeDiagnosisActions.has(action as XrayRuntimeDiagnosisAction)
  );

  return {
    state: value.state as XrayRuntimeDiagnosisState,
    reasons,
    nextActions,
    hasRuntimeEvidence: value.hasRuntimeEvidence === true || hasRuntimeReleaseEvidence(bundle),
    evidenceStage: typeof value.evidenceStage === 'string' && value.evidenceStage.trim() ? value.evidenceStage.trim() : 'unknown',
    plannedBindingStatus:
      typeof value.plannedBindingStatus === 'string' && value.plannedBindingStatus.trim()
        ? value.plannedBindingStatus.trim()
        : 'unknown',
    plannedRuntimeServices: readStringList(value.plannedRuntimeServices),
    plannedInbound: {
      agentId: typeof plannedInbound.agentId === 'string' ? plannedInbound.agentId : '',
      listenAddress: typeof plannedInbound.listenAddress === 'string' ? plannedInbound.listenAddress : '',
      listenPort: readFiniteNumber(plannedInbound.listenPort),
      protocol: typeof plannedInbound.protocol === 'string' ? plannedInbound.protocol : '',
      network: typeof plannedInbound.network === 'string' ? plannedInbound.network : '',
      security: typeof plannedInbound.security === 'string' ? plannedInbound.security : '',
      action: typeof plannedInbound.action === 'string' ? plannedInbound.action : ''
    },
    clientCounters: {
      total: readFiniteNumber(clientCounters.total),
      active: readFiniteNumber(clientCounters.active),
      disabled: readFiniteNumber(clientCounters.disabled),
      quotaExceeded: readFiniteNumber(clientCounters.quotaExceeded),
      expired: readFiniteNumber(clientCounters.expired),
      runtimeDisabledByPolicy: readFiniteNumber(clientCounters.runtimeDisabledByPolicy)
    }
  };
}

function createRuntimeVerificationEvidence(
  bundle: RuntimeReleaseBundle,
  language: AppLanguage,
  t: (typeof copy)[AppLanguage]
): RuntimeVerificationEvidence {
  const runtimeDiagnosis = readForwardingRuntimeDiagnosis(bundle) ?? readXrayRuntimeDiagnosis(bundle);
  const commandCount = bundle.commandOutboxItems.length;
  const completedCommandCount = bundle.commandOutboxItems.filter((item) => item.status === 'completed').length;
  const failedCommand = bundle.commandOutboxItems.find((item) => commandFailureStatuses.has(item.status));
  const firstCommand = bundle.commandOutboxItems[0];
  const commandStep: RuntimeVerificationStep = {
    id: 'command',
    state: failedCommand ? 'failed' : commandCount > 0 && completedCommandCount === commandCount ? 'confirmed' : 'waiting',
    value:
      commandCount > 0
        ? t.runtimeVerificationCommandProgress(completedCommandCount, commandCount, language)
        : t.pendingArtifact,
    detail: failedCommand
      ? failedCommand.lastError ?? failedCommand.commandId
      : firstCommand
        ? t.agentCommandDetail(firstCommand.commandType, firstCommand.agentId, firstCommand.commandId)
        : undefined
  };
  const agentResultStep: RuntimeVerificationStep = {
    id: 'agentResult',
    state:
      runtimeDiagnosis?.evidenceStage === 'agent-result-failed'
        ? 'failed'
        : runtimeDiagnosis?.evidenceStage === 'agent-result-verified'
          ? 'confirmed'
          : 'waiting',
    value: runtimeDiagnosis?.evidenceStage ?? t.pendingArtifact,
    detail: runtimeDiagnosis?.plannedBindingStatus
  };
  const configRevisionStep: RuntimeVerificationStep = {
    id: 'configRevision',
    state:
      bundle.configRevision?.status === 'failed' || bundle.configRevision?.status === 'rolled_back'
        ? 'failed'
        : bundle.configRevision?.status === 'applied'
          ? 'confirmed'
          : 'waiting',
    value: bundle.configRevision?.id ?? t.pendingArtifact,
    detail: bundle.configRevision?.status
  };
  const preflightStep: RuntimeVerificationStep = {
    id: 'preflight',
    state:
      bundle.preflightPlan?.status === 'failed'
        ? 'failed'
        : bundle.preflightPlan?.status === 'passed'
          ? 'confirmed'
          : 'waiting',
    value: bundle.preflightPlan?.id ?? t.pendingArtifact,
    detail: bundle.preflightPlan?.status
  };
  const snapshotStep: RuntimeVerificationStep = {
    id: 'snapshot',
    state:
      bundle.runtimeSnapshot?.status === 'expired'
        ? 'failed'
        : bundle.runtimeSnapshot?.status === 'verified' || bundle.runtimeSnapshot?.status === 'restored'
          ? 'confirmed'
          : 'waiting',
    value: bundle.runtimeSnapshot?.id ?? t.pendingArtifact,
    detail: bundle.runtimeSnapshot?.status
  };
  const steps = [commandStep, agentResultStep, configRevisionStep, preflightStep, snapshotStep];
  const state = steps.some((step) => step.state === 'failed')
    ? 'failed'
    : steps.every((step) => step.state === 'confirmed')
      ? 'verified'
      : 'waiting';

  return {
    state,
    description: t.runtimeVerificationStateDescriptions[state],
    steps,
    rollbackTaskId: bundle.task.rollbackTaskId
  };
}

function readTuningProbeState(metadata: DeployTask['metadata']) {
  const probeState = metadata?.probeState;

  if (!isObjectRecord(probeState)) {
    return undefined;
  }

  return {
    bbrInstalled: typeof probeState.bbrInstalled === 'boolean' ? probeState.bbrInstalled : undefined,
    tcpProbeReady: typeof probeState.tcpProbeReady === 'boolean' ? probeState.tcpProbeReady : undefined,
    kernelVersion: typeof probeState.kernelVersion === 'string' ? probeState.kernelVersion : undefined
  } satisfies TuningProbeState;
}

function readTuningPresetMetadata(metadata: DeployTask['metadata']) {
  const tuningPreset = metadata?.tuningPreset;

  if (!isObjectRecord(tuningPreset)) {
    return undefined;
  }

  return {
    id: typeof tuningPreset.id === 'string' ? tuningPreset.id : undefined,
    name: typeof tuningPreset.name === 'string' ? tuningPreset.name : undefined,
    target: typeof tuningPreset.target === 'string' ? tuningPreset.target : undefined,
    riskLevel: typeof tuningPreset.riskLevel === 'string' ? tuningPreset.riskLevel : undefined
  } satisfies TuningPresetMetadata;
}

function readTuningSysctlPlanMetadata(metadata: DeployTask['metadata']) {
  const sysctlPlan = metadata?.sysctlPlan;

  if (!isObjectRecord(sysctlPlan)) {
    return undefined;
  }

  return {
    id: typeof sysctlPlan.id === 'string' ? sysctlPlan.id : undefined,
    name: typeof sysctlPlan.name === 'string' ? sysctlPlan.name : undefined,
    target: typeof sysctlPlan.target === 'string' ? sysctlPlan.target : undefined,
    riskLevel: typeof sysctlPlan.riskLevel === 'string' ? sysctlPlan.riskLevel : undefined,
    parameters: Array.isArray(sysctlPlan.parameters)
      ? sysctlPlan.parameters
          .filter((parameter): parameter is { key: string; value: string } => {
            return (
              isObjectRecord(parameter) &&
              typeof parameter.key === 'string' &&
              typeof parameter.value === 'string'
            );
          })
      : undefined
  } satisfies TuningSysctlPlanMetadata;
}

function isSystemTuneTask(task: DeployTask) {
  return task.operation === 'system.tune';
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
  const runtimeDiagnosis = readForwardingRuntimeDiagnosis(bundle) ?? readXrayRuntimeDiagnosis(bundle);

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
    runtimeDiagnosis,
    metadata: task.metadata ?? {},
    relatedLogEventIds: relatedChunks.map((chunk) => chunk.eventId),
    relatedArchiveIds: relatedArchives.map((archive) => archive.id)
  };
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
  copyToClipboard(createTaskRemediationPlanText(task, plan));
}

function copyTaskRemediationPlans(tasks: DeployTask[], labels: (typeof copy)[AppLanguage]) {
  copyToClipboard(
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
  const runtimeDiagnosis = readForwardingRuntimeDiagnosis(bundle) ?? readXrayRuntimeDiagnosis(bundle);

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
        : undefined,
      runtimeDiagnosis
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
  copyToClipboard(
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
  commandOutbox: CommandOutboxSummary[],
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
      commandOutboxItems: commandOutbox.filter((item) => item.taskId === task.id),
      configRevision,
      preflightPlan,
      runtimeSnapshot
    };
  });
}

function createExecutionReleaseGates({
  activeTaskCount,
  configRevisions,
  failureTaskCount,
  language,
  preflightPlans,
  rollbackReadyCount,
  runtimeSnapshots,
  taskCount,
  t
}: {
  activeTaskCount: number;
  configRevisions: RuntimeConfigRevision[];
  failureTaskCount: number;
  language: AppLanguage;
  preflightPlans: RuntimePreflightPlan[];
  rollbackReadyCount: number;
  runtimeSnapshots: RuntimeSnapshot[];
  taskCount: number;
  t: (typeof copy)[AppLanguage];
}): ExecutionReleaseGate[] {
  const artifactCount = configRevisions.length + preflightPlans.length + runtimeSnapshots.length;

  return [
    {
      label: t.executionQueueGate,
      detail: t.executionQueueGateDetail(activeTaskCount, taskCount, language),
      state: activeTaskCount > 0 ? 'waiting' : taskCount > 0 ? 'ready' : 'waiting',
      value: activeTaskCount > 0 ? t.gateStateLabel.waiting : taskCount > 0 ? t.gateStateLabel.ready : t.gateStateLabel.waiting
    },
    {
      label: t.failureHandlingGate,
      detail: t.failureHandlingGateDetail(failureTaskCount, language),
      state: failureTaskCount > 0 ? 'issues' : taskCount > 0 ? 'ready' : 'waiting',
      value: failureTaskCount > 0 ? t.gateStateLabel.issues : taskCount > 0 ? t.gateStateLabel.ready : t.gateStateLabel.waiting
    },
    {
      label: t.releaseArtifactsGate,
      detail: t.releaseArtifactsGateDetail(configRevisions.length, preflightPlans.length, runtimeSnapshots.length, language),
      state: artifactCount > 0 ? 'ready' : 'waiting',
      value: artifactCount > 0 ? t.gateStateLabel.ready : t.gateStateLabel.waiting
    },
    {
      label: t.rollbackBoundaryGate,
      detail: t.rollbackBoundaryGateDetail(rollbackReadyCount, taskCount, language),
      state: rollbackReadyCount > 0 ? 'ready' : taskCount > 0 ? 'issues' : 'waiting',
      value: rollbackReadyCount > 0 ? t.gateStateLabel.ready : taskCount > 0 ? t.gateStateLabel.issues : t.gateStateLabel.waiting
    }
  ];
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
    return 'bg-[#DCE1FF] text-[#1E3AFF] dark:bg-primary/15 dark:text-primary';
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
  language,
  tone
}: ExecutionMetric) {
  const metricClass =
    tone === 'signal'
      ? 'border border-[#FF3D18]/35 bg-[#FFD8C6]/65 dark:border-[#FF6A3A]/25 dark:bg-[#FF3D18]/[0.09]'
      : '';
  const labelClass =
    tone === 'signal'
      ? 'text-[#C92810] dark:text-[#FFB299]'
      : 'text-slate-500 dark:text-white/45';

  return (
    <article aria-label={label} className={`ou-surface-muted min-h-[76px] p-3 ${metricClass}`} role="group">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${labelClass}`}>{label}</p>
          <p className="mt-1 text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
            {formatNumber(value, language)}
          </p>
        </div>
      </div>
    </article>
  );
}

function ReleasePath({ labels }: { labels: string[] }) {
  return (
    <ol className="mt-3 grid grid-cols-2 gap-2">
      {labels.map((label, index) => (
        <li className="flex min-w-0 items-center gap-2" key={label}>
          <span
            aria-hidden="true"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[#1E3AFF]/30 bg-white text-[11px] font-black text-[#1E3AFF] dark:border-primary/25 dark:bg-primary/10 dark:text-primary"
          >
            {index + 1}
          </span>
          <span className="whitespace-normal break-words text-xs font-black text-slate-800 dark:text-white/80">
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function EvidenceSummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <article aria-label={label} className="min-h-[76px] border border-slate-200 bg-white/55 p-3 dark:border-white/10 dark:bg-black/10">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <p className="mt-2 text-sm font-black leading-5 text-slate-900 dark:text-white">{value}</p>
    </article>
  );
}

function TasksEmptyState({
  className,
  description,
  title
}: {
  className: string;
  description?: string;
  title: string;
}) {
  return (
    <div className={`${className} border border-dashed border-[#07111F]/24 bg-[#FFFDF5]/70 p-3 text-center dark:border-white/10 dark:bg-white/[0.025]`}>
      <p className="text-sm font-bold text-slate-700 dark:text-white/70">{title}</p>
      {description ? <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-white/45">{description}</p> : null}
    </div>
  );
}

function ExecutionReleaseGatePanel({
  gates,
  t
}: {
  gates: ExecutionReleaseGate[];
  t: (typeof copy)[AppLanguage];
}) {
  return (
    <section
      aria-label={t.executionReleaseGates}
      className="tasks-release-gate-panel overflow-hidden border border-[#07111F] bg-[#FFFDF5] shadow-[0_18px_44px_-38px_rgba(7,17,31,0.42)] dark:border-[#6B7CFF]/30 dark:bg-white/[0.035]"
      role="region"
    >
      <div className="border-b border-[#07111F] bg-[#1E3AFF] px-3 py-2.5 text-white dark:border-[#6B7CFF]/30 dark:bg-[#1E3AFF]/80">
        <p className="text-xs font-black uppercase tracking-widest">{t.executionReleaseGates}</p>
        {t.executionReleaseGatesHint ? (
          <p className="mt-1 text-[11px] leading-5 text-white/82">{t.executionReleaseGatesHint}</p>
        ) : null}
      </div>
      <div className="grid grid-cols-1 divide-y divide-[#07111F]/20 dark:divide-[#6B7CFF]/20">
        {gates.map((gate) => (
          <ExecutionReleaseGateRow gate={gate} key={gate.label} />
        ))}
      </div>
    </section>
  );
}

function ExecutionReleaseGateRow({ gate }: { gate: ExecutionReleaseGate }) {
  const stateClass = {
    ready: 'border-[#00A878] bg-[#00A878]/[0.12] text-[#006B50] dark:bg-[#00A878]/[0.14] dark:text-[#7FF3C9]',
    issues: 'border-[#FF3D18] bg-[#FF3D18]/[0.13] text-[#C92810] dark:bg-[#FF6A3A]/[0.12] dark:text-[#FFB299]',
    waiting: 'border-[#D9FF00] bg-[#D9FF00]/[0.24] text-[#425200] dark:bg-[#D9FF00]/[0.12] dark:text-[#EAFF5A]'
  } satisfies Record<ExecutionReleaseGateState, string>;

  return (
    <article
      aria-label={gate.label}
      className="tasks-release-gate-row group relative min-h-[76px] px-3 py-2.5 transition-[background-color,transform] duration-200 ease-out hover:bg-[#EAF3D1]/70 motion-reduce:transition-none dark:hover:bg-white/[0.055]"
      role="group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-[#07111F] dark:text-white">{gate.label}</p>
          <p className="mt-1 text-[11px] leading-5 text-[#35405A] dark:text-white/55">{gate.detail}</p>
        </div>
        <span className={`shrink-0 border px-2.5 py-1 text-xs font-black ${stateClass[gate.state]}`}>
          {gate.value}
        </span>
      </div>
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-1 origin-left scale-x-75 bg-[#1E3AFF] transition-transform duration-200 ease-out group-hover:scale-x-100 motion-reduce:transition-none"
      />
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
    <div className="border border-slate-200 p-2.5 dark:border-white/10">
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

function RuntimeVerificationStrip({
  bundle,
  language,
  t
}: {
  bundle: RuntimeReleaseBundle;
  language: AppLanguage;
  t: (typeof copy)[AppLanguage];
}) {
  const evidence = createRuntimeVerificationEvidence(bundle, language, t);
  const stateClass = {
    verified:
      'border-[#00A878]/35 bg-[#00A878]/[0.10] text-[#006B50] dark:border-[#00D49A]/25 dark:bg-[#00A878]/[0.12] dark:text-[#7FF3C9]',
    failed:
      'border-[#DC2626]/40 bg-[#DC2626]/[0.10] text-[#B91C1C] dark:border-[#F87171]/25 dark:bg-[#DC2626]/[0.14] dark:text-[#FCA5A5]',
    waiting:
      'border-[#1E3AFF]/30 bg-[#DCE1FF]/65 text-[#1E3AFF] dark:border-[#6B7CFF]/25 dark:bg-primary/10 dark:text-primary'
  } satisfies Record<RuntimeVerificationState, string>;
  const stepClass = {
    confirmed:
      'border-[#00A878]/25 bg-white/80 text-[#006B50] dark:border-[#00D49A]/20 dark:bg-white/[0.04] dark:text-[#7FF3C9]',
    failed:
      'border-[#DC2626]/30 bg-[#FFF1F1]/80 text-[#B91C1C] dark:border-[#F87171]/20 dark:bg-[#DC2626]/10 dark:text-[#FCA5A5]',
    waiting:
      'border-[#07111F]/14 bg-white/65 text-[#35405A] dark:border-white/10 dark:bg-white/[0.03] dark:text-white/62'
  } satisfies Record<RuntimeVerificationStepState, string>;

  return (
    <section
      aria-label={t.runtimeVerification}
      className="tasks-runtime-verification-strip mb-3 border border-[#07111F]/18 bg-[#FFFDF5]/82 p-3 shadow-[0_14px_34px_-30px_rgba(7,17,31,0.34)] dark:border-[#6B7CFF]/20 dark:bg-white/[0.035]"
      data-runtime-verification-state={evidence.state}
      role="group"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-[#35405A] dark:text-white/45">
            {t.runtimeVerification}
          </p>
          <p className="mt-1 text-xs font-semibold leading-5 text-[#35405A] dark:text-white/62">
            {evidence.description}
          </p>
        </div>
        <span className={`border px-2.5 py-1 text-[10px] font-black uppercase ${stateClass[evidence.state]}`}>
          {t.runtimeVerificationStateLabels[evidence.state]}
        </span>
      </div>
      {evidence.rollbackTaskId ? (
        <p className="mt-2 break-all border border-[#1E3AFF]/20 bg-[#DCE1FF]/50 px-2 py-1 font-mono text-[10px] font-bold text-[#1E3AFF] dark:border-primary/20 dark:bg-primary/10 dark:text-primary">
          {t.rollbackTask}: {evidence.rollbackTaskId}
        </p>
      ) : null}
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {evidence.steps.map((step) => (
          <article className={`min-w-0 border p-2 ${stepClass[step.state]}`} key={step.id}>
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <p className="text-[9px] font-black uppercase tracking-widest">
                {t.runtimeVerificationStepLabels[step.id]}
              </p>
              <span className="border border-current/20 px-1.5 py-0.5 text-[9px] font-black uppercase">
                {t.runtimeVerificationStepStateLabels[step.state]}
              </span>
            </div>
            <p className="mt-1 break-all font-mono text-[10px] font-bold">{step.value ?? t.pendingArtifact}</p>
            {step.detail ? (
              <p className="mt-1 break-all font-mono text-[9px] font-semibold opacity-75">{step.detail}</p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function ForwardingRuntimeDiagnosisEvidenceCard({
  diagnosis,
  language,
  t
}: {
  diagnosis: ForwardingRuntimeDiagnosisEvidence;
  language: AppLanguage;
  t: (typeof copy)[AppLanguage];
}) {
  const stateClass = {
    ready: 'border-[#00A878] bg-[#00A878]/[0.10] text-[#006B50] dark:border-[#00D49A]/25 dark:bg-[#00A878]/[0.12] dark:text-[#7FF3C9]',
    waiting: 'border-[#D9FF00] bg-[#D9FF00]/[0.22] text-[#425200] dark:border-[#D9FF00]/25 dark:bg-[#D9FF00]/[0.12] dark:text-[#EAFF5A]',
    degraded: 'border-[#FF3D18] bg-[#D9FF00]/[0.18] text-[#B93C17] dark:border-[#FF6A3A]/25 dark:bg-[#D9FF00]/[0.08] dark:text-[#EAFF5A]',
    blocked: 'border-[#FF3D18] bg-[#FF3D18]/[0.10] text-[#C92810] dark:border-[#FF6A3A]/25 dark:bg-[#FF6A3A]/[0.12] dark:text-[#FFB299]',
    failed: 'border-[#DC2626] bg-[#DC2626]/[0.10] text-[#B91C1C] dark:border-[#F87171]/25 dark:bg-[#DC2626]/[0.14] dark:text-[#FCA5A5]'
  } satisfies Record<ForwardingRuntimeDiagnosisState, string>;
  const reasonPreview = diagnosis.reasons.slice(0, 3);
  const actionPreview = diagnosis.nextActions.slice(0, 3);
  const servicePreview = diagnosis.plannedRuntimeServices.slice(0, 2);

  return (
    <section
      aria-label={t.forwardingRuntimeDiagnosis}
      className="tasks-forwarding-runtime-diagnosis mt-3 border border-[#07111F]/20 bg-[#FFFDF5]/84 p-2.5 shadow-[0_12px_28px_-24px_rgba(7,17,31,0.28)] dark:border-[#6B7CFF]/20 dark:bg-white/[0.035]"
      data-runtime-diagnosis-state={diagnosis.state}
      role="group"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-black uppercase tracking-widest text-[#35405A] dark:text-white/45">
            {t.forwardingRuntimeDiagnosis}
          </span>
          <span className={`border px-2 py-0.5 text-[10px] font-black uppercase ${stateClass[diagnosis.state]}`}>
            {t.runtimeDiagnosisStateLabels[diagnosis.state]}
          </span>
        </div>
        <span className="border border-[#07111F]/18 bg-white/70 px-2 py-0.5 text-[10px] font-bold uppercase text-[#35405A] dark:border-white/10 dark:bg-white/[0.04] dark:text-white/60">
          {diagnosis.evidenceStage}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] font-semibold text-[#35405A] dark:text-white/55">
        {t.runtimeDiagnosisCounters(diagnosis.impactedBindingCount, diagnosis.hasRuntimeEvidence, language)}
      </p>
      <div className="mt-2 grid gap-2 lg:grid-cols-2">
        <div className="min-w-0 border border-[#07111F]/15 bg-[#EAF3D1]/55 p-2 dark:border-white/10 dark:bg-white/[0.03]">
          <p className="text-[9px] font-black uppercase tracking-widest text-[#35405A] dark:text-white/40">
            {t.runtimeDiagnosisPlannedBinding}
          </p>
          <p className="mt-1 font-mono text-[10px] font-bold text-[#07111F] dark:text-white/75">
            {diagnosis.plannedBindingStatus}
          </p>
        </div>
        <div className="min-w-0 border border-[#07111F]/15 bg-[#EAF3D1]/55 p-2 dark:border-white/10 dark:bg-white/[0.03]">
          <p className="text-[9px] font-black uppercase tracking-widest text-[#35405A] dark:text-white/40">
            {t.runtimeDiagnosisPlannedServices}
          </p>
          <div className="mt-1 space-y-1">
            {(servicePreview.length > 0 ? servicePreview : ['-']).map((service) => (
              <p className="break-all font-mono text-[10px] font-bold text-[#07111F] dark:text-white/75" key={service}>
                {service}
              </p>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {reasonPreview.map((reason) => (
          <span
            className="border border-[#07111F]/18 bg-[#EAF3D1]/70 px-2 py-0.5 text-[9px] font-bold uppercase text-[#07111F] dark:border-white/10 dark:bg-white/[0.04] dark:text-white/65"
            data-runtime-diagnosis-reason={reason}
            key={reason}
          >
            {t.runtimeDiagnosisReasonLabels[reason]}
          </span>
        ))}
        {diagnosis.blockedControls.slice(0, 4).map((control) => (
          <span
            className="border border-[#FF3D18] bg-[#FF3D18]/[0.09] px-2 py-0.5 text-[9px] font-black uppercase text-[#C92810] dark:border-[#FF6A3A]/25 dark:bg-[#FF6A3A]/10 dark:text-[#FFB299]"
            data-runtime-blocked-control={control}
            key={control}
          >
            {control}
          </span>
        ))}
        {actionPreview.map((action) => (
          <span
            className="border border-[#1E3AFF] bg-[#DCE1FF]/70 px-2 py-0.5 text-[9px] font-black uppercase text-[#1E3AFF] dark:border-[#6B7CFF]/30 dark:bg-primary/10 dark:text-primary"
            data-runtime-diagnosis-action={action}
            key={action}
          >
            {t.runtimeDiagnosisActionLabels[action]}
          </span>
        ))}
      </div>
    </section>
  );
}

function XrayRuntimeDiagnosisEvidenceCard({
  diagnosis,
  language,
  t
}: {
  diagnosis: XrayRuntimeDiagnosisEvidence;
  language: AppLanguage;
  t: (typeof copy)[AppLanguage];
}) {
  const stateClass = {
    ready: 'border-[#00A878] bg-[#00A878]/[0.10] text-[#006B50] dark:border-[#00D49A]/25 dark:bg-[#00A878]/[0.12] dark:text-[#7FF3C9]',
    waiting: 'border-[#D9FF00] bg-[#D9FF00]/[0.22] text-[#425200] dark:border-[#D9FF00]/25 dark:bg-[#D9FF00]/[0.12] dark:text-[#EAFF5A]',
    degraded: 'border-[#FF3D18] bg-[#D9FF00]/[0.18] text-[#B93C17] dark:border-[#FF6A3A]/25 dark:bg-[#D9FF00]/[0.08] dark:text-[#EAFF5A]',
    blocked: 'border-[#FF3D18] bg-[#FF3D18]/[0.10] text-[#C92810] dark:border-[#FF6A3A]/25 dark:bg-[#FF6A3A]/[0.12] dark:text-[#FFB299]',
    failed: 'border-[#DC2626] bg-[#DC2626]/[0.10] text-[#B91C1C] dark:border-[#F87171]/25 dark:bg-[#DC2626]/[0.14] dark:text-[#FCA5A5]'
  } satisfies Record<XrayRuntimeDiagnosisState, string>;
  const reasonPreview = diagnosis.reasons.slice(0, 8);
  const actionPreview = diagnosis.nextActions.slice(0, 4);
  const servicePreview = diagnosis.plannedRuntimeServices.slice(0, 2);
  const plannedInbound = diagnosis.plannedInbound;

  return (
    <section
      aria-label={t.xrayRuntimeDiagnosis}
      className="tasks-xray-runtime-diagnosis mt-3 border border-[#07111F]/20 bg-[#FFFDF5]/84 p-2.5 shadow-[0_12px_28px_-24px_rgba(7,17,31,0.28)] dark:border-[#6B7CFF]/20 dark:bg-white/[0.035]"
      data-runtime-diagnosis-state={diagnosis.state}
      role="group"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-black uppercase tracking-widest text-[#35405A] dark:text-white/45">
            {t.xrayRuntimeDiagnosis}
          </span>
          <span className={`border px-2 py-0.5 text-[10px] font-black uppercase ${stateClass[diagnosis.state]}`}>
            {t.runtimeDiagnosisStateLabels[diagnosis.state]}
          </span>
        </div>
        <span className="border border-[#07111F]/18 bg-white/70 px-2 py-0.5 text-[10px] font-bold uppercase text-[#35405A] dark:border-white/10 dark:bg-white/[0.04] dark:text-white/60">
          {diagnosis.evidenceStage}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] font-semibold text-[#35405A] dark:text-white/55">
        {t.xrayRuntimeDiagnosisCounters(
          diagnosis.clientCounters.active,
          diagnosis.clientCounters.total,
          diagnosis.clientCounters.disabled,
          diagnosis.hasRuntimeEvidence,
          language
        )}
      </p>
      <div className="mt-2 grid gap-2 lg:grid-cols-2">
        <div className="min-w-0 border border-[#07111F]/15 bg-[#EAF3D1]/55 p-2 dark:border-white/10 dark:bg-white/[0.03]">
          <p className="text-[9px] font-black uppercase tracking-widest text-[#35405A] dark:text-white/40">
            {t.xrayRuntimeDiagnosisPlannedInbound}
          </p>
          <p className="mt-1 break-all font-mono text-[10px] font-bold text-[#07111F] dark:text-white/75">
            {plannedInbound.agentId} · {plannedInbound.listenAddress}:{formatNumber(plannedInbound.listenPort, language)} ·{' '}
            {plannedInbound.protocol}/{plannedInbound.network}/{plannedInbound.security} · {plannedInbound.action}
          </p>
        </div>
        <div className="min-w-0 border border-[#07111F]/15 bg-[#EAF3D1]/55 p-2 dark:border-white/10 dark:bg-white/[0.03]">
          <p className="text-[9px] font-black uppercase tracking-widest text-[#35405A] dark:text-white/40">
            {t.runtimeDiagnosisPlannedServices}
          </p>
          <div className="mt-1 space-y-1">
            {(servicePreview.length > 0 ? servicePreview : ['-']).map((service) => (
              <p className="break-all font-mono text-[10px] font-bold text-[#07111F] dark:text-white/75" key={service}>
                {service}
              </p>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {reasonPreview.map((reason) => (
          <span
            className="border border-[#07111F]/18 bg-[#EAF3D1]/70 px-2 py-0.5 text-[9px] font-bold uppercase text-[#07111F] dark:border-white/10 dark:bg-white/[0.04] dark:text-white/65"
            data-runtime-diagnosis-reason={reason}
            key={reason}
          >
            {t.xrayRuntimeDiagnosisReasonLabels[reason]}
          </span>
        ))}
        {actionPreview.map((action) => (
          <span
            className="border border-[#1E3AFF] bg-[#DCE1FF]/70 px-2 py-0.5 text-[9px] font-black uppercase text-[#1E3AFF] dark:border-[#6B7CFF]/30 dark:bg-primary/10 dark:text-primary"
            data-runtime-diagnosis-action={action}
            key={action}
          >
            {t.xrayRuntimeDiagnosisActionLabels[action]}
          </span>
        ))}
      </div>
    </section>
  );
}

function AgentCommandEvidenceCard({
  commands,
  language,
  t
}: {
  commands: CommandOutboxSummary[];
  language: AppLanguage;
  t: (typeof copy)[AppLanguage];
}) {
  if (commands.length === 0) {
    return null;
  }

  return (
    <section
      aria-label={t.agentCommand}
      className="tasks-agent-command-evidence mt-3 border border-[#07111F]/20 bg-[#EAF3D1]/60 p-2.5 dark:border-[#6B7CFF]/20 dark:bg-white/[0.035]"
      role="group"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-[#35405A] dark:text-white/45">
          {t.agentCommand}
        </span>
        <span className="border border-[#07111F]/18 bg-white/70 px-2 py-0.5 text-[10px] font-bold uppercase text-[#35405A] dark:border-white/10 dark:bg-white/[0.04] dark:text-white/60">
          {formatNumber(commands.length, language)}
        </span>
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {commands.map((command) => (
          <article
            aria-label={`${t.agentCommand} ${command.commandId}`}
            className="min-w-0 border border-[#07111F]/15 bg-white/72 p-2 dark:border-white/10 dark:bg-black/10"
            key={command.id}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="break-all font-mono text-[10px] font-black text-[#07111F] dark:text-white/80">
                {command.id}
              </p>
              <StatusPill status={command.status} language={language} />
            </div>
            <p className="mt-1 break-all font-mono text-[10px] font-semibold text-[#35405A] dark:text-white/55">
              {t.agentCommandDetail(command.commandType, command.agentId, command.commandId)}
            </p>
            <p className="mt-1 text-[10px] font-semibold text-[#35405A] dark:text-white/50">
              {t.agentCommandTiming(command.ackedAt, command.resultAt, command.deadlineAt)}
            </p>
            {command.lastError ? (
              <p className="mt-2 rounded border border-red-200 bg-red-50/70 p-2 text-[10px] font-bold text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200">
                {command.lastError}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function RuntimeReleaseTimeline({
  bundle,
  className = '',
  language
}: {
  bundle: RuntimeReleaseBundle;
  className?: string;
  language: AppLanguage;
}) {
  const t = copy[language];
  const { commandOutboxItems, configRevision, preflightPlan, runtimeSnapshot } = bundle;
  const moduleKind = configRevision?.moduleKind ?? preflightPlan?.moduleKind ?? runtimeSnapshot?.moduleKind;
  const forwardingRuntimeDiagnosis = readForwardingRuntimeDiagnosis(bundle);
  const xrayRuntimeDiagnosis = readXrayRuntimeDiagnosis(bundle);

  if (!configRevision && !preflightPlan && !runtimeSnapshot && commandOutboxItems.length === 0) {
    return null;
  }

  return (
    <div
      className={`tasks-runtime-release-evidence-card mt-3 break-words border-t border-[#D9FF00]/55 pt-3 dark:border-[#D9FF00]/20 ${className}`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Workflow className="h-3.5 w-3.5 text-[#1E3AFF] dark:text-primary" />
          <p className="text-xs font-bold text-slate-800 dark:text-white">{t.runtimeRelease}</p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500 dark:text-white/40">
          {moduleKind ? t.moduleKind[moduleKind] : ''}
        </span>
      </div>
      <RuntimeVerificationStrip bundle={bundle} language={language} t={t} />
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
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
      <AgentCommandEvidenceCard commands={commandOutboxItems} language={language} t={t} />
      {forwardingRuntimeDiagnosis ? (
        <ForwardingRuntimeDiagnosisEvidenceCard
          diagnosis={forwardingRuntimeDiagnosis}
          language={language}
          t={t}
        />
      ) : null}
      {xrayRuntimeDiagnosis ? (
        <XrayRuntimeDiagnosisEvidenceCard diagnosis={xrayRuntimeDiagnosis} language={language} t={t} />
      ) : null}
      {configRevision?.failureReason ?? preflightPlan?.failureReason ? (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50/70 p-3 text-xs font-semibold text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200">
          {configRevision?.failureReason ?? preflightPlan?.failureReason}
        </p>
      ) : null}
    </div>
  );
}

function PreflightChecksEvidence({
  preflightPlan,
  language
}: {
  preflightPlan?: RuntimePreflightPlan;
  language: AppLanguage;
}) {
  const t = copy[language];

  if (!preflightPlan) {
    return null;
  }

  return (
    <div className="tasks-preflight-evidence-card break-words rounded-xl border border-[#07111F]/18 bg-[#FFFDF5] p-4 shadow-[0_14px_38px_-34px_rgba(7,17,31,0.36)] dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
          {t.preflightChecks}
        </p>
      </div>
      <div className="mt-3 grid gap-2">
        {preflightPlan.checks.map((check) => (
          <div
            className="grid grid-cols-1 gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/[0.04] md:grid-cols-[minmax(0,1fr)_auto]"
            key={check.id}
          >
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold text-slate-800 dark:text-white/80">{check.label}</p>
              <p className="mt-1 break-all font-mono text-[11px] text-slate-500 dark:text-white/45">{check.id}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <StatusPill status={check.status} language={language} />
              <span
                className={
                  check.severity === 'critical'
                    ? 'rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-bold uppercase text-red-600 dark:bg-red-500/10 dark:text-red-200'
                    : check.severity === 'warning'
                      ? 'rounded-full bg-[#D9FF00]/35 px-2.5 py-1 text-[10px] font-bold uppercase text-[#425200] dark:bg-[#D9FF00]/10 dark:text-[#EAFF5A]'
                      : 'rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-white/10 dark:text-white/70'
                }
              >
                {t.preflightSeverity[check.severity]}
              </span>
            </div>
          </div>
        ))}
        {preflightPlan.checks.length === 0 ? (
          <p className="text-xs font-semibold text-slate-500 dark:text-white/45">{t.noPreflightChecks}</p>
        ) : null}
      </div>
    </div>
  );
}

function RelatedAgentLogsEvidence({
  chunks,
  language
}: {
  chunks: AgentLogChunk[];
  language: AppLanguage;
}) {
  const t = copy[language];

  return (
    <div className="break-words rounded-xl border border-[#07111F]/18 bg-[#FFFDF5] p-4 shadow-[0_14px_38px_-34px_rgba(7,17,31,0.36)] dark:border-white/10 dark:bg-white/[0.03]">
      <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
        {t.relatedAgentLogs}
      </p>
      <div className="mt-3 grid gap-2">
        {chunks.map((chunk) => (
          <div
            key={chunk.eventId}
            className="tasks-related-agent-log-card break-words rounded-lg border border-[#1E3AFF]/20 bg-[#DCE1FF]/35 p-3 dark:border-primary/20 dark:bg-primary/[0.08]"
          >
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
        {chunks.length === 0 ? (
          <p className="text-xs font-semibold text-slate-500 dark:text-white/45">{t.noRelatedLogs}</p>
        ) : null}
      </div>
    </div>
  );
}

function RelatedLogArchivesEvidence({
  archives,
  language
}: {
  archives: AgentLogArchive[];
  language: AppLanguage;
}) {
  const t = copy[language];

  return (
    <div className="break-words rounded-xl border border-[#07111F]/18 bg-[#FFFDF5] p-4 shadow-[0_14px_38px_-34px_rgba(7,17,31,0.36)] dark:border-white/10 dark:bg-white/[0.03]">
      <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
        {t.relatedLogArchives}
      </p>
      <div className="mt-3 grid gap-2">
        {archives.map((archive) => (
          <div
            key={archive.id}
            className="tasks-related-log-archive-card break-words rounded-lg border border-[#00A878]/25 bg-[#00A878]/[0.08] p-3 dark:border-[#00A878]/25 dark:bg-[#00A878]/[0.09]"
          >
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
        {archives.length === 0 ? (
          <p className="text-xs font-semibold text-slate-500 dark:text-white/45">{t.noRelatedLogs}</p>
        ) : null}
      </div>
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
  const tuningProbeState = task ? readTuningProbeState(task.metadata) : undefined;
  const tuningPreset = task ? readTuningPresetMetadata(task.metadata) : undefined;
  const tuningSysctlPlan = task ? readTuningSysctlPlanMetadata(task.metadata) : undefined;

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
              <GlowButton className="px-4 py-2 text-xs" onClick={() => copyToClipboard(stringifyJson(contextPayload))}>
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

          {isSystemTuneTask(task) ? (
            <SystemTuneTaskEvidence
              probeState={tuningProbeState}
              preset={tuningPreset}
              sysctlPlan={tuningSysctlPlan}
              language={language}
            />
          ) : (
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
          )}

          <RelatedAgentLogsEvidence chunks={relatedChunks} language={language} />

          <RelatedLogArchivesEvidence archives={relatedArchives} language={language} />
        </div>
      ) : null}
    </ConfigDrawer>
  );
}

function SystemTuneTaskEvidence({
  probeState,
  preset,
  sysctlPlan,
  language
}: {
  probeState?: TuningProbeState;
  preset?: TuningPresetMetadata;
  sysctlPlan?: TuningSysctlPlanMetadata;
  language: AppLanguage;
}) {
  const t = copy[language];
  const parameters = sysctlPlan?.parameters ?? [];
  const hasPreset = Boolean(preset);
  const hasPlan = Boolean(sysctlPlan);
  const probeBbrState = probeState?.bbrInstalled ? t.tuningProbeInstalled : t.tuningProbeUnconfirmed;
  const probeTcpState = probeState?.tcpProbeReady ? t.tuningProbeReady : t.tuningProbeWaiting;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
        <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
          {t.tuningTaskEvidence}
        </p>
        <p className="mt-1 text-[11px] font-semibold text-slate-500 dark:text-white/45">{t.tuningProbeState}</p>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <EvidenceCompactTile label={t.tuningProbeBbr} value={probeBbrState} />
          <EvidenceCompactTile label={t.tuningProbeTcp} value={probeTcpState} />
          <EvidenceCompactTile label={t.tuningProbeKernelVersion} value={probeState?.kernelVersion || t.noMetadata} />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
        <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
          {t.tuningPresetEvidence}
        </p>
        {hasPreset ? (
          <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
            <EvidenceCompactTile label={t.tuningPresetName} value={preset?.name ?? t.noMetadata} />
            <EvidenceCompactTile label={t.tuningPresetTarget} value={preset?.target ?? t.noMetadata} />
            <EvidenceCompactTile label={t.tuningPresetRiskLevel} value={preset?.riskLevel ?? t.noMetadata} />
            <EvidenceCompactTile label={t.tuningPresetId} value={preset?.id ?? t.noMetadata} />
          </div>
        ) : (
          <p className="mt-3 text-xs font-semibold text-slate-500 dark:text-white/45">{t.noMetadata}</p>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
        <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
          {t.sysctlPlanEvidence}
        </p>
        {hasPlan ? (
          <div className="mt-3 space-y-3">
            <div className="grid gap-2 text-xs md:grid-cols-2">
              <EvidenceCompactTile label={t.sysctlPlanName} value={sysctlPlan?.name ?? t.noMetadata} />
              <EvidenceCompactTile label={t.sysctlPlanTarget} value={sysctlPlan?.target ?? t.noMetadata} />
              <EvidenceCompactTile label={t.sysctlPlanRisk} value={sysctlPlan?.riskLevel ?? t.noMetadata} />
              <EvidenceCompactTile label={t.sysctlPlanId} value={sysctlPlan?.id ?? t.noMetadata} />
            </div>
            <div className="grid gap-2">
              {parameters.map((parameter) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-2 border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-white/10 dark:bg-white/[0.04]"
                  key={parameter.key}
                >
                  <span className="break-all font-mono font-semibold text-slate-700 dark:text-white/80">
                    {parameter.key}
                  </span>
                  <span className="break-all font-mono text-slate-500 dark:text-white/45">{parameter.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs font-semibold text-slate-500 dark:text-white/45">{t.noMetadata}</p>
        )}
      </div>
    </div>
  );
}

function EvidenceCompactTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-slate-200 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.04]">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-slate-800 dark:text-white/80">{value}</p>
    </div>
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
          <div className="tasks-failure-evidence-card break-words rounded-xl border border-[#FF3D18]/45 bg-[#FFD8C6]/75 p-4 shadow-[0_18px_44px_-38px_rgba(255,61,24,0.46)] dark:border-[#FF6A3A]/30 dark:bg-[#FF3D18]/[0.12]">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-300" />
              <p className="text-xs font-black uppercase tracking-widest text-red-600 dark:text-red-300">
                {t.failureReason}
              </p>
            </div>
            <p className="mt-3 break-words text-sm font-semibold text-red-700 dark:text-red-100">
              {task.failureReason ?? t.noFailureReason}
            </p>
          </div>

          {remediationPlan ? (
            <div className="tasks-remediation-evidence-card break-words rounded-xl border border-[#1E3AFF]/35 bg-[#DCE1FF]/70 p-4 shadow-[0_18px_44px_-38px_rgba(30,58,255,0.4)] dark:border-primary/25 dark:bg-primary/10">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-[#1E3AFF] dark:text-primary">
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

          {bundle ? <RuntimeReleaseTimeline bundle={bundle} language={language} /> : null}

          <PreflightChecksEvidence preflightPlan={bundle?.preflightPlan} language={language} />

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

          <RelatedAgentLogsEvidence chunks={relatedChunks} language={language} />

          <RelatedLogArchivesEvidence archives={relatedArchives} language={language} />

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

    copyToClipboard(stringifyJson(createAgentLogContextPayload(filteredChunks)));
  }

  return (
    <GlassCard aria-label={t.agentLogsTitle} className="tasks-agent-log-panel stagger-3 p-3" role="group">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-[#1E3AFF] dark:text-primary" />
          <h4 className="text-sm font-bold text-slate-800 dark:text-white">
            {t.agentLogsTitle} · {formatNumber(chunks.length, language)}
          </h4>
        </div>
        {onExport ? (
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-[#1E3AFF]/35 hover:text-[#1E3AFF] disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:border-primary/50 dark:hover:text-primary"
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
            <span className="rounded-full bg-[#DCE1FF] px-2.5 py-1 text-[#1E3AFF] dark:bg-primary/15 dark:text-primary">
              {t.agentLogRetentionSourceLabels[policy.source]}
            </span>
          </div>
        ) : null}
      </div>

      {chunks.length > 0 ? (
        <div className="mb-3 border border-slate-200 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(16rem,1fr)_minmax(10rem,0.28fr)]">
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
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:bg-white hover:text-[#1E3AFF] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
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
              className="w-28 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-800 outline-none transition focus:border-[#1E3AFF] dark:border-white/10 dark:bg-white/5 dark:text-white"
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
              className="w-32 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-800 outline-none transition focus:border-[#1E3AFF] dark:border-white/10 dark:bg-white/5 dark:text-white"
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

      <div className="space-y-2">
        {filteredChunks.map((chunk) => (
          <article key={chunk.eventId} className="border border-slate-200 p-3 dark:border-white/10">
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
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">{chunk.content}</pre>
          </article>
        ))}
        {chunks.length === 0 ? (
          <TasksEmptyState className="tasks-agent-log-empty-state" title={t.agentLogsEmpty} />
        ) : null}
        {chunks.length > 0 && filteredChunks.length === 0 ? (
          <TasksEmptyState className="tasks-agent-log-empty-state" title={t.agentLogsEmpty} />
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

    copyToClipboard(stringifyJson(createAgentLogArchiveContextPayload(filteredArchives)));
  }

  return (
    <GlassCard aria-label={t.agentLogArchivesTitle} className="tasks-agent-archive-panel stagger-4 p-3" role="group">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-[#1E3AFF] dark:text-primary" />
          <h4 className="text-sm font-bold text-slate-800 dark:text-white">
            {t.agentLogArchivesTitle} · {formatNumber(archives.length, language)}
          </h4>
        </div>
        {onExport ? (
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-[#1E3AFF]/35 hover:text-[#1E3AFF] disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:border-primary/50 dark:hover:text-primary"
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
        <div className="mb-3 border border-slate-200 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(16rem,1fr)_minmax(10rem,0.28fr)]">
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
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:bg-white hover:text-[#1E3AFF] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
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

      <div className="space-y-2">
        {filteredArchives.map((archive) => (
          <article key={archive.id} className="border border-slate-200 p-3 dark:border-white/10">
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
          <TasksEmptyState className="tasks-agent-archive-empty-state" title={t.agentLogArchivesEmpty} />
        ) : null}
        {archives.length > 0 && filteredArchives.length === 0 ? (
          <TasksEmptyState className="tasks-agent-archive-empty-state" title={t.agentLogArchivesEmpty} />
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
  commandOutbox = [],
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
    () => createReleaseBundles(tasks, commandOutbox, configRevisions, preflightPlans, runtimeSnapshots),
    [commandOutbox, configRevisions, preflightPlans, runtimeSnapshots, tasks]
  );
  const releaseBundles = useMemo(
    () => createReleaseBundles(filteredTasks, commandOutbox, configRevisions, preflightPlans, runtimeSnapshots),
    [commandOutbox, configRevisions, filteredTasks, preflightPlans, runtimeSnapshots]
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
  const activeTaskCount = tasks.filter((item) => ['queued', 'running', 'retrying'].includes(item.status)).length;
  const failureTaskCount = tasks.filter((item) => hasTaskFailureEvidence(item)).length;
  const rollbackReadyCount = tasks.filter((item) => item.rollbackAvailable && item.status === 'succeeded').length;
  const executionReleaseGates = useMemo(
    () =>
      createExecutionReleaseGates({
        activeTaskCount,
        configRevisions,
        failureTaskCount,
        language,
        preflightPlans,
        rollbackReadyCount,
        runtimeSnapshots,
        taskCount: tasks.length,
        t
      }),
    [
      activeTaskCount,
      configRevisions,
      failureTaskCount,
      language,
      preflightPlans,
      rollbackReadyCount,
      runtimeSnapshots,
      tasks.length,
      t
    ]
  );
  const overviewMetrics = useMemo<ExecutionMetric[]>(
    () => [
      {
        label: t.totalExecutions,
        value: tasks.length,
        language
      },
      {
        label: t.activeExecutions,
        value: activeTaskCount,
        language
      },
      {
        label: t.needsAttention,
        value: failureTaskCount,
        language,
        tone: 'signal'
      },
      {
        label: t.rollbackReady,
        value: rollbackReadyCount,
        language,
        tone: 'signal'
      }
    ],
    [
      activeTaskCount,
      failureTaskCount,
      language,
      rollbackReadyCount,
      t.activeExecutions,
      t.needsAttention,
      t.rollbackReady,
      t.totalExecutions,
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

    copyToClipboard(
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
    <ResponsivePage>
      <section aria-label={t.operationalOverview} className="stagger-1" role="region">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#1E3AFF] dark:text-primary">
          {t.operationalOverview}
        </p>
        <h3 className="mt-2 text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
        {t.subtitle ? (
          <p className="mt-1 max-w-3xl text-xs leading-6 text-slate-500 dark:text-white/50">{t.subtitle}</p>
        ) : null}
      </section>

      <WorkspaceCockpit
        aria-label={language === 'zh' ? '执行发布 cockpit' : 'Execution release cockpit'}
        className="tasks-release-cockpit"
      >
        <div className="tasks-release-cockpit-grid grid min-h-0 grid-cols-1 xl:grid-cols-[18rem_minmax(0,1fr)]">
          <aside
            aria-label={language === 'zh' ? '执行控制栏' : 'Execution control rail'}
            className="tasks-release-rail border-b border-slate-200 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-white/[0.02] xl:border-b-0 xl:border-r"
            role="complementary"
          >
            <div className="flex flex-col gap-3 xl:sticky xl:top-0">
              <div className="border border-slate-200 bg-white/75 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex items-center gap-2">
                  <Workflow className="h-4 w-4 text-[#1E3AFF] dark:text-primary" />
                  <p className="text-sm font-semibold text-slate-800 dark:text-white">{t.releasePath}</p>
                </div>
                <ReleasePath labels={[t.pathMaster, t.pathAgent, t.pathEvidence, t.pathRollback]} />
                {t.operationalOverviewHint ? (
                  <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-white/50">
                    {t.operationalOverviewHint}
                  </p>
                ) : null}
              </div>

              <ExecutionReleaseGatePanel gates={executionReleaseGates} t={t} />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                {overviewMetrics.map((metric) => (
                  <MetricTile key={metric.label} {...metric} />
                ))}
              </div>

              <div className="border border-slate-200 bg-white/75 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-800 dark:text-white">{t.executionOverview}</p>
                  <span className="rounded-full border border-[#FF3D18]/35 bg-[#FFD8C6]/70 px-3 py-1 text-[11px] font-black text-[#C92810] dark:border-[#FF6A3A]/25 dark:bg-[#FF3D18]/10 dark:text-[#FFB299]">
                    {t.latestExecution}: {latestExecutionStatus}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2">
                  <EvidenceSummaryTile label={t.releaseEvidence} value={releaseEvidenceSummary} />
                  <EvidenceSummaryTile label={t.agentEvidence} value={agentEvidenceSummary} />
                </div>
                {t.overviewHint ? (
                  <p className="mt-3 text-[11px] leading-5 text-slate-500 dark:text-white/45">{t.overviewHint}</p>
                ) : null}
              </div>

              {tasks.length > 0 ? (
                <div className="border border-slate-200 bg-white/75 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="grid grid-cols-1 gap-2">
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
                  <div className="mt-3 flex flex-col gap-2">
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                      {t.matchingTasks} {filteredTasks.length} / {tasks.length}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full bg-[#DCE1FF] px-3 py-1 text-xs font-bold text-[#1E3AFF] dark:bg-primary/15 dark:text-primary">
                        {t.selectedTasks} {formatNumber(selectedBundles.length, language)}
                      </span>
                      <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300">
                        {t.selectedFailureTasks} {formatNumber(selectedFailureTasks.length, language)}
                      </span>
                    </div>
                    <button
                      className="min-h-10 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-white hover:text-[#1E3AFF] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
                      disabled={releaseBundles.length === 0}
                      onClick={toggleVisibleTaskSelection}
                      type="button"
                    >
                      {t.selectVisibleTasks}
                    </button>
                    <button
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:bg-white hover:text-[#1E3AFF] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
                      disabled={selectedBundles.length === 0}
                      onClick={copySelectedTaskContexts}
                      type="button"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {t.bulkCopyTaskContexts}
                    </button>
                    <button
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-red-200 px-3 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/25 dark:text-red-300 dark:hover:bg-red-500/10"
                      disabled={selectedFailureTasks.length === 0}
                      onClick={copySelectedTaskRemediationPlans}
                      type="button"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {t.bulkCopyRemediationPlans}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </aside>

          <WorkspaceCockpitScroller
            aria-label={language === 'zh' ? '发布证据工作区' : 'Release evidence workspace'}
            className="tasks-release-workspace min-h-0"
          >
            <div className="space-y-3 p-3">
              <GlassCard
                aria-label={t.pipelineTitle}
                className="tasks-release-panel stagger-2 p-3"
                role="group"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Workflow className="h-4 w-4 text-[#1E3AFF] dark:text-primary" />
                    <h4 className="text-sm font-bold text-slate-800 dark:text-white">
                      {t.pipelineTitle} · {formatNumber(tasks.length, language)}
                    </h4>
                  </div>
                  <GlowButton className="px-4 py-2 text-xs" onClick={onRefresh}>
                    {t.refresh}
                  </GlowButton>
                </div>

                <div className="space-y-2">
                  {releaseBundles.map((bundle) => (
                    <article
                      aria-label={bundle.task.summary}
                      key={bundle.task.id}
                      className="tasks-release-row border border-slate-200 bg-white/70 p-3 transition hover:border-[#1E3AFF]/25 hover:shadow-[0_10px_26px_-24px_rgba(30,58,255,0.24)] dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-primary/25"
                    >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <input
                    aria-label={t.selectTask(bundle.task.summary)}
                    checked={selectedTaskIds.includes(bundle.task.id)}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-[#1E3AFF]"
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
                  className="inline-flex items-center gap-1 text-[#1E3AFF] dark:text-primary"
                  data-task-action="details"
                  onClick={() => setDetailsDrawerTaskId(bundle.task.id)}
                  type="button"
                >
                  <Workflow className="h-3.5 w-3.5" />
                  {t.viewTaskDetails}
                </button>
                {bundle.task.rollbackAvailable && bundle.task.status === 'succeeded' ? (
                  <button
                    className="inline-flex items-center gap-1 text-[#1E3AFF] disabled:cursor-not-allowed disabled:opacity-60 dark:text-primary"
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
                    </article>
                  ))}
                  {tasks.length === 0 ? (
                    <TasksEmptyState
                      className="tasks-release-empty-state"
                      description={t.emptyDescription}
                      title={t.emptyTitle}
                    />
                  ) : null}
                  {tasks.length > 0 && releaseBundles.length === 0 ? (
                    <TasksEmptyState className="tasks-release-empty-state" title={t.noMatchingTasks} />
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
            </div>
          </WorkspaceCockpitScroller>
        </div>
      </WorkspaceCockpit>

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
    </ResponsivePage>
  );
}
