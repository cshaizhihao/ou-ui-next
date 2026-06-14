import { useMemo, useState } from 'react';
import { Copy, FileSearch, Search, ShieldAlert, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { ConfigDrawer } from '../../components/ui/config-drawer';
import { GlassCard } from '../../components/ui/glass-card';
import {
  ResponsivePage,
  WorkspaceCockpit,
  WorkspaceCockpitScroller
} from '../../components/layout/responsive-page';
import type { AuditLog } from '../../domain/audit';
import type { AuditChainVerification } from '../../services/api/control-plane-api';
import { formatDateTime, formatNumber } from '../shared/format';

type AuditPageProps = {
  auditLogs: AuditLog[];
  language?: AppLanguage;
  onVerifyAuditLogs?: (auditLogs: AuditLog[]) => Promise<AuditChainVerification> | AuditChainVerification;
};

const copy = {
  zh: {
    title: '审计日志',
    subtitle: '记录变更创建、状态推进、回滚与失败原因，确保关键变更有据可查。',
    operationalOverview: '运营总览',
    operationalOverviewHint: '先看日志规模、严重级别与拒绝事件，再筛选证据并验证审计链。',
    auditEvidenceCockpit: '审计证据 cockpit',
    auditEvidenceControlRail: '审计证据控制栏',
    auditLedgerWorkspace: '审计账本工作区',
    evidencePath: '证据路径',
    overviewTotalAria: '总审计记录',
    overviewVisibleAria: '可见审计记录',
    overviewCriticalAria: '严重审计记录',
    overviewDeniedAria: '拒绝审计记录',
    workflowSteps: ['追踪变更', '查看证据', '验证审计链', '复制证据'],
    ledgerTitle: '变更账本',
    overviewTotal: '总记录',
    overviewVisible: '可见',
    overviewCritical: '严重',
    overviewDenied: '拒绝',
    actor: '执行者',
    source: '来源 IP',
    task: '记录',
    searchLogs: '搜索审计日志',
    searchLogsPlaceholder: '搜索消息、目标、执行者、IP、请求、拒绝原因或哈希',
    matchingLogs: '当前匹配',
    copyVisibleEvidence: '复制当前审计证据',
    verifyAuditChain: '验证审计链',
    verifyingAuditChain: '正在验证',
    auditChainStatus: '审计链状态',
    auditChainValid: '审计链有效',
    auditChainInvalid: '审计链异常',
    auditChainError: '审计链验证失败',
    checkedRecords: (count: string) => `已检查 ${count} 条记录`,
    brokenAt: (id: string) => `断点 ${id}`,
    chainFailureReason: (reason: string) => `原因 ${reason}`,
    copyVerificationResult: '复制验证结果',
    severityFilter: '严重级别',
    allSeverities: '全部级别',
    resultFilter: '结果',
    allResults: '全部结果',
    noMatchingLogs: '没有匹配的审计记录',
    viewEvidence: '查看审计证据',
    evidenceTitle: '审计证据',
    evidenceDescription: '集中查看请求上下文、拒绝原因、前后状态和链式哈希锚点。',
    evidenceSummary: '证据摘要',
    evidenceContext: '上下文',
    evidenceIntegrity: '链式完整性',
    request: '请求',
    denial: '拒绝原因',
    before: '变更前',
    after: '变更后',
    copyEvidence: '复制审计证据',
    noEvidence: '暂无额外证据',
    id: 'ID',
    action: '动作',
    operation: '操作',
    resultLabel: '结果',
    resource: '资源',
    target: '目标',
    scope: '范围',
    requestId: '请求 ID',
    requestBodyHash: '请求体哈希',
    previousHash: '前序哈希',
    currentHash: '当前哈希',
    userAgent: 'User Agent',
    emptyTitle: '暂无审计事件',
    emptyDescription: '创建或推进任务后，这里会自动生成对应的审计记录。',
    severity: {
      info: '信息',
      warning: '警告',
      critical: '严重'
    },
    result: {
      accepted: '已受理',
      succeeded: '成功',
      failed: '失败',
      denied: '拒绝'
    },
    actions: {
      'audit.denied': '审计拒绝',
      'agent.credential.issued': 'Agent 凭据已签发',
      'agent.credential.revoked': 'Agent 凭据已撤销',
      'agent.credential.rotated': 'Agent 凭据已轮换',
      'agent.upgrade_command.issued': 'Agent 升级命令已签发',
      'agent.log_retention.updated': 'Agent 日志留存策略已更新',
      'traffic.rollup_retention.updated': '流量统计留存策略已更新',
      'telegram_bot.settings.updated': 'Telegram 通知设置已更新',
      'telegram_bot.test_sent': 'Telegram 测试通知已发送',
      'telegram_binding.created': 'Telegram 绑定已创建',
      'telegram_binding.revoked': 'Telegram 绑定已撤销',
      'telegram_binding_challenge.created': 'Telegram 绑定验证码已创建',
      'telegram_notification_policy.updated': 'Telegram 通知策略已更新',
      'telegram_notification.delivery_retried': 'Telegram 通知已重试',
      'operator.session.issued': '操作员会话已签发',
      'operator.session.revoked': '操作员会话已撤销',
      'operator.session.expired': '操作员会话已过期',
      'subscription.source.synced': '订阅源已同步',
      'subscription.source.sync_failed': '订阅源同步失败',
      'task.created': '变更已创建',
      'task.queued': '等待执行',
      'task.running': '执行中',
      'task.succeeded': '执行成功',
      'task.failed': '执行失败',
      'task.retrying': '重试中',
      'task.rolled_back': '已回滚',
      'task.canceled': '已取消'
    }
  },
  en: {
    title: 'Audit Log',
    subtitle: 'Track change creation, status progression, rollback events, and failure reasons with a clear audit trail.',
    operationalOverview: 'Operational Overview',
    operationalOverviewHint: 'Review log volume, severity mix, and denied changes before filtering evidence or verifying the chain.',
    auditEvidenceCockpit: 'Audit evidence cockpit',
    auditEvidenceControlRail: 'Audit evidence control rail',
    auditLedgerWorkspace: 'Audit ledger workspace',
    evidencePath: 'Evidence path',
    overviewTotalAria: 'Total audit records',
    overviewVisibleAria: 'Visible audit records',
    overviewCriticalAria: 'Critical audit records',
    overviewDeniedAria: 'Denied audit records',
    workflowSteps: ['Trace changes', 'Inspect evidence', 'Verify chain', 'Copy evidence'],
    ledgerTitle: 'Change Ledger',
    overviewTotal: 'Total',
    overviewVisible: 'Visible',
    overviewCritical: 'Critical',
    overviewDenied: 'Denied',
    actor: 'Actor',
    source: 'Source IP',
    task: 'Record',
    searchLogs: 'Search Audit Logs',
    searchLogsPlaceholder: 'Search message, target, actor, IP, request, denial reason, or hash',
    matchingLogs: 'Matching',
    copyVisibleEvidence: 'Copy Visible Audit Evidence',
    verifyAuditChain: 'Verify Audit Chain',
    verifyingAuditChain: 'Verifying',
    auditChainStatus: 'Audit Chain Status',
    auditChainValid: 'Audit chain valid',
    auditChainInvalid: 'Audit chain invalid',
    auditChainError: 'Audit chain verification failed',
    checkedRecords: (count: string) => `Checked ${count} records`,
    brokenAt: (id: string) => `Broken at ${id}`,
    chainFailureReason: (reason: string) => `Reason ${reason}`,
    copyVerificationResult: 'Copy Verification Result',
    severityFilter: 'Severity',
    allSeverities: 'All severities',
    resultFilter: 'Result',
    allResults: 'All results',
    noMatchingLogs: 'No matching audit records',
    viewEvidence: 'View Audit Evidence',
    evidenceTitle: 'Audit Evidence',
    evidenceDescription: 'Inspect request context, denial reason, before/after state, and chained hash anchors.',
    evidenceSummary: 'Evidence Summary',
    evidenceContext: 'Context',
    evidenceIntegrity: 'Chain Integrity',
    request: 'Request',
    denial: 'Denial',
    before: 'Before',
    after: 'After',
    copyEvidence: 'Copy Audit Evidence',
    noEvidence: 'No additional evidence',
    id: 'ID',
    action: 'Action',
    operation: 'Operation',
    resultLabel: 'Result',
    resource: 'Resource',
    target: 'Target',
    scope: 'Scope',
    requestId: 'Request ID',
    requestBodyHash: 'Request Body Hash',
    previousHash: 'Previous Hash',
    currentHash: 'Current Hash',
    userAgent: 'User Agent',
    emptyTitle: 'No audit events yet',
    emptyDescription: 'Audit records will appear here automatically after changes are created or advanced.',
    severity: {
      info: 'Info',
      warning: 'Warning',
      critical: 'Critical'
    },
    result: {
      accepted: 'Accepted',
      succeeded: 'Succeeded',
      failed: 'Failed',
      denied: 'Denied'
    },
    actions: {
      'audit.denied': 'Audit Denied',
      'agent.credential.issued': 'Agent Credential Issued',
      'agent.credential.revoked': 'Agent Credential Revoked',
      'agent.credential.rotated': 'Agent Credential Rotated',
      'agent.upgrade_command.issued': 'Agent Upgrade Command Issued',
      'agent.log_retention.updated': 'Agent Log Retention Updated',
      'traffic.rollup_retention.updated': 'Traffic Rollup Retention Updated',
      'telegram_bot.settings.updated': 'Telegram Notification Settings Updated',
      'telegram_bot.test_sent': 'Telegram Test Notification Sent',
      'telegram_binding.created': 'Telegram Binding Created',
      'telegram_binding.revoked': 'Telegram Binding Revoked',
      'telegram_binding_challenge.created': 'Telegram Binding Challenge Created',
      'telegram_notification_policy.updated': 'Telegram Notification Policy Updated',
      'telegram_notification.delivery_retried': 'Telegram Notification Retried',
      'operator.session.issued': 'Operator Session Issued',
      'operator.session.revoked': 'Operator Session Revoked',
      'operator.session.expired': 'Operator Session Expired',
      'subscription.source.synced': 'Subscription Source Synced',
      'subscription.source.sync_failed': 'Subscription Source Sync Failed',
      'task.created': 'Change Created',
      'task.queued': 'Awaiting Execution',
      'task.running': 'Running',
      'task.succeeded': 'Succeeded',
      'task.failed': 'Failed',
      'task.retrying': 'Retrying',
      'task.rolled_back': 'Rolled Back',
      'task.canceled': 'Canceled'
    }
  }
} as const;

type AuditCopy = (typeof copy)[AppLanguage];
type AuditSeverityFilter = 'all' | AuditLog['severity'];
type AuditResultFilter = 'all' | AuditLog['result'];

const auditSeverities: AuditLog['severity'][] = ['critical', 'warning', 'info'];
const auditResults: AuditLog['result'][] = ['denied', 'failed', 'accepted', 'succeeded'];

function normalizeAuditSearch(value: string) {
  return value.trim().toLowerCase();
}

function stringifyEvidenceValue(value: unknown) {
  if (value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function compactEvidenceText(...values: Array<unknown>) {
  return values
    .map((value) => stringifyEvidenceValue(value))
    .filter(Boolean)
    .join(' ');
}

function createAuditSearchText(log: AuditLog, labels: AuditCopy) {
  return compactEvidenceText(
    log.id,
    log.message,
    labels.actions[log.action],
    labels.severity[log.severity],
    labels.result[log.result],
    log.action,
    log.operation,
    log.result,
    log.resourceType,
    log.targetId,
    log.targetLabel,
    log.taskId,
    log.actor,
    log.scope,
    log.sourceIp,
    log.requestId,
    log.requestBodyHash,
    log.denialCode,
    log.denialReason,
    log.prevHash,
    log.hash,
    log.before,
    log.after
  ).toLowerCase();
}

function filterAuditLogs(
  logs: AuditLog[],
  query: string,
  severityFilter: AuditSeverityFilter,
  resultFilter: AuditResultFilter,
  labels: AuditCopy
) {
  const normalizedQuery = normalizeAuditSearch(query);

  return logs.filter((log) => {
    const matchesSeverity = severityFilter === 'all' || log.severity === severityFilter;
    const matchesResult = resultFilter === 'all' || log.result === resultFilter;
    const matchesQuery = !normalizedQuery || createAuditSearchText(log, labels).includes(normalizedQuery);

    return matchesSeverity && matchesResult && matchesQuery;
  });
}

function createAuditEvidenceText(log: AuditLog) {
  return JSON.stringify(log, null, 2);
}

function copyAuditEvidence(log: AuditLog) {
  void navigator.clipboard?.writeText(createAuditEvidenceText(log));
}

function createAuditEvidenceSetPayload(logs: AuditLog[]) {
  return {
    auditLogCount: logs.length,
    auditLogs: logs
  };
}

function createAuditVerificationPayload(logs: AuditLog[], verification: AuditChainVerification) {
  return {
    auditLogCount: logs.length,
    verification
  };
}

function copyAuditEvidenceSet(logs: AuditLog[]) {
  if (logs.length === 0) {
    return;
  }

  void navigator.clipboard?.writeText(JSON.stringify(createAuditEvidenceSetPayload(logs), null, 2));
}

function copyAuditVerificationResult(logs: AuditLog[], verification: AuditChainVerification) {
  void navigator.clipboard?.writeText(JSON.stringify(createAuditVerificationPayload(logs, verification), null, 2));
}

function AuditSummaryCard({
  ariaLabel,
  icon: Icon,
  label,
  value,
  tone
}: {
  ariaLabel: string;
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: 'signal';
}) {
  const cardClass =
    tone === 'signal'
      ? 'border-[#FF3D18] bg-[#D9FF00]/[0.18] hover:border-[#FF3D18] dark:border-[#FF6A3A]/30 dark:bg-[#D9FF00]/[0.08] dark:hover:border-[#FF6A3A]/45'
      : 'border-[#1E3AFF] bg-[#FFFDF5]/75 hover:border-[#1E3AFF] dark:border-[#6B7CFF]/25 dark:bg-white/[0.03] dark:hover:border-[#6B7CFF]/40';
  const labelClass = tone === 'signal' ? 'text-[#FF3D18] dark:text-[#FFB197]' : 'text-[#35405A] dark:text-white/40';
  const iconClass = tone === 'signal' ? 'text-[#FF3D18] dark:text-[#FFB197]' : 'text-[#1E3AFF] dark:text-[#DDE3FF]';

  return (
    <div
      aria-label={ariaLabel}
      className={`rounded-xl border p-4 transition hover:-translate-y-0.5 hover:shadow-[0_14px_38px_-30px_rgba(15,23,42,0.22)] ${cardClass}`}
      role="group"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-[10px] font-bold uppercase tracking-widest ${labelClass}`}>{label}</p>
          <p className="mt-2 text-xl font-black text-slate-900 dark:text-white">{value}</p>
        </div>
        <Icon className={`h-5 w-5 ${iconClass}`} />
      </div>
    </div>
  );
}

function AuditEvidencePath({ labels }: { labels: readonly string[] }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-2">
      {labels.map((label, index) => (
        <div
          className="rounded-lg border border-[#1E3AFF]/30 bg-[#DCE1FF]/50 px-3 py-2 dark:border-[#6B7CFF]/25 dark:bg-white/[0.04]"
          key={label}
        >
          <p className="font-mono text-[10px] font-black text-[#1E3AFF] dark:text-[#DDE3FF]">
            {String(index + 1).padStart(2, '0')}
          </p>
          <p className="mt-1 text-xs font-bold text-slate-700 dark:text-white/70">{label}</p>
        </div>
      ))}
    </div>
  );
}

function EvidenceField({ label, value }: { label: string; value?: string }) {
  if (!value) {
    return null;
  }

  return (
    <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/[0.04]">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <p className="mt-1 break-all font-mono text-[11px] font-semibold text-slate-700 dark:text-white/70">{value}</p>
    </div>
  );
}

function EvidenceJsonBlock({ label, value, emptyText }: { label: string; value: unknown; emptyText: string }) {
  const formattedValue = stringifyEvidenceValue(value);

  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
      <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      {formattedValue ? (
        <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">
          {formattedValue}
        </pre>
      ) : (
        <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-white/45">{emptyText}</p>
      )}
    </div>
  );
}

function AuditEvidenceDrawer({
  language,
  log,
  open,
  onClose
}: {
  language: AppLanguage;
  log?: AuditLog;
  open: boolean;
  onClose: () => void;
}) {
  const t = copy[language];

  return (
    <ConfigDrawer
      description={log ? `${t.actions[log.action]} · ${log.targetLabel}` : t.evidenceDescription}
      open={open}
      title={t.evidenceTitle}
      onClose={onClose}
    >
      {log ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-[#1E3AFF] dark:text-[#DDE3FF]" />
              <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
                {t.evidenceSummary}
              </p>
            </div>
            <p className="mt-3 text-sm font-bold text-slate-900 dark:text-white">{log.message}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-white/10 dark:text-white/70">
                {t.severity[log.severity]}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-white/10 dark:text-white/70">
                {t.result[log.result]}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.evidenceContext}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <EvidenceField label={t.id} value={log.id} />
              <EvidenceField label={t.action} value={log.action} />
              <EvidenceField label={t.operation} value={log.operation} />
              <EvidenceField label={t.resultLabel} value={log.result} />
              <EvidenceField label={t.resource} value={`${log.resourceType}:${log.targetId}`} />
              <EvidenceField label={t.target} value={log.targetLabel} />
              <EvidenceField label={t.task} value={log.taskId} />
              <EvidenceField label={t.actor} value={log.actor} />
              <EvidenceField label={t.scope} value={log.scope} />
              <EvidenceField label={t.source} value={log.sourceIp} />
              <EvidenceField label={t.userAgent} value={log.userAgent} />
              <EvidenceField label={t.requestId} value={log.requestId} />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.request}
            </p>
            <div className="mt-3 grid gap-2">
              <EvidenceField label={t.requestId} value={log.requestId} />
              <EvidenceField label={t.requestBodyHash} value={log.requestBodyHash} />
            </div>
          </div>

          {(log.denialCode || log.denialReason) && (
            <div className="rounded-xl border border-red-200 bg-red-50/70 p-4 dark:border-red-500/20 dark:bg-red-500/10">
              <p className="text-xs font-black uppercase tracking-widest text-red-600 dark:text-red-300">{t.denial}</p>
              <div className="mt-3 grid gap-2">
                <EvidenceField label="code" value={log.denialCode} />
                <EvidenceField label="reason" value={log.denialReason} />
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.evidenceIntegrity}
            </p>
            <div className="mt-3 grid gap-2">
              <EvidenceField label={t.previousHash} value={log.prevHash} />
              <EvidenceField label={t.currentHash} value={log.hash} />
            </div>
          </div>

          <EvidenceJsonBlock emptyText={t.noEvidence} label={t.before} value={log.before} />
          <EvidenceJsonBlock emptyText={t.noEvidence} label={t.after} value={log.after} />

          <div className="flex justify-end">
            <button
              className="inline-flex items-center gap-2 rounded-lg bg-[#1E3AFF] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[#FF3D18] dark:bg-[#6B7CFF] dark:text-[#07111F] dark:hover:bg-[#FF6A3A]"
              onClick={() => copyAuditEvidence(log)}
              type="button"
            >
              <Copy className="h-3.5 w-3.5" />
              {t.copyEvidence}
            </button>
          </div>
        </div>
      ) : null}
    </ConfigDrawer>
  );
}

export function AuditPage({ auditLogs, language = 'zh', onVerifyAuditLogs }: AuditPageProps) {
  const t = copy[language];
  const [auditSearch, setAuditSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<AuditSeverityFilter>('all');
  const [resultFilter, setResultFilter] = useState<AuditResultFilter>('all');
  const [selectedAuditLog, setSelectedAuditLog] = useState<AuditLog | undefined>();
  const [auditVerification, setAuditVerification] = useState<AuditChainVerification | undefined>();
  const [auditVerificationError, setAuditVerificationError] = useState('');
  const [auditVerificationBusy, setAuditVerificationBusy] = useState(false);
  const filteredLogs = useMemo(
    () => filterAuditLogs(auditLogs, auditSearch, severityFilter, resultFilter, t),
    [auditLogs, auditSearch, resultFilter, severityFilter, t]
  );
  const criticalLogCount = useMemo(() => auditLogs.filter((log) => log.severity === 'critical').length, [auditLogs]);
  const deniedLogCount = useMemo(() => auditLogs.filter((log) => log.result === 'denied').length, [auditLogs]);

  async function verifyAuditChain() {
    if (!onVerifyAuditLogs || auditLogs.length === 0) {
      return;
    }

    setAuditVerificationBusy(true);
    setAuditVerificationError('');

    try {
      setAuditVerification(await onVerifyAuditLogs(auditLogs));
    } catch {
      setAuditVerification(undefined);
      setAuditVerificationError(t.auditChainError);
    } finally {
      setAuditVerificationBusy(false);
    }
  }

  return (
    <ResponsivePage className="space-y-5 md:space-y-6">
      <section
        aria-label={t.operationalOverview}
        className="stagger-1 overflow-hidden rounded-xl border border-[#1E3AFF] bg-[#FFFDF5]/92 p-5 shadow-sm dark:border-[#6B7CFF]/25 dark:bg-white/[0.03] dark:shadow-[0_12px_28px_rgba(0,0,0,0.18)] max-md:rounded-2xl max-md:border-[#1E3AFF] max-md:bg-[#FFFDF5]/96 max-md:p-4 max-md:shadow-sm max-md:dark:border-[#6B7CFF]/25 max-md:dark:bg-slate-950/88"
      >
        <div className="min-w-0 max-w-4xl">
          <p className="font-mono text-[10px] font-black uppercase tracking-[0.18em] text-[#1E3AFF] dark:text-[#DDE3FF]">
            {t.operationalOverview}
          </p>
          <h3 className="mt-3 text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
          <p className="mt-2 max-w-4xl text-xs leading-6 text-slate-500 dark:text-white/50">{t.subtitle}</p>
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-bold text-slate-600 dark:text-white/65">
            <span className="rounded-full border border-[#1E3AFF] bg-[#DCE1FF] px-3 py-1.5 dark:border-[#6B7CFF]/25 dark:bg-white/[0.03]">
              {t.matchingLogs} {formatNumber(filteredLogs.length)} / {formatNumber(auditLogs.length)}
            </span>
            <span className="rounded-full border border-[#FF3D18] bg-[#FF3D18]/[0.12] px-3 py-1.5 dark:border-[#FF6A3A]/30 dark:bg-white/[0.03]">
              {t.overviewCritical} {formatNumber(criticalLogCount)}
            </span>
            <span className="rounded-full border border-[#FF3D18] bg-[#FF3D18]/[0.12] px-3 py-1.5 dark:border-[#FF6A3A]/30 dark:bg-white/[0.03]">
              {t.overviewDenied} {formatNumber(deniedLogCount)}
            </span>
          </div>
        </div>
      </section>

      <WorkspaceCockpit aria-label={t.auditEvidenceCockpit} className="audit-evidence-cockpit stagger-2">
        <div className="grid min-h-0 grid-cols-1 xl:grid-cols-[21rem_minmax(0,1fr)]">
          <aside
            aria-label={t.auditEvidenceControlRail}
            className="audit-evidence-rail border-b border-[#07111F]/20 bg-[#EAF3D1]/70 p-4 dark:border-[#6B7CFF]/20 dark:bg-white/[0.02] xl:border-b-0 xl:border-r"
            role="complementary"
          >
            <div className="flex flex-col gap-4 xl:sticky xl:top-0">
              <div className="rounded-xl border border-[#1E3AFF]/40 bg-[#FFFDF5]/75 p-4 dark:border-[#6B7CFF]/25 dark:bg-white/[0.03]">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-[#1E3AFF] dark:text-[#DDE3FF]" />
                  <p className="text-sm font-semibold text-slate-800 dark:text-white">{t.evidencePath}</p>
                </div>
                <AuditEvidencePath labels={t.workflowSteps} />
                <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-white/50">
                  {t.operationalOverviewHint}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <AuditSummaryCard
                  ariaLabel={t.overviewTotalAria}
                  icon={FileSearch}
                  label={t.overviewTotal}
                  value={formatNumber(auditLogs.length)}
                />
                <AuditSummaryCard
                  ariaLabel={t.overviewVisibleAria}
                  icon={Search}
                  label={t.overviewVisible}
                  value={formatNumber(filteredLogs.length)}
                />
                <AuditSummaryCard
                  ariaLabel={t.overviewCriticalAria}
                  icon={ShieldAlert}
                  label={t.overviewCritical}
                  tone="signal"
                  value={formatNumber(criticalLogCount)}
                />
                <AuditSummaryCard
                  ariaLabel={t.overviewDeniedAria}
                  icon={ShieldCheck}
                  label={t.overviewDenied}
                  tone="signal"
                  value={formatNumber(deniedLogCount)}
                />
              </div>

              {auditLogs.length > 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white/75 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="grid grid-cols-1 gap-3">
                    <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                        {t.searchLogs}
                      </span>
                      <div className="mt-1 flex min-h-7 items-center gap-2">
                        <Search className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-white/35" />
                        <input
                          aria-label={t.searchLogs}
                          className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-white/35"
                          onChange={(event) => setAuditSearch(event.target.value)}
                          placeholder={t.searchLogsPlaceholder}
                          type="search"
                          value={auditSearch}
                        />
                      </div>
                    </label>

                    <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                        {t.severityFilter}
                      </span>
                      <select
                        aria-label={t.severityFilter}
                        className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
                        onChange={(event) => setSeverityFilter(event.target.value as AuditSeverityFilter)}
                        value={severityFilter}
                      >
                        <option value="all">{t.allSeverities}</option>
                        {auditSeverities.map((severity) => (
                          <option key={severity} value={severity}>
                            {t.severity[severity]}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                        {t.resultFilter}
                      </span>
                      <select
                        aria-label={t.resultFilter}
                        className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
                        onChange={(event) => setResultFilter(event.target.value as AuditResultFilter)}
                        value={resultFilter}
                      >
                        <option value="all">{t.allResults}</option>
                        {auditResults.map((result) => (
                          <option key={result} value={result}>
                            {t.result[result]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="mt-3 flex flex-col gap-2">
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                      {t.matchingLogs} {filteredLogs.length} / {auditLogs.length}
                    </p>
                    {onVerifyAuditLogs ? (
                      <button
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#1E3AFF] px-3 text-xs font-bold text-[#1E3AFF] transition hover:bg-[#DCE1FF] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#6B7CFF]/35 dark:text-[#DDE3FF] dark:hover:bg-white/10"
                        disabled={auditLogs.length === 0 || auditVerificationBusy}
                        onClick={() => void verifyAuditChain()}
                        type="button"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {auditVerificationBusy ? t.verifyingAuditChain : t.verifyAuditChain}
                      </button>
                    ) : null}
                    <button
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#1E3AFF] px-3 text-xs font-bold text-[#1E3AFF] transition hover:bg-[#DCE1FF] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#6B7CFF]/35 dark:text-[#DDE3FF] dark:hover:bg-white/10"
                      disabled={filteredLogs.length === 0}
                      onClick={() => copyAuditEvidenceSet(filteredLogs)}
                      type="button"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {t.copyVisibleEvidence}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </aside>

          <WorkspaceCockpitScroller aria-label={t.auditLedgerWorkspace} className="audit-evidence-workspace min-h-0">
            <div className="space-y-4 p-4">
              {auditVerification || auditVerificationError ? (
                <div
                  aria-label={t.auditChainStatus}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/80 p-4 dark:border-white/10 dark:bg-white/[0.04]"
                  role="status"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    {auditVerification?.valid ? (
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
                    ) : (
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-300" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-black uppercase tracking-widest text-slate-600 dark:text-white/60">
                        {auditVerificationError || (auditVerification?.valid ? t.auditChainValid : t.auditChainInvalid)}
                      </p>
                      {auditVerification ? (
                        <p className="mt-1 break-all font-mono text-[11px] text-slate-500 dark:text-white/45">
                          {t.checkedRecords(String(auditVerification.checked))}
                          {auditVerification.brokenAt ? ` · ${t.brokenAt(auditVerification.brokenAt)}` : ''}
                          {auditVerification.reason ? ` · ${t.chainFailureReason(auditVerification.reason)}` : ''}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {auditVerification ? (
                    <button
                      className="inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-[#1E3AFF] px-3 text-xs font-bold text-[#1E3AFF] transition hover:bg-[#DCE1FF] dark:border-[#6B7CFF]/35 dark:text-[#DDE3FF] dark:hover:bg-white/10"
                      onClick={() => copyAuditVerificationResult(auditLogs, auditVerification)}
                      type="button"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {t.copyVerificationResult}
                    </button>
                  ) : null}
                </div>
              ) : null}

              <GlassCard aria-label={t.ledgerTitle} className="audit-evidence-ledger p-5" role="group">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <FileSearch className="h-4 w-4 text-[#1E3AFF] dark:text-[#DDE3FF]" />
                    <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.ledgerTitle}</h4>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/65">
                    {t.matchingLogs} {formatNumber(filteredLogs.length)} / {formatNumber(auditLogs.length)}
                  </span>
                </div>

                <div className="space-y-3">
                  {filteredLogs.map((log) => (
                    <article
                      aria-label={log.message}
                      className="audit-evidence-row rounded-xl border border-[#07111F]/20 bg-[#FFFDF5]/70 p-4 transition hover:-translate-y-0.5 hover:border-[#1E3AFF] hover:shadow-[0_14px_38px_-30px_rgba(15,23,42,0.22)] dark:border-[#6B7CFF]/20 dark:bg-white/[0.03] dark:hover:border-[#6B7CFF]/40"
                      key={log.id}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-bold text-slate-900 dark:text-white">{log.message}</p>
                          <p className="mt-1 break-all font-mono text-[11px] text-slate-500 dark:text-white/45">
                            {t.actions[log.action]} · {log.targetLabel} · {formatDateTime(log.createdAt, language)}
                          </p>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-white/10 dark:text-white/70">
                            {t.severity[log.severity]}
                          </span>
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-white/10 dark:text-white/70">
                            {t.result[log.result]}
                          </span>
                        </div>
                      </div>
                      <p className="mt-3 text-xs text-slate-500 dark:text-white/50">
                        {t.actor} {log.actor} · {t.source} {log.sourceIp} · {t.task} {log.taskId}
                      </p>
                      <div className="mt-4 flex justify-end">
                        <button
                          aria-label={t.viewEvidence}
                          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#1E3AFF] px-3 py-2 text-xs font-bold text-[#1E3AFF] transition-colors hover:bg-[#DCE1FF] dark:border-[#6B7CFF]/35 dark:text-[#DDE3FF] dark:hover:border-[#6B7CFF]/40"
                          onClick={() => setSelectedAuditLog(log)}
                          type="button"
                        >
                          <FileSearch className="h-3.5 w-3.5" />
                          {t.viewEvidence}
                        </button>
                      </div>
                    </article>
                  ))}
                  {auditLogs.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-white/10">
                      <p className="text-sm font-bold text-slate-700 dark:text-white/70">{t.emptyTitle}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-white/45">{t.emptyDescription}</p>
                    </div>
                  ) : null}
                  {auditLogs.length > 0 && filteredLogs.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 p-5 text-sm font-semibold text-slate-500 dark:border-white/10 dark:text-white/45">
                      {t.noMatchingLogs}
                    </div>
                  ) : null}
                </div>
              </GlassCard>
            </div>
          </WorkspaceCockpitScroller>
        </div>
      </WorkspaceCockpit>

      <AuditEvidenceDrawer
        language={language}
        log={selectedAuditLog}
        open={Boolean(selectedAuditLog)}
        onClose={() => setSelectedAuditLog(undefined)}
      />
    </ResponsivePage>
  );
}
